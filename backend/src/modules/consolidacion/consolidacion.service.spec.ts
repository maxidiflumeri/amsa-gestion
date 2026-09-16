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

/** Una fila de la agregación de pagos-con-clave por caso (fase 4a, spec §10.5a). */
interface ClaveRow {
    deudorId: number;
    claveId: number;
    nroConvenio: string;
    tipoClave: 'TOTAL' | 'QUITA';
    importeClave: number;
    nroTramite: string;
    nroClienteCaso: string;
    pagadoClave: number;
    mayorPagoClave: number;
    ultimaFecha: Date;
}

/** Un convenio `CLAVE_PAGO` ACTIVO (regla de respaldo, §10.10). */
interface ConvenioClaveRow {
    id: number;
    deudorId: number;
    montoTotal: number;
    importeQuita: number | null;
    createdAt: Date;
    clavePagoId: number;
    clavePago: { nroConvenio: string };
}

/**
 * Construye un mock de PrismaService que responde con las filas provistas.
 * updateMany / $executeRaw / $transaction son stubs que rastrean llamadas.
 *
 * Fase 4a: `$queryRaw` se llama DOS veces por chunk (la agregación de siempre, y la de
 * pagos-con-clave, §10.5a) — se distinguen por el texto de la query (`clave_pago`), igual que
 * `procesarChunk` las arma con templates distintos. `convenio.findMany` (regla de respaldo,
 * §10.10) y `cuota_convenio.updateMany` (D17) están vacíos/no-op por default: una empresa sin
 * multiclaves no debería ni notar que existen.
 */
function makePrisma(
    rows: DeudorRow[],
    claveRows: ClaveRow[] = [],
    conveniosClave: ConvenioClaveRow[] = [],
    conveniosActivosPorClaveId: Array<{ id: number; clavePagoId: number }> = [],
) {
    const updateMany = jest.fn().mockResolvedValue({ count: rows.length });
    const executeRaw = jest.fn().mockResolvedValue(1);
    const transaction = jest.fn().mockImplementation(async (ops: any[]) => {
        return Promise.all(ops.map((op: any) => (typeof op?.then === 'function' ? op : Promise.resolve(op))));
    });
    const cuotaUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const convenioFindManyActivos = jest.fn().mockImplementation(({ where }: any) => {
        if (where?.clavePagoId?.in) {
            return Promise.resolve(conveniosActivosPorClaveId.filter((c) => where.clavePagoId.in.includes(c.clavePagoId)));
        }
        return Promise.resolve(conveniosClave);
    });

    const queryRaw = jest.fn().mockImplementation((strings: TemplateStringsArray) => {
        const sql = Array.isArray(strings) ? strings.join('') : String(strings);
        if (sql.includes('clave_pago')) return Promise.resolve(claveRows);
        return Promise.resolve(rows);
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
                if (where.clave === 'SIT-054') {
                    return Promise.resolve(null); // por default no seedeado — cada test lo pisa si lo necesita
                }
                return Promise.resolve(null);
            }),
        },
        deudor: {
            findMany: jest.fn().mockResolvedValue(rows.map((r) => ({ id: r.id }))),
            updateMany,
        },
        convenio: {
            findMany: convenioFindManyActivos,
        },
        cuota_convenio: {
            updateMany: cuotaUpdateMany,
        },
        pago: {
            aggregate: jest.fn().mockResolvedValue({ _sum: { importe: 0 }, _max: { fecha: null } }),
        },
        $queryRaw: queryRaw,
        $executeRaw: executeRaw,
        $transaction: transaction,
    } as any;

    return { prisma, updateMany, executeRaw, transaction, cuotaUpdateMany };
}

/** Helper para instanciar y pre-inicializar el service. */
async function makeService(
    rows: DeudorRow[],
    toleranciaEnv?: string,
    claveRows: ClaveRow[] = [],
    conveniosClave: ConvenioClaveRow[] = [],
    conveniosActivosPorClaveId: Array<{ id: number; clavePagoId: number }> = [],
): Promise<{
    svc: ConsolidacionSituacionService;
    prisma: ReturnType<typeof makePrisma>['prisma'];
    updateMany: jest.Mock;
    executeRaw: jest.Mock;
    transaction: jest.Mock;
    cuotaUpdateMany: jest.Mock;
}> {
    if (toleranciaEnv !== undefined) {
        process.env.CONSOLIDACION_TOLERANCIA_PCT = toleranciaEnv;
    } else {
        process.env.CONSOLIDACION_TOLERANCIA_PCT = '0.01'; // 1% default
    }

    const { prisma, updateMany, executeRaw, transaction, cuotaUpdateMany } = makePrisma(rows, claveRows, conveniosClave, conveniosActivosPorClaveId);
    const auditoria = { log: jest.fn().mockResolvedValue(undefined) } as any;

    const svc = new ConsolidacionSituacionService(prisma, auditoria);
    await svc.onModuleInit();

    return { svc, prisma, updateMany, executeRaw, transaction, cuotaUpdateMany };
}

// ─── Limpieza ─────────────────────────────────────────────────────────────────
afterEach(() => {
    delete process.env.CONSOLIDACION_TOLERANCIA_PCT;
    delete process.env.CONSOLIDACION_TOLERANCIA_CLAVE_CENTAVOS;
    delete process.env.CONSOLIDACION_CLAVE_MODO;
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

    // ── Fase 4a de multiclaves: cancelación por pago de clave (docs/multiclaves-spec.md §10) ──
    describe('fase 4a — regla (a): pago con referenciaClave que matchea una clave (§10.5)', () => {
        const claveQuita = (over: Partial<ClaveRow> = {}): ClaveRow => ({
            deudorId: 20,
            claveId: 1,
            nroConvenio: '96234420',
            tipoClave: 'QUITA',
            importeClave: 15500,
            nroTramite: '1981517609',
            nroClienteCaso: '1981517609',
            pagadoClave: 15500,
            mayorPagoClave: 15500,
            ultimaFecha: new Date('2026-09-10'),
            ...over,
        });

        it('clave QUITA cumplida → SIT-054, saldo 0, aSIT054=1 (con SIT-054 seedeado)', async () => {
            const rows: DeudorRow[] = [
                { id: 20, montoTotal: 31000, estadoSituacionId: null, saldo: 31000, totalPagado: 15500 },
            ];
            const { prisma, ...rest } = makePrisma(rows, [claveQuita()]);
            prisma.parametro.findUnique = jest.fn().mockImplementation(({ where }: any) => {
                if (where.clave === 'SIT-050') return Promise.resolve({ id: SIT050_ID });
                if (where.clave === 'SIT-041') return Promise.resolve({ id: SIT041_ID });
                if (where.clave === 'SIT-054') return Promise.resolve({ id: 54 });
                return Promise.resolve(null);
            });
            const svc = new ConsolidacionSituacionService(prisma, { log: jest.fn().mockResolvedValue(undefined) } as any);
            await svc.onModuleInit();

            const result = await svc.consolidar({ tipo: 'DEUDORES', deudorIds: [20] });

            expect(result.aSIT054).toBe(1);
            expect(result.aSIT050).toBe(0);
            expect(result.aSIT050PorClave).toBe(0);
            expect(result.sit054Degradado).toBe(0);
            expect(rest.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: { id: { in: [20] } }, data: expect.objectContaining({ estadoSituacionId: 54, saldo: 0 }) }),
            );
        });

        it('clave TOTAL cumplida → SIT-050 con aSIT050PorClave=1, aSIT054=0', async () => {
            const rows: DeudorRow[] = [
                { id: 21, montoTotal: 39760.03, estadoSituacionId: null, saldo: 39760.03, totalPagado: 39760.03 },
            ];
            const claveTotal = claveQuita({ deudorId: 21, claveId: 2, tipoClave: 'TOTAL', importeClave: 39760.03, pagadoClave: 39760.03, mayorPagoClave: 39760.03 });
            const { svc } = await makeService(rows, undefined, [claveTotal]);

            const result = await svc.consolidar({ tipo: 'DEUDORES', deudorIds: [21] });

            expect(result.aSIT050).toBe(1);
            expect(result.aSIT050PorClave).toBe(1);
            expect(result.aSIT054).toBe(0);
        });

        it('caso con las dos claves pagadas → gana TOTAL, determinista sin importar el orden de las filas', async () => {
            const rows: DeudorRow[] = [
                { id: 22, montoTotal: 39760.03, estadoSituacionId: null, saldo: 39760.03, totalPagado: 39760.03 },
            ];
            const quita = claveQuita({ deudorId: 22, claveId: 3 });
            const total = claveQuita({ deudorId: 22, claveId: 4, tipoClave: 'TOTAL', importeClave: 39760.03, pagadoClave: 39760.03, mayorPagoClave: 39760.03 });

            for (const orden of [[quita, total], [total, quita]]) {
                const { svc } = await makeService(rows, undefined, orden);
                const result = await svc.consolidar({ tipo: 'DEUDORES', deudorIds: [22] }, { dryRun: true });
                expect(result.aSIT050PorClave).toBe(1);
                expect(result.aSIT054).toBe(0);
            }
        });

        it('el saldo NO se recalcula con GREATEST: queda en 0 aunque montoTotal sea mayor', async () => {
            const rows: DeudorRow[] = [
                { id: 23, montoTotal: 31000, estadoSituacionId: null, saldo: 31000, totalPagado: 15500 },
            ];
            const { svc, executeRaw, updateMany } = await makeService(rows, undefined, [claveQuita({ deudorId: 23 })]);

            await svc.consolidar({ tipo: 'DEUDORES', deudorIds: [23] });

            // El grupo de "cancelados por clave" no pasa por ningún $executeRaw de recálculo.
            expect(executeRaw).not.toHaveBeenCalled();
            expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ saldo: 0 }) }));
        });

        it('idempotencia: segunda corrida sobre un cancelado con quita → sinCambios, cuotas no se tocan de nuevo', async () => {
            const rows: DeudorRow[] = [
                { id: 24, montoTotal: 31000, estadoSituacionId: 54, saldo: 0, totalPagado: 15500 },
            ];
            const { svc, transaction } = await makeService(rows, undefined, [claveQuita({ deudorId: 24 })]);
            // SIT-054 seedeado para que compare contra el id real.
            (svc as any).sit054Id = 54;

            const result = await svc.consolidar({ tipo: 'DEUDORES', deudorIds: [24] });

            expect(result.sinCambios).toBe(1);
            expect(result.aSIT054).toBe(0);
            expect(transaction).not.toHaveBeenCalled();
        });

        it('REGRESIÓN: un chunk sin ningún pago con clave da los mismos contadores que antes del cambio', async () => {
            const rows: DeudorRow[] = [
                { id: 25, montoTotal: 1000, estadoSituacionId: null, saldo: null, totalPagado: 1000 },
            ];
            const { svc } = await makeService(rows); // sin claveRows

            const result = await svc.consolidar({ tipo: 'DEUDORES', deudorIds: [25] });

            expect(result.aSIT050).toBe(1);
            expect(result.aSIT054).toBe(0);
            expect(result.aSIT050PorClave).toBe(0);
            expect(result.sit054Degradado).toBe(0);
        });

        it('tolerancia en centavos: pagado = importe − 100 centavos → cancela; − 101 → no', async () => {
            const rowsOk: DeudorRow[] = [{ id: 26, montoTotal: 31000, estadoSituacionId: null, saldo: 31000, totalPagado: 0 }];
            const claveOk = claveQuita({ deudorId: 26, importeClave: 15500, pagadoClave: 15499, mayorPagoClave: 15499 });
            const { svc: svcOk } = await makeService(rowsOk, undefined, [claveOk]);
            const resultOk = await svcOk.consolidar({ tipo: 'DEUDORES', deudorIds: [26] }, { dryRun: true });
            expect(resultOk.aSIT054).toBe(1);

            const rowsNo: DeudorRow[] = [{ id: 27, montoTotal: 31000, estadoSituacionId: null, saldo: 31000, totalPagado: 0 }];
            const claveNo = claveQuita({ deudorId: 27, importeClave: 15500, pagadoClave: 15498.99, mayorPagoClave: 15498.99 });
            const { svc: svcNo } = await makeService(rowsNo, undefined, [claveNo]);
            const resultNo = await svcNo.consolidar({ tipo: 'DEUDORES', deudorIds: [27] }, { dryRun: true });
            expect(resultNo.aSIT054).toBe(0);
            expect(resultNo.aSIT041).toBe(0); // Σpagos=0 → sinCambios por la regla de siempre
        });

        it('CONSOLIDACION_TOLERANCIA_CLAVE_CENTAVOS fuera de rango falla el arranque', async () => {
            process.env.CONSOLIDACION_TOLERANCIA_CLAVE_CENTAVOS = '5000';
            const { prisma } = makePrisma([]);
            const svc = new ConsolidacionSituacionService(prisma, { log: jest.fn() } as any);
            await expect(svc.onModuleInit()).rejects.toThrow(/CONSOLIDACION_TOLERANCIA_CLAVE_CENTAVOS/);
        });

        it('CONSOLIDACION_CLAVE_MODO inválido falla el arranque', async () => {
            process.env.CONSOLIDACION_CLAVE_MODO = 'RARO';
            const { prisma } = makePrisma([]);
            const svc = new ConsolidacionSituacionService(prisma, { log: jest.fn() } as any);
            await expect(svc.onModuleInit()).rejects.toThrow(/CONSOLIDACION_CLAVE_MODO/);
        });

        it('PAGO_UNICO: dos pagos que suman el importe NO cancelan; SUMA sí', async () => {
            const rows: DeudorRow[] = [{ id: 28, montoTotal: 31000, estadoSituacionId: null, saldo: 31000, totalPagado: 0 }];
            const clave = claveQuita({ deudorId: 28, importeClave: 15500, pagadoClave: 15500, mayorPagoClave: 7750 });

            process.env.CONSOLIDACION_CLAVE_MODO = 'PAGO_UNICO';
            const { svc: svcUnico } = await makeService(rows, undefined, [clave]);
            const resultUnico = await svcUnico.consolidar({ tipo: 'DEUDORES', deudorIds: [28] }, { dryRun: true });
            expect(resultUnico.aSIT054).toBe(0);

            delete process.env.CONSOLIDACION_CLAVE_MODO;
            const { svc: svcSuma } = await makeService(rows, undefined, [clave]);
            const resultSuma = await svcSuma.consolidar({ tipo: 'DEUDORES', deudorIds: [28] }, { dryRun: true });
            expect(resultSuma.aSIT054).toBe(1);
        });

        it('clave cumplida con montoTotal null → cancela igual (antes del salteo de montoTotal nulo)', async () => {
            const rows: DeudorRow[] = [{ id: 29, montoTotal: null, estadoSituacionId: null, saldo: null, totalPagado: 15500 }];
            const { svc } = await makeService(rows, undefined, [claveQuita({ deudorId: 29 })]);
            const result = await svc.consolidar({ tipo: 'DEUDORES', deudorIds: [29] }, { dryRun: true });
            expect(result.aSIT054).toBe(1);
            expect(result.evaluados).toBe(1);
        });

        it('Σpagos=0 por un ajuste negativo con la clave pagada → cancela igual (antes del salteo de Σpagos=0)', async () => {
            const rows: DeudorRow[] = [{ id: 30, montoTotal: 31000, estadoSituacionId: null, saldo: 31000, totalPagado: 0 }];
            const { svc } = await makeService(rows, undefined, [claveQuita({ deudorId: 30 })]);
            const result = await svc.consolidar({ tipo: 'DEUDORES', deudorIds: [30] }, { dryRun: true });
            expect(result.aSIT054).toBe(1);
        });

        it('nroTramite de la clave distinto del nroCliente del caso → NO cancela, loguea warn', async () => {
            const rows: DeudorRow[] = [{ id: 31, montoTotal: 31000, estadoSituacionId: null, saldo: 31000, totalPagado: 0 }];
            const claveDesalineada = claveQuita({ deudorId: 31, nroClienteCaso: '999999999' });
            const { svc } = await makeService(rows, undefined, [claveDesalineada]);
            const warnSpy = jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => {});

            const result = await svc.consolidar({ tipo: 'DEUDORES', deudorIds: [31] }, { dryRun: true });

            expect(result.aSIT054).toBe(0);
            expect(warnSpy).toHaveBeenCalled();
        });

        it('clave REEMPLAZADA o vencida cancela igual (la query no filtra por estado ni vencimiento)', async () => {
            // El join de §10.5a no filtra `clave_pago.estado` ni `fechaVencimiento`: si el archivo
            // trae el convenio pagado, cancela sin importar el estado de la clave en la base (R8/R11).
            const rows: DeudorRow[] = [{ id: 32, montoTotal: 31000, estadoSituacionId: null, saldo: 31000, totalPagado: 0 }];
            const { svc } = await makeService(rows, undefined, [claveQuita({ deudorId: 32 })]);
            const result = await svc.consolidar({ tipo: 'DEUDORES', deudorIds: [32] }, { dryRun: true });
            expect(result.aSIT054).toBe(1);
        });

        it('SIT-054 ausente: no lanza, cancela a SIT-050 con sit054Degradado, y se autocorrige al crear el código', async () => {
            const rows: DeudorRow[] = [
                { id: 33, montoTotal: 31000, estadoSituacionId: null, saldo: 31000, totalPagado: 15500 },
            ];
            const { svc } = await makeService(rows, undefined, [claveQuita({ deudorId: 33 })]); // SIT-054 no seedeado

            const result = await svc.consolidar({ tipo: 'DEUDORES', deudorIds: [33] });
            expect(result.aSIT054).toBe(1); // el contador de negocio sigue siendo "cancelado con quita"
            expect(result.sit054Degradado).toBe(1);

            // Ahora se crea el código y se refresca el cache — la corrida siguiente ya no degrada.
            (svc as any).sit054Id = 54;
            const rows2: DeudorRow[] = [
                { id: 33, montoTotal: 31000, estadoSituacionId: SIT050_ID, saldo: 0, totalPagado: 15500 },
            ];
            (svc as any).prisma.$queryRaw = jest.fn().mockImplementation((strings: TemplateStringsArray) => {
                const sql = strings.join('');
                if (sql.includes('clave_pago')) return Promise.resolve([claveQuita({ deudorId: 33 })]);
                return Promise.resolve(rows2);
            });
            const result2 = await svc.consolidar({ tipo: 'DEUDORES', deudorIds: [33] });
            expect(result2.sit054Degradado).toBe(0);
            expect(result2.aSIT054).toBe(1);
        });

        it('convenio ACTIVO de la clave del caso: la cuota pasa a PAGADA, el convenio sigue ACTIVO (D17)', async () => {
            const rows: DeudorRow[] = [
                { id: 34, montoTotal: 31000, estadoSituacionId: null, saldo: 31000, totalPagado: 15500 },
            ];
            const { svc, cuotaUpdateMany } = await makeService(
                rows, undefined, [claveQuita({ deudorId: 34, claveId: 77 })],
                [], [{ id: 900, clavePagoId: 77 }],
            );

            await svc.consolidar({ tipo: 'DEUDORES', deudorIds: [34] });

            expect(cuotaUpdateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { convenioId: 900, estado: { in: ['PENDIENTE', 'VENCIDA'] } },
                    data: expect.objectContaining({ estado: 'PAGADA' }),
                }),
            );
        });

        it('prioridad: pago de la clave TOTAL + convenio ACTIVO de la QUITA → SIT-050, no SIT-054', async () => {
            const rows: DeudorRow[] = [
                { id: 35, montoTotal: 39760.03, estadoSituacionId: null, saldo: 39760.03, totalPagado: 39760.03 },
            ];
            const claveTotal = claveQuita({ deudorId: 35, claveId: 5, tipoClave: 'TOTAL', importeClave: 39760.03, pagadoClave: 39760.03, mayorPagoClave: 39760.03 });
            // El convenio de respaldo es de la QUITA, pero la regla (a) ya resolvió con la TOTAL —
            // la (b) no se evalúa.
            const convenioQuita: ConvenioClaveRow = {
                id: 1, deudorId: 35, montoTotal: 19880.01, importeQuita: 19880.02, createdAt: new Date('2026-08-01'),
                clavePagoId: 6, clavePago: { nroConvenio: '96332206' },
            };
            const { svc } = await makeService(rows, undefined, [claveTotal], [convenioQuita]);

            const result = await svc.consolidar({ tipo: 'DEUDORES', deudorIds: [35] }, { dryRun: true });

            expect(result.aSIT050PorClave).toBe(1);
            expect(result.aSIT054).toBe(0);
        });

        it('dryRun: cuenta aSIT054 sin escribir situación, saldo ni cuotas', async () => {
            const rows: DeudorRow[] = [
                { id: 36, montoTotal: 31000, estadoSituacionId: null, saldo: 31000, totalPagado: 15500 },
            ];
            const { svc, updateMany, transaction } = await makeService(rows, undefined, [claveQuita({ deudorId: 36 })]);

            const result = await svc.consolidar({ tipo: 'DEUDORES', deudorIds: [36] }, { dryRun: true });

            expect(result.aSIT054).toBe(1);
            expect(updateMany).not.toHaveBeenCalled();
            expect(transaction).not.toHaveBeenCalled();
        });
    });

    describe('fase 4a — regla (b) DESCARTADA en la auditoría (§10.10, §20 del spec)', () => {
        // La primera versión de esta fase tenía una regla de respaldo: un convenio `CLAVE_PAGO`
        // ACTIVO con Σpagos (desde su fecha de creación) ≥ su `montoTotal` cancelaba con quita, SIN
        // mirar `pago.referenciaClave`. Un auditor midió que esto condona deuda sin respaldo: un
        // cobro COMÚN de $16.000 contra una deuda de $31.000, con un cupón de quita YA EMITIDO
        // (convenio `CLAVE_PAGO` ACTIVO), dejaba el caso "Cancelado con quita" con saldo 0 —
        // perdonando $15.000 porque el monto acumulado alcanzaba, sin que el archivo del cedente
        // dijera que se pagó ESA clave. Se sacó la regla (b) del alcance: ver el comentario de
        // cabecera de `consolidacion.service.ts` y `docs/multiclaves-spec.md` §10.10.
        it('un pago SIN referenciaClave no cancela con quita, aunque el caso tenga un convenio CLAVE_PAGO ACTIVO cumplido por monto', async () => {
            const rows: DeudorRow[] = [
                // Repro exacto de la auditoría: deuda $31.000, cobro común $16.000 (51,6% — no
                // alcanza el 99% de tolerancia de la regla de siempre → tiene que quedar en SIT-041).
                { id: 40, montoTotal: 31000, estadoSituacionId: null, saldo: 31000, totalPagado: 16000 },
            ];
            // Este pago NO tiene `referenciaClave` (no está en `claveRows`): es un cobro común. El
            // convenio de quita existe (se emitió un cupón), pero sin la regla (b) no hay código que
            // lo consulte para decidir una cancelación.
            const { svc } = await makeService(rows);

            const result = await svc.consolidar({ tipo: 'DEUDORES', deudorIds: [40] });

            expect(result.aSIT054).toBe(0);
            expect(result.aSIT050PorClave).toBe(0);
            expect(result.aSIT041).toBe(1);
            expect(result.aSIT050).toBe(0);
        });

        it('la única regla es la del archivo: sin `pago.referenciaClave` en NINGÚN pago, un caso con montoTotal null tampoco cancela con quita', async () => {
            const rows: DeudorRow[] = [
                { id: 41, montoTotal: null, estadoSituacionId: null, saldo: null, totalPagado: 500 },
            ];
            const { svc } = await makeService(rows);
            const result = await svc.consolidar({ tipo: 'DEUDORES', deudorIds: [41] }, { dryRun: true });
            expect(result.aSIT054).toBe(0);
            expect(result.aSIT050PorClave).toBe(0);
            expect(result.sinCambios).toBe(1); // cae en el salteo de `montoTotal` nulo de siempre
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
