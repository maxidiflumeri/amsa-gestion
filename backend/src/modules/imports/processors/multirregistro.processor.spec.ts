/**
 * Tests del MultirregistroProcessor (Toyota cuenta 87).
 *
 * Lo que importa cubrir acá, según las decisiones del spec §B.1.3:
 *  - El match del deudor es EMPRESA-WIDE, no por remesa (B-D6): si se buscara por remesa, un
 *    cliente ya cargado se duplicaría todos los días, porque los nuevos entran en una remesa nueva.
 *  - Los avisos se upsertean por (deudorId, nroFactura) y solo se escriben si algo cambió.
 *  - `montoTotal` = Σ facturas.
 *  - Las bajas resuelven aviso → factura → deudor → GES-090, también empresa-wide.
 */
import { MultirregistroProcessor } from './multirregistro.processor';
import { ProcessContext } from './processor.interface';

const GES_090 = 90;
const DEFAULT_GESTION = 200;
const DEFAULT_SITUACION = 100;

function makeCtx(overrides: Partial<ProcessContext> = {}) {
    const deudorCreate = jest.fn().mockResolvedValue({ id: 777 });
    const deudorUpdate = jest.fn().mockResolvedValue({});
    const deudorFindFirst = jest.fn().mockResolvedValue(null);
    const facturaCreate = jest.fn().mockResolvedValue({});
    const facturaUpdate = jest.fn().mockResolvedValue({});
    const facturaFindUnique = jest.fn().mockResolvedValue(null);
    const facturaFindFirst = jest.fn().mockResolvedValue(null);
    const contactoCreateMany = jest.fn().mockResolvedValue({ count: 0 });

    const prisma: any = {
        parametro: {
            findUnique: jest.fn().mockImplementation(({ where }: any) =>
                Promise.resolve(where.clave === 'GES-090' ? { id: GES_090 } : null),
            ),
        },
        deudor: { findFirst: deudorFindFirst, create: deudorCreate, update: deudorUpdate },
        factura: {
            findUnique: facturaFindUnique,
            findFirst: facturaFindFirst,
            create: facturaCreate,
            update: facturaUpdate,
            aggregate: jest.fn().mockResolvedValue({ _sum: { importe: 0 } }),
        },
        contacto: { createMany: contactoCreateMany, findMany: jest.fn().mockResolvedValue([]) },
    };

    const ctx = {
        prisma,
        remesaId: 42,
        empresaId: 87,
        usuarioId: 9,
        defaults: { estadoSituacionId: DEFAULT_SITUACION, estadoGestionId: DEFAULT_GESTION },
        consolidacion: { consolidar: jest.fn().mockResolvedValue(undefined) },
        promesas: { cerrarCumplidas: jest.fn().mockResolvedValue(undefined) },
        auditoria: { log: jest.fn().mockResolvedValue(undefined) },
        ...overrides,
    } as unknown as ProcessContext;

    return { ctx, prisma, deudorCreate, deudorUpdate, deudorFindFirst, facturaCreate, facturaUpdate, facturaFindUnique, facturaFindFirst, contactoCreateMany };
}

const caso = (over: Record<string, any> = {}) => ({
    _tipo: 'CASO',
    nroCliente: '346395',
    nombre: 'BIANCIOTTI LUCIANA',
    camposAdicionales: { localidad: 'PORTEÑA' },
    _blocks: [
        { entity: 'FACTURA', data: { nroFactura: '170502', importe: 55406.65, contrato: '2009869', detalle: 'Multa: 100.00' } },
    ],
    ...over,
});

describe('MultirregistroProcessor — alta de casos', () => {
    it('crea el deudor en la remesa del día con placeholder estable de documento', async () => {
        const proc = new MultirregistroProcessor();
        const { ctx, deudorCreate } = makeCtx();

        await proc.processRow(caso() as any, ctx);

        expect(deudorCreate).toHaveBeenCalledTimes(1);
        const data = deudorCreate.mock.calls[0][0].data;
        expect(data.remesaId).toBe(42);
        expect(data.nroCliente).toBe('346395');
        // Derivado del nro de cliente, no de un timestamp: se mantiene igual entre corridas.
        expect(data.documento).toBe('SIN_DOC_346395');
    });

    it('busca el deudor en TODA la empresa, no en la remesa del import', async () => {
        const proc = new MultirregistroProcessor();
        const { ctx, prisma } = makeCtx();

        await proc.processRow(caso() as any, ctx);

        const where = prisma.deudor.findFirst.mock.calls[0][0].where;
        expect(where).toEqual({ empresaId: 87, nroCliente: '346395' });
        expect(where).not.toHaveProperty('remesaId');
    });

    it('si el cliente ya existe no lo duplica: actualiza y usa su id', async () => {
        const proc = new MultirregistroProcessor();
        const { ctx, prisma, deudorCreate, facturaCreate } = makeCtx();
        prisma.deudor.findFirst.mockResolvedValue({ id: 555, nombre: 'BIANCIOTTI LUCIANA', camposAdicionales: { localidad: 'PORTEÑA' } });

        await proc.processRow(caso() as any, ctx);

        expect(deudorCreate).not.toHaveBeenCalled();
        expect(facturaCreate.mock.calls[0][0].data.deudorId).toBe(555);
    });

    it('no gasta un UPDATE si el caso llega igual que ayer', async () => {
        const proc = new MultirregistroProcessor();
        const { ctx, prisma, deudorUpdate } = makeCtx();
        prisma.deudor.findFirst.mockResolvedValue({ id: 555, nombre: 'BIANCIOTTI LUCIANA', camposAdicionales: { localidad: 'PORTEÑA' } });
        prisma.factura.findUnique.mockResolvedValue({ id: 1, importe: 55406.65, detalle: 'Multa: 100.00', externalId: '2009869', estado: 'PENDIENTE' });

        await proc.processRow(caso() as any, ctx);

        // El único update permitido es el de montoTotal (recálculo), nunca el de identidad.
        const updatesDeIdentidad = deudorUpdate.mock.calls.filter((c: any) => !('montoTotal' in c[0].data));
        expect(updatesDeIdentidad).toHaveLength(0);
        expect(prisma.factura.update).not.toHaveBeenCalled();
    });
});

describe('MultirregistroProcessor — facturas (avisos)', () => {
    it('crea la factura con el aviso como nro y el contrato en externalId', async () => {
        const proc = new MultirregistroProcessor();
        const { ctx, facturaCreate } = makeCtx();

        await proc.processRow(caso() as any, ctx);

        const d = facturaCreate.mock.calls[0][0].data;
        expect(d.nroFactura).toBe('170502');
        expect(d.externalId).toBe('2009869');
        expect(d.importe).toBeCloseTo(55406.65, 2);
        expect(d.detalle).toBe('Multa: 100.00');
    });

    it('actualiza importe y desglose de un aviso ya cargado (cambian los días de mora)', async () => {
        const proc = new MultirregistroProcessor();
        const { ctx, prisma, facturaUpdate, facturaCreate } = makeCtx();
        prisma.factura.findUnique.mockResolvedValue({ id: 11, importe: 50000, detalle: 'Multa: 100.00 | Días de mora: 80', externalId: '2009869', estado: 'PENDIENTE' });

        await proc.processRow(caso({ _blocks: [{ entity: 'FACTURA', data: { nroFactura: '170502', importe: 55406.65, contrato: '2009869', detalle: 'Multa: 100.00 | Días de mora: 87' } }] }) as any, ctx);

        expect(facturaCreate).not.toHaveBeenCalled();
        expect(facturaUpdate).toHaveBeenCalledTimes(1);
        const d = facturaUpdate.mock.calls[0][0].data;
        expect(d.importe).toBeCloseTo(55406.65, 2);
        expect(d.detalle).toContain('Días de mora: 87');
    });

    it('un cliente con varios contratos genera una factura por aviso', async () => {
        const proc = new MultirregistroProcessor();
        const { ctx, facturaCreate } = makeCtx();

        await proc.processRow(caso({
            _blocks: [
                { entity: 'FACTURA', data: { nroFactura: '170895', importe: 100, contrato: '2000853', detalle: '' } },
                { entity: 'FACTURA', data: { nroFactura: '170896', importe: 200, contrato: '2000854', detalle: '' } },
            ],
        }) as any, ctx);

        expect(facturaCreate).toHaveBeenCalledTimes(2);
        expect(facturaCreate.mock.calls.map((c: any) => c[0].data.externalId).sort()).toEqual(['2000853', '2000854']);
    });

    it('el montoTotal del deudor sale de la suma de sus facturas', async () => {
        const proc = new MultirregistroProcessor();
        const { ctx, prisma, deudorUpdate } = makeCtx();
        prisma.factura.aggregate.mockResolvedValue({ _sum: { importe: 152106.42 } });

        await proc.processRow(caso() as any, ctx);

        expect(deudorUpdate).toHaveBeenCalledWith({ where: { id: 777 }, data: { montoTotal: 152106.42 } });
    });
});

describe('MultirregistroProcessor — bajas', () => {
    it('resuelve aviso → factura → deudor y lo marca GES-090', async () => {
        const proc = new MultirregistroProcessor();
        const { ctx, prisma, deudorUpdate } = makeCtx();
        prisma.factura.findFirst.mockResolvedValue({ deudorId: 321 });

        await proc.processRow({ _tipo: 'BAJA', aviso: '171412', motivo: 'Pago de Cuota/Aviso' } as any, ctx);

        expect(prisma.factura.findFirst.mock.calls[0][0].where).toEqual({
            nroFactura: '171412',
            deudor: { empresaId: 87 },
        });
        expect(deudorUpdate).toHaveBeenCalledWith({ where: { id: 321 }, data: { estadoGestionId: GES_090 } });
    });

    it('si el aviso no está cargado avisa y sigue (no rompe el import)', async () => {
        const proc = new MultirregistroProcessor();
        const { ctx, deudorUpdate } = makeCtx();

        await expect(proc.processRow({ _tipo: 'BAJA', aviso: '999999' } as any, ctx)).resolves.toBeUndefined();
        expect(deudorUpdate).not.toHaveBeenCalled();
    });

    it('modo degradado: sin GES-090 seedeado no toca a nadie', async () => {
        const proc = new MultirregistroProcessor();
        const { ctx, prisma, deudorUpdate } = makeCtx();
        prisma.parametro.findUnique.mockResolvedValue(null);
        prisma.factura.findFirst.mockResolvedValue({ deudorId: 321 });

        await proc.processRow({ _tipo: 'BAJA', aviso: '171412' } as any, ctx);

        expect(deudorUpdate).not.toHaveBeenCalled();
    });
});

describe('MultirregistroProcessor — validación de filas', () => {
    const proc = new MultirregistroProcessor();

    it('rechaza un caso sin nro de cliente', () => {
        expect(proc.validateRow!({ _tipo: 'CASO', _blocks: [] } as any, {} as any).valid).toBe(false);
    });

    it('rechaza un caso sin ningún aviso', () => {
        expect(proc.validateRow!({ _tipo: 'CASO', nroCliente: '1', _blocks: [] } as any, {} as any).valid).toBe(false);
    });

    it('rechaza una baja sin nro de aviso', () => {
        expect(proc.validateRow!({ _tipo: 'BAJA' } as any, {} as any).valid).toBe(false);
    });

    it('acepta un caso completo y una baja con aviso', () => {
        expect(proc.validateRow!(caso() as any, {} as any).valid).toBe(true);
        expect(proc.validateRow!({ _tipo: 'BAJA', aviso: '1' } as any, {} as any).valid).toBe(true);
    });
});

describe('MultirregistroProcessor — contactos', () => {
    it('normaliza los teléfonos y descarta la basura', async () => {
        const proc = new MultirregistroProcessor();
        const { ctx, contactoCreateMany } = makeCtx();

        await proc.processRow(caso({
            _blocks: [
                { entity: 'FACTURA', data: { nroFactura: '1', importe: 1, contrato: 'C', detalle: '' } },
                { entity: 'CONTACTO', data: { tipo: 'telefono', valor: '03414818748' } },
                { entity: 'CONTACTO', data: { tipo: 'telefono', valor: '000000' } },
                { entity: 'CONTACTO', data: { tipo: 'email', valor: 'lv@gmail.com' } },
            ],
        }) as any, ctx);

        const insertados = contactoCreateMany.mock.calls[0][0].data;
        const valores = insertados.map((c: any) => c.valor);
        expect(valores).toContain('lv@gmail.com');
        expect(valores).not.toContain('000000');
        expect(insertados.find((c: any) => c.tipo === 'telefono').validado).toBe(true);
    });
});
