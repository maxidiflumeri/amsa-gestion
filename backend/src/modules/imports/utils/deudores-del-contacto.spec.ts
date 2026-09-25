/**
 * CONTACTOS y ENRIQUECIMIENTO con varias remesas origen: el caso se busca en cualquiera de las
 * elegidas y, si la persona está en más de una, el contacto va a todos sus casos.
 */
import { ContactosProcessor } from '../processors/contactos.processor';
import { EnriquecimientoProcessor } from '../processors/enriquecimiento.processor';
import { ProcessContext } from '../processors/processor.interface';
import { deudoresDelContacto, remesasOrigenDelContexto } from './deudores-del-contacto';

type D = { id: number; remesaId: number; documento: string; nroCliente: string | null };

const BASE: D[] = [
    { id: 1, remesaId: 10, documento: '20111222', nroCliente: 'A1' },
    { id: 2, remesaId: 11, documento: '20111222', nroCliente: 'A1' }, // misma persona, otra remesa
    { id: 3, remesaId: 12, documento: '30999888', nroCliente: 'B2' }, // remesa no elegida
    { id: 4, remesaId: 11, documento: '27555666', nroCliente: 'C3' },
];

function makeCtx(extra: Partial<ProcessContext>) {
    const findMany = jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(
            BASE.filter(
                (d) =>
                    where.remesaId.in.includes(d.remesaId) &&
                    (where.documento === undefined || d.documento === where.documento) &&
                    (where.nroCliente === undefined || d.nroCliente === where.nroCliente),
            ).map((d) => ({ id: d.id })),
        ),
    );
    const upsert = jest.fn().mockResolvedValue({});
    const ctx = {
        prisma: { deudor: { findMany }, contacto: { upsert } },
        remesaId: 99,
        empresaId: 1,
        ...extra,
    } as unknown as ProcessContext;
    return { ctx, findMany, upsert };
}

describe('remesasOrigenDelContexto', () => {
    it('usa las varias remesas si vienen', () => {
        expect(remesasOrigenDelContexto({ remesaId: 99, remesaOrigenIds: [10, 11] } as any)).toEqual([10, 11]);
    });
    it('cae en la remesa origen única y, si no, en la del archivo', () => {
        expect(remesasOrigenDelContexto({ remesaId: 99, remesaOrigenId: 10, remesaOrigenIds: [] } as any)).toEqual([10]);
        expect(remesasOrigenDelContexto({ remesaId: 99 } as any)).toEqual([99]);
    });
});

describe('deudoresDelContacto', () => {
    it('devuelve los casos de la persona en todas las remesas elegidas', async () => {
        const { ctx } = makeCtx({ remesaOrigenIds: [10, 11] });
        expect(await deudoresDelContacto('20111222', '', ctx)).toEqual([1, 2]);
    });

    it('con una sola remesa origen se comporta como antes', async () => {
        const { ctx } = makeCtx({ remesaOrigenId: 10 });
        expect(await deudoresDelContacto('20111222', '', ctx)).toEqual([1]);
    });

    it('no busca en remesas que no se eligieron', async () => {
        const { ctx } = makeCtx({ remesaOrigenIds: [10, 11] });
        expect(await deudoresDelContacto('30999888', 'B2', ctx)).toEqual([]);
    });

    it('si el documento no aparece, cae en el Nº de cliente', async () => {
        const { ctx, findMany } = makeCtx({ remesaOrigenIds: [10, 11] });
        expect(await deudoresDelContacto('00000000', 'C3', ctx)).toEqual([4]);
        expect(findMany).toHaveBeenCalledTimes(2);
    });
});

describe.each([
    ['CONTACTOS', () => new ContactosProcessor()],
    ['ENRIQUECIMIENTO', () => new EnriquecimientoProcessor()],
])('%s con varias remesas origen', (_nombre, crear) => {
    it('carga el contacto en cada caso de la persona', async () => {
        const { ctx, upsert } = makeCtx({ remesaOrigenIds: [10, 11] });
        await crear().processRow({ documento: '20111222', tipo: 'email', valor: 'juan@example.com' } as any, ctx);
        const ids = upsert.mock.calls.map((c) => c[0].create.deudorId);
        expect(ids).toEqual([1, 2]);
    });

    it('si no aparece en ninguna remesa elegida, la fila falla', async () => {
        const { ctx, upsert } = makeCtx({ remesaOrigenIds: [10, 11] });
        await expect(
            crear().processRow({ documento: '30999888', tipo: 'email', valor: 'x@example.com' } as any, ctx),
        ).rejects.toThrow('Deudor no encontrado');
        expect(upsert).not.toHaveBeenCalled();
    });
});
