/**
 * El pedido de cancelación en el `ProgresoTracker` (docs/imports-progreso-realtime-spec.md §10.5.3 y §10.9.2 B).
 *
 * El doble se porta como MySQL + Prisma en lo que el diseño apoya:
 *   - un `updateMany` o `update` condicionado que no encuentra la fila NO tira: afecta 0 filas;
 *   - el `SELECT … FOR UPDATE` devuelve la fila ACTUAL (no una fija), y el lock se mantiene hasta que
 *     termina la transacción: las transacciones se SERIALIZAN, con cesiones al event loop adentro para que
 *     una implementación sin lock se note;
 *   - hay lecturas que devuelven vacío sin error sobre una fila que existe (TK-7), y nada se decide con eso.
 */
import { Logger } from '@nestjs/common';
import { CargaCanceladaError, CargaCerradaPorFueraError, ProgresoTracker } from './progreso-tracker';

const INFO = {
    remesaId: 1, numeroRemesa: '00001', nombre: 'Carga', empresaId: 10, tipo: 'DEUDORES',
    usuarioId: 3, usuarioNombre: 'Maxi', totalFilasVistaPrevia: 100,
};
const CERO = { ok: 0, err: 0, descartadas: 0 };
const ORIGEN = { v: 1, origen: { remesaOrigenId: null, remesaOrigenIds: null } };
const cede = () => new Promise<void>((r) => setImmediate(r));
/** Deja correr las escrituras del doble, que ceden al event loop con setImmediate (real, no falso). */
const asentar = async () => {
    for (let i = 0; i < 12; i++) await cede();
};

interface Fila {
    rev: number; fase: string; resultado: string | null; error: string | null; finishedAt: Date | null; encoladaAt: Date | null;
    startedAt: Date | null; ok: number; err: number; heartbeatAt: Date | null; intentos: number; jobId: string | null;
    cancelSolicitadaAt: Date | null; resumen: any; grupoId: string | null; grupoOrden: number | null; grupoTotal: number | null;
    [k: string]: unknown;
}

interface OpcionesBase {
    fila?: Partial<Fila>;
    /** El `SELECT … FOR UPDATE` no trae las columnas nuevas (los dobles de los specs viejos). */
    sinColumnasNuevas?: boolean;
    /** El resumen sale como texto JSON (así puede llegar de un `$queryRaw`). */
    resumenComoTexto?: boolean;
}

function baseReal(opts: OpcionesBase = {}) {
    const remesa = { estadoProceso: 'PROCESANDO', okFilas: 0, errFilas: 0 };
    const fila: Fila = {
        rev: 1, fase: 'EN_COLA', resultado: null, error: null, finishedAt: null, encoladaAt: new Date(), startedAt: null,
        ok: 0, err: 0, heartbeatAt: null, intentos: 0, jobId: null, cancelSolicitadaAt: null, resumen: ORIGEN,
        grupoId: null, grupoOrden: null, grupoTotal: null, ...opts.fila,
    };
    const escrituras: Array<{ via: 'remesa' | 'clock' | 'latido'; data: any }> = [];
    const espurio = { queryRaw: 0, findUnique: 0 };
    let cola: Promise<unknown> = Promise.resolve();
    /** Una transacción por vez (el lock de la fila), de punta a punta. */
    const serializar = <T>(fn: () => Promise<T>): Promise<T> => {
        const r = cola.then(fn, fn);
        cola = r.then(() => undefined, () => undefined);
        return r;
    };
    const aplicar = (campos: any) => {
        for (const [k, v] of Object.entries(campos)) {
            if (v && typeof v === 'object' && !(v instanceof Date) && 'increment' in (v as any)) (fila as any)[k] += (v as any).increment;
            else (fila as any)[k] = v;
        }
    };
    const tx: any = {
        $queryRaw: jest.fn().mockImplementation(async () => {
            await cede();
            if (espurio.queryRaw > 0) {
                espurio.queryRaw--;
                return [];
            }
            const f: any = { estadoProceso: remesa.estadoProceso, progresoId: 1, encoladaAt: fila.encoladaAt, finishedAt: fila.finishedAt };
            if (!opts.sinColumnasNuevas) {
                f.cancelSolicitadaAt = fila.cancelSolicitadaAt;
                f.resumen = opts.resumenComoTexto && fila.resumen != null ? JSON.stringify(fila.resumen) : fila.resumen;
            }
            return [f];
        }),
        remesa: {
            update: jest.fn().mockImplementation(async ({ data }: any) => {
                await cede();
                const { progreso, ...resto } = data;
                Object.assign(remesa, resto);
                escrituras.push({ via: 'remesa', data: progreso.upsert.update });
                aplicar(progreso.upsert.update);
                return { progreso: { rev: fila.rev } };
            }),
        },
        import_progreso: {
            updateMany: jest.fn().mockImplementation(async ({ where, data }: any) => {
                await cede();
                if (where.finishedAt === null && fila.finishedAt !== null) return { count: 0 };
                escrituras.push({ via: 'clock', data });
                aplicar(data);
                return { count: 1 };
            }),
            findUnique: jest.fn().mockImplementation(async ({ select }: any = {}) => {
                await cede();
                if (espurio.findUnique > 0) {
                    espurio.findUnique--;
                    return null;
                }
                return { rev: fila.rev, cancelSolicitadaAt: fila.cancelSolicitadaAt, resumen: fila.resumen };
            }),
        },
    };
    const prisma: any = {
        $transaction: jest.fn().mockImplementation((fn: any) => serializar(() => fn(tx))),
        import_progreso: {
            updateMany: jest.fn().mockImplementation(async () => {
                escrituras.push({ via: 'latido', data: {} });
                fila.rev++;
                return { count: 1 };
            }),
            findUnique: jest.fn().mockImplementation(async () => ({ finishedAt: fila.finishedAt, remesa: { estadoProceso: remesa.estadoProceso } })),
        },
    };
    /** Lo que hace `cancelarCarga` sobre una carga que ya arrancó: escribir el pedido con la fila bloqueada. */
    const pedirCancelacion = (nombre = 'Ana') =>
        serializar(async () => {
            await cede();
            if (fila.finishedAt) return '409-terminal';
            if (fila.fase === 'POST_PROCESO') return '409-post';
            if (fila.cancelSolicitadaAt) return 'PEDIDA';
            fila.cancelSolicitadaAt = new Date();
            fila.resumen = { ...(fila.resumen ?? {}), cancelacion: { usuarioId: 9, nombre } };
            fila.rev++;
            return 'PEDIDA';
        });
    return {
        prisma, tx, espurio, remesa, fila, escrituras, pedirCancelacion,
        foto: () => JSON.parse(JSON.stringify({ remesa, fila })),
        cerrarPorFuera: () => {
            remesa.estadoProceso = 'FALLIDA';
            Object.assign(fila, { fase: 'TERMINADA', resultado: 'FALLIDA', finishedAt: new Date(), rev: fila.rev + 1 });
        },
    };
}

function armar(base: ReturnType<typeof baseReal>, previa: any = null) {
    const eventos: Array<{ evento: string; estado: any }> = [];
    const emitir = (n: string) => jest.fn().mockImplementation((e: any) => eventos.push({ evento: n, estado: e }));
    const realtime: any = {
        emitImportIniciada: emitir('iniciada'),
        emitImportProgreso: emitir('progreso'),
        emitImportFinalizada: emitir('finalizada'),
    };
    const logger = new Logger('test');
    const warn = jest.spyOn(logger, 'warn').mockImplementation();
    jest.spyOn(logger, 'log').mockImplementation();
    const error = jest.spyOn(logger, 'error').mockImplementation();
    const tracker = new ProgresoTracker({ prisma: base.prisma, realtime, logger }, INFO, previa);
    return { tracker, eventos, realtime, warn, error };
}

beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
});
afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
});

/** Un tracker ya iniciado. */
async function conCargaIniciada(opts: OpcionesBase = {}, previa: any = null) {
    const base = baseReal(opts);
    const h = armar(base, previa);
    await h.tracker.iniciar('j1');
    return { base, ...h };
}

describe('el tracker lee el pedido de cancelación', () => {
    it('TK-1: la compuerta de lote lo lee, el lote se persiste igual y no tira', async () => {
        const { base, tracker } = await conCargaIniciada();
        expect(tracker.cancelacionPedida).toBe(false);
        await base.pedirCancelacion('Ana');
        const antes = base.fila.ok;

        await expect(tracker.lote({ ok: 40, err: 2, descartadas: 0 })).resolves.toBeUndefined();

        expect(base.fila.ok).toBe(40);
        expect(base.fila.ok).toBeGreaterThan(antes);
        expect(tracker.cancelacionPedida).toBe(true);
        expect(tracker.canceladaPor).toBe('Ana');
        expect(tracker.estado.cancelacionPedidaAt).not.toBeNull();
        tracker.cerrar();
    });

    it('TK-2: la compuerta de iniciar lo lee: no escribe nada, tira CargaCanceladaError y el reloj no arranca', async () => {
        const base = baseReal({ fila: { cancelSolicitadaAt: new Date() } });
        const { tracker, eventos } = armar(base);
        const antes = base.foto();

        await expect(tracker.iniciar('j')).rejects.toBeInstanceOf(CargaCanceladaError);

        expect(base.foto()).toEqual(antes);
        expect(base.fila.startedAt).toBeNull();
        expect(base.tx.remesa.update).not.toHaveBeenCalled();
        expect(eventos).toEqual([]);
        // El reloj no arrancó: ni a los 60 s hay una escritura.
        await jest.advanceTimersByTimeAsync(60_000);
        expect(base.escrituras).toEqual([]);
        expect(tracker.cerradaPorFuera).toBe(false);
        tracker.cerrar();
    });

    it('TK-3: la compuerta de entrarEnPostProceso lo lee: no escribe la fase y tira CargaCanceladaError', async () => {
        const { base, tracker } = await conCargaIniciada();
        await tracker.lote({ ok: 100, err: 0, descartadas: 0 });
        await base.pedirCancelacion();
        const antes = base.foto();

        await expect(tracker.entrarEnPostProceso()).rejects.toBeInstanceOf(CargaCanceladaError);

        expect(base.fila.fase).toBe('PROCESANDO');
        expect(base.foto().fila.fase).toBe(antes.fila.fase);
        expect(base.foto().fila.rev).toBe(antes.fila.rev);
        // La memoria vuelve a la fase que era: un endpoint que mira la memoria no ve un post-proceso que no empezó.
        expect(tracker.faseActual.fase).toBe('PROCESANDO');
        tracker.cerrar();
    });

    it('TK-4: la compuerta de finalizar lo lee: escribe FINALIZADA normal, el pedido queda y el DTO no es cancelada', async () => {
        const { base, tracker, eventos } = await conCargaIniciada();
        await base.pedirCancelacion('Ana');

        const estado = await tracker.finalizar({ ok: 100, err: 0, descartadas: 0, errorPostProceso: null });

        expect(base.remesa.estadoProceso).toBe('FINALIZADA');
        expect(base.fila.resultado).toBe('OK');
        expect(base.fila.cancelSolicitadaAt).not.toBeNull();
        expect(estado.cancelada).toBe(false);
        expect(estado.resultado).toBe('OK');
        expect(estado.cancelacionPedidaAt).not.toBeNull();
        expect(eventos.filter((e) => e.evento === 'finalizada')).toHaveLength(1);
        expect(eventos[eventos.length - 1].estado.cancelacionPedidaAt).not.toBeNull();
    });

    it('TK-5: la escritura del reloj lo lee, con las mismas sentencias de siempre', async () => {
        const { base, tracker } = await conCargaIniciada();
        tracker.avance({ ok: 10, err: 0, descartadas: 0 });
        await base.pedirCancelacion('Ana');
        base.tx.import_progreso.updateMany.mockClear();
        base.tx.import_progreso.findUnique.mockClear();

        await jest.advanceTimersByTimeAsync(1_100);
        await asentar();

        expect(tracker.cancelacionPedida).toBe(true);
        expect(tracker.canceladaPor).toBe('Ana');
        // Una escritura del reloj = un updateMany + un findUnique: el pedido viaja en ese findUnique, no hay sentencia nueva.
        expect(base.tx.import_progreso.updateMany).toHaveBeenCalledTimes(1);
        expect(base.tx.import_progreso.findUnique).toHaveBeenCalledTimes(1);
        expect(base.tx.import_progreso.findUnique.mock.calls[0][0].select).toMatchObject({ rev: true, cancelSolicitadaAt: true });
        expect(base.tx.$queryRaw).toHaveBeenCalledTimes(1); // el de iniciar; el reloj no usa el SELECT FOR UPDATE
        tracker.cerrar();
    });

    it('TK-6: avisarCancelacion() deja la bandera sin escribir nada, y es idempotente', async () => {
        const { base, tracker } = await conCargaIniciada();
        const escrituras = base.escrituras.length;
        expect(tracker.cancelacionPedidaHaceMs).toBeNull();

        tracker.avisarCancelacion();
        tracker.avisarCancelacion();

        expect(tracker.cancelacionPedida).toBe(true);
        expect(base.escrituras).toHaveLength(escrituras);
        expect(base.tx.remesa.update).toHaveBeenCalledTimes(1); // solo la de iniciar
        await jest.advanceTimersByTimeAsync(0);
        jest.setSystemTime(Date.now() + 5_000);
        expect(tracker.cancelacionPedidaHaceMs).toBeGreaterThanOrEqual(0);
        tracker.cerrar();
    });

    it('TK-7: una lectura vacía sin error, en la compuerta y en el reloj, no prende la cancelación', async () => {
        const { base, tracker } = await conCargaIniciada();
        // Compuerta: el SELECT FOR UPDATE devuelve vacío UNA vez sobre una fila que existe → reintento, no cancelación.
        base.espurio.queryRaw = 1;
        await tracker.lote({ ok: 5, err: 0, descartadas: 0 });
        expect(tracker.cancelacionPedida).toBe(false);
        // Reloj: el findUnique de después del updateMany devuelve null.
        tracker.avance({ ok: 6, err: 0, descartadas: 0 });
        base.espurio.findUnique = 1;
        await jest.advanceTimersByTimeAsync(1_100);
        await asentar();
        expect(base.tx.import_progreso.findUnique).toHaveBeenCalled();
        expect(tracker.cancelacionPedida).toBe(false);
        expect(tracker.estado.cancelacionPedidaAt).toBeNull();
        tracker.cerrar();
    });

    it('TK-8: cancelar escribe la remesa FALLIDA, la fila CANCELADA, emite una sola finalizada y detiene el reloj', async () => {
        const { base, tracker, eventos } = await conCargaIniciada();
        tracker.avance({ ok: 30, err: 2, descartadas: 5 });
        await base.pedirCancelacion('Ana');

        const estado = await tracker.cancelar(
            { ok: 30, err: 2, descartadas: 5 },
            { texto: 'La importación fue cancelada por Ana cuando llevaba 32 de 100 filas.', sinFilasEntregadas: false },
        );

        expect(base.remesa).toMatchObject({ estadoProceso: 'FALLIDA', okFilas: 30, errFilas: 2 });
        expect(base.fila).toMatchObject({
            fase: 'TERMINADA', resultado: 'CANCELADA', ok: 30, err: 2, procesadas: 32,
        });
        expect(base.fila.error).toBe('La importación fue cancelada por Ana cuando llevaba 32 de 100 filas.');
        expect(base.fila.finishedAt).not.toBeNull();
        expect(estado).toMatchObject({ cancelada: true, resultado: 'FALLIDA', estadoProceso: 'FALLIDA', terminal: true, ok: 30, err: 2, procesadas: 32 });
        const fin = eventos.filter((e) => e.evento === 'finalizada');
        expect(fin).toHaveLength(1);
        expect(fin[0].estado).toMatchObject({ cancelada: true, resultado: 'FALLIDA', canceladaPor: 'Ana' });
        // El reloj quedó detenido: 60 s después no hay una sola escritura más.
        const escrituras = base.escrituras.length;
        await jest.advanceTimersByTimeAsync(60_000);
        await asentar();
        expect(base.escrituras).toHaveLength(escrituras);
        tracker.cerrar();
    });

    it('TK-9: cancelar con sinFilasEntregadas cuando el endpoint ya escribió resumen.cancelacion no pisa nada', async () => {
        const { base, tracker } = await conCargaIniciada();
        await base.pedirCancelacion('Ana');

        const estado = await tracker.cancelar(CERO, { texto: 'cancelada', sinFilasEntregadas: true });

        expect(base.fila.resumen).toEqual({
            v: 1,
            origen: { remesaOrigenId: null, remesaOrigenIds: null },
            cancelacion: { usuarioId: 9, nombre: 'Ana' },
            sinFilasEntregadas: true,
        });
        // Arrancó (tiene startedAt) pero el runner vivo marcó que no entregó ninguna fila: es retomable.
        expect(estado.retomable).toBe(true);
        expect(estado.canceladaPor).toBe('Ana');
    });

    it('TK-9c: sin el marcador cancelar no toca la clave resumen y la carga que arrancó no es retomable', async () => {
        const { base, tracker } = await conCargaIniciada();
        await tracker.lote({ ok: 10, err: 0, descartadas: 0 });
        const estado = await tracker.cancelar({ ok: 10, err: 0, descartadas: 0 }, { texto: 'x', sinFilasEntregadas: false });
        expect(base.remesa.estadoProceso).toBe('FALLIDA');
        expect(base.fila.resumen).toEqual(ORIGEN);
        expect(estado.retomable).toBe(false);
    });

    it('TK-10: cancelar sobre una carga que otro ya cerró no escribe, no emite y no tira', async () => {
        const { base, tracker, eventos } = await conCargaIniciada();
        base.cerrarPorFuera();
        const terminal = base.foto();
        const finalizadas = () => eventos.filter((e) => e.evento === 'finalizada').length;

        const estado = await tracker.cancelar(CERO, { texto: 'x', sinFilasEntregadas: false });

        expect(base.foto()).toEqual(terminal);
        expect(finalizadas()).toBe(0);
        expect(tracker.cerradaPorFuera).toBe(true);
        expect(estado.cancelada).toBe(true); // lo que habría sido; nada se persistió
    });

    it('TK-11: fallar sin tercer argumento, o con sinFilasEntregadas false, no lleva la clave resumen', async () => {
        for (const args of [[], [{ sinFilasEntregadas: false }], [{}]] as any[][]) {
            const { base, tracker } = await conCargaIniciada();
            await (tracker.fallar as any)(new Error('boom'), CERO, ...args);
            const escritura = base.escrituras[base.escrituras.length - 1];
            expect('resumen' in escritura.data).toBe(false);
            expect(base.fila.resumen).toEqual(ORIGEN);
            expect(base.fila.resultado).toBe('FALLIDA');
        }
    });

    it('TK-12: fallar con sinFilasEntregadas true mezcla el resumen de la fila y el DTO emitido es retomable', async () => {
        const { base, tracker, eventos } = await conCargaIniciada({ fila: { resumen: { ...ORIGEN, retomas: 2 } } });

        const estado = await tracker.fallar(new Error('La plantilla no tiene estado inicial'), CERO, { sinFilasEntregadas: true });

        expect(base.fila.resumen).toEqual({ ...ORIGEN, retomas: 2, sinFilasEntregadas: true });
        expect(estado.retomable).toBe(true);
        expect(eventos.filter((e) => e.evento === 'finalizada')[0].estado.retomable).toBe(true);
        expect(estado.cancelada).toBe(false);
    });

    it('TK-12b: el resumen que viene como texto JSON se mezcla igual', async () => {
        const { base, tracker } = await conCargaIniciada({ resumenComoTexto: true });
        const estado = await tracker.fallar(new Error('x'), CERO, { sinFilasEntregadas: true });
        expect(base.fila.resumen).toEqual({ ...ORIGEN, sinFilasEntregadas: true });
        expect(estado.retomable).toBe(true);
    });

    it('TK-13: con grupoId, grupoOrden y grupoTotal en la fila previa, todos los eventos los traen', async () => {
        const grupo = { grupoId: 'g-1', grupoOrden: 2, grupoTotal: 3 };
        const base = baseReal({ fila: grupo });
        const { tracker, eventos } = armar(base, { ...base.fila });
        await tracker.iniciar('j');
        tracker.avance({ ok: 5, err: 0, descartadas: 0 });
        await tracker.lote({ ok: 5, err: 0, descartadas: 0 });
        await tracker.entrarEnPostProceso();
        await tracker.finalizar({ ok: 5, err: 0, descartadas: 0, errorPostProceso: null });

        expect(eventos.map((e) => e.evento)).toEqual(['iniciada', 'progreso', 'progreso', 'finalizada']);
        for (const e of eventos) expect(e.estado).toMatchObject(grupo);
    });

    it('TK-13b: y el resumen y el pedido que leyó la compuerta salen en los eventos (HTTP y socket no se contradicen)', async () => {
        const base = baseReal();
        const { tracker, eventos } = armar(base, { ...base.fila });
        await tracker.iniciar('j');
        await base.pedirCancelacion('Ana');
        await tracker.lote({ ok: 5, err: 0, descartadas: 0 });
        const ultimo = eventos[eventos.length - 1].estado;
        expect(ultimo.cancelacionPedidaAt).not.toBeNull();
        expect(ultimo.canceladaPor).toBe('Ana');
        expect(ultimo.cancelable).toBe(false); // ya está pedida
        tracker.cerrar();
    });

    it('TK-14: el SELECT de la compuerta devuelve una fila sin las columnas nuevas: se comporta como hoy', async () => {
        const base = baseReal({ sinColumnasNuevas: true });
        const { tracker, eventos } = armar(base);

        await tracker.iniciar('j');
        await tracker.lote({ ok: 3, err: 0, descartadas: 0 });
        await tracker.entrarEnPostProceso();
        const estado = await tracker.finalizar({ ok: 3, err: 0, descartadas: 0, errorPostProceso: null });

        expect(tracker.cancelacionPedida).toBe(false);
        expect(estado.resultado).toBe('OK');
        expect(eventos.map((e) => e.evento)).toEqual(['iniciada', 'progreso', 'progreso', 'finalizada']);
    });
});

describe('el pedido y la escritura se serializan por el lock de la fila (la garantía de "el cierre no corre")', () => {
    it('150 rondas de pedido contra entrarEnPostProceso: o el pedido llega y el cierre no entra, o entra y el pedido recibe 409', async () => {
        const cuenta: Record<string, number> = {};
        for (let i = 0; i < 150; i++) {
            const { base, tracker } = await conCargaIniciada();
            // Cada ronda arranca el pedido y la entrada en órdenes distintos.
            const pedir = () => base.pedirCancelacion();
            const entrar = () => tracker.entrarEnPostProceso().then(() => 'ENTRO', (e) => (e instanceof CargaCanceladaError ? 'ABORTO' : `ERR ${e}`));
            let p: string;
            let e: string;
            if (i % 2 === 0) [p, e] = await Promise.all([pedir(), entrar()]);
            else [e, p] = await Promise.all([entrar(), pedir()]);
            const clave = `${p}/${e}`;
            cuenta[clave] = (cuenta[clave] ?? 0) + 1;
            const valida =
                (p === 'PEDIDA' && e === 'ABORTO' && base.fila.fase === 'PROCESANDO') ||
                (p === '409-post' && e === 'ENTRO' && base.fila.fase === 'POST_PROCESO');
            expect({ clave, fase: base.fila.fase, valida }).toMatchObject({ valida: true });
            tracker.cerrar();
        }
        // Las dos vías se ejercitaron.
        expect(Object.keys(cuenta).sort()).toEqual(['409-post/ENTRO', 'PEDIDA/ABORTO']);
    });

    it('el pedido contra iniciar: o no arranca (sin startedAt) o arranca y el pedido queda registrado, nunca los dos a medias', async () => {
        const cuenta: Record<string, number> = {};
        for (let i = 0; i < 100; i++) {
            const base = baseReal();
            const { tracker } = armar(base);
            const iniciar = () => tracker.iniciar('j').then(() => 'ARRANCO', (e) => (e instanceof CargaCanceladaError ? 'NO-ARRANCA' : `ERR ${e}`));
            const pedir = () => base.pedirCancelacion();
            let x: string;
            let p: string;
            if (i % 2 === 0) [x, p] = await Promise.all([iniciar(), pedir()]);
            else [p, x] = await Promise.all([pedir(), iniciar()]);
            const clave = `${p}/${x}`;
            cuenta[clave] = (cuenta[clave] ?? 0) + 1;
            expect(p).toBe('PEDIDA');
            expect(base.fila.cancelSolicitadaAt).not.toBeNull();
            expect(x === 'NO-ARRANCA' ? base.fila.startedAt === null : base.fila.startedAt !== null).toBe(true);
            tracker.cerrar();
        }
        expect(Object.keys(cuenta).sort()).toEqual(['PEDIDA/ARRANCO', 'PEDIDA/NO-ARRANCA']);
    });
});
