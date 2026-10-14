/**
 * Historial de una empresa y las lecturas con el extra `corteRepetidoEn`
 * (docs/imports-progreso-c2-spec.md §5.1, §5.2 y §5.7; casos HI-1 a HI-12 y RT-1 a RT-3 de §10.2 C y G).
 */
import { Logger } from '@nestjs/common';
import { dobleLecturas } from './doble-prisma-lecturas';
import { ImportService } from './imports.service';
import { armarEstadoCarga } from './progreso/estado-carga';

beforeAll(() => Logger.overrideLogger(false));

const T0 = new Date('2026-10-01T10:00:00Z');
const despues = (min: number) => new Date(T0.getTime() + min * 60_000);
const CORTE = (n: string) => [{ fromIndex: 45, operador: 'IGUAL', valor: n }];
const ORIGEN = (id: number | null = null) => ({ v: 1, origen: { remesaOrigenId: id, remesaOrigenIds: null } });

const progreso = (o: Record<string, any> = {}) => ({
    rev: 1, fase: 'BORRADOR', subfase: null, porcentaje: 0, totalEsperado: 0, procesadas: 0, ok: 0, err: 0, descartadas: 0,
    fueraDeCorte: null, advertencias: 0, nuevos: null, actualizados: null, resultado: null, error: null, errorPostProceso: null,
    resumen: null, intentos: 0, jobId: null, grupoId: null, grupoOrden: null, grupoTotal: null, cancelSolicitadaAt: null,
    encoladaAt: null, startedAt: null, heartbeatAt: null, finishedAt: null, ...o,
});

const rem = (id: number, o: Record<string, any> = {}) => ({
    id, numeroRemesa: String(id).padStart(5, '0'), nombre: `Carga ${id}`, empresaId: 10, plantillaId: 5, plantilla: { id: 5, nombre: 'Plantilla' },
    archivoHash: 'hash-A', categoria: 'DEUDORES', estadoProceso: 'FINALIZADA', totalFilas: 10, okFilas: 10, errFilas: 0, usuarioCreadorId: 3,
    filtroFilas: null, divisionValores: null, archivos: null, politicaId: null, accionRevertidaEn: null, createdAt: T0, casos: 0,
    progreso: null as any, ...o,
});

/** Una carga terminada bien. */
const finalizada = (id: number, o: Record<string, any> = {}) =>
    rem(id, { progreso: progreso({ fase: 'TERMINADA', resultado: 'OK', encoladaAt: T0, startedAt: T0, finishedAt: despues(5), porcentaje: 100, procesadas: 10, ok: 10, totalEsperado: 10 }), ...o });

/** Cargó sin entregar ninguna fila: retomable. */
const retomable = (id: number, corte: string | null, o: Record<string, any> = {}) =>
    rem(id, {
        estadoProceso: 'FALLIDA', filtroFilas: corte ? CORTE(corte) : null,
        progreso: progreso({ fase: 'TERMINADA', resultado: 'FALLIDA', error: 'Se cayó', encoladaAt: despues(1), finishedAt: despues(2), resumen: { ...ORIGEN(), sinFilasEntregadas: true } }),
        ...o,
    });

const enCola = (id: number, minutos: number, o: Record<string, any> = {}) =>
    rem(id, { estadoProceso: 'PENDIENTE', progreso: progreso({ fase: 'EN_COLA', encoladaAt: despues(minutos), resumen: ORIGEN() }), ...o });

/** Borrador ya confirmado una vez que el servidor no pudo mandar a la cola. */
const pendiente = (id: number, corte: string | null, o: Record<string, any> = {}) =>
    rem(id, { estadoProceso: 'VALIDANDO', filtroFilas: corte ? CORTE(corte) : null, divisionValores: corte ? { Nómina: corte } : null, progreso: progreso({ resumen: ORIGEN(40) }), ...o });

function servicio(remesas: any[]) {
    const d = dobleLecturas({ remesas });
    const svc = new ImportService(d.prisma, null as never, null as never, null as never, null as never, null as never, null as never, null as never, null as never);
    return { svc, d };
}

describe('historial', () => {
    it('HI-1: 30 remesas, página 2 de 25: 5 filas por id descendente', async () => {
        const { svc } = servicio(Array.from({ length: 30 }, (_, i) => finalizada(i + 1)));
        const r = await svc.historial({ empresaId: 10, page: 2, pageSize: 25 });
        expect(r.data.map((x) => x.id)).toEqual([5, 4, 3, 2, 1]);
        expect([r.total, r.page, r.pageSize, r.totalPages]).toEqual([30, 2, 25, 2]);
    });

    it('HI-2: q encuentra por número y por nombre sin distinguir mayúsculas, y nunca otra empresa', async () => {
        const { svc } = servicio([
            finalizada(1, { nombre: 'Cartera Mayo' }), finalizada(2, { nombre: 'Otra' }), finalizada(151, { nombre: 'zzz' }),
            finalizada(4, { nombre: 'cartera mayo ajena', empresaId: 99 }),
        ]);
        expect((await svc.historial({ empresaId: 10, q: 'CARTERA' })).data.map((x) => x.id)).toEqual([1]);
        expect((await svc.historial({ empresaId: 10, q: '00151' })).data.map((x) => x.id)).toEqual([151]);
        expect((await svc.historial({ empresaId: 10, q: 'cartera' })).total).toBe(1);
    });

    it('HI-3: la carga de cada fila es exactamente lo que da armarEstadoCarga: cancelada, en cola, heredada', async () => {
        const cancelada = rem(1, {
            estadoProceso: 'FALLIDA',
            progreso: progreso({ fase: 'TERMINADA', resultado: 'CANCELADA', error: 'Cancelada', encoladaAt: T0, finishedAt: despues(1), resumen: ORIGEN() }),
        });
        const cola = enCola(2, 3);
        const delante = enCola(3, 1, { estadoProceso: 'PROCESANDO', progreso: progreso({ fase: 'PROCESANDO', encoladaAt: despues(1), startedAt: despues(1), resumen: ORIGEN() }) });
        const heredada = rem(4, { progreso: null });
        const { svc } = servicio([cancelada, cola, delante, heredada]);
        const r = await svc.historial({ empresaId: 10 });
        const por = (id: number) => r.data.find((x) => x.id === id)!;
        const esperado = (x: any, extras = {}) => ({
            ...armarEstadoCarga({ ...x, usuarioCreador: { id: 3, nombre: 'Maxi' } }, x.progreso, new Date(), extras),
            servidorAhora: expect.any(String),
        });
        expect(por(1).carga).toEqual(esperado(cancelada));
        expect(por(1).carga.cancelada).toBe(true);
        expect(por(2).carga).toEqual(esperado(cola, { enColaDelante: 1 }));
        expect(por(2).carga.enColaDelante).toBe(1);
        expect(por(4).carga).toEqual(esperado(heredada));
        expect(por(4).carga.rev).toBe(0);
    });

    it('HI-4: sin ninguna en cola no se consulta posicionesEnCola', async () => {
        const { svc, d } = servicio([finalizada(1), finalizada(2)]);
        await svc.historial({ empresaId: 10 });
        expect(d.llamadas).not.toContain('import_progreso.findMany');
    });

    it('HI-5: un grupo de 5 con 2 en la página cuenta las 5; con una eliminada, existentes 4 y total 5', async () => {
        const miembro = (id: number, orden: number, o: Record<string, any> = {}) =>
            finalizada(id, { progreso: { ...finalizada(id).progreso, grupoId: 'g1', grupoOrden: orden, grupoTotal: 5 }, ...o });
        const falla = (id: number, orden: number) =>
            retomable(id, `N${id}`, { progreso: { ...retomable(id, `N${id}`).progreso, grupoId: 'g1', grupoOrden: orden, grupoTotal: 5 } });
        const cancelada = (id: number, orden: number) =>
            rem(id, { estadoProceso: 'FALLIDA', progreso: progreso({ fase: 'TERMINADA', resultado: 'CANCELADA', encoladaAt: T0, finishedAt: despues(1), grupoId: 'g1', grupoOrden: orden, grupoTotal: 5, resumen: ORIGEN() }) });
        const todas = [miembro(1, 1), miembro(2, 2), cancelada(3, 3), falla(4, 4), miembro(5, 5)];
        const { svc } = servicio(todas);
        const r = await svc.historial({ empresaId: 10, pageSize: 2 });
        expect(r.data.map((x) => x.id)).toEqual([5, 4]);
        expect(r.grupos.g1).toEqual({ grupoId: 'g1', total: 5, existentes: 5, enCurso: 0, cancelables: 0, retomables: 2, finalizadas: 3, noCargadas: 2, usuarioId: 3 });
        // La cancelada antes de empezar (3) y la fallida sin filas (4) son retomables.

        const sinUna = servicio(todas.filter((x) => x.id !== 2));
        const g = (await sinUna.svc.historial({ empresaId: 10, pageSize: 2 })).grupos.g1;
        expect([g.existentes, g.total]).toEqual([4, 5]);
    });

    describe('retomable honesto', () => {
        it('HI-6: una retomable con corte cuyo corte figura en otra confirmada después: retomable false y corteRepetidoEn', async () => {
            const a = retomable(1, 'X70');
            const b = finalizada(2, { filtroFilas: CORTE('X70'), numeroRemesa: 'X70', progreso: { ...finalizada(2).progreso, encoladaAt: despues(30) } });
            const { svc } = servicio([a, b]);
            const r = await svc.historial({ empresaId: 10 });
            const ia = r.data.find((x) => x.id === 1)!;
            expect(ia.carga.retomable).toBe(false);
            expect(ia.carga.corteRepetidoEn).toEqual(['X70']);
            // Y el grupo no la cuenta entre las retomables.
            const enGrupo = retomable(3, 'X70', { progreso: { ...retomable(3, 'X70').progreso, grupoId: 'g', grupoOrden: 1, grupoTotal: 1 } });
            const s2 = servicio([enGrupo, b]);
            const g = (await s2.svc.historial({ empresaId: 10 })).grupos.g;
            expect(g.retomables).toBe(0);
            expect(g.noCargadas).toBe(1);
        });

        it.each([
            ['confirmada antes de que esta se creara', { progreso: { ...finalizada(2).progreso, encoladaAt: new Date(T0.getTime() - 60_000) } }],
            ['en SIN_CARGAR', { estadoProceso: 'FALLIDA', progreso: progreso({ fase: 'TERMINADA', resultado: 'FALLIDA', encoladaAt: despues(30), finishedAt: despues(31), resumen: { ...ORIGEN(), sinFilasEntregadas: true } }) }],
            ['de otra plantilla', { plantillaId: 6 }],
        ])('HI-7: %s: retomable true y corteRepetidoEn null', async (_n, otra) => {
            const a = retomable(1, 'X70');
            const b = finalizada(2, { filtroFilas: CORTE('X70'), progreso: { ...finalizada(2).progreso, encoladaAt: despues(30) }, ...otra });
            const { svc } = servicio([a, b]);
            const ia = (await svc.historial({ empresaId: 10 })).data.find((x) => x.id === 1)!;
            expect(ia.carga.retomable).toBe(true);
            expect(ia.carga.corteRepetidoEn).toBeNull();
        });

        it('RT-1: progreso, status y grupo de una retomable con el corte repetido: retomable false y corteRepetidoEn', async () => {
            const a = retomable(1, 'X70', { progreso: { ...retomable(1, 'X70').progreso, grupoId: 'g', grupoOrden: 1, grupoTotal: 1 } });
            const b = finalizada(2, { filtroFilas: CORTE('X70'), numeroRemesa: 'X70', progreso: { ...finalizada(2).progreso, encoladaAt: despues(30) } });
            const { svc } = servicio([a, b]);
            const p = await svc.progreso(1);
            expect([p.retomable, p.corteRepetidoEn]).toEqual([false, ['X70']]);
            const s = await svc.status(1);
            expect([s.carga.retomable, s.carga.corteRepetidoEn]).toEqual([false, ['X70']]);
            const g = await svc.grupo('g');
            expect([g.remesas[0].retomable, g.remesas[0].corteRepetidoEn]).toEqual([false, ['X70']]);
        });

        it('RT-2: progreso de una carga en curso, y de una retomable sin corte, no hacen ninguna consulta de más', async () => {
            const { svc, d } = servicio([enCola(1, 1), retomable(2, null)]);
            await svc.progreso(2);
            expect(d.llamadas).toEqual(['remesa.findUnique']);
            d.llamadas.length = 0;
            await svc.progreso(1);
            expect(d.llamadas.filter((l) => l === 'remesa.findMany')).toEqual([]);
        });
    });

    it('HI-8: pendientes de encolar: hermanas, origen resuelto y lo ya cargado', async () => {
        const origen40 = finalizada(40, { nombre: 'Base de casos' });
        const a = pendiente(60, 'N1');
        const b = pendiente(61, 'N2');
        const otroDueno = pendiente(62, 'N3', { usuarioCreadorId: 9 });
        const otroOrigen = pendiente(63, 'N4', { progreso: progreso({ resumen: ORIGEN(50) }) });
        const sinResumen = pendiente(64, 'N5', { progreso: progreso({ resumen: null }) });
        const sinCorte = pendiente(65, null, { archivoHash: 'hash-B' });
        const ya = finalizada(70, { filtroFilas: CORTE('N1'), progreso: { ...finalizada(70).progreso, encoladaAt: despues(30) } });
        const yaSinCorte = finalizada(71, { archivoHash: 'hash-B', progreso: { ...finalizada(71).progreso, encoladaAt: despues(30) } });
        const { svc } = servicio([origen40, a, b, otroDueno, otroOrigen, sinResumen, sinCorte, ya, yaSinCorte]);
        const r = await svc.historial({ empresaId: 10 });
        const por = (id: number) => r.data.find((x) => x.id === id)!;

        expect(por(60).pendienteDeEncolar).toEqual({
            remesas: [{ remesaId: 60, numeroRemesa: '00060', corte: 'Nómina N1' }, { remesaId: 61, numeroRemesa: '00061', corte: 'Nómina N2' }],
            origen: [{ remesaId: 40, numeroRemesa: '00040', nombre: 'Base de casos' }],
            yaCargadoEn: [{ remesaId: 70, numeroRemesa: '00070' }],
        });
        expect(por(61).pendienteDeEncolar!.remesas.map((x) => x.remesaId)).toEqual([60, 61]);
        expect(por(61).pendienteDeEncolar!.yaCargadoEn).toEqual([]);
        expect(por(62).pendienteDeEncolar!.remesas.map((x) => x.remesaId)).toEqual([62]);
        // El origen 50 ya no existe.
        expect(por(63).pendienteDeEncolar!.origen).toEqual([{ remesaId: 50, numeroRemesa: null, nombre: null }]);
        expect(por(64).pendienteDeEncolar).toBeNull();
        // Sin corte: solo ella, y avisa del mismo archivo confirmado después.
        expect(por(65).pendienteDeEncolar!.remesas.map((x) => x.remesaId)).toEqual([65]);
        expect(por(65).pendienteDeEncolar!.yaCargadoEn).toEqual([{ remesaId: 71, numeroRemesa: '00071' }]);
        expect(por(70).pendienteDeEncolar).toBeNull();
    });

    it.each([
        ['se confirmó antes', { progreso: { encoladaAt: new Date(T0.getTime() - 60_000) } }],
        ['es un borrador', { estadoProceso: 'PENDIENTE', progreso: null }],
        ['es de otra plantilla', { plantillaId: 6 }],
    ])('HI-8 bis: yaCargadoEn vacío si esa otra %s', async (_n, cambio: any) => {
        const a = pendiente(60, 'N1');
        const base = finalizada(70, { filtroFilas: CORTE('N1'), progreso: { ...finalizada(70).progreso, encoladaAt: despues(30) } });
        const otra = { ...base, ...cambio, progreso: cambio.progreso === null ? progreso() : { ...base.progreso, ...(cambio.progreso ?? {}) } };
        const { svc } = servicio([a, otra]);
        expect((await svc.historial({ empresaId: 10 })).data.find((x) => x.id === 60)!.pendienteDeEncolar!.yaCargadoEn).toEqual([]);
    });

    it('HI-9: el número de consultas no depende del tamaño de la página (3 grupos, 4 en cola, 2 pendientes)', async () => {
        const armarTodo = (relleno: number) => {
            const filas: any[] = [];
            let id = 1000;
            for (const g of ['g1', 'g2', 'g3']) {
                for (let o = 1; o <= 5; o++) filas.push(finalizada(id++, { progreso: { ...finalizada(1).progreso, grupoId: g, grupoOrden: o, grupoTotal: 5 } }));
            }
            for (let i = 0; i < 4; i++) filas.push(enCola(id++, i));
            filas.push(pendiente(id++, 'N1'), pendiente(id++, 'N2'));
            for (let i = 0; i < relleno; i++) filas.push(finalizada(id++));
            return filas;
        };
        const sobre = async (relleno: number, pageSize: number) => {
            const { svc, d } = servicio(armarTodo(relleno));
            const r = await svc.historial({ empresaId: 10, pageSize });
            return { llamadas: d.llamadas.length, filas: r.data.length };
        };
        const chica = await sobre(0, 25);
        const grande = await sobre(78, 100);
        expect(chica.filas).toBe(21);
        expect(grande.filas).toBe(99);
        expect(chica.llamadas).toBeLessThanOrEqual(7);
        expect(grande.llamadas).toBe(chica.llamadas);
    });

    it('HI-10: corte y archivos salen de divisionValores y de archivos.nombres; null cuando no hay', async () => {
        const { svc } = servicio([
            finalizada(1, { divisionValores: { 'Nómina': '3082', 'Gestión': '3GH' }, archivos: { lista: ['/x/a'], nombres: ['uno.txt', 'dos.txt'] } }),
            finalizada(2),
        ]);
        const r = await svc.historial({ empresaId: 10 });
        const [dos, uno] = r.data;
        expect(uno).toMatchObject({ id: 1, corte: 'Nómina 3082 / Gestión 3GH', archivos: ['uno.txt', 'dos.txt'] });
        expect(dos).toMatchObject({ id: 2, corte: null, archivos: null });
    });

    it('HI-11: si la consulta de miembros devuelve vacío, no tira y el grupo sale con lo que hay', async () => {
        const { svc, d } = servicio([finalizada(1, { progreso: { ...finalizada(1).progreso, grupoId: 'g', grupoOrden: 1, grupoTotal: 3 } })]);
        const original = d.prisma.remesa.findMany;
        d.prisma.remesa.findMany = async (a: any) => (a.where?.progreso?.is?.grupoId ? [] : original(a));
        const r = await svc.historial({ empresaId: 10 });
        expect(r.data).toHaveLength(1);
        expect(r.grupos.g).toMatchObject({ existentes: 1, total: 3 });
    });

    it('HI-13 (C3b): el ítem trae `reversion` (el contrato de la reversión) cuando la acción se está revirtiendo, y null si nunca se pidió', async () => {
        const fila = {
            remesaId: 7, estado: 'REVIRTIENDO', usuarioId: 3, jobId: 'revertir-7-1', intentos: 1, total: 200, hechos: 80,
            deudoresRevertidos: 70, contactosRestaurados: 6, comentariosBorrados: 4, casosQueNoExistian: 0, contactosSinCaso: 0,
            error: null, encoladaAt: T0, startedAt: T0, heartbeatAt: T0, finishedAt: null,
        };
        const { svc, d } = servicio([finalizada(7, { categoria: 'ACCIONES', reversion: fila }), finalizada(6, { categoria: 'ACCIONES', reversion: null }), finalizada(5)]);
        const r = await svc.historial({ empresaId: 10, page: 1, pageSize: 25 });
        const porId = new Map(r.data.map((x) => [x.id, x]));

        expect(porId.get(7)!.reversion).toEqual({
            remesaId: 7, empresaId: 10, estado: 'REVIRTIENDO', total: 200, hechos: 80, porcentaje: 40,
            deudoresRevertidos: 70, contactosRestaurados: 6, comentariosBorrados: 4, casosQueNoExistian: 0, contactosSinCaso: 0,
            usuarioId: 3, error: null, encoladaAt: T0.toISOString(), startedAt: T0.toISOString(), finishedAt: null,
        });
        expect(porId.get(6)!.reversion).toBeNull();
        expect(porId.get(5)!.reversion).toBeNull(); // una categoría que no es ACCIONES no trae la relación
        // La relación viaja en el mismo findMany de la página: no suma una consulta por fila.
        expect(d.llamadas.filter((l) => l === 'remesa.findMany')).toHaveLength(1);
    });

    it('HI-12: el total es igual a la cantidad que devuelve listRemesas', async () => {
        const { svc } = servicio([finalizada(1), enCola(2, 1), pendiente(3, null), rem(4, { empresaId: 99 }), retomable(5, 'A')]);
        expect((await svc.historial({ empresaId: 10 })).total).toBe((await svc.listRemesas(10)).length);
    });
});

describe('status', () => {
    it('RT-3: trae origen resuelto y corte; sin resumen, origen null', async () => {
        const origen = finalizada(40, { nombre: 'Base' });
        const conOrigen = finalizada(1, { divisionValores: { Nómina: '3082' }, progreso: { ...finalizada(1).progreso, resumen: { v: 1, origen: { remesaOrigenId: 40, remesaOrigenIds: [40, 41] } } } });
        const sinResumen = finalizada(2);
        const { svc } = servicio([origen, conOrigen, sinResumen]);
        const a = await svc.status(1);
        expect(a.origen).toEqual([{ remesaId: 40, numeroRemesa: '00040', nombre: 'Base' }, { remesaId: 41, numeroRemesa: null, nombre: null }]);
        expect(a.corte).toBe('Nómina 3082');
        const b = await svc.status(2);
        expect(b.origen).toBeNull();
        expect(b.corte).toBeNull();
    });
});

describe('pendientes de encolar — hermanas y búsqueda (hallazgos de la auditoría de C2a)', () => {
    const svc = () => new ImportService({} as never, null as never, null as never, null as never, null as never, null as never, null as never, null as never, null as never) as any;
    const corte = (valor: string) => [{ fromIndex: 3, operador: 'IN', valores: [valor] }];
    const borrador = (id: number, valor: string, minuto: number) => ({ id, filtroFilas: corte(valor), createdAt: new Date(`2026-10-14T10:${String(minuto).padStart(2, '0')}:00Z`) });

    it('dos altas del mismo archivo: de cada corte queda uno, el de esta remesa o el del alta más cercana', () => {
        // Alta 1 (10:00): HE-1 (H1), HE-2 (H2). Alta 2 (10:30): HF-1 (H1), HF-2 (H2).
        const he1 = borrador(1, 'H1', 0), he2 = borrador(2, 'H2', 0), hf1 = borrador(3, 'H1', 30), hf2 = borrador(4, 'H2', 30);
        const todas = [he1, he2, hf1, hf2];
        expect(svc().unaPorCorte(todas, he1).map((r: any) => r.id).sort()).toEqual([1, 2]);
        expect(svc().unaPorCorte(todas, hf2).map((r: any) => r.id).sort()).toEqual([3, 4]);
        // La propia remesa siempre queda, aunque no venga en la lista.
        expect(svc().unaPorCorte([he2], he1).map((r: any) => r.id).sort()).toEqual([1, 2]);
    });

    it('la búsqueda trata "%" y "_" como texto, no como comodines del LIKE', async () => {
        const where: any[] = [];
        const prisma: any = {
            remesa: {
                count: jest.fn((a: any) => { where.push(a.where); return Promise.resolve(0); }),
                findMany: jest.fn(() => Promise.resolve([])),
            },
        };
        const s = new ImportService(prisma, null as never, null as never, null as never, null as never, null as never, null as never, null as never, null as never);
        await s.historial({ empresaId: 1, q: 'AYSA_2 50%' }).catch(() => undefined);
        expect(where[0].OR[0].numeroRemesa.contains).toBe('AYSA\\_2 50\\%');
    });
});
