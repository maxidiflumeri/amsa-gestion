/**
 * El runner (`processImportJob`) de la Fase B (docs/imports-progreso-realtime-spec.md §9.9.2 C, casos FB-1 a FB-15).
 *
 * `ImportService` real y un arnés propio —el mismo enfoque que `imports-progreso-eventos.spec.ts`, que
 * no se importa para no tocarlo—: `prisma` falso en memoria, `realtime` y `notificaciones` que graban sus
 * llamadas, un processor de mentira y archivos de verdad.
 *
 * Los casos que dependen del reloj del tracker usan timers REALES con `IMPORTS_PROGRESO_INTERVALO_MS=250`
 * (la cota mínima): las filas del archivo se leen por stream y mezclar eso con timers falsos de jest es
 * pedir un spec verde por casualidad.
 */
import { Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as xlsx from 'xlsx';
import { ImportService } from './imports.service';
import { getProcessor } from './processors/processor-registry';
import type { EstadoCargaDto } from './progreso/estado-carga.types';
import { parseMultirregistro } from './utils/multirregistro-parser';

jest.mock('./utils/multirregistro-parser', () => ({ parseMultirregistro: jest.fn() }));
jest.mock('./processors/processor-registry', () => ({
    getProcessor: jest.fn(),
    getSupportedCategories: jest.fn(() => []),
}));

const FILA_DEFAULT = {
    remesaId: 1, rev: 0, fase: 'EN_COLA', subfase: null, porcentaje: 0, totalEsperado: 0, procesadas: 0, ok: 0, err: 0,
    descartadas: 0, fueraDeCorte: null, advertencias: 0, nuevos: null, actualizados: null, resultado: null, error: null,
    errorPostProceso: null, resumen: null, intentos: 0, jobId: null, grupoId: null, grupoOrden: null, grupoTotal: null,
    cancelSolicitadaAt: null, encoladaAt: null, startedAt: null, heartbeatAt: null, finishedAt: null,
};

type Evento = { evento: 'iniciada' | 'progreso' | 'finalizada'; estado: EstadoCargaDto };

interface Opciones {
    /** Líneas de datos del CSV (sin encabezado). Default: `n` filas `i|A`. */
    lineas?: string[];
    filas?: number;
    excel?: boolean;
    remesa?: Record<string, unknown>;
    plantilla?: Record<string, unknown>;
    previa?: Record<string, unknown> | null;
    processor?: Record<string, unknown>;
    /** Hace rechazar a un `remesa.update`: devuelve el error, o null para dejarlo pasar. Recibe el nro de llamada (1-based). */
    updateFalla?: (args: any, n: number) => Error | null;
}

const archivosTemporales: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const p2025 = () => Object.assign(new Error('Record not found'), { code: 'P2025' });

function armar(o: Opciones = {}) {
    const lineas = o.lineas ?? Array.from({ length: o.filas ?? 10 }, (_, i) => `${i}|A`);
    const n = lineas.length;
    const base = path.join(os.tmpdir(), `amsa-fb-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    let archivo: string;
    if (o.excel) {
        archivo = `${base}.xlsx`;
        const wb = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet([['doc', 'valor'], ...lineas.map((l) => l.split('|'))]), 'Hoja1');
        xlsx.writeFile(wb, archivo);
    } else {
        archivo = `${base}.csv`;
        fs.writeFileSync(archivo, ['doc|valor', ...lineas].join('\n'));
    }
    archivosTemporales.push(archivo);

    const remesaRow: any = {
        id: 1, empresaId: 10, numeroRemesa: '00001', nombre: 'Carga de prueba', archivo, archivos: null, hoja: null,
        categoria: 'DEUDORES', estadoProceso: 'PENDIENTE', totalFilas: n, okFilas: 0, errFilas: 0, plantillaId: 5,
        usuarioCreadorId: 3, filtroFilas: null, validarDomicilios: false, ...o.remesa,
    };
    const plantilla: any = {
        id: 5, defaultEstadoSituacionId: 1, defaultEstadoGestionId: 2,
        mappingJson: { columns: { documento: { fromIndex: 0 } } }, separador: '|', tieneHeader: true, ...o.plantilla,
    };
    // Por defecto la carga está recién encolada (como la deja `executeRemesa`).
    let fila: any = o.previa === null ? null : { ...FILA_DEFAULT, encoladaAt: new Date('2026-10-09T10:00:00Z'), ...o.previa };

    const escrituras: Array<{ where: any; remesa: any; progreso: any }> = [];
    let nUpdate = 0;
    const aplicar = (data: any) => {
        const { progreso, ...resto } = data;
        Object.assign(remesaRow, resto);
        if (progreso?.upsert) {
            if (!fila) fila = { ...FILA_DEFAULT, ...progreso.upsert.create };
            else {
                for (const [k, v] of Object.entries(progreso.upsert.update as Record<string, any>)) {
                    if (v && typeof v === 'object' && !(v instanceof Date) && 'increment' in v) fila[k] += (v as any).increment;
                    else fila[k] = v;
                }
            }
        }
    };
    const prisma: any = {
        remesa: {
            findUnique: jest.fn().mockImplementation(() =>
                Promise.resolve({ ...remesaRow, plantilla, usuarioCreador: { id: 3, nombre: 'Maxi' }, progreso: fila ? { ...fila } : null }),
            ),
            update: jest.fn().mockImplementation(({ where, data }: any) => {
                nUpdate++;
                const e = o.updateFalla?.({ where, data }, nUpdate);
                if (e) return Promise.reject(e);
                const { progreso, ...resto } = data;
                escrituras.push(structuredClone({ where, remesa: resto, progreso: progreso?.upsert ?? null }));
                aplicar(data);
                return Promise.resolve({ progreso: fila ? { rev: fila.rev } : null });
            }),
        },
        import_progreso: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        importerror: {
            deleteMany: jest.fn().mockResolvedValue({}),
            count: jest.fn().mockResolvedValue(0),
            createMany: jest.fn().mockResolvedValue({}),
            create: jest.fn().mockResolvedValue({}),
        },
    };
    // Dentro de la transacción: el SELECT … FOR UPDATE (de `cerrarCargaInterrumpida` y de las escrituras del tracker),
    // la escritura del tracker (`upsert` anidado), el `update` con `include` del cierre y la sentencia del reloj.
    const tx: any = {
        $queryRaw: jest.fn().mockImplementation(() =>
            Promise.resolve(fila ? [{
                progresoId: 1, filtroFilas: remesaRow.filtroFilas,
                estadoProceso: remesaRow.estadoProceso, categoria: remesaRow.categoria, encoladaAt: fila.encoladaAt,
                startedAt: fila.startedAt, heartbeatAt: fila.heartbeatAt, finishedAt: fila.finishedAt, ok: fila.ok, err: fila.err, jobId: fila.jobId,
            }] : []),
        ),
        remesa: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            update: jest.fn().mockImplementation((args: any) => {
                if (args.data.progreso?.upsert) return prisma.remesa.update(args); // escritura del tracker
                const { data } = args;
                const { progreso, ...resto } = data;
                Object.assign(remesaRow, resto);
                Object.assign(fila, progreso.update, { rev: fila.rev + 1 });
                return Promise.resolve({ ...remesaRow, progreso: { ...fila }, usuarioCreador: { id: 3, nombre: 'Maxi' } });
            }),
        },
        import_progreso: {
            upsert: jest.fn().mockResolvedValue({}),
            // La escritura del reloj: una sentencia condicionada (finishedAt IS NULL) y la lectura del rev.
            updateMany: jest.fn().mockImplementation(({ where, data }: any) => {
                if (!fila || (where.finishedAt === null && fila.finishedAt)) return Promise.resolve({ count: 0 });
                aplicar({ progreso: { upsert: { update: data } } });
                return Promise.resolve({ count: 1 });
            }),
            findUnique: jest.fn().mockImplementation(() => Promise.resolve({ rev: fila.rev })),
        },
    };
    prisma.$transaction = jest.fn().mockImplementation((fn: any) => fn(tx));

    const eventos: Evento[] = [];
    const realtime: any = {
        emitImportIniciada: jest.fn().mockImplementation((estado: EstadoCargaDto) => eventos.push({ evento: 'iniciada', estado })),
        emitImportProgreso: jest.fn().mockImplementation((estado: EstadoCargaDto) => eventos.push({ evento: 'progreso', estado })),
        emitImportFinalizada: jest.fn().mockImplementation((estado: EstadoCargaDto) => eventos.push({ evento: 'finalizada', estado })),
    };
    const notificaciones: any = { crear: jest.fn().mockResolvedValue(undefined) };
    const auditoria: any = { log: jest.fn().mockResolvedValue(undefined) };

    const processor: any = {
        category: 'DEUDORES',
        processRow: jest.fn().mockResolvedValue(undefined),
        afterAll: jest.fn().mockResolvedValue(undefined),
        ...o.processor,
    };
    (getProcessor as jest.Mock).mockReturnValue(processor);

    const service = new ImportService(prisma, {} as any, {} as any, realtime, notificaciones, {} as any, {} as any, {} as any, auditoria);
    const job: any = { id: 'job-1', data: { usuarioId: 3 }, updateProgress: jest.fn().mockResolvedValue(undefined) };

    return { service, job, prisma, tx, remesaRow, escrituras, eventos, realtime, notificaciones, auditoria, processor, fila: () => fila };
}

const progresos = (eventos: Evento[]) => eventos.filter((e) => e.evento === 'progreso');

beforeAll(() => Logger.overrideLogger(false));
beforeEach(() => {
    process.env.IMPORTS_PROGRESO_INTERVALO_MS = '250';
});
afterEach(() => {
    delete process.env.IMPORTS_PROGRESO_INTERVALO_MS;
    jest.restoreAllMocks();
});
afterAll(() => {
    for (const f of archivosTemporales) fs.rmSync(f, { force: true });
});

describe('processImportJob — Fase B', () => {
    it('FB-1: 900 filas en un solo lote, cada una tarda: hay eventos intermedios con porcentaje creciente, a lo sumo uno por intervalo', async () => {
        const h = armar({
            filas: 900,
            processor: { processRow: jest.fn().mockImplementation(() => sleep(2)) },
        });
        const t0 = Date.now();

        await expect(h.service.processImportJob(h.job, 1)).resolves.toEqual({ total: 900, ok: 900, err: 0 });

        const duracion = Date.now() - t0;
        // Entre `iniciada` y el `progreso` del fin de lote hay eventos del reloj (el "0 a 99 de golpe" de #2).
        const finDeLote = h.eventos.findIndex((e) => e.evento === 'progreso' && e.estado.fase === 'PROCESANDO' && e.estado.procesadas === 900);
        expect(finDeLote).toBeGreaterThan(1);
        const intermedios = h.eventos.slice(1, finDeLote).filter((e) => e.evento === 'progreso');
        expect(intermedios.length).toBeGreaterThanOrEqual(2);
        for (let i = 1; i < intermedios.length; i++) {
            expect(intermedios[i].estado.progreso).toBeGreaterThanOrEqual(intermedios[i - 1].estado.progreso);
            expect(intermedios[i].estado.rev).toBeGreaterThan(intermedios[i - 1].estado.rev);
        }
        expect(intermedios[intermedios.length - 1].estado.progreso).toBeGreaterThan(0);
        // A lo sumo uno por intervalo de 250 ms.
        expect(h.eventos.filter((e) => e.evento === 'progreso').length).toBeLessThanOrEqual(Math.ceil(duracion / 250) + 3);
        expect(h.eventos[h.eventos.length - 1].evento).toBe('finalizada');
    }, 20_000);

    it('FB-2: el processor informa contadores y, en afterAll, dos subfases: los eventos de POST_PROCESO traen el texto armado, en orden; el terminal trae subfase null', async () => {
        const h = armar({
            filas: 3,
            processor: {
                processRow: jest.fn().mockImplementation(async (_row: any, ctx: any) => {
                    ctx.progreso?.contadores({ nuevos: 2, actualizados: 1 });
                }),
                afterAll: jest.fn().mockImplementation(async (ctx: any) => {
                    ctx.progreso.subfase('Consolidando casos', 1500, 8875);
                    await sleep(400);
                    ctx.progreso.subfase('Cerrando promesas cumplidas');
                    await sleep(400);
                }),
            },
        });

        await h.service.processImportJob(h.job, 1);

        const post = h.eventos.filter((e) => e.evento === 'progreso' && e.estado.fase === 'POST_PROCESO');
        const subfases = post.map((e) => e.estado.subfase);
        expect(subfases[0]).toBeNull(); // al entrar al post-proceso
        const textos = subfases.filter((s) => s != null);
        expect(textos).toEqual(['Consolidando casos: 1.500 de 8.875', 'Cerrando promesas cumplidas']);
        const fin = h.eventos[h.eventos.length - 1];
        expect(fin.evento).toBe('finalizada');
        expect(fin.estado).toMatchObject({ subfase: null, nuevos: 2, actualizados: 1, resultado: 'OK' });
        expect(h.fila()).toMatchObject({ subfase: null, nuevos: 2, actualizados: 1 });
    });

    it('FB-3: por lote, el processor informa filasDelLote a mitad: hay un evento intermedio con procesadas > ok + err; el del fin de lote vuelve a ok + err', async () => {
        const h = armar({
            filas: 10,
            processor: {
                processRow: undefined,
                processBatch: jest.fn().mockImplementation(async (rows: any[], ctx: any) => {
                    ctx.progreso.filasDelLote(Math.floor(rows.length / 2));
                    await sleep(400);
                    return [];
                }),
            },
        });

        await h.service.processImportJob(h.job, 1);

        const enVuelo = progresos(h.eventos).find((e) => e.estado.fase === 'PROCESANDO' && e.estado.procesadas === 5);
        expect(enVuelo).toBeDefined();
        expect(enVuelo!.estado.ok + enVuelo!.estado.err).toBe(0);
        expect(enVuelo!.estado.procesadas).toBeGreaterThan(enVuelo!.estado.ok + enVuelo!.estado.err);
        const finDeLote = progresos(h.eventos).find((e) => e.estado.fase === 'PROCESANDO' && e.estado.ok === 10);
        expect(finDeLote!.estado.procesadas).toBe(10);
    });

    describe('una carga no se re-ejecuta', () => {
        const previaArrancada = {
            fase: 'PROCESANDO', rev: 7, intentos: 1, procesadas: 1000, ok: 1000, err: 0, totalEsperado: 10,
            encoladaAt: new Date('2026-10-09T10:00:00Z'), startedAt: new Date('2026-10-09T10:00:01Z'),
            heartbeatAt: new Date('2026-10-09T10:01:00Z'), jobId: 'job-1',
        };

        it('FB-4: re-entrega (reemplaza a B-8): no procesa ni una fila, cierra FALLIDA con el texto de interrupción, no sube intentos, notifica y devuelve ignorado', async () => {
            const h = armar({ filas: 10, previa: previaArrancada, remesa: { estadoProceso: 'PROCESANDO' } });

            const r = await h.service.processImportJob(h.job, 1);

            expect(r).toEqual({ total: 0, ok: 0, err: 0, ignorado: true });
            expect(h.processor.processRow).not.toHaveBeenCalled();
            expect(h.processor.afterAll).not.toHaveBeenCalled();
            expect(h.eventos.map((e) => e.evento)).toEqual(['finalizada']);
            const fin = h.eventos[0].estado;
            expect(fin).toMatchObject({ resultado: 'FALLIDA', estadoProceso: 'FALLIDA', terminal: true, intentos: 1, ok: 1000 });
            expect(fin.error).toContain('La importación se interrumpió: el servidor se reinició o dejó de responder mientras la procesaba.');
            expect(fin.error).toContain('Eliminá esta importación desde el Historial'); // DEUDORES
            expect(h.notificaciones.crear).toHaveBeenCalledTimes(1);
            expect(h.notificaciones.crear.mock.calls[0][0]).toMatchObject({ tipo: 'IMPORTACION_ERROR', titulo: 'Importación fallida' });
            expect(h.auditoria.log.mock.calls[0][0]).toMatchObject({ tipo: 'IMPORT_FAIL', entidadId: 1 });
            // Ni una escritura del tracker: la única que toca la fila es la del cierre.
            expect(h.prisma.remesa.update).not.toHaveBeenCalled();
            expect(h.fila()).toMatchObject({ intentos: 1, fase: 'TERMINADA', resultado: 'FALLIDA' });
        });

        it('FB-5: re-entrega de una carga que está viva en este proceso: no se cierra nada', async () => {
            let liberar!: () => void;
            const compuerta = new Promise<void>((r) => { liberar = r; });
            const h = armar({
                filas: 3,
                processor: { processRow: jest.fn().mockImplementation(() => compuerta) },
            });

            const primera = h.service.processImportJob(h.job, 1);
            await sleep(150); // la primera ya arrancó y está trabada en una fila
            expect(h.service.cargaVivaEnEsteProceso(1)).not.toBeNull();

            const segunda = await h.service.processImportJob({ ...h.job, id: 'job-1' }, 1);

            expect(segunda).toEqual({ total: 0, ok: 0, err: 0, ignorado: true });
            // No se cerró nada: ningún `update` del cierre (el de la primera carga es el del tracker, con `upsert`).
            expect(h.tx.remesa.update.mock.calls.filter((c: any[]) => c[0].data.progreso?.update)).toHaveLength(0);
            expect(h.fila().resultado).toBeNull();
            liberar();
            await expect(primera).resolves.toEqual({ total: 3, ok: 3, err: 0 });
            expect(h.fila()).toMatchObject({ resultado: 'OK' });
        });

        it('FB-6: iniciar no encuentra la fila (la carga volvió a borrador o ya es terminal): ningún evento, nada procesado, ignorado', async () => {
            const h = armar({ filas: 10, updateFalla: () => p2025() });

            const r = await h.service.processImportJob(h.job, 1);

            expect(r).toEqual({ total: 0, ok: 0, err: 0, ignorado: true });
            expect(h.eventos).toHaveLength(0);
            expect(h.processor.processRow).not.toHaveBeenCalled();
            expect(h.notificaciones.crear).not.toHaveBeenCalled();
            expect(h.prisma.remesa.update).toHaveBeenCalledTimes(1); // solo el intento de iniciar: no hay `fallar`
            expect(h.service.cargaVivaEnEsteProceso(1)).toBeNull();
        });

        it('FB-7: cerrada por fuera en el segundo lote: el tercero no se procesa, no hay fallar ni notificación y el estado del otro no se toca', async () => {
            // iniciar = 1; lote 1 = 2; lote 2 = 3 → la fila ya la cerró otro.
            const h = armar({ filas: 2500, updateFalla: (_a, n) => (n === 3 ? p2025() : null) });

            const r = await h.service.processImportJob(h.job, 1);

            expect(r).toMatchObject({ ignorado: true, ok: 2000 });
            expect(h.processor.processRow).toHaveBeenCalledTimes(2000); // el tercer lote no se procesó
            expect(h.processor.afterAll).not.toHaveBeenCalled();
            expect(h.notificaciones.crear).not.toHaveBeenCalled();
            expect(h.eventos.some((e) => e.evento === 'finalizada')).toBe(false);
            expect(h.prisma.remesa.update).toHaveBeenCalledTimes(3); // sin `fallar`
            expect(h.fila().resultado).toBeNull(); // lo que dejó el otro no se pisó
            expect(h.service.cargaVivaEnEsteProceso(1)).toBeNull();
        });
    });

    it('FB-16: una carga que otro cerró antes del post-proceso NO entra al afterAll (no genera pagos ni cancela casos sobre una FALLIDA)', async () => {
        // iniciar = 1, el lote = 2, entrarEnPostProceso = 3 → la fila ya la cerró otro.
        const h = armar({ filas: 10, updateFalla: (_a, n) => (n === 3 ? p2025() : null) });

        const r = await h.service.processImportJob(h.job, 1);

        expect(r).toMatchObject({ ignorado: true, ok: 10 });
        expect(h.processor.afterAll).not.toHaveBeenCalled();
        expect(h.notificaciones.crear).not.toHaveBeenCalled();
        expect(h.eventos.some((e) => e.evento === 'finalizada')).toBe(false);
        expect(h.prisma.remesa.update).toHaveBeenCalledTimes(3); // sin `fallar`
        expect(h.service.cargaVivaEnEsteProceso(1)).toBeNull();
    });

    it('FB-16b: si lo único que falla es registrar la etiqueta POST_PROCESO (la base, no un cierre), el afterAll corre igual', async () => {
        const h = armar({ filas: 10, updateFalla: (_a, n) => (n === 3 ? new Error('base lenta') : null) });
        await h.service.processImportJob(h.job, 1);
        expect(h.processor.afterAll).toHaveBeenCalledTimes(1);
        expect(h.eventos[h.eventos.length - 1].estado.resultado).toBe('OK');
    });

    it('FB-17: el finally del runner detiene el reloj aunque el job termine por la salida "la remesa se borró mientras arrancaba"', async () => {
        jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
        try {
            const h = armar({ filas: 3 });
            const original = h.prisma.remesa.findUnique.getMockImplementation()!;
            let llamadas = 0;
            h.prisma.remesa.findUnique.mockImplementation((...a: any[]) => (++llamadas === 2 ? Promise.resolve(null) : original(...a)));

            const r = await h.service.processImportJob(h.job, 1);

            expect(r).toMatchObject({ ignorado: true });
            expect(h.processor.processRow).not.toHaveBeenCalled();
            // Sin `tracker.cerrar()` en el finally quedaría un setInterval vivo por cada carga ignorada.
            expect(jest.getTimerCount()).toBe(0);
            expect(h.service.cargaVivaEnEsteProceso(1)).toBeNull();
        } finally {
            jest.useRealTimers();
        }
    });

    describe('descartadas separadas', () => {
        // col 1: A = entra, B = de otro corte, X = lo descarta la plantilla (y tampoco es de este corte).
        const lineas = ['1|A', '2|X', '3|B', '4|A', '5|B', '6|X', '7|B', '8|A', '9|B', '10|X'];
        const plantillaConFiltro = {
            mappingJson: { columns: { documento: { fromIndex: 0 } }, filtroFilas: [{ fromIndex: 1, operador: 'DISTINTO', valor: 'X' }] },
        };
        const corte = [{ fromIndex: 1, operador: 'IGUAL', valor: 'A' }];

        it('FB-8: 10 filas: 3 no pasan el filtro de la plantilla, 4 son de otro corte y 3 entran', async () => {
            const h = armar({ lineas, plantilla: plantillaConFiltro, remesa: { filtroFilas: corte, totalFilas: 3 } });

            await expect(h.service.processImportJob(h.job, 1)).resolves.toEqual({ total: 3, ok: 3, err: 0 });

            const fin = h.eventos[h.eventos.length - 1].estado;
            expect(fin).toMatchObject({ descartadas: 7, fueraDeCorte: 4, descartadasPorFiltro: 3, procesadas: 3 });
            expect(h.fila()).toMatchObject({ descartadas: 7, fueraDeCorte: 4 });
        });

        it('FB-9: lo mismo en una remesa sin corte: fueraDeCorte es null y todas las descartadas son del filtro', async () => {
            const h = armar({ lineas, plantilla: plantillaConFiltro, remesa: { totalFilas: 7 } });

            await h.service.processImportJob(h.job, 1);

            const fin = h.eventos[h.eventos.length - 1].estado;
            expect(fin).toMatchObject({ descartadas: 3, fueraDeCorte: null, descartadasPorFiltro: 3, procesadas: 7 });
            expect(h.fila().fueraDeCorte).toBeNull();
        });

        it('FB-10: una fila que no pasa ni el filtro ni el corte cuenta en descartadas y NO en fueraDeCorte', async () => {
            const h = armar({ lineas: ['1|X', '2|X', '3|A'], plantilla: plantillaConFiltro, remesa: { filtroFilas: corte, totalFilas: 1 } });

            await h.service.processImportJob(h.job, 1);

            const fin = h.eventos[h.eventos.length - 1].estado;
            expect(fin).toMatchObject({ descartadas: 2, fueraDeCorte: 0, descartadasPorFiltro: 2, procesadas: 1 });
        });

        it('el resultado SIN_FILAS por corte lo dice en la notificación', async () => {
            const h = armar({ lineas: ['1|B', '2|B'], remesa: { filtroFilas: corte, totalFilas: 0 } });

            await h.service.processImportJob(h.job, 1);

            const notif = h.notificaciones.crear.mock.calls[0][0];
            expect(notif.mensaje).toContain('2 filas son de otros cortes de la división.');
            expect(notif.mensaje).not.toContain('El filtro de la plantilla');
            expect(notif.payload).toMatchObject({ descartadas: 2, fueraDeCorte: 2, descartadasPorFiltro: 0 });
        });
    });

    describe('fase LEYENDO', () => {
        it('FB-11: una categoría pre-parseada tiene un progreso con LEYENDO antes del primero con PROCESANDO', async () => {
            (parseMultirregistro as jest.Mock).mockReturnValue({
                filas: [{ nroCliente: '1' }, { nroCliente: '2' }],
                advertencias: [],
                resumen: { lineas: 2, porTipo: {}, casos: 2, facturas: 0, bajas: 0, ignoradas: 0 },
            });
            const h = armar({
                remesa: { categoria: 'MULTIRREGISTRO', totalFilas: 2 },
                plantilla: { mappingJson: { columns: {}, multirregistro: { tipoLinea: {} } } },
            });

            await h.service.processImportJob(h.job, 1);

            const fases = progresos(h.eventos).map((e) => e.estado.fase);
            // Exactamente un evento LEYENDO, y es el primero: anterior al primer PROCESANDO.
            expect(fases.filter((f) => f === 'LEYENDO')).toHaveLength(1);
            expect(fases[0]).toBe('LEYENDO');
            expect(fases.indexOf('PROCESANDO')).toBeGreaterThan(0);
            expect(h.eventos[0]).toMatchObject({ evento: 'iniciada', estado: { fase: 'PROCESANDO' } }); // lo que promete §8.4.2
        });

        it('FB-12: un CSV no pasa por LEYENDO', async () => {
            const h = armar({ filas: 10 });

            await h.service.processImportJob(h.job, 1);

            expect(h.eventos.some((e) => e.estado.fase === 'LEYENDO')).toBe(false);
            expect(h.escrituras.some((w) => w.progreso?.update?.fase === 'LEYENDO')).toBe(false);
        });

        it('FB-13: un Excel tiene LEYENDO antes de la primera fila', async () => {
            const h = armar({ filas: 10, excel: true });
            const orden: string[] = [];
            h.realtime.emitImportProgreso.mockImplementation((e: EstadoCargaDto) => { h.eventos.push({ evento: 'progreso', estado: e }); orden.push(`ev:${e.fase}`); });
            h.processor.processRow.mockImplementation(async () => { orden.push('fila'); });

            await expect(h.service.processImportJob(h.job, 1)).resolves.toEqual({ total: 10, ok: 10, err: 0 });

            expect(orden[0]).toBe('ev:LEYENDO');
            expect(orden.filter((o) => o === 'ev:LEYENDO')).toHaveLength(1);
            expect(orden.indexOf('fila')).toBeGreaterThan(0);
        });
    });

    describe('registro de cargas vivas', () => {
        it('FB-14: durante el job la carga figura viva; después de terminar bien, de fallar, de un job ignorado y de uno cerrado por fuera, no', async () => {
            // Terminar bien.
            const bien = armar({ filas: 3 });
            let vivaDurante: unknown = null;
            bien.processor.processRow.mockImplementation(async () => { vivaDurante = bien.service.cargaVivaEnEsteProceso(1); });
            await bien.service.processImportJob(bien.job, 1);
            expect(vivaDurante).toMatchObject({ fase: 'PROCESANDO', sinAvanceMs: expect.any(Number) });
            expect(bien.service.cargaVivaEnEsteProceso(1)).toBeNull();

            // Fallar (la plantilla no tiene estado inicial).
            const mal = armar({ filas: 3, plantilla: { defaultEstadoSituacionId: null } });
            await expect(mal.service.processImportJob(mal.job, 1)).rejects.toThrow();
            expect(mal.service.cargaVivaEnEsteProceso(1)).toBeNull();

            // Job ignorado (la carga ya terminó).
            const ignorado = armar({ filas: 3, remesa: { estadoProceso: 'FINALIZADA' }, previa: { finishedAt: new Date(), fase: 'TERMINADA' } });
            await expect(ignorado.service.processImportJob(ignorado.job, 1)).resolves.toMatchObject({ ignorado: true });
            expect(ignorado.service.cargaVivaEnEsteProceso(1)).toBeNull();

            // Cerrado por fuera.
            const fuera = armar({ filas: 3, updateFalla: (_a, n) => (n === 2 ? p2025() : null) });
            await fuera.service.processImportJob(fuera.job, 1);
            expect(fuera.service.cargaVivaEnEsteProceso(1)).toBeNull();
            // Y el reloj no queda corriendo: después de terminar no hay ni un latido más.
            const latidos = bien.prisma.import_progreso.updateMany.mock.calls.length;
            await sleep(600);
            expect(bien.prisma.import_progreso.updateMany.mock.calls.length).toBe(latidos);
            expect(bien.service.hayCargasVivasEnEsteProceso()).toBe(false);
        });

        it('FB-14b: una excepción dentro de iniciar tampoco deja la carga en el registro', async () => {
            const h = armar({ filas: 3, updateFalla: () => new Error('base caída') });
            await expect(h.service.processImportJob(h.job, 1)).rejects.toThrow('base caída');
            expect(h.service.cargaVivaEnEsteProceso(1)).toBeNull();
        });
    });

    it('FB-15: el ctx que recibe el processor trae progreso con los tres métodos, y ninguno tira aunque el tracker esté cerrado', async () => {
        const h = armar({ filas: 2 });

        await h.service.processImportJob(h.job, 1);

        const ctx = h.processor.processRow.mock.calls[0][1];
        expect(ctx.progreso).toEqual({
            filasDelLote: expect.any(Function),
            subfase: expect.any(Function),
            contadores: expect.any(Function),
        });
        // El job ya terminó: el tracker está cerrado.
        expect(() => ctx.progreso.filasDelLote(5)).not.toThrow();
        expect(() => ctx.progreso.subfase('x', 1, 2)).not.toThrow();
        expect(() => ctx.progreso.contadores({ nuevos: 1, actualizados: 2 })).not.toThrow();
        expect(() => ctx.progreso.filasDelLote(Number.NaN)).not.toThrow();
    });

    it('un fallo del processor sigue el camino de siempre: fallar, notificar y relanzar (con el reloj detenido)', async () => {
        const h = armar({ filas: 3, processor: { afterAll: jest.fn().mockRejectedValue(new Error('boom')) } });
        // El post-proceso que tira NO falla la carga (CON_ADVERTENCIAS); una excepción fuera de él sí.
        await h.service.processImportJob(h.job, 1);
        expect(h.eventos[h.eventos.length - 1].estado.resultado).toBe('CON_ADVERTENCIAS');

        const mal = armar({ filas: 3, plantilla: { defaultEstadoGestionId: null } });
        await expect(mal.service.processImportJob(mal.job, 1)).rejects.toThrow();
        expect(mal.eventos[mal.eventos.length - 1]).toMatchObject({ evento: 'finalizada', estado: { resultado: 'FALLIDA' } });
        expect(mal.notificaciones.crear).toHaveBeenCalledTimes(1);
        const escrituras = mal.prisma.remesa.update.mock.calls.length;
        await sleep(600);
        expect(mal.prisma.remesa.update).toHaveBeenCalledTimes(escrituras);
    });
});
