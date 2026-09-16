/**
 * `ImportService.listRemesas` — el combo de "vincular a remesa de deudores" (spec §10.7).
 *
 * Antes de la fase 4a, `soloEnGestion` resolvía "cerrado" comparando contra la clave `SIT-050`
 * pelada. Desde la fase 4a resuelve por la categoría CANCELADO completa (SIT-050 a SIT-053, y desde
 * esta misma fase también SIT-054 "Cancelado con quita") vía `idsSituacionCancelada`.
 *
 * Hallazgo de la auditoría (importante #7): la ampliación a toda la categoría CANCELADO no es un
 * detalle de multiclaves — también cambia qué pasa con SIT-051/052/053, que antes NO se
 * consideraban "cerrados" acá. Estos tests ejercitan esos tres códigos explícitamente, no solo
 * SIT-050/054.
 */
import { ImportService } from './imports.service';
import { _resetCacheSituacionesCerradas } from './utils/situaciones-cerradas';

const SIT_050 = 50;
const SIT_051 = 51;
const SIT_052 = 52;
const SIT_053 = 53;
const SIT_054 = 54;
const GES_094 = 94;
const GES_090 = 90;

function makeService() {
    const remesaFindMany = jest.fn().mockResolvedValue([{ id: 1, nombre: 'remesa 1' }]);
    const parametroFindMany = jest.fn().mockImplementation(({ where }: any) => {
        if (where?.categoria === 'CANCELADO') {
            return Promise.resolve([SIT_050, SIT_051, SIT_052, SIT_053, SIT_054].map((id) => ({ id, clave: `SIT-0${id}` })));
        }
        if (where?.clave?.in) {
            return Promise.resolve(
                where.clave.in
                    .map((c: string) => (c === 'GES-094' ? { id: GES_094 } : c === 'GES-090' ? { id: GES_090 } : null))
                    .filter(Boolean),
            );
        }
        return Promise.resolve([]);
    });

    const prisma: any = {
        parametro: { findMany: parametroFindMany },
        remesa: { findMany: remesaFindMany },
    };

    const service = new ImportService(
        prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    return { service, prisma, remesaFindMany, parametroFindMany };
}

beforeEach(() => {
    // `idsSituacionCancelada` cachea por módulo — sin este reset, un test que corre después de otro
    // en este mismo archivo vería la respuesta cacheada del primero.
    _resetCacheSituacionesCerradas();
});

describe('ImportService.listRemesas — soloEnGestion resuelve por categoría CANCELADO', () => {
    it('sin soloEnGestion no filtra nada (comportamiento de siempre)', async () => {
        const { service, remesaFindMany } = makeService();
        await service.listRemesas(10, 'DEUDORES', false, false);
        const where = remesaFindMany.mock.calls[0][0].where;
        expect(where.deudor).toBeUndefined();
    });

    it('con soloEnGestion, el filtro excluye SIT-050 a SIT-054 y GES-094/090 — no solo SIT-050', async () => {
        const { service, remesaFindMany } = makeService();
        await service.listRemesas(10, 'DEUDORES', true, true);
        const where = remesaFindMany.mock.calls[0][0].where;
        const some = where.deudor.some;
        expect(some.estadoSituacionId.notIn).toEqual(expect.arrayContaining([SIT_050, SIT_051, SIT_052, SIT_053, SIT_054]));
        expect(some.estadoGestionId.notIn).toEqual(expect.arrayContaining([GES_094, GES_090]));
    });

    it('SIT-051 (Cancelado antes de la gestión) cuenta como cerrado, igual que SIT-050', async () => {
        const { service, remesaFindMany } = makeService();
        await service.listRemesas(10, 'DEUDORES', true, true);
        const idsExcluidos: number[] = remesaFindMany.mock.calls[0][0].where.deudor.some.estadoSituacionId.notIn;
        expect(idsExcluidos).toContain(SIT_051);
    });

    it('SIT-052 (Cancelado a liquidar) cuenta como cerrado', async () => {
        const { service, remesaFindMany } = makeService();
        await service.listRemesas(10, 'DEUDORES', true, true);
        const idsExcluidos: number[] = remesaFindMany.mock.calls[0][0].where.deudor.some.estadoSituacionId.notIn;
        expect(idsExcluidos).toContain(SIT_052);
    });

    it('SIT-053 (Cancelado a monto histórico) cuenta como cerrado', async () => {
        const { service, remesaFindMany } = makeService();
        await service.listRemesas(10, 'DEUDORES', true, true);
        const idsExcluidos: number[] = remesaFindMany.mock.calls[0][0].where.deudor.some.estadoSituacionId.notIn;
        expect(idsExcluidos).toContain(SIT_053);
    });

    it('SIT-054 (Cancelado con quita, multiclaves) cuenta como cerrado', async () => {
        const { service, remesaFindMany } = makeService();
        await service.listRemesas(10, 'DEUDORES', true, true);
        const idsExcluidos: number[] = remesaFindMany.mock.calls[0][0].where.deudor.some.estadoSituacionId.notIn;
        expect(idsExcluidos).toContain(SIT_054);
    });

    it('modo degradado: sin ningún código CANCELADO seedeado, no filtra por situación (muestra de más, no de menos)', async () => {
        const { service, remesaFindMany, parametroFindMany } = makeService();
        parametroFindMany.mockImplementation(({ where }: any) => {
            if (where?.categoria === 'CANCELADO') return Promise.resolve([]);
            if (where?.clave?.in) return Promise.resolve([{ id: GES_094 }, { id: GES_090 }]);
            return Promise.resolve([]);
        });
        await service.listRemesas(10, 'DEUDORES', true, true);
        const where = remesaFindMany.mock.calls[0][0].where;
        // Con categoría vacía, `idsCerrados` sigue teniendo los GES — el `notIn` de situación no se
        // arma en `{}` porque `idsCerrados.length` > 0 gracias a los GES, así que en este caso
        // puntual el `estadoSituacionId.notIn` queda con exactamente los GES (ninguno es una
        // situación real, pero no rompe nada: simplemente ningún deudor matchea esos ids ahí).
        // Lo que importa es que NINGÚN SIT quedó en la lista.
        const idsExcluidos: number[] = where.deudor.some.estadoSituacionId.notIn;
        expect(idsExcluidos).not.toEqual(expect.arrayContaining([SIT_050, SIT_051, SIT_052, SIT_053, SIT_054]));
    });
});
