/**
 * El reloj del `ProgresoTracker` (docs/imports-progreso-realtime-spec.md §9.5.2 y §9.9.2 B, casos R-1 a R-18).
 *
 * Timers falsos de jest. Un spec con timers falsos y promesas pendientes puede quedar "verde por
 * casualidad": por eso cada caso afirma las llamadas a la base y los eventos, no solo el estado final.
 */
import { Logger } from '@nestjs/common';
import {
    CargaCerradaPorFueraError,
    CargaInfo,
    intervaloProgresoMs,
    ProgresoTracker,
} from './progreso-tracker';

const INFO: CargaInfo = {
    remesaId: 1, numeroRemesa: '00001', nombre: 'Carga', empresaId: 10, tipo: 'DEUDORES',
    usuarioId: 3, usuarioNombre: 'Maxi', totalFilasVistaPrevia: 5000,
};

interface Opciones {
    intervaloMs?: number;
    /** Cuánto tarda cada `remesa.update`. Se puede cambiar en pleno test. */
    latenciaMs?: number;
}

function armar(opts: Opciones = {}) {
    const estado = {
        latenciaMs: opts.latenciaMs ?? 0,
        /** Hace rechazar a la escritura que toca `remesa` (iniciar, lote, entrarEn…, finalizar, fallar). */
        fallar: null as null | ((args: any) => Error | null),
        /** Hace rechazar a la escritura del reloj (solo `import_progreso`). */
        fallarClock: null as null | (() => Error | null),
        enVuelo: 0,
        maxEnVuelo: 0,
        latidoCount: 1,
        /** La sentencia condicionada del reloj no afecta ninguna fila (otro cerró la carga). */
        clockCount0: false,
        /** Lo que dice la lectura de confirmación tras un count 0: la fila cerrada, viva, o vacía. */
        confirmacion: 'CERRADA' as 'CERRADA' | 'VIVA' | null,
        /** Lo que ve el `SELECT … FOR UPDATE` que precede a las escrituras que tocan `remesa`. */
        fila: { estadoProceso: 'PROCESANDO', progresoId: 1 as number | null, encoladaAt: new Date() as Date | null, finishedAt: null as Date | null },
    };
    let rev = 0;
    const eventos: Array<{ evento: string; estado: any }> = [];
    /** Todo lo que llegó a la base, en orden: por la vía de `remesa` o por la del reloj. */
    const escrituras: Array<{ via: 'remesa' | 'clock'; data: any; args: any }> = [];
    const enEscritura = async (fn: () => any) => {
        estado.enVuelo++;
        estado.maxEnVuelo = Math.max(estado.maxEnVuelo, estado.enVuelo);
        try {
            if (estado.latenciaMs > 0) await new Promise((r) => setTimeout(r, estado.latenciaMs));
            return fn();
        } finally {
            estado.enVuelo--;
        }
    };
    const tx: any = {
        $queryRaw: jest.fn().mockImplementation(() => Promise.resolve([{ ...estado.fila }])),
        remesa: {
            update: jest.fn().mockImplementation((args: any) => enEscritura(() => {
                const e = estado.fallar?.(args);
                if (e) throw e;
                rev++;
                escrituras.push({ via: 'remesa', data: args.data.progreso.upsert.update, args });
                return { progreso: { rev } };
            })),
        },
        import_progreso: {
            updateMany: jest.fn().mockImplementation((args: any) => enEscritura(() => {
                const e = estado.fallarClock?.();
                if (e) throw e;
                if (estado.clockCount0) return { count: 0 };
                rev++;
                escrituras.push({ via: 'clock', data: args.data, args });
                return { count: 1 };
            })),
            findUnique: jest.fn().mockImplementation(() => Promise.resolve({ rev })),
        },
    };
    const prisma: any = {
        $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
        import_progreso: {
            // El latido: una sentencia suelta, fuera de la transacción.
            updateMany: jest.fn().mockImplementation(async () => {
                rev++;
                return { count: estado.latidoCount };
            }),
            findUnique: jest.fn().mockImplementation(async () =>
                estado.confirmacion === null ? null : { finishedAt: estado.confirmacion === 'CERRADA' ? new Date() : null, remesa: { estadoProceso: 'PROCESANDO' } }),
        },
    };
    const emitir = (nombre: string) => jest.fn().mockImplementation((e: any) => eventos.push({ evento: nombre, estado: e }));
    const realtime: any = {
        emitImportIniciada: emitir('iniciada'),
        emitImportProgreso: emitir('progreso'),
        emitImportFinalizada: emitir('finalizada'),
    };
    const logger = new Logger('test');
    const warn = jest.spyOn(logger, 'warn').mockImplementation();
    const log = jest.spyOn(logger, 'log').mockImplementation();
    jest.spyOn(logger, 'error').mockImplementation();
    const tracker = new ProgresoTracker({ prisma, realtime, logger, intervaloMs: opts.intervaloMs }, INFO, null);
    return {
        tracker, prisma, tx, realtime, eventos, warn, log, estado, escrituras,
        remesaUpdate: tx.remesa.update as jest.Mock,
        clockUpdate: tx.import_progreso.updateMany as jest.Mock,
        latido: prisma.import_progreso.updateMany as jest.Mock,
    };
}

type H = ReturnType<typeof armar>;
/** Lo que llegó a la base en la escritura `i` (en orden), sea por la vía de `remesa` o por la del reloj. */
const intentos = (h: H) => h.remesaUpdate.mock.calls.length + h.clockUpdate.mock.calls.length;
const camposDe = (h: H, i: number) => h.escrituras[i].data;
/** El `data` de la escritura `i` si fue por la vía de `remesa` (okFilas, errFilas, estadoProceso…). */
const dataDe = (h: H, i: number) => h.escrituras[i].args.data;
const progresos = (h: H) => h.eventos.filter((e) => e.evento === 'progreso');
const avanzar = (ms: number) => jest.advanceTimersByTimeAsync(ms);
const CERO = { ok: 0, err: 0, descartadas: 0 };

beforeEach(() => {
    // `nextTick` y `setImmediate` quedan reales: R-10 necesita que el runtime de Node detecte de verdad
    // una promesa rechazada sin manejar.
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
});

afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
});

describe('ProgresoTracker — reloj', () => {
    it('R-1: sin ningún reporte, 60 s dan 4 latidos, ningún evento y ninguna escritura sobre remesa', async () => {
        const h = armar();
        await h.tracker.iniciar('j');
        const eventosAntes = h.eventos.length;
        await avanzar(60_000);
        expect(h.prisma.import_progreso.updateMany).toHaveBeenCalledTimes(4);
        expect(h.escrituras.map((e) => e.via)).toEqual(['remesa']); // solo la de `iniciar`; el latido no toca remesa
        expect(h.eventos.length).toBe(eventosAntes);
        const c = h.prisma.import_progreso.updateMany.mock.calls[0][0];
        expect(c.where).toEqual({ remesaId: 1, finishedAt: null });
        expect(c.data).toMatchObject({ rev: { increment: 1 } });
        expect(c.data.heartbeatAt).toBeInstanceOf(Date);
        h.tracker.cerrar();
    });

    it('R-2: 500 llamadas a avance en un mismo tic: cero escrituras hasta el tic, y en el tic una sola con lo último', async () => {
        const h = armar();
        await h.tracker.iniciar('j');
        for (let i = 1; i <= 500; i++) h.tracker.avance({ ok: i, err: 0, descartadas: 0 });
        expect(intentos(h)).toBe(1);
        expect(progresos(h)).toHaveLength(0);
        await avanzar(1000);
        expect(intentos(h)).toBe(2);
        expect(progresos(h)).toHaveLength(1);
        expect(progresos(h)[0].estado).toMatchObject({ ok: 500, procesadas: 500 });
        expect(camposDe(h, 1)).toMatchObject({ ok: 500, procesadas: 500 });
        // La escritura del reloj va SOLO a import_progreso: no toca `remesa` (okFilas / errFilas se escriben al cerrar el lote).
        expect(h.escrituras.map((e) => e.via)).toEqual(['remesa', 'clock']);
        expect(h.escrituras[1].args.where).toEqual({ remesaId: 1, finishedAt: null });
        expect(h.escrituras[1].data).not.toHaveProperty('estadoProceso');
        h.tracker.cerrar();
    });

    it('R-3: avance continuo durante 10 s: a lo sumo 10 escrituras, rev creciente y el porcentaje no baja', async () => {
        const h = armar();
        await h.tracker.iniciar('j');
        for (let s = 1; s <= 10; s++) {
            h.tracker.avance({ ok: s * 100, err: 0, descartadas: 0 });
            await avanzar(1000);
        }
        const p = progresos(h);
        expect(p.length).toBeGreaterThan(0);
        expect(p.length).toBeLessThanOrEqual(10);
        expect(intentos(h)).toBe(1 + p.length);
        for (let i = 1; i < p.length; i++) {
            expect(p[i].estado.rev).toBeGreaterThan(p[i - 1].estado.rev);
            expect(p[i].estado.progreso).toBeGreaterThanOrEqual(p[i - 1].estado.progreso);
        }
        h.tracker.cerrar();
    });

    it('R-4: el intervalo se configura (250 ms → hasta 4 por segundo) y fuera de las cotas cae a la cota', async () => {
        expect(intervaloProgresoMs(undefined)).toBe(1000);
        expect(intervaloProgresoMs('abc')).toBe(1000);
        expect(intervaloProgresoMs(0)).toBe(250);
        expect(intervaloProgresoMs(50)).toBe(250);
        expect(intervaloProgresoMs(999_999)).toBe(10_000);

        const h = armar({ intervaloMs: 250 });
        await h.tracker.iniciar('j');
        for (let i = 1; i <= 4; i++) {
            h.tracker.avance({ ok: i, err: 0, descartadas: 0 });
            await avanzar(250);
        }
        expect(progresos(h)).toHaveLength(4);
        h.tracker.cerrar();

        // Un valor menor a la cota se comporta como la cota: con 50 ms no hay más de 4 por segundo.
        const g = armar({ intervaloMs: 50 });
        await g.tracker.iniciar('j');
        for (let i = 1; i <= 20; i++) {
            g.tracker.avance({ ok: i, err: 0, descartadas: 0 });
            await avanzar(50);
        }
        expect(progresos(g).length).toBeLessThanOrEqual(4);
        g.tracker.cerrar();
    });

    it('R-5: una escritura que tarda 3 s no se solapa con otra: nunca hay dos en vuelo', async () => {
        const h = armar();
        await h.tracker.iniciar('j');
        h.estado.latenciaMs = 3000;
        h.tracker.avance({ ok: 1, err: 0, descartadas: 0 });
        await avanzar(1000); // empieza la escritura
        expect(intentos(h)).toBe(2);
        for (let i = 2; i <= 3; i++) {
            h.tracker.avance({ ok: i, err: 0, descartadas: 0 });
            await avanzar(1000);
        }
        expect(intentos(h)).toBe(2); // los tics de esos 3 s no lanzaron otra
        await avanzar(1000); // termina la primera
        h.estado.latenciaMs = 0;
        await avanzar(1000); // ahora sí, la siguiente, con lo que se acumuló
        expect(intentos(h)).toBe(3);
        expect(camposDe(h, 2)).toMatchObject({ ok: 3 });
        expect(h.estado.maxEnVuelo).toBe(1);
        h.tracker.cerrar();
    });

    it('R-6: lote con una escritura del reloj en vuelo espera a que termine; al final la memoria tiene los contadores de lote', async () => {
        const h = armar();
        await h.tracker.iniciar('j');
        h.estado.latenciaMs = 3000;
        h.tracker.avance({ ok: 10, err: 0, descartadas: 0 });
        await avanzar(1000); // escritura del reloj en vuelo (tarda 3 s)
        h.estado.latenciaMs = 0;
        expect(intentos(h)).toBe(2);

        let terminado = false;
        const p = h.tracker.lote({ ok: 50, err: 0, descartadas: 0 }).then(() => { terminado = true; });
        await avanzar(1000);
        expect(intentos(h)).toBe(2); // sigue esperando
        expect(terminado).toBe(false);

        await avanzar(2000); // termina la del reloj y corre la de `lote`
        await p;
        expect(intentos(h)).toBe(3);
        expect(dataDe(h, 2)).toMatchObject({ okFilas: 50, errFilas: 0 });
        expect(h.estado.maxEnVuelo).toBe(1);
        expect(h.tracker.estado).toMatchObject({ ok: 50, procesadas: 50 });
        // El evento del reloj lleva la foto que persistió (ok: 10) y el de `lote` la suya (ok: 50).
        expect(progresos(h).map((e) => e.estado.ok)).toEqual([10, 50]);
        h.tracker.cerrar();
    });

    it('R-7: un reporte que llega DURANTE la escritura del reloj no se pierde ni se pisa con la foto vieja', async () => {
        const h = armar();
        await h.tracker.iniciar('j');
        h.estado.latenciaMs = 3000;
        h.tracker.avance({ ok: 10, err: 0, descartadas: 0 });
        await avanzar(1000); // en vuelo con ok: 10
        h.tracker.contadores({ nuevos: 7 });
        h.tracker.avance({ ok: 20, err: 0, descartadas: 0 });
        await avanzar(3000); // termina la escritura de ok: 10
        // La memoria sigue con lo último: no retrocedió a 10.
        expect(h.tracker.estado).toMatchObject({ ok: 20, nuevos: 7 });
        // Y lo emitido es la foto persistida, con el rev que devolvió la base.
        expect(progresos(h)[0].estado).toMatchObject({ ok: 10, nuevos: null });
        h.estado.latenciaMs = 0;
        await avanzar(1000);
        expect(camposDe(h, 2)).toMatchObject({ ok: 20, nuevos: 7 });
        expect(progresos(h)[1].estado).toMatchObject({ ok: 20, nuevos: 7 });
        expect(progresos(h)[1].estado.rev).toBeGreaterThan(progresos(h)[0].estado.rev);
        h.tracker.cerrar();
    });

    it('R-8: finalizar con un tic pendiente: el último evento es finalizada y después no hay ni una escritura ni un evento', async () => {
        const h = armar();
        await h.tracker.iniciar('j');
        h.tracker.avance({ ok: 40, err: 0, descartadas: 0 }); // pendiente: el tic todavía no corrió
        await h.tracker.finalizar({ ok: 40, err: 0, descartadas: 0, errorPostProceso: null });
        expect(h.eventos[h.eventos.length - 1].evento).toBe('finalizada');
        const antes = intentos(h);
        const latidos = h.prisma.import_progreso.updateMany.mock.calls.length;
        const eventos = h.eventos.length;
        await avanzar(60_000);
        expect(intentos(h)).toBe(antes);
        expect(h.prisma.import_progreso.updateMany).toHaveBeenCalledTimes(latidos);
        expect(h.eventos).toHaveLength(eventos);
        expect(h.tracker.estado.subfase).toBeNull();
    });

    it('R-8b: finalizar con la escritura del reloj en vuelo la espera, y el evento final sigue siendo el último', async () => {
        const h = armar();
        await h.tracker.iniciar('j');
        h.estado.latenciaMs = 2000;
        h.tracker.avance({ ok: 5, err: 0, descartadas: 0 });
        await avanzar(1000); // en vuelo
        h.estado.latenciaMs = 0;
        const p = h.tracker.finalizar({ ok: 5, err: 0, descartadas: 0, errorPostProceso: null });
        await avanzar(2000);
        await p;
        expect(h.eventos.map((e) => e.evento)).toEqual(['iniciada', 'progreso', 'finalizada']);
        expect(h.estado.maxEnVuelo).toBe(1);
        await avanzar(30_000);
        expect(h.eventos).toHaveLength(3);
    });

    it('R-9: fallar y cerrar detienen el reloj; cerrar dos veces no tira', async () => {
        const a = armar();
        await a.tracker.iniciar('j');
        await a.tracker.fallar(new Error('x'), CERO);
        const n = intentos(a);
        await avanzar(60_000);
        expect(intentos(a)).toBe(n);
        expect(a.prisma.import_progreso.updateMany).not.toHaveBeenCalled();

        const b = armar();
        await b.tracker.iniciar('j');
        b.tracker.cerrar();
        expect(() => b.tracker.cerrar()).not.toThrow();
        b.tracker.avance({ ok: 3, err: 0, descartadas: 0 });
        await avanzar(60_000);
        expect(intentos(b)).toBe(1);
        expect(b.prisma.import_progreso.updateMany).not.toHaveBeenCalled();
    });

    it('R-10: la escritura del reloj rechaza diez veces seguidas: ninguna promesa sin manejar, sucio sigue prendido, un solo warn, y al volver la base escribe', async () => {
        // Dos redes: el listener propio y el de jest, que ante una promesa rechazada sin manejar durante
        // un `await` del test lo hace fallar con el error original (se comprobó sacando el `catch` del tic).
        const sinManejar: unknown[] = [];
        const escucha = (r: unknown) => { sinManejar.push(r); };
        process.on('unhandledRejection', escucha);
        try {
            const h = armar();
            await h.tracker.iniciar('j');
            h.estado.fallarClock = () => new Error('base caída');
            h.tracker.avance({ ok: 9, err: 0, descartadas: 0 });
            await avanzar(10_000);
            await new Promise((r) => setImmediate(r));
            expect(intentos(h)).toBe(1 + 10); // reintentó en cada tic
            expect(progresos(h)).toHaveLength(0);
            const avisos = h.warn.mock.calls.filter((c) => String(c[0]).includes('Falló la escritura del progreso'));
            expect(avisos).toHaveLength(1);
            // La base vuelve: el pendiente se escribe con lo último.
            h.estado.fallarClock = null;
            await avanzar(1000);
            expect(progresos(h)).toHaveLength(1);
            expect(progresos(h)[0].estado).toMatchObject({ ok: 9 });
            await new Promise((r) => setImmediate(r));
            expect(sinManejar).toEqual([]);
            h.tracker.cerrar();
        } finally {
            process.off('unhandledRejection', escucha);
        }
    });

    it('R-11: la escritura del reloj no afecta ninguna fila → cerradaPorFuera, el reloj se detiene y el próximo lote tira', async () => {
        const h = armar();
        await h.tracker.iniciar('j');
        h.estado.clockCount0 = true; // la sentencia condicionada (finishedAt IS NULL) no afecta ninguna fila
        h.tracker.avance({ ok: 1, err: 0, descartadas: 0 });
        await avanzar(1000);
        expect(h.tracker.cerradaPorFuera).toBe(true);
        expect(h.realtime.emitImportProgreso).not.toHaveBeenCalled(); // no se emite lo que no se escribió
        const n = intentos(h);
        await avanzar(60_000);
        expect(intentos(h)).toBe(n);
        expect(h.prisma.import_progreso.updateMany).not.toHaveBeenCalled();
        await expect(h.tracker.lote({ ok: 2, err: 0, descartadas: 0 })).rejects.toBeInstanceOf(CargaCerradaPorFueraError);
        expect(intentos(h)).toBe(n);
    });

    it('R-11b: el latido devuelve count 0 → cerradaPorFuera y el reloj se detiene', async () => {
        const h = armar();
        await h.tracker.iniciar('j');
        h.estado.latidoCount = 0;
        await avanzar(15_000);
        expect(h.tracker.cerradaPorFuera).toBe(true);
        await avanzar(60_000);
        expect(h.prisma.import_progreso.updateMany).toHaveBeenCalledTimes(1);
        await expect(h.tracker.lote({ ok: 1, err: 0, descartadas: 0 })).rejects.toBeInstanceOf(CargaCerradaPorFueraError);
    });

    it('R-11e: count 0 con la fila VIVA (confirmación) no es "cerrada por fuera": un warn y se reintenta en el tic siguiente', async () => {
        const h = armar();
        await h.tracker.iniciar('j');
        h.estado.clockCount0 = true;
        h.estado.confirmacion = 'VIVA';
        h.tracker.avance({ ok: 1, err: 0, descartadas: 0 });
        await avanzar(3000);
        expect(h.tracker.cerradaPorFuera).toBe(false);
        expect(h.warn.mock.calls.filter((c) => String(c[0]).includes('no se pudo confirmar'))).toHaveLength(1); // a lo sumo uno por minuto
        expect(h.clockUpdate.mock.calls.length).toBeGreaterThanOrEqual(3); // reintenta en cada tic
        h.estado.clockCount0 = false;
        await avanzar(1000);
        expect(progresos(h)).toHaveLength(1);
        h.tracker.cerrar();
    });

    it('R-11f: count 0 y la confirmación vacía dos tics seguidos → cerrada por fuera (solo al segundo)', async () => {
        const h = armar();
        await h.tracker.iniciar('j');
        h.estado.clockCount0 = true;
        h.estado.confirmacion = null;
        h.tracker.avance({ ok: 1, err: 0, descartadas: 0 });
        await avanzar(1000);
        expect(h.tracker.cerradaPorFuera).toBe(false);
        await avanzar(1000);
        expect(h.tracker.cerradaPorFuera).toBe(true);
    });

    it('R-11c: iniciar que no encuentra la fila tira CargaCerradaPorFueraError y no arranca el reloj', async () => {
        const h = armar();
        h.estado.fallar = () => Object.assign(new Error('Record not found'), { code: 'P2025' });
        await expect(h.tracker.iniciar('j')).rejects.toBeInstanceOf(CargaCerradaPorFueraError);
        expect(h.eventos).toHaveLength(0);
        await avanzar(60_000);
        expect(h.prisma.import_progreso.updateMany).not.toHaveBeenCalled();
    });

    it('R-11d: fallar sobre una carga cerrada por fuera no tira, no marca "no se pudo registrar" y no emite', async () => {
        const h = armar();
        await h.tracker.iniciar('j');
        h.estado.fallar = () => Object.assign(new Error('Record not found'), { code: 'P2025' });
        const estado = await h.tracker.fallar(new Error('x'), CERO);
        expect(estado.resultado).toBe('FALLIDA');
        expect(h.tracker.noSePudoRegistrar).toBe(false);
        expect(h.tracker.cerradaPorFuera).toBe(true);
        expect(h.realtime.emitImportFinalizada).not.toHaveBeenCalled();
    });

    it('R-12: subfase arma el texto con punto de miles; sin total, solo el nombre; un nombre de 300 caracteres se recorta a 160', async () => {
        const h = armar();
        await h.tracker.iniciar('j');
        await h.tracker.entrarEnPostProceso();
        h.tracker.subfase('Consolidando casos', 1500, 8875);
        await avanzar(1000);
        expect(camposDe(h, 2).subfase).toBe('Consolidando casos: 1.500 de 8.875');
        expect(progresos(h)[progresos(h).length - 1].estado.subfase).toBe('Consolidando casos: 1.500 de 8.875');

        h.tracker.subfase('Cerrando promesas cumplidas');
        await avanzar(1000);
        expect(camposDe(h, 3).subfase).toBe('Cerrando promesas cumplidas');

        h.tracker.subfase('Cerrando promesas cumplidas', 5, 0);
        h.tracker.subfase('x'.repeat(300));
        await avanzar(1000);
        expect(camposDe(h, 4).subfase).toHaveLength(160);
        h.tracker.cerrar();
    });

    it('R-13: al cambiar el nombre de la subfase se loguea el paso que terminó con su tiempo', async () => {
        const h = armar();
        await h.tracker.iniciar('j');
        h.tracker.subfase('Paso A', 1, 10);
        await avanzar(2500);
        h.tracker.subfase('Paso A', 5, 10); // mismo nombre: no loguea
        expect(h.log.mock.calls.filter((c) => String(c[0]).includes('Post-proceso remesa=1'))).toHaveLength(0);
        h.tracker.subfase('Paso B');
        const l = h.log.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('Post-proceso remesa=1'));
        expect(l).toHaveLength(1);
        expect(l[0]).toMatch(/«Paso A» en 2500ms/);
        h.tracker.cerrarSubfase();
        expect(h.log.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('«Paso B»'))).toHaveLength(1);
        h.tracker.cerrar();
    });

    it('R-14: avanceDelLote(300) con ok: 1000 da procesadas 1300; después de lote({ ok: 2000 }), 2000', async () => {
        const h = armar();
        await h.tracker.iniciar('j');
        h.tracker.avance({ ok: 1000, err: 0, descartadas: 0 });
        h.tracker.avanceDelLote(300);
        expect(h.tracker.estado.procesadas).toBe(1300);
        await avanzar(1000);
        expect(camposDe(h, 1)).toMatchObject({ procesadas: 1300, ok: 1000 });
        await h.tracker.lote({ ok: 2000, err: 0, descartadas: 0 });
        expect(camposDe(h, 2)).toMatchObject({ procesadas: 2000, ok: 2000 });
        expect(h.tracker.estado.procesadas).toBe(2000);
        h.tracker.cerrar();
    });

    it('R-14b: avanceDelLote se acota a lo que falta del total y nunca es negativo', async () => {
        const h = armar();
        await h.tracker.iniciar('j');
        h.tracker.avance({ ok: 4900, err: 0, descartadas: 0 });
        h.tracker.avanceDelLote(5000);
        expect(h.tracker.estado.procesadas).toBe(5000);
        h.tracker.avanceDelLote(-10);
        expect(h.tracker.estado.procesadas).toBe(4900);
        h.tracker.avanceDelLote(Number.NaN);
        expect(h.tracker.estado.procesadas).toBe(4900);
        h.tracker.cerrar();
    });

    it('R-15: entrarEnLectura persiste y emite LEYENDO; con el primer avance la memoria pasa a PROCESANDO', async () => {
        const h = armar();
        await h.tracker.iniciar('j');
        await h.tracker.entrarEnLectura();
        expect(camposDe(h, 1).fase).toBe('LEYENDO');
        expect(progresos(h)[0].estado.fase).toBe('LEYENDO');
        h.tracker.avance({ ok: 1, err: 0, descartadas: 0 });
        expect(h.tracker.estado.fase).toBe('PROCESANDO');
        await avanzar(1000);
        expect(camposDe(h, 2).fase).toBe('PROCESANDO');
        expect(h.log.mock.calls.map((c) => String(c[0])).some((m) => /^Lectura remesa=1 terminó en \d+ms$/.test(m))).toBe(true);
        h.tracker.cerrar();
    });

    it('R-15b: entrarEnLectura nunca tira: si la base falla es un warn', async () => {
        const h = armar();
        await h.tracker.iniciar('j');
        h.estado.fallar = () => new Error('base caída');
        await expect(h.tracker.entrarEnLectura()).resolves.toBeUndefined();
        expect(h.warn).toHaveBeenCalled();
        h.tracker.cerrar();
    });

    it('R-16: un tic que llega 7 s tarde deja un warn "Event loop bloqueado" con la remesa y la fase', async () => {
        const h = armar();
        await h.tracker.iniciar('j');
        await h.tracker.entrarEnLectura();
        jest.setSystemTime(Date.now() + 7000); // el event loop estuvo bloqueado: el tic llega con 7 s de deriva
        await avanzar(1000);
        const avisos = h.warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('Event loop bloqueado'));
        expect(avisos).toHaveLength(1);
        expect(avisos[0]).toMatch(/~7000 ms durante la remesa 1 \(LEYENDO\)/);
        // Una deriva chica no avisa.
        await avanzar(3000);
        expect(h.warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('Event loop bloqueado'))).toHaveLength(1);
        h.tracker.cerrar();
    });

    it('R-17: nuevos, actualizados y fueraDeCorte viajan en la escritura siguiente; sin informar quedan en null, no en 0', async () => {
        const h = armar();
        await h.tracker.iniciar('j');
        expect(camposDe(h, 0)).toMatchObject({ nuevos: null, actualizados: null, fueraDeCorte: null, subfase: null });
        h.tracker.contadores({ nuevos: 5 });
        h.tracker.avance({ ok: 3, err: 0, descartadas: 7, fueraDeCorte: 4 });
        await avanzar(1000);
        expect(camposDe(h, 1)).toMatchObject({ nuevos: 5, actualizados: null, fueraDeCorte: 4, descartadas: 7 });
        expect(progresos(h)[0].estado).toMatchObject({ nuevos: 5, actualizados: null, fueraDeCorte: 4, descartadasPorFiltro: 3 });
        h.tracker.contadores({ actualizados: 2 });
        h.tracker.avance({ ok: 3, err: 0, descartadas: 7, fueraDeCorte: 4 });
        await avanzar(1000);
        expect(camposDe(h, 2)).toMatchObject({ nuevos: 5, actualizados: 2 });
        h.tracker.cerrar();
    });

    it('R-17b: lo que informa el processor a mitad de una fila entra a la foto con el avance siguiente, no antes (nuevos nunca supera a ok)', async () => {
        const h = armar();
        await h.tracker.iniciar('j');
        h.tracker.avance({ ok: 6, err: 0, descartadas: 0 });
        // El processor crea el caso 7 y lo informa; el runner suma `ok` recién al terminar la fila.
        h.tracker.contadores({ nuevos: 7 });
        await avanzar(1000);
        expect(camposDe(h, 1)).toMatchObject({ ok: 6, nuevos: null });
        expect(h.tracker.estado.nuevos).toBeNull();
        h.tracker.avance({ ok: 7, err: 0, descartadas: 0 });
        await avanzar(1000);
        expect(camposDe(h, 2)).toMatchObject({ ok: 7, nuevos: 7 });
        for (const e of h.escrituras) if (e.data.nuevos != null) expect(e.data.nuevos).toBeLessThanOrEqual(e.data.ok);
        // Y `lote` también los incorpora.
        h.tracker.contadores({ nuevos: 9, actualizados: 2 });
        await h.tracker.lote({ ok: 9, err: 0, descartadas: 0 });
        expect(dataDe(h, 3).progreso.upsert.update).toMatchObject({ ok: 9, nuevos: 9, actualizados: 2 });
        h.tracker.cerrar();
    });

    it('R-18: cada escritura que toca remesa va precedida del SELECT … FOR UPDATE (remesa y después import_progreso); la del reloj lleva finishedAt: null', async () => {
        const h = armar();
        await h.tracker.iniciar('j');
        await h.tracker.entrarEnLectura();
        h.tracker.avance({ ok: 1, err: 0, descartadas: 0 });
        await avanzar(1000);
        await h.tracker.lote({ ok: 2, err: 0, descartadas: 0 });
        await h.tracker.entrarEnPostProceso();
        await h.tracker.finalizar({ ok: 2, err: 0, descartadas: 0, errorPostProceso: null });

        expect(h.escrituras.map((e) => e.via)).toEqual(['remesa', 'remesa', 'clock', 'remesa', 'remesa', 'remesa']);
        // Las cinco que tocan remesa: un lock por cada una, antes de escribir.
        expect(h.tx.$queryRaw).toHaveBeenCalledTimes(5);
        h.tx.$queryRaw.mock.calls.forEach((c: any[], i: number) => {
            const sql = (c[0] as TemplateStringsArray).join('?');
            expect(sql).toContain('FROM remesa r LEFT JOIN import_progreso p ON p.remesaId = r.id');
            expect(sql).toContain('FOR UPDATE');
            expect(h.tx.$queryRaw.mock.invocationCallOrder[i]).toBeLessThan(h.remesaUpdate.mock.invocationCallOrder[i]);
            expect(c[1]).toBe(1);
        });
        // El `where` de la escritura ya no pretende ser la condición: la condición es el lock.
        h.remesaUpdate.mock.calls.forEach((c: any[]) => expect(c[0].where).toEqual({ id: 1 }));
        // La del reloj: sentencia condicionada y chequeo de filas afectadas, sin tocar remesa.
        expect(h.clockUpdate.mock.calls[0][0].where).toEqual({ remesaId: 1, finishedAt: null });
    });

    it('R-18b: fallar también espera su lock antes de escribir', async () => {
        const h = armar();
        await h.tracker.iniciar('j');
        await h.tracker.fallar(new Error('x'), CERO);
        expect(h.tx.$queryRaw).toHaveBeenCalledTimes(2);
        expect(h.tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(h.remesaUpdate.mock.invocationCallOrder[1]);
        expect(dataDe(h, 1)).toMatchObject({ estadoProceso: 'FALLIDA' });
    });

    it('R-19: TODAS las transacciones del tracker (incluida la del reloj) llevan maxWait 10 s y timeout 60 s, no los 2 s / 5 s de Prisma', async () => {
        const h = armar();
        await h.tracker.iniciar('j');
        await h.tracker.entrarEnLectura();
        h.tracker.avance({ ok: 1, err: 0, descartadas: 0 });
        await avanzar(1000); // la del reloj
        await h.tracker.lote({ ok: 2, err: 0, descartadas: 0 });
        await h.tracker.entrarEnPostProceso();
        await h.tracker.finalizar({ ok: 2, err: 0, descartadas: 0, errorPostProceso: null });
        const g = armar();
        await g.tracker.iniciar('j');
        await g.tracker.fallar(new Error('x'), CERO);
        expect(h.prisma.$transaction.mock.calls.length).toBe(6);
        for (const x of [h, g]) for (const c of x.prisma.$transaction.mock.calls) expect(c[1]).toEqual({ maxWait: 10_000, timeout: 60_000 });
    });

    it('sinAvanceMs mide desde el último reporte que cambió algo, no desde el último que se llamó', async () => {
        const h = armar();
        await h.tracker.iniciar('j');
        h.tracker.avance({ ok: 5, err: 0, descartadas: 0 });
        await avanzar(3000);
        h.tracker.avance({ ok: 5, err: 0, descartadas: 0 }); // mismo valor: no cambió nada
        expect(h.tracker.sinAvanceMs).toBe(3000);
        h.tracker.avance({ ok: 6, err: 0, descartadas: 0 });
        expect(h.tracker.sinAvanceMs).toBe(0);
        h.tracker.cerrar();
    });

    it('el terminal lleva subfase null aunque haya habido pasos del post-proceso', async () => {
        const h = armar();
        await h.tracker.iniciar('j');
        await h.tracker.entrarEnPostProceso();
        h.tracker.subfase('Consolidando casos', 10, 100);
        const e = await h.tracker.finalizar({ ok: 1, err: 0, descartadas: 0, errorPostProceso: null });
        expect(e.subfase).toBeNull();
        expect(camposDe(h, h.escrituras.length - 1).subfase).toBeNull();
    });
});
