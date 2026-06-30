/**
 * backfill-consolidacion.ts
 *
 * Script de backfill para Fase 3 de consolidacion-situacion-spec.md (§7).
 *
 * PASOS:
 *  1. UPDATE deudor SET saldo = montoTotal WHERE saldo IS NULL
 *     (inicializa saldo para todos los deudores sin pagos)
 *  2. Recalcula saldo y estadoSituacionId para los deudores que tienen pagos.
 *     Replica la lógica de ConsolidacionSituacionService inline para evitar
 *     las dependencias transitivas de NestJS que no se pueden resolver desde CLI.
 *
 * SEGURIDAD:
 *  - Por defecto corre en DRY-RUN (solo reporta conteos, no escribe).
 *  - Para aplicar los cambios pasar --apply de forma explícita.
 *
 * Uso:
 *   # Verificar (seguro, no toca la DB):
 *   npx ts-node --transpile-only prisma/scripts/backfill-consolidacion.ts
 *
 *   # Aplicar (SOLO después de revisar el dry-run con el usuario):
 *   npx ts-node --transpile-only prisma/scripts/backfill-consolidacion.ts --apply
 *
 * IMPORTANTE: Antes de correr con --apply, sacar snapshot:
 *   mysql -e "SELECT id, estadoSituacionId, montoTotal, saldo INTO OUTFILE '/tmp/snap_pre_backfill.tsv' FROM deudor"
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { PrismaClient, Prisma } from '@prisma/client';

// Cargar .env desde la raíz del backend
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const prisma = new PrismaClient();

// ─── Configuración ────────────────────────────────────────────────────────────

const APPLY     = process.argv.includes('--apply');
const DRY_RUN   = !APPLY;
const BATCH_SIZE = 500;
const SALDO_EPSILON = 0.001;

const TOLERANCIA_MIN = 0;
const TOLERANCIA_MAX = 0.05;
const DEFAULT_TOLERANCIA = 0.01;

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface ChunkRow {
    id: bigint;
    montoTotal: number | null;
    estadoSituacionId: bigint | null;
    saldo: number | null;
    totalPagado: string;
}

interface ConsolidacionResult {
    evaluados: number;
    conPagos: number;
    aSIT050: number;
    aSIT041: number;
    sinCambios: number;
    saldoActualizado: number;
    durationMs: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseTolerancia(): number {
    const raw = process.env.CONSOLIDACION_TOLERANCIA_PCT;
    if (!raw || raw.trim() === '') {
        console.log(`  CONSOLIDACION_TOLERANCIA_PCT no definida, usando default=${DEFAULT_TOLERANCIA}`);
        return DEFAULT_TOLERANCIA;
    }
    const parsed = parseFloat(raw);
    if (isNaN(parsed) || parsed < TOLERANCIA_MIN || parsed > TOLERANCIA_MAX) {
        throw new Error(
            `CONSOLIDACION_TOLERANCIA_PCT="${raw}" está fuera del rango [${TOLERANCIA_MIN}, ${TOLERANCIA_MAX}].`,
        );
    }
    console.log(`  CONSOLIDACION_TOLERANCIA_PCT=${parsed}`);
    return parsed;
}

async function cachearSITIds(): Promise<{ sit050Id: number; sit041Id: number }> {
    const [sit050, sit041] = await Promise.all([
        prisma.parametro.findUnique({ where: { clave: 'SIT-050' } }),
        prisma.parametro.findUnique({ where: { clave: 'SIT-041' } }),
    ]);
    const faltantes = [!sit050 && 'SIT-050', !sit041 && 'SIT-041'].filter(Boolean).join(', ');
    if (faltantes) {
        throw new Error(
            `Parámetros ${faltantes} no encontrados. Correr: npx ts-node prisma/seed-codigos-curados.ts`,
        );
    }
    console.log(`  sit050Id=${sit050!.id} sit041Id=${sit041!.id}`);
    return { sit050Id: sit050!.id, sit041Id: sit041!.id };
}

async function procesarChunk(
    ids: number[],
    sit050Id: number,
    sit041Id: number,
    toleranciaPct: number,
    dryRun: boolean,
    now: Date,
): Promise<Omit<ConsolidacionResult, 'durationMs'>> {
    const partial = { evaluados: 0, conPagos: 0, aSIT050: 0, aSIT041: 0, sinCambios: 0, saldoActualizado: 0 };
    if (ids.length === 0) return partial;

    const rows = await prisma.$queryRaw<ChunkRow[]>`
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

    const sit050UpdateIds: number[] = [];
    const sit041UpdateIds: number[] = [];

    for (const row of rows) {
        const deudorId = Number(row.id);
        const totalPagado = parseFloat(String(row.totalPagado));
        const saldoActual = row.saldo != null ? Number(row.saldo) : null;
        const estadoActual = row.estadoSituacionId != null ? Number(row.estadoSituacionId) : null;

        if (row.montoTotal == null) {
            if (totalPagado > 0) {
                console.warn(`  WARN: Deudor id=${deudorId} tiene montoTotal nulo y pagos > 0, no se consolida.`);
            }
            partial.sinCambios++;
            continue;
        }

        const montoTotal = Number(row.montoTotal);
        partial.evaluados++;

        if (totalPagado === 0) {
            partial.sinCambios++;
            continue;
        }

        partial.conPagos++;
        const saldoNuevo = Math.max(0, montoTotal - totalPagado);
        const umbralCancelado = montoTotal * (1 - toleranciaPct);
        const situacionNuevaId = totalPagado >= umbralCancelado ? sit050Id : sit041Id;

        const saldoCambia = saldoActual == null || Math.abs(saldoNuevo - saldoActual) > SALDO_EPSILON;
        const situacionCambia = situacionNuevaId !== estadoActual;

        if (!saldoCambia && !situacionCambia) {
            partial.sinCambios++;
            continue;
        }

        if (situacionNuevaId === sit050Id) {
            partial.aSIT050++;
        } else {
            partial.aSIT041++;
        }
        if (saldoCambia) {
            partial.saldoActualizado++;
        }

        if (!dryRun) {
            if (situacionNuevaId === sit050Id) {
                sit050UpdateIds.push(deudorId);
            } else {
                sit041UpdateIds.push(deudorId);
            }
        }
    }

    if (!dryRun && (sit050UpdateIds.length > 0 || sit041UpdateIds.length > 0)) {
        const ops: any[] = [];

        if (sit050UpdateIds.length > 0) {
            ops.push(
                prisma.deudor.updateMany({
                    where: { id: { in: sit050UpdateIds } },
                    data: { estadoSituacionId: sit050Id, situacionConsolidadaEn: now },
                }),
            );
            ops.push(
                prisma.$executeRaw`
                    UPDATE deudor d
                    SET d.saldo = GREATEST(0, COALESCE(d.montoTotal, 0) - COALESCE(
                        (SELECT SUM(p.importe) FROM pago p WHERE p.deudorId = d.id), 0
                    ))
                    WHERE d.id IN (${Prisma.join(sit050UpdateIds)})
                `,
            );
        }

        if (sit041UpdateIds.length > 0) {
            ops.push(
                prisma.deudor.updateMany({
                    where: { id: { in: sit041UpdateIds } },
                    data: { estadoSituacionId: sit041Id, situacionConsolidadaEn: now },
                }),
            );
            ops.push(
                prisma.$executeRaw`
                    UPDATE deudor d
                    SET d.saldo = GREATEST(0, COALESCE(d.montoTotal, 0) - COALESCE(
                        (SELECT SUM(p.importe) FROM pago p WHERE p.deudorId = d.id), 0
                    ))
                    WHERE d.id IN (${Prisma.join(sit041UpdateIds)})
                `,
            );
        }

        await prisma.$transaction(ops);
    }

    return partial;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    console.log('──────────────────────────────────────────────────────────────');
    console.log(`Backfill consolidacion — Modo: ${DRY_RUN ? 'DRY-RUN (sin cambios)' : 'APPLY (escribiendo a DB)'}`);
    console.log('──────────────────────────────────────────────────────────────');

    // ── Config ────────────────────────────────────────────────────────────────

    console.log('\nCargando configuración...');
    const toleranciaPct = parseTolerancia();
    const { sit050Id, sit041Id } = await cachearSITIds();

    // ── Paso 1: Inicializar saldo = montoTotal para deudores sin saldo ────────

    const sinSaldo = await prisma.$queryRaw<{ c: bigint }[]>`
        SELECT COUNT(*) AS c FROM deudor WHERE saldo IS NULL
    `;
    const totalSinSaldo = Number(sinSaldo[0]?.c ?? 0);

    console.log(`\nPaso 1 — Inicializar saldo desde montoTotal:`);
    console.log(`  Deudores con saldo IS NULL: ${totalSinSaldo}`);

    if (!DRY_RUN && totalSinSaldo > 0) {
        const filas = await prisma.$executeRaw`
            UPDATE deudor SET saldo = montoTotal WHERE saldo IS NULL
        `;
        console.log(`  Filas actualizadas: ${filas}`);
    } else if (DRY_RUN && totalSinSaldo > 0) {
        console.log(`  [DRY-RUN] Se actualizarían ${totalSinSaldo} filas con saldo = montoTotal`);
    } else {
        console.log(`  Nada para inicializar.`);
    }

    // ── Paso 2: Consolidar situación de todos los deudores ───────────────────

    console.log(`\nPaso 2 — Consolidar situación de todos los deudores (scope=TODAS):`);

    const totalRows = await prisma.$queryRaw<{ c: bigint }[]>`
        SELECT COUNT(*) AS c FROM deudor
    `;
    const total = Number(totalRows[0]?.c ?? 0);
    console.log(`  Total de deudores: ${total}`);

    const result: ConsolidacionResult = {
        evaluados: 0, conPagos: 0, aSIT050: 0, aSIT041: 0,
        sinCambios: 0, saldoActualizado: 0, durationMs: 0,
    };

    if (total === 0) {
        console.log('  Sin deudores para consolidar.');
        result.durationMs = 0;
    } else {
        // Resolver todos los IDs
        const allRows = await prisma.deudor.findMany({ select: { id: true } });
        const allIds = allRows.map(r => r.id);

        const totalChunks = Math.ceil(allIds.length / BATCH_SIZE);
        const t0 = Date.now();
        const now = new Date();
        let lastLogPct = 0;

        for (let ci = 0; ci < totalChunks; ci++) {
            const chunk = allIds.slice(ci * BATCH_SIZE, (ci + 1) * BATCH_SIZE);
            const chunkResult = await procesarChunk(chunk, sit050Id, sit041Id, toleranciaPct, DRY_RUN, now);

            result.evaluados += chunkResult.evaluados;
            result.conPagos += chunkResult.conPagos;
            result.aSIT050 += chunkResult.aSIT050;
            result.aSIT041 += chunkResult.aSIT041;
            result.sinCambios += chunkResult.sinCambios;
            result.saldoActualizado += chunkResult.saldoActualizado;

            const avance = Math.min((ci + 1) * BATCH_SIZE, total);
            const pct = Math.floor((avance / total) * 100);
            if (pct >= lastLogPct + 10 || avance === total) {
                console.log(`  Progreso: ${avance}/${total} (${pct}%) — chunk ${ci + 1}/${totalChunks}`);
                lastLogPct = pct;
            }
        }

        result.durationMs = Date.now() - t0;
    }

    // ── Resultado ─────────────────────────────────────────────────────────────

    console.log('\n──────────────────────────────────────────────────────────────');
    console.log(`Resultado${DRY_RUN ? ' (DRY-RUN — ningún cambio aplicado)' : ' (APLICADO)'}:`);
    console.log(`  Evaluados:          ${result.evaluados}`);
    console.log(`  Con pagos:          ${result.conPagos}`);
    console.log(`  Pasarán a SIT-050:  ${result.aSIT050}`);
    console.log(`  Pasarán a SIT-041:  ${result.aSIT041}`);
    console.log(`  Sin cambios:        ${result.sinCambios}`);
    console.log(`  Saldo actualizado:  ${result.saldoActualizado}`);
    console.log(`  Duración:           ${result.durationMs}ms`);
    console.log('──────────────────────────────────────────────────────────────');

    if (DRY_RUN) {
        console.log('\nPara aplicar los cambios correr con --apply:');
        console.log('  npx ts-node --transpile-only prisma/scripts/backfill-consolidacion.ts --apply');
        console.log('\nANTES de aplicar, sacar snapshot de seguridad con alguno de estos comandos:');
        console.log("  mysql -u<user> -p<pass> <db> -e \"SELECT id, estadoSituacionId, montoTotal, saldo FROM deudor\" > /tmp/snap.tsv");
    }
}

main()
    .then(() => prisma.$disconnect())
    .catch(async (e) => {
        console.error('\nERROR fatal:', e);
        await prisma.$disconnect();
        process.exit(1);
    });
