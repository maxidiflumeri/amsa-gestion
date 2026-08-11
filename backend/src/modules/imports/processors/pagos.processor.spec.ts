/**
 * Anti-duplicados de PAGOS.
 *
 * El criterio por defecto —mismo deudor, mismo día, mismo importe— existe para que reimportar un
 * archivo acumulativo no duplique pagos. Lo que se verifica acá es que ese criterio se afine cuando
 * la plantilla mapea un identificador del comprobante, sin cambiar nada para las que no lo mapean.
 */
import { PagosProcessor } from './pagos.processor';
import { ProcessContext } from './processor.interface';

/** Prisma mockeado con una tabla de pagos en memoria que respeta el filtro del anti-dup. */
function makeCtx(facturas: Array<{ id: number; nroFactura: string; estado?: string }> = []) {
    const pagos: any[] = [];
    let seq = 1;

    // Marca PAGADA la factura del comprobante, si existe y no lo estaba ya.
    const updateMany = jest.fn().mockImplementation(({ where, data }: any) => {
        const tocadas = facturas.filter(
            (f) => f.nroFactura === where.nroFactura && f.estado !== where.estado?.not,
        );
        for (const f of tocadas) Object.assign(f, data);
        return Promise.resolve({ count: tocadas.length });
    });

    const findFirst = jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(
            pagos.find((p) => {
                if (p.deudorId !== where.deudorId) return false;
                if (where.origen && p.origen !== where.origen) return false;
                if (where.importe !== undefined && p.importe !== where.importe) return false;
                if (where.fecha?.gte && (p.fecha < where.fecha.gte || p.fecha > where.fecha.lte)) return false;
                if (where.confirmadoImport !== undefined && p.confirmadoImport !== where.confirmadoImport) return false;
                // La clave del test: si el where trae observación, tiene que coincidir.
                if (where.observacion !== undefined && p.observacion !== where.observacion) return false;
                return true;
            }) ?? null,
        ),
    );

    const ctx = {
        prisma: {
            $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
            pago: {
                findFirst,
                create: jest.fn().mockImplementation(({ data }: any) => {
                    pagos.push({ id: seq++, ...data });
                    return Promise.resolve(pagos[pagos.length - 1]);
                }),
                update: jest.fn().mockResolvedValue({}),
            },
            factura: { updateMany },
        },
        remesaId: 10,
        remesaOrigenId: 9,
        empresaId: 19,
        consolidacion: { consolidar: jest.fn().mockResolvedValue({}) },
        promesas: { cerrarCumplidas: jest.fn().mockResolvedValue({}) },
    } as unknown as ProcessContext;

    return { ctx, pagos, facturas, updateMany };
}

const fila = (importe: number, fecha: string, observacion?: string) => ({
    nro_cliente: '000003462007',
    importe,
    fecha,
    ...(observacion ? { observacion } : {}),
});

describe('PagosProcessor — anti-duplicados sin identificador de comprobante', () => {
    it('no reinserta el mismo pago al reimportar el archivo', async () => {
        const { ctx, pagos } = makeCtx();
        const p = new PagosProcessor();

        await p.processRow(fila(195.04, '2026-07-17'), ctx);
        await p.processRow(fila(195.04, '2026-07-17'), ctx);

        expect(pagos).toHaveLength(1);
    });

    it('registra por separado dos importes distintos del mismo día', async () => {
        const { ctx, pagos } = makeCtx();
        const p = new PagosProcessor();

        await p.processRow(fila(195.04, '2026-07-17'), ctx);
        await p.processRow(fila(500.50, '2026-07-17'), ctx);

        expect(pagos).toHaveLength(2);
    });

    it('registra por separado el mismo importe en días distintos', async () => {
        const { ctx, pagos } = makeCtx();
        const p = new PagosProcessor();

        await p.processRow(fila(195.04, '2026-07-17'), ctx);
        await p.processRow(fila(195.04, '2026-07-18'), ctx);

        expect(pagos).toHaveLength(2);
    });
});

describe('PagosProcessor — anti-duplicados con identificador de comprobante', () => {
    it('registra los dos cobros si son de comprobantes distintos', async () => {
        const { ctx, pagos } = makeCtx();
        const p = new PagosProcessor();

        await p.processRow(fila(195.04, '2026-07-17', '0108B14819919A'), ctx);
        await p.processRow(fila(195.04, '2026-07-17', '0108B18215291A'), ctx);

        expect(pagos).toHaveLength(2);
        expect(pagos.map((x) => x.observacion)).toEqual(['0108B14819919A', '0108B18215291A']);
    });

    it('sigue sin reinsertar el mismo comprobante: reimportar es idempotente', async () => {
        const { ctx, pagos } = makeCtx();
        const p = new PagosProcessor();

        await p.processRow(fila(195.04, '2026-07-17', '0108B14819919A'), ctx);
        await p.processRow(fila(195.04, '2026-07-17', '0108B14819919A'), ctx);

        expect(pagos).toHaveLength(1);
    });

    it('el comprobante en blanco se trata como ausente, no como un valor más', async () => {
        const { ctx, pagos } = makeCtx();
        const p = new PagosProcessor();

        await p.processRow(fila(195.04, '2026-07-17', '   '), ctx);
        await p.processRow(fila(195.04, '2026-07-17'), ctx);

        expect(pagos).toHaveLength(1);
        expect(pagos[0].observacion).toBeNull();
    });

    it('AYSA: las 36 cuotas iguales cobradas el mismo día se registran todas', async () => {
        // El caso real que motivó el cambio: la cuenta 000003462007 canceló 36 partidas de $195,04
        // el 17/07. Con el criterio anterior quedaba una sola y se perdían $6.826,40.
        const { ctx, pagos } = makeCtx();
        const p = new PagosProcessor();

        const partidas = Array.from({ length: 36 }, (_, i) => `0108B${String(14819919 + i * 3400).padStart(8, '0')}A`);
        for (const doc of partidas) {
            await p.processRow(fila(195.04, '2026-07-17', doc), ctx);
        }

        expect(pagos).toHaveLength(36);
        const total = pagos.reduce((a, x) => a + x.importe, 0);
        expect(total).toBeCloseTo(195.04 * 36, 2);
    });
});

describe('PagosProcessor — marcar la factura cobrada', () => {
    it('pone PAGADA la factura que nombra el comprobante del pago', async () => {
        const { ctx, facturas } = makeCtx([
            { id: 1, nroFactura: '0108B14819919A', estado: 'PENDIENTE' },
            { id: 2, nroFactura: '0108B18215291A', estado: 'PENDIENTE' },
        ]);
        const p = new PagosProcessor();

        await p.processRow(fila(195.04, '2026-07-17', '0108B14819919A'), ctx);

        expect(facturas[0].estado).toBe('PAGADA');
        // La otra factura del mismo deudor no se toca.
        expect(facturas[1].estado).toBe('PENDIENTE');
    });

    it('sin comprobante no toca ninguna factura', async () => {
        const { ctx, facturas, updateMany } = makeCtx([
            { id: 1, nroFactura: '0108B14819919A', estado: 'PENDIENTE' },
        ]);
        const p = new PagosProcessor();

        await p.processRow(fila(195.04, '2026-07-17'), ctx);

        expect(updateMany).not.toHaveBeenCalled();
        expect(facturas[0].estado).toBe('PENDIENTE');
    });

    it('un comprobante que no existe como factura no rompe el pago', async () => {
        const { ctx, pagos } = makeCtx([{ id: 1, nroFactura: 'OTRA', estado: 'PENDIENTE' }]);
        const p = new PagosProcessor();

        await p.processRow(fila(195.04, '2026-07-17', 'NO-EXISTE'), ctx);

        expect(pagos).toHaveLength(1);
    });

    it('las 36 cuotas del plan marcan sus 36 facturas', async () => {
        const partidas = Array.from({ length: 36 }, (_, i) => `0108B${String(14819919 + i * 3400).padStart(8, '0')}A`);
        const { ctx, facturas } = makeCtx(
            partidas.map((nroFactura, i) => ({ id: i + 1, nroFactura, estado: 'PENDIENTE' })),
        );
        const p = new PagosProcessor();

        for (const doc of partidas) await p.processRow(fila(195.04, '2026-07-17', doc), ctx);

        expect(facturas.every((f) => f.estado === 'PAGADA')).toBe(true);
    });
});
