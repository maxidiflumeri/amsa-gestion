import { DeudoresService } from './deudores.service';

/**
 * El documento se busca por igualdad, no por subcadena.
 *
 * Con `contains`, buscar el DNI 27336733 devolvía DOS resultados: el deudor real y otro cuyo
 * documento es el CUIL 27336733405 — de una persona distinta, que empieza con esos ocho dígitos
 * por pura coincidencia. Dos titulares mostrados como si fueran el mismo caso.
 */
describe('DeudoresService — búsqueda por documento', () => {
    const DNI = '27336733';

    const armar = () => {
        const findMany = jest.fn().mockResolvedValue([]);
        const count = jest.fn().mockResolvedValue(0);
        const prisma: any = {
            deudor: { findMany, count },
            $transaction: (ops: any[]) => Promise.all(ops),
        };
        return { service: new DeudoresService(prisma, {} as any), findMany };
    };

    const whereDe = (findMany: jest.Mock) => findMany.mock.calls[0][0].where;

    describe('findAll (buscador de la tabla)', () => {
        it('el documento va por igualdad', async () => {
            const { service, findMany } = armar();
            await service.findAll(undefined, undefined, DNI);
            expect(whereDe(findMany).OR).toContainEqual({ documento: DNI });
        });

        it('nombre y apellido siguen siendo parciales', async () => {
            const { service, findMany } = armar();
            await service.findAll(undefined, undefined, 'Gomez');
            const or = whereDe(findMany).OR;
            expect(or).toContainEqual({ nombre: { contains: 'Gomez' } });
            expect(or).toContainEqual({ apellido: { contains: 'Gomez' } });
        });

        it('el término se recorta: pegar el DNI con espacios sigue encontrándolo', async () => {
            const { service, findMany } = armar();
            await service.findAll(undefined, undefined, `  ${DNI} `);
            expect(whereDe(findMany).OR).toContainEqual({ documento: DNI });
        });

        it('un término numérico corto también se busca como id', async () => {
            const { service, findMany } = armar();
            await service.findAll(undefined, undefined, '1234');
            expect(whereDe(findMany).OR).toContainEqual({ id: 1234 });
        });

        it('un CUIL no se cuela como id: excede el INT de la columna', async () => {
            const { service, findMany } = armar();
            await service.findAll(undefined, undefined, '27336733405');
            const or = whereDe(findMany).OR;
            expect(or.some((c: any) => 'id' in c)).toBe(false);
        });

        it('sin término, no filtra', async () => {
            const { service, findMany } = armar();
            await service.findAll(undefined, undefined, '   ');
            expect(whereDe(findMany)).toEqual({});
        });
    });

    describe('searchAdvanced (buscador avanzado)', () => {
        it('el documento va por igualdad', async () => {
            const { service, findMany } = armar();
            await service.searchAdvanced({ documento: DNI });
            expect(whereDe(findMany).AND).toContainEqual({ documento: DNI });
        });

        it('el documento se recorta', async () => {
            const { service, findMany } = armar();
            await service.searchAdvanced({ documento: ` ${DNI}  ` });
            expect(whereDe(findMany).AND).toContainEqual({ documento: DNI });
        });

        it('un documento en blanco no agrega condición', async () => {
            const { service, findMany } = armar();
            await service.searchAdvanced({ documento: '   ' });
            expect(whereDe(findMany)).toEqual({});
        });
    });
});
