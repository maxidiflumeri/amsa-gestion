/**
 * Cierre por interrupción, estado del job, las dos carreras de §8.13, posición en la cola y vista previa
 * de una remesa con corte (docs/imports-progreso-realtime-spec.md §9.9.2 F, casos H-1 a H-16).
 * `prisma` mockeado, como en `imports-progreso-http.spec.ts` (que no se toca).
 */
import { BadRequestException, ConflictException, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ImportService } from './imports.service';

let dir: string;
beforeAll(() => {
    Logger.overrideLogger(false);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imports-http-fase-b-'));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
afterEach(() => jest.restoreAllMocks());

const FILA = {
    remesaId: 1, rev: 3, fase: 'EN_COLA', subfase: null, porcentaje: 0, totalEsperado: 0, procesadas: 0, ok: 0, err: 0,
    descartadas: 0, fueraDeCorte: null, advertencias: 0, nuevos: null, actualizados: null, resultado: null, error: null,
    errorPostProceso: null, resumen: null, intentos: 0, jobId: null, grupoId: null, grupoOrden: null, grupoTotal: null,
    cancelSolicitadaAt: null, encoladaAt: null, startedAt: null, heartbeatAt: null, finishedAt: null,
};
const REMESA = {
    id: 1, empresaId: 10, numeroRemesa: '00001', nombre: 'Carga', categoria: 'DEUDORES', estadoProceso: 'VALIDANDO',
    totalFilas: 912, okFilas: 0, errFilas: 0, usuarioCreadorId: 3, usuarioCreador: { id: 3, nombre: 'Maxi' },
};
const MIN = 60_000;

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('cerrarCargaInterrumpida', () => {
    const AHORA = Date.now();

    function armar(fila: Record<string, unknown> | null, o: { categoria?: string; filtroFilas?: unknown; falla?: 'notificacion' | 'socket' | 'auditoria' } = {}) {
        const orden: string[] = [];
        const remesaRow: any = { ...REMESA, categoria: o.categoria ?? 'DEUDORES', estadoProceso: 'PROCESANDO', filtroFilas: o.filtroFilas ?? null };
        const progreso: any = { ...FILA, fase: 'PROCESANDO', ...fila };
        const tx: any = {
            $queryRaw: jest.fn().mockImplementation(() => {
                orden.push('lock');
                return Promise.resolve(fila === null ? [] : [{
                    estadoProceso: remesaRow.estadoProceso, categoria: remesaRow.categoria, filtroFilas: remesaRow.filtroFilas, encoladaAt: progreso.encoladaAt,
                    startedAt: progreso.startedAt, heartbeatAt: progreso.heartbeatAt, finishedAt: progreso.finishedAt,
                    ok: progreso.ok, err: progreso.err, jobId: progreso.jobId,
                }]);
            }),
            remesa: {
                update: jest.fn().mockImplementation(({ data }: any) => {
                    orden.push('update');
                    return Promise.resolve({
                        ...remesaRow, estadoProceso: data.estadoProceso, okFilas: data.okFilas, errFilas: data.errFilas,
                        progreso: { ...progreso, ...data.progreso.update, rev: progreso.rev + 1 },
                    });
                }),
            },
        };
        const prisma: any = {
            $transaction: jest.fn().mockImplementation(async (fn: any) => { const r = await fn(tx); orden.push('commit'); return r; }),
        };
        const realtime: any = {
            emitImportFinalizada: jest.fn().mockImplementation(() => { orden.push('socket'); if (o.falla === 'socket') throw new Error('socket caído'); }),
        };
        const notificaciones: any = {
            crear: jest.fn().mockImplementation(() => { orden.push('notificacion'); return o.falla === 'notificacion' ? Promise.reject(new Error('lock')) : Promise.resolve(); }),
        };
        const auditoria: any = {
            log: jest.fn().mockImplementation(() => { orden.push('auditoria'); return o.falla === 'auditoria' ? Promise.reject(new Error('audit caída')) : Promise.resolve(); }),
        };
        const service = new ImportService(prisma, {} as any, {} as any, realtime, notificaciones, {} as any, {} as any, {} as any, auditoria);
        return { service, prisma, tx, realtime, notificaciones, auditoria, orden };
    }

    const arrancada = (over: Record<string, unknown> = {}) => ({
        encoladaAt: new Date(AHORA - 30 * MIN), startedAt: new Date(AHORA - 20 * MIN), heartbeatAt: new Date(AHORA - 10 * MIN),
        finishedAt: null, ok: 300, err: 2, procesadas: 302, jobId: '7', ...over,
    });

    it('H-1: sobre una remesa terminal, un borrador, una sin fila y una inexistente devuelve null y no escribe', async () => {
        const casos: Array<[string, Record<string, unknown> | null, Record<string, unknown>]> = [
            ['terminal (finishedAt)', arrancada({ finishedAt: new Date() }), {}],
            ['borrador', arrancada({ encoladaAt: null, startedAt: null, heartbeatAt: null }), {}],
            ['sin fila / inexistente', null, {}],
        ];
        for (const [, fila] of casos) {
            const h = armar(fila);
            expect(await h.service.cerrarCargaInterrumpida(1, 'SIN_LATIDO', { umbralMs: 5 * MIN })).toBeNull();
            expect(h.tx.remesa.update).not.toHaveBeenCalled();
            expect(h.realtime.emitImportFinalizada).not.toHaveBeenCalled();
            expect(h.notificaciones.crear).not.toHaveBeenCalled();
            expect(h.auditoria.log).not.toHaveBeenCalled();
        }
        // Una remesa ya FALLIDA/FINALIZADA aunque su fila no tenga finishedAt.
        const h = armar(arrancada());
        (h.tx.$queryRaw as jest.Mock).mockResolvedValue([{ estadoProceso: 'FALLIDA', categoria: 'DEUDORES', ...arrancada() }]);
        expect(await h.service.cerrarCargaInterrumpida(1, 'REENTREGA')).toBeNull();
        expect(h.tx.remesa.update).not.toHaveBeenCalled();
    });

    it('H-2: sobre una carga viva en este proceso devuelve null y ni siquiera abre la transacción', async () => {
        const h = armar(arrancada());
        (h.service as any).cargasVivas.set(1, {});
        expect(await h.service.cerrarCargaInterrumpida(1, 'SIN_LATIDO', { umbralMs: 5 * MIN })).toBeNull();
        expect(h.prisma.$transaction).not.toHaveBeenCalled();
    });

    it('H-3: SIN_LATIDO, pero al releer con el lock el latido es reciente: null', async () => {
        const h = armar(arrancada({ heartbeatAt: new Date(AHORA - 30_000) }));
        expect(await h.service.cerrarCargaInterrumpida(1, 'SIN_LATIDO', { umbralMs: 5 * MIN })).toBeNull();
        expect(h.tx.remesa.update).not.toHaveBeenCalled();
        // Sin latido, se usa startedAt.
        const g = armar(arrancada({ heartbeatAt: null, startedAt: new Date(AHORA - MIN) }));
        expect(await g.service.cerrarCargaInterrumpida(1, 'SIN_LATIDO', { umbralMs: 5 * MIN })).toBeNull();
    });

    it('H-4: SIN_JOB, pero al releer ya tiene startedAt: null', async () => {
        const h = armar(arrancada());
        expect(await h.service.cerrarCargaInterrumpida(1, 'SIN_JOB', { umbralMs: 5 * MIN })).toBeNull();
        expect(h.tx.remesa.update).not.toHaveBeenCalled();
        // REENTREGA exige lo contrario: que haya arrancado.
        const g = armar(arrancada({ startedAt: null, heartbeatAt: null }));
        expect(await g.service.cerrarCargaInterrumpida(1, 'REENTREGA')).toBeNull();
    });

    it('H-5: cierre real: remesa FALLIDA con ok/err de la fila, fila TERMINADA/FALLIDA con el texto de la categoría; emite, notifica y audita DESPUÉS del commit', async () => {
        const h = armar(arrancada());

        const estado = await h.service.cerrarCargaInterrumpida(1, 'SIN_LATIDO', { umbralMs: 5 * MIN });

        const { data, where, include } = h.tx.remesa.update.mock.calls[0][0];
        expect(where).toEqual({ id: 1 });
        expect(data).toMatchObject({ estadoProceso: 'FALLIDA', okFilas: 300, errFilas: 2 });
        expect(data.progreso.update).toMatchObject({ fase: 'TERMINADA', resultado: 'FALLIDA', subfase: null, rev: { increment: 1 } });
        expect(data.progreso.update.finishedAt).toBeInstanceOf(Date);
        expect(data.progreso.update.error).toContain('La importación se interrumpió: el servidor se reinició o dejó de responder mientras la procesaba.');
        expect(data.progreso.update.error).toContain('Eliminá esta importación desde el Historial'); // DEUDORES
        // El último latido real se conserva.
        expect(data.progreso.update).not.toHaveProperty('heartbeatAt');
        expect(include).toEqual({ progreso: true, usuarioCreador: { select: { id: true, nombre: true } } });

        expect(estado).toMatchObject({ resultado: 'FALLIDA', estadoProceso: 'FALLIDA', terminal: true, ok: 300, err: 2, procesadas: 302 });
        expect(h.realtime.emitImportFinalizada).toHaveBeenCalledWith(estado);
        expect(h.notificaciones.crear.mock.calls[0][0]).toMatchObject({
            tipo: 'IMPORTACION_ERROR', titulo: 'Importación fallida', destinatarioPrincipalId: 3, incluirUsuariosConPermiso: 'importacion.ver_progreso_otros',
        });
        expect(h.notificaciones.crear.mock.calls[0][0].mensaje).toBe(
            'La importación se interrumpió: el servidor se reinició o dejó de responder mientras la procesaba. Se habían procesado 302 filas.',
        );
        expect(h.auditoria.log.mock.calls[0][0]).toMatchObject({
            tipo: 'IMPORT_FAIL', entidad: 'Remesa', entidadId: 1, resumen: 'Importación interrumpida remesa 1',
        });
        expect(h.orden).toEqual(['lock', 'update', 'commit', 'socket', 'notificacion', 'auditoria']);
    });

    it.each([
        ['SIN_LATIDO', { encoladaAt: null, startedAt: new Date(AHORA - 20 * MIN), heartbeatAt: new Date(AHORA - 10 * MIN) }],
        ['SIN_JOB', { encoladaAt: null, startedAt: null, heartbeatAt: null }],
        ['REENTREGA', { encoladaAt: null, startedAt: new Date(AHORA - 20 * MIN), heartbeatAt: new Date(AHORA - 10 * MIN) }],
    ] as const)('H-1b: un borrador (sin encoladaAt) no es una carga: %s devuelve null aunque todo lo demás encaje', async (motivo, fila) => {
        const h = armar(arrancada(fila));
        expect(await h.service.cerrarCargaInterrumpida(1, motivo, { umbralMs: 5 * MIN })).toBeNull();
        expect(h.tx.remesa.update).not.toHaveBeenCalled();
        expect(h.realtime.emitImportFinalizada).not.toHaveBeenCalled();
    });

    it.each([
        ['un arreglo', [{ fromIndex: 1, operador: 'IGUAL', valor: 'A' }]],
        ['un JSON en texto', '[{"fromIndex":1,"operador":"IGUAL","valor":"A"}]'],
    ])('H-5d: DEUDORES con corte propio (%s) agrega el aviso de los cortes tildados; sin corte, no', async (_n, filtroFilas) => {
        const aviso = 'Esta remesa es un corte de un archivo dividido: al volver a cargarlo, tildá solo los cortes que no se cargaron. Si tildás uno que ya está cargado, sus casos quedan duplicados.';
        const base = 'Lo procesado hasta el corte quedó cargado en esta remesa. Eliminá esta importación desde el Historial y volvé a cargar el archivo. Si no se puede eliminar (porque algún caso ya tiene gestión o porque la remesa es muy grande), avisá a soporte antes de volver a cargarlo.';
        const conCorte = await armar(arrancada(), { filtroFilas }).service.cerrarCargaInterrumpida(1, 'SIN_LATIDO', { umbralMs: 5 * MIN });
        expect(conCorte!.error).toContain(`${base} ${aviso}`);
        for (const sinCorte of [null, [], '[]']) {
            const e = await armar(arrancada(), { filtroFilas: sinCorte }).service.cerrarCargaInterrumpida(1, 'SIN_LATIDO', { umbralMs: 5 * MIN });
            expect(e!.error).toContain(base);
            expect(e!.error).not.toContain('corte de un archivo dividido');
        }
        // DEUDORES_Y_FACTURAS igual; otras categorías no llevan el aviso.
        const df = await armar(arrancada(), { categoria: 'DEUDORES_Y_FACTURAS', filtroFilas }).service.cerrarCargaInterrumpida(1, 'REENTREGA');
        expect(df!.error).toContain(aviso);
        const pagos = await armar(arrancada(), { categoria: 'PAGOS', filtroFilas }).service.cerrarCargaInterrumpida(1, 'REENTREGA');
        expect(pagos!.error).not.toContain('corte de un archivo dividido');
    });

    it.each([
        ['ACCIONES', 'No vuelvas a cargar el archivo; avisá a soporte.'],
        ['PAGOS', 'Antes de volver a cargar el archivo, avisá a soporte.'],
    ])('H-5b: el texto depende de la categoría (%s)', async (categoria, fragmento) => {
        const h = armar(arrancada(), { categoria });
        const estado = await h.service.cerrarCargaInterrumpida(1, 'REENTREGA');
        expect(estado!.error).toContain(fragmento);
    });

    it('H-5c: SIN_JOB dice que la carga no llegó a empezar', async () => {
        const h = armar(arrancada({ startedAt: null, heartbeatAt: null, ok: 0, err: 0, procesadas: 0 }));
        const estado = await h.service.cerrarCargaInterrumpida(1, 'SIN_JOB', { umbralMs: 5 * MIN });
        expect(estado!.error).toContain('La importación no llegó a empezar');
        expect(estado!.error).toContain('No se cargó ninguna fila');
        expect(estado).toMatchObject({ resultado: 'FALLIDA', ok: 0 });
    });

    it.each(['notificacion', 'socket', 'auditoria'] as const)('H-6: si falla %s el cierre queda hecho y devuelve el estado', async (falla) => {
        const h = armar(arrancada(), { falla });
        const estado = await h.service.cerrarCargaInterrumpida(1, 'SIN_LATIDO', { umbralMs: 5 * MIN });
        expect(estado).toMatchObject({ resultado: 'FALLIDA' });
        expect(h.orden).toEqual(['lock', 'update', 'commit', 'socket', 'notificacion', 'auditoria']); // los tres se intentan
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('estadoDelJobDeCarga y sacarJobDeLaCola', () => {
    const jobCon = (estado: string, remesaId: number | undefined = 1, extra: Record<string, unknown> = {}) => ({
        id: 7, data: remesaId === undefined ? {} : { remesaId }, getState: jest.fn().mockResolvedValue(estado), remove: jest.fn().mockResolvedValue(undefined), ...extra,
    });
    function armar(cola: Record<string, unknown>) {
        const service = new ImportService({} as any, {} as any, cola as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
        return service;
    }
    const colaCon = (job: any, exists = 1, extra: Record<string, unknown> = {}) => ({
        getJob: jest.fn().mockResolvedValue(job),
        getJobs: jest.fn().mockResolvedValue([]),
        toKey: (id: string) => `bull:import-queue:${id}`,
        client: Promise.resolve({ exists: jest.fn().mockResolvedValue(exists) }),
        ...extra,
    });

    it('H-7: los seis resultados', async () => {
        expect(await armar(colaCon(null)).estadoDelJobDeCarga(1, '7')).toEqual({ estado: 'NO_EXISTE' });
        expect(await armar(colaCon(jobCon('waiting'))).estadoDelJobDeCarga(1, '7')).toEqual({ estado: 'EN_ESPERA' });
        expect(await armar(colaCon(jobCon('delayed'))).estadoDelJobDeCarga(1, '7')).toEqual({ estado: 'EN_ESPERA' });
        expect(await armar(colaCon(jobCon('completed'))).estadoDelJobDeCarga(1, '7')).toEqual({ estado: 'TERMINADO' });
        expect(await armar(colaCon(jobCon('failed'))).estadoDelJobDeCarga(1, '7')).toEqual({ estado: 'TERMINADO' });
        expect(await armar(colaCon(jobCon('active'), 1)).estadoDelJobDeCarga(1, '7')).toEqual({ estado: 'ACTIVO_CON_LOCK' });
        expect(await armar(colaCon(jobCon('active'), 0)).estadoDelJobDeCarga(1, '7')).toEqual({ estado: 'ACTIVO_SIN_LOCK' });
    });

    it('H-7b: el lock que se mira es `<cola>:<id>:lock`', async () => {
        const exists = jest.fn().mockResolvedValue(1);
        const cola = colaCon(jobCon('active'), 1, { client: Promise.resolve({ exists }) });
        await armar(cola).estadoDelJobDeCarga(1, '7');
        expect(exists).toHaveBeenCalledWith('bull:import-queue:7:lock');
    });

    it('H-7c: sin jobId guardado lo busca por data.remesaId entre los jobs de la cola', async () => {
        const cola = colaCon(null, 1, { getJobs: jest.fn().mockResolvedValue([jobCon('waiting', 2), jobCon('waiting', 1)]) });
        expect(await armar(cola).estadoDelJobDeCarga(1, null)).toEqual({ estado: 'EN_ESPERA' });
        expect(cola.getJob).not.toHaveBeenCalled();
    });

    it('H-7d: un jobId cuyo job es de OTRA remesa se trata como inexistente y se busca por data.remesaId', async () => {
        const ajeno = jobCon('active', 99);
        const propio = jobCon('waiting', 1);
        const conPropio = colaCon(ajeno, 1, { getJobs: jest.fn().mockResolvedValue([propio]) });
        expect(await armar(conPropio).estadoDelJobDeCarga(1, '7')).toEqual({ estado: 'EN_ESPERA' });
        expect(ajeno.getState).not.toHaveBeenCalled();
        const sinPropio = colaCon(ajeno);
        expect(await armar(sinPropio).estadoDelJobDeCarga(1, '7')).toEqual({ estado: 'NO_EXISTE' });
    });

    it('H-7e: una excepción, una cola sin lo necesario para mirar el lock y un tope vencido dan DESCONOCIDO', async () => {
        const rechaza = colaCon(null, 1, { getJob: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) });
        expect(await armar(rechaza).estadoDelJobDeCarga(1, '7')).toEqual({ estado: 'DESCONOCIDO' });

        const { toKey, ...sinToKey } = colaCon(jobCon('active'));
        void toKey;
        expect(await armar(sinToKey).estadoDelJobDeCarga(1, '7')).toEqual({ estado: 'DESCONOCIDO' });
        expect(await armar({}).estadoDelJobDeCarga(1, null)).toEqual({ estado: 'DESCONOCIDO' });

        jest.useFakeTimers();
        try {
            process.env.IMPORTS_QUEUE_TIMEOUT_MS = '1000';
            const colgada = colaCon(null, 1, { getJob: jest.fn().mockReturnValue(new Promise(() => undefined)) });
            const r = armar(colgada).estadoDelJobDeCarga(1, '7');
            await jest.advanceTimersByTimeAsync(1001);
            expect(await r).toEqual({ estado: 'DESCONOCIDO' });
            // Y un `exists` que no responde.
            const sinLock = colaCon(jobCon('active'), 1, { client: Promise.resolve({ exists: jest.fn().mockReturnValue(new Promise(() => undefined)) }) });
            const r2 = armar(sinLock).estadoDelJobDeCarga(1, '7');
            await jest.advanceTimersByTimeAsync(1001);
            expect(await r2).toEqual({ estado: 'DESCONOCIDO' });
        } finally {
            jest.useRealTimers();
            delete process.env.IMPORTS_QUEUE_TIMEOUT_MS;
        }
    });

    it('H-8: sacarJobDeLaCola con un jobId que es de otra remesa no lo saca', async () => {
        const ajeno = jobCon('waiting', 99);
        const cola = colaCon(ajeno);
        expect(await armar(cola).sacarJobDeLaCola(1, '7')).toBe(true); // no hay job propio: nada que sacar
        expect(ajeno.remove).not.toHaveBeenCalled();

        // Si el propio existe, saca el propio y nunca el ajeno.
        const propio = jobCon('waiting', 1);
        const conPropio = colaCon(ajeno, 1, { getJobs: jest.fn().mockResolvedValue([ajeno, propio]) });
        expect(await armar(conPropio).sacarJobDeLaCola(1, '7')).toBe(true);
        expect(propio.remove).toHaveBeenCalledTimes(1);
        expect(ajeno.remove).not.toHaveBeenCalled();
    });

    it('H-8b: los jobs falsos sin data (los de los specs de borrado) se siguen sacando', async () => {
        const sinData = { getState: jest.fn().mockResolvedValue('waiting'), remove: jest.fn().mockResolvedValue(undefined) };
        expect(await armar({ getJob: jest.fn().mockResolvedValue(sinData) }).sacarJobDeLaCola(1, '7')).toBe(true);
        expect(sinData.remove).toHaveBeenCalledTimes(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('las dos carreras (§9.5.8)', () => {
    const user = { sub: 3, permisos: ['importacion.eliminar'] };

    function armarBorrado(remesa: Record<string, unknown>, filaConLock: Record<string, unknown>, job: any = null) {
        const tx: any = {
            $queryRaw: jest.fn().mockResolvedValue([filaConLock]),
            contacto: { deleteMany: jest.fn() }, campoextra: { deleteMany: jest.fn() }, factura: { deleteMany: jest.fn() },
            deudor: { deleteMany: jest.fn() }, jobimport: { deleteMany: jest.fn() }, importerror: { deleteMany: jest.fn() },
            remesa: { delete: jest.fn() },
        };
        const prisma: any = {
            remesa: { findUnique: jest.fn().mockResolvedValue({ id: 1, categoria: 'DEUDORES', usuarioCreadorId: 3, ...remesa }) },
            deudor: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
            notificacion: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
            $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
        };
        const queue: any = { getJob: jest.fn().mockResolvedValue(job) };
        const service = new ImportService(prisma, {} as any, queue, { emitToUser: jest.fn() } as any, { contador: jest.fn() } as any, {} as any, {} as any, {} as any, {} as any);
        return { service, tx, queue, prisma };
    }

    it('H-9: borrar: la lectura inicial la vio borrador y, con el lock, ya está encolada sin arrancar → 409 y no borra', async () => {
        const h = armarBorrado(
            { estadoProceso: 'VALIDANDO', progreso: { encoladaAt: null, startedAt: null, finishedAt: null, jobId: null } },
            { estadoProceso: 'PENDIENTE', encoladaAt: new Date(), startedAt: null, finishedAt: null },
        );
        await expect(h.service.deleteRemesa(1, user)).rejects.toThrow(ConflictException);
        await expect(h.service.deleteRemesa(1, user)).rejects.toThrow('Esta importación se acaba de confirmar. Si igual querés eliminarla, volvé a intentarlo.');
        expect(h.tx.remesa.delete).not.toHaveBeenCalled();
    });

    it('H-17: la transacción del borrado lleva un timeout holgado (120 s, espera 5 s): el de Prisma no corta la sentencia y vencer contamina el pool', async () => {
        const h = armarBorrado(
            { estadoProceso: 'FALLIDA', progreso: { encoladaAt: new Date(), startedAt: new Date(), finishedAt: new Date(), jobId: null } },
            { estadoProceso: 'FALLIDA', encoladaAt: new Date(), startedAt: new Date(), finishedAt: new Date() },
        );
        await h.service.deleteRemesa(1, user);
        expect(h.prisma.$transaction.mock.calls[0][1]).toEqual({ timeout: 120_000, maxWait: 5_000 });
    });

    it('H-17b: si igual vence (P2028) responde 400 con el motivo y no el 500, y no borra las notificaciones', async () => {
        const warn = jest.spyOn(Logger.prototype, 'warn');
        const h = armarBorrado(
            { estadoProceso: 'FALLIDA', progreso: { encoladaAt: new Date(), startedAt: new Date(), finishedAt: new Date(), jobId: null } },
            { estadoProceso: 'FALLIDA', encoladaAt: new Date(), startedAt: new Date(), finishedAt: new Date() },
        );
        h.prisma.$transaction.mockRejectedValue(Object.assign(new Error('Invalid `prisma.deudor.deleteMany()` invocation in\n/app/dist/x.js:1\n\nTransaction API error: Transaction already closed: A query cannot be executed on an expired transaction.'), { code: 'P2028' }));

        const r = h.service.deleteRemesa(1, user);

        await expect(r).rejects.toThrow(BadRequestException);
        await expect(h.service.deleteRemesa(1, user)).rejects.toThrow(
            'No se pudo eliminar: la base de datos no respondió a tiempo. Probá de nuevo en unos minutos; si se repite, avisá a soporte.',
        );
        expect(warn.mock.calls.some(([m]) => String(m).includes('el borrado no terminó'))).toBe(true);
        // El warn no vuelca el mensaje multilínea de Prisma con rutas del servidor.
        expect(warn.mock.calls.every(([m]) => !String(m).includes('/app/dist'))).toBe(true);
    });

    it('H-17d: una conexión rota tras vencer (P1017) y un lock wait timeout (1205, que llega como P2010) tampoco salen como 500 y no dicen "demasiado grande"', async () => {
        const h = armarBorrado(
            { estadoProceso: 'FALLIDA', progreso: { encoladaAt: new Date(), startedAt: new Date(), finishedAt: new Date(), jobId: null } },
            { estadoProceso: 'FALLIDA', encoladaAt: new Date(), startedAt: new Date(), finishedAt: new Date() },
        );
        h.prisma.$transaction.mockRejectedValue(Object.assign(new Error('Server has closed the connection.'), { code: 'P1017' }));
        await expect(h.service.deleteRemesa(1, user)).rejects.toThrow('la base de datos no respondió a tiempo');
        h.prisma.$transaction.mockRejectedValue(Object.assign(new Error("Raw query failed. Code: `1205`. Message: `Lock wait timeout exceeded; try restarting transaction`"), { code: 'P2010' }));
        const e = await h.service.deleteRemesa(1, user).catch((x: any) => x);
        expect(e).toBeInstanceOf(BadRequestException);
        expect(e.message).toContain('la base de datos no respondió a tiempo');
        expect(e.message).not.toContain('demasiado grande');
        // Un P2010 que no es un lock wait se relanza tal cual.
        h.prisma.$transaction.mockRejectedValue(Object.assign(new Error('Raw query failed. Code: `1064`.'), { code: 'P2010' }));
        await expect(h.service.deleteRemesa(1, user)).rejects.toThrow('1064');
    });

    describe('H-18: tope de tamaño antes de abrir la transacción', () => {
        afterEach(() => { delete process.env.IMPORTS_BORRADO_MAX_CASOS; });
        const grande = (casos: number) => {
            const h = armarBorrado(
                { estadoProceso: 'FALLIDA', progreso: { encoladaAt: new Date(), startedAt: new Date(), finishedAt: new Date(), jobId: null } },
                { estadoProceso: 'FALLIDA', encoladaAt: new Date(), startedAt: new Date(), finishedAt: new Date() },
            );
            h.prisma.deudor.count.mockResolvedValue(casos);
            return h;
        };

        it('más casos que el tope (default 60.000): warn y el 400 de siempre, sin abrir la transacción ni leer los casos', async () => {
            const warn = jest.spyOn(Logger.prototype, 'warn');
            const h = grande(60_001);
            await expect(h.service.deleteRemesa(1, user)).rejects.toThrow(
                'No se pudo eliminar: la remesa es demasiado grande para borrarla desde la pantalla. Avisá a soporte.',
            );
            expect(h.prisma.$transaction).not.toHaveBeenCalled();
            expect(h.prisma.deudor.findMany).not.toHaveBeenCalled();
            expect(warn.mock.calls.some(([m]) => String(m).includes('60001 casos'))).toBe(true);
        });

        it('con exactamente el tope se borra', async () => {
            const h = grande(60_000);
            await expect(h.service.deleteRemesa(1, user)).resolves.toMatchObject({ deleted: true });
        });

        it('IMPORTS_BORRADO_MAX_CASOS lo mueve, acotado a [1.000, 65.000] (el límite real de MySQL: 65.536 placeholders); un valor inválido cae al default', async () => {
            process.env.IMPORTS_BORRADO_MAX_CASOS = '5000';
            await expect(grande(5_001).service.deleteRemesa(1, user)).rejects.toThrow(BadRequestException);
            await expect(grande(5_000).service.deleteRemesa(1, user)).resolves.toMatchObject({ deleted: true });
            process.env.IMPORTS_BORRADO_MAX_CASOS = '10'; // cota inferior: 1.000
            await expect(grande(1_001).service.deleteRemesa(1, user)).rejects.toThrow(BadRequestException);
            await expect(grande(1_000).service.deleteRemesa(1, user)).resolves.toMatchObject({ deleted: true });
            process.env.IMPORTS_BORRADO_MAX_CASOS = '999999999'; // cota superior: 65.000, aunque pidan más
            await expect(grande(65_001).service.deleteRemesa(1, user)).rejects.toThrow(BadRequestException);
            await expect(grande(65_000).service.deleteRemesa(1, user)).resolves.toMatchObject({ deleted: true });
            process.env.IMPORTS_BORRADO_MAX_CASOS = 'abc';
            await expect(grande(60_001).service.deleteRemesa(1, user)).rejects.toThrow(BadRequestException);
            await expect(grande(60_000).service.deleteRemesa(1, user)).resolves.toMatchObject({ deleted: true });
        });
    });

    it('H-17c: cualquier otro error del borrado se relanza tal cual (no se disfraza de "demasiado grande")', async () => {
        const h = armarBorrado(
            { estadoProceso: 'FALLIDA', progreso: { encoladaAt: new Date(), startedAt: new Date(), finishedAt: new Date(), jobId: null } },
            { estadoProceso: 'FALLIDA', encoladaAt: new Date(), startedAt: new Date(), finishedAt: new Date() },
        );
        h.prisma.$transaction.mockRejectedValue(new Error('deadlock'));
        await expect(h.service.deleteRemesa(1, user)).rejects.toThrow('deadlock');
    });

    it('H-9b: lo mismo para MULTICLAVES (la otra rama del borrado)', async () => {
        const h = armarBorrado(
            { categoria: 'MULTICLAVES', estadoProceso: 'VALIDANDO', progreso: { encoladaAt: null, startedAt: null, finishedAt: null, jobId: null } },
            { estadoProceso: 'PENDIENTE', encoladaAt: new Date(), startedAt: null, finishedAt: null },
        );
        (h.service as any).prisma.convenio = { count: jest.fn().mockResolvedValue(0) };
        await expect(h.service.deleteRemesa(1, user)).rejects.toThrow(ConflictException);
    });

    it('H-10: borrar: la vio en cola, sacó el job, y con el lock sigue en cola sin arrancar → borra (el camino de la Fase A)', async () => {
        const job = { getState: jest.fn().mockResolvedValue('waiting'), remove: jest.fn().mockResolvedValue(undefined) };
        const h = armarBorrado(
            { estadoProceso: 'PENDIENTE', progreso: { encoladaAt: new Date(), startedAt: null, finishedAt: null, jobId: 'job-7' } },
            { estadoProceso: 'PENDIENTE', encoladaAt: new Date(), startedAt: null, finishedAt: null },
            job,
        );
        await expect(h.service.deleteRemesa(1, user)).resolves.toMatchObject({ deleted: true });
        expect(job.remove).toHaveBeenCalledTimes(1);
        expect(h.tx.remesa.delete).toHaveBeenCalledTimes(1);
    });

    it('H-10b: un borrador que sigue siendo borrador se borra', async () => {
        const h = armarBorrado(
            { estadoProceso: 'VALIDANDO', progreso: { encoladaAt: null, startedAt: null, finishedAt: null, jobId: null } },
            { estadoProceso: 'VALIDANDO', encoladaAt: null, startedAt: null, finishedAt: null },
        );
        await expect(h.service.deleteRemesa(1, user)).resolves.toMatchObject({ deleted: true });
    });

    // ── executeRemesa ──
    function armarEjecutar(o: {
        queueFalla?: boolean; updateJobIdFalla?: Error; relectura?: any; posicion?: number | Error;
        /** Lo que ve la compensación con la fila bloqueada. `null` = la remesa ya no existe. */
        bloqueada?: { estadoProceso: string; fase: string | null; startedAt: Date | null } | null;
        compensacionTxFalla?: Error;
    } = {}) {
        const fila = { estadoProceso: 'VALIDANDO', totalFilas: 912, encoladaAt: null };
        const llamadas: any[] = [];
        const tx: any = {
            $queryRaw: jest.fn().mockImplementation((strings: TemplateStringsArray) => {
                const sql = strings.join('?');
                // La compensación del encolado decide con la fila bloqueada.
                if (sql.includes('p.fase AS fase')) {
                    if (o.compensacionTxFalla) return Promise.reject(o.compensacionTxFalla);
                    const b = o.bloqueada === undefined ? { estadoProceso: 'PENDIENTE', fase: 'EN_COLA', startedAt: null } : o.bloqueada;
                    return Promise.resolve(b ? [b] : []);
                }
                if (sql.includes('FROM usuario')) return Promise.resolve([{ id: 3 }]);
                if (sql.includes('LEFT JOIN import_progreso')) return Promise.resolve([fila]);
                return Promise.resolve([]);
            }),
            remesa: {
                update: jest.fn().mockImplementation((args: any) => {
                const { data } = args;
                llamadas.push(args);
                if (data.progreso?.update) return Promise.resolve({}); // la compensación (a borrador)
                return Promise.resolve({ ...REMESA, estadoProceso: 'PENDIENTE', progreso: { ...FILA, ...data.progreso.upsert.create, remesaId: 1, encoladaAt: new Date('2026-10-09T12:00:00Z') } });
            }),
            },
        };
        const prisma: any = {
            remesa: {
                findUnique: jest.fn().mockImplementation((args: any) =>
                    args?.include ? Promise.resolve(o.relectura === undefined ? null : o.relectura) : Promise.resolve({ id: 1, categoria: 'DEUDORES' })),
                update: jest.fn().mockImplementation((args: any) => {
                    llamadas.push(args);
                    if (args.data?.progreso?.update?.jobId && o.updateJobIdFalla) return Promise.reject(o.updateJobIdFalla);
                    return Promise.resolve({});
                }),
            },
            $queryRaw: jest.fn().mockImplementation(() =>
                o.posicion instanceof Error ? Promise.reject(o.posicion) : Promise.resolve([{ n: BigInt(o.posicion ?? 0) }])),
            $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
        };
        const job = { id: 'job-7', remove: jest.fn().mockResolvedValue(undefined) };
        const queue: any = { add: o.queueFalla ? jest.fn().mockRejectedValue(new Error('ECONNREFUSED redis')) : jest.fn().mockResolvedValue(job) };
        const realtime: any = { emitImportProgreso: jest.fn() };
        const service = new ImportService(prisma, {} as any, queue, realtime, {} as any, { get: jest.fn() } as any, {} as any, {} as any, {} as any);
        return { service, prisma, tx, queue, realtime, job, llamadas };
    }
    const p2025 = () => Object.assign(new Error('Record not found'), { code: 'P2025' });

    it('H-11: confirmar: el update del jobId da P2025 (borraron entre el commit y el add) → saca el job recién encolado, 404 y no emite', async () => {
        const h = armarEjecutar({ updateJobIdFalla: p2025() });
        await expect(h.service.executeRemesa(1, 3)).rejects.toThrow(NotFoundException);
        await expect(h.service.executeRemesa(1, 3)).rejects.toThrow('La importación fue eliminada mientras se confirmaba.');
        expect(h.job.remove).toHaveBeenCalled();
        expect(h.realtime.emitImportProgreso).not.toHaveBeenCalled();
        // No pasa por la compensación (esa es del `add` fallido).
        expect(h.llamadas.some((l) => l.data?.progreso?.update?.fase === 'BORRADOR')).toBe(false);
    });

    it('H-11b: si además no se puede sacar el job, igual 404 (el worker tampoco va a encontrar la remesa)', async () => {
        const h = armarEjecutar({ updateJobIdFalla: p2025() });
        h.job.remove.mockRejectedValue(new Error('locked'));
        await expect(h.service.executeRemesa(1, 3)).rejects.toThrow(NotFoundException);
    });

    it('H-11c: cualquier otro error al guardar el jobId sigue siendo un warn y la confirmación responde OK', async () => {
        const h = armarEjecutar({ updateJobIdFalla: new Error('deadlock') });
        await expect(h.service.executeRemesa(1, 3)).resolves.toMatchObject({ remesaId: 1 });
        expect(h.job.remove).not.toHaveBeenCalled();
        expect(h.realtime.emitImportProgreso).toHaveBeenCalledTimes(1);
    });

    const compensaciones = (h: ReturnType<typeof armarEjecutar>) => h.llamadas.filter((l) => l.data?.progreso?.update?.fase === 'BORRADOR');

    it('H-12: confirmar: el add falla pero con la fila bloqueada el worker ya la tomó → 201 con el estado real, un warn, y NO se devuelve a borrador', async () => {
        const warn = jest.spyOn(Logger.prototype, 'warn');
        const relectura = {
            ...REMESA, estadoProceso: 'PROCESANDO',
            progreso: { ...FILA, fase: 'PROCESANDO', encoladaAt: new Date(), startedAt: new Date(), procesadas: 40, ok: 40 },
        };
        const h = armarEjecutar({ queueFalla: true, bloqueada: { estadoProceso: 'PROCESANDO', fase: 'PROCESANDO', startedAt: new Date() }, relectura });

        const r = await h.service.executeRemesa(1, 3);

        expect(r.message).toBe('Importación encolada correctamente');
        expect(r.carga).toMatchObject({ fase: 'PROCESANDO', estadoProceso: 'PROCESANDO', ok: 40, enCurso: true });
        expect(warn.mock.calls.some(([m]) => String(m).includes('el worker ya tomó la carga'))).toBe(true);
        expect(compensaciones(h)).toHaveLength(0);
    });

    it('H-12b: lo mismo si la carga YA TERMINÓ (el 503 con la carga FINALIZADA y sus casos cargados que reprodujo la auditoría)', async () => {
        const relectura = {
            ...REMESA, estadoProceso: 'FINALIZADA',
            progreso: { ...FILA, fase: 'TERMINADA', resultado: 'OK', encoladaAt: new Date(), startedAt: new Date(), finishedAt: new Date() },
        };
        const h = armarEjecutar({ queueFalla: true, bloqueada: { estadoProceso: 'FINALIZADA', fase: 'TERMINADA', startedAt: new Date() }, relectura });
        await expect(h.service.executeRemesa(1, 3)).resolves.toMatchObject({ carga: { resultado: 'OK', terminal: true } });
        expect(compensaciones(h)).toHaveLength(0);
    });

    it('H-13: con la fila bloqueada la remesa ya no existe → 404', async () => {
        const h = armarEjecutar({ queueFalla: true, bloqueada: null });
        await expect(h.service.executeRemesa(1, 3)).rejects.toThrow(NotFoundException);
        await expect(h.service.executeRemesa(1, 3)).rejects.toThrow('La importación fue eliminada mientras se confirmaba.');
        expect(compensaciones(h)).toHaveLength(0);
    });

    it('H-13b: si el worker la tomó pero la relectura ya no la ve (se borró después) → 404', async () => {
        const h = armarEjecutar({ queueFalla: true, bloqueada: { estadoProceso: 'PROCESANDO', fase: 'PROCESANDO', startedAt: new Date() }, relectura: null });
        await expect(h.service.executeRemesa(1, 3)).rejects.toThrow(NotFoundException);
    });

    it('H-13c: si la compensación no puede ni abrir su transacción (la base falla) → 503 como siempre', async () => {
        const h = armarEjecutar({ queueFalla: true, compensacionTxFalla: new Error('base caída') });
        await expect(h.service.executeRemesa(1, 3)).rejects.toThrow(ServiceUnavailableException);
    });

    it('H-14: la compensación decide con la fila bloqueada: solo vuelve a borrador una carga EN_COLA, PENDIENTE/VALIDANDO y sin arrancar', async () => {
        const h = armarEjecutar({ queueFalla: true });
        await expect(h.service.executeRemesa(1, 3)).rejects.toThrow(ServiceUnavailableException);

        const comp = compensaciones(h);
        expect(comp).toHaveLength(1);
        expect(comp[0].where).toEqual({ id: 1 });
        expect(comp[0].data).toMatchObject({ estadoProceso: 'VALIDANDO', progreso: { update: { fase: 'BORRADOR', encoladaAt: null, jobId: null, rev: { increment: 1 } } } });
        // El SELECT … FOR UPDATE va antes de la escritura.
        const lock = h.tx.$queryRaw.mock.calls.findIndex((c: any[]) => (c[0] as TemplateStringsArray).join('?').includes('p.fase AS fase'));
        expect((h.tx.$queryRaw.mock.calls[lock][0] as TemplateStringsArray).join('?')).toContain('FOR UPDATE');
        const idxComp = h.tx.remesa.update.mock.calls.findIndex((c: any[]) => c[0].data.progreso?.update);
        expect(h.tx.$queryRaw.mock.invocationCallOrder[lock]).toBeLessThan(h.tx.remesa.update.mock.invocationCallOrder[idxComp]);

        // Cada una de las condiciones por separado impide volver a borrador.
        for (const bloqueada of [
            { estadoProceso: 'PENDIENTE', fase: 'EN_COLA', startedAt: new Date() },      // arrancó
            { estadoProceso: 'PROCESANDO', fase: 'PROCESANDO', startedAt: null },         // ya no es borrador-compatible
            { estadoProceso: 'PENDIENTE', fase: 'BORRADOR', startedAt: null },            // ya la devolvieron
            { estadoProceso: 'FINALIZADA', fase: 'EN_COLA', startedAt: null },            // terminal
        ]) {
            const g = armarEjecutar({ queueFalla: true, bloqueada, relectura: { ...REMESA, estadoProceso: 'PROCESANDO', progreso: { ...FILA, fase: 'PROCESANDO', startedAt: new Date() } } });
            await g.service.executeRemesa(1, 3).catch(() => undefined);
            expect(compensaciones(g)).toHaveLength(0);
        }
    });

    // ── H-15: posición en la cola ──
    it('H-15: enColaDelante en la respuesta de executeRemesa y en el evento', async () => {
        const h = armarEjecutar({ posicion: 2 });
        const r = await h.service.executeRemesa(1, 3);
        expect(r.carga.enColaDelante).toBe(2);
        expect(h.realtime.emitImportProgreso.mock.calls[0][0].enColaDelante).toBe(2);
        const sql = (h.prisma.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join('?');
        expect(sql).toContain('finishedAt IS NULL AND encoladaAt IS NOT NULL');
        expect(sql).toContain('encoladaAt < ?');
        expect(sql).toContain('remesaId < ?');
    });

    it('H-15b: si la consulta falla, es null y nada más cambia (el encolado no falla)', async () => {
        const h = armarEjecutar({ posicion: new Error('base lenta') });
        const r = await h.service.executeRemesa(1, 3);
        expect(r.carga.enColaDelante).toBeNull();
        expect(r.carga).toMatchObject({ fase: 'EN_COLA', enCurso: true });
        expect(h.realtime.emitImportProgreso).toHaveBeenCalledTimes(1);
    });

    describe('lecturas', () => {
        const enCola = (id: number, minutos: number, usuarioId = 3) => ({
            ...REMESA, id, usuarioCreadorId: usuarioId, usuarioCreador: { id: usuarioId, nombre: 'U' }, estadoProceso: 'PENDIENTE',
            progreso: { ...FILA, remesaId: id, fase: 'EN_COLA', encoladaAt: new Date(Date.now() - minutos * MIN) },
        });
        function armarLecturas(remesas: any[], posiciones: number[] | Error = [], n = 0) {
            const prisma: any = {
                remesa: {
                    findMany: jest.fn().mockResolvedValue(remesas),
                    findUnique: jest.fn().mockResolvedValue({ ...remesas[0], empresa: null, plantilla: null, politica: null, createdAt: new Date(), updatedAt: new Date(), fechaVencimiento: null }),
                },
                import_progreso: {
                    findMany: jest.fn().mockImplementation(() =>
                        posiciones instanceof Error ? Promise.reject(posiciones) : Promise.resolve(posiciones.map((remesaId) => ({ remesaId })))),
                },
                $queryRaw: jest.fn().mockResolvedValue([{ n: BigInt(n) }]),
            };
            const service = new ImportService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
            return { service, prisma };
        }

        it('progreso(id) y status(id) traen enColaDelante de una carga EN_COLA', async () => {
            const h = armarLecturas([enCola(1, 5)], [], 3);
            expect((await h.service.progreso(1)).enColaDelante).toBe(3);
            expect((await h.service.status(1)).carga.enColaDelante).toBe(3);
        });

        it('progreso(id) de una carga que no está en cola no consulta la posición', async () => {
            const r = { ...enCola(1, 5), estadoProceso: 'PROCESANDO', progreso: { ...FILA, fase: 'PROCESANDO', encoladaAt: new Date(), startedAt: new Date() } };
            const h = armarLecturas([r]);
            expect((await h.service.progreso(1)).enColaDelante).toBeNull();
            expect(h.prisma.$queryRaw).not.toHaveBeenCalled();
        });

        it('listarEnCurso cuenta las cargas de OTROS usuarios aunque el listado del usuario no las traiga', async () => {
            // En la cola, por orden: 10 (de otro, corriendo), 11 (de otro), 12 (la mía).
            const mia = enCola(12, 1);
            const h = armarLecturas([mia], [10, 11, 12]);

            const r = await h.service.listarEnCurso({ sub: 3, permisos: [] });

            expect(r).toHaveLength(1);
            expect(r[0].enColaDelante).toBe(2);
            // El listado se filtra por usuario; la posición no.
            expect(h.prisma.remesa.findMany.mock.calls[0][0].where).toMatchObject({ usuarioCreadorId: 3 });
            const posicion = h.prisma.import_progreso.findMany.mock.calls[0][0];
            expect(posicion.where).toEqual({ encoladaAt: { not: null }, finishedAt: null });
            expect(posicion.orderBy).toEqual([{ encoladaAt: 'asc' }, { remesaId: 'asc' }]);
        });

        it('listarEnCurso: si la consulta de posiciones falla, es null y el listado sale igual', async () => {
            const h = armarLecturas([enCola(12, 1)], new Error('lenta'));
            const r = await h.service.listarEnCurso({ sub: 3, permisos: ['importacion.ver_progreso_otros'] });
            expect(r).toHaveLength(1);
            expect(r[0].enColaDelante).toBeNull();
        });

        it('listarEnCurso: sin cargas EN_COLA no hace la consulta de posiciones', async () => {
            const r = { ...enCola(1, 5), estadoProceso: 'PROCESANDO', progreso: { ...FILA, fase: 'PROCESANDO', encoladaAt: new Date(), startedAt: new Date() } };
            const h = armarLecturas([r]);
            await h.service.listarEnCurso({ sub: 3, permisos: [] });
            expect(h.prisma.import_progreso.findMany).not.toHaveBeenCalled();
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('vista previa de una remesa con corte (§9.5.10)', () => {
    function armarValidar(lineas: string[], remesa: Record<string, unknown>, mapping: Record<string, unknown> = {}) {
        const archivo = path.join(dir, `vp-${Math.random().toString(36).slice(2)}.csv`);
        fs.writeFileSync(archivo, lineas.join('\n'));
        const prisma: any = {
            remesa: {
                findUnique: jest.fn().mockResolvedValue({
                    id: 1, empresaId: 10, categoria: 'DEUDORES', estadoProceso: 'PENDIENTE', archivo, hoja: null, progreso: null,
                    filtroFilas: null,
                    plantilla: { separador: '|', tieneHeader: false, mappingJson: { columns: { a: { fromIndex: 0 } }, ...mapping } },
                    ...remesa,
                }),
                update: jest.fn().mockResolvedValue({}),
            },
        };
        return new ImportService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    }
    const lineas = ['1|A', '2|X', '3|B', '4|A', '5|B', '6|X', '7|B', '8|A', '9|B', '10|X'];
    const plantilla = { filtroFilas: [{ fromIndex: 1, operador: 'DISTINTO', valor: 'X' }] };
    const corte = [{ fromIndex: 1, operador: 'IGUAL', valor: 'A' }];

    it('H-16: descartadas (total), fueraDeCorte, y filtro sin la condición del corte', async () => {
        const r = await armarValidar(lineas, { filtroFilas: corte }, plantilla).validateRemesa(1);

        expect(r.total).toBe(3);
        expect(r.descartadas).toBe(7);
        expect(r.fueraDeCorte).toBe(4);
        expect(r.filtro).toBe('col 1 DISTINTO "X"');
        expect(r.filtro).not.toContain('IGUAL');
    });

    it('H-16b: una remesa sin corte no trae fueraDeCorte y el filtro describe el de la plantilla', async () => {
        const r = await armarValidar(lineas, {}, plantilla).validateRemesa(1);
        expect(r.total).toBe(7);
        expect(r.descartadas).toBe(3);
        expect(r.fueraDeCorte).toBeUndefined();
        expect(r.filtro).toBe('col 1 DISTINTO "X"');
    });

    it('H-16c: si solo descarta el corte, `filtro` no inventa un filtro de la plantilla', async () => {
        const r = await armarValidar(['1|A', '2|B', '3|B'], { filtroFilas: corte }, {}).validateRemesa(1);
        expect(r).toMatchObject({ total: 1, descartadas: 2, fueraDeCorte: 2 });
        expect(r.filtro).toBeUndefined();
    });

    it('H-16d: una fila que no pasa ni el filtro ni el corte cuenta en descartadas pero no en fueraDeCorte', async () => {
        const r = await armarValidar(['1|X', '2|A'], { filtroFilas: corte }, plantilla).validateRemesa(1);
        expect(r).toMatchObject({ total: 1, descartadas: 1, fueraDeCorte: 0 });
    });
});
