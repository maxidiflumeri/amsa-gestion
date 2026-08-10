/**
 * Camino por lote de FACTURAS.
 *
 * Lo que se verifica acá es que el lote produzca el mismo resultado que el camino fila por fila
 * —mismas facturas, mismos errores, mismo `montoTotal` recalculado— pero con una fracción de las
 * consultas: con las 1.115.323 partidas de una bajada de AYSA, dos queries por fila son horas.
 */
import { FacturasProcessor } from './facturas.processor';
import { BatchRow, ProcessContext } from './processor.interface';

/** Prisma mockeado con una "base" en memoria de deudores y facturas. */
function makeCtx(deudores: Array<{ id: number; nroCliente: string }>) {
    const facturas = new Map<string, any>();
    const findMany = jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(
            deudores
                .filter((d) => where.nroCliente.in.includes(d.nroCliente))
                .map((d) => ({ id: d.id, nroCliente: d.nroCliente })),
        ),
    );
    // `$executeRaw` recibe el template ya armado por Prisma.sql: se leen los valores del INSERT.
    const executeRaw = jest.fn().mockImplementation((sql: any) => {
        const texto: string = sql.strings?.join('?') ?? '';
        if (!texto.includes('INSERT INTO factura')) return Promise.resolve(0);
        // Los valores van de a 5 (deudorId, nroFactura, importe, fechaEmision, vencimiento).
        for (let i = 0; i + 4 < sql.values.length; i += 5) {
            const [deudorId, nroFactura, importe, fechaEmision, vencimiento] = sql.values.slice(i, i + 5);
            facturas.set(`${deudorId}|${nroFactura}`, { deudorId, nroFactura, importe, fechaEmision, vencimiento });
        }
        return Promise.resolve(sql.values.length / 5);
    });
    const upsert = jest.fn().mockImplementation(({ where, create, update }: any) => {
        const k = `${where.deudorId_nroFactura.deudorId}|${where.deudorId_nroFactura.nroFactura}`;
        const previa = facturas.get(k);
        facturas.set(k, previa
            ? { ...previa, ...Object.fromEntries(Object.entries(update).filter(([, v]) => v !== undefined)) }
            : create);
        return Promise.resolve(facturas.get(k));
    });

    const ctx = {
        prisma: { deudor: { findMany }, factura: { upsert }, $executeRaw: executeRaw },
        remesaId: 10,
        remesaOrigenId: 9,
        empresaId: 5,
        montoDeudorDesdeFacturas: 'SI_VACIO',
        consolidacion: { consolidar: jest.fn().mockResolvedValue({}) },
    } as unknown as ProcessContext;

    return { ctx, facturas, findMany, executeRaw, upsert };
}

const fila = (idx: number, nroCliente: string, nroFactura: string, extra: Record<string, any> = {}): BatchRow => ({
    idx,
    row: {
        nro_cliente: nroCliente,
        nroFactura,
        importe: 1000,
        vencimiento: new Date('2026-06-28'),
        fechaEmision: new Date('2026-06-01'),
        ...extra,
    },
});

describe('FacturasProcessor — camino por lote', () => {
    it('resuelve todos los deudores del lote con una sola consulta', async () => {
        const { ctx, findMany } = makeCtx([
            { id: 1, nroCliente: '000003662688' },
            { id: 2, nroCliente: '000003667638' },
        ]);
        const p = new FacturasProcessor();

        await p.processBatch(
            [
                fila(0, '000003662688', 'B17307544A'),
                fila(1, '000003662688', 'B13422212A'),
                fila(2, '000003667638', 'B10371985A'),
            ],
            ctx,
        );

        // Tres filas, dos clientes distintos: una sola query, no tres.
        expect(findMany).toHaveBeenCalledTimes(1);
        expect(findMany.mock.calls[0][0].where.nroCliente.in).toEqual(['000003662688', '000003667638']);
    });

    it('cachea los deudores entre lotes: el segundo lote no vuelve a buscarlos', async () => {
        const { ctx, findMany } = makeCtx([{ id: 1, nroCliente: '000003662688' }]);
        const p = new FacturasProcessor();

        await p.processBatch([fila(0, '000003662688', 'A')], ctx);
        await p.processBatch([fila(1, '000003662688', 'B')], ctx);

        expect(findMany).toHaveBeenCalledTimes(1);
    });

    it('escribe las facturas en un solo statement por chunk', async () => {
        const { ctx, executeRaw, facturas } = makeCtx([{ id: 1, nroCliente: '001' }]);
        const p = new FacturasProcessor();

        const rows = Array.from({ length: 50 }, (_, i) => fila(i, '001', `F${i}`));
        const errores = await p.processBatch(rows, ctx);

        expect(errores).toEqual([]);
        expect(executeRaw).toHaveBeenCalledTimes(1);
        expect(facturas.size).toBe(50);
        expect(facturas.get('1|F0')).toMatchObject({ deudorId: 1, nroFactura: 'F0', importe: 1000 });
    });

    it('parte en chunks los lotes grandes en vez de armar un statement gigante', async () => {
        const { ctx, executeRaw } = makeCtx([{ id: 1, nroCliente: '001' }]);
        const p = new FacturasProcessor();

        await p.processBatch(Array.from({ length: 1200 }, (_, i) => fila(i, '001', `F${i}`)), ctx);

        expect(executeRaw).toHaveBeenCalledTimes(3); // 500 + 500 + 200
    });

    it('reporta el deudor no encontrado en su fila, sin voltear el lote', async () => {
        const { ctx, facturas } = makeCtx([{ id: 1, nroCliente: '001' }]);
        const p = new FacturasProcessor();

        const errores = await p.processBatch(
            [fila(0, '001', 'A'), fila(1, '999', 'B'), fila(2, '001', 'C')],
            ctx,
        );

        expect(errores).toEqual([{ idx: 1, error: 'Deudor no encontrado (nro_cliente=999)' }]);
        expect(facturas.size).toBe(2);
    });

    it('no vuelve a buscar en cada lote un cliente que ya se sabe que no existe', async () => {
        const { ctx, findMany } = makeCtx([{ id: 1, nroCliente: '001' }]);
        const p = new FacturasProcessor();

        await p.processBatch([fila(0, '999', 'A')], ctx);
        await p.processBatch([fila(1, '999', 'B')], ctx);

        expect(findMany).toHaveBeenCalledTimes(1);
    });

    it('si el archivo repite una factura, gana la última fila', async () => {
        const { ctx, facturas } = makeCtx([{ id: 1, nroCliente: '001' }]);
        const p = new FacturasProcessor();

        await p.processBatch(
            [fila(0, '001', 'A', { importe: 100 }), fila(1, '001', 'A', { importe: 250 })],
            ctx,
        );

        expect(facturas.size).toBe(1);
        expect(facturas.get('1|A').importe).toBe(250);
    });

    it('reintenta fila por fila si el chunk entero falla, para no perder las buenas', async () => {
        const { ctx, executeRaw } = makeCtx([{ id: 1, nroCliente: '001' }]);
        // Falla solo el statement con más de una fila.
        executeRaw.mockImplementation((sql: any) =>
            sql.values.length > 5 ? Promise.reject(new Error('deadlock')) : Promise.resolve(1),
        );
        const p = new FacturasProcessor();

        const errores = await p.processBatch([fila(0, '001', 'A'), fila(1, '001', 'B')], ctx);

        expect(errores).toEqual([]);
        // 1 en bloque (falló) + 2 individuales.
        expect(executeRaw).toHaveBeenCalledTimes(3);
    });
});

describe('FacturasProcessor — filas incompletas', () => {
    it('la fila sin importe va por el upsert de a una, para no pisar la factura ya cargada', async () => {
        const { ctx, upsert, executeRaw } = makeCtx([{ id: 1, nroCliente: '001' }]);
        const p = new FacturasProcessor();

        await p.processBatch([fila(0, '001', 'A', { importe: null })], ctx);

        expect(executeRaw).not.toHaveBeenCalled();
        expect(upsert).toHaveBeenCalledTimes(1);
        // `undefined` en el update = "no toques esta columna".
        expect(upsert.mock.calls[0][0].update).toMatchObject({ importe: undefined });
        expect(upsert.mock.calls[0][0].create).toMatchObject({ importe: 0 });
    });

    it('mezcla completas e incompletas en el mismo lote sin perder ninguna', async () => {
        const { ctx, upsert, executeRaw, facturas } = makeCtx([{ id: 1, nroCliente: '001' }]);
        const p = new FacturasProcessor();

        await p.processBatch(
            [fila(0, '001', 'A'), fila(1, '001', 'B', { vencimiento: null }), fila(2, '001', 'C')],
            ctx,
        );

        expect(executeRaw).toHaveBeenCalledTimes(1);
        expect(upsert).toHaveBeenCalledTimes(1);
        expect(facturas.size).toBe(3);
    });

    it('una fecha inválida cuenta como ausente, no como fecha del día', async () => {
        const { ctx, upsert } = makeCtx([{ id: 1, nroCliente: '001' }]);
        const p = new FacturasProcessor();

        await p.processBatch([fila(0, '001', 'A', { vencimiento: 'no es una fecha' })], ctx);

        expect(upsert).toHaveBeenCalledTimes(1);
        expect(upsert.mock.calls[0][0].update).toMatchObject({ vencimiento: undefined });
    });
});

describe('FacturasProcessor — compatibilidad con el camino de a una', () => {
    it('processRow sigue funcionando y lanza el error de la fila', async () => {
        const { ctx, facturas } = makeCtx([{ id: 1, nroCliente: '001' }]);
        const p = new FacturasProcessor();

        await p.processRow(fila(0, '001', 'A').row, ctx);
        expect(facturas.size).toBe(1);

        await expect(p.processRow(fila(1, '999', 'B').row, ctx))
            .rejects.toThrow('Deudor no encontrado (nro_cliente=999)');
    });

    it('validateRow rechaza las filas sin cliente o sin número de factura', () => {
        const p = new FacturasProcessor();
        const ctx = {} as ProcessContext;

        expect(p.validateRow({ nroFactura: 'A' }, ctx)).toMatchObject({ valid: false });
        expect(p.validateRow({ nro_cliente: '001' }, ctx)).toMatchObject({ valid: false });
        expect(p.validateRow({ nro_cliente: '001', nroFactura: 'A' }, ctx)).toEqual({ valid: true });
    });
});

describe('FacturasProcessor — afterAll', () => {
    it('recalcula el monto de los deudores tocados y limpia el cache', async () => {
        const { ctx, findMany } = makeCtx([{ id: 1, nroCliente: '001' }]);
        (ctx.prisma as any).$executeRaw.mockResolvedValue(1);
        const p = new FacturasProcessor();

        await p.processBatch([fila(0, '001', 'A')], ctx);
        await p.afterAll(ctx);

        expect(ctx.consolidacion.consolidar).toHaveBeenCalledWith({ tipo: 'DEUDORES', deudorIds: [1] });

        // El cache no sobrevive al import: la remesa siguiente resuelve sus propios deudores.
        await p.processBatch([fila(1, '001', 'B')], ctx);
        expect(findMany).toHaveBeenCalledTimes(2);
    });
});
