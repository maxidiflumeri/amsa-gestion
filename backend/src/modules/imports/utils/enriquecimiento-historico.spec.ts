import { enriquecerContactosHistoricos } from './enriquecimiento-historico';
import { ProcessContext } from '../processors/processor.interface';

function makeCtx(historicos: any[] = []) {
    const findMany = jest.fn().mockResolvedValue(historicos);
    const createMany = jest.fn().mockResolvedValue({ count: historicos.length });
    const ctx = {
        prisma: { contacto: { findMany, createMany } },
        remesaId: 5,
        empresaId: 1,
    } as unknown as ProcessContext;
    return { ctx, findMany, createMany };
}

describe('enriquecerContactosHistoricos', () => {
    it('copia los contactos históricos (otra remesa, mismo DNI) al deudor nuevo', async () => {
        const { ctx, findMany, createMany } = makeCtx([
            { tipo: 'telefono', valor: '1122334455', subtipo: null, prioridad: null, validado: false, whatsapp: false },
        ]);

        const n = await enriquecerContactosHistoricos(ctx, 42, '33221122');

        expect(n).toBe(1);
        // Match EXACTO por documento, excluyendo la remesa actual
        expect(findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { deudor: { documento: '33221122', remesaId: { not: 5 } } },
                distinct: ['tipo', 'valor'],
            }),
        );
        expect(createMany).toHaveBeenCalledWith(
            expect.objectContaining({
                data: [expect.objectContaining({ deudorId: 42, valor: '1122334455' })],
                skipDuplicates: true,
            }),
        );
    });

    it('no hace nada si no hay contactos históricos', async () => {
        const { ctx, createMany } = makeCtx([]);
        const n = await enriquecerContactosHistoricos(ctx, 42, '33221122');
        expect(n).toBe(0);
        expect(createMany).not.toHaveBeenCalled();
    });

    it('saltea placeholders sin DNI (SIN-DNI- y SIN_DOC) — no consulta la base', async () => {
        const { ctx, findMany } = makeCtx([]);
        expect(await enriquecerContactosHistoricos(ctx, 1, 'SIN-DNI-9999')).toBe(0);
        expect(await enriquecerContactosHistoricos(ctx, 1, 'SIN_DOC_12345')).toBe(0);
        expect(await enriquecerContactosHistoricos(ctx, 1, '')).toBe(0);
        expect(await enriquecerContactosHistoricos(ctx, 1, null)).toBe(0);
        expect(findMany).not.toHaveBeenCalled();
    });

    it('trimea el documento antes de matchear', async () => {
        const { ctx, findMany } = makeCtx([]);
        await enriquecerContactosHistoricos(ctx, 1, '  33221122  ');
        expect(findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { deudor: { documento: '33221122', remesaId: { not: 5 } } } }),
        );
    });
});
