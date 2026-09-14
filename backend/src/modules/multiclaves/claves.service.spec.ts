import { NotFoundException } from '@nestjs/common';
import { ClavesService } from './claves.service';

function makeService(over: {
    remesa?: any;
    claves?: any[];
    importerrors?: any[];
    reemplazadasPorEsta?: number;
    deudores?: Array<{ empresaId: number; nroCliente: string }>;
} = {}) {
    const remesa = 'remesa' in over ? over.remesa : { id: 10, empresaId: 1, categoria: 'MULTICLAVES', errFilas: 0 };
    const claves = over.claves ?? [];
    const importerrors = over.importerrors ?? [];
    const deudores = over.deudores ?? [];

    const prisma: any = {
        remesa: { findUnique: jest.fn().mockResolvedValue(remesa) },
        clave_pago: {
            findMany: jest.fn().mockImplementation(({ where }: any) =>
                Promise.resolve(claves.filter((c) => c.remesaId === where.remesaId))),
            count: jest.fn().mockImplementation(({ where }: any) =>
                Promise.resolve(claves.filter((c) => c.reemplazadaPorRemesaId === where.reemplazadaPorRemesaId).length)),
        },
        importerror: {
            findMany: jest.fn().mockImplementation(({ where }: any) =>
                Promise.resolve(importerrors.filter((e) => e.remesaId === where.remesaId && e.rowNumber === where.rowNumber))),
        },
        deudor: {
            findMany: jest.fn().mockImplementation(({ where }: any) => {
                const nroClientes: string[] = where.nroCliente.in;
                const vistos = new Set<string>();
                return Promise.resolve(
                    deudores
                        .filter((d) => d.empresaId === where.empresaId && nroClientes.includes(d.nroCliente))
                        .filter((d) => { if (vistos.has(d.nroCliente)) return false; vistos.add(d.nroCliente); return true; })
                        .map((d) => ({ nroCliente: d.nroCliente })),
                );
            }),
        },
    };
    return { service: new ClavesService(prisma), prisma };
}

const clave = (over: Partial<any> & { id: number; nroTramite: string }) => ({
    remesaId: 10, tipo: 'TOTAL', estado: 'VIGENTE', reemplazadaPorRemesaId: null,
    importe: '100.00', fechaVencimiento: new Date('2026-10-27'),
    ...over,
});

describe('ClavesService.resumenLote', () => {
    it('404 si la remesa no existe', async () => {
        const { service } = makeService({ remesa: null });
        await expect(service.resumenLote(10)).rejects.toThrow(NotFoundException);
    });

    it('404 si la remesa existe pero no es MULTICLAVES', async () => {
        const { service } = makeService({ remesa: { id: 10, empresaId: 1, categoria: 'DEUDORES', errFilas: 0 } });
        await expect(service.resumenLote(10)).rejects.toThrow(NotFoundException);
    });

    it('cuenta trámites, claves, vigentes/reemplazadas y con/sin caso', async () => {
        const { service } = makeService({
            claves: [
                clave({ id: 1, nroTramite: 'T1', tipo: 'TOTAL', estado: 'VIGENTE' }),
                clave({ id: 2, nroTramite: 'T1', tipo: 'QUITA', estado: 'VIGENTE' }),
                clave({ id: 3, nroTramite: 'T2', tipo: 'TOTAL', estado: 'REEMPLAZADA' }),
                clave({ id: 4, nroTramite: 'T2', tipo: 'QUITA', estado: 'REEMPLAZADA' }),
            ],
            deudores: [{ empresaId: 1, nroCliente: 'T1' }],
        });

        const r = await service.resumenLote(10);

        expect(r).toMatchObject({
            tramites: 2, claves: 4, vigentes: 2, reemplazadasEnEsta: 2,
            conCaso: 1, sinCaso: 1, rechazados: 0,
        });
    });

    it('reparsea los avisos guardados como importerror', async () => {
        const { service } = makeService({
            claves: [clave({ id: 1, nroTramite: 'T1' })],
            importerrors: [
                { remesaId: 10, rowNumber: 0, errorMsg: '[aviso] SALDO_DISTINTO_ENTRE_FILAS: 2 caso(s) (ej: T1, T2)' },
                { remesaId: 10, rowNumber: 0, errorMsg: '[aviso] MARCA_DESCONOCIDA: 5 caso(s) (ej: T3)' },
                { remesaId: 10, rowNumber: 5, errorMsg: 'esto no es un aviso' },
            ],
        });

        const r = await service.resumenLote(10);

        expect(r.avisos).toEqual([
            { codigo: 'SALDO_DISTINTO_ENTRE_FILAS', cantidad: 2 },
            { codigo: 'MARCA_DESCONOCIDA', cantidad: 5 },
        ]);
    });

    it('cuenta los trámites SOLO_TOTAL (una única clave) aparte, sin otra query (fase 1.1)', async () => {
        const { service } = makeService({
            claves: [
                clave({ id: 1, nroTramite: 'T1', tipo: 'TOTAL' }),
                clave({ id: 2, nroTramite: 'T1', tipo: 'QUITA' }),
                clave({ id: 3, nroTramite: 'T2', tipo: 'TOTAL' }), // T2: solo 1 clave en esta carga
            ],
        });

        const r = await service.resumenLote(10);

        expect(r).toMatchObject({ tramites: 2, claves: 3, soloTotal: 1 });
    });

    it('suma un mismo código de aviso repartido en varias filas de importerror (un TANDA_ANTERIOR por lote)', async () => {
        const { service } = makeService({
            claves: [clave({ id: 1, nroTramite: 'T1' })],
            importerrors: [
                { remesaId: 10, rowNumber: 0, errorMsg: '[aviso] TANDA_ANTERIOR: 500 caso(s) (ej: T1, T2)' },
                { remesaId: 10, rowNumber: 0, errorMsg: '[aviso] TANDA_ANTERIOR: 322 caso(s) (ej: T900)' },
            ],
        });

        const r = await service.resumenLote(10);

        expect(r.avisos).toEqual([{ codigo: 'TANDA_ANTERIOR', cantidad: 822 }]);
    });
});

describe('ClavesService.sinCaso', () => {
    it('lista solo los trámites sin caso, paginado', async () => {
        const { service } = makeService({
            claves: [
                clave({ id: 1, nroTramite: 'T1', tipo: 'TOTAL', importe: '200.00' }),
                clave({ id: 2, nroTramite: 'T1', tipo: 'QUITA', importe: '100.00' }),
                clave({ id: 3, nroTramite: 'T2', tipo: 'TOTAL', importe: '300.00' }),
                clave({ id: 4, nroTramite: 'T2', tipo: 'QUITA', importe: '150.00' }),
                clave({ id: 5, nroTramite: 'T3', tipo: 'TOTAL', importe: '400.00' }),
            ],
            deudores: [{ empresaId: 1, nroCliente: 'T2' }], // T2 SÍ tiene caso
        });

        const r = await service.sinCaso(10, 1, 1);

        expect(r.total).toBe(2); // T1 y T3
        expect(r.items).toHaveLength(1);
        expect(r.items[0].nroTramite).toBe('T1');
        // String, no number: es un Decimal (§4.1), igual que el resto de los importes de multiclaves.
        expect(r.items[0].importeTotal).toBe('200.00');
        expect(r.items[0].importeQuita).toBe('100.00');
        expect(r.items[0].fechaVencimiento).toBe('2026-10-27');
    });

    it('segunda página trae el resto', async () => {
        const { service } = makeService({
            claves: [
                clave({ id: 1, nroTramite: 'T1', tipo: 'TOTAL' }),
                clave({ id: 2, nroTramite: 'T3', tipo: 'TOTAL' }),
            ],
        });

        const r = await service.sinCaso(10, 2, 1);

        expect(r.total).toBe(2);
        expect(r.items).toHaveLength(1);
        expect(r.items[0].nroTramite).toBe('T3');
    });

    it('acota pageSize a 200 y descarta valores negativos o en 0 (page y pageSize)', async () => {
        const { service } = makeService({
            claves: Array.from({ length: 3 }, (_, i) => clave({ id: i + 1, nroTramite: `T${i + 1}`, tipo: 'TOTAL' })),
        });

        const pageSizeEnorme = await service.sinCaso(10, 1, 100000);
        expect(pageSizeEnorme.items).toHaveLength(3); // no más de lo que hay, pero tampoco explota

        const pageSizeNegativo = await service.sinCaso(10, 1, -5);
        expect(pageSizeNegativo.items.length).toBeGreaterThan(0); // cae a un default sensato, no a un slice vacío/roto

        const pageNegativa = await service.sinCaso(10, -3, 1);
        expect(pageNegativa.items).toHaveLength(1); // se trata como página 1, no rompe el slice
        expect(pageNegativa.items[0].nroTramite).toBe('T1');
    });
});
