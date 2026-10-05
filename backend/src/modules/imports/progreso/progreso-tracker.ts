// Único escritor del estado de una carga durante el job (docs/imports-progreso-realtime-spec.md §8.5.1).
// Clase común, no un provider de Nest: `processImportJob` la instancia con lo que `ImportService` ya
// tiene inyectado, así que el constructor de `ImportService` no cambia.
import { Logger } from '@nestjs/common';
import type { import_progreso, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { RealtimeService } from '../../realtime/realtime.service';
import {
    armarEstadoCarga,
    calcularPorcentaje,
    clasificarResultado,
    motivoLegible,
    recortarMotivo,
} from './estado-carga';
import type { EstadoCargaDto, ResultadoCarga } from './estado-carga.types';

/** Lo que no cambia durante el job. */
export interface CargaInfo {
    remesaId: number;
    numeroRemesa: string;
    nombre: string;
    empresaId: number;
    tipo: string;
    usuarioId: number | null;
    /** 'Sistema' si no hay dueño. */
    usuarioNombre: string;
    /** `remesa.totalFilas` al cargar la remesa: el total de la vista previa. */
    totalFilasVistaPrevia: number;
}

export interface TrackerDeps {
    prisma: PrismaService;
    realtime: RealtimeService;
    logger: Logger;
}

export interface ContadoresCarga {
    ok: number;
    err: number;
    descartadas: number;
}

/** Espejo en memoria de lo último que se persistió. */
interface Memoria {
    rev: number;
    estadoProceso: 'PROCESANDO' | 'FINALIZADA' | 'FALLIDA';
    fase: string;
    porcentaje: number;
    totalEsperado: number;
    procesadas: number;
    ok: number;
    err: number;
    descartadas: number;
    advertencias: number;
    resultado: ResultadoCarga | null;
    error: string | null;
    errorPostProceso: string | null;
    intentos: number;
    jobId: string | null;
    encoladaAt: Date | null;
    startedAt: Date | null;
    heartbeatAt: Date | null;
    finishedAt: Date | null;
}

export class ProgresoTracker {
    private readonly prisma: PrismaService;
    private readonly realtime: RealtimeService;
    private readonly logger: Logger;
    private mem: Memoria;
    private terminado = false;
    private sinRegistrar = false;
    /** La fila previa ya tenía `startedAt`: BullMQ está re-ejecutando la carga. */
    private readonly reejecucion: boolean;

    constructor(
        deps: TrackerDeps,
        private readonly info: CargaInfo,
        previa: import_progreso | null,
    ) {
        this.prisma = deps.prisma;
        this.realtime = deps.realtime;
        this.logger = deps.logger;
        this.mem = {
            rev: previa?.rev ?? 0,
            estadoProceso: 'PROCESANDO',
            fase: previa?.fase ?? 'BORRADOR',
            porcentaje: 0,
            totalEsperado: previa?.totalEsperado && previa.totalEsperado > 0 ? previa.totalEsperado : info.totalFilasVistaPrevia,
            procesadas: 0,
            ok: 0,
            err: 0,
            descartadas: 0,
            advertencias: 0,
            resultado: null,
            error: null,
            errorPostProceso: null,
            intentos: previa?.intentos ?? 0,
            jobId: previa?.jobId ?? null,
            encoladaAt: previa?.encoladaAt ?? null,
            startedAt: previa?.startedAt ?? null,
            heartbeatAt: previa?.heartbeatAt ?? null,
            finishedAt: null,
        };
        // `iniciar` pisa el resto: la fila previa solo aporta `rev`, `intentos`, `encoladaAt` y `totalEsperado`.
        this.reejecucion = previa?.startedAt != null;
    }

    /** `fallar()` no pudo escribir el estado terminal: la base todavía dice PROCESANDO. */
    get noSePudoRegistrar(): boolean {
        return this.sinRegistrar;
    }

    /** Lo último que se persistió, armado con el mismo código que usan las lecturas HTTP. */
    get estado(): EstadoCargaDto {
        return this.armar(this.mem);
    }

    private armar(m: Memoria): EstadoCargaDto {
        const i = this.info;
        return armarEstadoCarga(
            {
                id: i.remesaId,
                numeroRemesa: i.numeroRemesa,
                nombre: i.nombre,
                empresaId: i.empresaId,
                categoria: i.tipo,
                usuarioCreadorId: i.usuarioId,
                usuarioCreador: i.usuarioId != null ? { id: i.usuarioId, nombre: i.usuarioNombre } : null,
                estadoProceso: m.estadoProceso,
                totalFilas: m.estadoProceso === 'FINALIZADA' ? m.procesadas : m.totalEsperado,
                okFilas: m.ok,
                errFilas: m.err,
            },
            {
                remesaId: i.remesaId,
                rev: m.rev,
                fase: m.fase,
                subfase: null,
                porcentaje: m.porcentaje,
                totalEsperado: m.totalEsperado,
                procesadas: m.procesadas,
                ok: m.ok,
                err: m.err,
                descartadas: m.descartadas,
                advertencias: m.advertencias,
                nuevos: null,
                actualizados: null,
                resultado: m.resultado,
                error: m.error,
                errorPostProceso: m.errorPostProceso,
                resumen: null,
                intentos: m.intentos,
                jobId: m.jobId,
                grupoId: null,
                grupoOrden: null,
                grupoTotal: null,
                cancelSolicitadaAt: null,
                encoladaAt: m.encoladaAt,
                startedAt: m.startedAt,
                heartbeatAt: m.heartbeatAt,
                finishedAt: m.finishedAt,
            },
        );
    }

    /** El worker tomó el job. Una vez por intento; va ANTES de cualquier validación. */
    async iniciar(jobId: string | undefined): Promise<void> {
        const ahora = new Date();
        const intentos = this.mem.intentos + 1;
        if (intentos > 1 || this.reejecucion) {
            this.logger.warn(
                `Re-ejecución de la remesa ${this.info.remesaId} (intento ${intentos}): el progreso se reinicia`,
            );
        }
        const siguiente: Memoria = {
            ...this.mem,
            estadoProceso: 'PROCESANDO',
            fase: 'PROCESANDO',
            porcentaje: 0,
            procesadas: 0,
            ok: 0,
            err: 0,
            descartadas: 0,
            advertencias: 0,
            resultado: null,
            error: null,
            errorPostProceso: null,
            intentos,
            jobId: jobId ? String(jobId).slice(0, 64) : null,
            // Solo si estaba en null: el job lo encoló `executeRemesa`; uno del código viejo no tiene fecha.
            encoladaAt: this.mem.encoladaAt ?? ahora,
            startedAt: ahora,
            heartbeatAt: ahora,
            finishedAt: null,
        };
        siguiente.rev = await this.persistir(
            { estadoProceso: 'PROCESANDO', okFilas: 0, errFilas: 0 },
            siguiente,
        );
        this.mem = siguiente;
        this.emitir('emitImportIniciada');
    }

    fijarTotalEsperado(n: number): void {
        this.mem.totalEsperado = Math.max(0, Math.floor(n));
    }

    sumarAdvertencias(n: number): void {
        this.mem.advertencias += Math.max(0, Math.floor(n));
    }

    /** Un lote ya procesado. Deja pasar el error de la base: sin poder escribir el progreso no hay
     *  forma de escribir las filas, y es mejor fallar acá que seguir a ciegas. */
    async lote(c: ContadoresCarga): Promise<void> {
        const procesadas = c.ok + c.err;
        const siguiente: Memoria = {
            ...this.mem,
            fase: 'PROCESANDO',
            procesadas,
            ok: c.ok,
            err: c.err,
            descartadas: c.descartadas,
            porcentaje: calcularPorcentaje(procesadas, this.mem.totalEsperado),
            heartbeatAt: new Date(),
        };
        // `totalFilas` NO se toca acá: el acumulado pisaba el total de la vista previa (#9).
        siguiente.rev = await this.persistir({ okFilas: c.ok, errFilas: c.err }, siguiente);
        this.mem = siguiente;
        this.emitir('emitImportProgreso');
    }

    async entrarEnPostProceso(): Promise<void> {
        const siguiente: Memoria = { ...this.mem, fase: 'POST_PROCESO', heartbeatAt: new Date() };
        siguiente.rev = await this.persistir({}, siguiente);
        this.mem = siguiente;
        this.emitir('emitImportProgreso');
    }

    /** Terminaron las filas (y el post-proceso, si lo hay). Idempotente. Si la base falla, tira. */
    async finalizar(c: ContadoresCarga & { errorPostProceso: string | null }): Promise<EstadoCargaDto> {
        if (this.terminado) {
            this.logger.warn(`finalizar() sobre la remesa ${this.info.remesaId}, que ya terminó: se ignora`);
            return this.estado;
        }
        const ahora = new Date();
        const procesadas = c.ok + c.err;
        const resultado = clasificarResultado({
            huboExcepcion: false,
            postProcesoFallo: c.errorPostProceso != null,
            procesadas,
            err: c.err,
        });
        const siguiente: Memoria = {
            ...this.mem,
            estadoProceso: 'FINALIZADA',
            fase: 'TERMINADA',
            porcentaje: 100,
            procesadas,
            ok: c.ok,
            err: c.err,
            descartadas: c.descartadas,
            resultado,
            errorPostProceso: c.errorPostProceso != null ? recortarMotivo(c.errorPostProceso) : null,
            heartbeatAt: ahora,
            finishedAt: ahora,
        };
        siguiente.rev = await this.persistir(
            { estadoProceso: 'FINALIZADA', totalFilas: procesadas, okFilas: c.ok, errFilas: c.err },
            siguiente,
        );
        this.mem = siguiente;
        this.terminado = true;
        const estado = this.estado;
        this.emitir('emitImportFinalizada');
        return estado;
    }

    /**
     * La carga falló. Nunca tira: si no puede escribir, lo loguea con stack y NO emite (la carga queda
     * en PROCESANDO; es el caso que cubre el reaper de la Fase B). Devuelve igual el estado terminal
     * que correspondía, para que quien llama pueda notificar.
     */
    async fallar(error: unknown, c: ContadoresCarga): Promise<EstadoCargaDto> {
        if (this.terminado) {
            this.logger.error(
                `fallar() sobre la remesa ${this.info.remesaId}, que ya terminó: no se pisa el estado terminal ` +
                `(${error instanceof Error ? error.message : String(error)})`,
            );
            return this.estado;
        }
        const ahora = new Date();
        const procesadas = c.ok + c.err;
        const siguiente: Memoria = {
            ...this.mem,
            estadoProceso: 'FALLIDA',
            fase: 'TERMINADA',
            porcentaje: calcularPorcentaje(procesadas, this.mem.totalEsperado, 'FALLIDA'),
            procesadas,
            ok: c.ok,
            err: c.err,
            descartadas: c.descartadas,
            resultado: 'FALLIDA',
            error: motivoLegible(error),
            heartbeatAt: ahora,
            finishedAt: ahora,
        };
        try {
            siguiente.rev = await this.persistir(
                { estadoProceso: 'FALLIDA', okFilas: c.ok, errFilas: c.err },
                siguiente,
            );
        } catch (e: any) {
            this.logger.error(
                `No se pudo marcar la remesa ${this.info.remesaId} como FALLIDA: ${e?.message}. ` +
                'Queda en PROCESANDO y no se emite import:finalizada.',
                e?.stack,
            );
            this.sinRegistrar = true;
            return this.armar({ ...siguiente, rev: this.mem.rev });
        }
        this.mem = siguiente;
        this.terminado = true;
        const estado = this.estado;
        this.emitir('emitImportFinalizada');
        return estado;
    }

    /**
     * Un único `remesa.update` con la fila de progreso anidada: remesa y progreso cambian juntos o no
     * cambia ninguno. El `upsert` hace que ande igual si la fila no existe (job encolado por el
     * código viejo). `rev` se incrementa en la base. Devuelve el `rev` resultante.
     */
    private async persistir(remesaData: Prisma.remesaUpdateInput, m: Memoria): Promise<number> {
        const campos = {
            fase: m.fase,
            porcentaje: m.porcentaje,
            totalEsperado: m.totalEsperado,
            procesadas: m.procesadas,
            ok: m.ok,
            err: m.err,
            descartadas: m.descartadas,
            advertencias: m.advertencias,
            resultado: m.resultado,
            error: m.error,
            errorPostProceso: m.errorPostProceso,
            intentos: m.intentos,
            jobId: m.jobId,
            encoladaAt: m.encoladaAt,
            startedAt: m.startedAt,
            heartbeatAt: m.heartbeatAt,
            finishedAt: m.finishedAt,
        };
        const r = await this.prisma.remesa.update({
            where: { id: this.info.remesaId },
            data: {
                ...remesaData,
                progreso: {
                    upsert: {
                        create: { ...campos, rev: 1 },
                        update: { ...campos, rev: { increment: 1 } },
                    },
                },
            },
            select: { progreso: { select: { rev: true } } },
        });
        return r?.progreso?.rev ?? this.mem.rev + 1;
    }

    /** Persistir primero, emitir después; un fallo del socket es un `warn`, nunca una carga caída. */
    private emitir(metodo: 'emitImportIniciada' | 'emitImportProgreso' | 'emitImportFinalizada'): void {
        try {
            this.realtime[metodo](this.estado);
        } catch (e: any) {
            this.logger.warn(`Error emitiendo ${metodo} de la remesa ${this.info.remesaId}: ${e?.message}`);
        }
    }
}
