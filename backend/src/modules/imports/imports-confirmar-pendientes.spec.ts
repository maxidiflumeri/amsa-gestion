/**
 * Confirmar desde el Historial las importaciones que no llegaron a la cola
 * (docs/imports-progreso-c2-spec.md §5.5; casos CP-1 a CP-9 de §10.2 D).
 * Espía `executeRemesa` y `ejecutarGrupo`: no los vuelve a probar.
 */
import { ConflictException, ForbiddenException, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { dobleLecturas } from './doble-prisma-lecturas';
import { ImportService } from './imports.service';

beforeAll(() => Logger.overrideLogger(false));

const T0 = new Date('2026-10-01T10:00:00Z');
const CORTE = (n: string) => [{ fromIndex: 45, operador: 'IGUAL', valor: n }];
const progreso = (o: Record<string, any> = {}) => ({
    rev: 1, fase: 'BORRADOR', subfase: null, porcentaje: 0, totalEsperado: 0, procesadas: 0, ok: 0, err: 0, descartadas: 0, fueraDeCorte: null,
    advertencias: 0, nuevos: null, actualizados: null, resultado: null, error: null, errorPostProceso: null, resumen: null, intentos: 0,
    jobId: null, grupoId: null, grupoOrden: null, grupoTotal: null, cancelSolicitadaAt: null, encoladaAt: null, startedAt: null,
    heartbeatAt: null, finishedAt: null, ...o,
});
const origen = (id: number | null, ids: number[] | null = null) => ({ v: 1, origen: { remesaOrigenId: id, remesaOrigenIds: ids } });
const pendiente = (id: number, corte: string | null, o: Record<string, any> = {}) => ({
    id, numeroRemesa: String(id).padStart(5, '0'), nombre: `Carga ${id}`, empresaId: 10, plantillaId: 5, archivoHash: 'hash-A', categoria: 'DEUDORES',
    estadoProceso: 'VALIDANDO', totalFilas: 10, okFilas: 0, errFilas: 0, usuarioCreadorId: 3, filtroFilas: corte ? CORTE(corte) : null,
    createdAt: T0, casos: 0, progreso: progreso({ resumen: origen(40) }), ...o,
});

const DUENO = { sub: 3, permisos: ['importacion.ejecutar'] };

function armar(remesas: any[]) {
    const d = dobleLecturas({ remesas });
    const svc = new ImportService(d.prisma, null as never, null as never, null as never, null as never, null as never, null as never, null as never, null as never);
    const ejecutar = jest.spyOn(svc, 'executeRemesa').mockImplementation(async (id: number) => ({ message: 'Importación encolada correctamente', remesaId: id, carga: { remesaId: id } as never }));
    const grupo = jest.spyOn(svc, 'ejecutarGrupo').mockImplementation(async (p) => ({
        message: 'Carga dividida encolada correctamente', grupoId: 'nuevo-grupo', cargas: p.remesaIds.map((remesaId) => ({ remesaId }) as never),
    }));
    return { svc, ejecutar, grupo };
}

const nadaSeLlamo = (h: ReturnType<typeof armar>) => {
    expect(h.ejecutar).not.toHaveBeenCalled();
    expect(h.grupo).not.toHaveBeenCalled();
};

describe('confirmarPendientes', () => {
    it('CP-1: una pendiente con origen 40: executeRemesa(id, usuario, 40, undefined) y grupoId null', async () => {
        const h = armar([pendiente(60, 'N1')]);
        const r = await h.svc.confirmarPendientes([60], DUENO);
        expect(h.ejecutar).toHaveBeenCalledWith(60, 3, 40, undefined);
        expect(h.grupo).not.toHaveBeenCalled();
        expect(r).toMatchObject({ grupoId: null, cargas: [{ remesaId: 60 }] });
    });

    it('CP-1 bis: el origen es el de la fila, completo (remesaOrigenId y remesaOrigenIds)', async () => {
        const h = armar([pendiente(60, 'N1', { progreso: progreso({ resumen: origen(40, [40, 41]) }) })]);
        await h.svc.confirmarPendientes([60], DUENO);
        expect(h.ejecutar).toHaveBeenCalledWith(60, 3, 40, [40, 41]);
    });

    it('CP-2: tres pendientes del mismo archivo: ejecutarGrupo con los ids ascendentes y el origen; responde con el grupoId nuevo', async () => {
        const h = armar([pendiente(62, 'N3'), pendiente(60, 'N1'), pendiente(61, 'N2')]);
        const r = await h.svc.confirmarPendientes([62, 60, 61], DUENO);
        expect(h.grupo).toHaveBeenCalledWith({ remesaIds: [60, 61, 62], remesaOrigenId: 40, remesaOrigenIds: undefined }, 3);
        expect(h.ejecutar).not.toHaveBeenCalled();
        expect(r.grupoId).toBe('nuevo-grupo');
        expect(r.cargas).toHaveLength(3);
    });

    it('CP-3: ids repetidos y desordenados se deduplican y ordenan', async () => {
        const h = armar([pendiente(60, 'N1'), pendiente(61, 'N2')]);
        await h.svc.confirmarPendientes([61, 60, 61, 60], DUENO);
        expect(h.grupo.mock.calls[0][0].remesaIds).toEqual([60, 61]);
    });

    it.each([
        ['un borrador sin resumen (nunca se confirmó)', pendiente(60, 'N1', { progreso: progreso({ resumen: null }) })],
        ['una en cola', pendiente(60, 'N1', { estadoProceso: 'PENDIENTE', progreso: progreso({ fase: 'EN_COLA', encoladaAt: T0, resumen: origen(40) }) })],
        ['una terminal', pendiente(60, 'N1', { estadoProceso: 'FINALIZADA', progreso: progreso({ fase: 'TERMINADA', encoladaAt: T0, finishedAt: T0, resumen: origen(40) }) })],
    ])('CP-4: %s: 409 NO_ES_PENDIENTE que la nombra y nada se llama', async (_n, mala) => {
        const h = armar([pendiente(61, 'N2'), mala]);
        const e: any = await h.svc.confirmarPendientes([61, 60], DUENO).catch((x) => x);
        expect(e).toBeInstanceOf(ConflictException);
        expect(e.getResponse()).toMatchObject({ statusCode: 409, code: 'NO_ES_PENDIENTE' });
        expect(e.message).toContain('00060');
        nadaSeLlamo(h);
    });

    it('CP-5: orígenes distintos: 409 ORIGEN_DISTINTO; [1, 2] y [2, 1] son el mismo origen', async () => {
        const h = armar([pendiente(60, 'N1'), pendiente(61, 'N2', { progreso: progreso({ resumen: origen(50) }) })]);
        const e: any = await h.svc.confirmarPendientes([60, 61], DUENO).catch((x) => x);
        expect(e.getResponse()).toMatchObject({ statusCode: 409, code: 'ORIGEN_DISTINTO' });
        nadaSeLlamo(h);

        const igual = armar([
            pendiente(60, 'N1', { progreso: progreso({ resumen: origen(null, [1, 2]) }) }),
            pendiente(61, 'N2', { progreso: progreso({ resumen: origen(null, [2, 1]) }) }),
        ]);
        await igual.svc.confirmarPendientes([60, 61], DUENO);
        expect(igual.grupo).toHaveBeenCalledTimes(1);
    });

    it('CP-6: dos con el mismo corte: 409 CORTE_YA_CONFIRMADO que nombra las dos', async () => {
        const h = armar([pendiente(60, 'N1'), pendiente(61, 'N1')]);
        const e: any = await h.svc.confirmarPendientes([60, 61], DUENO).catch((x) => x);
        expect(e.getResponse()).toMatchObject({ statusCode: 409, code: 'CORTE_YA_CONFIRMADO' });
        expect(e.message).toContain('00060');
        expect(e.message).toContain('00061');
        nadaSeLlamo(h);
    });

    it('CP-7: ni dueño ni ver_progreso_otros: 403 y nada se llama; con el permiso, pasa', async () => {
        const h = armar([pendiente(60, 'N1')]);
        await expect(h.svc.confirmarPendientes([60], { sub: 9, permisos: ['importacion.ejecutar'] })).rejects.toBeInstanceOf(ForbiddenException);
        nadaSeLlamo(h);
        await h.svc.confirmarPendientes([60], { sub: 9, permisos: ['importacion.ejecutar', 'importacion.ver_progreso_otros'] });
        expect(h.ejecutar).toHaveBeenCalledWith(60, 9, 40, undefined); // quien confirma pasa a ser el dueño
    });

    it('CP-8: una que no existe: 404 y nada se llama', async () => {
        const h = armar([pendiente(60, 'N1')]);
        await expect(h.svc.confirmarPendientes([60, 99], DUENO)).rejects.toBeInstanceOf(NotFoundException);
        nadaSeLlamo(h);
    });

    it('CP-9: si el método delegado tira (409 otra en curso, 503), sale tal cual', async () => {
        const h = armar([pendiente(60, 'N1')]);
        const conflicto = new ConflictException('Ya tenés una importación en curso.');
        h.ejecutar.mockRejectedValueOnce(conflicto);
        await expect(h.svc.confirmarPendientes([60], DUENO)).rejects.toBe(conflicto);
        const caida = new ServiceUnavailableException('la cola no responde');
        h.ejecutar.mockRejectedValueOnce(caida);
        await expect(h.svc.confirmarPendientes([60], DUENO)).rejects.toBe(caida);
    });

    it('la respuesta de un grupo conserva noEncoladas', async () => {
        const h = armar([pendiente(60, 'N1'), pendiente(61, 'N2')]);
        h.grupo.mockResolvedValueOnce({ message: 'm', grupoId: 'g', cargas: [], noEncoladas: [{ remesaId: 61, numeroRemesa: '00061' }] } as never);
        const r = await h.svc.confirmarPendientes([60, 61], DUENO);
        expect(r.noEncoladas).toEqual([{ remesaId: 61, numeroRemesa: '00061' }]);
    });
});
