/**
 * El runner (`processImportJob`) ante el cierre ordenado del servidor (docs/imports-progreso-c3-spec.md §19.4.2, §19.10.1):
 * una carga cortada por `SIGTERM` queda FALLIDA con `resumen.interrupcion`, con números exactos, sin cierre de carga,
 * sin escribir `cancelSolicitadaAt` y retomable solo si no entregó filas.
 *
 * Mismo arnés que `imports-progreso-fase-c1.spec.ts` (copiado: no se tocan los otros specs).
 */
import { Logger } from '@nestjs/common';
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


const TEXTO_FILA = 'La importación se interrumpió por un reinicio del servidor cuando llevaba';

describe('processImportJob — el cierre ordenado del servidor (C3c)', () => {
    it('por fila: el corte pedido durante la fila 37 deja ok + err = 37, FALLIDA con la marca, sin afterAll ni cancelSolicitadaAt', async () => {
        let n = 0;
        let h!: H;
        h = armar({
            filas: 100,
            processor: {
                processRow: jest.fn().mockImplementation(async () => {
                    n++;
                    if (n === 37) h.service.cortarPorCierre();
                    if (n % 10 === 0) throw new Error(`fila ${n} inválida`);
                }),
            },
        });

        const r = await h.service.processImportJob(h.job, 1);

        expect(h.processor.processRow).toHaveBeenCalledTimes(37);
        expect(r).toEqual({ total: 100, ok: 34, err: 3, interrumpida: true });
        expect(h.processor.afterAll).not.toHaveBeenCalled();
        expect(finalizadas(h)).toHaveLength(1);
        expect(ultimo(h)).toMatchObject({
            interrumpidaPorReinicio: true, cancelada: false, resultado: 'FALLIDA', estadoProceso: 'FALLIDA', terminal: true,
            ok: 34, err: 3, procesadas: 37,
        });
        expect(h.fila()).toMatchObject({ resultado: 'FALLIDA', fase: 'TERMINADA', ok: 34, err: 3, procesadas: 37, cancelSolicitadaAt: null });
        expect(h.fila().resumen).toMatchObject({ interrupcion: { motivo: 'REINICIO' }, origen: ORIGEN.origen });
        expect(h.fila().resumen.cancelacion).toBeUndefined();
        expect(h.fila().error).toContain(`${TEXTO_FILA} 37 de 100 filas.`);
        expect(h.fila().error).toContain('eliminá esta importación desde el Historial');
        expect(h.remesaRow).toMatchObject({ estadoProceso: 'FALLIDA', okFilas: 34, errFilas: 3 });
        expect(h.importerrors).toHaveLength(3);
        expect(h.notificaciones.crear).toHaveBeenCalledTimes(1);
        expect(h.notificaciones.crear.mock.calls[0][0]).toMatchObject({ tipo: 'IMPORTACION_ERROR', titulo: 'Importación interrumpida por un reinicio' });
        expect(h.notificaciones.crear.mock.calls[0][0].payload).toMatchObject({ interrumpidaPorReinicio: true });
        expect(h.auditoria.log).toHaveBeenCalledTimes(1);
        expect(h.auditoria.log.mock.calls[0][0]).toMatchObject({
            tipo: 'IMPORT_FAIL', severidad: 'WARN', resumen: 'Importación interrumpida por un reinicio del servidor remesa 00001',
        });
        // No es una falla ni una cancelación: el log es un warn propio.
        expect(warn.mock.calls.some((c) => String(c[0]).includes('interrumpida por el cierre del servidor con ok=34 err=3'))).toBe(true);
    }, 30_000);

    it('por lote: pedido durante el lote 2 de 3: el lote 2 queda persistido y el 3 no se procesa', async () => {
        let lote = 0;
        let h!: H;
        h = armar({
            filas: 2_500,
            processor: {
                processRow: undefined,
                processBatch: jest.fn().mockImplementation(async () => {
                    lote++;
                    if (lote === 2) h.service.cortarPorCierre();
                    return [];
                }),
            },
        });

        const r = await h.service.processImportJob(h.job, 1);

        expect(h.processor.processBatch).toHaveBeenCalledTimes(2);
        expect(r).toMatchObject({ ok: 2 * IMPORTS_BATCH_SIZE, err: 0, interrumpida: true });
        expect(h.fila()).toMatchObject({ resultado: 'FALLIDA', ok: 2 * IMPORTS_BATCH_SIZE, procesadas: 2 * IMPORTS_BATCH_SIZE });
        expect(ultimo(h)).toMatchObject({ interrumpidaPorReinicio: true, procesadas: 2 * IMPORTS_BATCH_SIZE });
        expect(h.processor.afterAll).not.toHaveBeenCalled();
    }, 30_000);

    it('en el último lote: el afterAll no corre y el texto dice N de N', async () => {
        let lote = 0;
        let h!: H;
        h = armar({
            filas: 2_500,
            processor: {
                processRow: undefined,
                processBatch: jest.fn().mockImplementation(async () => {
                    lote++;
                    if (lote === 3) h.service.cortarPorCierre();
                    return [];
                }),
            },
        });

        const r = await h.service.processImportJob(h.job, 1);

        expect(r).toMatchObject({ ok: 2_500, interrumpida: true });
        expect(h.processor.afterAll).not.toHaveBeenCalled();
        expect(h.fila().error).toContain(`${TEXTO_FILA} 2.500 de 2.500 filas.`);
        expect(h.eventos.some((e) => e.estado.fase === 'POST_PROCESO')).toBe(false);
    }, 30_000);

    it('durante el afterAll: termina y la carga queda FINALIZADA, sin marca', async () => {
        let h!: H;
        h = armar({
            filas: 20,
            processor: { afterAll: jest.fn().mockImplementation(async () => { h.service.cortarPorCierre(); }) },
        });

        const r = await h.service.processImportJob(h.job, 1);

        expect(h.processor.afterAll).toHaveBeenCalledTimes(1);
        expect(r).toEqual({ total: 20, ok: 20, err: 0 });
        expect(ultimo(h)).toMatchObject({ estadoProceso: 'FINALIZADA', interrumpidaPorReinicio: false });
        expect(h.fila().resumen.interrupcion).toBeUndefined();
    });

    it('durante la lectura (Excel): corta antes de la primera fila, con sinFilasEntregadas y retomable', async () => {
        const h = armar({ excel: true, filas: 50 });
        setTimeout(() => h.service.cortarPorCierre(), 120);

        const r = await h.service.processImportJob(h.job, 1);

        expect(r).toMatchObject({ ok: 0, err: 0, interrumpida: true });
        expect(h.processor.processRow).not.toHaveBeenCalled();
        expect(h.processor.afterAll).not.toHaveBeenCalled();
        expect(h.fila().resumen).toMatchObject({ sinFilasEntregadas: true, interrupcion: { motivo: 'REINICIO' } });
        expect(ultimo(h)).toMatchObject({ interrumpidaPorReinicio: true, retomable: true, procesadas: 0 });
        expect(h.fila().error).toContain(`${TEXTO_FILA} 0 de 50 filas.`);
        expect(h.fila().error).toContain('«Retomar»');
    });

    it('una carga que arranca con el corte ya pedido corta antes de la primera fila y es retomable', async () => {
        const h = armar({ filas: 30 });
        h.service.cortarPorCierre();

        const r = await h.service.processImportJob(h.job, 1);

        expect(r).toMatchObject({ ok: 0, err: 0, interrumpida: true });
        expect(h.processor.processRow).not.toHaveBeenCalled();
        expect(ultimo(h)).toMatchObject({ interrumpidaPorReinicio: true, retomable: true });
    });

    it('corte por cierre y cancelación del usuario a la vez: queda CANCELADA', async () => {
        let n = 0;
        let h!: H;
        h = armar({
            filas: 50,
            processor: {
                processRow: jest.fn().mockImplementation(async () => {
                    n++;
                    if (n === 5) {
                        h.service.cortarPorCierre();
                        await h.cancelar();
                    }
                }),
            },
        });

        const r = await h.service.processImportJob(h.job, 1);

        expect(r).toMatchObject({ ok: 5, cancelada: true });
        expect(r).not.toHaveProperty('interrumpida');
        expect(h.fila()).toMatchObject({ resultado: 'CANCELADA' });
        expect(ultimo(h)).toMatchObject({ cancelada: true, interrumpidaPorReinicio: false });
        expect(h.fila().resumen.interrupcion).toBeUndefined();
    });

    it('ACCIONES: corta entre filas y el texto manda a Revertir', async () => {
        let n = 0;
        let h!: H;
        h = armar({
            filas: 40,
            remesa: { categoria: 'ACCIONES' },
            processor: {
                category: 'ACCIONES',
                processRow: jest.fn().mockImplementation(async () => {
                    n++;
                    if (n === 12) h.service.cortarPorCierre();
                }),
            },
        });

        const r = await h.service.processImportJob(h.job, 1);

        expect(r).toMatchObject({ ok: 12, err: 0, interrumpida: true });
        expect(h.fila().error).toContain(`${TEXTO_FILA} 12 de 40 filas.`);
        expect(h.fila().error).toContain('Revertir');
        expect(h.fila().error).toContain('No vuelvas a cargar el archivo');
    });

    it('cortarPorCierre y trabajosEnCurso: sin cargas vivas no hay líneas; con una, la nombra', async () => {
        let h!: H;
        let lineas: string[] = [];
        h = armar({
            filas: 5,
            processor: {
                processRow: jest.fn().mockImplementation(async () => {
                    lineas = h.service.trabajosEnCurso();
                }),
            },
        });
        expect(h.service.trabajosEnCurso()).toEqual([]);
        await h.service.processImportJob(h.job, 1);
        expect(lineas).toHaveLength(1);
        expect(lineas[0]).toMatch(/^carga remesa=1 DEUDORES .* PROCESANDO/);
        expect(h.service.trabajosEnCurso()).toEqual([]); // el finally la saca
    });
});
