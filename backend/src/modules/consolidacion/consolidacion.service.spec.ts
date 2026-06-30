/**
 * Tests unitarios de ConsolidacionSituacionService.
 *
 * Ejecutar: npx jest consolidacion.service.spec.ts --no-coverage
 *
 * Casos cubiertos:
 *  1. Pago exacto == total            → SIT-050, saldo = 0.
 *  2. Pago dentro de tolerancia (99%) → SIT-050 (tolerancia default 1%).
 *  3. Pago > tolerancia pero parcial  → SIT-041.
 *  4. Deudor sin pagos                → skip (sinCambios++, evaluados++ de todos modos).
 *  5. Pagos > montoTotal              → SIT-050 y saldo = 0 (no negativo).
 *  6. Idempotencia                    → segunda ejecución con mismo estado → sinCambios = total.
 *  7. montoTotal nulo con pagos       → skip silencioso (sinCambios++).
 *  8. dryRun: NO llama $transaction   → contadores correctos, sin escrituras.
 *  9. Bootstrap: tolerancia fuera de rango → falla con error descriptivo.
 * 10. Bootstrap: SIT-050 no seedeado → falla con error descriptivo.
 * 11. onProgress callback se invoca.
 */

// ── Cortar la cadena de dependencias transitivas que usan rutas 'src/...' ──
// transacciones.service.ts (importado por auditoria.helper.ts) requiere
// 'src/prisma/prisma.service' que Jest no puede resolver sin moduleNameMapper.
// Mockeamos el módulo completo para evitar que Jest intente resolverlo.
jest.mock('../transacciones/auditoria.helper', () => ({
    AuditoriaHelper: jest.fn().mockImplementation(() => ({
        log: jest.fn().mockResolvedValue(undefined),
    })),
}));
jest.mock('../transacciones/audit.enums', () => ({
    AuditModulo: { IMPORT: 'IMPORT' },
    AuditTipo: { UPDATE: 'UPDATE' },
}));

import { ConsolidacionSituacionService } from './consolidacion.service';

// ─── IDs fijos para los mocks ──────────────────────────────────────────────
const SIT050_ID = 50;
const SIT041_ID = 41;

// ─── Helpers de mock ──────────────────────────────────────────────────────────

interface DeudorRow {
    id: number;
    montoTotal: number | null;
    estadoSituacionId: number | null;
    saldo: number | null;
    totalPagado: number;
}

/**
 * Construye un mock de PrismaService que responde con las filas provistas.
 * updateMany / $executeRaw / $transaction son stubs que rastrean llamadas.
 */
function makePrisma(rows: DeudorRow[]) {
    const updateMany = jest.fn().mockResolvedValue({ count: rows.length });
    const executeRaw = jest.fn().mockResolvedValue(1);
    const transaction = jest.fn().mockImplementation(async (ops: any[]) => {
        return Promise.all(ops.map((op: any) => (typeof op?.then === 'function' ? op : Promise.resolve(op))));
    });

    const prisma = {
        parametro: {
            findUnique: jest.fn().mockImplementation(({ where }: { where: { clave: string } }) => {
                if (where.clave === 'SIT-050') {
                    return Promise.resolve({ id: SIT050_ID, clave: 'SIT-050' });
                }
                if (where.clave === 'SIT-041') {
                    return Promise.resolve({ id: SIT041_ID, clave: 'SIT-041' });
                }
                return Promise.resolve(null);
            }),
        },
        deudor: {
            findMany: jest.fn().mockResolvedValue(rows.map((r) => ({ id: r.id }))),
            updateMany,
        },
        $queryRaw: jest.fn().mockResolvedValue(rows),
        $executeRaw: executeRaw,
        $transaction: transaction,
    } as any;

    return { prisma, updateMany, executeRaw, transaction };
}

/** Helper para instanciar y pre-inicializar el service. */
async function makeService(
    rows: DeudorRow[],
    toleranciaEnv?: string,
): Promise<{
    svc: ConsolidacionSituacionService;
    prisma: ReturnType<typeof makePrisma>['prisma'];
    updateMany: jest.Mock;
    executeRaw: jest.Mock;
    transaction: jest.Mock;
}> {
    if (toleranciaEnv !== undefined) {
        process.env.CONSOLIDACION_TOLERANCIA_PCT = toleranciaEnv;
    } else {
        process.env.CONSOLIDACION_TOLERANCIA_PCT = '0.01'; // 1% default
    }

    const { prisma, updateMany, executeRaw, transaction } = makePrisma(rows);
    const auditoria = { log: jest.fn().mockResolvedValue(undefined) } as any;

    const svc = new ConsolidacionSituacionService(prisma, auditoria);
    await svc.onModuleInit();

    return { svc, prisma, updateMany, executeRaw, transaction };
}

// ─── Limpieza ─────────────────────────────────────────────────────────────────
afterEach(() => {
    delete process.env.CONSOLIDACION_TOLERANCIA_PCT;
    jest.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ConsolidacionSituacionService', () => {

    // ── Caso 1: pago exacto == total → SIT-050 ─────────────────────────────
    describe('pago exacto igual al montoTotal', () => {
        it('asigna SIT-050 y registra la transacción en apply', async () => {
            const rows: DeudorRow[] = [
                { id: 1, montoTotal: 1000, estadoSituacionId: null, saldo: null, totalPagado: 1000 },
            ];
            const { svc, transaction } = await makeService(rows);

            const result = await svc.consolidar(
                { tipo: 'DEUDORES', deudorIds: [1] },
                { dryRun: false },
            );

            expect(result.evaluados).toBe(1);
            expect(result.conPagos).toBe(1);
            expect(result.aSIT050).toBe(1);
            expect(result.aSIT041).toBe(0);
            expect(result.sinCambios).toBe(0);
            expect(transaction).toHaveBeenCalled();
        });
    });

    // ── Caso 2: pago dentro de tolerancia (99%) → SIT-050 ──────────────────
    describe('pago dentro de tolerancia (99%)', () => {
        it('considera cancelado con tolerancia default 1%', async () => {
            const rows: DeudorRow[] = [
                { id: 2, montoTotal: 1000, estadoSituacionId: null, saldo: 10, totalPagado: 990 },
            ];
            const { svc, transaction } = await makeService(rows);

            const result = await svc.consolidar({ tipo: 'DEUDORES', deudorIds: [2] });

            expect(result.aSIT050).toBe(1);
            expect(result.aSIT041).toBe(0);
            expect(transaction).toHaveBeenCalled();
        });

        it('con tolerancia 0% y pago 99% → SIT-041 (no alcanza umbral exacto)', async () => {
            const rows: DeudorRow[] = [
                { id: 2, montoTotal: 1000, estadoSituacionId: null, saldo: 10, totalPagado: 990 },
            ];
            const { svc } = await makeService(rows, '0');

            const result = await svc.consolidar({ tipo: 'DEUDORES', deudorIds: [2] });

            expect(result.aSIT050).toBe(0);
            expect(result.aSIT041).toBe(1);
        });
    });

    // ── Caso 3: pago parcial (50%) → SIT-041 ───────────────────────────────
    describe('pago parcial (50% del total)', () => {
        it('asigna SIT-041', async () => {
            const rows: DeudorRow[] = [
                { id: 3, montoTotal: 1000, estadoSituacionId: null, saldo: 500, totalPagado: 500 },
            ];
            const { svc, transaction } = await makeService(rows);

            const result = await svc.consolidar({ tipo: 'DEUDORES', deudorIds: [3] });

            expect(result.aSIT041).toBe(1);
            expect(result.aSIT050).toBe(0);
            expect(transaction).toHaveBeenCalled();
        });
    });

    // ── Caso 4: deudor sin pagos → skip ────────────────────────────────────
    describe('deudor sin pagos', () => {
        it('no incrementa conPagos; sí incrementa evaluados y sinCambios', async () => {
            const rows: DeudorRow[] = [
                { id: 4, montoTotal: 1000, estadoSituacionId: null, saldo: null, totalPagado: 0 },
            ];
            const { svc, transaction } = await makeService(rows);

            const result = await svc.consolidar({ tipo: 'DEUDORES', deudorIds: [4] });

            expect(result.evaluados).toBe(1);
            expect(result.conPagos).toBe(0);
            expect(result.aSIT050).toBe(0);
            expect(result.aSIT041).toBe(0);
            expect(result.sinCambios).toBe(1);
            // Sin cambios → no debe escribirse nada
            expect(transaction).not.toHaveBeenCalled();
        });
    });

    // ── Caso 5: pagos > montoTotal → SIT-050, saldo = 0 ────────────────────
    describe('pagos superiores al montoTotal', () => {
        it('asigna SIT-050 y nunca produce saldo negativo', async () => {
            const rows: DeudorRow[] = [
                { id: 5, montoTotal: 1000, estadoSituacionId: null, saldo: null, totalPagado: 1500 },
            ];
            const { svc } = await makeService(rows);

            const result = await svc.consolidar({ tipo: 'DEUDORES', deudorIds: [5] });

            expect(result.aSIT050).toBe(1);
            expect(result.aSIT041).toBe(0);
            // saldo era null → cambió a 0 → saldoActualizado = 1
            expect(result.saldoActualizado).toBe(1);
        });
    });

    // ── Caso 6: idempotencia ────────────────────────────────────────────────
    describe('idempotencia', () => {
        it('segunda ejecución con mismo estado → sinCambios, sin nuevas escrituras', async () => {
            const rows: DeudorRow[] = [
                { id: 6, montoTotal: 1000, estadoSituacionId: null, saldo: null, totalPagado: 1000 },
            ];
            const { svc, prisma, transaction } = await makeService(rows);

            // Primera pasada
            await svc.consolidar({ tipo: 'DEUDORES', deudorIds: [6] });
            const callsAfterFirst = transaction.mock.calls.length;

            // Simular estado post-apply: SIT-050 y saldo = 0
            const rowsPostApply: DeudorRow[] = [
                { id: 6, montoTotal: 1000, estadoSituacionId: SIT050_ID, saldo: 0, totalPagado: 1000 },
            ];
            prisma.$queryRaw.mockResolvedValue(rowsPostApply);

            // Segunda pasada
            const result2 = await svc.consolidar({ tipo: 'DEUDORES', deudorIds: [6] });

            expect(result2.sinCambios).toBe(1);
            expect(result2.aSIT050).toBe(0);
            expect(result2.aSIT041).toBe(0);
            // No debe haber habido nuevas llamadas a $transaction
            expect(transaction.mock.calls.length).toBe(callsAfterFirst);
        });
    });

    // ── Caso 7: montoTotal nulo con pagos → skip con warn ───────────────────
    describe('deudor con montoTotal nulo', () => {
        it('lo skipea (sinCambios) sin incrementar evaluados', async () => {
            const rows: DeudorRow[] = [
                { id: 7, montoTotal: null, estadoSituacionId: null, saldo: null, totalPagado: 500 },
            ];
            const { svc } = await makeService(rows);

            const result = await svc.consolidar({ tipo: 'DEUDORES', deudorIds: [7] });

            expect(result.evaluados).toBe(0);
            expect(result.sinCambios).toBe(1);
            expect(result.aSIT050).toBe(0);
            expect(result.aSIT041).toBe(0);
        });
    });

    // ── Caso 8: dryRun → sin escrituras en DB ───────────────────────────────
    describe('dryRun', () => {
        it('calcula contadores correctamente pero NO ejecuta $transaction (SIT-041)', async () => {
            const rows: DeudorRow[] = [
                { id: 8, montoTotal: 1000, estadoSituacionId: null, saldo: null, totalPagado: 600 },
            ];
            const { svc, transaction } = await makeService(rows);

            const result = await svc.consolidar(
                { tipo: 'DEUDORES', deudorIds: [8] },
                { dryRun: true },
            );

            expect(result.aSIT041).toBe(1);
            expect(result.evaluados).toBe(1);
            expect(transaction).not.toHaveBeenCalled();
        });

        it('pago cancelador en dryRun → SIT-050 en contadores, sin escrituras', async () => {
            const rows: DeudorRow[] = [
                { id: 9, montoTotal: 1000, estadoSituacionId: null, saldo: null, totalPagado: 995 },
            ];
            const { svc, transaction } = await makeService(rows);

            const result = await svc.consolidar(
                { tipo: 'DEUDORES', deudorIds: [9] },
                { dryRun: true },
            );

            expect(result.aSIT050).toBe(1);
            expect(transaction).not.toHaveBeenCalled();
        });
    });

    // ── Caso 9: bootstrap — tolerancia fuera de rango ───────────────────────
    describe('onModuleInit — validación de CONSOLIDACION_TOLERANCIA_PCT', () => {
        it('falla si la tolerancia supera el máximo (0.06)', async () => {
            process.env.CONSOLIDACION_TOLERANCIA_PCT = '0.06';
            const { prisma } = makePrisma([]);
            const auditoria = { log: jest.fn() } as any;
            const svc = new ConsolidacionSituacionService(prisma, auditoria);

            await expect(svc.onModuleInit()).rejects.toThrow(
                /CONSOLIDACION_TOLERANCIA_PCT.*fuera del rango/,
            );
        });

        it('falla si la tolerancia es un valor no numérico', async () => {
            process.env.CONSOLIDACION_TOLERANCIA_PCT = 'no-es-numero';
            const { prisma } = makePrisma([]);
            const auditoria = { log: jest.fn() } as any;
            const svc = new ConsolidacionSituacionService(prisma, auditoria);

            await expect(svc.onModuleInit()).rejects.toThrow(
                /CONSOLIDACION_TOLERANCIA_PCT.*fuera del rango/,
            );
        });
    });

    // ── Caso 10: bootstrap — parámetros SIT no seedeados ────────────────────
    describe('onModuleInit — parámetros SIT no seedeados', () => {
        it('falla si SIT-050 no está seedeado', async () => {
            process.env.CONSOLIDACION_TOLERANCIA_PCT = '0.01';
            const prisma = {
                parametro: {
                    findUnique: jest.fn().mockResolvedValue(null),
                },
            } as any;
            const auditoria = { log: jest.fn() } as any;
            const svc = new ConsolidacionSituacionService(prisma, auditoria);

            await expect(svc.onModuleInit()).rejects.toThrow(/SIT-050/);
        });

        it('falla si SIT-041 no está seedeado pero SIT-050 sí', async () => {
            process.env.CONSOLIDACION_TOLERANCIA_PCT = '0.01';
            const prisma = {
                parametro: {
                    findUnique: jest.fn().mockImplementation(({ where }: { where: { clave: string } }) => {
                        if (where.clave === 'SIT-050') {
                            return Promise.resolve({ id: SIT050_ID, clave: 'SIT-050' });
                        }
                        return Promise.resolve(null);
                    }),
                },
            } as any;
            const auditoria = { log: jest.fn() } as any;
            const svc = new ConsolidacionSituacionService(prisma, auditoria);

            await expect(svc.onModuleInit()).rejects.toThrow(/SIT-041/);
        });
    });

    // ── Caso 11: onProgress callback ────────────────────────────────────────
    describe('onProgress callback', () => {
        it('llama onProgress con avance y total al terminar cada chunk', async () => {
            const rows: DeudorRow[] = [
                { id: 10, montoTotal: 1000, estadoSituacionId: null, saldo: null, totalPagado: 500 },
                { id: 11, montoTotal: 500, estadoSituacionId: null, saldo: null, totalPagado: 0 },
            ];
            const { svc } = await makeService(rows);

            const onProgress = jest.fn();

            await svc.consolidar(
                { tipo: 'DEUDORES', deudorIds: [10, 11] },
                { onProgress, batchSize: 500 },
            );

            // Un solo chunk de 2 deudores
            expect(onProgress).toHaveBeenCalledTimes(1);
            expect(onProgress).toHaveBeenCalledWith(2, 2);
        });
    });
});
