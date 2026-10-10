/**
 * Carga dividida, cancelar, retomar y cortes ya cargados (docs/imports-progreso-realtime-spec.md §10.5.1, §10.5.2, §10.5.3, §10.5.4 y
 * §10.5.6; casos G-1 a G-27 de §10.9.2 D).
 *
 * `ImportService` real sobre una "base" en memoria que se porta como MySQL + Prisma en lo que el diseño apoya:
 *   - las transacciones se SERIALIZAN (el lock de las filas), con cesiones al event loop adentro;
 *   - el `SELECT … FOR UPDATE` devuelve las filas ACTUALES;
 *   - un `update` por id de una fila que no existe tira P2025 (como Prisma); no hay `update` condicionado que afecte 0 filas sin
 *     tirar, porque el código nuevo no usa ninguno;
 *   - `addBulk` NO es atómico: puede fallar y que los jobs entren igual (G-6, G-7).
 */
import { BadRequestException, ConflictException, ForbiddenException, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ImportService } from './imports.service';

let dir: string;
let archivoQueExiste: string;
beforeAll(() => {
    Logger.overrideLogger(false);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imports-grupo-'));
    archivoQueExiste = path.join(dir, 'cartera.txt');
    fs.writeFileSync(archivoQueExiste, 'x');
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const ORIGEN = { v: 1, origen: { remesaOrigenId: null, remesaOrigenIds: null } };
const CORTE = (nomina: string) => [{ fromIndex: 45, operador: 'IGUAL', valor: nomina }];

interface Fila {
    rev: number; fase: string; subfase: string | null; porcentaje: number; totalEsperado: number; procesadas: number; ok: number; err: number;
    descartadas: number; fueraDeCorte: number | null; advertencias: number; nuevos: number | null; actualizados: number | null;
    resultado: string | null; error: string | null; errorPostProceso: string | null; resumen: any; intentos: number; jobId: string | null;
    grupoId: string | null; grupoOrden: number | null; grupoTotal: number | null; cancelSolicitadaAt: Date | null;
    encoladaAt: Date | null; startedAt: Date | null; heartbeatAt: Date | null; finishedAt: Date | null;
}
interface Rem {
    id: number; numeroRemesa: string; nombre: string; empresaId: number; plantillaId: number | null; archivoHash: string | null;
    categoria: string | null; estadoProceso: string; totalFilas: number; okFilas: number; errFilas: number; usuarioCreadorId: number | null;
    filtroFilas: unknown; archivo: string | null; archivos: unknown; progreso: Fila | null; casos: number; claves: number;
    createdAt: Date;
}

const filaVacia = (o: Partial<Fila> = {}): Fila => ({
    rev: 1, fase: 'BORRADOR', subfase: null, porcentaje: 0, totalEsperado: 0, procesadas: 0, ok: 0, err: 0, descartadas: 0, fueraDeCorte: null,
    advertencias: 0, nuevos: null, actualizados: null, resultado: null, error: null, errorPostProceso: null, resumen: null, intentos: 0,
    jobId: null, grupoId: null, grupoOrden: null, grupoTotal: null, cancelSolicitadaAt: null, encoladaAt: null, startedAt: null,
    heartbeatAt: null, finishedAt: null, ...o,
});

/** Un borrador validado (VALIDANDO) de una división: corte propio, mismo archivo. */
const borrador = (id: number, o: Partial<Rem> = {}): Rem => ({
    id, numeroRemesa: String(id).padStart(5, '0'), nombre: `Carga — Nómina ${id}`, empresaId: 10, plantillaId: 5, archivoHash: 'hash-A',
    categoria: 'DEUDORES', estadoProceso: 'VALIDANDO', totalFilas: 100 + id, okFilas: 7, errFilas: 0, usuarioCreadorId: 3,
    filtroFilas: CORTE(`N${id}`), archivo: archivoQueExiste, archivos: null, progreso: filaVacia(), casos: 0, claves: 0, createdAt: new Date(Date.now() - 3_600_000), ...o,
});

interface Opciones {
    remesas: Rem[];
    /** `addBulk` rechaza. `'entra'`: rechaza pero los jobs entraron igual (y la primera ya fue tomada). */
    addBulk?: 'OK' | 'RECHAZA' | 'RECHAZA_Y_TOMADA' | 'RECHAZA_Y_SE_TOMA_UNA';
    /** El update del `jobId` de estas remesas da P2025 (la borraron mientras se confirmaba). */
    p2025EnJobId?: number[];
    /** `sacarJobDeLaCola`: qué contesta `getJob` (para cancelar en cola). */
    jobDeLaCola?: 'ESPERANDO' | 'ACTIVO' | 'NO_RESPONDE';
    otraEnCurso?: { usuarioId: number; remesaId: number };
    usuarios?: Record<number, string>;
}

function armar(o: Opciones) {
    const db = new Map<number, Rem>(o.remesas.map((r) => [r.id, r]));
    let cola: Promise<unknown> = Promise.resolve();
    const serializar = <T>(fn: () => Promise<T>): Promise<T> => {
        const r = cola.then(fn, fn);
        cola = r.then(() => undefined, () => undefined);
        return r;
    };
    const cede = () => new Promise<void>((r) => setImmediate(r));
    const escrituras: Array<{ id: number; data: any }> = [];
    const eventos: Array<{ evento: string; estado: any }> = [];
    const orden: string[] = [];

    const aplicarFila = (r: Rem, campos: Record<string, any>) => {
        if (!r.progreso) r.progreso = filaVacia();
        for (const [k, v] of Object.entries(campos)) {
            if (v && typeof v === 'object' && !(v instanceof Date) && 'increment' in v) (r.progreso as any)[k] += v.increment;
            else (r.progreso as any)[k] = v;
        }
    };
    const aplicarRemesa = (id: number, data: any) => {
        const r = db.get(id);
        if (!r) throw Object.assign(new Error('Record to update not found'), { code: 'P2025' });
        const { progreso, ...resto } = data;
        Object.assign(r, resto);
        if (progreso?.upsert) {
            if (!r.progreso) r.progreso = filaVacia({ ...progreso.upsert.create });
            else aplicarFila(r, progreso.upsert.update);
        } else if (progreso?.update) aplicarFila(r, progreso.update);
        escrituras.push({ id, data: structuredClone(data) });
        return r;
    };
    const conInclude = (r: Rem) => ({
        ...r, progreso: r.progreso ? { ...r.progreso, remesaId: r.id } : null,
        usuarioCreador: r.usuarioCreadorId != null ? { id: r.usuarioCreadorId, nombre: o.usuarios?.[r.usuarioCreadorId] ?? 'Maxi' } : null,
        _count: { deudor: r.casos },
    });
    const filaBloqueada = (r: Rem) => ({
        id: r.id, numeroRemesa: r.numeroRemesa, estadoProceso: r.estadoProceso, totalFilas: r.totalFilas, categoria: r.categoria,
        empresaId: r.empresaId, plantillaId: r.plantillaId, archivoHash: r.archivoHash, filtroFilas: r.filtroFilas,
        usuarioCreadorId: r.usuarioCreadorId, progresoId: r.progreso ? r.id : null, fase: r.progreso?.fase ?? null,
        encoladaAt: r.progreso?.encoladaAt ?? null, startedAt: r.progreso?.startedAt ?? null, finishedAt: r.progreso?.finishedAt ?? null,
        resumen: r.progreso?.resumen ?? null, cancelSolicitadaAt: r.progreso?.cancelSolicitadaAt ?? null, jobId: r.progreso?.jobId ?? null,
        resultado: r.progreso?.resultado ?? null, rev: r.progreso?.rev ?? null, heartbeatAt: r.progreso?.heartbeatAt ?? null, createdAt: r.createdAt,
        ok: r.progreso?.ok ?? 0, err: r.progreso?.err ?? 0,
    });
    const valoresDe = (v: any): number[] => (v && Array.isArray(v.values) ? v.values.map(Number) : [Number(v)]);

    const tx: any = {
        $queryRaw: jest.fn().mockImplementation(async (strings: TemplateStringsArray, ...vals: any[]) => {
            await cede();
            const sql = strings.join('?');
            if (sql.includes('FROM usuario')) {
                orden.push('mutex-usuario');
                return valoresDe(vals[0]).map((id) => ({ id }));
            }
            if (sql.includes('JOIN import_progreso') && sql.includes('FOR UPDATE')) {
                orden.push('bloquear');
                // La FILA ACTUAL de cada una, en orden de id.
                return valoresDe(vals[0]).sort((a, b) => a - b).map((id) => db.get(id)).filter((r): r is Rem => !!r).map(filaBloqueada);
            }
            if (sql.includes('NOT IN')) {
                const duenos = valoresDe(vals[0]);
                const ids = valoresDe(vals[1]);
                const otras = [...db.values()].filter(
                    (r) => r.usuarioCreadorId != null && duenos.includes(r.usuarioCreadorId) && !ids.includes(r.id) &&
                        r.progreso?.encoladaAt != null && r.progreso.finishedAt == null,
                );
                if (o.otraEnCurso && duenos.includes(o.otraEnCurso.usuarioId)) otras.push({ id: o.otraEnCurso.remesaId } as Rem);
                return otras.map((r) => ({ remesaId: r.id, duenoId: r.usuarioCreadorId }));
            }
            return [];
        }),
        remesa: {
            findMany: jest.fn().mockImplementation(async ({ where }: any = {}) =>
                [...db.values()].filter((r) => coincide(r, where)).sort((a, b) => a.id - b.id).map(conInclude)),
            update: jest.fn().mockImplementation(async ({ where, data }: any) => {
                await cede();
                orden.push(`update:${where.id}`);
                return conInclude(aplicarRemesa(where.id, data));
            }),
        },
        import_progreso: {
            update: jest.fn().mockImplementation(async ({ where, data }: any) => {
                await cede();
                const r = db.get(where.remesaId);
                if (!r) throw Object.assign(new Error('not found'), { code: 'P2025' });
                aplicarFila(r, data);
                escrituras.push({ id: where.remesaId, data: structuredClone(data) });
                return {};
            }),
        },
        deudor: { count: jest.fn().mockImplementation(async ({ where }: any) => db.get(where.remesaId)?.casos ?? 0) },
        clave_pago: { count: jest.fn().mockImplementation(async ({ where }: any) => db.get(where.remesaId)?.claves ?? 0) },
    };

    const coincide = (r: Rem, where: any): boolean => {
        if (!where) return true;
        if (where.id?.in && !where.id.in.includes(r.id)) return false;
        if (where.id?.not !== undefined && where.id.not === r.id) return false;
        if (where.progreso?.is?.grupoId !== undefined && r.progreso?.grupoId !== where.progreso.is.grupoId) return false;
        for (const k of ['empresaId', 'plantillaId', 'archivoHash']) if (where[k] !== undefined && (r as any)[k] !== where[k]) return false;
        if (where.numeroRemesa?.in && !where.numeroRemesa.in.includes(r.numeroRemesa)) return false;
        return true;
    };
    const prisma: any = {
        $transaction: jest.fn().mockImplementation((fn: any) => serializar(() => fn(tx))),
        $queryRaw: jest.fn().mockResolvedValue([{ n: 0 }]),
        remesa: {
            findMany: jest.fn().mockImplementation(async ({ where, orderBy }: any = {}) => {
                let rs = [...db.values()].filter((r) => coincide(r, where));
                const ord = orderBy?.progreso?.grupoOrden;
                if (ord) rs.sort((a, b) => ((a.progreso?.grupoOrden ?? 0) - (b.progreso?.grupoOrden ?? 0)) * (ord === 'desc' ? -1 : 1));
                else rs.sort((a, b) => a.id - b.id);
                return rs.map(conInclude);
            }),
            findUnique: jest.fn().mockImplementation(async ({ where }: any) => {
                const r = db.get(where.id);
                return r ? conInclude(r) : null;
            }),
            update: jest.fn().mockImplementation(async ({ where, data }: any) => {
                if (data?.progreso?.update && Object.keys(data.progreso.update).length === 1 && 'jobId' in data.progreso.update) orden.push(`jobid:${where.id}`);
                if (o.p2025EnJobId?.includes(where.id)) throw Object.assign(new Error('Record not found'), { code: 'P2025' });
                return conInclude(aplicarRemesa(where.id, data));
            }),
        },
        import_progreso: {
            findMany: jest.fn().mockImplementation(async () =>
                [...db.values()]
                    .filter((r) => r.progreso?.encoladaAt != null && r.progreso.finishedAt == null)
                    .sort((a, b) => a.progreso!.encoladaAt!.getTime() - b.progreso!.encoladaAt!.getTime() || a.id - b.id)
                    .map((r) => ({ remesaId: r.id })),
            ),
        },
        usuario: { findUnique: jest.fn().mockImplementation(async ({ where }: any) => ({ nombre: o.usuarios?.[where.id] ?? 'Ana' })) },
    };

    // La cola. `addBulk` devuelve los jobs en orden; con la perilla `RECHAZA*` falla como un Redis caído.
    const jobs: Array<{ id: string; data: any; remove: jest.Mock; getState: jest.Mock }> = [];
    const hacerJob = (data: any, n: number) => {
        const j = { id: String(100 + n), data, remove: jest.fn().mockResolvedValue(undefined), getState: jest.fn().mockResolvedValue(o.jobDeLaCola === 'ACTIVO' ? 'active' : 'waiting') };
        jobs.push(j);
        return j;
    };
    const queue: any = {
        addBulk: jest.fn().mockImplementation(async (lote: any[]) => {
            orden.push('addBulk');
            const modo = o.addBulk ?? 'OK';
            if (modo === 'OK') {
                const base = jobs.length;
                return lote.map((l, i) => hacerJob(l.data, base + i));
            }
            if (modo === 'RECHAZA_Y_TOMADA') {
                // Los jobs entraron y el worker ya tomó la primera: la respuesta se perdió.
                const primera = db.get(lote[0].data.remesaId)!;
                Object.assign(primera.progreso!, { fase: 'PROCESANDO', startedAt: new Date() });
                primera.estadoProceso = 'PROCESANDO';
            }
            if (modo === 'RECHAZA_Y_SE_TOMA_UNA') {
                // El worker toma la ÚLTIMA mientras se compensa (un residuo mixto).
                const ultima = db.get(lote[lote.length - 1].data.remesaId)!;
                queue.alCompensar = () => {
                    Object.assign(ultima.progreso!, { fase: 'PROCESANDO', startedAt: new Date() });
                    ultima.estadoProceso = 'PROCESANDO';
                };
            }
            throw new Error('ECONNREFUSED redis');
        }),
        getJob: jest.fn().mockImplementation(async (id: string) => {
            if (o.jobDeLaCola === 'NO_RESPONDE') throw new Error('Redis no responde');
            return jobs.find((j) => j.id === id) ?? null;
        }),
        getJobs: jest.fn().mockResolvedValue([]),
    };
    // Con `RECHAZA_Y_SE_TOMA_UNA` la perilla corre entre el primer `FOR UPDATE` de la compensación y el segundo.
    const bloquear = tx.$queryRaw.getMockImplementation()!;
    let bloqueos = 0;
    tx.$queryRaw.mockImplementation(async (strings: TemplateStringsArray, ...vals: any[]) => {
        const sql = strings.join('?');
        if (sql.includes('JOIN import_progreso') && queue.alCompensar && ++bloqueos === 2) queue.alCompensar();
        return bloquear(strings, ...vals);
    });

    const realtime: any = {
        emitImportProgreso: jest.fn().mockImplementation((e: any) => { eventos.push({ evento: 'progreso', estado: e }); orden.push(`progreso:${e.remesaId}`); }),
        emitImportFinalizada: jest.fn().mockImplementation((e: any) => eventos.push({ evento: 'finalizada', estado: e })),
        emitImportIniciada: jest.fn(),
    };
    const notificaciones: any = { crear: jest.fn().mockResolvedValue(undefined) };
    const auditoria: any = { log: jest.fn().mockResolvedValue(undefined) };
    const requestContext: any = { get: jest.fn().mockReturnValue({ requestId: 'rq1', usuarioId: 3 }) };
    const service = new ImportService(prisma, {} as any, queue, realtime, notificaciones, requestContext, {} as any, {} as any, auditoria);

    return { service, db, prisma, tx, queue, jobs, realtime, notificaciones, auditoria, escrituras, eventos, orden, remesa: (id: number) => db.get(id)! };
}

type H = ReturnType<typeof armar>;
const DUENO = { sub: 3, permisos: ['importacion.ejecutar'] };
const OTRO_CON_PERMISO = { sub: 9, permisos: ['importacion.ejecutar', 'importacion.ver_progreso_otros'] };
const OTRO_SIN_PERMISO = { sub: 9, permisos: ['importacion.ejecutar'] };

let warn: jest.SpyInstance;
let error: jest.SpyInstance;
beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn');
    error = jest.spyOn(Logger.prototype, 'error');
});
afterEach(() => jest.restoreAllMocks());

const tres = () => armar({ remesas: [borrador(11), borrador(12), borrador(13)] });

/* ────────────────────────────────────────────────────────────────────────────
 * Confirmar un grupo
 * ──────────────────────────────────────────────────────────────────────────── */
describe('ejecutarGrupo', () => {
    it('G-1: tres borradores validados: una transacción, el mismo grupoId, grupoOrden 1-2-3, encoladaAt creciente de a 1 ms, resumen.origen, un addBulk de tres jobs en orden', async () => {
        const h = tres();

        const r = await h.service.ejecutarGrupo({ remesaIds: [11, 12, 13], remesaOrigenId: 77 }, 3);

        expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
        const filas = [11, 12, 13].map((id) => h.remesa(id).progreso!);
        expect(new Set(filas.map((f) => f.grupoId)).size).toBe(1);
        expect(filas[0].grupoId).toBe(r.grupoId);
        expect(filas.map((f) => [f.grupoOrden, f.grupoTotal, f.fase])).toEqual([[1, 3, 'EN_COLA'], [2, 3, 'EN_COLA'], [3, 3, 'EN_COLA']]);
        expect(filas[1].encoladaAt!.getTime() - filas[0].encoladaAt!.getTime()).toBe(1);
        expect(filas[2].encoladaAt!.getTime() - filas[1].encoladaAt!.getTime()).toBe(1);
        filas.forEach((f) => expect(f.resumen).toEqual({ v: 1, origen: { remesaOrigenId: 77, remesaOrigenIds: null } }));
        [11, 12, 13].forEach((id) => expect(h.remesa(id)).toMatchObject({ estadoProceso: 'PENDIENTE', okFilas: 0, errFilas: 0, usuarioCreadorId: 3 }));
        // El grupo se encola con UN addBulk de tres jobs, en ese orden, con las remesas de origen en el job.
        expect(h.queue.addBulk).toHaveBeenCalledTimes(1);
        const lote = h.queue.addBulk.mock.calls[0][0];
        expect(lote.map((l: any) => l.data.remesaId)).toEqual([11, 12, 13]);
        expect(lote[0]).toMatchObject({ name: 'process-import', data: { remesaOrigenId: 77, usuarioId: 3, _ctx: { requestId: 'rq1' } } });
        // Tres `import:progreso` (EN_COLA, con grupo*) y tres escrituras del jobId.
        expect(h.realtime.emitImportProgreso).toHaveBeenCalledTimes(3);
        expect(h.eventos.map((e) => [e.estado.remesaId, e.estado.grupoOrden, e.estado.fase])).toEqual([[11, 1, 'EN_COLA'], [12, 2, 'EN_COLA'], [13, 3, 'EN_COLA']]);
        expect([11, 12, 13].map((id) => h.remesa(id).progreso!.jobId)).toEqual(['100', '101', '102']);
        expect(h.prisma.remesa.update).toHaveBeenCalledTimes(3);
        expect(r.cargas.map((c) => c.remesaId)).toEqual([11, 12, 13]);
        expect(r.cargas.map((c) => c.grupoTotal)).toEqual([3, 3, 3]);
        expect(r.noEncoladas).toBeUndefined();
    });

    it('G-2: los ids llegan desordenados y con un repetido: se ordenan por id y se deduplican', async () => {
        const h = tres();
        const r = await h.service.ejecutarGrupo({ remesaIds: [13, 11, 12, 11] }, 3);
        expect(h.queue.addBulk.mock.calls[0][0].map((l: any) => l.data.remesaId)).toEqual([11, 12, 13]);
        expect(r.cargas.map((c) => c.grupoOrden)).toEqual([1, 2, 3]);
    });

    describe('G-3: lo que se rechaza no escribe nada ni toca la cola', () => {
        const rechaza = async (h: H, ids: number[], tipo: new (...a: any[]) => Error, texto: RegExp) => {
            const antes = JSON.stringify([...h.db.values()]);
            await expect(h.service.ejecutarGrupo({ remesaIds: ids }, 3)).rejects.toBeInstanceOf(tipo);
            await expect(h.service.ejecutarGrupo({ remesaIds: ids }, 3)).rejects.toThrow(texto);
            expect(JSON.stringify([...h.db.values()])).toBe(antes);
            expect(h.queue.addBulk).not.toHaveBeenCalled();
            expect(h.realtime.emitImportProgreso).not.toHaveBeenCalled();
        };

        it('una ya confirmada → 409', async () => {
            const h = armar({ remesas: [borrador(11), borrador(12, { estadoProceso: 'PENDIENTE', progreso: filaVacia({ fase: 'EN_COLA', encoladaAt: new Date() }) })] });
            await rechaza(h, [11, 12], ConflictException, /La remesa 00012 ya fue confirmada/);
        });
        it('una sin vista previa (PENDIENTE) → 400', async () => {
            const h = armar({ remesas: [borrador(11), borrador(12, { estadoProceso: 'PENDIENTE' })] });
            await rechaza(h, [11, 12], BadRequestException, /La remesa 00012 no tiene hecha la vista previa/);
        });
        it('una con total 0 → 400', async () => {
            const h = armar({ remesas: [borrador(11), borrador(12, { totalFilas: 0 })] });
            await rechaza(h, [11, 12], BadRequestException, /La vista previa de la remesa 00012 no encontró filas/);
        });
        it('una de otro archivo → 400', async () => {
            const h = armar({ remesas: [borrador(11), borrador(12, { archivoHash: 'hash-B' })] });
            await rechaza(h, [11, 12], BadRequestException, /Las remesas no son cortes del mismo archivo/);
        });
        it('una sin corte propio → 400', async () => {
            const h = armar({ remesas: [borrador(11), borrador(12, { filtroFilas: null })] });
            await rechaza(h, [11, 12], BadRequestException, /Las remesas no son cortes del mismo archivo/);
        });
        it('una MULTIARCHIVO → 400', async () => {
            const h = armar({ remesas: [borrador(11, { categoria: 'MULTIARCHIVO' }), borrador(12, { categoria: 'MULTIARCHIVO' })] });
            await rechaza(h, [11, 12], BadRequestException, /Esta categoría no admite dividir la carga/);
        });
        it('una sola → 400', async () => {
            const h = tres();
            await rechaza(h, [11], BadRequestException, /entre 2 y 100/);
        });
        it('101 → 400', async () => {
            const h = tres();
            await rechaza(h, Array.from({ length: 101 }, (_, i) => i + 1), BadRequestException, /entre 2 y 100/);
        });
        it('una que no existe → 404', async () => {
            const h = tres();
            await rechaza(h, [11, 99], NotFoundException, /La remesa 99 no existe/);
        });
    });

    it('G-4: el usuario tiene otra carga en curso que no es del lote: 409 y nada escrito', async () => {
        const h = armar({
            remesas: [borrador(11), borrador(12), borrador(40, { estadoProceso: 'PROCESANDO', progreso: filaVacia({ fase: 'PROCESANDO', encoladaAt: new Date(), startedAt: new Date() }) })],
        });
        const antes = JSON.stringify([...h.db.values()]);

        await expect(h.service.ejecutarGrupo({ remesaIds: [11, 12] }, 3)).rejects.toThrow(/Ya tenés una importación en curso/);

        expect(JSON.stringify([...h.db.values()])).toBe(antes);
        expect(h.queue.addBulk).not.toHaveBeenCalled();
    });

    it('G-5: addBulk rechaza y ninguna fue tomada: las tres vuelven a borrador en orden inverso, sin grupo*, 503 y ningún evento', async () => {
        const h = armar({ remesas: [borrador(11), borrador(12), borrador(13)], addBulk: 'RECHAZA' });

        await expect(h.service.ejecutarGrupo({ remesaIds: [11, 12, 13] }, 3)).rejects.toBeInstanceOf(ServiceUnavailableException);

        for (const id of [11, 12, 13]) {
            expect(h.remesa(id).estadoProceso).toBe('VALIDANDO');
            expect(h.remesa(id).progreso).toMatchObject({ fase: 'BORRADOR', encoladaAt: null, jobId: null, grupoId: null, grupoOrden: null, grupoTotal: null });
        }
        // La compensación va en orden inverso: 13, 12, 11.
        const compensaciones = h.escrituras.filter((e) => e.data.progreso?.update?.fase === 'BORRADOR').map((e) => e.id);
        expect(compensaciones).toEqual([13, 12, 11]);
        expect(h.realtime.emitImportProgreso).not.toHaveBeenCalled();
        expect(error).toHaveBeenCalled();
    });

    it('G-6: addBulk vence pero la primera ya arrancó: no se compensa nada y responde 201 con el estado real', async () => {
        const h = armar({ remesas: [borrador(11), borrador(12), borrador(13)], addBulk: 'RECHAZA_Y_TOMADA' });

        const r = await h.service.ejecutarGrupo({ remesaIds: [11, 12, 13] }, 3);

        expect(r.cargas.map((c) => c.remesaId)).toEqual([11, 12, 13]);
        expect(r.cargas[0]).toMatchObject({ fase: 'PROCESANDO' });
        expect(r.noEncoladas).toBeUndefined();
        expect(h.remesa(12).progreso!.fase).toBe('EN_COLA');
        expect(h.remesa(13).progreso!.fase).toBe('EN_COLA');
        expect(h.escrituras.filter((e) => e.data.progreso?.update?.fase === 'BORRADOR')).toHaveLength(0);
    });

    it('G-7: addBulk rechaza y una se toma durante la compensación: 201 con noEncoladas y error en el log', async () => {
        const h = armar({ remesas: [borrador(11), borrador(12), borrador(13)], addBulk: 'RECHAZA_Y_SE_TOMA_UNA' });

        const r = await h.service.ejecutarGrupo({ remesaIds: [11, 12, 13] }, 3);

        expect(r.cargas.map((c) => c.remesaId)).toEqual([13]);
        expect(r.noEncoladas).toEqual([{ remesaId: 11, numeroRemesa: '00011' }, { remesaId: 12, numeroRemesa: '00012' }]);
        expect(h.remesa(11).progreso!.fase).toBe('BORRADOR');
        expect(h.remesa(13).estadoProceso).toBe('PROCESANDO');
        expect(error.mock.calls.some(([m]) => String(m).includes('Encolado parcial'))).toBe(true);
    });

    it('G-8: guardar el jobId de una da P2025 (la borraron): se saca ese job y las otras dos siguen', async () => {
        const h = armar({ remesas: [borrador(11), borrador(12), borrador(13)], p2025EnJobId: [12] });

        const r = await h.service.ejecutarGrupo({ remesaIds: [11, 12, 13] }, 3);

        expect(r.cargas.map((c) => c.remesaId)).toEqual([11, 13]);
        expect(h.jobs[1].remove).toHaveBeenCalledTimes(1);
        expect(h.jobs[0].remove).not.toHaveBeenCalled();
        expect(h.remesa(11).progreso!.jobId).toBe('100');
        expect(h.remesa(13).progreso!.jobId).toBe('102');
        // Los EN_COLA salen antes de guardar los jobId (hallazgo 4): los tres, también el de la que se borró después.
        expect(h.realtime.emitImportProgreso).toHaveBeenCalledTimes(3);
    });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Leer un grupo
 * ──────────────────────────────────────────────────────────────────────────── */
describe('grupo', () => {
    it('G-9: ordenado por grupoOrden, 404 si no hay ninguna, y enColaDelante cuenta las de todos', async () => {
        const h = tres();
        // Una ajena, confirmada antes, que también está en la cola.
        h.db.set(50, borrador(50, { usuarioCreadorId: 8, estadoProceso: 'PENDIENTE', progreso: filaVacia({ fase: 'EN_COLA', encoladaAt: new Date(Date.now() - 60_000) }) }));
        const { grupoId } = await h.service.ejecutarGrupo({ remesaIds: [13, 11, 12] }, 3);

        const g = await h.service.grupo(grupoId);

        expect(g.grupoId).toBe(grupoId);
        expect(g.total).toBe(3);
        expect(g.remesas.map((r) => [r.remesaId, r.grupoOrden])).toEqual([[11, 1], [12, 2], [13, 3]]);
        // La ajena está antes de las tres: la posición cuenta las N remesas y las de otros usuarios.
        expect(g.remesas.map((r) => r.enColaDelante)).toEqual([1, 2, 3]);
        await expect(h.service.grupo('no-existe')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('si una se eliminó, remesas trae menos que total', async () => {
        const h = tres();
        const { grupoId } = await h.service.ejecutarGrupo({ remesaIds: [11, 12, 13] }, 3);
        h.db.delete(12);
        const g = await h.service.grupo(grupoId);
        expect(g.total).toBe(3);
        expect(g.remesas).toHaveLength(2);
    });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Cancelar
 * ──────────────────────────────────────────────────────────────────────────── */
const enCola = (id: number, o: Partial<Rem> = {}, f: Partial<Fila> = {}) =>
    borrador(id, { estadoProceso: 'PENDIENTE', progreso: filaVacia({ fase: 'EN_COLA', encoladaAt: new Date(), jobId: String(100 + id), resumen: ORIGEN, ...f }), ...o });
const procesando = (id: number, f: Partial<Fila> = {}, o: Partial<Rem> = {}) =>
    enCola(id, { estadoProceso: 'PROCESANDO', ...o }, { fase: 'PROCESANDO', startedAt: new Date(), ...f });

describe('cancelarCarga', () => {
    it('G-10: en cola con el job esperando: se saca el job ANTES de la transacción; CANCELADA, startedAt null, import:finalizada', async () => {
        const h = armar({ remesas: [enCola(11, {}, { jobId: '100' })], jobDeLaCola: 'ESPERANDO' });
        const job = { id: '100', data: { remesaId: 11 }, remove: jest.fn().mockImplementation(async () => { h.orden.push('job-removido'); }), getState: jest.fn().mockResolvedValue('waiting') };
        h.queue.getJob.mockResolvedValue(job);

        const r = await h.service.cancelarCarga(11, OTRO_CON_PERMISO);

        expect(r.efecto).toBe('CANCELADA');
        expect(h.orden.indexOf('job-removido')).toBeGreaterThanOrEqual(0);
        expect(h.orden.indexOf('job-removido')).toBeLessThan(h.orden.indexOf('bloquear'));
        expect(h.remesa(11).estadoProceso).toBe('FALLIDA');
        expect(h.remesa(11).progreso).toMatchObject({ fase: 'TERMINADA', resultado: 'CANCELADA', startedAt: null });
        expect(h.remesa(11).progreso!.finishedAt).not.toBeNull();
        expect(h.remesa(11).progreso!.cancelSolicitadaAt).not.toBeNull();
        expect(h.remesa(11).progreso!.error).toContain('La importación fue cancelada por Ana antes de empezar.');
        expect(h.remesa(11).progreso!.resumen).toMatchObject({ v: 1, origen: ORIGEN.origen, cancelacion: { usuarioId: 9, nombre: 'Ana' } });
        expect(h.realtime.emitImportFinalizada).toHaveBeenCalledTimes(1);
        expect(r.carga).toMatchObject({ cancelada: true, retomable: true, resultado: 'FALLIDA' });
    });

    it('G-11: en cola y sacarJobDeLaCola devuelve false (job activo, o la cola no responde): no se cierra, queda el pedido y efecto PEDIDA', async () => {
        for (const jobDeLaCola of ['ACTIVO', 'NO_RESPONDE'] as const) {
            const h = armar({ remesas: [enCola(11, {}, { jobId: '100' })], jobDeLaCola });
            if (jobDeLaCola === 'ACTIVO') h.queue.getJob.mockResolvedValue({ id: '100', data: { remesaId: 11 }, remove: jest.fn(), getState: jest.fn().mockResolvedValue('active') });

            const r = await h.service.cancelarCarga(11, DUENO);

            expect(r.efecto).toBe('PEDIDA');
            expect(h.remesa(11).estadoProceso).toBe('PENDIENTE');
            expect(h.remesa(11).progreso).toMatchObject({ fase: 'EN_COLA', resultado: null, finishedAt: null });
            expect(h.remesa(11).progreso!.cancelSolicitadaAt).not.toBeNull();
            expect(h.realtime.emitImportFinalizada).not.toHaveBeenCalled();
        }
    });

    it('G-12: procesando: cancelSolicitadaAt, resumen.cancelacion, avisarCancelacion del tracker vivo, import:progreso y efecto PEDIDA', async () => {
        const h = armar({ remesas: [procesando(11)] });
        const tracker = { faseActual: { fase: 'PROCESANDO' }, avisarCancelacion: jest.fn() };
        (h.service as any).cargasVivas.set(11, tracker);

        const r = await h.service.cancelarCarga(11, OTRO_CON_PERMISO);

        expect(r.efecto).toBe('PEDIDA');
        expect(h.remesa(11).progreso!.cancelSolicitadaAt).not.toBeNull();
        expect(h.remesa(11).progreso!.resumen.cancelacion).toEqual({ usuarioId: 9, nombre: 'Ana' });
        expect(h.remesa(11).progreso!.resumen.origen).toEqual(ORIGEN.origen); // el resumen se mezcla, no se pisa
        expect(h.remesa(11).progreso!.rev).toBe(2);
        expect(tracker.avisarCancelacion).toHaveBeenCalledTimes(1);
        expect(h.realtime.emitImportProgreso).toHaveBeenCalledTimes(1);
        expect(h.realtime.emitImportProgreso.mock.calls[0][0]).toMatchObject({ cancelacionPedidaAt: expect.any(String), cancelable: false, canceladaPor: 'Ana' });
        expect(h.queue.getJob).not.toHaveBeenCalled(); // arrancó: no hay job que sacar
        expect(h.remesa(11).estadoProceso).toBe('PROCESANDO'); // sigue: el runner la cierra
    });

    describe('G-13: lo que no se puede cancelar da 409 con su texto y no escribe nada', () => {
        const caso = async (r: Rem, texto: RegExp, memoria?: string) => {
            const h = armar({ remesas: [r] });
            if (memoria) (h.service as any).cargasVivas.set(r.id, { faseActual: { fase: memoria }, avisarCancelacion: jest.fn() });
            const antes = JSON.stringify([...h.db.values()]);
            await expect(h.service.cancelarCarga(r.id, DUENO)).rejects.toBeInstanceOf(ConflictException);
            await expect(h.service.cancelarCarga(r.id, DUENO)).rejects.toThrow(texto);
            expect(JSON.stringify([...h.db.values()])).toBe(antes);
            expect(h.realtime.emitImportProgreso).not.toHaveBeenCalled();
            expect(h.realtime.emitImportFinalizada).not.toHaveBeenCalled();
        };
        it('un borrador', () => caso(borrador(11), /Esta importación no está en curso: no hay nada que cancelar\. Si es una vista previa que no querés, eliminala\./));
        it('una terminal', () =>
            caso(borrador(11, { estadoProceso: 'FINALIZADA', progreso: filaVacia({ fase: 'TERMINADA', encoladaAt: new Date(), finishedAt: new Date(), resultado: 'OK' }) }), /Esta importación ya terminó: no hay nada que cancelar\./));
        it('en post-proceso según la fila', () =>
            caso(procesando(11, { fase: 'POST_PROCESO' }), /ya procesó todas las filas y está cerrando: en este paso no se puede cancelar\. Esperá a que termine\./));
        it('en post-proceso solo según la memoria del tracker (la escritura de la fase falló)', () =>
            caso(procesando(11, { fase: 'PROCESANDO' }), /está cerrando/, 'POST_PROCESO'));
        it('una ACCIONES que ya arrancó', () =>
            caso(procesando(11, {}, { categoria: 'ACCIONES' }), /Una acción masiva que ya empezó no se cancela: los datos para deshacerla se guardan recién al terminar\. Esperá a que termine y usá Revertir, que la deshace completa\./));
    });

    it('una ACCIONES en cola sí se puede cancelar', async () => {
        const h = armar({ remesas: [enCola(11, { categoria: 'ACCIONES' }, { jobId: '100' })] });
        h.queue.getJob.mockResolvedValue({ id: '100', data: { remesaId: 11 }, remove: jest.fn().mockResolvedValue(undefined), getState: jest.fn().mockResolvedValue('waiting') });
        await expect(h.service.cancelarCarga(11, DUENO)).resolves.toMatchObject({ efecto: 'CANCELADA' });
    });

    it('G-14: ya cancelada y ya pedida: 200 idempotente, sin ninguna escritura nueva', async () => {
        const cancelada = borrador(11, { estadoProceso: 'FALLIDA', progreso: filaVacia({ fase: 'TERMINADA', encoladaAt: new Date(), finishedAt: new Date(), resultado: 'CANCELADA', cancelSolicitadaAt: new Date() }) });
        const pedida = procesando(12, { cancelSolicitadaAt: new Date() });
        const h = armar({ remesas: [cancelada, pedida] });
        const antes = JSON.stringify([...h.db.values()]);

        await expect(h.service.cancelarCarga(11, DUENO)).resolves.toMatchObject({ efecto: 'CANCELADA' });
        await expect(h.service.cancelarCarga(12, DUENO)).resolves.toMatchObject({ efecto: 'PEDIDA' });

        expect(JSON.stringify([...h.db.values()])).toBe(antes);
        expect(h.escrituras).toHaveLength(0);
        expect(h.realtime.emitImportProgreso).not.toHaveBeenCalled();
        expect(h.realtime.emitImportFinalizada).not.toHaveBeenCalled();
    });

    it('G-15: sin ser el dueño ni tener ver_progreso_otros: 403, y sacarJobDeLaCola NO se llamó', async () => {
        const h = armar({ remesas: [enCola(11)] });
        const sacar = jest.spyOn(h.service, 'sacarJobDeLaCola');

        await expect(h.service.cancelarCarga(11, OTRO_SIN_PERMISO)).rejects.toBeInstanceOf(ForbiddenException);

        expect(sacar).not.toHaveBeenCalled();
        expect(h.queue.getJob).not.toHaveBeenCalled();
        expect(h.queue.getJobs).not.toHaveBeenCalled();
        expect(h.escrituras).toHaveLength(0);
    });

    it('una remesa que no existe: 404', async () => {
        const h = tres();
        await expect(h.service.cancelarCarga(999, DUENO)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('G-16: cancelada en cola por otro usuario: notificación solo al dueño. Por el dueño: ninguna', async () => {
        const porOtro = armar({ remesas: [enCola(11)] });
        porOtro.queue.getJob.mockResolvedValue(null); // el job se perdió: se cierra en el acto
        await porOtro.service.cancelarCarga(11, OTRO_CON_PERMISO);
        expect(porOtro.notificaciones.crear).toHaveBeenCalledTimes(1);
        const n = porOtro.notificaciones.crear.mock.calls[0][0];
        expect(n).toMatchObject({ tipo: 'IMPORTACION_ERROR', titulo: 'Importación cancelada', destinatarioPrincipalId: 3 });
        expect(n.incluirUsuariosConPermiso).toBeUndefined(); // ni a los que ven las importaciones de otros
        expect(n.payload).toMatchObject({ cancelada: true });
        expect(porOtro.auditoria.log).toHaveBeenCalledTimes(1);
        expect(porOtro.auditoria.log.mock.calls[0][0]).toMatchObject({ tipo: 'IMPORT_FAIL', severidad: 'WARN', usuarioId: 9 });

        const porElDueno = armar({ remesas: [enCola(11)] });
        porElDueno.queue.getJob.mockResolvedValue(null);
        await porElDueno.service.cancelarCarga(11, DUENO);
        expect(porElDueno.notificaciones.crear).not.toHaveBeenCalled();
        expect(porElDueno.realtime.emitImportFinalizada).toHaveBeenCalledTimes(1);
    });
});

describe('cancelarGrupo', () => {
    it('G-17: una terminada, una procesando y dos en cola: se llama en orden inverso (4, 3, 2); la terminada va como YA_TERMINADA; un 409 de una no frena a las otras', async () => {
        const grupo = { grupoId: 'g1', grupoTotal: 4 };
        const h = armar({
            remesas: [
                borrador(11, { estadoProceso: 'FINALIZADA', progreso: filaVacia({ ...grupo, grupoOrden: 1, fase: 'TERMINADA', encoladaAt: new Date(), finishedAt: new Date(), resultado: 'OK' }) }),
                procesando(12, { ...grupo, grupoOrden: 2, fase: 'POST_PROCESO' }), // en post-proceso: 409
                enCola(13, {}, { ...grupo, grupoOrden: 3 }),
                enCola(14, {}, { ...grupo, grupoOrden: 4 }),
            ],
        });
        h.queue.getJob.mockResolvedValue(null);
        const llamadas: number[] = [];
        const original = h.service.cancelarCarga.bind(h.service);
        jest.spyOn(h.service, 'cancelarCarga').mockImplementation((id, user) => { llamadas.push(id); return original(id, user); });

        const r = await h.service.cancelarGrupo('g1', DUENO);

        expect(llamadas).toEqual([14, 13, 12]); // la terminada ni se intenta
        expect(r.resultados.map((x) => [x.remesaId, x.efecto])).toEqual([[11, 'YA_TERMINADA'], [12, 'RECHAZADA'], [13, 'CANCELADA'], [14, 'CANCELADA']]);
        expect(r.resultados[1].motivo).toMatch(/está cerrando/);
        expect(h.remesa(13).progreso!.resultado).toBe('CANCELADA');
        expect(h.remesa(14).progreso!.resultado).toBe('CANCELADA');
        expect(h.remesa(12).progreso!.cancelSolicitadaAt).toBeNull();
    });

    it('404 si el grupo no existe, y 403 sin tocar nada si alguna no es de quien lo pide', async () => {
        const h = armar({ remesas: [enCola(13, {}, { grupoId: 'g1', grupoOrden: 1, grupoTotal: 1 })] });
        await expect(h.service.cancelarGrupo('nope', DUENO)).rejects.toBeInstanceOf(NotFoundException);
        await expect(h.service.cancelarGrupo('g1', OTRO_SIN_PERMISO)).rejects.toBeInstanceOf(ForbiddenException);
        expect(h.queue.getJob).not.toHaveBeenCalled();
    });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Retomar
 * ──────────────────────────────────────────────────────────────────────────── */
const cancelada = (id: number, o: Partial<Rem> = {}, f: Partial<Fila> = {}) =>
    borrador(id, {
        estadoProceso: 'FALLIDA',
        progreso: filaVacia({
            fase: 'TERMINADA', encoladaAt: new Date(Date.now() - 600_000), finishedAt: new Date(Date.now() - 300_000), resultado: 'CANCELADA',
            cancelSolicitadaAt: new Date(), error: 'cancelada', intentos: 1, ok: 0, err: 0, rev: 40,
            resumen: { ...ORIGEN, origen: { remesaOrigenId: 77, remesaOrigenIds: [77, 78] }, cancelacion: { usuarioId: 9, nombre: 'Ana' } },
            ...f,
        }),
        ...o,
    });

describe('retomarRemesas', () => {
    it('G-18: sobre una cancelada en cola: PENDIENTE, fila en cola con todo en cero, sin startedAt/finishedAt/cancelSolicitadaAt, intentos 0, resumen sin cancelacion y con retomas 1; el job lleva las remesas de origen', async () => {
        const h = armar({ remesas: [cancelada(11, {}, { grupoId: 'g1', grupoOrden: 1, grupoTotal: 2 })] });

        const r = await h.service.retomarRemesas({ remesaIds: [11] }, DUENO);

        expect(h.remesa(11).estadoProceso).toBe('PENDIENTE');
        expect(h.remesa(11)).toMatchObject({ okFilas: 0, errFilas: 0 });
        const f = h.remesa(11).progreso!;
        expect(f).toMatchObject({
            fase: 'EN_COLA', startedAt: null, finishedAt: null, cancelSolicitadaAt: null, resultado: null, error: null, intentos: 0,
            porcentaje: 0, procesadas: 0, ok: 0, err: 0, descartadas: 0, advertencias: 0, subfase: null, heartbeatAt: null,
            totalEsperado: 111, grupoId: 'g1', grupoOrden: 1, grupoTotal: 2, // el grupo no se toca
        });
        expect(f.encoladaAt).toBeInstanceOf(Date);
        expect(f.rev).toBe(41); // sigue creciendo
        expect(f.resumen).toEqual({ v: 1, origen: { remesaOrigenId: 77, remesaOrigenIds: [77, 78] }, retomas: 1 });
        expect(h.queue.addBulk).toHaveBeenCalledTimes(1);
        expect(h.queue.addBulk.mock.calls[0][0][0].data).toMatchObject({ remesaId: 11, remesaOrigenId: 77, remesaOrigenIds: [77, 78], usuarioId: 3 });
        expect(r.cargas).toHaveLength(1);
        expect(r.cargas[0]).toMatchObject({ fase: 'EN_COLA', enCurso: true, cancelada: false, retomable: false });
        expect(h.realtime.emitImportProgreso).toHaveBeenCalledTimes(1);
        expect(h.realtime.emitImportProgreso.mock.calls[0][0].rev).toBeGreaterThan(40);
    });

    it('G-18b: retomar dos veces seguidas: la segunda encuentra la remesa en cola y da 409 (doble clic)', async () => {
        const h = armar({ remesas: [cancelada(11)] });
        await h.service.retomarRemesas({ remesaIds: [11] }, DUENO);
        await expect(h.service.retomarRemesas({ remesaIds: [11] }, DUENO)).rejects.toThrow(/no terminó, o terminó bien/);
        expect(h.queue.addBulk).toHaveBeenCalledTimes(1);
    });

    describe('G-19: no retomable → 409 con su texto y nada escrito', () => {
        const caso = async (r: Rem, texto: RegExp) => {
            const h = armar({ remesas: [r] });
            const antes = JSON.stringify([...h.db.values()]);
            await expect(h.service.retomarRemesas({ remesaIds: [r.id] }, DUENO)).rejects.toBeInstanceOf(ConflictException);
            await expect(h.service.retomarRemesas({ remesaIds: [r.id] }, DUENO)).rejects.toThrow(texto);
            expect(JSON.stringify([...h.db.values()])).toBe(antes);
            expect(h.queue.addBulk).not.toHaveBeenCalled();
            expect(h.prisma.$transaction).not.toHaveBeenCalled(); // ni se abrió: lo descarta la lectura previa
        };
        it('procesó filas (arrancó, sin el marcador)', () =>
            caso(cancelada(11, {}, { startedAt: new Date(), ok: 300 }), /ya procesó filas: no se puede retomar\. Mirá el motivo de la falla para saber qué hacer\./));
        it('FINALIZADA', () =>
            caso(borrador(11, { estadoProceso: 'FINALIZADA', progreso: filaVacia({ fase: 'TERMINADA', encoladaAt: new Date(), finishedAt: new Date(), resultado: 'OK', resumen: ORIGEN }) }), /no terminó, o terminó bien: no hay nada que retomar\./));
        it('en curso', () => caso(enCola(11), /no terminó, o terminó bien/));
        it('sin resumen.origen (anterior a C1)', () =>
            caso(cancelada(11, {}, { resumen: null }), /anterior a la función de retomar\. Volvé a subir el archivo\./));
        it('resumen sin origen', () => caso(cancelada(11, {}, { resumen: { v: 1 } }), /anterior a la función de retomar/));
    });

    it('G-19b: el estado cambió entre la lectura previa y el lock (el worker la tomó): manda la fila bloqueada, no la lectura previa', async () => {
        const h = armar({ remesas: [cancelada(11)] });
        const original = h.prisma.remesa.findMany.getMockImplementation()!;
        // La lectura previa ve una remesa retomable; justo después alguien la procesa (startedAt, filas) y termina de nuevo.
        h.prisma.remesa.findMany.mockImplementationOnce(async (args: any) => {
            const r = await original(args);
            Object.assign(h.remesa(11).progreso!, { startedAt: new Date(), ok: 300, procesadas: 300 });
            return r;
        });
        const antes = () => JSON.stringify(h.remesa(11).progreso);

        await expect(h.service.retomarRemesas({ remesaIds: [11] }, DUENO)).rejects.toThrow(/ya procesó filas/);

        expect(h.queue.addBulk).not.toHaveBeenCalled();
        expect(h.remesa(11).estadoProceso).toBe('FALLIDA');
        expect(antes()).toContain('"ok":300');
    });

    it('G-20: el marcador dice "sin filas" y hay un caso con ese remesaId: 409 y error en el log, nada escrito', async () => {
        const h = armar({ remesas: [cancelada(11, { casos: 3 }, { startedAt: new Date(), resumen: { ...ORIGEN, sinFilasEntregadas: true } })] });
        const antes = JSON.stringify([...h.db.values()]);

        await expect(h.service.retomarRemesas({ remesaIds: [11] }, DUENO)).rejects.toThrow(/ya procesó filas/);

        expect(JSON.stringify([...h.db.values()])).toBe(antes);
        expect(error.mock.calls.some(([m]) => String(m).includes('el marcador y los datos se contradicen'))).toBe(true);
        expect(h.queue.addBulk).not.toHaveBeenCalled();
    });

    it('lo mismo con una clave de pago cargada (MULTICLAVES)', async () => {
        const h = armar({ remesas: [cancelada(11, { claves: 2 }, { startedAt: new Date(), resumen: { ...ORIGEN, sinFilasEntregadas: true } })] });
        await expect(h.service.retomarRemesas({ remesaIds: [11] }, DUENO)).rejects.toThrow(/ya procesó filas/);
        expect(h.queue.addBulk).not.toHaveBeenCalled();
    });

    it('el marcador sin casos ni claves SÍ se retoma (arrancó, falló antes de la primera fila)', async () => {
        const h = armar({ remesas: [cancelada(11, {}, { startedAt: new Date(), resumen: { ...ORIGEN, sinFilasEntregadas: true } })] });
        await expect(h.service.retomarRemesas({ remesaIds: [11] }, DUENO)).resolves.toMatchObject({ cargas: [{ remesaId: 11, fase: 'EN_COLA' }] });
        expect(h.remesa(11).progreso!.resumen.sinFilasEntregadas).toBeUndefined(); // se borra: la retomada es un intento nuevo
    });

    it('G-21: falta un archivo en el disco: 400 antes de abrir la transacción', async () => {
        const h = armar({ remesas: [cancelada(11, { archivo: path.join(dir, 'borrado.txt') })] });

        await expect(h.service.retomarRemesas({ remesaIds: [11] }, DUENO)).rejects.toBeInstanceOf(BadRequestException);
        await expect(h.service.retomarRemesas({ remesaIds: [11] }, DUENO)).rejects.toThrow(/No se encuentra\(n\) en el disco 1 de los 1 archivo\(s\)/);

        expect(h.prisma.$transaction).not.toHaveBeenCalled();
        expect(h.queue.addBulk).not.toHaveBeenCalled();
    });

    it('el dueño tiene otra carga en curso: 409', async () => {
        const h = armar({ remesas: [cancelada(11)], otraEnCurso: { usuarioId: 3, remesaId: 60 } });
        await expect(h.service.retomarRemesas({ remesaIds: [11] }, DUENO)).rejects.toThrow(/Ya tenés una importación en curso/);
        expect(h.queue.addBulk).not.toHaveBeenCalled();
        expect(h.remesa(11).estadoProceso).toBe('FALLIDA');
    });

    it('sin ser el dueño ni tener ver_progreso_otros: 403; con el permiso la retoma y el job va por el dueño original', async () => {
        const h = armar({ remesas: [cancelada(11)] });
        await expect(h.service.retomarRemesas({ remesaIds: [11] }, OTRO_SIN_PERMISO)).rejects.toBeInstanceOf(ForbiddenException);
        expect(h.queue.addBulk).not.toHaveBeenCalled();

        await h.service.retomarRemesas({ remesaIds: [11] }, OTRO_CON_PERMISO);
        expect(h.queue.addBulk.mock.calls[0][0][0].data.usuarioId).toBe(3);
        expect(h.remesa(11).usuarioCreadorId).toBe(3);
    });

    it('una remesa que no existe: 404', async () => {
        const h = armar({ remesas: [cancelada(11)] });
        await expect(h.service.retomarRemesas({ remesaIds: [99] }, DUENO)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('G-22: addBulk falla al retomar: la remesa vuelve a FALLIDA "no llegó a empezar", retomable; 503; sin notificación', async () => {
        const h = armar({ remesas: [cancelada(11)], addBulk: 'RECHAZA' });

        await expect(h.service.retomarRemesas({ remesaIds: [11] }, DUENO)).rejects.toBeInstanceOf(ServiceUnavailableException);

        const f = h.remesa(11).progreso!;
        expect(h.remesa(11).estadoProceso).toBe('FALLIDA');
        expect(f).toMatchObject({ fase: 'TERMINADA', resultado: 'FALLIDA', startedAt: null });
        expect(f.finishedAt).not.toBeNull();
        expect(f.error).toContain('La importación no llegó a empezar');
        expect(f.error).toContain('«Retomar»');
        expect(f.resumen).toMatchObject({ v: 1, origen: expect.anything() }); // sigue siendo retomable
        expect(h.notificaciones.crear).not.toHaveBeenCalled();
        expect(h.realtime.emitImportProgreso).not.toHaveBeenCalled();
        // Y se puede volver a retomar.
        await expect(h.service.retomarRemesas({ remesaIds: [11] }, DUENO)).rejects.toBeInstanceOf(ServiceUnavailableException); // otra vez RECHAZA
    });

    it('G-23: retomar un grupo con dos retomables y una que procesó filas: se encolan dos, en orden; la tercera va en omitidas', async () => {
        const grupo = { grupoId: 'g1', grupoTotal: 3 };
        const h = armar({
            remesas: [
                cancelada(11, {}, { ...grupo, grupoOrden: 1 }),
                cancelada(12, {}, { ...grupo, grupoOrden: 2, startedAt: new Date(), ok: 500 }),
                cancelada(13, {}, { ...grupo, grupoOrden: 3 }),
            ],
        });

        const r = await h.service.retomarRemesas({ grupoId: 'g1' }, DUENO);

        expect(h.queue.addBulk.mock.calls[0][0].map((l: any) => l.data.remesaId)).toEqual([11, 13]);
        expect(r.cargas.map((c) => c.remesaId)).toEqual([11, 13]);
        expect(r.omitidas).toEqual([{ remesaId: 12, numeroRemesa: '00012', motivo: expect.stringContaining('ya procesó filas') }]);
        expect(h.remesa(12).estadoProceso).toBe('FALLIDA'); // intacta
        expect(h.remesa(12).progreso!.resultado).toBe('CANCELADA');
        // Si ninguna se puede, 409.
        const h2 = armar({ remesas: [cancelada(12, {}, { grupoId: 'g1', grupoOrden: 1, grupoTotal: 1, startedAt: new Date() })] });
        await expect(h2.service.retomarRemesas({ grupoId: 'g1' }, DUENO)).rejects.toBeInstanceOf(ConflictException);
    });

    it('SC-7 en miniatura: dos retomar simultáneos de la misma remesa: uno gana y el otro recibe 409; se encola una sola vez', async () => {
        const h = armar({ remesas: [cancelada(11)] });
        const [a, b] = await Promise.allSettled([
            h.service.retomarRemesas({ remesaIds: [11] }, DUENO),
            h.service.retomarRemesas({ remesaIds: [11] }, DUENO),
        ]);
        expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
        expect(h.queue.addBulk).toHaveBeenCalledTimes(1);
    });
});

/* ────────────────────────────────────────────────────────────────────────────
 * executeRemesa guarda el origen
 * ──────────────────────────────────────────────────────────────────────────── */
describe('executeRemesa guarda las remesas de origen (G-24)', () => {
    const armarEjecutar = () => {
        const updates: any[] = [];
        const tx: any = {
            $queryRaw: jest.fn().mockImplementation((strings: TemplateStringsArray) => {
                const sql = strings.join('?');
                if (sql.includes('FROM usuario')) return Promise.resolve([{ id: 3 }]);
                if (sql.includes('LEFT JOIN import_progreso')) return Promise.resolve([{ estadoProceso: 'VALIDANDO', totalFilas: 912, encoladaAt: null }]);
                return Promise.resolve([]);
            }),
            remesa: {
                update: jest.fn().mockImplementation(({ data }: any) => {
                    updates.push(data);
                    return Promise.resolve({
                        id: 1, empresaId: 10, numeroRemesa: '00001', nombre: 'C', categoria: 'DEUDORES', estadoProceso: 'PENDIENTE', totalFilas: 912,
                        okFilas: 0, errFilas: 0, usuarioCreadorId: 3, usuarioCreador: { id: 3, nombre: 'Maxi' },
                        progreso: { ...filaVacia(), ...data.progreso.upsert.create, remesaId: 1 },
                    });
                }),
            },
        };
        const prisma: any = {
            remesa: { findUnique: jest.fn().mockResolvedValue({ id: 1, categoria: 'DEUDORES' }), update: jest.fn().mockResolvedValue({}) },
            $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
            $queryRaw: jest.fn().mockResolvedValue([{ n: 0 }]),
        };
        const queue: any = { add: jest.fn().mockResolvedValue({ id: 'job-7' }) };
        const requestContext: any = { get: jest.fn().mockReturnValue(undefined) };
        const service = new ImportService(prisma, {} as any, queue, { emitImportProgreso: jest.fn() } as any, {} as any, requestContext, {} as any, {} as any, {} as any);
        return { service, updates, prisma };
    };

    it('su escritura transaccional lleva resumen { v: 1, origen } en el create y en el update, con null donde no hay origen', async () => {
        const h = armarEjecutar();
        await h.service.executeRemesa(1, 3, 77, [77, 78]);
        const { create, update } = h.updates[0].progreso.upsert;
        expect(create.resumen).toEqual({ v: 1, origen: { remesaOrigenId: 77, remesaOrigenIds: [77, 78] } });
        expect(update.resumen).toEqual({ v: 1, origen: { remesaOrigenId: 77, remesaOrigenIds: [77, 78] } });

        const h2 = armarEjecutar();
        await h2.service.executeRemesa(1, 3);
        expect(h2.updates[0].progreso.upsert.update.resumen).toEqual({ v: 1, origen: { remesaOrigenId: null, remesaOrigenIds: null } });
        // La escritura del jobId sigue siendo exactamente la de siempre.
        expect(h2.prisma.remesa.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { progreso: { update: { jobId: 'job-7' } } } });
    });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Cortes ya cargados (G-25 a G-27)
 * ──────────────────────────────────────────────────────────────────────────── */
describe('cortes ya cargados (§10.5.6)', () => {
    const sha = (x: Buffer | string) => crypto.createHash('sha256').update(x).digest('hex');
    /** La fórmula que ya está guardada en las remesas de hoy, escrita con `crypto` y no con el helper del código. */
    const hashDeHoy = (buffers: Buffer[]) => (buffers.length === 1 ? sha(buffers[0]) : sha(buffers.map(sha).sort().join('|')));

    const CSV = Buffer.from('cod;nomina\n001;N1\n002;N2\n003;N1\n004;N3\n005;N4\n006;N5\n', 'latin1');
    const CSV2 = Buffer.from('cod;nomina\n007;N1\n', 'latin1');
    const archivo = (buffer: Buffer, originalname = 'cartera.csv') => ({ originalname, buffer });
    const PLANTILLA = {
        id: 5, empresaId: 10, tieneHeader: true, separador: ';',
        mappingJson: { entity: 'DEUDOR', matchKeys: [], columns: { cod: { fromIndex: 0 } }, divisionRemesa: { cortes: [{ fromIndex: 1, etiqueta: 'Nómina' }] } },
    };

    /** Una remesa ya creada sobre ese archivo. */
    const previa = (id: number, nomina: string, o: Partial<{
        estadoProceso: string; hash: string; plantillaId: number; empresaId: number; progreso: any; casos: number; filtroFilas: unknown;
    }> = {}) => ({
        id, numeroRemesa: `P${id}`, empresaId: o.empresaId ?? 10, plantillaId: o.plantillaId ?? 5, archivoHash: o.hash ?? hashDeHoy([CSV]),
        estadoProceso: o.estadoProceso ?? 'FINALIZADA', filtroFilas: o.filtroFilas ?? CORTE1(nomina),
        progreso: o.progreso === undefined ? { fase: 'TERMINADA', encoladaAt: new Date(), startedAt: new Date(), finishedAt: new Date(), resumen: null } : o.progreso,
        _count: { deudor: o.casos ?? 0 },
    });
    const CORTE1 = (nomina: string) => [{ fromIndex: 1, operador: 'IGUAL', valor: nomina }];

    function armarCortes(previas: any[], saveBuffer?: jest.Mock) {
        const consultas: any[] = [];
        const creadas: any[] = [];
        const prisma: any = {
            plantillaimport: { findUnique: jest.fn().mockResolvedValue(PLANTILLA) },
            remesa: {
                findMany: jest.fn().mockImplementation(async ({ where }: any) => {
                    consultas.push(where);
                    // La búsqueda de cortes filtra por empresa + plantilla + hash; las demás (números) solo por empresa / numeroRemesa.
                    return previas.filter((r) =>
                        (where.empresaId === undefined || r.empresaId === where.empresaId) &&
                        (where.plantillaId === undefined || r.plantillaId === where.plantillaId) &&
                        (where.archivoHash === undefined || r.archivoHash === where.archivoHash) &&
                        (where.numeroRemesa?.in === undefined || where.numeroRemesa.in.includes(r.numeroRemesa)));
                }),
                create: jest.fn().mockImplementation(async ({ data }: any) => { creadas.push(data); return { id: 500 + creadas.length, ...data }; }),
            },
        };
        const files: any = {
            saveBuffer: saveBuffer ?? jest.fn().mockImplementation(async (f: any) => ({ path: `/uploads/${f.originalname}`, hash: sha(f.buffer) })),
        };
        const service = new ImportService(prisma, files, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
        return { service, prisma, consultas, creadas, files };
    }

    it('G-25: previewDivision con un archivo que ya tiene cortes: cada corte trae su yaCargado con la situación; un borrador y otra plantilla no cuentan', async () => {
        const previas = [
            previa(1, 'N1', { casos: 2 }), // FINALIZADA → CARGADA
            previa(2, 'N2', { estadoProceso: 'PENDIENTE', progreso: { fase: 'EN_COLA', encoladaAt: new Date(), startedAt: null, finishedAt: null, resumen: ORIGEN } }), // EN_CURSO
            previa(3, 'N3', { estadoProceso: 'FALLIDA', casos: 40, progreso: { fase: 'TERMINADA', encoladaAt: new Date(), startedAt: new Date(), finishedAt: new Date(), resumen: ORIGEN } }), // A_MEDIAS
            previa(4, 'N4', { estadoProceso: 'FALLIDA', progreso: { fase: 'TERMINADA', encoladaAt: new Date(), startedAt: null, finishedAt: new Date(), resumen: ORIGEN } }), // SIN_CARGAR (retomable)
            previa(5, 'N5', { estadoProceso: 'VALIDANDO', progreso: { fase: 'BORRADOR', encoladaAt: null, startedAt: null, finishedAt: null, resumen: null } }), // borrador: no cuenta
            previa(6, 'N1', { plantillaId: 99, estadoProceso: 'FINALIZADA' }), // otra plantilla: no cuenta
        ];
        const { service, consultas } = armarCortes(previas);

        const r: any = await service.previewDivision([archivo(CSV)], 5, 10);

        const porValor = Object.fromEntries(r.cortes.map((c: any) => [c.valores['Nómina'], c.yaCargado]));
        expect(porValor.N1).toEqual({ remesaId: 1, numeroRemesa: 'P1', situacion: 'CARGADA', casos: 2, retomable: false });
        expect(porValor.N2).toMatchObject({ remesaId: 2, situacion: 'EN_CURSO' });
        expect(porValor.N3).toEqual({ remesaId: 3, numeroRemesa: 'P3', situacion: 'A_MEDIAS', casos: 40, retomable: false });
        expect(porValor.N4).toEqual({ remesaId: 4, numeroRemesa: 'P4', situacion: 'SIN_CARGAR', casos: 0, retomable: true });
        expect(porValor.N5).toBeUndefined();
        // Se buscó por empresa + plantilla + el hash de lo subido.
        expect(consultas.some((w) => w.empresaId === 10 && w.plantillaId === 5 && w.archivoHash === hashDeHoy([CSV]))).toBe(true);
        // Y el resto de la respuesta es la de siempre.
        expect(r.total).toBe(6);
        expect(r.cortes.find((c: any) => c.valores['Nómina'] === 'N1').filas).toBe(2);
    });

    it('G-25b: una FALLIDA anterior a C1 que arrancó (sin marcador ni fila de resumen) cae en A_MEDIAS; sin casos y sin arrancar, SIN_CARGAR; la de mayor gravedad gana', async () => {
        const previas = [
            previa(1, 'N1', { estadoProceso: 'FALLIDA', progreso: { fase: 'TERMINADA', encoladaAt: new Date(), startedAt: new Date(), finishedAt: new Date(), resumen: null } }),
            previa(2, 'N2', { estadoProceso: 'FALLIDA', progreso: null }), // heredada, sin casos → SIN_CARGAR
            previa(3, 'N3', { estadoProceso: 'FALLIDA', casos: 5, progreso: null }), // heredada con casos → A_MEDIAS
            previa(7, 'N4', { estadoProceso: 'FALLIDA', progreso: { fase: 'TERMINADA', encoladaAt: new Date(), startedAt: null, finishedAt: new Date(), resumen: ORIGEN } }),
            previa(8, 'N4', { estadoProceso: 'FINALIZADA' }), // el mismo corte, también cargada: gana la de mayor gravedad
        ];
        const { service } = armarCortes(previas);
        const r: any = await service.previewDivision([archivo(CSV)], 5, 10);
        const porValor = Object.fromEntries(r.cortes.map((c: any) => [c.valores['Nómina'], c.yaCargado]));
        expect(porValor.N1.situacion).toBe('A_MEDIAS');
        expect(porValor.N2.situacion).toBe('SIN_CARGAR');
        expect(porValor.N3.situacion).toBe('A_MEDIAS');
        expect(porValor.N4).toMatchObject({ remesaId: 8, situacion: 'CARGADA' });
    });

    it('G-26: el hash de la vista de cortes y el del alta son el mismo, y es el de la fórmula de hoy (calculado con crypto, no con el helper)', async () => {
        for (const buffers of [[CSV], [CSV, CSV2], [CSV2, CSV]]) {
            const subidos = buffers.map((b, i) => archivo(b, `a${i}.csv`));
            const esperado = hashDeHoy(buffers);

            // Vista de cortes.
            const v = armarCortes([]);
            await v.service.previewDivision(subidos, 5, 10);
            const buscado = v.consultas.map((w) => w.archivoHash).filter(Boolean);
            expect(buscado).toEqual([esperado]);

            // Alta (el storage real devuelve el SHA-256 de cada archivo: lo mismo hace el mock).
            const a = armarCortes([]);
            await a.service.createRemesa({ empresaId: 10, nombre: 'C', categoria: 'DEUDORES', plantillaId: 5 } as any, subidos);
            expect(a.creadas[0].archivoHash).toBe(esperado);
        }
        // Distinto orden de los mismos archivos: el mismo hash.
        expect(hashDeHoy([CSV, CSV2])).toBe(hashDeHoy([CSV2, CSV]));
    });

    it('G-26b: una división cargada ANTES de C1 (su archivoHash es el de la fórmula de siempre) se reconoce', async () => {
        const { service } = armarCortes([previa(1, 'N1', { hash: hashDeHoy([CSV, CSV2]), casos: 2 })]);
        const r: any = await service.previewDivision([archivo(CSV), archivo(CSV2, 'b.csv')], 5, 10);
        expect(r.cortes.find((c: any) => c.valores['Nómina'] === 'N1').yaCargado).toMatchObject({ remesaId: 1, situacion: 'CARGADA' });
    });

    describe('G-27: el alta con cortes ya cargados', () => {
        const dto = (repetir?: boolean) => ({
            empresaId: 10, nombre: 'AYSA', categoria: 'DEUDORES', plantillaId: 5,
            divisiones: [
                { valores: { 'Nómina': 'N1' }, numeroRemesa: '900', filtros: CORTE1('N1'), ...(repetir ? { repetir } : {}) },
                { valores: { 'Nómina': 'N2' }, numeroRemesa: '901', filtros: CORTE1('N2') },
            ],
        }) as any;

        it('con un corte CARGADA: 409 que lo nombra, sin crear ninguna remesa', async () => {
            const { service, creadas } = armarCortes([previa(1, 'N1', { casos: 2 })]);

            await expect(service.createRemesa(dto(), [archivo(CSV)])).rejects.toBeInstanceOf(ConflictException);
            await expect(service.createRemesa(dto(), [archivo(CSV)])).rejects.toThrow(
                /Este archivo ya tiene cortes cargados: Nómina N1 en la remesa P1 \(ya cargada\)\. Destildalos, o confirmá que querés cargarlos de nuevo: sus casos van a quedar duplicados\./,
            );
            expect(creadas).toHaveLength(0);
        });

        it('el 409 nombra TODOS los cortes repetidos, con su situación', async () => {
            const { service } = armarCortes([
                previa(1, 'N1'),
                previa(2, 'N2', { estadoProceso: 'FALLIDA', casos: 9, progreso: { fase: 'TERMINADA', encoladaAt: new Date(), startedAt: new Date(), finishedAt: new Date(), resumen: null } }),
            ]);
            const e: any = await service.createRemesa(dto(), [archivo(CSV)]).catch((x) => x);
            expect(e).toBeInstanceOf(ConflictException);
            expect(e.message).toContain('Nómina N1 en la remesa P1 (ya cargada)');
            expect(e.message).toContain('Nómina N2 en la remesa P2 (quedó a medias)');
        });

        it('con repetir: true en ese corte: las crea (y lo deja en el log)', async () => {
            const { service, creadas } = armarCortes([previa(1, 'N1')]);
            const r = await service.createRemesa(dto(true), [archivo(CSV)]);
            expect(creadas).toHaveLength(2);
            expect(r.remesaIds).toHaveLength(2);
            expect(warn.mock.calls.some(([m]) => String(m).includes('repetir=true'))).toBe(true);
        });

        it('repetir en un corte NO salva a otro corte repetido que no lo trae', async () => {
            const { service, creadas } = armarCortes([previa(1, 'N1'), previa(2, 'N2')]);
            await expect(service.createRemesa(dto(true), [archivo(CSV)])).rejects.toThrow(/Nómina N2 en la remesa P2/);
            expect(creadas).toHaveLength(0);
        });

        it('con un corte SIN_CARGAR: las crea, sin pedir nada', async () => {
            const { service, creadas } = armarCortes([
                previa(1, 'N1', { estadoProceso: 'FALLIDA', progreso: { fase: 'TERMINADA', encoladaAt: new Date(), startedAt: null, finishedAt: new Date(), resumen: ORIGEN } }),
            ]);
            await service.createRemesa(dto(), [archivo(CSV)]);
            expect(creadas).toHaveLength(2);
        });

        it('un borrador sin confirmar del mismo corte no bloquea; tampoco el mismo archivo con otra plantilla', async () => {
            const { service, creadas } = armarCortes([
                previa(1, 'N1', { estadoProceso: 'VALIDANDO', progreso: { fase: 'BORRADOR', encoladaAt: null, startedAt: null, finishedAt: null, resumen: null } }),
                previa(2, 'N2', { plantillaId: 99 }),
            ]);
            await service.createRemesa(dto(), [archivo(CSV)]);
            expect(creadas).toHaveLength(2);
        });

        it('una carga sin dividir no pasa por la guarda', async () => {
            const { service, creadas, prisma } = armarCortes([previa(1, 'N1')]);
            await service.createRemesa({ empresaId: 10, nombre: 'C', categoria: 'DEUDORES', plantillaId: 5 } as any, [archivo(CSV)]);
            expect(creadas).toHaveLength(1);
            expect(prisma.remesa.findMany.mock.calls.every(([a]: any) => a.where.archivoHash === undefined)).toBe(true);
        });
    });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Lo que cierra el reaper nunca lleva el marcador (§10.5.4)
 * ──────────────────────────────────────────────────────────────────────────── */
describe('cerrarCargaInterrumpida y el marcador de "no entregó filas"', () => {
    const escrituraDe = (h: H, id: number) => h.escrituras.find((e) => e.id === id)!.data.progreso.update;

    it('SIN_JOB sobre una carga confirmada con C1 (tiene resumen.origen): el texto manda a «Retomar», es retomable y NO escribe resumen', async () => {
        const h = armar({ remesas: [enCola(11)] });

        const estado = await h.service.cerrarCargaInterrumpida(11, 'SIN_JOB');

        expect(estado).toMatchObject({ resultado: 'FALLIDA', retomable: true, cancelada: false });
        expect(estado!.error).toContain('La importación no llegó a empezar');
        expect(estado!.error).toContain('«Retomar»');
        expect(estado!.error).not.toContain('volvé a importar el archivo');
        expect('resumen' in escrituraDe(h, 11)).toBe(false); // el marcador lo escribe solo el runner vivo
        expect(h.remesa(11).progreso!.resumen).toEqual(ORIGEN);
    });

    it('SIN_JOB sobre una carga anterior a C1 (sin resumen): el texto de siempre y no retomable', async () => {
        const h = armar({ remesas: [enCola(11, {}, { resumen: null })] });

        const estado = await h.service.cerrarCargaInterrumpida(11, 'SIN_JOB');

        expect(estado).toMatchObject({ retomable: false });
        expect(estado!.error).toContain('No se cargó ninguna fila: volvé a importar el archivo.');
        expect(estado!.error).not.toContain('Retomar');
    });

    it('SIN_LATIDO sobre una carga que arrancó: nunca retomable, aunque sus contadores estén en cero, y no escribe resumen', async () => {
        const h = armar({
            remesas: [procesando(11, { heartbeatAt: new Date(Date.now() - 20 * 60_000), ok: 0, err: 0, startedAt: new Date(Date.now() - 30 * 60_000) })],
        });

        const estado = await h.service.cerrarCargaInterrumpida(11, 'SIN_LATIDO');

        expect(estado).toMatchObject({ resultado: 'FALLIDA', retomable: false });
        expect(estado!.error).not.toContain('Retomar');
        expect('resumen' in escrituraDe(h, 11)).toBe(false);
        expect(h.remesa(11).progreso!.resumen).toEqual(ORIGEN);
        // Y el endpoint de retomar la rechaza.
        await expect(h.service.retomarRemesas({ remesaIds: [11] }, DUENO)).rejects.toThrow(/ya procesó filas/);
    });

    it('REENTREGA tampoco es retomable', async () => {
        const h = armar({ remesas: [procesando(11)] });
        const estado = await h.service.cerrarCargaInterrumpida(11, 'REENTREGA');
        expect(estado).toMatchObject({ retomable: false });
        expect('resumen' in escrituraDe(h, 11)).toBe(false);
    });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Ronda de arreglos tras la auditoría del backend
 * ──────────────────────────────────────────────────────────────────────────── */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { EjecutarGrupoDto } from './dtos/import.dto';

const ahoraMenos = (min: number) => new Date(Date.now() - min * 60_000);
/** Otra remesa del MISMO corte (N11, el de `borrador(11)`) ya confirmada: `confirmadaHace` minutos. */
const otraDelMismoCorte = (id: number, estado: 'CARGADA' | 'EN_CURSO' | 'A_MEDIAS' | 'SIN_CARGAR', confirmadaHace: number, nomina = 'N11'): Rem => {
    const encoladaAt = ahoraMenos(confirmadaHace);
    const base = { filtroFilas: CORTE(nomina), usuarioCreadorId: 8, numeroRemesa: `X${id}`, createdAt: ahoraMenos(confirmadaHace + 5) };
    if (estado === 'CARGADA') return borrador(id, { ...base, estadoProceso: 'FINALIZADA', casos: 4, progreso: filaVacia({ fase: 'TERMINADA', encoladaAt, startedAt: encoladaAt, finishedAt: new Date(), resultado: 'OK' }) });
    if (estado === 'EN_CURSO') return borrador(id, { ...base, estadoProceso: 'PENDIENTE', progreso: filaVacia({ fase: 'EN_COLA', encoladaAt }) });
    if (estado === 'A_MEDIAS') return borrador(id, { ...base, estadoProceso: 'FALLIDA', casos: 40, progreso: filaVacia({ fase: 'TERMINADA', encoladaAt, startedAt: encoladaAt, finishedAt: new Date(), resultado: 'FALLIDA', resumen: ORIGEN }) });
    return borrador(id, { ...base, estadoProceso: 'FALLIDA', progreso: filaVacia({ fase: 'TERMINADA', encoladaAt, finishedAt: new Date(), resultado: 'FALLIDA', resumen: ORIGEN }) });
};

describe('hallazgo 2: la guarda de cortes también al confirmar', () => {
    const TEXTO = (n: string, o: string) =>
        `El corte de la remesa ${n} ya figura en la remesa ${o}, que se confirmó después de armar esta vista previa: no se puede confirmar. Eliminá esta vista previa.`;

    it.each(['CARGADA', 'EN_CURSO', 'A_MEDIAS'] as const)(
        'ejecutarGrupo: otra del mismo corte %s confirmada después de armar esta: 409 con el texto exacto y no se encola ninguna', async (estado) => {
            const h = armar({ remesas: [borrador(11), borrador(12), otraDelMismoCorte(70, estado, 10)] });
            const antes = JSON.stringify([...h.db.values()].filter((r) => r.id < 70));

            await expect(h.service.ejecutarGrupo({ remesaIds: [11, 12] }, 3)).rejects.toBeInstanceOf(ConflictException);
            await expect(h.service.ejecutarGrupo({ remesaIds: [11, 12] }, 3)).rejects.toThrow(TEXTO('00011', 'X70'));

            expect(JSON.stringify([...h.db.values()].filter((r) => r.id < 70))).toBe(antes);
            expect(h.queue.addBulk).not.toHaveBeenCalled();
        },
    );

    it('en un grupo nombra todas las que chocan, y no encola ninguna', async () => {
        const h = armar({ remesas: [borrador(11), borrador(12), otraDelMismoCorte(70, 'CARGADA', 10, 'N11'), otraDelMismoCorte(71, 'EN_CURSO', 10, 'N12')] });
        const e: any = await h.service.ejecutarGrupo({ remesaIds: [11, 12] }, 3).catch((x) => x);
        expect(e).toBeInstanceOf(ConflictException);
        expect(e.message).toContain('la remesa 00011 ya figura en la remesa X70');
        expect(e.message).toContain('la remesa 00012 ya figura en la remesa X71');
        expect(h.queue.addBulk).not.toHaveBeenCalled();
        expect(h.remesa(11).progreso!.fase).toBe('BORRADOR');
    });

    it('respeta el `repetir`: lo que ya estaba cargado cuando se creó esta remesa no frena (el alta ya lo vio); un SIN_CARGAR tampoco', async () => {
        const antiguas = armar({ remesas: [borrador(11), borrador(12), otraDelMismoCorte(70, 'CARGADA', 600)] }); // confirmada hace 10 h, la remesa se creó hace 1 h
        await expect(antiguas.service.ejecutarGrupo({ remesaIds: [11, 12] }, 3)).resolves.toMatchObject({ cargas: expect.any(Array) });
        const sinCargar = armar({ remesas: [borrador(11), borrador(12), otraDelMismoCorte(70, 'SIN_CARGAR', 10)] });
        await expect(sinCargar.service.ejecutarGrupo({ remesaIds: [11, 12] }, 3)).resolves.toBeDefined();
    });

    it('otro corte, otro archivo u otra plantilla no chocan', async () => {
        const otras = [
            otraDelMismoCorte(70, 'CARGADA', 10, 'N99'),
            { ...otraDelMismoCorte(71, 'CARGADA', 10), archivoHash: 'hash-B' },
            { ...otraDelMismoCorte(72, 'CARGADA', 10), plantillaId: 99 },
        ];
        const h = armar({ remesas: [borrador(11), borrador(12), ...otras] });
        await expect(h.service.ejecutarGrupo({ remesaIds: [11, 12] }, 3)).resolves.toBeDefined();
    });

    describe('executeRemesa', () => {
        const armarEjecutar = (otras: Rem[]) => {
            const yo = borrador(11);
            const fila = {
                estadoProceso: 'VALIDANDO', totalFilas: 111, encoladaAt: null, numeroRemesa: yo.numeroRemesa, empresaId: 10, plantillaId: 5,
                archivoHash: 'hash-A', filtroFilas: yo.filtroFilas, createdAt: yo.createdAt,
            };
            const updates: any[] = [];
            const tx: any = {
                $queryRaw: jest.fn().mockImplementation((strings: TemplateStringsArray) => {
                    const sql = strings.join('?');
                    if (sql.includes('FROM usuario')) return Promise.resolve([{ id: 3 }]);
                    if (sql.includes('LEFT JOIN import_progreso')) return Promise.resolve([fila]);
                    return Promise.resolve([]);
                }),
                remesa: {
                    findMany: jest.fn().mockResolvedValue(otras.map((r) => ({ ...r, _count: { deudor: r.casos } }))),
                    update: jest.fn().mockImplementation(({ data }: any) => {
                        updates.push(data);
                        return Promise.resolve({
                            id: 11, empresaId: 10, numeroRemesa: '00011', nombre: 'C', categoria: 'DEUDORES', estadoProceso: 'PENDIENTE', totalFilas: 111,
                            okFilas: 0, errFilas: 0, usuarioCreadorId: 3, usuarioCreador: { id: 3, nombre: 'Maxi' },
                            progreso: { ...filaVacia(), ...data.progreso.upsert.create, remesaId: 11 },
                        });
                    }),
                },
            };
            const prisma: any = {
                remesa: { findUnique: jest.fn().mockResolvedValue({ id: 11, categoria: 'DEUDORES' }), update: jest.fn().mockResolvedValue({}) },
                $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
                $queryRaw: jest.fn().mockResolvedValue([{ n: 0 }]),
            };
            const queue: any = { add: jest.fn().mockResolvedValue({ id: 'job-7' }) };
            const requestContext: any = { get: jest.fn().mockReturnValue(undefined) };
            const service = new ImportService(prisma, {} as any, queue, { emitImportProgreso: jest.fn() } as any, {} as any, requestContext, {} as any, {} as any, {} as any);
            return { service, updates, queue };
        };

        it('otra del mismo corte confirmada después: 409 con el texto exacto, sin encolar', async () => {
            const h = armarEjecutar([otraDelMismoCorte(70, 'EN_CURSO', 10)]);
            await expect(h.service.executeRemesa(11, 3)).rejects.toThrow(TEXTO('00011', 'X70'));
            expect(h.updates).toHaveLength(0);
            expect(h.queue.add).not.toHaveBeenCalled();
        });

        it('sin otra que choque confirma, y limpia cancelSolicitadaAt (hallazgo 6)', async () => {
            const h = armarEjecutar([otraDelMismoCorte(70, 'CARGADA', 600), otraDelMismoCorte(71, 'SIN_CARGAR', 10)]);
            await h.service.executeRemesa(11, 3);
            expect(h.updates[0].progreso.upsert.update.cancelSolicitadaAt).toBeNull();
            expect(h.queue.add).toHaveBeenCalledTimes(1);
        });
    });

    it('hallazgo 7: retomar una cancelada cuyo corte ya se cargó en otra remesa confirmada después: 409 con el texto exacto, nada escrito', async () => {
        const vieja = cancelada(11, { createdAt: ahoraMenos(120) });
        const h = armar({ remesas: [vieja, otraDelMismoCorte(70, 'CARGADA', 30, 'N11')] });
        const antes = JSON.stringify(h.remesa(11));

        await expect(h.service.retomarRemesas({ remesaIds: [11] }, DUENO)).rejects.toBeInstanceOf(ConflictException);
        await expect(h.service.retomarRemesas({ remesaIds: [11] }, DUENO)).rejects.toThrow(
            'El corte de esta remesa ya figura en la remesa X70: no se puede retomar. Si esta ya no hace falta, eliminala desde el Historial.',
        );

        expect(JSON.stringify(h.remesa(11))).toBe(antes);
        expect(h.queue.addBulk).not.toHaveBeenCalled();
    });

    it('retomar sin otra que choque sigue andando (la otra es SIN_CARGAR o más vieja)', async () => {
        const h = armar({ remesas: [cancelada(11, { createdAt: ahoraMenos(120) }), otraDelMismoCorte(70, 'SIN_CARGAR', 30, 'N11'), otraDelMismoCorte(71, 'CARGADA', 600, 'N11')] });
        await expect(h.service.retomarRemesas({ remesaIds: [11] }, DUENO)).resolves.toBeDefined();
    });
});

describe('hallazgos 4, 5, 6 y menores', () => {
    it('hallazgo 4: los import:progreso EN_COLA salen todos antes de la primera escritura de un jobId', async () => {
        const h = tres();
        await h.service.ejecutarGrupo({ remesaIds: [11, 12, 13] }, 3);
        const ultimoEvento = h.orden.map((o, i) => (o.startsWith('progreso:') ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
        const primerJob = h.orden.findIndex((o) => o.startsWith('jobid:'));
        expect(ultimoEvento).toBeGreaterThanOrEqual(0);
        expect(primerJob).toBeGreaterThan(ultimoEvento);
    });

    it('hallazgo 5: una remesa que termina mientras se recorre el grupo sale YA_TERMINADA, no RECHAZADA', async () => {
        const grupo = { grupoId: 'g1', grupoTotal: 3 };
        const h = armar({ remesas: [enCola(11, {}, { ...grupo, grupoOrden: 1 }), enCola(12, {}, { ...grupo, grupoOrden: 2 }), enCola(13, {}, { ...grupo, grupoOrden: 3 })] });
        h.queue.getJob.mockResolvedValue(null);
        const original = h.service.cancelarCarga.bind(h.service);
        jest.spyOn(h.service, 'cancelarCarga').mockImplementation(async (id, user) => {
            // Mientras se cancela la 13, la 12 termina bien.
            if (id === 13) Object.assign(h.remesa(12), { estadoProceso: 'FINALIZADA', progreso: { ...h.remesa(12).progreso!, fase: 'TERMINADA', finishedAt: new Date(), resultado: 'OK' } });
            return original(id, user);
        });

        const r = await h.service.cancelarGrupo('g1', DUENO);

        expect(r.resultados.map((x) => [x.remesaId, x.efecto])).toEqual([[11, 'CANCELADA'], [12, 'YA_TERMINADA'], [13, 'CANCELADA']]);
        expect(r.resultados[1].motivo).toBeUndefined();
        expect(r.resultados[1].carga).toMatchObject({ terminal: true, resultado: 'OK' });
    });

    it('hallazgo 6: retomar vuelve startedAt, finishedAt y cancelSolicitadaAt a null aunque la remesa hubiera arrancado (con el marcador)', async () => {
        const h = armar({ remesas: [cancelada(11, {}, { startedAt: new Date(), heartbeatAt: new Date(), resumen: { ...ORIGEN, sinFilasEntregadas: true } })] });
        await h.service.retomarRemesas({ remesaIds: [11] }, DUENO);
        expect(h.remesa(11).progreso).toMatchObject({ startedAt: null, finishedAt: null, cancelSolicitadaAt: null, heartbeatAt: null, intentos: 0 });
    });

    it('hallazgo 6: confirmar un grupo limpia cancelSolicitadaAt de borradores que lo traían', async () => {
        const h = armar({
            remesas: [borrador(11, { progreso: filaVacia({ cancelSolicitadaAt: new Date() }) }), borrador(12, { progreso: filaVacia({ cancelSolicitadaAt: new Date() }) })],
        });
        await h.service.ejecutarGrupo({ remesaIds: [11, 12] }, 3);
        expect(h.remesa(11).progreso!.cancelSolicitadaAt).toBeNull();
        expect(h.remesa(12).progreso!.cancelSolicitadaAt).toBeNull();
    });

    it('menor: retomar la remesa de otro usuario cuyo dueño tiene una carga en curso dice que es el dueño el que la tiene', async () => {
        const h = armar({ remesas: [cancelada(11), procesando(60, {}, { usuarioCreadorId: 3 })] });
        await expect(h.service.retomarRemesas({ remesaIds: [11] }, OTRO_CON_PERMISO)).rejects.toThrow(
            'El dueño de esta remesa ya tiene una importación en curso. Esperá a que termine antes de retomarla.',
        );
        // Y si quien la retoma es el dueño, sigue diciendo "Ya tenés".
        await expect(h.service.retomarRemesas({ remesaIds: [11] }, DUENO)).rejects.toThrow(/Ya tenés una importación en curso/);
    });

    it('menor: los 400 del DTO de ejecutar-grupo salen en español', async () => {
        const mensajes = async (o: object) =>
            (await validate(plainToInstance(EjecutarGrupoDto, o))).flatMap((e) => Object.values(e.constraints ?? {}));
        expect(await mensajes({ remesaIds: [1] })).toEqual(['Una carga dividida necesita al menos 2 remesas.']);
        expect(await mensajes({ remesaIds: Array.from({ length: 101 }, (_, i) => i + 1) })).toEqual(['Una carga dividida admite como máximo 100 remesas.']);
        expect(await mensajes({})).toContain('Las remesas de la carga dividida tienen que ser una lista.');
        expect(await mensajes({ remesaIds: [1, 'a'] })).toEqual(['Cada remesa de la carga dividida tiene que ser un número entero.']);
        expect(await mensajes({ remesaIds: [1, 2], remesaOrigenId: 'x' })).toEqual(['La remesa de origen tiene que ser un número entero.']);
        expect((await mensajes({ remesaIds: [1, 2], remesaOrigenIds: ['x'] }))).toEqual(['Cada remesa de origen tiene que ser un número entero.']);
        for (const m of await mensajes({ remesaIds: [1], remesaOrigenId: 'x' })) expect(m).not.toMatch(/must|should/i);
    });
});

describe('hallazgo 8: omitidas al retomar un grupo', () => {
    it('solo van las fallidas que no se pueden retomar; las finalizadas y las que siguen en curso no', async () => {
        const grupo = { grupoId: 'g1', grupoTotal: 4 };
        const h = armar({
            remesas: [
                borrador(11, { estadoProceso: 'FINALIZADA', progreso: filaVacia({ ...grupo, grupoOrden: 1, fase: 'TERMINADA', encoladaAt: new Date(), finishedAt: new Date(), resultado: 'OK', resumen: ORIGEN }) }),
                cancelada(12, {}, { ...grupo, grupoOrden: 2 }), // retomable
                cancelada(13, {}, { ...grupo, grupoOrden: 3, startedAt: new Date(), ok: 40 }), // fallida que procesó filas: omitida
                procesando(14, { ...grupo, grupoOrden: 4 }, { usuarioCreadorId: 8 }), // sigue en curso (de otro dueño: no frena a las demás)
            ],
        });
        const r = await h.service.retomarRemesas({ grupoId: 'g1' }, OTRO_CON_PERMISO);
        expect(r.cargas.map((c) => c.remesaId)).toEqual([12]);
        expect(r.omitidas).toEqual([{ remesaId: 13, numeroRemesa: '00013', motivo: expect.stringContaining('ya procesó filas') }]);
    });
});

describe('hallazgo 10: lo que el frontend necesita, afirmado', () => {
    /** Todo `EstadoCargaDto` que sale del backend: nunca `CANCELADA` en el cable, y siempre con los campos del grupo. */
    const cable = (h: H, extra: any[] = []) => [...h.eventos.map((e) => e.estado), ...extra];
    const sinCancelada = (dtos: any[]) => {
        expect(dtos.length).toBeGreaterThan(0);
        for (const d of dtos) {
            expect(d.resultado).not.toBe('CANCELADA');
            expect(d).toHaveProperty('grupoId');
            expect(d).toHaveProperty('cancelada');
        }
    };

    it('ejecutarGrupo, cancelarCarga y cancelarGrupo: todos los eventos y cargas traen grupoId; nunca resultado CANCELADA', async () => {
        const h = armar({ remesas: [borrador(11), borrador(12), borrador(13)] });
        h.queue.getJob.mockResolvedValue(null);
        const g = await h.service.ejecutarGrupo({ remesaIds: [11, 12, 13] }, 3);
        for (const c of g.cargas) expect(c.grupoId).toBe(g.grupoId);
        for (const e of h.eventos) expect(e.estado.grupoId).toBe(g.grupoId);

        const c = await h.service.cancelarCarga(13, DUENO); // en cola, sin job: CANCELADA
        expect(c.carga).toMatchObject({ grupoId: g.grupoId, grupoOrden: 3, cancelada: true, resultado: 'FALLIDA' });
        const cg = await h.service.cancelarGrupo(g.grupoId, DUENO);
        for (const r of cg.resultados) expect(r.carga.grupoId).toBe(g.grupoId);
        const finalizadas = h.eventos.filter((e) => e.evento === 'finalizada');
        expect(finalizadas.length).toBe(3);
        for (const e of finalizadas) expect(e.estado).toMatchObject({ grupoId: g.grupoId, cancelada: true, resultado: 'FALLIDA' });
        sinCancelada(cable(h, [...g.cargas, c.carga, ...cg.resultados.map((r) => r.carga)]));
        expect((await h.service.grupo(g.grupoId)).remesas.every((r) => r.grupoId === g.grupoId && r.resultado !== ('CANCELADA' as any))).toBe(true);
    });

    it('cancelar un pedido sobre una que corre emite import:progreso con grupoId', async () => {
        const h = armar({ remesas: [procesando(11, { grupoId: 'gg', grupoOrden: 2, grupoTotal: 3 })] });
        await h.service.cancelarCarga(11, DUENO);
        expect(h.eventos).toHaveLength(1);
        expect(h.eventos[0].estado).toMatchObject({ grupoId: 'gg', grupoOrden: 2, grupoTotal: 3 });
    });

    it('retomar: la carga del 201 trae un rev mayor que el del estado terminal, enCurso, retomable false, cancelada false y cancelacionPedidaAt null; los eventos traen grupoId', async () => {
        const h = armar({ remesas: [cancelada(11, {}, { grupoId: 'gg', grupoOrden: 1, grupoTotal: 2, rev: 40 })] });
        const r = await h.service.retomarRemesas({ remesaIds: [11] }, DUENO);
        expect(r.cargas[0].rev).toBeGreaterThan(40);
        expect(r.cargas[0]).toMatchObject({
            enCurso: true, terminal: false, fase: 'EN_COLA', retomable: false, cancelada: false, cancelacionPedidaAt: null, grupoId: 'gg', resultado: null,
        });
        expect(h.eventos[0].estado).toMatchObject({ grupoId: 'gg', rev: r.cargas[0].rev, retomable: false, cancelacionPedidaAt: null });
        sinCancelada([...cable(h), ...r.cargas]);
    });

    it('la compensación de un encolado parcial devuelve las cargas que quedaron con su grupoId', async () => {
        const h = armar({ remesas: [borrador(11), borrador(12), borrador(13)], addBulk: 'RECHAZA_Y_SE_TOMA_UNA' });
        const r = await h.service.ejecutarGrupo({ remesaIds: [11, 12, 13] }, 3);
        expect(r.cargas.length).toBeGreaterThan(0);
        for (const c of r.cargas) expect(c.grupoId).not.toBeNull();
        sinCancelada(r.cargas);
    });

    it('el cierre del reaper (cerrarCargaInterrumpida) emite import:finalizada con grupoId', async () => {
        const h = armar({ remesas: [enCola(11, {}, { grupoId: 'gg', grupoOrden: 1, grupoTotal: 2 })] });
        const e = await h.service.cerrarCargaInterrumpida(11, 'SIN_JOB');
        expect(e).toMatchObject({ grupoId: 'gg', grupoOrden: 1, grupoTotal: 2 });
        expect(h.eventos[0]).toMatchObject({ evento: 'finalizada', estado: { grupoId: 'gg' } });
        sinCancelada(cable(h));
    });

    it('createRemesa devuelve remesaIds en el mismo orden que divisiones', async () => {
        const previas: any[] = [];
        const creadas: any[] = [];
        const prisma: any = {
            plantillaimport: { findUnique: jest.fn().mockResolvedValue({ id: 5, tieneHeader: true, mappingJson: { entity: 'DEUDOR', matchKeys: [], columns: {}, divisionRemesa: { cortes: [{ fromIndex: 1, etiqueta: 'Nómina' }] } } }) },
            remesa: {
                findMany: jest.fn().mockResolvedValue(previas),
                create: jest.fn().mockImplementation(async ({ data }: any) => { creadas.push(data); return { id: 900 - creadas.length }; }), // ids decrecientes: el orden NO sale de ordenar por id
            },
        };
        const files: any = { saveBuffer: jest.fn().mockResolvedValue({ path: '/x', hash: 'h' }) };
        const service = new ImportService(prisma, files, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
        const dto: any = {
            empresaId: 10, nombre: 'C', categoria: 'DEUDORES', plantillaId: 5,
            divisiones: ['N3', 'N1', 'N2'].map((n, i) => ({ valores: { 'Nómina': n }, numeroRemesa: String(700 + i), filtros: [{ fromIndex: 1, operador: 'IGUAL', valor: n }] })),
        };
        const r = await service.createRemesa(dto, [{ originalname: 'a.csv', buffer: Buffer.from('x') }]);
        expect(creadas.map((c) => c.divisionValores['Nómina'])).toEqual(['N3', 'N1', 'N2']);
        expect(r.remesaIds).toEqual([899, 898, 897]);
        expect(r.remesaId).toBe(899);
    });
});
