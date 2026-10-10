/**
 * El runner (`processImportJob`) de la Fase C, entrega 1 (docs/imports-progreso-realtime-spec.md §10.5.3, §10.5.4 y §10.9.2 C,
 * casos FC-1 a FC-16): cortar una carga cancelada sin que corra su cierre, y el marcador de "no entregó ninguna fila".
 *
 * `ImportService` real y un arnés propio (no se importa el de otros specs para no tocarlos). El `prisma` falso se porta
 * como MySQL + Prisma en lo que el diseño apoya:
 *   - las transacciones se SERIALIZAN (el lock de la fila), con cesiones al event loop adentro: una implementación que
 *     leyera el pedido de cancelación sin el lock se notaría;
 *   - el `SELECT … FOR UPDATE` devuelve la fila ACTUAL del doble;
 *   - un `updateMany` condicionado que no encuentra la fila afecta 0 filas y NO tira;
 *   - hay una lectura que devuelve vacío sin error sobre una fila que existe (FC-15) y nada se decide con eso.
 *
 * El pedido de cancelación entra por el código real (`service.cancelarCarga`), no por un atajo del doble, salvo donde el caso
 * necesita que llegue por otro proceso (FC-4, FC-5, FC-14).
 */
import { BadRequestException, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as xlsx from 'xlsx';
import { IMPORTS_BATCH_SIZE, ImportService } from './imports.service';
import { getProcessor } from './processors/processor-registry';
import type { EstadoCargaDto } from './progreso/estado-carga.types';
import { parseMultirregistro } from './utils/multirregistro-parser';

jest.mock('./utils/multirregistro-parser', () => ({ parseMultirregistro: jest.fn() }));
jest.mock('./processors/processor-registry', () => ({
    getProcessor: jest.fn(),
    getSupportedCategories: jest.fn(() => []),
}));

const ORIGEN = { v: 1, origen: { remesaOrigenId: null, remesaOrigenIds: null } };
const FILA_DEFAULT = {
    remesaId: 1, rev: 0, fase: 'EN_COLA', subfase: null, porcentaje: 0, totalEsperado: 0, procesadas: 0, ok: 0, err: 0,
    descartadas: 0, fueraDeCorte: null, advertencias: 0, nuevos: null, actualizados: null, resultado: null, error: null,
    errorPostProceso: null, resumen: ORIGEN, intentos: 0, jobId: null, grupoId: null, grupoOrden: null, grupoTotal: null,
    cancelSolicitadaAt: null, encoladaAt: null, startedAt: null, heartbeatAt: null, finishedAt: null,
};
const USUARIO_QUE_CANCELA = { sub: 9, permisos: ['importacion.ver_progreso_otros'] };

type Evento = { evento: 'iniciada' | 'progreso' | 'finalizada'; estado: EstadoCargaDto };

interface Opciones {
    filas?: number;
    /** El archivo es un Excel: lectura síncrona que bloquea, con la pausa de §hallazgo 3. */
    excel?: boolean;
    /** Hace que `processRow` falle en las filas cuyo número de llamada (1-based) cumple esto. */
    filaConError?: (n: number) => boolean;
    remesa?: Record<string, unknown>;
    plantilla?: Record<string, unknown>;
    previa?: Record<string, unknown>;
    processor?: Record<string, unknown>;
}

const archivosTemporales: string[] = [];
const cede = () => new Promise<void>((r) => setImmediate(r));

function armar(o: Opciones = {}) {
    const n = o.filas ?? 10;
    const archivo = path.join(os.tmpdir(), `amsa-fc1-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.${o.excel ? 'xlsx' : 'csv'}`);
    if (o.excel) {
        const wb = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet([['doc', 'valor'], ...Array.from({ length: n }, (_, i) => [String(i), 'A'])]), 'Hoja1');
        xlsx.writeFile(wb, archivo);
    } else {
        fs.writeFileSync(archivo, ['doc|valor', ...Array.from({ length: n }, (_, i) => `${i}|A`)].join('\n'));
    }
    archivosTemporales.push(archivo);

    const remesaRow: any = {
        id: 1, empresaId: 10, numeroRemesa: '00001', nombre: 'Carga de prueba', archivo, archivos: null, hoja: null,
        categoria: 'DEUDORES', estadoProceso: 'PENDIENTE', totalFilas: n, okFilas: 0, errFilas: 0, plantillaId: 5,
        usuarioCreadorId: 3, filtroFilas: null, validarDomicilios: false, archivoHash: 'h', ...o.remesa,
    };
    const plantilla: any = {
        id: 5, defaultEstadoSituacionId: 1, defaultEstadoGestionId: 2,
        mappingJson: { columns: { documento: { fromIndex: 0 } } }, separador: '|', tieneHeader: true, ...o.plantilla,
    };
    const fila: any = { ...FILA_DEFAULT, encoladaAt: new Date('2026-10-09T10:00:00Z'), ...o.previa };

    // Perillas del doble, que los casos mueven en pleno job.
    const perillas = {
        /** La próxima N veces que el SELECT … FOR UPDATE se pida, tira (una falla de conexión que no es de cierre). */
        fallarSelectProximos: 0,
        /** La lectura simple de `cancelSolicitadaAt` (`import_progreso.findUnique`): 'FILA' | 'VACIO' | 'FALLA'. */
        lecturaSimple: 'FILA' as 'FILA' | 'VACIO' | 'FALLA',
    };
    const importerrors: any[] = [];
    let cola: Promise<unknown> = Promise.resolve();
    const serializar = <T>(fn: () => Promise<T>): Promise<T> => {
        const r = cola.then(fn, fn);
        cola = r.then(() => undefined, () => undefined);
        return r;
    };
    const aplicarProgreso = (campos: Record<string, any>) => {
        for (const [k, v] of Object.entries(campos)) {
            if (v && typeof v === 'object' && !(v instanceof Date) && 'increment' in v) fila[k] += v.increment;
            else fila[k] = v;
        }
    };
    const escribirRemesa = ({ data }: any) => {
        const { progreso, ...resto } = data;
        Object.assign(remesaRow, resto);
        if (progreso?.upsert) aplicarProgreso(progreso.upsert.update);
        else if (progreso?.update) aplicarProgreso(progreso.update);
        return { ...remesaRow, progreso: { ...fila }, usuarioCreador: { id: 3, nombre: 'Maxi' } };
    };
    const filaParaSelect = () => ({
        id: remesaRow.id, numeroRemesa: remesaRow.numeroRemesa, estadoProceso: remesaRow.estadoProceso, totalFilas: remesaRow.totalFilas,
        categoria: remesaRow.categoria, empresaId: remesaRow.empresaId, plantillaId: remesaRow.plantillaId, archivoHash: remesaRow.archivoHash,
        filtroFilas: remesaRow.filtroFilas, usuarioCreadorId: remesaRow.usuarioCreadorId, progresoId: 1, fase: fila.fase,
        encoladaAt: fila.encoladaAt, startedAt: fila.startedAt, heartbeatAt: fila.heartbeatAt, finishedAt: fila.finishedAt,
        resumen: fila.resumen, cancelSolicitadaAt: fila.cancelSolicitadaAt, jobId: fila.jobId, resultado: fila.resultado, rev: fila.rev,
        ok: fila.ok, err: fila.err,
    });
    const tx: any = {
        $queryRaw: jest.fn().mockImplementation(async () => {
            await cede();
            if (perillas.fallarSelectProximos > 0) {
                perillas.fallarSelectProximos--;
                throw new Error('Connection lost (simulada)');
            }
            return [filaParaSelect()];
        }),
        remesa: { update: jest.fn().mockImplementation(async (args: any) => { await cede(); return escribirRemesa(args); }) },
        import_progreso: {
            update: jest.fn().mockImplementation(async ({ data }: any) => { await cede(); aplicarProgreso(data); return { ...fila }; }),
            updateMany: jest.fn().mockImplementation(async ({ where, data }: any) => {
                await cede();
                if (where.finishedAt === null && fila.finishedAt) return { count: 0 };
                aplicarProgreso(data);
                return { count: 1 };
            }),
            findUnique: jest.fn().mockImplementation(async () => {
                await cede();
                return { rev: fila.rev, cancelSolicitadaAt: fila.cancelSolicitadaAt, resumen: fila.resumen };
            }),
        },
    };
    const prisma: any = {
        $transaction: jest.fn().mockImplementation((fn: any) => serializar(() => fn(tx))),
        $queryRaw: jest.fn().mockResolvedValue([{ n: 0 }]),
        remesa: {
            findUnique: jest.fn().mockImplementation(async () => ({
                ...remesaRow, plantilla, usuarioCreador: { id: 3, nombre: 'Maxi' }, progreso: { ...fila },
            })),
        },
        usuario: { findUnique: jest.fn().mockResolvedValue({ nombre: 'Ana' }) },
        import_progreso: {
            findUnique: jest.fn().mockImplementation(async () => {
                if (perillas.lecturaSimple === 'FALLA') throw new Error('lectura simple caída');
                if (perillas.lecturaSimple === 'VACIO') return null;
                return { cancelSolicitadaAt: fila.cancelSolicitadaAt, resumen: fila.resumen, finishedAt: fila.finishedAt, remesa: { estadoProceso: remesaRow.estadoProceso } };
            }),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        importerror: {
            deleteMany: jest.fn().mockResolvedValue({}),
            count: jest.fn().mockResolvedValue(0),
            createMany: jest.fn().mockImplementation(async ({ data }: any) => { importerrors.push(...data); return {}; }),
            create: jest.fn().mockResolvedValue({}),
        },
    };

    const eventos: Evento[] = [];
    const realtime: any = {
        emitImportIniciada: jest.fn().mockImplementation((estado: EstadoCargaDto) => eventos.push({ evento: 'iniciada', estado })),
        emitImportProgreso: jest.fn().mockImplementation((estado: EstadoCargaDto) => eventos.push({ evento: 'progreso', estado })),
        emitImportFinalizada: jest.fn().mockImplementation((estado: EstadoCargaDto) => eventos.push({ evento: 'finalizada', estado })),
    };
    const notificaciones: any = { crear: jest.fn().mockResolvedValue(undefined) };
    const auditoria: any = { log: jest.fn().mockResolvedValue(undefined) };

    let llamadas = 0;
    const processor: any = {
        category: 'DEUDORES',
        processRow: jest.fn().mockImplementation(async () => {
            llamadas++;
            if (o.filaConError?.(llamadas)) throw new Error(`fila ${llamadas} inválida`);
        }),
        afterAll: jest.fn().mockResolvedValue(undefined),
        ...o.processor,
    };
    (getProcessor as jest.Mock).mockReturnValue(processor);

    const service = new ImportService(prisma, {} as any, {} as any, realtime, notificaciones, {} as any, {} as any, {} as any, auditoria);
    const job: any = { id: 'job-1', data: { usuarioId: 3 }, updateProgress: jest.fn().mockResolvedValue(undefined) };

    return {
        service, job, prisma, tx, remesaRow, eventos, realtime, notificaciones, auditoria, processor, importerrors, perillas,
        fila: () => fila,
        /** Lo que hace el botón "Cancelar": el código real de `cancelarCarga`. */
        cancelar: () => service.cancelarCarga(1, USUARIO_QUE_CANCELA),
        /** El pedido llega por OTRO camino (otro proceso): se escribe en la fila sin avisarle al tracker en memoria. */
        pedirDesdeAfuera: () => {
            fila.cancelSolicitadaAt = new Date();
            fila.resumen = { ...(fila.resumen ?? {}), cancelacion: { usuarioId: 9, nombre: 'Ana' } };
        },
    };
}

type H = ReturnType<typeof armar>;
const finalizadas = (h: H) => h.eventos.filter((e) => e.evento === 'finalizada');
const ultimo = (h: H) => h.eventos[h.eventos.length - 1].estado;

let warn: jest.SpyInstance;
beforeAll(() => Logger.overrideLogger(false));
beforeEach(() => {
    process.env.IMPORTS_PROGRESO_INTERVALO_MS = '250';
    warn = jest.spyOn(Logger.prototype, 'warn');
});
afterEach(() => {
    delete process.env.IMPORTS_PROGRESO_INTERVALO_MS;
    jest.restoreAllMocks();
});
afterAll(() => {
    for (const f of archivosTemporales) fs.rmSync(f, { force: true });
});

describe('processImportJob — cancelar (Fase C1)', () => {
    it('FC-1: camino por fila, 2.500 filas, la cancelación se pide durante la fila 1.300: processRow se llamó 1.300 veces, el afterAll no corre', async () => {
        let n = 0;
        let h!: H;
        h = armar({
            filas: 2_500,
            filaConError: (llamada) => llamada % 100 === 0,
            processor: {
                processRow: jest.fn().mockImplementation(async () => {
                    n++;
                    if (n === 1_300) await h.cancelar(); // se pide DURANTE la fila 1.300 (que además es una de las que dan error)
                    if (n % 100 === 0) throw new Error(`fila ${n} inválida`);
                }),
            },
        });

        const r = await h.service.processImportJob(h.job, 1);

        expect(h.processor.processRow).toHaveBeenCalledTimes(1_300);
        expect(r).toMatchObject({ ok: 1_287, err: 13, cancelada: true });
        expect(Object.keys(r).sort()).toEqual(['cancelada', 'err', 'ok', 'total']); // no es `{ total, ok, err }`: no es una carga común
        expect(h.processor.afterAll).not.toHaveBeenCalled();

        expect(finalizadas(h)).toHaveLength(1);
        expect(ultimo(h)).toMatchObject({
            cancelada: true, resultado: 'FALLIDA', estadoProceso: 'FALLIDA', terminal: true, ok: 1_287, err: 13, procesadas: 1_300, canceladaPor: 'Ana',
        });
        expect(h.fila()).toMatchObject({ resultado: 'CANCELADA', fase: 'TERMINADA', ok: 1_287, err: 13, procesadas: 1_300 });
        expect(h.fila().error).toContain('La importación fue cancelada por Ana cuando llevaba 1.300 de 2.500 filas.');
        expect(h.remesaRow).toMatchObject({ estadoProceso: 'FALLIDA', okFilas: 1_287, errFilas: 13 });
        // Los errores de las filas procesadas quedaron guardados, también los del lote cortado a mitad.
        expect(h.importerrors).toHaveLength(13);
        expect(h.importerrors.map((e) => e.rowNumber)).toContain(1_299);
        // Se notificó (tipo error, "Importación cancelada") y se auditó el corte.
        expect(h.notificaciones.crear).toHaveBeenCalledTimes(1);
        expect(h.notificaciones.crear.mock.calls[0][0]).toMatchObject({ tipo: 'IMPORTACION_ERROR', titulo: 'Importación cancelada' });
        expect(h.notificaciones.crear.mock.calls[0][0].payload).toMatchObject({ cancelada: true });
        expect(h.auditoria.log).toHaveBeenCalledTimes(1);
        expect(h.auditoria.log.mock.calls[0][0]).toMatchObject({ tipo: 'IMPORT_FAIL', severidad: 'WARN', resumen: 'Importación cancelada remesa 00001' });
    }, 30_000);

    it('FC-2: camino por lote, tres lotes, se pide durante el segundo: el segundo termina y se persiste, el tercero no se procesa', async () => {
        let lote = 0;
        let h!: H;
        h = armar({
            filas: 2_500,
            processor: {
                processRow: undefined,
                processBatch: jest.fn().mockImplementation(async () => {
                    lote++;
                    if (lote === 2) await h.cancelar();
                    return [];
                }),
            },
        });

        const r = await h.service.processImportJob(h.job, 1);

        expect(h.processor.processBatch).toHaveBeenCalledTimes(2);
        expect(r).toMatchObject({ ok: 2 * IMPORTS_BATCH_SIZE, err: 0, cancelada: true });
        expect(h.fila()).toMatchObject({ resultado: 'CANCELADA', ok: 2 * IMPORTS_BATCH_SIZE, err: 0 });
        expect(ultimo(h)).toMatchObject({ cancelada: true, procesadas: 2 * IMPORTS_BATCH_SIZE });
        expect(h.processor.afterAll).not.toHaveBeenCalled();
        expect(finalizadas(h)).toHaveLength(1);
    }, 30_000);

    it('FC-3: se pide durante el ÚLTIMO lote: las filas quedan todas, el afterAll NO se llama, cancelada con N de N', async () => {
        let lote = 0;
        let h!: H;
        h = armar({
            filas: 2_500,
            processor: {
                processRow: undefined,
                processBatch: jest.fn().mockImplementation(async () => {
                    lote++;
                    if (lote === 3) await h.cancelar();
                    return [];
                }),
            },
        });

        const r = await h.service.processImportJob(h.job, 1);

        expect(h.processor.processBatch).toHaveBeenCalledTimes(3);
        expect(r).toMatchObject({ ok: 2_500, err: 0, cancelada: true });
        expect(h.processor.afterAll).not.toHaveBeenCalled(); // lo peor que puede pasar: ausentes dados por pagados
        expect(h.fila()).toMatchObject({ resultado: 'CANCELADA', ok: 2_500, procesadas: 2_500 });
        expect(h.fila().error).toContain('cuando llevaba 2.500 de 2.500 filas');
        expect(h.fila().error).toContain('el cierre de la carga no corrió');
        expect(finalizadas(h)).toHaveLength(1);
        expect(ultimo(h).cancelada).toBe(true);
        // No pasó por POST_PROCESO.
        expect(h.eventos.some((e) => e.estado.fase === 'POST_PROCESO')).toBe(false);
    }, 30_000);

    it('FC-4: el pedido aparece recién en la compuerta de entrarEnPostProceso (llega por otro proceso): el afterAll no se llama', async () => {
        let h!: H;
        h = armar({ filas: 30 });
        // El pedido se escribe DESPUÉS del último lote y antes de entrar al post-proceso, sin avisarle al tracker en memoria.
        h.job.updateProgress.mockImplementation(async () => {
            if (h.fila().procesadas === 30 && h.fila().cancelSolicitadaAt == null) h.pedirDesdeAfuera();
        });

        const r = await h.service.processImportJob(h.job, 1);

        expect(h.processor.afterAll).not.toHaveBeenCalled();
        expect(r).toMatchObject({ ok: 30, cancelada: true });
        expect(h.fila()).toMatchObject({ resultado: 'CANCELADA', fase: 'TERMINADA' });
        expect(h.eventos.some((e) => e.estado.fase === 'POST_PROCESO')).toBe(false);
        expect(finalizadas(h)).toHaveLength(1);
    });

    it('FC-5: la fila ya tenía cancelSolicitadaAt cuando el worker tomó el job: ningún processRow, startedAt sigue null, ignorado y retomable', async () => {
        const h = armar({
            filas: 100,
            previa: { cancelSolicitadaAt: new Date('2026-10-09T10:05:00Z'), resumen: { ...ORIGEN, cancelacion: { usuarioId: 9, nombre: 'Ana' } } },
        });

        const r = await h.service.processImportJob(h.job, 1);

        expect(r).toEqual({ total: 0, ok: 0, err: 0, ignorado: true });
        expect(h.processor.processRow).not.toHaveBeenCalled();
        expect(h.fila().startedAt).toBeNull();
        expect(h.fila()).toMatchObject({ resultado: 'CANCELADA', fase: 'TERMINADA' });
        expect(h.fila().error).toContain('La importación fue cancelada por Ana antes de empezar.');
        expect(h.remesaRow.estadoProceso).toBe('FALLIDA');
        // Un evento `finalizada`, cancelada, y retomable (nunca arrancó).
        expect(finalizadas(h)).toHaveLength(1);
        expect(finalizadas(h)[0].estado).toMatchObject({ cancelada: true, retomable: true });
        expect(h.eventos.filter((e) => e.evento === 'iniciada')).toHaveLength(0);
        // La pidió otra persona: se le avisa al dueño, y solo al dueño.
        expect(h.notificaciones.crear).toHaveBeenCalledTimes(1);
        expect(h.notificaciones.crear.mock.calls[0][0].incluirUsuariosConPermiso).toBeUndefined();
        expect(h.notificaciones.crear.mock.calls[0][0].destinatarioPrincipalId).toBe(3);
    });

    it('FC-6: se pide durante LEYENDO (categoría pre-parseada): ningún processRow, sinFilasEntregadas y retomable', async () => {
        let h!: H;
        h = armar({
            remesa: { categoria: 'MULTIRREGISTRO', totalFilas: 3 },
            plantilla: { mappingJson: { columns: {}, multirregistro: { tipoLinea: {} } } },
        });
        (parseMultirregistro as jest.Mock).mockImplementation(() => {
            // La lectura es síncrona: el pedido llega "durante" ella.
            h.pedirDesdeAfuera();
            (h.service as any).cargasVivas.get(1)?.avisarCancelacion();
            return {
                filas: [{ nroCliente: '1' }, { nroCliente: '2' }, { nroCliente: '3' }],
                advertencias: [],
                resumen: { lineas: 3, porTipo: {}, casos: 3, facturas: 0, bajas: 0, ignoradas: 0 },
            };
        });

        const r = await h.service.processImportJob(h.job, 1);

        expect(r).toMatchObject({ ok: 0, err: 0, cancelada: true });
        expect(h.processor.processRow).not.toHaveBeenCalled();
        expect(h.fila().resumen).toMatchObject({ sinFilasEntregadas: true, cancelacion: { nombre: 'Ana' }, origen: ORIGEN.origen });
        expect(ultimo(h)).toMatchObject({ cancelada: true, retomable: true });
        expect(h.fila().error).toContain('No se cargó ninguna fila. Para cargarla, usá «Retomar»');
        expect(h.processor.afterAll).not.toHaveBeenCalled();
    });

    it('FC-11: cancelada y la notificación o la auditoría tiran: el estado terminal queda, no hay segunda finalizada y no rechaza', async () => {
        let n = 0;
        let h!: H;
        h = armar({
            filas: 50,
            processor: {
                processRow: jest.fn().mockImplementation(async () => {
                    n++;
                    if (n === 10) await h.cancelar();
                }),
            },
        });
        h.notificaciones.crear.mockRejectedValue(new Error('no entra en la columna'));
        h.auditoria.log.mockRejectedValue(new Error('auditoría caída'));

        await expect(h.service.processImportJob(h.job, 1)).resolves.toMatchObject({ cancelada: true, ok: 10 });

        expect(h.remesaRow.estadoProceso).toBe('FALLIDA');
        expect(h.fila().resultado).toBe('CANCELADA');
        expect(finalizadas(h)).toHaveLength(1);
        expect(h.notificaciones.crear).toHaveBeenCalledTimes(1);
        expect(h.auditoria.log).toHaveBeenCalledTimes(1);
    });

    it('FC-16: un processor SIN afterAll con la cancelación pedida en el último lote: cancelada con N de N (el corte previo al cierre no depende del afterAll)', async () => {
        let lote = 0;
        let h!: H;
        h = armar({
            filas: 1_500,
            processor: {
                processRow: undefined,
                afterAll: undefined,
                processBatch: jest.fn().mockImplementation(async () => {
                    lote++;
                    if (lote === 2) await h.cancelar();
                    return [];
                }),
            },
        });

        const r = await h.service.processImportJob(h.job, 1);

        expect(r).toMatchObject({ ok: 1_500, cancelada: true });
        expect(h.fila()).toMatchObject({ resultado: 'CANCELADA', procesadas: 1_500 });
        expect(h.remesaRow.estadoProceso).toBe('FALLIDA'); // no FINALIZADA
        expect(h.notificaciones.crear.mock.calls[0][0].titulo).toBe('Importación cancelada');
    }, 30_000);

    it('una cancelación cuyo cierre llega tarde (la carga ya cerrada por otro) no se notifica ni se audita', async () => {
        let h!: H;
        h = armar({
            filas: 20,
            processor: {
                processRow: jest.fn().mockImplementation(async () => {
                    await h.cancelar();
                    // Otro proceso (el reaper) cierra la carga antes de que el runner corte.
                    Object.assign(h.fila(), { fase: 'TERMINADA', resultado: 'FALLIDA', finishedAt: new Date() });
                    h.remesaRow.estadoProceso = 'FALLIDA';
                }),
            },
        });

        await expect(h.service.processImportJob(h.job, 1)).resolves.toMatchObject({ ignorado: true });

        expect(h.notificaciones.crear).not.toHaveBeenCalled();
        expect(h.auditoria.log).not.toHaveBeenCalled();
        expect(h.fila().resultado).toBe('FALLIDA'); // el cierre del otro no se pisa
        expect(finalizadas(h)).toHaveLength(0);
    });
});

describe('processImportJob — el marcador de "no entregó ninguna fila" (Fase C1)', () => {
    it('FC-7: la plantilla no tiene estado inicial (falla antes de la primera fila): FALLIDA con sinFilasEntregadas y retomable', async () => {
        const h = armar({ filas: 10, plantilla: { defaultEstadoSituacionId: null } });

        await expect(h.service.processImportJob(h.job, 1)).rejects.toBeInstanceOf(BadRequestException);

        expect(h.processor.processRow).not.toHaveBeenCalled();
        expect(h.fila().resumen).toEqual({ ...ORIGEN, sinFilasEntregadas: true });
        expect(h.fila().resultado).toBe('FALLIDA');
        expect(finalizadas(h)).toHaveLength(1);
        expect(ultimo(h)).toMatchObject({ retomable: true, cancelada: false });
    });

    it('FC-8: falla DESPUÉS de procesar filas (importerror.createMany rechaza en el segundo lote): FALLIDA sin el marcador, no retomable', async () => {
        const h = armar({ filas: 2_500, filaConError: (n) => n % 500 === 0 });
        let llamadas = 0;
        h.prisma.importerror.createMany.mockImplementation(async ({ data }: any) => {
            llamadas++;
            if (llamadas === 2) throw new Error('la tabla importerror no responde');
            h.importerrors.push(...data);
            return {};
        });

        await expect(h.service.processImportJob(h.job, 1)).rejects.toThrow('la tabla importerror no responde');

        expect(h.processor.processRow).toHaveBeenCalled();
        expect(h.fila().resumen).toEqual(ORIGEN); // el marcador NO está
        expect(h.fila().resumen.sinFilasEntregadas).toBeUndefined();
        expect(ultimo(h)).toMatchObject({ retomable: false, resultado: 'FALLIDA' });
    }, 30_000);

    it('FC-9: todas las filas del primer lote fallan la validación y después algo tira: sinFilasEntregadas (ningún processor fue llamado), aunque err > 0', async () => {
        const h = armar({ filas: 10, processor: { validateRow: jest.fn().mockReturnValue({ valid: false, error: 'sin documento' }) } });
        h.prisma.importerror.createMany.mockRejectedValue(new Error('importerror caída'));

        await expect(h.service.processImportJob(h.job, 1)).rejects.toThrow('importerror caída');

        expect(h.processor.processRow).not.toHaveBeenCalled();
        expect(h.fila().resumen).toMatchObject({ sinFilasEntregadas: true });
        expect(ultimo(h)).toMatchObject({ retomable: true });
    });

    it('FC-10: el processor por lote tira en el primer lote (y después algo falla): SIN marcador, porque fue llamado', async () => {
        const h = armar({
            filas: 10,
            processor: { processRow: undefined, processBatch: jest.fn().mockRejectedValue(new Error('boom del lote')) },
        });
        h.prisma.importerror.createMany.mockRejectedValue(new Error('importerror caída'));

        await expect(h.service.processImportJob(h.job, 1)).rejects.toThrow('importerror caída');

        expect(h.processor.processBatch).toHaveBeenCalledTimes(1);
        expect(h.fila().resumen.sinFilasEntregadas).toBeUndefined();
        expect(ultimo(h).retomable).toBe(false);
    });

    it('FC-14: la escritura de POST_PROCESO falla por un error que no es de cierre y la lectura simple devuelve el pedido: el afterAll NO se llama', async () => {
        let h!: H;
        h = armar({ filas: 30 });
        // Después del último lote el SELECT de la compuerta cae UNA vez (no es un cierre), y el pedido ya está en la fila.
        h.job.updateProgress.mockImplementation(async () => {
            if (h.fila().procesadas === 30 && h.fila().cancelSolicitadaAt == null) {
                h.pedirDesdeAfuera();
                h.perillas.fallarSelectProximos = 1;
            }
        });

        const r = await h.service.processImportJob(h.job, 1);

        expect(h.processor.afterAll).not.toHaveBeenCalled();
        expect(r).toMatchObject({ ok: 30, cancelada: true });
        expect(h.fila().resultado).toBe('CANCELADA');
        expect(warn.mock.calls.some(([m]) => String(m).includes('No se pudo registrar la fase POST_PROCESO'))).toBe(true);
    });

    it.each(['VACIO', 'FALLA'] as const)(
        'FC-15 (%s): lo mismo, y la lectura simple también falla o devuelve vacío: el afterAll CORRE, como hoy (una etiqueta no frena la consolidación)',
        async (lectura) => {
            let h!: H;
            h = armar({ filas: 30 });
            h.perillas.lecturaSimple = lectura;
            let armado = false;
            h.job.updateProgress.mockImplementation(async () => {
                if (!armado && h.fila().procesadas === 30) {
                    armado = true;
                    h.perillas.fallarSelectProximos = 1;
                    h.fila().cancelSolicitadaAt = new Date(); // el pedido existe en la base, pero la lectura simple no lo ve
                }
            });

            const r = await h.service.processImportJob(h.job, 1);

            expect(h.processor.afterAll).toHaveBeenCalledTimes(1);
            // Nada se decidió con un vacío: la carga terminó.
            expect(r).toEqual({ total: 30, ok: 30, err: 0 });
        },
    );
});

describe('processImportJob — el camino normal no cambia (Fase C1)', () => {
    it('FC-12: una remesa retomada (en cola, startedAt null, intentos 0, rev 40) corre normal: iniciada, progreso, finalizada; intentos 1; rev > 40; ningún warn de re-ejecución', async () => {
        const h = armar({ filas: 30, previa: { rev: 40, intentos: 0, startedAt: null, resumen: { ...ORIGEN, retomas: 1 } } });

        await expect(h.service.processImportJob(h.job, 1)).resolves.toEqual({ total: 30, ok: 30, err: 0 });

        expect(h.eventos[0].evento).toBe('iniciada');
        expect(h.eventos[h.eventos.length - 1].evento).toBe('finalizada');
        expect(h.fila().intentos).toBe(1);
        expect(h.fila().rev).toBeGreaterThan(40);
        expect(warn.mock.calls.some(([m]) => /Re-ejecución|re-entregado/i.test(String(m)))).toBe(false);
        expect(ultimo(h)).toMatchObject({ resultado: 'OK', cancelada: false, retomable: false });
        // El `retomas` que dejó retomar sigue en el resumen: el runner no lo pisa.
        expect(h.fila().resumen.retomas).toBe(1);
    });

    it('FC-13: 2.500 filas sin ninguna cancelación emiten la secuencia del caso B-1 y devuelven exactamente { total, ok, err }', async () => {
        const B = IMPORTS_BATCH_SIZE;
        const N = Math.floor(B * 2.5);
        const h = armar({ filas: N });

        const r = await h.service.processImportJob(h.job, 1);

        expect(r).toEqual({ total: N, ok: N, err: 0 });
        expect(h.eventos.map((e) => [e.evento, e.estado.fase, e.estado.progreso])).toEqual([
            ['iniciada', 'PROCESANDO', 0],
            ['progreso', 'PROCESANDO', Math.floor((B * 100) / N)],
            ['progreso', 'PROCESANDO', Math.floor((2 * B * 100) / N)],
            ['progreso', 'PROCESANDO', 99],
            ['progreso', 'POST_PROCESO', 99],
            ['finalizada', 'TERMINADA', 100],
        ]);
        expect(h.processor.afterAll).toHaveBeenCalledTimes(1);
        expect(ultimo(h)).toMatchObject({ resultado: 'OK', cancelada: false, cancelacionPedidaAt: null });
        // Una carga común no lleva el marcador ni nada de la cancelación en su resumen.
        expect(h.fila().resumen).toEqual(ORIGEN);
        expect(h.notificaciones.crear.mock.calls[0][0].payload.cancelada).toBeUndefined();
    }, 30_000);

    it('una cancelación pedida tarde (cuando la carga ya cerraba y no tenía afterAll) no la cancela: termina OK y el pedido queda registrado', async () => {
        let h!: H;
        h = armar({ filas: 20, processor: { afterAll: undefined } });
        h.job.updateProgress.mockImplementation(async () => {
            // Llega después del último lote: sin afterAll no hay compuerta de post-proceso que la lea.
            if (h.fila().procesadas === 20 && h.fila().cancelSolicitadaAt == null) h.pedirDesdeAfuera();
        });

        await expect(h.service.processImportJob(h.job, 1)).resolves.toEqual({ total: 20, ok: 20, err: 0 });

        expect(h.fila().resultado).toBe('OK');
        expect(ultimo(h)).toMatchObject({ cancelada: false, resultado: 'OK' });
        expect(ultimo(h).cancelacionPedidaAt).not.toBeNull();
    });
});

describe('processImportJob — la fila manda sobre el job (hallazgo 1)', () => {
    const origenVisto = (h: H) => (h.processor.processRow as jest.Mock).mock.calls.map(([, ctx]) => [ctx.remesaOrigenId, ctx.remesaOrigenIds]);

    it('un job que entra tarde con el origen del primer intento procesa con el origen de la fila, y avisa', async () => {
        const h = armar({ filas: 3, previa: { resumen: { v: 1, origen: { remesaOrigenId: 22, remesaOrigenIds: null } } } });

        // El job trae el origen viejo (11); la fila, el nuevo (22).
        await expect(h.service.processImportJob(h.job, 1, 11, [11])).resolves.toEqual({ total: 3, ok: 3, err: 0 });

        expect(origenVisto(h)).toEqual([[22, undefined], [22, undefined], [22, undefined]]);
        expect(warn.mock.calls.some(([m]) => String(m).includes('el job trae otra remesa de origen') && String(m).includes('se usa la de la fila'))).toBe(true);
    });

    it('con varias remesas de origen en la fila, usa las de la fila', async () => {
        const h = armar({ filas: 1, previa: { resumen: { v: 1, origen: { remesaOrigenId: null, remesaOrigenIds: [5, 6] } } } });
        await h.service.processImportJob(h.job, 1, 99, undefined);
        expect(origenVisto(h)).toEqual([[undefined, [5, 6]]]);
    });

    it('si coinciden no avisa; si la fila dice "sin origen" no se usa el del job', async () => {
        const igual = armar({ filas: 1, previa: { resumen: { v: 1, origen: { remesaOrigenId: 11, remesaOrigenIds: null } } } });
        await igual.service.processImportJob(igual.job, 1, 11, undefined);
        expect(origenVisto(igual)).toEqual([[11, undefined]]);
        expect(warn.mock.calls.some(([m]) => String(m).includes('el job trae otra remesa de origen'))).toBe(false);

        const sin = armar({ filas: 1, previa: { resumen: { v: 1, origen: { remesaOrigenId: null, remesaOrigenIds: null } } } });
        await sin.service.processImportJob(sin.job, 1, 11, [11]);
        expect(origenVisto(sin)).toEqual([[undefined, undefined]]);
    });

    it('una carga anterior a C1 (la fila no tiene resumen.origen) usa el del job', async () => {
        for (const resumen of [null, { v: 1 }]) {
            const h = armar({ filas: 1, previa: { resumen } });
            await h.service.processImportJob(h.job, 1, 11, [11, 12]);
            expect(origenVisto(h)).toEqual([[11, [11, 12]]]);
        }
    });
});

describe('processImportJob — cancelar mientras lee (hallazgo 3)', () => {
    /** El pedido HTTP estaba esperando en la cola de eventos mientras la lectura síncrona bloqueaba: se atiende durante la pausa. */
    const pedirDuranteLaLectura = (h: H, aLos = 120) => setTimeout(() => h.pedirDesdeAfuera(), aLos);

    it('Excel: el pedido que llega durante la lectura corta antes de la primera fila: 0 filas, sinFilasEntregadas y retomable', async () => {
        const h = armar({ excel: true, filas: 50 });
        pedirDuranteLaLectura(h);

        const r = await h.service.processImportJob(h.job, 1);

        expect(r).toMatchObject({ ok: 0, err: 0, cancelada: true });
        expect(h.processor.processRow).not.toHaveBeenCalled();
        expect(h.processor.afterAll).not.toHaveBeenCalled();
        expect(h.fila().resumen).toMatchObject({ sinFilasEntregadas: true, origen: ORIGEN.origen });
        expect(ultimo(h)).toMatchObject({ cancelada: true, retomable: true, procesadas: 0 });
        expect(h.fila().error).toContain('No se cargó ninguna fila. Para cargarla, usá «Retomar»');
    });

    it('Excel con el pedido avisado en memoria (cancelarCarga ya commiteó): también corta', async () => {
        const h = armar({ excel: true, filas: 50 });
        setTimeout(() => { void h.cancelar(); }, 120);
        const r = await h.service.processImportJob(h.job, 1);
        expect(r).toMatchObject({ ok: 0, cancelada: true });
        expect(h.processor.processRow).not.toHaveBeenCalled();
    });

    it('categoría pre-parseada: lo mismo, y el reloj no emite nada durante la espera', async () => {
        (parseMultirregistro as jest.Mock).mockReturnValue({
            filas: [{ nroCliente: '1' }, { nroCliente: '2' }],
            advertencias: ['aviso de parseo'],
            resumen: { lineas: 2, porTipo: {}, casos: 2, facturas: 0, bajas: 0, ignoradas: 0 },
        });
        const h = armar({
            remesa: { categoria: 'MULTIRREGISTRO', totalFilas: 2 },
            plantilla: { mappingJson: { columns: {}, multirregistro: { tipoLinea: {} } } },
        });
        pedirDuranteLaLectura(h);

        const r = await h.service.processImportJob(h.job, 1);

        expect(r).toMatchObject({ ok: 0, err: 0, cancelada: true });
        expect(h.processor.processRow).not.toHaveBeenCalled();
        expect(h.fila().resumen).toMatchObject({ sinFilasEntregadas: true });
        // Una sola emisión de LEYENDO (la de entrar en lectura): la pausa va antes de dejar nada pendiente de volcar.
        expect(h.eventos.filter((e) => e.evento === 'progreso' && e.estado.fase === 'LEYENDO')).toHaveLength(1);
    });

    it('Excel sin pedido: espera la pausa y procesa normal; si la relectura falla, la carga sigue', async () => {
        const h = armar({ excel: true, filas: 5 });
        const t0 = Date.now();
        await expect(h.service.processImportJob(h.job, 1)).resolves.toEqual({ total: 5, ok: 5, err: 0 });
        expect(Date.now() - t0).toBeGreaterThanOrEqual(280);

        const roto = armar({ excel: true, filas: 5 });
        roto.perillas.lecturaSimple = 'FALLA';
        await expect(roto.service.processImportJob(roto.job, 1)).resolves.toEqual({ total: 5, ok: 5, err: 0 });
        expect(warn.mock.calls.some(([m]) => String(m).includes('No se pudo releer la cancelación'))).toBe(true);
    });

    it('un CSV no tiene esa fase: no espera ni relee el pedido', async () => {
        const h = armar({ filas: 5 });
        const t0 = Date.now();
        await h.service.processImportJob(h.job, 1);
        expect(h.prisma.import_progreso.findUnique).not.toHaveBeenCalled();
        expect(Date.now() - t0).toBeLessThan(250);
    });
});
