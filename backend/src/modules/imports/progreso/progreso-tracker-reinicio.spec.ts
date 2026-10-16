/**
 * El corte por cierre ordenado en el `ProgresoTracker` (docs/imports-progreso-c3-spec.md §19.4.2, §19.10.1).
 * Mismo doble de Prisma que `progreso-tracker-cancelacion.spec.ts` (copiado: no se toca el otro spec).
 */
import { Logger } from '@nestjs/common';
import { ProgresoTracker } from './progreso-tracker';

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

describe('avisarCortePorCierre', () => {
    it('prende cancelacionPedida y cortePorCierre sin escribir ni tocar cancelacionDeUsuario', async () => {
        const { base, tracker } = await conCargaIniciada();
        const escrituras = base.escrituras.length;
        const rev = base.fila.rev;
        expect(tracker.cancelacionPedida).toBe(false);

        tracker.avisarCortePorCierre();
        tracker.avisarCortePorCierre(); // idempotente

        expect(tracker.cancelacionPedida).toBe(true);
        expect(tracker.cortePorCierre).toBe(true);
        expect(tracker.cancelacionDeUsuario).toBe(false);
        expect(base.escrituras).toHaveLength(escrituras);
        expect(base.fila.rev).toBe(rev);
        expect(base.fila.cancelSolicitadaAt).toBeNull();
        tracker.cerrar();
    });

    it('avisarCancelacion (el usuario) prende cancelacionDeUsuario y no cortePorCierre', async () => {
        const { tracker } = await conCargaIniciada();
        tracker.avisarCancelacion();
        expect(tracker.cancelacionDeUsuario).toBe(true);
        expect(tracker.cortePorCierre).toBe(false);
        tracker.cerrar();
    });

    it('un pedido de usuario que lee la compuerta prende cancelacionDeUsuario aunque ya hubiera corte por cierre', async () => {
        const { base, tracker } = await conCargaIniciada();
        tracker.avisarCortePorCierre();
        await base.pedirCancelacion('Ana');
        tracker.avance({ ok: 3, err: 0, descartadas: 0 });
        await jest.advanceTimersByTimeAsync(1_100);
        await asentar();
        // El reloj (o la compuerta del próximo lote) lee el pedido de Ana.
        await tracker.lote({ ok: 3, err: 0, descartadas: 0 }).catch(() => undefined);
        expect(tracker.cancelacionDeUsuario).toBe(true);
        expect(tracker.cortePorCierre).toBe(true);
        tracker.cerrar();
    });
});

describe('cerrarPorReinicio', () => {
    it('escribe FALLIDA, mezcla la marca sin pisar origen ni cancelacion y emite finalizada con interrumpidaPorReinicio', async () => {
        const { base, tracker, eventos } = await conCargaIniciada();
        tracker.avance({ ok: 30, err: 2, descartadas: 5 });
        tracker.avisarCortePorCierre();
        const texto = 'La importación se interrumpió por un reinicio del servidor cuando llevaba 32 de 100 filas.';

        const estado = await tracker.cerrarPorReinicio({ ok: 30, err: 2, descartadas: 5 }, { texto, sinFilasEntregadas: false });

        expect(base.remesa).toMatchObject({ estadoProceso: 'FALLIDA', okFilas: 30, errFilas: 2 });
        expect(base.fila).toMatchObject({ fase: 'TERMINADA', resultado: 'FALLIDA', ok: 30, err: 2, procesadas: 32, cancelSolicitadaAt: null });
        expect(base.fila.error).toBe(texto);
        expect(base.fila.finishedAt).not.toBeNull();
        expect(base.fila.resumen).toEqual({
            v: 1,
            origen: { remesaOrigenId: null, remesaOrigenIds: null },
            interrupcion: { motivo: 'REINICIO' },
        });
        expect(estado).toMatchObject({ interrumpidaPorReinicio: true, cancelada: false, resultado: 'FALLIDA', terminal: true, retomable: false });
        const fin = eventos.filter((e) => e.evento === 'finalizada');
        expect(fin).toHaveLength(1);
        expect(fin[0].estado).toMatchObject({ interrumpidaPorReinicio: true, resultado: 'FALLIDA', ok: 30, err: 2 });
        // El reloj quedó detenido.
        const escrituras = base.escrituras.length;
        await jest.advanceTimersByTimeAsync(60_000);
        await asentar();
        expect(base.escrituras).toHaveLength(escrituras);
        tracker.cerrar();
    });

    it('con sinFilasEntregadas la carga queda retomable y conserva una cancelación previa del resumen', async () => {
        const { base, tracker } = await conCargaIniciada({ fila: { resumen: { ...ORIGEN, cancelacion: { usuarioId: 9, nombre: 'Ana' } } } });
        tracker.avisarCortePorCierre();

        const estado = await tracker.cerrarPorReinicio(CERO, { texto: 'interrumpida', sinFilasEntregadas: true });

        expect(base.fila.resumen).toEqual({
            ...ORIGEN,
            cancelacion: { usuarioId: 9, nombre: 'Ana' },
            interrupcion: { motivo: 'REINICIO' },
            sinFilasEntregadas: true,
        });
        expect(estado).toMatchObject({ interrumpidaPorReinicio: true, retomable: true });
        tracker.cerrar();
    });

    it('sobre una carga que otro ya cerró: no pisa nada, no emite y avisa cerradaPorFuera', async () => {
        const { base, tracker, eventos } = await conCargaIniciada();
        base.cerrarPorFuera();
        tracker.avisarCortePorCierre();

        await tracker.cerrarPorReinicio(CERO, { texto: 'x', sinFilasEntregadas: false });

        expect(tracker.cerradaPorFuera).toBe(true);
        expect(base.fila.resultado).toBe('FALLIDA');
        expect(base.fila.resumen.interrupcion).toBeUndefined();
        expect(eventos.filter((e) => e.evento === 'finalizada')).toHaveLength(0);
        tracker.cerrar();
    });
});
