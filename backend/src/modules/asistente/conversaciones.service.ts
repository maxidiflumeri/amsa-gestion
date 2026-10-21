import { ConflictException, Injectable, Logger, NotFoundException, BadRequestException, OnModuleInit, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { PrismaService } from '../../prisma/prisma.service';
import {
    AccionIrA,
    ConversacionDetalle,
    ConversacionResumen,
    DetalleRespuesta,
    EstadoMensaje,
    FuenteAyuda,
    FuncionClave,
    MensajeAsistente,
    Paso,
    PrecioModelo,
    TiemposNavegador,
} from './dto/asistente.tipos';
import { AdjuntosService } from './adjuntos/adjuntos.service';
import { TurnoHistorial } from './prompt/armar-request';
import { MAX_PROMPT_REPORTES, MAX_TURNOS_REPORTES, mensajeFuncionDistinta } from './reportes/funcion-reportes';
import { PropuestasService } from './reportes/propuestas.service';
import { MedicionService, esDetalle } from './medicion.service';
import { detalleDesdeLlamadas } from './turno/detalle';
import { ResultadoTurno } from './turno/turno-runner';

/** Turnos máximos de una conversación: después hay que empezar otra. */
export const MAX_TURNOS_CONVERSACION = 40;
/** Un mensaje `en_curso` más viejo que esto es de un proceso que murió. */
export const EN_CURSO_VENCIDO_MS = 5 * 60 * 1000;

/** Pasado este tiempo desde que se escribió la respuesta, el navegador ya no puede cargar sus tiempos. */
export const VENTANA_TIEMPOS_NAVEGADOR_MS = 30 * 60 * 1000;

export const MENSAJE_CONVERSACION_LLENA_REPORTES =
    'Esta conversación ya es muy larga. Empezá una nueva: la última propuesta sigue disponible en su tarjeta.';

export interface TurnoCreado {
    conversacionId: number;
    mensajeUsuarioId: number;
    mensajeId: number;
    versionWiki: string;
    historial: TurnoHistorial[];
    ultimoPromptTokens: number;
    /** Si la conversación ya tenía turnos cerrados (para mandar las empresas solo en el primero). */
    esPrimerTurno: boolean;
}

@Injectable()
export class ConversacionesService implements OnModuleInit {
    private readonly logger = new Logger(ConversacionesService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly adjuntos: AdjuntosService,
        private readonly propuestas: PropuestasService,
        // Para el precio con el que se reparte el costo de una llamada vieja. Opcional: sin él, esos nodos van sin costo.
        @Optional() private readonly medicion?: MedicionService,
    ) {}

    /** La función de una conversación propia, o null si no existe. */
    async funcionDe(usuarioId: number, conversacionId: number): Promise<FuncionClave | null> {
        const c = await this.prisma.asistente_conversacion.findFirst({ where: { id: conversacionId, usuarioId }, select: { funcion: true } });
        return c ? (c.funcion as FuncionClave) : null;
    }

    /** Los `en_curso` viejos son de un reinicio a mitad de un turno: pasan a `error` (el costo ya quedó en las llamadas). */
    async onModuleInit(): Promise<void> {
        try {
            await this.barrerEnCurso();
        } catch (e: any) {
            this.logger.error(`No se pudieron revisar los mensajes en curso: ${e?.message}`, e?.stack);
        }
    }

    async barrerEnCurso(ahora: Date = new Date()): Promise<number> {
        const r = await this.prisma.asistente_mensaje.updateMany({
            where: { estado: 'en_curso', createdAt: { lt: new Date(ahora.getTime() - EN_CURSO_VENCIDO_MS) } },
            data: { estado: 'error' },
        });
        if (r.count > 0) this.logger.warn(`${r.count} mensajes del asistente quedaron en curso por un reinicio: pasan a error`);
        return r.count;
    }

    /**
     * Antes de abrir el stream: crea la conversación si no hay, guarda la pregunta y deja el mensaje del asistente
     * `en_curso`, así `inicio` ya tiene su id. Devuelve el historial de la conversación (turnos `ok`/`cortado`).
     */
    async crearTurno(p: {
        usuarioId: number;
        conversacionId?: number;
        pregunta: string;
        ruta: string;
        versionWiki: string;
        funcion: string;
        /** Fase B: los archivos de ejemplo que se mandan con este mensaje. */
        adjuntoIds?: number[];
    }): Promise<TurnoCreado> {
        return this.prisma.$transaction(async (tx) => {
            let conversacionId = p.conversacionId;
            let historial: TurnoHistorial[] = [];
            let ultimoPromptTokens = 0;
            let versionWiki = p.versionWiki;

            if (conversacionId != null) {
                const c = await tx.asistente_conversacion.findFirst({ where: { id: conversacionId, usuarioId: p.usuarioId } });
                if (!c) {
                    this.logger.warn(`Conversación ${conversacionId} inexistente o ajena (usuario=${p.usuarioId})`);
                    throw new NotFoundException('No encontramos esa conversación.');
                }
                if (c.funcion !== p.funcion) {
                    this.logger.warn(`Función distinta (conversación ${c.id} es de ${c.funcion}, se pidió ${p.funcion})`);
                    {
                        const mensaje = mensajeFuncionDistinta(c.funcion);
                        throw new ConflictException({ codigo: 'FUNCION_DISTINTA', mensaje, message: mensaje });
                    }
                }
                const limiteTurnos = p.funcion === 'reportes' ? MAX_TURNOS_REPORTES : MAX_TURNOS_CONVERSACION;
                if (c.turnos >= limiteTurnos) {
                    throw new ConflictException({
                        codigo: 'CONVERSACION_LLENA',
                        mensaje: p.funcion === 'reportes' ? MENSAJE_CONVERSACION_LLENA_REPORTES : 'Esta conversación ya es muy larga. Empezá una nueva.',
                    });
                }
                versionWiki = c.versionWiki;
                historial = await this.historialDe(tx, c.id);
                const ultima = await tx.asistente_llamada.findFirst({
                    where: { conversacionId: c.id, error: null },
                    orderBy: { id: 'desc' },
                    select: { tokensEntrada: true, cacheLectura: true, cacheEscritura5m: true, cacheEscritura1h: true },
                });
                if (ultima) {
                    ultimoPromptTokens =
                        ultima.tokensEntrada + ultima.cacheLectura + ultima.cacheEscritura5m + ultima.cacheEscritura1h;
                }
                // Reportes no recorta el historial (invalidaría las firmas del thinking): se corta la conversación por tamaño.
                if (p.funcion === 'reportes' && ultimoPromptTokens > MAX_PROMPT_REPORTES) {
                    throw new ConflictException({ codigo: 'CONVERSACION_LLENA', mensaje: MENSAJE_CONVERSACION_LLENA_REPORTES, message: MENSAJE_CONVERSACION_LLENA_REPORTES });
                }
            } else {
                const c = await tx.asistente_conversacion.create({
                    data: {
                        usuarioId: p.usuarioId,
                        funcion: p.funcion,
                        titulo: Array.from(p.pregunta).slice(0, 120).join(''),
                        versionWiki: p.versionWiki,
                    },
                });
                conversacionId = c.id;
            }

            const usuario = await tx.asistente_mensaje.create({
                data: {
                    conversacionId,
                    usuarioId: p.usuarioId,
                    rol: 'usuario',
                    texto: p.pregunta,
                    ruta: p.ruta.slice(0, 200),
                    apiMensajes: [],
                    estado: 'ok',
                },
            });
            const asistente = await tx.asistente_mensaje.create({
                data: {
                    conversacionId,
                    usuarioId: p.usuarioId,
                    rol: 'asistente',
                    texto: '',
                    apiMensajes: [],
                    estado: 'en_curso',
                },
            });
            if (p.adjuntoIds && p.adjuntoIds.length > 0) {
                await this.adjuntos.vincular(tx, { usuarioId: p.usuarioId, conversacionId, mensajeId: usuario.id, ids: p.adjuntoIds });
            }
            return {
                conversacionId,
                mensajeUsuarioId: usuario.id,
                mensajeId: asistente.id,
                versionWiki,
                historial,
                ultimoPromptTokens,
                esPrimerTurno: historial.length === 0,
            };
        });
    }

    /** Los turnos cerrados bien, en orden: lo que aportaron la pregunta y la respuesta de cada uno. */
    private async historialDe(tx: Prisma.TransactionClient, conversacionId: number): Promise<TurnoHistorial[]> {
        const mensajes = await tx.asistente_mensaje.findMany({
            where: { conversacionId },
            orderBy: { id: 'asc' },
            select: { rol: true, estado: true, apiMensajes: true },
        });
        const turnos: TurnoHistorial[] = [];
        for (let i = 0; i < mensajes.length - 1; i++) {
            const u = mensajes[i];
            const a = mensajes[i + 1];
            if (u.rol !== 'usuario' || a.rol !== 'asistente') continue;
            if (a.estado !== 'ok' && a.estado !== 'cortado') continue;
            const mensajesApi = [...(u.apiMensajes as unknown as MessageParam[]), ...(a.apiMensajes as unknown as MessageParam[])];
            // Un turno tiene que terminar en un mensaje del asistente; uno guardado sin él (antes del arreglo) no entra.
            if (mensajesApi.length > 0 && mensajesApi[mensajesApi.length - 1].role === 'assistant') turnos.push({ mensajes: mensajesApi });
        }
        return turnos;
    }

    /** Guarda el resultado del turno: el mensaje del asistente, lo que aportó la pregunta y los totales de la conversación. */
    async finalizarTurno(p: {
        conversacionId: number;
        mensajeUsuarioId: number;
        mensajeId: number;
        resultado: ResultadoTurno & { pasos?: Paso[] };
    }): Promise<void> {
        const r = p.resultado;
        const estado: EstadoMensaje = r.estado;
        // Lo que no terminó bien no entra al historial de los turnos siguientes.
        const entraAlHistorial = estado === 'ok' || estado === 'cortado';
        await this.prisma.$transaction([
            this.prisma.asistente_mensaje.update({
                where: { id: p.mensajeUsuarioId },
                data: { apiMensajes: r.apiUsuario as unknown as Prisma.InputJsonValue },
            }),
            this.prisma.asistente_mensaje.update({
                where: { id: p.mensajeId },
                data: {
                    texto: r.texto,
                    fuentes: r.fuentes as unknown as Prisma.InputJsonValue,
                    acciones: r.acciones as unknown as Prisma.InputJsonValue,
                    ...(r.pasos && r.pasos.length > 0 ? { pasos: r.pasos as unknown as Prisma.InputJsonValue } : {}),
                    apiMensajes: (entraAlHistorial ? r.apiAsistente : []) as unknown as Prisma.InputJsonValue,
                    estado,
                    ms: r.ms,
                },
            }),
            this.prisma.asistente_conversacion.update({
                where: { id: p.conversacionId },
                data: {
                    turnos: entraAlHistorial ? { increment: 1 } : undefined,
                    costoUsd: { increment: r.costoUsd },
                },
            }),
        ]);
    }

    /** Marca un mensaje como `error` cuando el turno falló por algo nuestro. */
    async marcarError(mensajeId: number, texto = ''): Promise<void> {
        await this.prisma.asistente_mensaje.update({ where: { id: mensajeId }, data: { estado: 'error', texto } });
    }

    async listar(usuarioId: number, limite = 20, funcion?: FuncionClave): Promise<ConversacionResumen[]> {
        const filas = await this.prisma.asistente_conversacion.findMany({
            where: { usuarioId, ...(funcion ? { funcion } : {}) },
            orderBy: { updatedAt: 'desc' },
            take: Math.min(Math.max(limite, 1), 50),
        });
        return filas.map((c) => this.resumen(c));
    }

    /**
     * Guarda el detalle de una respuesta (docs/asistente-detalle-spec.md §7.7). Va en una escritura aparte de la respuesta:
     * si falla, quien llama lo registra y la respuesta sigue.
     */
    async guardarTraza(mensajeId: number, detalle: DetalleRespuesta): Promise<void> {
        await this.prisma.asistente_mensaje.update({
            where: { id: mensajeId },
            data: { traza: detalle as unknown as Prisma.InputJsonValue },
        });
    }

    /**
     * Lo que midió el navegador de la persona. La primera escritura gana. 404 si el mensaje es ajeno, no existe, es de la
     * persona, sigue en curso o es de hace más de 30 minutos; 400 si los tiempos no son coherentes.
     */
    async registrarTiemposNavegador(usuarioId: number, mensajeId: number, t: { primeraSenalMs?: number | null; primerTextoMs?: number | null; totalMs: number }): Promise<void> {
        const tiempos: TiemposNavegador = { primeraSenalMs: t.primeraSenalMs ?? null, primerTextoMs: t.primerTextoMs ?? null, totalMs: t.totalMs };
        if ((tiempos.primeraSenalMs ?? 0) > tiempos.totalMs || (tiempos.primerTextoMs ?? 0) > tiempos.totalMs) {
            this.logger.warn(`Tiempos del navegador incoherentes (mensaje=${mensajeId}, usuario=${usuarioId})`);
            const mensaje = 'La primera señal y el primer texto no pueden pasar del total.';
            throw new BadRequestException({ codigo: 'TIEMPOS_INVALIDOS', mensaje, message: mensaje });
        }
        const propio = {
            id: mensajeId,
            usuarioId,
            rol: 'asistente',
            estado: { not: 'en_curso' },
            createdAt: { gte: new Date(Date.now() - VENTANA_TIEMPOS_NAVEGADOR_MS) },
        };
        const r = await this.prisma.asistente_mensaje.updateMany({
            where: { ...propio, tiemposNavegador: { equals: Prisma.DbNull } },
            data: { tiemposNavegador: tiempos as unknown as Prisma.InputJsonValue },
        });
        if (r.count > 0) {
            this.logger.debug(`Tiempos del navegador guardados (mensaje=${mensajeId}): total=${tiempos.totalMs}ms`);
            return;
        }
        // 0 filas: o ya estaban cargados (no pasa nada) o el mensaje no es de esta persona / no corresponde.
        const existe = await this.prisma.asistente_mensaje.findFirst({ where: propio, select: { id: true } });
        if (!existe) throw new NotFoundException('No encontramos ese mensaje.');
    }

    /** El detalle de la respuesta de cualquier persona (es para las 👎 de Consumo). 404 si no existe, es de la persona o no tiene nada que mostrar. */
    async detalleDeMensaje(mensajeId: number): Promise<DetalleRespuesta> {
        const m = await this.prisma.asistente_mensaje.findFirst({
            where: { id: mensajeId, rol: 'asistente' },
            include: { conversacion: { select: { funcion: true } } },
        });
        if (!m) throw new NotFoundException('No encontramos ese mensaje.');
        const llamadas = esDetalle(m.traza) || m.estado === 'en_curso' ? [] : await this.llamadasDe(m.conversacionId, [m.id]);
        const d = await this.detalleDe(m, m.conversacion.funcion, llamadas);
        if (!d) throw new NotFoundException('Esa respuesta no tiene detalle.');
        return d;
    }

    /** Las llamadas de varios mensajes con UNA consulta, en orden. */
    private llamadasDe(conversacionId: number, mensajeIds: number[]) {
        if (mensajeIds.length === 0) return Promise.resolve([]);
        // `conversacionId` va para usar el índice de la FK: `asistente_llamada` no tiene uno por `mensajeId`.
        return this.prisma.asistente_llamada.findMany({ where: { conversacionId, mensajeId: { in: mensajeIds } }, orderBy: { id: 'asc' } });
    }

    /** Su `traza` con lo del navegador o, si no tiene, el reconstruido desde las llamadas (D-7). `null` = nada para mostrar. */
    private async detalleDe(
        m: { id: number; estado: string; texto: string; ms: number | null; traza: unknown; tiemposNavegador: unknown },
        funcion: string,
        llamadas: Awaited<ReturnType<ConversacionesService['llamadasDe']>>,
    ): Promise<DetalleRespuesta | null> {
        if (m.estado === 'en_curso') return null;
        const nav = m.tiemposNavegador as Partial<TiemposNavegador> | null;
        const navegador: TiemposNavegador | null =
            nav && typeof nav === 'object' && typeof nav.totalMs === 'number'
                ? { primeraSenalMs: nav.primeraSenalMs ?? null, primerTextoMs: nav.primerTextoMs ?? null, totalMs: nav.totalMs }
                : null;
        if (esDetalle(m.traza)) return { ...m.traza, parcial: false, navegador };

        const propias = llamadas.filter((l) => l.mensajeId === m.id);
        if (propias.length === 0) return null;
        const modelo = propias[0].modelo;
        let precio: PrecioModelo | null = null;
        try {
            precio = (await this.medicion?.precioDe(modelo)) ?? null;
        } catch (e: any) {
            this.logger.warn(`No se pudo leer el precio de ${modelo} para reconstruir el detalle: ${e?.message}`);
        }
        const estado: DetalleRespuesta['estado'] = m.estado === 'cortado' || m.estado === 'rechazado' || m.estado === 'error' ? m.estado : 'ok';
        const d = detalleDesdeLlamadas(propias, { funcion, modelo, precio, mensajeMs: m.ms, estado, textoVacio: m.texto.trim() === '' });
        return d ? { ...d, navegador } : null;
    }

    async detalle(usuarioId: number, id: number, opciones: { conDetalle?: boolean } = {}): Promise<ConversacionDetalle> {
        const c = await this.prisma.asistente_conversacion.findFirst({
            where: { id, usuarioId },
            include: { mensajes: { orderBy: { id: 'asc' } } },
        });
        if (!c) throw new NotFoundException('No encontramos esa conversación.');
        const esReportes = c.funcion === 'reportes';
        const tarjetas = esReportes ? await this.propuestas.tarjetasDeConversacion(c.id) : new Map();
        const chips = esReportes ? await this.adjuntos.chipsDeConversacion(c.id) : new Map();

        // El detalle solo se arma para quien tiene el permiso: sin él la clave ni existe. Las respuestas sin traza se
        // reconstruyen desde sus llamadas con UNA consulta para toda la conversación.
        const detalles = new Map<number, DetalleRespuesta | null>();
        if (opciones.conDetalle) {
            const sinTraza = c.mensajes.filter((m) => m.rol === 'asistente' && m.estado !== 'en_curso' && !esDetalle(m.traza));
            const llamadas = await this.llamadasDe(c.id, sinTraza.map((m) => m.id));
            for (const m of c.mensajes) {
                if (m.rol !== 'asistente') continue;
                try {
                    detalles.set(m.id, await this.detalleDe(m, c.funcion, llamadas));
                } catch (e: any) {
                    this.logger.warn(`No se pudo armar el detalle del mensaje ${m.id}: ${e?.message}`);
                    detalles.set(m.id, null);
                }
            }
        }
        return {
            ...this.resumen(c),
            mensajes: c.mensajes.map((m) => ({
                id: m.id,
                rol: m.rol === 'usuario' ? 'usuario' : 'asistente',
                texto: m.texto,
                ruta: m.ruta,
                fuentes: Array.isArray(m.fuentes) ? (m.fuentes as unknown as FuenteAyuda[]) : [],
                acciones: Array.isArray(m.acciones) ? (m.acciones as unknown as AccionIrA[]) : [],
                estado: m.estado as EstadoMensaje,
                calificacion: m.calificacion === 1 ? 1 : m.calificacion === -1 ? -1 : null,
                createdAt: m.createdAt.toISOString(),
                pasos: Array.isArray(m.pasos) ? (m.pasos as unknown as Paso[]) : [],
                propuestas: tarjetas.get(m.id) ?? [],
                adjuntos: chips.get(m.id) ?? [],
                ...(opciones.conDetalle && m.rol !== 'usuario' ? { detalle: detalles.get(m.id) ?? null } : {}),
            })) satisfies MensajeAsistente[],
        };
    }

    private resumen(c: { id: number; titulo: string; turnos: number; updatedAt: Date; funcion: string }): ConversacionResumen {
        return { id: c.id, titulo: c.titulo, turnos: c.turnos, updatedAt: c.updatedAt.toISOString(), funcion: c.funcion === 'reportes' ? 'reportes' : 'ayuda' };
    }

    async calificar(usuarioId: number, mensajeId: number, valor: 1 | -1 | 0, comentario?: string): Promise<void> {
        const m = await this.prisma.asistente_mensaje.findFirst({ where: { id: mensajeId, usuarioId } });
        if (!m) throw new NotFoundException('No encontramos ese mensaje.');
        if (m.rol !== 'asistente') throw new BadRequestException('Solo se pueden calificar las respuestas de amaIA.');
        await this.prisma.asistente_mensaje.update({
            where: { id: mensajeId },
            data: {
                calificacion: valor === 0 ? null : valor,
                comentario: valor === 0 ? null : (comentario?.trim() || null),
            },
        });
        this.logger.log(`Respuesta ${mensajeId} calificada: ${valor} (usuario=${usuarioId})`);
    }

    async registrarAccion(usuarioId: number, mensajeId: number, accionId: string, resultado: 'aceptada' | 'rechazada'): Promise<void> {
        const m = await this.prisma.asistente_mensaje.findFirst({ where: { id: mensajeId, usuarioId, rol: 'asistente' } });
        if (!m) throw new NotFoundException('No encontramos ese mensaje.');
        const acciones = (Array.isArray(m.acciones) ? m.acciones : []) as unknown as AccionIrA[];
        const i = acciones.findIndex((a) => a.id === accionId);
        if (i < 0) throw new NotFoundException('No encontramos esa acción.');
        acciones[i] = { ...acciones[i], resultado };
        await this.prisma.asistente_mensaje.update({
            where: { id: mensajeId },
            data: { acciones: acciones as unknown as Prisma.InputJsonValue },
        });
        this.logger.log(`Acción ${accionId} del mensaje ${mensajeId}: ${resultado} (usuario=${usuarioId})`);
    }
}
