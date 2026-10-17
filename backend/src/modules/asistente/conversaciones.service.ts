import { ConflictException, Injectable, Logger, NotFoundException, BadRequestException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { PrismaService } from '../../prisma/prisma.service';
import {
    AccionIrA,
    ConversacionDetalle,
    ConversacionResumen,
    EstadoMensaje,
    FuenteAyuda,
    MensajeAsistente,
} from './dto/asistente.tipos';
import { TurnoHistorial } from './prompt/armar-request';
import { ResultadoTurno } from './turno/turno-runner';

/** Turnos máximos de una conversación: después hay que empezar otra. */
export const MAX_TURNOS_CONVERSACION = 40;
/** Un mensaje `en_curso` más viejo que esto es de un proceso que murió. */
export const EN_CURSO_VENCIDO_MS = 5 * 60 * 1000;

export interface TurnoCreado {
    conversacionId: number;
    mensajeUsuarioId: number;
    mensajeId: number;
    versionWiki: string;
    historial: TurnoHistorial[];
    ultimoPromptTokens: number;
}

@Injectable()
export class ConversacionesService implements OnModuleInit {
    private readonly logger = new Logger(ConversacionesService.name);

    constructor(private readonly prisma: PrismaService) {}

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
                if (c.turnos >= MAX_TURNOS_CONVERSACION) {
                    throw new ConflictException({
                        codigo: 'CONVERSACION_LLENA',
                        mensaje: 'Esta conversación ya es muy larga. Empezá una nueva.',
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
            return {
                conversacionId,
                mensajeUsuarioId: usuario.id,
                mensajeId: asistente.id,
                versionWiki,
                historial,
                ultimoPromptTokens,
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
        resultado: ResultadoTurno;
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

    async listar(usuarioId: number, limite = 20): Promise<ConversacionResumen[]> {
        const filas = await this.prisma.asistente_conversacion.findMany({
            where: { usuarioId },
            orderBy: { updatedAt: 'desc' },
            take: Math.min(Math.max(limite, 1), 50),
        });
        return filas.map((c) => this.resumen(c));
    }

    async detalle(usuarioId: number, id: number): Promise<ConversacionDetalle> {
        const c = await this.prisma.asistente_conversacion.findFirst({
            where: { id, usuarioId },
            include: { mensajes: { orderBy: { id: 'asc' } } },
        });
        if (!c) throw new NotFoundException('No encontramos esa conversación.');
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
            })) satisfies MensajeAsistente[],
        };
    }

    private resumen(c: { id: number; titulo: string; turnos: number; updatedAt: Date }): ConversacionResumen {
        return { id: c.id, titulo: c.titulo, turnos: c.turnos, updatedAt: c.updatedAt.toISOString() };
    }

    async calificar(usuarioId: number, mensajeId: number, valor: 1 | -1 | 0, comentario?: string): Promise<void> {
        const m = await this.prisma.asistente_mensaje.findFirst({ where: { id: mensajeId, usuarioId } });
        if (!m) throw new NotFoundException('No encontramos ese mensaje.');
        if (m.rol !== 'asistente') throw new BadRequestException('Solo se pueden calificar las respuestas del asistente.');
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
