// reversion/reversion-acciones.service.ts
//
// Revertir una acción masiva como job (docs/imports-progreso-c3-spec.md §17.5.3 a §17.5.7).
//
//  - `solicitar`  : el POST. Decide con la fila de la remesa bloqueada y deja la reversión EN_COLA.
//  - `ejecutar`   : el job. Deshace los snapshots pendientes por tandas, cada una en una transacción que también los marca
//                   (`revertidoEn`): lo hecho no se repite, y un corte deja todo retomable.
//  - `obtener`    : el GET, con la cobertura que el operador ve antes de confirmar.
//  - `revisarReversionesColgadas`: el cron que pasa a INTERRUMPIDA lo que un reinicio dejó a medias.
import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
    ServiceUnavailableException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';
import { PrismaService } from 'src/prisma/prisma.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { NotificacionesService } from '../../notificaciones/notificaciones.service';
import { AuditoriaHelper } from '../../transacciones/auditoria.helper';
import { RequestContextService } from 'src/common/logger/request-context';
import { leerResumen } from '../progreso/estado-carga';
import type {
    CoberturaReversion,
    CodigoNoRevertible,
    ReversionAccionDto,
    ReversionResumenDto,
} from './reversion-accion.types';
import {
    aReversionResumenDto,
    COLA_REVERSION,
    evaluarReversion,
    FilaReversion,
    motivoLegibleDeFalla,
    TEXTO_EN_SEGUNDO_PLANO,
    TEXTO_NO_ENCOLADA,
    TEXTOS_NO_REVERTIBLE,
    textoReversionFallida,
} from './reversion-accion.reglas';

/** Snapshots que se deshacen por transacción. */
const TAMANO_TANDA = 200;
const TX_TANDA = { maxWait: 10_000, timeout: 60_000 };
const TX_CORTA = { maxWait: 10_000, timeout: 30_000 };
const TX_SOLICITUD = { maxWait: 10_000, timeout: 30_000 };
/** Mínimo entre dos eventos de progreso. */
const ENTRE_PROGRESOS_MS = 1000;
/** Sin latido (REVIRTIENDO) o sin job (EN_COLA) por más de esto, el cron la da por interrumpida. */
const UMBRAL_COLGADA_MS = 3 * 60_000;
/** Cuánto espera el endpoint de compatibilidad (C3a) a que termine una reversión chica. */
const ESPERA_COMPAT_MS = 20_000;
const ENTRE_LECTURAS_COMPAT_MS = 500;

/** Otra reversión de la misma remesa toca los mismos snapshots, o la fila ya la cerró el cron: la tanda no se aplica. */
export class ReversionConcurrenteError extends Error {
    constructor(detalle: string) {
        super(`Otra reversión de esta acción está corriendo, o esta ya se cerró: ${detalle}`);
        this.name = 'ReversionConcurrenteError';
    }
}

interface FilaSolicitud {
    id: number | bigint;
    empresaId: number | bigint;
    categoria: string | null;
    estadoProceso: string;
    accionRevertidaEn: Date | null;
    accionSnapshotsPorCaso: number | bigint | boolean;
    progresoId: number | bigint | null;
    encoladaAt: Date | null;
    finishedAt: Date | null;
    errorPostProceso: string | null;
    procesadas: number | bigint | null;
    estadoReversion: string | null;
    intentos: number | bigint | null;
}

export interface ResultadoSolicitud {
    dto: ReversionAccionDto;
    /** true = ya estaba revertida: el POST responde 200 y no encola nada. */
    yaEstaba: boolean;
}

/** Lo que devolvía el endpoint de C3a. */
export interface ResultadoCompat {
    yaRevertida: boolean;
    deudoresRevertidos: number;
    contactosRestaurados: number;
    comentariosBorrados: number;
}

@Injectable()
export class ReversionAccionesService {
    private readonly logger = new Logger(ReversionAccionesService.name);

    /** Pausa entre lecturas del endpoint de compatibilidad. Pública para que los tests no esperen de verdad. */
    esperar: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));
    /** Reloj en milisegundos. Público para que los tests lo inyecten. */
    ahora: () => number = Date.now;

    constructor(
        private readonly prisma: PrismaService,
        @InjectQueue(COLA_REVERSION) private readonly cola: Queue,
        private readonly realtime: RealtimeService,
        private readonly notificaciones: NotificacionesService,
        private readonly auditoria: AuditoriaHelper,
        private readonly requestContext: RequestContextService,
    ) {}

    private conflicto(code: CodigoNoRevertible | 'REVERSION_FALLIDA', message: string): ConflictException {
        return new ConflictException({ statusCode: 409, error: 'Conflict', message, code });
    }

    // ── El GET ───────────────────────────────────────────────────────────────────────────────

    /** Lo que se puede revertir y cuánto cubre, sin tocar nada. */
    async obtener(remesaId: number): Promise<ReversionAccionDto> {
        const remesa = await this.prisma.remesa.findUnique({
            where: { id: remesaId },
            include: {
                progreso: { select: { encoladaAt: true, finishedAt: true, errorPostProceso: true, procesadas: true, totalEsperado: true, resumen: true } },
                reversion: true,
            },
        });
        if (!remesa) throw new NotFoundException('Remesa no existe');
        if (remesa.categoria !== 'ACCIONES') throw new BadRequestException('La remesa no es de acciones masivas');
        return this.armarDto(remesa);
    }

    private async armarDto(remesa: {
        id: number;
        empresaId: number;
        estadoProceso: string;
        accionRevertidaEn: Date | null;
        accionSnapshotsPorCaso: boolean;
        progreso: {
            encoladaAt: Date | null; finishedAt: Date | null; errorPostProceso: string | null;
            procesadas: number; totalEsperado: number | null; resumen: Prisma.JsonValue | null;
        } | null;
        reversion: FilaReversion | null;
    }): Promise<ReversionAccionDto> {
        const remesaId = remesa.id;
        const [porTipo, yaRevertidos, casos] = await Promise.all([
            this.prisma.accion_masiva_snapshot.groupBy({
                by: ['entidad'],
                where: { remesaId, revertidoEn: null },
                _count: { _all: true },
            }),
            this.prisma.accion_masiva_snapshot.count({ where: { remesaId, revertidoEn: { not: null } } }),
            this.contarCasos(remesaId),
        ]);
        const cuenta = (entidad: string) => porTipo.find((g) => g.entidad === entidad)?._count._all ?? 0;
        const pendientes = porTipo.reduce((s, g) => s + g._count._all, 0);

        const code = evaluarReversion({
            remesa,
            progreso: remesa.progreso,
            reversion: remesa.reversion,
            pendientes,
            yaRevertidos,
        });

        const informado = leerResumen(remesa.progreso?.resumen)?.categoria;
        const casosAfectadosInformados =
            informado && informado.tipo === 'ACCIONES' && typeof informado.deudoresAfectados === 'number'
                ? informado.deudoresAfectados
                : null;

        // Una revertida antes de C3b no marcaba `revertidoEn`: sus snapshots figuran pendientes, pero ya se deshicieron.
        const yaRevertida = code === 'YA_REVERTIDA';
        const cobertura: CoberturaReversion = {
            exacta: remesa.accionSnapshotsPorCaso || (remesa.estadoProceso === 'FINALIZADA' && remesa.progreso?.errorPostProceso == null),
            casos: yaRevertida ? 0 : casos,
            cambiosDeCaso: yaRevertida ? 0 : cuenta('deudor'),
            contactos: yaRevertida ? 0 : cuenta('contacto'),
            comentarios: yaRevertida ? 0 : cuenta('comentario'),
            yaRevertidos: yaRevertida ? yaRevertidos + pendientes : yaRevertidos,
            casosAfectadosInformados,
            cargaCortada: remesa.estadoProceso === 'FALLIDA',
            filasProcesadas: remesa.progreso ? remesa.progreso.procesadas : null,
            totalFilas: remesa.progreso?.totalEsperado ?? null,
        };

        return {
            remesaId,
            revertible: code == null,
            motivo: code ? { code, texto: TEXTOS_NO_REVERTIBLE[code] } : null,
            cobertura,
            reversion: remesa.reversion ? aReversionResumenDto(remesa.reversion, remesa.empresaId) : null,
            accionRevertidaEn: remesa.accionRevertidaEn ? remesa.accionRevertidaEn.toISOString() : null,
        };
    }

    /** Casos distintos con algo pendiente. Entiende los snapshots anteriores a C3b, que no tienen `deudorId`. */
    private async contarCasos(remesaId: number): Promise<number> {
        const filas = await this.prisma.$queryRaw<Array<{ casos: number | bigint }>>`
            SELECT COUNT(DISTINCT COALESCE(s.deudorId,
                     CASE s.entidad WHEN 'deudor' THEN s.entidadId
                                    WHEN 'contacto' THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(s.datosPrevios, '$.deudorId')) AS UNSIGNED)
                                    WHEN 'comentario' THEN c.deudorId END)) AS casos
            FROM accion_masiva_snapshot s
            LEFT JOIN comentario c ON s.entidad = 'comentario' AND c.id = s.entidadId
            WHERE s.remesaId = ${remesaId} AND s.revertidoEn IS NULL
        `;
        return Number(filas[0]?.casos ?? 0);
    }

    // ── El POST ──────────────────────────────────────────────────────────────────────────────

    async solicitar(remesaId: number, usuarioId?: number): Promise<ResultadoSolicitud> {
        const t0 = Date.now();
        this.logger.log(`Revertir acción masiva: remesa=${remesaId} usuario=${usuarioId ?? 'sistema'}`);

        const decision = await this.prisma.$transaction(async (tx) => {
            // La fila de la remesa bloqueada es la exclusión mutua: dos clics, un reintento tras un 504 o dos instancias
            // se serializan acá y el segundo ve la reversión ya EN_COLA.
            const filas = await tx.$queryRaw<FilaSolicitud[]>`
                SELECT r.id AS id, r.empresaId AS empresaId, r.categoria AS categoria, r.estadoProceso AS estadoProceso,
                       r.accionRevertidaEn AS accionRevertidaEn, r.accionSnapshotsPorCaso AS accionSnapshotsPorCaso,
                       p.remesaId AS progresoId, p.encoladaAt AS encoladaAt, p.finishedAt AS finishedAt, p.errorPostProceso AS errorPostProceso,
                       p.procesadas AS procesadas,
                       v.estado AS estadoReversion, v.intentos AS intentos
                FROM remesa r
                LEFT JOIN import_progreso p ON p.remesaId = r.id
                LEFT JOIN reversion_accion v ON v.remesaId = r.id
                WHERE r.id = ${remesaId}
                FOR UPDATE OF r
            `;
            const r = filas[0];
            if (!r) throw new NotFoundException('Remesa no existe');
            if (r.categoria !== 'ACCIONES') throw new BadRequestException('La remesa no es de acciones masivas');

            const [pendientes, yaRevertidos] = await Promise.all([
                tx.accion_masiva_snapshot.count({ where: { remesaId, revertidoEn: null } }),
                tx.accion_masiva_snapshot.count({ where: { remesaId, revertidoEn: { not: null } } }),
            ]);
            const code = evaluarReversion({
                remesa: {
                    accionRevertidaEn: r.accionRevertidaEn,
                    accionSnapshotsPorCaso: Boolean(Number(r.accionSnapshotsPorCaso)),
                    estadoProceso: r.estadoProceso,
                },
                progreso:
                    r.progresoId != null
                        ? { encoladaAt: r.encoladaAt, finishedAt: r.finishedAt, errorPostProceso: r.errorPostProceso, procesadas: r.procesadas == null ? null : Number(r.procesadas) }
                        : null,
                reversion: r.estadoReversion ? { estado: r.estadoReversion } : null,
                pendientes,
                yaRevertidos,
            });
            if (code === 'YA_REVERTIDA') return { yaEstaba: true as const, empresaId: Number(r.empresaId) };
            if (code) {
                this.logger.warn(`Revertir remesa=${remesaId}: rechazado (${code})`);
                throw this.conflicto(code, TEXTOS_NO_REVERTIBLE[code]);
            }

            const intentos = Number(r.intentos ?? 0) + 1;
            const jobId = `revertir-${remesaId}-${intentos}`;
            const ahora = new Date(this.ahora());
            // `hechos` y los contadores NO se ponen en cero: un nuevo intento sigue sumando sobre lo ya deshecho.
            const fila = await tx.reversion_accion.upsert({
                where: { remesaId },
                create: { remesaId, estado: 'EN_COLA', usuarioId: usuarioId ?? null, jobId, intentos, encoladaAt: ahora },
                update: {
                    estado: 'EN_COLA', usuarioId: usuarioId ?? null, jobId, intentos,
                    error: null, encoladaAt: ahora, finishedAt: null, heartbeatAt: null,
                },
            });
            return { yaEstaba: false as const, empresaId: Number(r.empresaId), fila, jobId };
        }, TX_SOLICITUD);

        if (decision.yaEstaba) {
            const dto = await this.obtener(remesaId);
            // Una acción revertida con C3a no tiene fila de reversión: para el POST se muestra como terminada igual.
            const reversion: ReversionResumenDto = dto.reversion ?? {
                remesaId, empresaId: decision.empresaId, estado: 'TERMINADA', total: 0, hechos: 0, porcentaje: 100,
                deudoresRevertidos: 0, contactosRestaurados: 0, comentariosBorrados: 0, casosQueNoExistian: 0,
                contactosSinCaso: 0, usuarioId: null, error: null,
                encoladaAt: dto.accionRevertidaEn ?? new Date(this.ahora()).toISOString(),
                startedAt: null, finishedAt: dto.accionRevertidaEn,
            };
            this.logger.log(`Revertir remesa=${remesaId}: ya estaba revertida`);
            return { dto: { ...dto, reversion }, yaEstaba: true };
        }

        const { fila, jobId } = decision;
        try {
            await this.cola.add(
                'revertir',
                { remesaId, usuarioId: usuarioId ?? null, _ctx: this.contextoDelPedido() },
                { jobId, removeOnComplete: 100, removeOnFail: 100 },
            );
        } catch (e: any) {
            this.logger.error(`Revertir remesa=${remesaId}: no se pudo encolar el job ${jobId}: ${e?.message}`, e?.stack);
            await this.prisma.reversion_accion.updateMany({
                where: { remesaId, estado: 'EN_COLA', jobId },
                data: { estado: 'FALLIDA', error: 'No se pudo encolar la reversión', finishedAt: new Date(this.ahora()) },
            }).catch((err: any) => this.logger.warn(`Revertir remesa=${remesaId}: no se pudo marcar la reversión como fallida: ${err?.message}`));
            throw new ServiceUnavailableException({
                statusCode: 503, error: 'Service Unavailable', message: TEXTO_NO_ENCOLADA, code: 'REVERSION_NO_ENCOLADA',
            });
        }

        this.emitirProgreso(aReversionResumenDto(fila, decision.empresaId));
        this.logger.log(`Revertir remesa=${remesaId}: encolada (job ${jobId}, intento ${fila.intentos}) en ${Date.now() - t0}ms`);
        return { dto: await this.obtener(remesaId), yaEstaba: false };
    }

    /** El `requestId` del pedido viaja en el job, como en los demás workers. */
    private contextoDelPedido(): { requestId: string; usuarioId?: number } | undefined {
        const ctx = this.requestContext.get();
        return ctx ? { requestId: ctx.requestId, usuarioId: ctx.usuarioId } : undefined;
    }

    // ── Compatibilidad con el frontend de C3a ────────────────────────────────────────────────

    /**
     * El endpoint de C3a (`POST /import/remesas/:id/revertir-acciones`): pide lo mismo que el nuevo y espera hasta 20 s
     * a que termine, para responder con la forma de siempre. Si no alcanza, 409 con «sigue en segundo plano».
     * @deprecated Se borra cuando no quede ningún frontend de C3a en uso.
     */
    async revertirCompat(remesaId: number, usuarioId?: number): Promise<ResultadoCompat> {
        const sol = await this.solicitar(remesaId, usuarioId);
        if (sol.yaEstaba) {
            return { yaRevertida: true, deudoresRevertidos: 0, contactosRestaurados: 0, comentariosBorrados: 0 };
        }
        const limite = this.ahora() + ESPERA_COMPAT_MS;
        for (;;) {
            const fila = await this.prisma.reversion_accion.findUnique({ where: { remesaId } });
            if (fila?.estado === 'TERMINADA') {
                return {
                    yaRevertida: false,
                    deudoresRevertidos: fila.deudoresRevertidos,
                    contactosRestaurados: fila.contactosRestaurados,
                    comentariosBorrados: fila.comentariosBorrados,
                };
            }
            if (fila?.estado === 'FALLIDA' || fila?.estado === 'INTERRUMPIDA') {
                throw this.conflicto('REVERSION_FALLIDA', textoReversionFallida(fila.error));
            }
            if (this.ahora() >= limite) {
                throw this.conflicto('REVERSION_EN_CURSO', TEXTO_EN_SEGUNDO_PLANO);
            }
            await this.esperar(ENTRE_LECTURAS_COMPAT_MS);
        }
    }

    // ── El job ───────────────────────────────────────────────────────────────────────────────

    async ejecutar(remesaId: number, jobId: string): Promise<void> {
        const t0 = Date.now();
        this.logger.log(`Revertir remesa=${remesaId}: arranca el job ${jobId}`);

        const reclamo = await this.prisma.reversion_accion.updateMany({
            where: { remesaId, estado: 'EN_COLA', jobId },
            data: { estado: 'REVIRTIENDO', heartbeatAt: new Date(this.ahora()) },
        });
        if (reclamo.count === 0) {
            // Lo cerró el cron o es un job viejo: no hay nada que hacer.
            this.logger.warn(`Revertir remesa=${remesaId}: la reversión ya no estaba en cola para el job ${jobId}, no se hace nada`);
            return;
        }

        let empresaId = 0;
        let usuarioId: number | null = null;
        let ultimoProgreso = 0;
        try {
            const remesa = await this.prisma.remesa.findUnique({ where: { id: remesaId }, select: { empresaId: true } });
            if (!remesa) throw new NotFoundException('Remesa no existe');
            empresaId = remesa.empresaId;

            // `startedAt` se conserva entre intentos; el `total` es lo ya deshecho más lo que falta ahora.
            const [pendientes, previa] = await Promise.all([
                this.prisma.accion_masiva_snapshot.count({ where: { remesaId, revertidoEn: null } }),
                this.prisma.reversion_accion.findUniqueOrThrow({ where: { remesaId } }),
            ]);
            usuarioId = previa.usuarioId;
            await this.prisma.reversion_accion.update({
                where: { remesaId },
                data: { total: previa.hechos + pendientes, startedAt: previa.startedAt ?? new Date(this.ahora()), heartbeatAt: new Date(this.ahora()) },
            });

            let cursor: bigint | null = null;
            for (;;) {
                const tanda: Array<{ id: bigint; entidad: string; entidadId: number; accion: string; datosPrevios: Prisma.JsonValue }> =
                    await this.prisma.accion_masiva_snapshot.findMany({
                        where: { remesaId, revertidoEn: null, ...(cursor != null ? { id: { lt: cursor } } : {}) },
                        orderBy: { id: 'desc' },
                        take: TAMANO_TANDA,
                        select: { id: true, entidad: true, entidadId: true, accion: true, datosPrevios: true },
                    });
                if (tanda.length === 0) break;

                const fila: FilaReversion = await this.deshacerTanda(remesaId, jobId, tanda);
                cursor = tanda[tanda.length - 1].id;

                if (this.ahora() - ultimoProgreso >= ENTRE_PROGRESOS_MS) {
                    ultimoProgreso = this.ahora();
                    this.emitirProgreso(aReversionResumenDto(fila, empresaId));
                }
            }

            const cierre = await this.prisma.$transaction(async (tx) => {
                const ahora = new Date(this.ahora());
                const act = await tx.reversion_accion.updateMany({
                    where: { remesaId, estado: 'REVIRTIENDO', jobId },
                    data: { estado: 'TERMINADA', finishedAt: ahora, heartbeatAt: ahora, error: null },
                });
                if (act.count === 0) throw new ReversionConcurrenteError('la fila ya no estaba REVIRTIENDO al cerrar');
                // Condicional: si otro la marcó antes, no se pisa quién la revirtió.
                await tx.remesa.updateMany({
                    where: { id: remesaId, accionRevertidaEn: null },
                    data: { accionRevertidaEn: ahora, accionRevertidaPorId: usuarioId },
                });
                return tx.reversion_accion.findUniqueOrThrow({ where: { remesaId } });
            }, TX_CORTA);

            await this.anunciarCierre(cierre, empresaId, true);
            this.logger.log(
                `Revertir remesa=${remesaId}: ${cierre.deudoresRevertidos} casos revertidos` +
                (cierre.casosQueNoExistian > 0 ? ` (${cierre.casosQueNoExistian} ya no existían)` : '') +
                `, ${cierre.contactosRestaurados} contactos restaurados` +
                (cierre.contactosSinCaso > 0 ? ` (${cierre.contactosSinCaso} sin caso)` : '') +
                `, ${cierre.comentariosBorrados} comentarios borrados, ${cierre.hechos} de ${cierre.total} snapshots en ${Date.now() - t0}ms`,
            );
        } catch (e: any) {
            const motivo = motivoLegibleDeFalla(e);
            this.logger.error(`Revertir remesa=${remesaId}: falló tras ${Date.now() - t0}ms: ${motivo}`, e?.stack);
            await this.cerrarComoFallida(remesaId, jobId, motivo, empresaId);
            throw e;
        }
    }

    /** Una tanda en UNA transacción: marca los snapshots y deshace sus cambios, o no hace nada. */
    private async deshacerTanda(
        remesaId: number,
        jobId: string,
        tanda: Array<{ id: bigint; entidad: string; entidadId: number; accion: string; datosPrevios: Prisma.JsonValue }>,
    ): Promise<FilaReversion> {
        return this.prisma.$transaction(async (tx) => {
            const ahora = new Date(this.ahora());
            // Toma los locks de esas filas. Si otra reversión de la misma remesa las marcó antes, `count` no cierra.
            const marcados = await tx.accion_masiva_snapshot.updateMany({
                where: { id: { in: tanda.map((s) => s.id) }, remesaId, revertidoEn: null },
                data: { revertidoEn: ahora },
            });
            if (marcados.count !== tanda.length) {
                throw new ReversionConcurrenteError(`se marcaron ${marcados.count} de ${tanda.length} snapshots de la tanda`);
            }

            let deudoresRevertidos = 0;
            let casosQueNoExistian = 0;
            const contactosAcrear: Array<{ deudorId: number; tipo: string; valor: string; subtipo: string | null; prioridad: number | null; validado: boolean; whatsapp: boolean | undefined; relacion: string | null }> = [];
            const comentariosABorrar: number[] = [];

            // Ya viene por `id` descendente: si un caso tiene dos cambios, se deshace primero el último.
            for (const s of tanda) {
                const dp = (s.datosPrevios ?? {}) as Record<string, any>;
                if (s.entidad === 'deudor' && s.accion === 'UPDATE') {
                    const r = await tx.deudor.updateMany({ where: { id: s.entidadId }, data: this.datosDelDeudor(dp) });
                    if (r.count === 0) casosQueNoExistian++;
                    else deudoresRevertidos++;
                } else if (s.entidad === 'contacto' && s.accion === 'DELETE') {
                    contactosAcrear.push({
                        deudorId: dp.deudorId, tipo: dp.tipo, valor: dp.valor,
                        // Como estaba: `prioridad` null vuelve null (antes volvía 0) y `relacion` (el teléfono de un codeudor)
                        // se respeta. Los snapshots anteriores a que se guardara `relacion` vuelven como del titular.
                        subtipo: dp.subtipo ?? null, prioridad: dp.prioridad ?? null,
                        validado: dp.validado ?? false, whatsapp: dp.whatsapp ?? undefined, relacion: dp.relacion ?? null,
                    });
                } else if (s.entidad === 'comentario' && s.accion === 'INSERT') {
                    comentariosABorrar.push(s.entidadId);
                }
            }

            // Un contacto de un caso que ya no existe no se puede restaurar (la FK lo rechazaría): se cuenta y se informa.
            let contactosSinCaso = 0;
            let contactosRestaurados = 0;
            if (contactosAcrear.length) {
                const ids = [...new Set(contactosAcrear.map((c) => c.deudorId))];
                const vivos = new Set((await tx.deudor.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((d) => d.id));
                const restaurables = contactosAcrear.filter((c) => vivos.has(c.deudorId));
                contactosSinCaso = contactosAcrear.length - restaurables.length;
                if (restaurables.length) {
                    // unique (deudorId, tipo, valor): un reintento no duplica.
                    const r = await tx.contacto.createMany({ data: restaurables, skipDuplicates: true });
                    contactosRestaurados = r.count;
                }
            }
            let comentariosBorrados = 0;
            if (comentariosABorrar.length) {
                const r = await tx.comentario.deleteMany({ where: { id: { in: comentariosABorrar } } });
                comentariosBorrados = r.count;
            }

            // Condicionada al estado: si el cron la pasó a INTERRUMPIDA, esta tanda no se aplica.
            const act = await tx.reversion_accion.updateMany({
                where: { remesaId, estado: 'REVIRTIENDO', jobId },
                data: {
                    hechos: { increment: tanda.length },
                    deudoresRevertidos: { increment: deudoresRevertidos },
                    contactosRestaurados: { increment: contactosRestaurados },
                    comentariosBorrados: { increment: comentariosBorrados },
                    casosQueNoExistian: { increment: casosQueNoExistian },
                    contactosSinCaso: { increment: contactosSinCaso },
                    heartbeatAt: ahora,
                },
            });
            if (act.count === 0) throw new ReversionConcurrenteError('la fila ya no estaba REVIRTIENDO');
            return tx.reversion_accion.findUniqueOrThrow({ where: { remesaId } });
        }, TX_TANDA);
    }

    private datosDelDeudor(dp: Record<string, any>): Prisma.deudorUncheckedUpdateManyInput {
        const data: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(dp)) {
            if (k === 'fechaVencimiento') data[k] = v ? new Date(v) : null;
            else if (k === 'camposAdicionales') data[k] = v == null ? Prisma.JsonNull : v;
            else data[k] = v;
        }
        return data as Prisma.deudorUncheckedUpdateManyInput;
    }

    /** La falla del job: FALLIDA con el motivo, solo si la fila seguía siendo de este job. */
    private async cerrarComoFallida(remesaId: number, jobId: string, motivo: string, empresaId: number): Promise<void> {
        try {
            const r = await this.prisma.reversion_accion.updateMany({
                where: { remesaId, estado: 'REVIRTIENDO', jobId },
                data: { estado: 'FALLIDA', error: motivo, finishedAt: new Date(this.ahora()) },
            });
            if (r.count === 0) {
                this.logger.warn(`Revertir remesa=${remesaId}: la fila ya estaba cerrada, no se pisa`);
                return;
            }
            const fila = await this.prisma.reversion_accion.findUnique({ where: { remesaId } });
            if (fila) await this.anunciarCierre(fila, empresaId || (await this.empresaDe(remesaId)), false);
        } catch (err: any) {
            this.logger.warn(`Revertir remesa=${remesaId}: no se pudo marcar la reversión como fallida: ${err?.message}`);
        }
    }

    private async empresaDe(remesaId: number): Promise<number> {
        const r = await this.prisma.remesa.findUnique({ where: { id: remesaId }, select: { empresaId: true } });
        return r?.empresaId ?? 0;
    }

    // ── El cierre: auditoría, campanita y socket (nada de esto puede tumbar lo ya escrito) ──

    private async anunciarCierre(fila: FilaReversion, empresaId: number, auditar: boolean): Promise<void> {
        const dto = aReversionResumenDto(fila, empresaId);
        const remesaId = fila.remesaId;
        if (auditar && fila.estado === 'TERMINADA') {
            await this.auditoria.log({
                modulo: 'IMPORT', entidad: 'acciones_masivas', tipo: 'DELETE',
                usuarioId: fila.usuarioId, empresaId, entidadId: remesaId,
                resumen: `Revirtió acción masiva (remesa ${remesaId})`,
                data: {
                    deudoresRevertidos: fila.deudoresRevertidos, contactosRestaurados: fila.contactosRestaurados,
                    comentariosBorrados: fila.comentariosBorrados, casosQueNoExistian: fila.casosQueNoExistian,
                    contactosSinCaso: fila.contactosSinCaso,
                },
            });
        }
        try {
            if (fila.usuarioId != null) {
                const terminada = fila.estado === 'TERMINADA';
                const numero = (await this.prisma.remesa.findUnique({ where: { id: remesaId }, select: { numeroRemesa: true } }))?.numeroRemesa ?? String(remesaId);
                const mensaje = terminada
                    ? `Se deshizo la acción masiva de la remesa ${numero}: ${fila.deudoresRevertidos} cambios de datos, ` +
                      `${fila.contactosRestaurados} contactos restaurados y ${fila.comentariosBorrados} comentarios borrados.`
                    : `La reversión de la remesa ${numero} se detuvo tras deshacer ${fila.hechos} de ${fila.total} cambios. ` +
                      // El texto de una interrumpida ya dice cómo seguir: no se repite.
                      `${fila.error ?? ''}${/Revertir de nuevo/.test(fila.error ?? '') ? '' : ' Revertir de nuevo sigue desde donde quedó.'}`.trim();
                await this.notificaciones.crear({
                    tipo: terminada ? 'IMPORTACION_FINALIZADA' : 'IMPORTACION_ERROR',
                    entidadTipo: 'REMESA',
                    entidadId: remesaId,
                    titulo: terminada ? 'Acción masiva revertida' : 'La reversión no terminó',
                    mensaje: mensaje.slice(0, 900),
                    // Sin `resultado`, `err` ni `procesadas`: la campanita no ofrece Descargar ni Retomar.
                    payload: { reversion: dto },
                    rutaAccion: `/historial-importaciones/${remesaId}`,
                    destinatarioPrincipalId: fila.usuarioId,
                });
            }
        } catch (e: any) {
            this.logger.warn(`Revertir remesa=${remesaId}: no se pudo crear la notificación: ${e?.message}`);
        }
        this.emitirTerminada(dto);
    }

    private emitirProgreso(dto: ReversionResumenDto): void {
        this.realtime.emitReversionProgreso(dto);
    }

    private emitirTerminada(dto: ReversionResumenDto): void {
        this.realtime.emitReversionTerminada(dto);
    }

    // ── El cron: lo que un reinicio dejó a medias ────────────────────────────────────────────

    /** Una pasada (cada minuto). Devuelve los ids de remesa que pasó a INTERRUMPIDA. */
    async revisarReversionesColgadas(): Promise<number[]> {
        const interrumpidas: number[] = [];
        const corte = new Date(this.ahora() - UMBRAL_COLGADA_MS);

        const revirtiendo = await this.prisma.reversion_accion.findMany({
            where: {
                estado: 'REVIRTIENDO',
                OR: [{ heartbeatAt: { lt: corte } }, { heartbeatAt: null, startedAt: { lt: corte } }, { heartbeatAt: null, startedAt: null, encoladaAt: { lt: corte } }],
            },
        });
        for (const f of revirtiendo) {
            const texto = `Se interrumpió por un reinicio del servidor o una falla: se revirtieron ${f.hechos} de ${f.total}. Revertir de nuevo sigue desde ahí.`;
            if (await this.interrumpir(f, texto)) interrumpidas.push(f.remesaId);
        }

        const enCola = await this.prisma.reversion_accion.findMany({ where: { estado: 'EN_COLA', encoladaAt: { lt: corte } } });
        for (const f of enCola) {
            if (!(await this.sinJobVivo(f.jobId))) continue;
            if (await this.interrumpir(f, 'No llegó a empezar: el servidor se reinició o la cola la perdió. Revertir de nuevo la vuelve a pedir.')) {
                interrumpidas.push(f.remesaId);
            }
        }
        if (interrumpidas.length) this.logger.warn(`Reversiones pasadas a INTERRUMPIDA: ${interrumpidas.join(', ')}`);
        return interrumpidas;
    }

    /** true = el job no existe o ya terminó (failed o completed). Una que espera detrás de otra (`waiting`) no se toca. */
    private async sinJobVivo(jobId: string | null): Promise<boolean> {
        if (!jobId) return true;
        try {
            const job = await this.cola.getJob(jobId);
            if (!job) return true;
            const estado = await job.getState();
            return estado === 'failed' || estado === 'completed';
        } catch (e: any) {
            // Sin Redis no se sabe: ante la duda, no se toca.
            this.logger.warn(`No se pudo consultar el job ${jobId} de la cola de reversiones: ${e?.message}`);
            return false;
        }
    }

    /** Condicionado a `estado` y `heartbeatAt` (o `encoladaAt`) para no pisar una que acaba de latir. */
    private async interrumpir(f: FilaReversion & { heartbeatAt: Date | null; jobId: string | null }, error: string): Promise<boolean> {
        try {
            const r = await this.prisma.reversion_accion.updateMany({
                where: { remesaId: f.remesaId, estado: f.estado, heartbeatAt: f.heartbeatAt, jobId: f.jobId },
                data: { estado: 'INTERRUMPIDA', error, finishedAt: new Date(this.ahora()) },
            });
            if (r.count === 0) return false;
            const fila = await this.prisma.reversion_accion.findUnique({ where: { remesaId: f.remesaId } });
            if (fila) await this.anunciarCierre(fila, await this.empresaDe(f.remesaId), false);
            return true;
        } catch (e: any) {
            this.logger.warn(`Reversión de la remesa ${f.remesaId}: no se pudo pasar a INTERRUMPIDA: ${e?.message}`);
            return false;
        }
    }
}
