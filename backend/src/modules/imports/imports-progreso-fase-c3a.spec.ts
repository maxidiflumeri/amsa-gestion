/**
 * El runner (`processImportJob`) de la Fase C, entrega 3a (docs/imports-progreso-c3-spec.md §5.1, §5.4 y §5.6; CA-3, CA-4, CA-6):
 * el canal `resumen`, la fila del archivo en `importerror.linea` y el conteo de avisos con la definición única.
 *
 * Mismo arnés que el de la entrega C1 (copiado, no importado, para no tocar ese spec): `ImportService` real, `prisma` falso que
 * serializa las transacciones y devuelve la fila actual en el `SELECT … FOR UPDATE`.
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
    const archivo = path.join(os.tmpdir(), `amsa-c3a-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.${o.excel ? 'xlsx' : 'csv'}`);
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

describe('processImportJob — el resumen por categoría (C3a, A1)', () => {
    it('CA-3: 100 filas con 3 identidades repetidas terminan con resumenCategoria casosNuevos 97, en el DTO, en el evento y en la fila', async () => {
        const h = armar({
            filas: 100,
        });
        // La fila k crea un caso salvo las tres últimas, que repiten la identidad de otras: 97 casos nuevos.
        let n = 0;
        h.processor.processRow.mockImplementation(async (_row: unknown, ctx: any) => {
            n++;
            ctx.progreso.resumen({ tipo: 'DEUDORES', casosNuevos: Math.min(n, 97), contactosCopiados: 0 });
        });

        await h.service.processImportJob(h.job, 1);

        const esperado = { tipo: 'DEUDORES', casosNuevos: 97, contactosCopiados: 0 };
        expect(ultimo(h).resumenCategoria).toEqual(esperado);
        expect(finalizadas(h)[0].estado.resumenCategoria).toEqual(esperado);
        expect(h.fila().resumen).toEqual({ ...ORIGEN, categoria: { v: 1, ...esperado } });
        // Mientras corría, ningún evento de progreso lo adelantó.
        expect(h.eventos.filter((e) => e.evento !== 'finalizada').every((e) => e.estado.resumenCategoria === null)).toBe(true);
    }, 30_000);

    it('un processor que no informa nada (los specs viejos) termina con resumenCategoria null y sin tocar la clave resumen', async () => {
        const h = armar({ filas: 5 });
        await h.service.processImportJob(h.job, 1);
        expect(ultimo(h).resumenCategoria).toBeNull();
        expect(h.fila().resumen).toEqual(ORIGEN);
    });

    it('un reporte que tira (el tracker rechaza un objeto raro) no cambia el resultado de la carga', async () => {
        const h = armar({
            filas: 5,
            processor: { processRow: jest.fn().mockImplementation(async (_row: unknown, ctx: any) => ctx.progreso.resumen(undefined)) },
        });
        const r = await h.service.processImportJob(h.job, 1);
        expect(r).toEqual({ total: 5, ok: 5, err: 0 });
        expect(ultimo(h)).toMatchObject({ resultado: 'OK', resumenCategoria: null });
    });

    it('CA-4: una carga cancelada a mitad guarda lo hecho hasta el corte y conserva origen y cancelacion', async () => {
        let n = 0;
        let h!: H;
        h = armar({
            filas: 2_500,
            processor: {
                processRow: jest.fn().mockImplementation(async (_row: unknown, ctx: any) => {
                    n++;
                    ctx.progreso.resumen({ tipo: 'DEUDORES', casosNuevos: n, contactosCopiados: 0 });
                    if (n === 1_300) await h.cancelar();
                }),
            },
        });

        const r = await h.service.processImportJob(h.job, 1);

        expect(r).toMatchObject({ cancelada: true });
        expect(h.fila().resumen).toEqual({
            ...ORIGEN,
            cancelacion: { usuarioId: 9, nombre: 'Ana' },
            categoria: { v: 1, tipo: 'DEUDORES', casosNuevos: 1_300, contactosCopiados: 0 },
        });
        expect(ultimo(h)).toMatchObject({ cancelada: true, resumenCategoria: { tipo: 'DEUDORES', casosNuevos: 1_300 } });
    }, 30_000);
});

describe('processImportJob — la fila del archivo en importerror.linea (C3a, A2)', () => {
    it('CA-6: camino por fila, CSV con encabezado: el error de la fila 9 de datos (línea 10 del archivo) lleva linea 10 y rowNumber 8', async () => {
        const h = armar({ filas: 12, filaConError: (n) => n === 9 });
        await h.service.processImportJob(h.job, 1);
        expect(h.importerrors).toHaveLength(1);
        expect(h.importerrors[0]).toMatchObject({ rowNumber: 8, linea: 10, errorMsg: 'fila 9 inválida' });
    });

    it('camino por fila sin encabezado: la primera fila es la línea 1', async () => {
        const h = armar({ filas: 6, plantilla: { tieneHeader: false }, filaConError: (n) => n === 1 || n === 4 });
        await h.service.processImportJob(h.job, 1);
        expect(h.importerrors.map((e) => [e.rowNumber, e.linea])).toEqual([[0, 1], [3, 4]]);
    });

    it('camino por lote: los fallos que devuelve processBatch llevan la línea de su fila', async () => {
        const h = armar({
            filas: 8,
            processor: {
                processRow: undefined,
                processBatch: jest.fn().mockImplementation(async (rows: Array<{ idx: number }>) => [{ idx: rows[4].idx, error: 'monto inválido' }]),
            },
        });
        await h.service.processImportJob(h.job, 1);
        expect(h.importerrors).toHaveLength(1);
        expect(h.importerrors[0]).toMatchObject({ rowNumber: 4, linea: 6, errorMsg: 'monto inválido' });
    });

    it('un processBatch que tira reporta todas las filas del lote, cada una con su línea', async () => {
        const h = armar({
            filas: 3,
            processor: { processRow: undefined, processBatch: jest.fn().mockRejectedValue(new Error('se cayó el lote')) },
        });
        await h.service.processImportJob(h.job, 1);
        expect(h.importerrors.map((e) => [e.rowNumber, e.linea])).toEqual([[0, 2], [1, 3], [2, 4]]);
    });

    it('Excel con el encabezado en la fila 1: el error de la 8ª fila de la hoja lleva linea 8', async () => {
        const h = armar({ filas: 10, excel: true, filaConError: (n) => n === 7 });
        await h.service.processImportJob(h.job, 1);
        expect(h.importerrors).toHaveLength(1);
        expect(h.importerrors[0]).toMatchObject({ rowNumber: 6, linea: 8 });
    });

    it('una categoría preparseada (MULTIRREGISTRO) no afirma la fila del archivo: linea null', async () => {
        const h = armar({
            remesa: { categoria: 'MULTIRREGISTRO', totalFilas: 2 },
            plantilla: { mappingJson: { columns: {}, multirregistro: { tipoLinea: {} } } },
            filaConError: (n) => n === 2,
        });
        (parseMultirregistro as jest.Mock).mockReturnValue({
            filas: [{ nroCliente: '1' }, { nroCliente: '2' }],
            advertencias: [],
            resumen: { lineas: 2, porTipo: {}, casos: 2, facturas: 0, bajas: 0, ignoradas: 0 },
        });
        await h.service.processImportJob(h.job, 1);
        expect(h.importerrors).toHaveLength(1);
        expect(h.importerrors[0]).toMatchObject({ rowNumber: 1, linea: null });
    });
});

describe('processImportJob — una sola definición de aviso (C3a, A4)', () => {
    it('el conteo de avisos del cierre usa exactamente el where de hoy', async () => {
        const h = armar({ filas: 3 });
        await h.service.processImportJob(h.job, 1);
        expect(h.prisma.importerror.count).toHaveBeenCalledWith({
            where: {
                remesaId: 1,
                rowNumber: 0,
                OR: [
                    { errorMsg: { startsWith: '[aviso]' } },
                    { errorMsg: { startsWith: '[parseo]' } },
                    { errorMsg: { startsWith: '[post-proceso]' } },
                ],
            },
        });
    });
});
