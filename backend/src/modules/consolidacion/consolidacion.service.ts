/**
 * ConsolidacionSituacionService
 *
 * Recalcula `deudor.saldo` y transiciona `deudor.estadoSituacionId` en bloque
 * según los pagos acumulados en la tabla `pago`.
 *
 * REGLAS DE NEGOCIO (ver consolidacion-situacion-spec.md §1):
 *  - sum(pagos) == 0                                    → skip (no se toca el deudor).
 *  - sum(pagos) >= montoTotal * (1 − toleranciaPct)    → SIT-050 (Cancelado).
 *  - 0 < sum(pagos) < umbralCancelado                  → SIT-041 (Pago parcial).
 *  - saldoNuevo = max(0, montoTotal − sum(pagos))      → nunca negativo.
 *
 * IMPORTANTE:
 *  - Este servicio escribe directo con prisma.deudor.updateMany / $executeRaw.
 *    NO pasa por DeudorBloqueoService (ver spec §8.4 y §10.10).
 *  - Es idempotente: correrlo N veces sobre el mismo estado produce el mismo resultado.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditoriaHelper } from '../transacciones/auditoria.helper';
import { AuditModulo, AuditTipo } from '../transacciones/audit.enums';
import { ConsolidacionResult, ConsolidacionScope } from './interfaces/consolidacion-result.interface';

const DEFAULT_BATCH_SIZE = 500;
const TOLERANCIA_MIN = 0;
const TOLERANCIA_MAX = 0.05;
const DEFAULT_TOLERANCIA = 0.01;
/** Diferencia mínima en pesos para considerar que el saldo cambió. */
const SALDO_EPSILON = 0.001;

interface ChunkRow {
    id: bigint | number;
    montoTotal: number | null;
    estadoSituacionId: bigint | number | null;
    saldo: number | null;
    totalPagado: string | number | bigint;
}

@Injectable()
export class ConsolidacionSituacionService implements OnModuleInit {
    private readonly logger = new Logger(ConsolidacionSituacionService.name);

    private sit050Id: number | null = null;
    private sit041Id: number | null = null;
    private toleranciaPct: number = DEFAULT_TOLERANCIA;

    constructor(
        private readonly prisma: PrismaService,
        private readonly auditoria: AuditoriaHelper,
    ) {}

    // ─── Inicialización ───────────────────────────────────────────────────────

    async onModuleInit(): Promise<void> {
        this.validarToleranciaEnv();
        await this.cachearParametrosSIT();
    }

    private validarToleranciaEnv(): void {
        const raw = process.env.CONSOLIDACION_TOLERANCIA_PCT;
        if (raw == null || raw.trim() === '') {
            this.toleranciaPct = DEFAULT_TOLERANCIA;
            this.logger.log(
                `CONSOLIDACION_TOLERANCIA_PCT no definida, usando default=${DEFAULT_TOLERANCIA}`,
            );
            return;
        }

        const parsed = parseFloat(raw);
        if (isNaN(parsed) || parsed < TOLERANCIA_MIN || parsed > TOLERANCIA_MAX) {
            throw new Error(
                `CONSOLIDACION_TOLERANCIA_PCT="${raw}" está fuera del rango aceptado [${TOLERANCIA_MIN}, ${TOLERANCIA_MAX}]. ` +
                `Corregir la variable de entorno y reiniciar. Valor recomendado: ${DEFAULT_TOLERANCIA}`,
            );
        }

        this.toleranciaPct = parsed;
        this.logger.log(`CONSOLIDACION_TOLERANCIA_PCT=${this.toleranciaPct}`);
    }

    private async cachearParametrosSIT(): Promise<void> {
        const [sit050, sit041] = await Promise.all([
            this.prisma.parametro.findUnique({ where: { clave: 'SIT-050' } }),
            this.prisma.parametro.findUnique({ where: { clave: 'SIT-041' } }),
        ]);

        if (!sit050 || !sit041) {
            const faltantes = [
                !sit050 && 'SIT-050',
                !sit041 && 'SIT-041',
            ].filter(Boolean).join(', ');
            throw new Error(
                `Parámetros ${faltantes} no encontrados en la tabla parametro. ` +
                `Correr: npx ts-node prisma/seed-codigos-curados.ts`,
            );
        }

        this.sit050Id = sit050.id;
        this.sit041Id = sit041.id;
        this.logger.log(
            `Parámetros SIT cacheados: sit050Id=${this.sit050Id} sit041Id=${this.sit041Id}`,
        );
    }

    /** Exponer para invalidación manual en hot reload o scripts admin. */
    async refrescarCache(): Promise<void> {
        this.logger.log('Refrescando cache de IDs de parámetros SIT...');
        await this.cachearParametrosSIT();
    }

    // ─── Método principal ─────────────────────────────────────────────────────

    async consolidar(
        scope: ConsolidacionScope,
        opts?: {
            dryRun?: boolean;
            onProgress?: (avance: number, total: number) => void;
            batchSize?: number;
            requestId?: string;
        },
    ): Promise<ConsolidacionResult> {
        const t0 = Date.now();
        const dryRun = opts?.dryRun ?? false;
        const batchSize = opts?.batchSize ?? DEFAULT_BATCH_SIZE;
        const reqId = opts?.requestId ?? '-';

        this.logger.log(
            `Consolidación iniciada scope=${scope.tipo} dryRun=${dryRun} batchSize=${batchSize} req=${reqId}`,
        );

        const result: ConsolidacionResult = {
            evaluados: 0,
            conPagos: 0,
            aSIT050: 0,
            aSIT041: 0,
            sinCambios: 0,
            saldoActualizado: 0,
            durationMs: 0,
        };

        // 1. Resolver universo de deudorIds según scope
        const deudorIds = await this.resolverDeudorIds(scope);

        if (deudorIds.length === 0) {
            this.logger.log(
                `Consolidación scope=${scope.tipo} — sin deudores para evaluar. req=${reqId}`,
            );
            result.durationMs = Date.now() - t0;
            return result;
        }

        const total = deudorIds.length;
        const totalChunks = Math.ceil(total / batchSize);

        // 2. Procesar en chunks
        for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
            const start = chunkIdx * batchSize;
            const chunk = deudorIds.slice(start, start + batchSize);

            const chunkResult = await this.procesarChunk(chunk, dryRun);

            result.evaluados += chunkResult.evaluados;
            result.conPagos += chunkResult.conPagos;
            result.aSIT050 += chunkResult.aSIT050;
            result.aSIT041 += chunkResult.aSIT041;
            result.sinCambios += chunkResult.sinCambios;
            result.saldoActualizado += chunkResult.saldoActualizado;

            const avance = Math.min(start + chunk.length, total);
            opts?.onProgress?.(avance, total);

            this.logger.verbose(
                `chunk ${chunkIdx + 1}/${totalChunks} evaluados=${chunkResult.evaluados} ` +
                `aSIT050=${chunkResult.aSIT050} aSIT041=${chunkResult.aSIT041} ` +
                `sinCambios=${chunkResult.sinCambios} req=${reqId}`,
            );
        }

        result.durationMs = Date.now() - t0;

        this.logger.log(
            `Consolidación done scope=${scope.tipo} evaluados=${result.evaluados} ` +
            `aSIT050=${result.aSIT050} aSIT041=${result.aSIT041} ` +
            `sinCambios=${result.sinCambios} en ${result.durationMs}ms req=${reqId}`,
        );

        // 3. Auditoría (solo en apply, best-effort — si falla no rompemos la consolidación)
        if (!dryRun) {
            try {
                await this.auditoria.log({
                    modulo: AuditModulo.IMPORT,
                    entidad: 'Deudor',
                    tipo: AuditTipo.UPDATE,
                    resumen: `Consolidación scope=${scope.tipo} aSIT050=${result.aSIT050} aSIT041=${result.aSIT041}`,
                    data: { params: scope as Record<string, any>, contexto: result as any },
                });
            } catch (e: any) {
                this.logger.warn(
                    `Auditoría de consolidación falló (best-effort): ${e?.message}`,
                );
            }
        }

        return result;
    }

    // ─── Resolución de scope ──────────────────────────────────────────────────

    private async resolverDeudorIds(scope: ConsolidacionScope): Promise<number[]> {
        if (scope.tipo === 'DEUDORES') {
            return scope.deudorIds;
        }

        if (scope.tipo === 'REMESA') {
            const rows = await this.prisma.deudor.findMany({
                where: { remesaId: scope.remesaId },
                select: { id: true },
            });
            return rows.map((r) => r.id);
        }

        if (scope.tipo === 'EMPRESA') {
            const rows = await this.prisma.deudor.findMany({
                where: { empresaId: scope.empresaId },
                select: { id: true },
            });
            return rows.map((r) => r.id);
        }

        // TODAS
        const rows = await this.prisma.deudor.findMany({ select: { id: true } });
        return rows.map((r) => r.id);
    }

    // ─── Procesamiento de un chunk ────────────────────────────────────────────

    private async procesarChunk(
        ids: number[],
        dryRun: boolean,
    ): Promise<Omit<ConsolidacionResult, 'durationMs'>> {
        const partial = {
            evaluados: 0,
            conPagos: 0,
            aSIT050: 0,
            aSIT041: 0,
            sinCambios: 0,
            saldoActualizado: 0,
        };

        if (ids.length === 0) {
            return partial;
        }

        // Query agregada — una sola query para todo el chunk
        const rows = await this.prisma.$queryRaw<ChunkRow[]>`
            SELECT
                d.id,
                d.montoTotal,
                d.estadoSituacionId,
                d.saldo,
                COALESCE(SUM(p.importe), 0) AS totalPagado
            FROM deudor d
            LEFT JOIN pago p ON p.deudorId = d.id
            WHERE d.id IN (${Prisma.join(ids)})
            GROUP BY d.id, d.montoTotal, d.estadoSituacionId, d.saldo
        `;

        const sit050Ids: number[] = [];
        const sit041Ids: number[] = [];
        const now = new Date();

        for (const row of rows) {
            const deudorId = Number(row.id);
            const totalPagado = parseFloat(String(row.totalPagado));
            const saldoActual = row.saldo != null ? Number(row.saldo) : null;
            const estadoActual =
                row.estadoSituacionId != null ? Number(row.estadoSituacionId) : null;

            // Edge case §10.1: montoTotal nulo
            if (row.montoTotal == null) {
                if (totalPagado > 0) {
                    this.logger.warn(
                        `Deudor id=${deudorId} tiene montoTotal nulo y pagos > 0, no se consolida.`,
                    );
                }
                partial.sinCambios++;
                continue;
            }

            const montoTotal = Number(row.montoTotal);
            partial.evaluados++;

            // Regla 4: sin pagos → skip
            if (totalPagado === 0) {
                partial.sinCambios++;
                continue;
            }

            partial.conPagos++;

            // §10.2: saldo nunca negativo
            const saldoNuevo = Math.max(0, montoTotal - totalPagado);

            // Regla 2 y 3: umbral de cancelación
            const umbralCancelado = montoTotal * (1 - this.toleranciaPct);
            const situacionNuevaId =
                totalPagado >= umbralCancelado ? this.sit050Id! : this.sit041Id!;

            // Detectar cambios
            const saldoCambia =
                saldoActual == null ||
                Math.abs(saldoNuevo - saldoActual) > SALDO_EPSILON;
            const situacionCambia = situacionNuevaId !== estadoActual;

            if (!saldoCambia && !situacionCambia) {
                partial.sinCambios++;
                continue;
            }

            // Contadores
            if (situacionNuevaId === this.sit050Id) {
                partial.aSIT050++;
            } else {
                partial.aSIT041++;
            }

            if (saldoCambia) {
                partial.saldoActualizado++;
            }

            // Acumular para update (solo en apply)
            if (!dryRun) {
                if (situacionNuevaId === this.sit050Id) {
                    sit050Ids.push(deudorId);
                } else {
                    sit041Ids.push(deudorId);
                }
            }
        }

        // Escribir el chunk en una transacción
        if (!dryRun && (sit050Ids.length > 0 || sit041Ids.length > 0)) {
            await this.aplicarChunk(sit050Ids, sit041Ids, now);
        }

        return partial;
    }

    /**
     * Escribe los cambios del chunk en una transacción Prisma.
     *
     * Estrategia:
     *  - 2 updateMany para `estadoSituacionId` + `situacionConsolidadaEn` (uno por situación destino).
     *  - 2 $executeRaw para recalcular `saldo` con GREATEST(0, montoTotal - sum(pagos)) en SQL
     *    (evita traer valores a memoria y hace el cálculo final con la snapshot del momento exacto).
     *
     * Nota: el $executeRaw hace un sub-SELECT sobre `pago` para cada deudor, lo cual es
     * aceptable para chunks de 500 con índice pago(deudorId) — ver spec §10.6.
     */
    private async aplicarChunk(
        sit050Ids: number[],
        sit041Ids: number[],
        situacionConsolidadaEn: Date,
    ): Promise<void> {
        const ops: any[] = [];

        if (sit050Ids.length > 0) {
            ops.push(
                this.prisma.deudor.updateMany({
                    where: { id: { in: sit050Ids } },
                    data: {
                        estadoSituacionId: this.sit050Id!,
                        situacionConsolidadaEn,
                    },
                }),
            );
            ops.push(
                this.prisma.$executeRaw`
                    UPDATE deudor d
                    SET d.saldo = GREATEST(0, COALESCE(d.montoTotal, 0) - COALESCE(
                        (SELECT SUM(p.importe) FROM pago p WHERE p.deudorId = d.id), 0
                    ))
                    WHERE d.id IN (${Prisma.join(sit050Ids)})
                `,
            );
        }

        if (sit041Ids.length > 0) {
            ops.push(
                this.prisma.deudor.updateMany({
                    where: { id: { in: sit041Ids } },
                    data: {
                        estadoSituacionId: this.sit041Id!,
                        situacionConsolidadaEn,
                    },
                }),
            );
            ops.push(
                this.prisma.$executeRaw`
                    UPDATE deudor d
                    SET d.saldo = GREATEST(0, COALESCE(d.montoTotal, 0) - COALESCE(
                        (SELECT SUM(p.importe) FROM pago p WHERE p.deudorId = d.id), 0
                    ))
                    WHERE d.id IN (${Prisma.join(sit041Ids)})
                `,
            );
        }

        await this.prisma.$transaction(ops);
    }
}
