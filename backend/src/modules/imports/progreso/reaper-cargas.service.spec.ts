/**
 * Los dos reapers (docs/imports-progreso-realtime-spec.md §9.9.2 E, casos RC-1 a RC-19 y RB-1 a RB-7).
 *
 * `prisma` e `ImportService` falsos y el reloj inyectado. Lo que más importa: el reaper NO cierra una
 * carga viva en este proceso, no cierra nada en una sola pasada, no cierra con la cola sin responder, y
 * no cierra una carga en cola que tiene su job esperando.
 */
import { Logger } from '@nestjs/common';
import {
    borradorTtlHoras,
    MAX_BORRADORES_POR_CORRIDA,
    ReaperCargasService,
    reaperDesactivado,
    umbralLatidoMin,
} from './reaper-cargas.service';

const MIN = 60_000;
const T0 = new Date('2026-10-09T12:00:00Z').getTime();

interface Candidata {
    remesaId: number;
    encoladaAt: Date | null;
    startedAt: Date | null;
    heartbeatAt: Date | null;
    jobId: string | null;
}

/** Una carga arrancada cuyo último latido fue hace `latidoHace` minutos. */
const arrancada = (latidoHace: number, id = 1): Candidata => ({
    remesaId: id,
    encoladaAt: new Date(T0 - (latidoHace + 10) * MIN),
    startedAt: new Date(T0 - (latidoHace + 5) * MIN),
    heartbeatAt: new Date(T0 - latidoHace * MIN),
    jobId: '7',
});

/** Una carga en cola, confirmada hace `enColaHace` minutos, que nunca arrancó. */
const enCola = (enColaHace: number, id = 1): Candidata => ({
    remesaId: id,
    encoladaAt: new Date(T0 - enColaHace * MIN),
    startedAt: null,
    heartbeatAt: null,
    jobId: '7',
});

function armar() {
    let candidatas: Candidata[] = [];
    const estado = { ahora: T0 };
    const prisma: any = {
        import_progreso: { findMany: jest.fn().mockImplementation(() => Promise.resolve(candidatas)) },
        remesa: { findMany: jest.fn().mockResolvedValue([]) },
        $transaction: jest.fn(),
    };
    const importService: any = {
        cargaVivaEnEsteProceso: jest.fn().mockReturnValue(null),
        hayCargasVivasEnEsteProceso: jest.fn().mockReturnValue(false),
        estadoDelJobDeCarga: jest.fn().mockResolvedValue({ estado: 'NO_EXISTE' }),
        cerrarCargaInterrumpida: jest.fn().mockResolvedValue({ procesadas: 40 }),
        sacarJobDeLaCola: jest.fn().mockResolvedValue(true),
    };
    const reaper = new ReaperCargasService(prisma, importService);
    reaper.ahora = () => estado.ahora;
    const logger: Logger = (reaper as any).logger;
    const warn = jest.spyOn(logger, 'warn').mockImplementation();
    const log = jest.spyOn(logger, 'log').mockImplementation();
    jest.spyOn(logger, 'error').mockImplementation();
    return {
        reaper, prisma, importService, warn, log,
        pone: (c: Candidata[]) => { candidatas = c; },
        /** Avanza el reloj `s` segundos y hace una pasada. */
        pasada: async (s = 0) => { estado.ahora += s * 1000; return reaper.revisarCargasColgadas(); },
        reloj: estado,
    };
}

const ENV = ['IMPORTS_REAPER_DESACTIVADO', 'IMPORTS_LATIDO_UMBRAL_MIN', 'IMPORTS_BORRADOR_TTL_HORAS'];
beforeEach(() => ENV.forEach((k) => delete process.env[k]));
afterEach(() => {
    ENV.forEach((k) => delete process.env[k]);
    jest.restoreAllMocks();
});

describe('reaper de cargas colgadas', () => {
    it('RC-1: una carga VIVA en este proceso no se cierra ni en la primera pasada ni en la décima, y avisa del latido atrasado', async () => {
        const h = armar();
        h.importService.cargaVivaEnEsteProceso.mockReturnValue({ sinAvanceMs: 1000, fase: 'PROCESANDO', subfase: null });
        h.pone([arrancada(30)]);

        for (let i = 0; i < 10; i++) await h.pasada(60);

        expect(h.importService.cerrarCargaInterrumpida).not.toHaveBeenCalled();
        expect(h.importService.estadoDelJobDeCarga).not.toHaveBeenCalled(); // ni siquiera consulta la cola
        expect(h.warn.mock.calls.some(([m]) => String(m).includes('latido atrasado'))).toBe(true);
    });

    it('RC-2: arrancada, latido de hace 6 min, sin job: la primera pasada la anota; la segunda (60 s después) cierra con SIN_LATIDO', async () => {
        const h = armar();
        h.pone([arrancada(6)]);

        expect(await h.pasada()).toEqual([]);
        expect(h.importService.cerrarCargaInterrumpida).not.toHaveBeenCalled();
        expect(h.log.mock.calls.some(([m]) => String(m).includes('sospechosa'))).toBe(true);

        expect(await h.pasada(60)).toEqual([1]);
        expect(h.importService.cerrarCargaInterrumpida).toHaveBeenCalledTimes(1);
        expect(h.importService.cerrarCargaInterrumpida).toHaveBeenCalledWith(1, 'SIN_LATIDO', { umbralMs: 5 * MIN, jobId: '7' });
    });

    it('RC-3: entre las dos pasadas vuelve a latir: no cierra y olvida la sospecha (la próxima sospecha empieza de cero)', async () => {
        const h = armar();
        h.pone([arrancada(6)]);
        await h.pasada();
        h.pone([{ ...arrancada(0), heartbeatAt: new Date(h.reloj.ahora + 30_000) }]); // latió
        await h.pasada(60);
        h.pone([arrancada(0)].map((c) => ({ ...c, heartbeatAt: new Date(h.reloj.ahora - 6 * MIN) }))); // otra vez parada
        await h.pasada(60);

        expect(h.importService.cerrarCargaInterrumpida).not.toHaveBeenCalled(); // esta es la primera sospecha de nuevo
        await h.pasada(60);
        expect(h.importService.cerrarCargaInterrumpida).toHaveBeenCalledTimes(1);
    });

    it('RC-4: latido de hace 4 min: ni siquiera consulta la cola', async () => {
        const h = armar();
        h.pone([arrancada(4)]);
        await h.pasada();
        await h.pasada(30);
        expect(h.importService.estadoDelJobDeCarga).not.toHaveBeenCalled();
        expect(h.importService.cerrarCargaInterrumpida).not.toHaveBeenCalled();
    });

    it('RC-5: con el job ACTIVO_CON_LOCK no cierra nunca (otro proceso la tiene viva)', async () => {
        const h = armar();
        h.importService.estadoDelJobDeCarga.mockResolvedValue({ estado: 'ACTIVO_CON_LOCK' });
        h.pone([arrancada(60)]);
        for (let i = 0; i < 6; i++) await h.pasada(60);
        expect(h.importService.cerrarCargaInterrumpida).not.toHaveBeenCalled();
        expect(h.warn.mock.calls.some(([m]) => String(m).includes('tiene el lock'))).toBe(true);
    });

    it('RC-6: con el job ACTIVO_SIN_LOCK cierra a la segunda pasada y no toca el job', async () => {
        const h = armar();
        h.importService.estadoDelJobDeCarga.mockResolvedValue({ estado: 'ACTIVO_SIN_LOCK' });
        h.pone([arrancada(8)]);
        await h.pasada();
        await h.pasada(60);
        expect(h.importService.cerrarCargaInterrumpida).toHaveBeenCalledTimes(1);
        expect(h.importService.sacarJobDeLaCola).not.toHaveBeenCalled();
    });

    it('RC-7: con el job EN_ESPERA y la carga arrancada, cierra a la segunda pasada Y saca el job', async () => {
        const h = armar();
        h.importService.estadoDelJobDeCarga.mockResolvedValue({ estado: 'EN_ESPERA' });
        h.pone([arrancada(8)]);
        await h.pasada();
        expect(h.importService.sacarJobDeLaCola).not.toHaveBeenCalled();
        await h.pasada(60);
        expect(h.importService.cerrarCargaInterrumpida).toHaveBeenCalledTimes(1);
        expect(h.importService.sacarJobDeLaCola).toHaveBeenCalledWith(1, '7');
    });

    it('RC-7b: si cerrarCargaInterrumpida no cerró nada (la carga ya no correspondía), no toca el job', async () => {
        const h = armar();
        h.importService.estadoDelJobDeCarga.mockResolvedValue({ estado: 'EN_ESPERA' });
        h.importService.cerrarCargaInterrumpida.mockResolvedValue(null);
        h.pone([arrancada(8)]);
        await h.pasada();
        await h.pasada(60);
        expect(h.importService.sacarJobDeLaCola).not.toHaveBeenCalled();
    });

    it('RC-8: la cola no responde (DESCONOCIDO): no cierra, y una sospecha anterior se borra (hacen falta dos pasadas seguidas CON respuesta)', async () => {
        const h = armar();
        h.pone([arrancada(8)]);
        await h.pasada(); // NO_EXISTE: sospechosa
        h.importService.estadoDelJobDeCarga.mockResolvedValue({ estado: 'DESCONOCIDO' });
        await h.pasada(60); // no responde: se olvida
        h.importService.estadoDelJobDeCarga.mockResolvedValue({ estado: 'NO_EXISTE' });
        await h.pasada(60); // sospechosa otra vez (primera)
        expect(h.importService.cerrarCargaInterrumpida).not.toHaveBeenCalled();
        await h.pasada(60);
        expect(h.importService.cerrarCargaInterrumpida).toHaveBeenCalledTimes(1);

        // Con la cola siempre muda, jamás.
        const g = armar();
        g.importService.estadoDelJobDeCarga.mockResolvedValue({ estado: 'DESCONOCIDO' });
        g.pone([arrancada(120)]);
        for (let i = 0; i < 8; i++) await g.pasada(60);
        expect(g.importService.cerrarCargaInterrumpida).not.toHaveBeenCalled();
    });

    it('RC-9: dos pasadas con 20 s de diferencia no cierran: faltan los 45 s', async () => {
        const h = armar();
        h.pone([arrancada(8)]);
        await h.pasada();
        await h.pasada(20);
        expect(h.importService.cerrarCargaInterrumpida).not.toHaveBeenCalled();
        await h.pasada(30); // 50 s desde la primera
        expect(h.importService.cerrarCargaInterrumpida).toHaveBeenCalledTimes(1);
    });

    it('RC-10: en cola hace 10 horas CON el job esperando: no cierra (es la que espera detrás de otra)', async () => {
        const h = armar();
        h.importService.estadoDelJobDeCarga.mockResolvedValue({ estado: 'EN_ESPERA' });
        h.importService.hayCargasVivasEnEsteProceso.mockReturnValue(true);
        h.pone([enCola(600)]);
        for (let i = 0; i < 6; i++) await h.pasada(60);
        expect(h.importService.cerrarCargaInterrumpida).not.toHaveBeenCalled();
    });

    it('RC-11: en cola hace 3 min, sin job: cierra a la segunda pasada con SIN_JOB', async () => {
        const h = armar();
        h.pone([enCola(3)]);
        await h.pasada();
        expect(h.importService.cerrarCargaInterrumpida).not.toHaveBeenCalled();
        await h.pasada(60);
        expect(h.importService.cerrarCargaInterrumpida).toHaveBeenCalledWith(1, 'SIN_JOB', expect.objectContaining({ umbralMs: 5 * MIN }));
    });

    it('RC-11b: un job TERMINADO que no arrancó la carga también es SIN_JOB', async () => {
        const h = armar();
        h.importService.estadoDelJobDeCarga.mockResolvedValue({ estado: 'TERMINADO' });
        h.pone([enCola(3)]);
        await h.pasada();
        await h.pasada(60);
        expect(h.importService.cerrarCargaInterrumpida).toHaveBeenCalledWith(1, 'SIN_JOB', expect.anything());
    });

    it('RC-12: en cola hace 1 min, sin job: no es candidata (la ventana normal entre el commit y el add)', async () => {
        const h = armar();
        h.pone([enCola(1)]);
        await h.pasada();
        await h.pasada(30);
        expect(h.importService.estadoDelJobDeCarga).not.toHaveBeenCalled();
        expect(h.importService.cerrarCargaInterrumpida).not.toHaveBeenCalled();
    });

    it.each(['ACTIVO_CON_LOCK', 'ACTIVO_SIN_LOCK'])('RC-13: en cola con el job %s: no cierra, el worker la está tomando', async (estado) => {
        const h = armar();
        h.importService.estadoDelJobDeCarga.mockResolvedValue({ estado });
        h.pone([enCola(10)]);
        for (let i = 0; i < 5; i++) await h.pasada(60);
        expect(h.importService.cerrarCargaInterrumpida).not.toHaveBeenCalled();
    });

    it('RC-14: viva en este proceso y sin avance hace 20 min: no cierra; un warn, y no otro hasta 15 min después', async () => {
        const h = armar();
        h.importService.cargaVivaEnEsteProceso.mockReturnValue({ sinAvanceMs: 20 * MIN, fase: 'POST_PROCESO', subfase: 'Consolidando casos: 1 de 9' });
        h.pone([{ ...arrancada(0), heartbeatAt: new Date(T0) }]);
        const avisos = () => h.warn.mock.calls.filter(([m]) => String(m).includes('sin avance'));

        await h.pasada();
        expect(avisos()).toHaveLength(1);
        expect(String(avisos()[0][0])).toContain('Consolidando casos: 1 de 9');
        for (let i = 0; i < 10; i++) {
            h.pone([{ ...arrancada(0), heartbeatAt: new Date(h.reloj.ahora + 60_000) }]);
            await h.pasada(60);
        }
        expect(avisos()).toHaveLength(1);
        h.pone([{ ...arrancada(0), heartbeatAt: new Date(h.reloj.ahora + 6 * MIN) }]);
        await h.pasada(6 * 60); // pasaron más de 15 min desde el primero
        expect(avisos()).toHaveLength(2);
        expect(h.importService.cerrarCargaInterrumpida).not.toHaveBeenCalled();
    });

    it('RC-15: la consulta de candidatas parte de import_progreso, con encoladaAt no nulo y finishedAt nulo, y descarta las remesas terminales', async () => {
        const h = armar();
        await h.pasada();
        const arg = h.prisma.import_progreso.findMany.mock.calls[0][0];
        expect(arg.where).toEqual({
            encoladaAt: { not: null },
            finishedAt: null,
            remesa: { estadoProceso: { notIn: ['FINALIZADA', 'FALLIDA'] } },
        });
        expect(h.prisma.remesa.findMany).not.toHaveBeenCalled(); // no hay forma de ver una remesa sin fila de progreso
    });

    it('RC-16: con IMPORTS_REAPER_DESACTIVADO ninguna de las dos funciones consulta nada', async () => {
        process.env.IMPORTS_REAPER_DESACTIVADO = '1';
        const h = armar();
        h.pone([arrancada(60)]);
        process.env.IMPORTS_REAPER_DESACTIVADO = 'false'; // `=false` NO la apaga: la pasada consulta
        await h.reaper.revisarCargasColgadas();
        expect(h.prisma.import_progreso.findMany).toHaveBeenCalledTimes(1);
        h.prisma.import_progreso.findMany.mockClear();
        process.env.IMPORTS_REAPER_DESACTIVADO = '1';
        expect(await h.reaper.revisarCargasColgadas()).toEqual([]);
        expect(await h.reaper.limpiarBorradores()).toEqual([]);
        expect(h.prisma.import_progreso.findMany).not.toHaveBeenCalled();
        expect(h.prisma.remesa.findMany).not.toHaveBeenCalled();
        expect(reaperDesactivado('')).toBe(false);
        expect(reaperDesactivado('  ')).toBe(false);
        // Solo 1, true, si, sí y yes (sin distinguir mayúsculas) la apagan; `=false` o `=0` NO.
        for (const v of ['1', 'true', 'TRUE', ' True ', 'si', 'Sí', 'sí', 'yes', 'YES', 'on', 'ON', 'y', 'Y', 's', 'S']) expect(reaperDesactivado(v)).toBe(true);
        for (const v of ['false', 'FALSE', '0', 'no', 'off', 'x', '2', 'n']) expect(reaperDesactivado(v)).toBe(false);
        delete process.env.IMPORTS_REAPER_DESACTIVADO;
        expect(reaperDesactivado()).toBe(false);
    });

    it('RC-17: una pasada que arranca con otra en curso sale sin hacer nada', async () => {
        const h = armar();
        let liberar!: () => void;
        h.prisma.import_progreso.findMany.mockImplementationOnce(() => new Promise((r) => { liberar = () => r([]); }));

        const primera = h.reaper.revisarCargasColgadas();
        const segunda = await h.reaper.revisarCargasColgadas();

        expect(segunda).toEqual([]);
        expect(h.prisma.import_progreso.findMany).toHaveBeenCalledTimes(1);
        liberar();
        await primera;
        // Y cuando la primera terminó, se puede volver a pasar.
        await h.reaper.revisarCargasColgadas();
        expect(h.prisma.import_progreso.findMany).toHaveBeenCalledTimes(2);
    });

    it('RC-18: el umbral: sin definir, "abc", 1 y 500 dan 5, 5, 3 y 120', () => {
        expect(umbralLatidoMin(undefined)).toBe(5);
        expect(umbralLatidoMin('abc')).toBe(5);
        expect(umbralLatidoMin('1')).toBe(3);
        expect(umbralLatidoMin('500')).toBe(120);
        expect(umbralLatidoMin('')).toBe(5);
        expect(umbralLatidoMin('10')).toBe(10);
    });

    it('RC-18b: el umbral de la variable de entorno es el que se le pasa al cierre', async () => {
        process.env.IMPORTS_LATIDO_UMBRAL_MIN = '10';
        const h = armar();
        h.pone([arrancada(8)]); // 8 min: con umbral 10 todavía late
        await h.pasada();
        await h.pasada(60);
        expect(h.importService.estadoDelJobDeCarga).not.toHaveBeenCalled();
        h.pone([arrancada(11)]);
        await h.pasada();
        await h.pasada(60);
        expect(h.importService.cerrarCargaInterrumpida).toHaveBeenCalledWith(1, 'SIN_LATIDO', expect.objectContaining({ umbralMs: 10 * MIN }));
    });

    it('RC-19: en cola hace 10 min, con el job esperando y ninguna carga viva: no cierra; un warn "el worker no lo toma", y no otro hasta 15 min después', async () => {
        const h = armar();
        h.importService.estadoDelJobDeCarga.mockResolvedValue({ estado: 'EN_ESPERA' });
        h.pone([enCola(10)]);
        const avisos = () => h.warn.mock.calls.filter(([m]) => String(m).includes('el worker no lo toma'));

        await h.pasada();
        await h.pasada(60);
        await h.pasada(60);
        expect(avisos()).toHaveLength(1);
        await h.pasada(15 * 60);
        expect(avisos()).toHaveLength(2);
        expect(h.importService.cerrarCargaInterrumpida).not.toHaveBeenCalled();
    });

    it('RC-19b: si el proceso SÍ tiene una carga viva, que el job espere es normal y no avisa', async () => {
        const h = armar();
        h.importService.estadoDelJobDeCarga.mockResolvedValue({ estado: 'EN_ESPERA' });
        h.importService.hayCargasVivasEnEsteProceso.mockReturnValue(true);
        h.pone([enCola(10)]);
        await h.pasada();
        expect(h.warn.mock.calls.some(([m]) => String(m).includes('el worker no lo toma'))).toBe(false);
    });

    it('una candidata que explota no frena a las demás', async () => {
        const h = armar();
        h.importService.estadoDelJobDeCarga.mockRejectedValueOnce(new Error('boom'));
        h.pone([arrancada(8, 1), arrancada(8, 2)]);
        await h.pasada();
        await h.pasada(60);
        expect(h.importService.cerrarCargaInterrumpida).toHaveBeenCalledTimes(1);
        expect(h.importService.cerrarCargaInterrumpida.mock.calls[0][0]).toBe(2);
    });

    it('una sospecha de una carga que ya no es candidata se olvida', async () => {
        const h = armar();
        h.pone([arrancada(8)]);
        await h.pasada();
        h.pone([]); // terminó sola
        await h.pasada(60);
        h.pone([arrancada(8)]);
        await h.pasada(60); // primera sospecha de nuevo
        expect(h.importService.cerrarCargaInterrumpida).not.toHaveBeenCalled();
    });
});

describe('reaper de borradores', () => {
    interface Fila { estadoProceso: string; fase: string; encoladaAt: Date | null }
    const borrador = (id: number) => ({ id, numeroRemesa: String(id).padStart(5, '0'), empresaId: 1, categoria: 'DEUDORES', createdAt: new Date(T0 - 25 * 60 * MIN) });

    function armarBorradores(opts: { candidatas?: any[]; fila?: Fila | null; deudor?: boolean; deleteFalla?: (id: number) => boolean } = {}) {
        const h = armar();
        h.prisma.remesa.findMany.mockResolvedValue(opts.candidatas ?? [borrador(151)]);
        const operaciones: string[] = [];
        const transacciones: string[][] = [];
        h.prisma.$transaction.mockImplementation(async (fn: any) => {
            const mias: string[] = [];
            transacciones.push(mias);
            const op = (n: string) => { operaciones.push(n); mias.push(n); };
            const tx: any = {
                $queryRaw: jest.fn().mockImplementation(() => {
                    op('lock');
                    const f = opts.fila === undefined ? { estadoProceso: 'PENDIENTE', fase: 'BORRADOR', encoladaAt: null } : opts.fila;
                    return Promise.resolve(f ? [f] : []);
                }),
                deudor: { findFirst: jest.fn().mockImplementation(() => { op('deudor'); return Promise.resolve(opts.deudor ? { id: 1 } : null); }) },
                importerror: { deleteMany: jest.fn().mockImplementation(() => { op('importerror'); return Promise.resolve({}); }) },
                jobimport: { deleteMany: jest.fn().mockImplementation(() => { op('jobimport'); return Promise.resolve({}); }) },
                remesa: {
                    delete: jest.fn().mockImplementation(({ where }: any) => {
                        op(`remesa:${where.id}`);
                        return opts.deleteFalla?.(where.id) ? Promise.reject(new Error('FK')) : Promise.resolve({});
                    }),
                },
            };
            return fn(tx);
        });
        return { ...h, operaciones, transacciones };
    }

    it('RB-1: el where es exactamente el predicado de §5.2: estados, antigüedad, fila en BORRADOR sin encoladaAt y ningún deudor', async () => {
        const h = armarBorradores({ candidatas: [] });
        await h.reaper.limpiarBorradores();
        const arg = h.prisma.remesa.findMany.mock.calls.find((c: any[]) => !c[0].distinct)![0];
        expect(arg.where).toEqual({
            estadoProceso: { in: ['PENDIENTE', 'VALIDANDO'] },
            createdAt: { lt: new Date(T0 - 24 * 60 * MIN) },
            progreso: { is: { fase: 'BORRADOR', encoladaAt: null } },
            deudor: { none: {} },
        });
        // Sin creadores con una carga en curso no se agrega nada.
        expect(arg.take).toBe(500);
        expect(arg.orderBy).toEqual({ id: 'asc' });
    });

    it('RB-8: un borrador cuyo creador tiene una carga en curso NO se borra (una división que está corriendo)', async () => {
        const h = armarBorradores({ candidatas: [borrador(151)] });
        // Los creadores con una carga encolada y sin terminar.
        h.prisma.remesa.findMany.mockImplementation((args: any) =>
            Promise.resolve(args.distinct ? [{ usuarioCreadorId: 3 }] : [borrador(151)]));

        await h.reaper.limpiarBorradores();

        const consulta = h.prisma.remesa.findMany.mock.calls.find((c: any[]) => !c[0].distinct)![0];
        expect(consulta.where.OR).toEqual([{ usuarioCreadorId: null }, { usuarioCreadorId: { notIn: [3] } }]);
        const ocupados = h.prisma.remesa.findMany.mock.calls.find((c: any[]) => c[0].distinct)![0];
        expect(ocupados.where).toEqual({ usuarioCreadorId: { not: null }, progreso: { is: { encoladaAt: { not: null }, finishedAt: null } } });
    });

    it('RB-8b: y si el creador empezó una carga entre el listado y el lock, la relectura bajo FOR UPDATE lo saltea', async () => {
        const h = armarBorradores({ fila: { estadoProceso: 'PENDIENTE', fase: 'BORRADOR', encoladaAt: null, enCursoDelCreador: 1 } as any });
        expect(await h.reaper.limpiarBorradores()).toEqual([]);
        expect(h.operaciones).toEqual(['lock']);
        // Con 0 (o sin el campo, fixtures viejas) se borra como siempre.
        const g = armarBorradores({ fila: { estadoProceso: 'PENDIENTE', fase: 'BORRADOR', encoladaAt: null, enCursoDelCreador: 0 } as any });
        expect(await g.reaper.limpiarBorradores()).toEqual([151]);
    });

    it('RB-2: un borrador de 25 h: se borran importerror, jobimport y la remesa, en ese orden y dentro de SU transacción', async () => {
        const h = armarBorradores();
        const r = await h.reaper.limpiarBorradores();
        expect(r).toEqual([151]);
        expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(h.transacciones[0]).toEqual(['lock', 'deudor', 'importerror', 'jobimport', 'remesa:151']);
        expect(h.log.mock.calls.some(([m]) => /1 eliminados de más de 24 h \(remesas: 00151\)/.test(String(m)))).toBe(true);
    });

    it('RB-3: entre el listado y el lock alguien la confirmó: no se borra', async () => {
        const h = armarBorradores({ fila: { estadoProceso: 'PENDIENTE', fase: 'EN_COLA', encoladaAt: new Date() } });
        expect(await h.reaper.limpiarBorradores()).toEqual([]);
        expect(h.operaciones).toEqual(['lock']);

        const g = armarBorradores({ fila: { estadoProceso: 'PROCESANDO', fase: 'BORRADOR', encoladaAt: null } });
        expect(await g.reaper.limpiarBorradores()).toEqual([]);
        const k = armarBorradores({ fila: null });
        expect(await k.reaper.limpiarBorradores()).toEqual([]);
    });

    it('RB-4: entre el listado y el lock apareció un deudor: no se borra', async () => {
        const h = armarBorradores({ deudor: true });
        expect(await h.reaper.limpiarBorradores()).toEqual([]);
        expect(h.operaciones).toEqual(['lock', 'deudor']);
    });

    it('RB-5: el borrado de una falla: warn con el id y las demás se borran igual', async () => {
        const h = armarBorradores({ candidatas: [borrador(151), borrador(152), borrador(153)], deleteFalla: (id) => id === 152 });
        const r = await h.reaper.limpiarBorradores();
        expect(r).toEqual([151, 153]);
        const avisos = h.warn.mock.calls.map(([m]) => String(m)).filter((m) => m.includes('152'));
        expect(avisos).toHaveLength(1);
    });

    it('RB-6: el TTL: sin definir, "abc", 0 y 9999 dan 24, 24, 1 y 720', () => {
        expect(borradorTtlHoras(undefined)).toBe(24);
        expect(borradorTtlHoras('abc')).toBe(24);
        expect(borradorTtlHoras('0')).toBe(1);
        expect(borradorTtlHoras('9999')).toBe(720);
    });

    it('RB-6b: el TTL de la variable de entorno corta la antigüedad', async () => {
        process.env.IMPORTS_BORRADOR_TTL_HORAS = '48';
        const h = armarBorradores({ candidatas: [] });
        await h.reaper.limpiarBorradores();
        expect(h.prisma.remesa.findMany.mock.calls.find((c: any[]) => !c[0].distinct)![0].where.createdAt).toEqual({ lt: new Date(T0 - 48 * 60 * MIN) });
    });

    it('RB-7: hay 600 candidatas: procesa 500 y avisa que quedó cola', async () => {
        const muchas = Array.from({ length: 600 }, (_, i) => borrador(i + 1));
        const h = armarBorradores({ candidatas: muchas });
        const r = await h.reaper.limpiarBorradores();
        expect(r).toHaveLength(MAX_BORRADORES_POR_CORRIDA);
        expect(h.prisma.$transaction).toHaveBeenCalledTimes(500);
        expect(h.warn.mock.calls.some(([m]) => String(m).includes('tope de 500'))).toBe(true);
    });

    it('no borra nada más que importerror, jobimport y la remesa (nunca deudores, facturas ni archivos)', async () => {
        const h = armarBorradores();
        await h.reaper.limpiarBorradores();
        expect(h.operaciones.filter((o) => o !== 'lock' && o !== 'deudor')).toEqual(['importerror', 'jobimport', 'remesa:151']);
    });
});

describe('arranque', () => {
    it('loguea el estado del reaper con los valores vigentes', () => {
        const h = armar();
        h.reaper.onModuleInit();
        expect(h.log.mock.calls.map(([m]) => String(m))).toContain(
            'Reaper de importaciones activo: sin latido a los 5 min, borradores a las 24 h',
        );
        process.env.IMPORTS_REAPER_DESACTIVADO = 'true';
        h.reaper.onModuleInit();
        expect(h.warn.mock.calls.some(([m]) => String(m).includes('desactivado por IMPORTS_REAPER_DESACTIVADO'))).toBe(true);
    });
});
