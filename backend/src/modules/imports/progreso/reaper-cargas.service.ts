// Reapers del módulo de importaciones (docs/imports-progreso-realtime-spec.md §9.5.6 y §9.5.7).
//
//  - Cargas colgadas: cierra como FALLIDA una carga cuyo worker murió. Ante la duda, no cierra.
//  - Borradores: borra las vistas previas sin confirmar de más de 24 horas.
//
// La lógica vive acá; los dos `@Cron` están en `reaper-cargas.scheduler.ts`.
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ImportService } from '../imports.service';
import { motivoLegible, type MotivoInterrupcion } from './estado-carga';

/** Una pasada "sospecha" y la siguiente confirma: tienen que pasar al menos 45 s entre una y otra. */
const ENTRE_PASADAS_MS = 45_000;
/** La ventana normal entre el commit de la confirmación y el `queue.add`: una carga en cola más nueva no es candidata. */
const GRACIA_EN_COLA_MS = 2 * 60_000;
/** Un latido más viejo que esto, en una carga que este proceso tiene viva, es un event loop o una base lentos. */
const LATIDO_ATRASADO_MS = 60_000;
const VIVA_SIN_AVANCE_MS = 15 * 60_000;
const REPETIR_AVISO_MS = 15 * 60_000;
const REPETIR_AVISO_LATIDO_MS = 5 * 60_000;
/** Una cancelación pedida hace más de esto sin que la carga viva corte se avisa (§10.5.7). */
const CANCELACION_SIN_HONRAR_MS = 2 * 60_000;
const EN_ESPERA_SIN_TOMAR_MS = 5 * 60_000;
const PASADA_LENTA_MS = 500;
/** Tope de borradores que se borran por corrida: si hay más, se van en las noches siguientes. */
export const MAX_BORRADORES_POR_CORRIDA = 500;

export const UMBRAL_LATIDO_DEFAULT_MIN = 5;
export const BORRADOR_TTL_DEFAULT_HORAS = 24;

function numeroAcotado(raw: string | undefined, def: number, min: number, max: number): number {
    if (raw === undefined || raw.trim() === '') return def;
    const n = Number(raw);
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, Math.floor(n)));
}

/** `IMPORTS_LATIDO_UMBRAL_MIN`: default 5, acotado a [3, 120]; un valor inválido es 5. */
export function umbralLatidoMin(raw: string | undefined = process.env.IMPORTS_LATIDO_UMBRAL_MIN): number {
    return numeroAcotado(raw, UMBRAL_LATIDO_DEFAULT_MIN, 3, 120);
}

/** `IMPORTS_BORRADOR_TTL_HORAS`: default 24, acotado a [1, 720]; un valor inválido es 24. */
export function borradorTtlHoras(raw: string | undefined = process.env.IMPORTS_BORRADOR_TTL_HORAS): number {
    return numeroAcotado(raw, BORRADOR_TTL_DEFAULT_HORAS, 1, 720);
}

/**
 * `IMPORTS_REAPER_DESACTIVADO`: solo `1`, `true`, `si`, `sí`, `yes`, `on`, `y` o `s` (sin distinguir mayúsculas) apagan los dos
 * crons. `false`, `0` o vacío NO: quien escribe `=false` espera lo contrario de apagarlo. Es la llave de emergencia.
 */
export function reaperDesactivado(raw: string | undefined = process.env.IMPORTS_REAPER_DESACTIVADO): boolean {
    return ['1', 'true', 'si', 'sí', 'yes', 'on', 'y', 's'].includes((raw ?? '').trim().toLowerCase());
}

interface Sospecha {
    motivo: MotivoInterrupcion;
    desde: number;
}

@Injectable()
export class ReaperCargasService implements OnModuleInit {
    private readonly logger = new Logger(ReaperCargasService.name);

    /** Reloj en milisegundos. Público para que los tests lo inyecten. */
    ahora: () => number = Date.now;

    private pasadaEnCurso = false;
    /** Cargas que la pasada anterior encontró sospechosas, por remesa. */
    private readonly sospechas = new Map<number, Sospecha>();
    /** Último `warn` de cada clase por remesa, para no repetirlo en cada pasada. */
    private readonly avisos = new Map<string, number>();

    constructor(
        private readonly prisma: PrismaService,
        private readonly importService: ImportService,
    ) {}

    onModuleInit(): void {
        if (reaperDesactivado()) {
            this.logger.warn('Reaper de importaciones desactivado por IMPORTS_REAPER_DESACTIVADO');
            return;
        }
        this.logger.log(
            `Reaper de importaciones activo: sin latido a los ${umbralLatidoMin()} min, borradores a las ${borradorTtlHoras()} h`,
        );
    }

    /** `true` si ya se avisó esto hace menos de `cada` ms. Si no, lo anota y devuelve `false`. */
    private yaAvisado(clave: string, cada: number): boolean {
        const ahora = this.ahora();
        const antes = this.avisos.get(clave);
        if (antes !== undefined && ahora - antes < cada) return true;
        this.avisos.set(clave, ahora);
        return false;
    }

    // ── Cargas colgadas ─────────────────────────────────────────────────────────────────────

    /** Una pasada (cada minuto). Devuelve los ids de remesa que cerró. */
    async revisarCargasColgadas(): Promise<number[]> {
        if (reaperDesactivado()) return [];
        if (this.pasadaEnCurso) return [];
        this.pasadaEnCurso = true;
        const t0 = Date.now();
        const cerradas: number[] = [];
        try {
            const umbralMs = umbralLatidoMin() * 60_000;
            // Parte de `import_progreso`: una remesa sin fila (93, 98, toda heredada), un borrador (sin
            // `encoladaAt`) y una terminal no pueden aparecer.
            const candidatas = await this.prisma.import_progreso.findMany({
                where: {
                    encoladaAt: { not: null },
                    finishedAt: null,
                    remesa: { estadoProceso: { notIn: ['FINALIZADA', 'FALLIDA'] } },
                },
                select: { remesaId: true, encoladaAt: true, startedAt: true, heartbeatAt: true, jobId: true },
            });

            for (const c of candidatas) {
                try {
                    if (await this.revisarCarga(c, umbralMs)) cerradas.push(c.remesaId);
                } catch (e: any) {
                    this.logger.error(`Reaper: falló al revisar la remesa ${c.remesaId}: ${motivoLegible(e)}`, e?.stack);
                }
            }

            // Una carga que ya no es candidata deja de ser sospechosa.
            const ids = new Set(candidatas.map((c) => c.remesaId));
            for (const id of [...this.sospechas.keys()]) if (!ids.has(id)) this.sospechas.delete(id);
        } finally {
            this.pasadaEnCurso = false;
            const ms = Date.now() - t0;
            if (ms > PASADA_LENTA_MS) this.logger.log(`Reaper de cargas: pasada de ${ms}ms`);
        }
        return cerradas;
    }

    /** Devuelve `true` si cerró la carga. */
    private async revisarCarga(
        c: { remesaId: number; encoladaAt: Date | null; startedAt: Date | null; heartbeatAt: Date | null; jobId: string | null },
        umbralMs: number,
    ): Promise<boolean> {
        const id = c.remesaId;
        const ahora = this.ahora();

        // (1) La registra este proceso: NO SE TOCA, por viejo que sea su latido.
        const viva = this.importService.cargaVivaEnEsteProceso(id);
        if (viva) {
            this.sospechas.delete(id);
            const ultimo = c.heartbeatAt ?? c.startedAt ?? c.encoladaAt;
            if (ultimo && ahora - ultimo.getTime() > LATIDO_ATRASADO_MS && !this.yaAvisado(`latido:${id}`, REPETIR_AVISO_LATIDO_MS)) {
                this.logger.warn(
                    `Remesa ${id}: latido atrasado ${Math.round((ahora - ultimo.getTime()) / 1000)} s en una carga viva (event loop o base lentos)`,
                );
            }
            if (viva.sinAvanceMs >= VIVA_SIN_AVANCE_MS && !this.yaAvisado(`sinavance:${id}`, REPETIR_AVISO_MS)) {
                this.logger.warn(
                    `Remesa ${id}: viva y sin avance hace ${Math.round(viva.sinAvanceMs / 60_000)} min ` +
                    `(${viva.fase}${viva.subfase ? `, ${viva.subfase}` : ''}). No se cierra sola: se ve y sale con un reinicio`,
                );
            }
            // Una cancelación pedida que la carga viva no honró: se ve, no se cierra (cortarla de verdad necesita un reinicio).
            // El dato sale de la carga viva y no de la consulta de candidatas; un doble que no lo trae no dispara el aviso.
            if (
                typeof viva.cancelacionPedidaHaceMs === 'number' &&
                viva.cancelacionPedidaHaceMs >= CANCELACION_SIN_HONRAR_MS &&
                !this.yaAvisado(`cancelacion:${id}`, REPETIR_AVISO_MS)
            ) {
                this.logger.warn(
                    `Remesa ${id}: se pidió cancelar hace ${Math.round(viva.cancelacionPedidaHaceMs / 60_000)} min y la carga viva no cortó ` +
                    `(${viva.fase}${viva.subfase ? `, ${viva.subfase}` : ''})`,
                );
            }
            return false;
        }

        let motivo: MotivoInterrupcion;
        let estadoJob: string;
        if (c.startedAt != null) {
            // R1: arrancó y no terminó.
            const ultimo = (c.heartbeatAt ?? c.startedAt).getTime();
            // (2) Late: alguien la está procesando.
            if (ahora - ultimo < umbralMs) {
                this.sospechas.delete(id);
                return false;
            }
            const j = await this.importService.estadoDelJobDeCarga(id, c.jobId);
            estadoJob = j.estado;
            if (j.estado === 'DESCONOCIDO') {
                this.logger.warn(`Reaper: no se pudo consultar la cola por la remesa ${id}; hacen falta dos pasadas seguidas con respuesta`);
                this.sospechas.delete(id);
                return false;
            }
            // (3) BullMQ dice que vive.
            if (j.estado === 'ACTIVO_CON_LOCK') {
                this.logger.warn(`Reaper: la remesa ${id} no late pero su job tiene el lock: otro proceso la tiene viva`);
                this.sospechas.delete(id);
                return false;
            }
            motivo = 'SIN_LATIDO';
        } else {
            // R2: en cola y nunca arrancó.
            const enCola = c.encoladaAt ? ahora - c.encoladaAt.getTime() : 0;
            if (enCola < GRACIA_EN_COLA_MS) {
                this.sospechas.delete(id);
                return false;
            }
            const j = await this.importService.estadoDelJobDeCarga(id, c.jobId);
            estadoJob = j.estado;
            if (j.estado === 'DESCONOCIDO') {
                this.sospechas.delete(id);
                return false;
            }
            if (j.estado === 'EN_ESPERA' || j.estado === 'ACTIVO_CON_LOCK' || j.estado === 'ACTIVO_SIN_LOCK') {
                // Tiene job: espera su turno. La antigüedad sola nunca cierra una carga en cola.
                if (
                    j.estado === 'EN_ESPERA' &&
                    enCola >= EN_ESPERA_SIN_TOMAR_MS &&
                    !this.importService.hayCargasVivasEnEsteProceso() &&
                    !this.yaAvisado(`espera:${id}`, REPETIR_AVISO_MS)
                ) {
                    this.logger.warn(
                        `Remesa ${id}: hay un job esperando hace ${Math.round(enCola / 60_000)} min y el worker no lo toma`,
                    );
                }
                this.sospechas.delete(id);
                return false;
            }
            motivo = 'SIN_JOB'; // NO_EXISTE o TERMINADO
        }

        // Dos pasadas seguidas, con al menos 45 s entre una y otra.
        const previa = this.sospechas.get(id);
        if (!previa || previa.motivo !== motivo) {
            this.sospechas.set(id, { motivo, desde: ahora });
            const minSinLatido = c.startedAt ? Math.round((ahora - (c.heartbeatAt ?? c.startedAt).getTime()) / 60_000) : null;
            this.logger.log(
                `Reaper: remesa ${id} sospechosa (motivo=${motivo}${minSinLatido != null ? `, ${minSinLatido} min sin latido` : ''}, cola=${estadoJob}); ` +
                'se confirma en la próxima pasada',
            );
            return false;
        }
        if (ahora - previa.desde < ENTRE_PASADAS_MS) return false;

        const t0 = Date.now();
        this.logger.warn(`Reaper: cerrando la remesa ${id} (motivo=${motivo}, cola=${estadoJob})`);
        const estado = await this.importService.cerrarCargaInterrumpida(id, motivo, { umbralMs, jobId: c.jobId ?? undefined });
        let accionJob = 'sin tocar el job';
        if (estado && estadoJob === 'EN_ESPERA') {
            // BullMQ ya lo devolvió a la cola: se lo saca para que no se entregue nunca.
            const sacado = await this.importService.sacarJobDeLaCola(id, c.jobId);
            accionJob = sacado ? 'job sacado de la cola' : 'no se pudo sacar el job';
        }
        this.sospechas.delete(id);
        if (estado) {
            this.logger.warn(
                `Reaper: remesa ${id} cerrada (motivo=${motivo}, filas procesadas=${estado.procesadas}, ${accionJob}) en ${Date.now() - t0}ms`,
            );
        } else {
            this.logger.log(`Reaper: la remesa ${id} ya no correspondía cerrarla (motivo=${motivo})`);
        }
        return estado != null;
    }

    // ── Borradores ──────────────────────────────────────────────────────────────────────────

    /** Ids de usuario que tienen ahora una carga encolada y sin terminar. */
    private async creadoresConCargaEnCurso(): Promise<number[]> {
        const enCurso = await this.prisma.remesa.findMany({
            where: { usuarioCreadorId: { not: null }, progreso: { is: { encoladaAt: { not: null }, finishedAt: null } } },
            select: { usuarioCreadorId: true },
            distinct: ['usuarioCreadorId'],
        });
        return enCurso.map((r) => r.usuarioCreadorId).filter((id): id is number => id != null);
    }

    /** Borra las vistas previas sin confirmar de más de `IMPORTS_BORRADOR_TTL_HORAS`. Devuelve los ids borrados. */
    async limpiarBorradores(): Promise<number[]> {
        if (reaperDesactivado()) return [];
        const t0 = Date.now();
        const ttl = borradorTtlHoras();
        const corte = new Date(this.ahora() - ttl * 3_600_000);
        this.logger.log(`Reaper de borradores: buscando vistas previas sin confirmar de más de ${ttl} h`);

        // Las remesas de una carga dividida que todavía no arrancaron son borradores: si la división está corriendo
        // (su creador tiene una carga en curso), un borrador de más de 24 h NO se borra.
        const ocupados = await this.creadoresConCargaEnCurso();
        const candidatas = (
            await this.prisma.remesa.findMany({
                where: {
                    estadoProceso: { in: ['PENDIENTE', 'VALIDANDO'] },
                    createdAt: { lt: corte },
                    // Exige fila: una remesa heredada (sin fila de progreso) no entra.
                    progreso: { is: { fase: 'BORRADOR', encoladaAt: null } },
                    deudor: { none: {} },
                    ...(ocupados.length ? { OR: [{ usuarioCreadorId: null }, { usuarioCreadorId: { notIn: ocupados } }] } : {}),
                },
                select: { id: true, numeroRemesa: true, empresaId: true, categoria: true, createdAt: true },
                orderBy: { id: 'asc' },
                take: MAX_BORRADORES_POR_CORRIDA,
            })
        ).slice(0, MAX_BORRADORES_POR_CORRIDA);

        const borradas: Array<{ id: number; numero: string }> = [];
        for (const r of candidatas) {
            try {
                // Una transacción por remesa: la que falla no arrastra a las demás y ningún lock dura más que un borrado.
                const borrada = await this.prisma.$transaction(async (tx) => {
                    const filas = await tx.$queryRaw<Array<{ estadoProceso: string; fase: string; encoladaAt: Date | null; enCursoDelCreador?: bigint | number }>>`
                        SELECT r.estadoProceso AS estadoProceso, p.fase AS fase, p.encoladaAt AS encoladaAt,
                               (SELECT COUNT(*) FROM import_progreso p2 JOIN remesa r2 ON r2.id = p2.remesaId
                                 WHERE r.usuarioCreadorId IS NOT NULL AND r2.usuarioCreadorId = r.usuarioCreadorId
                                   AND p2.encoladaAt IS NOT NULL AND p2.finishedAt IS NULL) AS enCursoDelCreador
                        FROM remesa r JOIN import_progreso p ON p.remesaId = r.id
                        WHERE r.id = ${r.id}
                        FOR UPDATE
                    `;
                    const f = filas[0];
                    // Entre el listado y el lock alguien pudo confirmarla (la confirmación toma el mismo lock).
                    if (!f || (f.estadoProceso !== 'PENDIENTE' && f.estadoProceso !== 'VALIDANDO') || f.fase !== 'BORRADOR' || f.encoladaAt != null) {
                        return false;
                    }
                    // Y su creador no tiene una carga en curso (puede haber empezado desde el listado).
                    if (Number(f.enCursoDelCreador ?? 0) > 0) return false;
                    if (await tx.deudor.findFirst({ where: { remesaId: r.id }, select: { id: true } })) return false;
                    await tx.importerror.deleteMany({ where: { remesaId: r.id } });
                    await tx.jobimport.deleteMany({ where: { remesaId: r.id } });
                    await tx.remesa.delete({ where: { id: r.id } }); // la fila de progreso cae por cascade
                    return true;
                });
                if (borrada) borradas.push({ id: r.id, numero: r.numeroRemesa });
            } catch (e: any) {
                // Ante cualquier referencia inesperada, no borra: esa remesa queda.
                this.logger.warn(`Reaper de borradores: no se pudo borrar la remesa ${r.id}: ${motivoLegible(e)}`);
            }
        }

        if (candidatas.length >= MAX_BORRADORES_POR_CORRIDA) {
            this.logger.warn(
                `Reaper de borradores: se alcanzó el tope de ${MAX_BORRADORES_POR_CORRIDA} por corrida; el resto queda para las noches siguientes`,
            );
        }
        this.logger.log(
            `Reaper de borradores: ${borradas.length} eliminados de más de ${ttl} h` +
            `${borradas.length ? ` (remesas: ${borradas.map((b) => b.numero).join(', ')})` : ''} en ${Date.now() - t0}ms`,
        );
        return borradas.map((b) => b.id);
    }
}
