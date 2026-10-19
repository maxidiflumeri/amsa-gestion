import { HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { inicioDelDia, ymdLocal } from '../../../common/utils/dia-local';
import { AdjuntoSubido } from '../dto/asistente.tipos';
import { VocabulariosService } from '../reportes/vocabularios.service';
import { EjemploConId } from '../reportes/turno-reportes.runner';
import { ErrorPerfil, PerfilConAvisos, PerfilEjemplo, detectarTipo, resumenDePerfil, sinEncabezado } from './perfil-ejemplo';
import { PerfilEjemploService } from './perfil-ejemplo.service';

export const MAX_BYTES_DEFAULT = 5 * 1024 * 1024;
export const MAX_POR_MENSAJE = 3;
export const MAX_POR_CONVERSACION = 6;
export const MAX_SUBIDAS_POR_DIA = 30;
const HORAS_SIN_MANDAR = 24;

export function leerMaxBytes(env: NodeJS.ProcessEnv = process.env): number {
    const n = /^\d+$/.test((env.ASISTENTE_ADJUNTO_MAX_BYTES ?? '').trim()) ? Number(env.ASISTENTE_ADJUNTO_MAX_BYTES!.trim()) : NaN;
    return Number.isInteger(n) && n >= 1024 && n <= 50 * 1024 * 1024 ? n : MAX_BYTES_DEFAULT;
}

const STATUS_DE: Record<ErrorPerfil['codigo'], HttpStatus> = {
    TIPO_NO_SOPORTADO: HttpStatus.BAD_REQUEST,
    NO_COINCIDE_EXTENSION: HttpStatus.BAD_REQUEST,
    VACIO: HttpStatus.BAD_REQUEST,
    ILEGIBLE: HttpStatus.BAD_REQUEST,
    ENCRIPTADO: HttpStatus.BAD_REQUEST,
    SIN_COLUMNAS: HttpStatus.BAD_REQUEST,
    OCUPADO: HttpStatus.TOO_MANY_REQUESTS,
};

function error(status: HttpStatus, codigo: string, mensaje: string): HttpException {
    // `message` además de `mensaje`: es lo que muestra el LoggingInterceptor.
    return new HttpException({ codigo, mensaje, message: mensaje }, status);
}

interface FilaAdjunto {
    id: number;
    nombre: string;
    tipo: string;
    bytes: number;
    perfil: Prisma.JsonValue;
    avisos: Prisma.JsonValue | null;
    conversacionId: number | null;
    mensajeId: number | null;
    createdAt: Date;
}

/**
 * Los archivos de ejemplo del asistente (docs/asistente-reportes-spec.md §9). El archivo NO se guarda: se lee en un hilo
 * con límites, se calcula el perfil y se descarta. Nada se escribe al filesystem.
 */
@Injectable()
export class AdjuntosService {
    private readonly logger = new Logger(AdjuntosService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly perfiles: PerfilEjemploService,
        private readonly vocabularios: VocabulariosService,
    ) {}

    private aSubido(f: FilaAdjunto): AdjuntoSubido {
        return {
            id: f.id,
            nombre: f.nombre,
            tipo: f.tipo as AdjuntoSubido['tipo'],
            bytes: f.bytes,
            resumen: resumenDePerfil(f.perfil as unknown as PerfilEjemplo),
            avisos: Array.isArray(f.avisos) ? (f.avisos as string[]) : [],
        };
    }

    /** Una subida a la vez por persona: contar el límite del día y recién después insertar no es atómico si corren juntas. */
    private readonly colas = new Map<number, Promise<unknown>>();

    async subir(usuarioId: number, archivo: { buffer: Buffer; originalname: string; size: number } | undefined): Promise<AdjuntoSubido> {
        const anterior = this.colas.get(usuarioId) ?? Promise.resolve();
        const actual = anterior.catch(() => undefined).then(() => this.subirSerial(usuarioId, archivo));
        this.colas.set(usuarioId, actual);
        try {
            return await actual;
        } finally {
            if (this.colas.get(usuarioId) === actual) this.colas.delete(usuarioId);
        }
    }

    private async subirSerial(usuarioId: number, archivo: { buffer: Buffer; originalname: string; size: number } | undefined): Promise<AdjuntoSubido> {
        if (!archivo) throw error(HttpStatus.BAD_REQUEST, 'VACIO', 'No llegó ningún archivo.');
        const max = leerMaxBytes();
        if (archivo.size > max) {
            this.logger.warn(`Adjunto rechazado por tamaño (usuario=${usuarioId}, ${archivo.size} bytes)`);
            throw error(HttpStatus.PAYLOAD_TOO_LARGE, 'DEMASIADO_GRANDE', `El archivo pesa más de ${Math.round(max / 1024 / 1024)} MB. Un ejemplo de formato no necesita tanto: subí un recorte.`);
        }

        const nombre = Array.from(archivo.originalname.replace(/[\\/]/g, '_')).slice(0, 200).join('');
        // Tipo y extensión PRIMERO: el mismo contenido subido como `macro.xlsm` o `renombrado.csv` no devuelve el adjunto viejo.
        try {
            detectarTipo(archivo.buffer, nombre);
        } catch (e) {
            if (e instanceof ErrorPerfil) {
                this.logger.warn(`Adjunto rechazado (usuario=${usuarioId}): ${e.codigo}`);
                throw error(STATUS_DE[e.codigo], e.codigo, e.message);
            }
            throw e;
        }

        const hoy = await this.prisma.asistente_adjunto.count({ where: { usuarioId, createdAt: { gte: inicioDelDia(ymdLocal()) } } });
        if (hoy >= MAX_SUBIDAS_POR_DIA) {
            this.logger.warn(`Límite diario de adjuntos alcanzado (usuario=${usuarioId})`);
            throw error(HttpStatus.TOO_MANY_REQUESTS, 'LIMITE_ADJUNTOS', 'Llegaste al límite de archivos de hoy. Mañana se renueva.');
        }

        const sha256 = createHash('sha256').update(archivo.buffer).digest('hex');

        // El mismo archivo (mismo contenido y mismo nombre) subido otra vez sin mandar reusa el perfil, pero con OTRO id: dos chips
        // con el mismo id quedarían colgados al quitar uno.
        const igual = await this.prisma.asistente_adjunto.findFirst({
            where: { usuarioId, sha256, nombre, conversacionId: null, createdAt: { gte: new Date(Date.now() - HORAS_SIN_MANDAR * 3600_000) } },
        });
        if (igual) {
            const copia = await this.prisma.asistente_adjunto.create({
                data: {
                    usuarioId,
                    nombre: igual.nombre,
                    tipo: igual.tipo,
                    bytes: igual.bytes,
                    sha256: igual.sha256,
                    perfil: igual.perfil as Prisma.InputJsonValue,
                    ...(igual.avisos !== null ? { avisos: igual.avisos as Prisma.InputJsonValue } : {}),
                },
            });
            return this.aSubido(copia);
        }

        await this.vocabularios.preparar();
        const t0 = Date.now();
        let perfil: PerfilConAvisos;
        try {
            perfil = await this.perfiles.perfilar(archivo.buffer, nombre, this.vocabularios.reconocibles());
        } catch (e) {
            if (e instanceof ErrorPerfil) {
                this.logger.warn(`Adjunto rechazado (usuario=${usuarioId}): ${e.codigo}`);
                throw error(STATUS_DE[e.codigo], e.codigo, e.message);
            }
            throw e;
        }
        const { avisos, ...sinAvisos } = perfil;
        const fila = await this.prisma.asistente_adjunto.create({
            data: {
                usuarioId,
                nombre,
                tipo: perfil.tipo,
                bytes: archivo.size,
                sha256,
                perfil: sinAvisos as unknown as Prisma.InputJsonValue,
                avisos: (avisos ?? []) as unknown as Prisma.InputJsonValue,
            },
        });
        this.logger.log(`Adjunto ${fila.id} perfilado (usuario=${usuarioId}, tipo=${perfil.tipo}) en ${Date.now() - t0}ms`);
        return this.aSubido(fila);
    }

    private async propioSinMandar(usuarioId: number, id: number): Promise<FilaAdjunto> {
        const f = await this.prisma.asistente_adjunto.findFirst({ where: { id, usuarioId } });
        if (!f) {
            this.logger.warn(`Adjunto ${id} inexistente o ajeno (usuario=${usuarioId})`);
            throw new NotFoundException('No encontramos ese archivo.');
        }
        if (f.conversacionId !== null || f.mensajeId !== null) {
            throw error(HttpStatus.CONFLICT, 'YA_ENVIADO', 'Ese archivo ya se mandó al asistente.');
        }
        return f;
    }

    async actualizar(usuarioId: number, id: number, primeraFilaEsEncabezado: boolean): Promise<AdjuntoSubido> {
        const f = await this.propioSinMandar(usuarioId, id);
        const perfil = f.perfil as unknown as PerfilEjemplo;
        const hoja = perfil.hojas[perfil.hojaUsada] ?? perfil.hojas[0];
        if (primeraFilaEsEncabezado) {
            if (hoja.conEncabezado) return this.aSubido(f);
            throw error(HttpStatus.BAD_REQUEST, 'NO_SE_PUEDE', 'Para usar la primera fila como encabezado, volvé a subir el archivo.');
        }
        if (!hoja.conEncabezado) return this.aSubido(f);
        const nuevo = sinEncabezado(perfil);
        const fila = await this.prisma.asistente_adjunto.update({ where: { id }, data: { perfil: nuevo as unknown as Prisma.InputJsonValue } });
        this.logger.log(`Adjunto ${id}: la primera fila se toma como datos (usuario=${usuarioId})`);
        return this.aSubido(fila);
    }

    async borrar(usuarioId: number, id: number): Promise<void> {
        await this.propioSinMandar(usuarioId, id);
        await this.prisma.asistente_adjunto.delete({ where: { id } });
    }

    /**
     * Dentro de la transacción de `crearTurno`: valida que los adjuntos sean de la persona y que se puedan mandar, y los
     * vincula a la conversación y al mensaje. Uno ya vinculado a esta misma conversación se acepta sin volver a vincularlo.
     * Devuelve los ids que son NUEVOS en este mensaje.
     */
    async vincular(tx: Prisma.TransactionClient, p: { usuarioId: number; conversacionId: number; mensajeId: number; ids: number[] }): Promise<number[]> {
        const ids = [...new Set(p.ids)];
        if (ids.length === 0) return [];
        const filas = await tx.asistente_adjunto.findMany({ where: { id: { in: ids }, usuarioId: p.usuarioId } });
        const limite = Date.now() - HORAS_SIN_MANDAR * 3600_000;
        for (const id of ids) {
            const f = filas.find((x) => x.id === id);
            const valido = f && (f.conversacionId === p.conversacionId || (f.conversacionId === null && f.createdAt.getTime() >= limite));
            if (!valido) {
                this.logger.warn(`Adjunto ${id} inválido para la conversación ${p.conversacionId} (usuario=${p.usuarioId})`);
                throw error(HttpStatus.BAD_REQUEST, 'ADJUNTO_INVALIDO', 'Uno de los archivos ya no se puede usar. Quitalo y volvé a subirlo.');
            }
        }
        const nuevos = filas.filter((f) => f.conversacionId === null).map((f) => f.id);
        const yaDeLaConversacion = await tx.asistente_adjunto.count({ where: { conversacionId: p.conversacionId } });
        if (yaDeLaConversacion + nuevos.length > MAX_POR_CONVERSACION) {
            throw error(HttpStatus.BAD_REQUEST, 'ADJUNTO_INVALIDO', `Una conversación admite hasta ${MAX_POR_CONVERSACION} archivos. Empezá una nueva.`);
        }
        if (nuevos.length > 0) {
            await tx.asistente_adjunto.updateMany({ where: { id: { in: nuevos } }, data: { conversacionId: p.conversacionId, mensajeId: p.mensajeId } });
        }
        return nuevos;
    }

    /** Los ejemplos de una conversación para el runner, con cuáles son de este mensaje y cuál es el principal. */
    async paraTurno(conversacionId: number, mensajeUsuarioId: number): Promise<{ ejemplos: EjemploConId[]; nuevos: EjemploConId[]; principalId: number | null }> {
        const filas = await this.prisma.asistente_adjunto.findMany({ where: { conversacionId }, orderBy: { id: 'asc' } });
        const aEjemplo = (f: (typeof filas)[number]): EjemploConId => ({
            id: f.id,
            nombre: f.nombre,
            perfil: { ...(f.perfil as unknown as PerfilEjemplo), avisos: Array.isArray(f.avisos) ? (f.avisos as string[]) : [] },
        });
        const ejemplos = filas.map(aEjemplo);
        // Un perfil solo está "más arriba" si el turno que lo mandó terminó bien (si no, no entró al historial): se reenvía.
        const mensajes = await this.prisma.asistente_mensaje.findMany({ where: { conversacionId }, orderBy: { id: 'asc' }, select: { id: true, rol: true, estado: true } });
        const enviados = new Set<number>();
        for (let i = 0; i < mensajes.length - 1; i++) {
            const a = mensajes[i + 1];
            if (mensajes[i].rol === 'usuario' && a.rol === 'asistente' && (a.estado === 'ok' || a.estado === 'cortado')) enviados.add(mensajes[i].id);
        }
        const nuevos = filas.filter((f) => f.mensajeId === mensajeUsuarioId || (f.mensajeId !== null && !enviados.has(f.mensajeId))).map(aEjemplo);
        // El principal (§9.5) es el primero de la conversación. Un adjunto posterior no lo reemplaza: si la persona pide otro
        // formato, el runner elige el que el mapeo usa.
        return { ejemplos, nuevos, principalId: filas[0]?.id ?? null };
    }

    /** Para `detalle` de la conversación: los chips de cada mensaje de la persona. */
    async chipsDeConversacion(conversacionId: number): Promise<Map<number, { id: number; nombre: string; tipo: string; columnas: number }[]>> {
        const filas = await this.prisma.asistente_adjunto.findMany({ where: { conversacionId } , orderBy: { id: 'asc' } });
        const out = new Map<number, { id: number; nombre: string; tipo: string; columnas: number }[]>();
        for (const f of filas) {
            if (f.mensajeId === null) continue;
            const resumen = resumenDePerfil(f.perfil as unknown as PerfilEjemplo);
            const lista = out.get(f.mensajeId) ?? [];
            lista.push({ id: f.id, nombre: f.nombre, tipo: f.tipo, columnas: resumen.columnas });
            out.set(f.mensajeId, lista);
        }
        return out;
    }
}

