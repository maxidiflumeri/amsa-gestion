/**
 * Un estado terminal puesto por otro NUNCA se pisa (docs/imports-progreso-realtime-spec.md §9.3 regla 2,
 * hallazgo 1 de la auditoría de la Fase B).
 *
 * El doble de este archivo se porta como la base REAL, no como los dobles de los otros specs: un
 * `remesa.update` cuya condición no se cumple **afecta 0 filas sin tirar `P2025`** y el `UPDATE` de la fila de
 * progreso anidada corre igual (Prisma hace un `SELECT` y después un `UPDATE … WHERE id IN`). Los dobles que
 * tiran `P2025` hacían parecer correcta una escritura que en MySQL pisaba el terminal. Acá, si el tracker
 * llegara a escribir sobre una carga cerrada, el estado terminal queda pisado y el test lo ve.
 * Lo único que impide escribir es el `SELECT … FOR UPDATE` que precede a cada escritura que toca `remesa`, y la
 * sentencia condicionada (`finishedAt IS NULL`) con chequeo de filas afectadas en la del reloj.
 */
import { Logger } from '@nestjs/common';
import { CargaCerradaPorFueraError, ProgresoTracker } from './progreso-tracker';

const INFO = {
    remesaId: 1, numeroRemesa: '00001', nombre: 'Carga', empresaId: 10, tipo: 'DEUDORES',
    usuarioId: 3, usuarioNombre: 'Maxi', totalFilasVistaPrevia: 100,
};
const CERO = { ok: 0, err: 0, descartadas: 0 };

interface Fila { rev: number; fase: string; resultado: string | null; error: string | null; finishedAt: Date | null; encoladaAt: Date | null; ok: number; heartbeatAt: Date | null }

function baseReal(opts: { sinFila?: boolean; borrador?: boolean } = {}) {
    const remesa = { estadoProceso: 'PENDIENTE', okFilas: 0 };
    let fila: Fila | null = opts.sinFila
        ? null
        : { rev: 1, fase: opts.borrador ? 'BORRADOR' : 'EN_COLA', resultado: null, error: null, finishedAt: null, encoladaAt: opts.borrador ? null : new Date(), ok: 0, heartbeatAt: null };
    let escrituras = 0;
    /** Resultados vacíos espurios (los que deja una transacción vencida en el pool): cuántos quedan de cada tipo. */
    const espurio = { updateMany: 0, findUnique: 0, queryRaw: 0 };
    const aplicarProgreso = (campos: any) => {
        for (const [k, v] of Object.entries(campos)) {
            if (v && typeof v === 'object' && !(v instanceof Date) && 'increment' in (v as any)) (fila as any)[k] += (v as any).increment;
            else (fila as any)[k] = v;
        }
    };
    const tx: any = {
        $queryRaw: jest.fn().mockImplementation(() =>
            Promise.resolve(espurio.queryRaw-- > 0 ? [] : remesa ? [{ estadoProceso: remesa.estadoProceso, progresoId: fila ? 1 : null, encoladaAt: fila?.encoladaAt ?? null, finishedAt: fila?.finishedAt ?? null }] : []),
        ),
        remesa: {
            // Como MySQL + Prisma: ignora la condición del estado si no está en el `where` y NUNCA tira P2025 por ella.
            update: jest.fn().mockImplementation(async ({ data }: any) => {
                escrituras++;
                const { progreso, ...resto } = data;
                Object.assign(remesa, resto);
                if (progreso?.upsert) {
                    if (!fila) fila = { ...(progreso.upsert.create as any), rev: 1 };
                    else aplicarProgreso(progreso.upsert.update);
                }
                return { progreso: { rev: fila!.rev } };
            }),
        },
        import_progreso: {
            // Una sola sentencia: la condición y la escritura son atómicas, y devuelve cuántas filas afectó.
            updateMany: jest.fn().mockImplementation(async ({ where, data }: any) => {
                if (espurio.updateMany-- > 0) return { count: 0 };
                if (!fila || (where.finishedAt === null && fila.finishedAt !== null)) return { count: 0 };
                escrituras++;
                aplicarProgreso(data);
                return { count: 1 };
            }),
            findUnique: jest.fn().mockImplementation(async () => ({ rev: fila!.rev })),
        },
    };
    const prisma: any = {
        $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
        import_progreso: {
            updateMany: tx.import_progreso.updateMany,
            // La lectura de confirmación del reloj y del latido.
            findUnique: jest.fn().mockImplementation(async () =>
                espurio.findUnique-- > 0 || !fila ? null : { finishedAt: fila.finishedAt, remesa: { estadoProceso: remesa.estadoProceso } }),
        },
    };
    return {
        prisma, tx, espurio,
        /** Otra instancia (el reaper, "cancelar") cierra la carga. */
        cerrarPorFuera: () => {
            remesa.estadoProceso = 'FALLIDA';
            if (fila) Object.assign(fila, { fase: 'TERMINADA', resultado: 'FALLIDA', error: 'La importación se interrumpió', finishedAt: new Date(), rev: fila.rev + 1 });
        },
        foto: () => JSON.parse(JSON.stringify({ remesa, fila })),
        escrituras: () => escrituras,
        fila: () => fila,
        remesa,
    };
}

function armar(base: ReturnType<typeof baseReal>) {
    const eventos: string[] = [];
    const realtime: any = {
        emitImportIniciada: jest.fn(() => eventos.push('iniciada')),
        emitImportProgreso: jest.fn(() => eventos.push('progreso')),
        emitImportFinalizada: jest.fn(() => eventos.push('finalizada')),
    };
    const logger = new Logger('test');
    const warn = jest.spyOn(logger, 'warn').mockImplementation();
    jest.spyOn(logger, 'log').mockImplementation();
    const error = jest.spyOn(logger, 'error').mockImplementation();
    const tracker = new ProgresoTracker({ prisma: base.prisma, realtime, logger }, INFO, null);
    return { tracker, eventos, realtime, warn, error };
}

afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
});

describe('el estado terminal de otro nunca se pisa (la base no tira P2025 por la condición)', () => {
    // El modelo es fiel: sin la protección, cada una de estas escrituras pisa el terminal. Lo prueba el control.
    it('control: el doble se porta como la base real — un remesa.update sin protección SÍ pisaría el terminal', async () => {
        const base = baseReal();
        const { tracker } = armar(base);
        await tracker.iniciar('j');
        base.cerrarPorFuera();
        const terminal = base.foto();
        // La escritura "ingenua" de la Fase B anterior: update condicionado + upsert anidado.
        await base.tx.remesa.update({
            where: { id: 1, estadoProceso: { notIn: ['FINALIZADA', 'FALLIDA'] } },
            data: { estadoProceso: 'FINALIZADA', progreso: { upsert: { update: { fase: 'TERMINADA', resultado: 'OK', finishedAt: new Date() } } } },
        });
        expect(base.foto()).not.toEqual(terminal);
        expect(base.remesa.estadoProceso).toBe('FINALIZADA'); // remesa y fila terminaron en OK sobre una carga FALLIDA
        tracker.cerrar();
    });

    it('iniciar sobre una carga ya terminal no escribe', async () => {
        const base = baseReal();
        base.cerrarPorFuera();
        const terminal = base.foto();
        const { tracker, eventos } = armar(base);

        await expect(tracker.iniciar('j')).rejects.toBeInstanceOf(CargaCerradaPorFueraError);

        expect(base.foto()).toEqual(terminal);
        expect(base.tx.remesa.update).not.toHaveBeenCalled();
        expect(eventos).toEqual([]);
        expect(tracker.cerradaPorFuera).toBe(true);
    });

    it('iniciar sobre un borrador (fila sin encoladaAt: volvió a borrador) no escribe', async () => {
        const base = baseReal({ borrador: true });
        base.remesa.estadoProceso = 'VALIDANDO';
        const antes = base.foto();
        const { tracker, eventos } = armar(base);

        await expect(tracker.iniciar('j')).rejects.toBeInstanceOf(CargaCerradaPorFueraError);

        expect(base.foto()).toEqual(antes);
        expect(eventos).toEqual([]);
    });

    it('iniciar sobre una remesa terminal SIN fila de progreso no escribe (la mitad del estado de la compuerta, sola)', async () => {
        for (const estado of ['FINALIZADA', 'FALLIDA']) {
            const base = baseReal({ sinFila: true });
            base.remesa.estadoProceso = estado;
            const { tracker, eventos } = armar(base);
            await expect(tracker.iniciar('j')).rejects.toBeInstanceOf(CargaCerradaPorFueraError);
            expect(base.remesa.estadoProceso).toBe(estado);
            expect(base.fila()).toBeNull(); // el upsert anidado no creó una fila sobre una carga terminada
            expect(base.tx.remesa.update).not.toHaveBeenCalled();
            expect(eventos).toEqual([]);
        }
    });

    it('una remesa NO terminal cuya fila ya está terminada (finishedAt) no se escribe (la otra mitad, sola)', async () => {
        const base = baseReal();
        const { tracker, eventos } = armar(base);
        await tracker.iniciar('j');
        // Solo la fila: la remesa sigue PROCESANDO.
        base.fila()!.finishedAt = new Date();
        base.fila()!.fase = 'TERMINADA';
        base.fila()!.resultado = 'FALLIDA';
        expect(base.remesa.estadoProceso).toBe('PROCESANDO');
        const antes = base.foto();

        await expect(tracker.lote({ ok: 5, err: 0, descartadas: 0 })).rejects.toBeInstanceOf(CargaCerradaPorFueraError);
        expect(base.foto()).toEqual(antes);
        expect(eventos).toEqual(['iniciada']);

        // Y también para `iniciar` sobre una fila ya terminada con la remesa en curso.
        const g = baseReal();
        g.fila()!.finishedAt = new Date();
        await expect(armar(g).tracker.iniciar('j')).rejects.toBeInstanceOf(CargaCerradaPorFueraError);
        expect(g.tx.remesa.update).not.toHaveBeenCalled();
    });

    it('una remesa terminal con la fila todavía en curso no se escribe (solo estadoProceso)', async () => {
        const base = baseReal();
        const { tracker } = armar(base);
        await tracker.iniciar('j');
        base.remesa.estadoProceso = 'FALLIDA'; // la fila sigue sin finishedAt
        const antes = base.foto();
        await expect(tracker.finalizar({ ok: 5, err: 0, descartadas: 0, errorPostProceso: null })).rejects.toBeInstanceOf(CargaCerradaPorFueraError);
        expect(base.foto()).toEqual(antes);
    });

    it('iniciar sobre una remesa SIN fila de progreso (job del código viejo) sigue andando y la crea', async () => {
        const base = baseReal({ sinFila: true });
        const { tracker, eventos } = armar(base);

        await tracker.iniciar('j');

        expect(base.fila()).not.toBeNull();
        expect(base.remesa.estadoProceso).toBe('PROCESANDO');
        expect(eventos).toEqual(['iniciada']);
        tracker.cerrar();
    });

    it.each([
        ['lote', (t: ProgresoTracker) => t.lote({ ok: 5, err: 0, descartadas: 0 })],
        ['entrarEnPostProceso', (t: ProgresoTracker) => t.entrarEnPostProceso()],
        ['finalizar', (t: ProgresoTracker) => t.finalizar({ ok: 5, err: 0, descartadas: 0, errorPostProceso: null })],
    ])('%s sobre una carga que otro cerró entre medio: tira CargaCerradaPorFueraError y no toca el terminal', async (_n, metodo) => {
        const base = baseReal();
        const { tracker, eventos } = armar(base);
        await tracker.iniciar('j');
        base.cerrarPorFuera();
        const terminal = base.foto();
        const eventosAntes = [...eventos];

        await expect(metodo(tracker)).rejects.toBeInstanceOf(CargaCerradaPorFueraError);

        expect(base.foto()).toEqual(terminal); // ni remesa FINALIZADA, ni fila OK, ni fase pisada
        expect(eventos).toEqual(eventosAntes); // ni un evento más
        expect(tracker.cerradaPorFuera).toBe(true);
    });

    it('entrarEnLectura sobre una carga cerrada: no tira (una etiqueta no frena una carga), no escribe y marca cerrada por fuera', async () => {
        const base = baseReal();
        const { tracker, eventos } = armar(base);
        await tracker.iniciar('j');
        base.cerrarPorFuera();
        const terminal = base.foto();

        await expect(tracker.entrarEnLectura()).resolves.toBeUndefined();

        expect(base.foto()).toEqual(terminal);
        expect(eventos).toEqual(['iniciada']);
        expect(tracker.cerradaPorFuera).toBe(true);
    });

    it('fallar sobre una carga cerrada por fuera no escribe, no emite y no se marca "no se pudo registrar"', async () => {
        const base = baseReal();
        const { tracker, eventos, error } = armar(base);
        await tracker.iniciar('j');
        base.cerrarPorFuera();
        const terminal = base.foto();

        const estado = await tracker.fallar(new Error('x'), { ok: 3, err: 0, descartadas: 0 });

        expect(base.foto()).toEqual(terminal);
        expect(eventos).toEqual(['iniciada']);
        expect(tracker.noSePudoRegistrar).toBe(false);
        expect(tracker.cerradaPorFuera).toBe(true);
        expect(estado.resultado).toBe('FALLIDA');
        expect(error).not.toHaveBeenCalled();
    });

    it('fallar cuando ya se sabía que la cargaron cerrada por fuera ni siquiera abre la transacción', async () => {
        const base = baseReal();
        const { tracker } = armar(base);
        await tracker.iniciar('j');
        base.cerrarPorFuera();
        await expect(tracker.lote(CERO)).rejects.toBeInstanceOf(CargaCerradaPorFueraError);
        const tx = base.prisma.$transaction.mock.calls.length;

        await tracker.fallar(new Error('x'), CERO);

        expect(base.prisma.$transaction.mock.calls.length).toBe(tx);
    });

    it('la escritura del reloj sobre una carga cerrada no afecta ninguna fila: no emite, no pisa y detiene el reloj', async () => {
        jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
        const base = baseReal();
        const { tracker, eventos } = armar(base);
        await tracker.iniciar('j');
        base.cerrarPorFuera();
        const terminal = base.foto();
        tracker.avance({ ok: 7, err: 0, descartadas: 0 });

        await jest.advanceTimersByTimeAsync(1000);

        expect(base.foto()).toEqual(terminal);
        expect(eventos).toEqual(['iniciada']);
        expect(tracker.cerradaPorFuera).toBe(true);
        const llamadas = base.tx.import_progreso.updateMany.mock.calls.length;
        await jest.advanceTimersByTimeAsync(60_000);
        expect(base.tx.import_progreso.updateMany.mock.calls.length).toBe(llamadas); // el reloj se detuvo
    });

    it('el latido sobre una carga cerrada no afecta ninguna fila y no pisa', async () => {
        jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
        const base = baseReal();
        const { tracker, eventos } = armar(base);
        await tracker.iniciar('j');
        base.cerrarPorFuera();
        const terminal = base.foto();

        await jest.advanceTimersByTimeAsync(15_000);

        expect(base.foto()).toEqual(terminal);
        expect(eventos).toEqual(['iniciada']);
        expect(tracker.cerradaPorFuera).toBe(true);
    });

    it('el camino feliz sigue andando: la carga termina FINALIZADA con la fila TERMINADA / OK', async () => {
        const base = baseReal();
        const { tracker, eventos } = armar(base);
        await tracker.iniciar('j');
        await tracker.lote({ ok: 10, err: 0, descartadas: 0 });
        await tracker.entrarEnPostProceso();
        await tracker.finalizar({ ok: 10, err: 0, descartadas: 0, errorPostProceso: null });

        expect(base.remesa).toMatchObject({ estadoProceso: 'FINALIZADA', okFilas: 10 });
        expect(base.fila()).toMatchObject({ fase: 'TERMINADA', resultado: 'OK' });
        expect(base.fila()!.finishedAt).not.toBeNull();
        expect(eventos).toEqual(['iniciada', 'progreso', 'progreso', 'finalizada']);
    });

    // ── Un resultado vacío aislado no prueba que otro cerró la carga ─────────────────────────────────────────
    describe('resultados vacíos espurios (los que deja una transacción vencida en el pool)', () => {
        beforeEach(() => jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }));

        it('el reloj: un count 0 con la fila viva es una falla transitoria (un warn) y la carga sigue y termina', async () => {
            const base = baseReal();
            const { tracker, eventos, warn } = armar(base);
            await tracker.iniciar('j');
            base.espurio.updateMany = 1;
            tracker.avance({ ok: 7, err: 0, descartadas: 0 });

            await jest.advanceTimersByTimeAsync(1000); // el vacío espurio
            expect(tracker.cerradaPorFuera).toBe(false);
            expect(warn.mock.calls.some(([m]) => String(m).includes('no se pudo confirmar'))).toBe(true);
            expect(eventos).toEqual(['iniciada']);

            await jest.advanceTimersByTimeAsync(1000); // se reintenta y escribe
            expect(eventos).toEqual(['iniciada', 'progreso']);
            expect(base.fila()!.ok).toBe(7);
            await tracker.lote({ ok: 9, err: 0, descartadas: 0 });
            await tracker.finalizar({ ok: 9, err: 0, descartadas: 0, errorPostProceso: null });
            expect(base.remesa.estadoProceso).toBe('FINALIZADA');
            expect(base.fila()).toMatchObject({ resultado: 'OK' });
        });

        it('el reloj: count 0 y la lectura de confirmación también vacía → dudoso; recién el segundo tic seguido la da por cerrada', async () => {
            const base = baseReal();
            const { tracker } = armar(base);
            await tracker.iniciar('j');
            base.espurio.updateMany = 2;
            base.espurio.findUnique = 2;
            tracker.avance({ ok: 7, err: 0, descartadas: 0 });

            await jest.advanceTimersByTimeAsync(1000);
            expect(tracker.cerradaPorFuera).toBe(false);
            await jest.advanceTimersByTimeAsync(1000);
            expect(tracker.cerradaPorFuera).toBe(true);
        });

        it('el reloj: un vacío dudoso seguido de una escritura buena reinicia la cuenta (no hacen falta dos "seguidos" lejanos)', async () => {
            const base = baseReal();
            const { tracker } = armar(base);
            await tracker.iniciar('j');
            tracker.avance({ ok: 1, err: 0, descartadas: 0 });
            base.espurio.updateMany = 1;
            base.espurio.findUnique = 1;
            await jest.advanceTimersByTimeAsync(1000); // dudoso (1)
            await jest.advanceTimersByTimeAsync(1000); // escribe bien: reinicia
            tracker.avance({ ok: 2, err: 0, descartadas: 0 });
            base.espurio.updateMany = 1;
            base.espurio.findUnique = 1;
            await jest.advanceTimersByTimeAsync(1000); // dudoso (1 otra vez)
            expect(tracker.cerradaPorFuera).toBe(false);
            tracker.cerrar();
        });

        it('el reloj: una carga realmente cerrada por otro se detecta al instante con la lectura de confirmación', async () => {
            const base = baseReal();
            const { tracker } = armar(base);
            await tracker.iniciar('j');
            base.cerrarPorFuera();
            tracker.avance({ ok: 7, err: 0, descartadas: 0 });
            await jest.advanceTimersByTimeAsync(1000);
            expect(tracker.cerradaPorFuera).toBe(true);
        });

        it('el latido: mismo criterio — un count 0 espurio se reintenta; una carga cerrada de verdad, no', async () => {
            const base = baseReal();
            const { tracker, eventos } = armar(base);
            await tracker.iniciar('j');
            base.espurio.updateMany = 1;
            await jest.advanceTimersByTimeAsync(15_000);
            expect(tracker.cerradaPorFuera).toBe(false);
            await jest.advanceTimersByTimeAsync(1000); // el reintento del latido llega en el tic siguiente
            expect(tracker.cerradaPorFuera).toBe(false);
            expect(base.fila()!.rev).toBeGreaterThan(1);
            expect(eventos).toEqual(['iniciada']);

            const otra = baseReal();
            const t2 = armar(otra).tracker;
            await t2.iniciar('j');
            otra.cerrarPorFuera();
            await jest.advanceTimersByTimeAsync(15_000);
            expect(t2.cerradaPorFuera).toBe(true);
            tracker.cerrar();
        });

        it('la compuerta: sin fila una vez se reintenta la transacción y la escritura sigue normal', async () => {
            const base = baseReal();
            const { tracker, eventos, warn } = armar(base);
            await tracker.iniciar('j');
            base.espurio.queryRaw = 1;

            await tracker.lote({ ok: 4, err: 0, descartadas: 0 });

            expect(tracker.cerradaPorFuera).toBe(false);
            expect(base.remesa.okFilas).toBe(4);
            expect(eventos).toEqual(['iniciada', 'progreso']);
            expect(warn.mock.calls.some(([m]) => String(m).includes('se reintenta una vez'))).toBe(true);
        });

        it('la compuerta: sin fila dos veces → cerrada por fuera, y no escribe', async () => {
            const base = baseReal();
            const { tracker, eventos } = armar(base);
            await tracker.iniciar('j');
            base.espurio.queryRaw = 2;
            const antes = base.foto();

            await expect(tracker.lote({ ok: 4, err: 0, descartadas: 0 })).rejects.toBeInstanceOf(CargaCerradaPorFueraError);

            expect(tracker.cerradaPorFuera).toBe(true);
            expect(base.foto()).toEqual(antes);
            expect(eventos).toEqual(['iniciada']);
        });

        it('la compuerta: un terminal visible NO se reintenta (la evidencia positiva corta al instante)', async () => {
            const base = baseReal();
            const { tracker } = armar(base);
            await tracker.iniciar('j');
            base.cerrarPorFuera();
            const n = base.tx.$queryRaw.mock.calls.length;
            await expect(tracker.lote({ ok: 4, err: 0, descartadas: 0 })).rejects.toBeInstanceOf(CargaCerradaPorFueraError);
            expect(base.tx.$queryRaw.mock.calls.length).toBe(n + 1);
        });
    });
});
