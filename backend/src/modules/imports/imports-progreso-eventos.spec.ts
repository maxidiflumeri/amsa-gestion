/**
 * Secuencia de eventos y estado persistido de una carga (docs/imports-progreso-realtime-spec.md §8.9.1 B).
 *
 * `ImportService` real, `prisma` falso en memoria (una remesa y su fila de progreso, con un
 * `remesa.update` que aplica la escritura anidada), `realtime` y `notificaciones` que graban sus
 * llamadas en orden, un processor de mentira (se prueba el runner, no una categoría) y un CSV de verdad.
 */
import { Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { IMPORTS_BATCH_SIZE, ImportService } from './imports.service';
import { getProcessor } from './processors/processor-registry';
import type { EstadoCargaDto } from './progreso/estado-carga.types';
import { parseMultirregistro } from './utils/multirregistro-parser';
import { parseMulticlaves } from './utils/multiclaves-parser';
import { BadRequestException, NotFoundException } from '@nestjs/common';

jest.mock('./utils/multiclaves-parser', () => ({
    ...jest.requireActual('./utils/multiclaves-parser'),
    parseMulticlaves: jest.fn(),
}));
jest.mock('./utils/multirregistro-parser', () => ({ parseMultirregistro: jest.fn() }));
jest.mock('./processors/processor-registry', () => ({
    getProcessor: jest.fn(),
    getSupportedCategories: jest.fn(() => []),
}));

const FILA_DEFAULT = {
    remesaId: 1,
    rev: 0,
    fase: 'EN_COLA',
    subfase: null,
    porcentaje: 0,
    totalEsperado: 0,
    procesadas: 0,
    ok: 0,
    err: 0,
    descartadas: 0,
    advertencias: 0,
    nuevos: null,
    actualizados: null,
    resultado: null,
    error: null,
    errorPostProceso: null,
    resumen: null,
    intentos: 0,
    jobId: null,
    grupoId: null,
    grupoOrden: null,
    grupoTotal: null,
    cancelSolicitadaAt: null,
    encoladaAt: null,
    startedAt: null,
    heartbeatAt: null,
    finishedAt: null,
};

type Evento = { evento: 'iniciada' | 'progreso' | 'finalizada'; estado: EstadoCargaDto };

interface Opciones {
    filas?: number;
    soloEncabezado?: boolean;
    remesa?: Record<string, unknown>;
    plantilla?: Record<string, unknown>;
    previa?: Record<string, unknown> | null;
    processor?: Record<string, unknown>;
    sinDueno?: boolean;
    job?: Record<string, unknown>;
    columna1?: string;
    /** Hace rechazar al `remesa.update` cuyo `data` cumpla la condición. */
    updateRechaza?: (data: any) => boolean;
    findUniqueRechaza?: boolean;
    /** Lo que devuelve `importerror.count` (avisos que escribieron los processors). */
    avisosEnBase?: number;
}

const archivosTemporales: string[] = [];

function armar(o: Opciones = {}) {
    const n = o.filas ?? 10;
    const lineas = ['doc|valor'];
    if (!o.soloEncabezado) for (let i = 0; i < n; i++) lineas.push(`${i}|${o.columna1 ?? 'A'}`);
    const archivo = path.join(os.tmpdir(), `amsa-progreso-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`);
    fs.writeFileSync(archivo, lineas.join('\n'));
    archivosTemporales.push(archivo);

    const remesaRow: any = {
        id: 1,
        empresaId: 10,
        numeroRemesa: '00001',
        nombre: 'Carga de prueba',
        archivo,
        archivos: null,
        hoja: null,
        categoria: 'DEUDORES',
        estadoProceso: 'PENDIENTE',
        totalFilas: n,
        okFilas: 0,
        errFilas: 0,
        plantillaId: 5,
        usuarioCreadorId: o.sinDueno ? null : 3,
        filtroFilas: null,
        validarDomicilios: false,
        ...o.remesa,
    };
    const plantilla: any = {
        id: 5,
        defaultEstadoSituacionId: 1,
        defaultEstadoGestionId: 2,
        mappingJson: { columns: { documento: { fromIndex: 0 } } },
        separador: '|',
        tieneHeader: true,
        ...o.plantilla,
    };
    let fila: any = o.previa === undefined || o.previa === null ? null : { ...FILA_DEFAULT, ...o.previa };

    const escrituras: Array<{ remesa: any; progreso: any }> = [];
    const importerrors: any[] = [];

    const prisma: any = {
        remesa: {
            findUnique: jest.fn().mockImplementation(() =>
                o.findUniqueRechaza ? Promise.reject(new Error('la base no responde')) : Promise.resolve({
                    ...remesaRow,
                    plantilla,
                    usuarioCreador: o.sinDueno ? null : { id: 3, nombre: 'Maxi' },
                    progreso: fila ? { ...fila } : null,
                }),
            ),
            update: jest.fn().mockImplementation(({ data, select }: any) => {
                if (o.updateRechaza?.(data)) return Promise.reject(new Error('update rechazado'));
                const { progreso, ...resto } = data;
                escrituras.push(structuredClone({ remesa: resto, progreso: progreso?.upsert ?? null }));
                Object.assign(remesaRow, resto);
                if (progreso?.upsert) {
                    if (!fila) {
                        fila = { ...FILA_DEFAULT, ...progreso.upsert.create };
                    } else {
                        for (const [k, v] of Object.entries(progreso.upsert.update as Record<string, any>)) {
                            if (v && typeof v === 'object' && !(v instanceof Date) && 'increment' in v) fila[k] += v.increment;
                            else fila[k] = v;
                        }
                    }
                }
                return Promise.resolve(select?.progreso ? { progreso: fila ? { rev: fila.rev } : null } : {});
            }),
        },
        importerror: {
            deleteMany: jest.fn().mockResolvedValue({}),
            count: jest.fn().mockResolvedValue(o.avisosEnBase ?? 0),
            createMany: jest.fn().mockImplementation(({ data }: any) => { importerrors.push(...data); return Promise.resolve({}); }),
            create: jest.fn().mockImplementation(({ data }: any) => { importerrors.push(data); return Promise.resolve({}); }),
        },
    };

    // Las dos escrituras de la compensación sin tracker van juntas, en una transacción.
    const tx: any = {
        remesa: { updateMany: jest.fn().mockResolvedValue({ count: o.remesa?.estadoProceso === 'FINALIZADA' ? 0 : 1 }) },
        import_progreso: { upsert: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction = jest.fn().mockImplementation((fn: any) => fn(tx));

    const eventos: Evento[] = [];
    const realtime: any = {
        emitImportIniciada: jest.fn().mockImplementation((estado: EstadoCargaDto) => eventos.push({ evento: 'iniciada', estado })),
        emitImportProgreso: jest.fn().mockImplementation((estado: EstadoCargaDto) => eventos.push({ evento: 'progreso', estado })),
        emitImportFinalizada: jest.fn().mockImplementation((estado: EstadoCargaDto) => eventos.push({ evento: 'finalizada', estado })),
    };
    const notificaciones: any = { crear: jest.fn().mockResolvedValue(undefined) };

    const processor: any = {
        category: 'DEUDORES',
        processRow: jest.fn().mockResolvedValue(undefined),
        afterAll: jest.fn().mockResolvedValue(undefined),
        ...o.processor,
    };
    (getProcessor as jest.Mock).mockReturnValue(processor);

    const service = new ImportService(
        prisma, {} as any, {} as any, realtime, notificaciones, {} as any, {} as any, {} as any, {} as any,
    );
    const job: any = { id: 'job-1', data: o.sinDueno ? {} : { usuarioId: 3 }, updateProgress: jest.fn().mockResolvedValue(undefined), ...o.job };

    return {
        service, job, prisma, tx, remesaRow, escrituras, importerrors, eventos, realtime, notificaciones, processor,
        fila: () => fila,
    };
}

const textoNotificacion = (n: any) => `${n.titulo} ${n.mensaje}`;

beforeAll(() => Logger.overrideLogger(false));
afterAll(() => {
    for (const f of archivosTemporales) fs.rmSync(f, { force: true });
});
afterEach(() => jest.restoreAllMocks());

describe('processImportJob — secuencia de eventos y estado', () => {
    it('B-1: 2.500 filas en lotes emite iniciada · progreso 40/80/99 · POST_PROCESO · finalizada 100 OK', async () => {
        const B = IMPORTS_BATCH_SIZE;
        const N = Math.floor(B * 2.5);
        const h = armar({ filas: N });

        await expect(h.service.processImportJob(h.job, 1)).resolves.toEqual({ total: N, ok: N, err: 0 });

        const seq = h.eventos.map((e) => [e.evento, e.estado.fase, e.estado.progreso]);
        expect(seq).toEqual([
            ['iniciada', 'PROCESANDO', 0],
            ['progreso', 'PROCESANDO', Math.floor((B * 100) / N)],
            ['progreso', 'PROCESANDO', Math.floor((2 * B * 100) / N)],
            ['progreso', 'PROCESANDO', 99],
            ['progreso', 'POST_PROCESO', 99],
            ['finalizada', 'TERMINADA', 100],
        ]);
        if (B === 1000) expect(h.eventos.map((e) => e.estado.progreso)).toEqual([0, 40, 80, 99, 99, 100]);

        expect(h.eventos.filter((e) => e.evento === 'iniciada')).toHaveLength(1);
        expect(h.eventos.filter((e) => e.evento === 'finalizada')).toHaveLength(1);
        const revs = h.eventos.map((e) => e.estado.rev);
        revs.forEach((r, i) => i > 0 && expect(r).toBeGreaterThan(revs[i - 1]));
        h.eventos.filter((e) => e.evento === 'progreso').forEach((e) => {
            expect(e.estado.progreso).toBeLessThanOrEqual(99);
            expect(e.estado.enCurso).toBe(true);
            expect(e.estado.terminal).toBe(false);
        });
        h.eventos.forEach((e) => expect(e.estado.totalEsperado).toBe(N));

        const fin = h.eventos[h.eventos.length - 1].estado;
        expect(fin).toMatchObject({
            terminal: true, enCurso: false, resultado: 'OK', ok: N, procesadas: N, estadoProceso: 'FINALIZADA', usuarioId: 3,
        });
        expect(fin.finishedAt).not.toBeNull();

        // CA-5: ninguna escritura anterior a la final toca `remesa.totalFilas`; la final lo deja en N.
        const previas = h.escrituras.slice(0, -1);
        expect(previas.length).toBeGreaterThan(0);
        previas.forEach((w) => expect(w.remesa).not.toHaveProperty('totalFilas'));
        expect(h.escrituras[h.escrituras.length - 1].remesa).toMatchObject({ estadoProceso: 'FINALIZADA', totalFilas: N });
        // Todas las escrituras de la remesa llevan la fila de progreso anidada (una sola escritura atómica).
        h.escrituras.forEach((w) => expect(w.progreso).not.toBeNull());
        expect(h.fila()).toMatchObject({ fase: 'TERMINADA', resultado: 'OK', porcentaje: 100, intentos: 1, jobId: 'job-1' });
    });

    it('B-2: un archivo con solo el encabezado termina SIN_FILAS al 100, sin NaN y sin "0 filas correctamente"', async () => {
        const h = armar({ soloEncabezado: true, remesa: { totalFilas: 0 } });

        await h.service.processImportJob(h.job, 1);

        expect(h.eventos[0].evento).toBe('iniciada');
        const ultimo = h.eventos[h.eventos.length - 1];
        expect(ultimo.evento).toBe('finalizada');
        expect(ultimo.estado).toMatchObject({ resultado: 'SIN_FILAS', progreso: 100, terminal: true });
        h.eventos.forEach((e) =>
            Object.values(e.estado).forEach((v) => {
                if (typeof v === 'number') expect(Number.isNaN(v)).toBe(false);
            }),
        );
        expect(h.processor.processRow).not.toHaveBeenCalled();
        expect(h.notificaciones.crear).toHaveBeenCalledTimes(1);
        const notif = h.notificaciones.crear.mock.calls[0][0];
        expect(notif.titulo).toBe('Importación sin filas');
        expect(textoNotificacion(notif)).not.toContain('0 filas correctamente');
        expect(h.remesaRow.estadoProceso).toBe('FINALIZADA');
    });

    it('B-3: todas las filas descartadas por el filtro de la remesa es SIN_FILAS con el número de descartadas', async () => {
        const h = armar({
            filas: 5,
            columna1: 'Y',
            remesa: { filtroFilas: [{ fromIndex: 1, operador: 'IGUAL', valor: 'X' }] },
        });

        await h.service.processImportJob(h.job, 1);

        const fin = h.eventos[h.eventos.length - 1].estado;
        expect(fin).toMatchObject({ resultado: 'SIN_FILAS', descartadas: 5, procesadas: 0 });
        expect(h.notificaciones.crear.mock.calls[0][0].mensaje).toContain('5');
        expect(h.fila().descartadas).toBe(5);
    });

    it('B-4: plantilla de DEUDORES sin estado inicial deja la remesa FALLIDA con el motivo y okFilas/errFilas en 0', async () => {
        const h = armar({
            plantilla: { defaultEstadoSituacionId: null, defaultEstadoGestionId: null },
            remesa: { okFilas: 50, errFilas: 0 }, // los de la muestra de la vista previa
        });

        await expect(h.service.processImportJob(h.job, 1)).rejects.toThrow(/estado inicial/);

        expect(h.eventos.map((e) => e.evento)).toEqual(['iniciada', 'finalizada']);
        const fin = h.eventos[1].estado;
        expect(fin).toMatchObject({ resultado: 'FALLIDA', estadoProceso: 'FALLIDA', terminal: true });
        expect(fin.error).toContain('estado inicial');
        expect(h.remesaRow).toMatchObject({ estadoProceso: 'FALLIDA', okFilas: 0, errFilas: 0 });
        expect(h.fila()).toMatchObject({ resultado: 'FALLIDA', fase: 'TERMINADA' });
        expect(h.fila().error).toContain('estado inicial');
        expect(h.notificaciones.crear.mock.calls[0][0]).toMatchObject({ tipo: 'IMPORTACION_ERROR', titulo: 'Importación fallida' });
    });

    it('B-5: una excepción en el segundo lote da una sola finalizada FALLIDA con los contadores reales', async () => {
        const B = IMPORTS_BATCH_SIZE;
        const h = armar({ filas: B * 3 });
        let llamadas = 0;
        h.job.updateProgress = jest.fn().mockImplementation(() => {
            llamadas++;
            return llamadas === 2 ? Promise.reject(new Error('Redis se cayó')) : Promise.resolve();
        });

        await expect(h.service.processImportJob(h.job, 1)).rejects.toThrow('Redis se cayó');

        const finales = h.eventos.filter((e) => e.evento === 'finalizada');
        expect(finales).toHaveLength(1);
        expect(finales[0].estado).toMatchObject({ resultado: 'FALLIDA', ok: B * 2, procesadas: B * 2, error: 'Redis se cayó' });
        expect(h.remesaRow).toMatchObject({ estadoProceso: 'FALLIDA', okFilas: B * 2, errFilas: 0 });
    });

    it('B-6: un afterAll que tira deja FINALIZADA con CON_ADVERTENCIAS, el motivo, una fila [post-proceso] y la notificación', async () => {
        const h = armar({
            filas: 10,
            processor: { afterAll: jest.fn().mockRejectedValue(new Error('Deadlock al consolidar\ndetalle interno')) },
        });

        await expect(h.service.processImportJob(h.job, 1)).resolves.toEqual({ total: 10, ok: 10, err: 0 });

        expect(h.remesaRow.estadoProceso).toBe('FINALIZADA');
        expect(h.fila()).toMatchObject({ resultado: 'CON_ADVERTENCIAS', advertencias: 1 });
        expect(h.fila().errorPostProceso).toContain('Deadlock al consolidar');
        expect(h.importerrors.some((e) => String(e.errorMsg).startsWith('[post-proceso] Deadlock'))).toBe(true);
        const notif = h.notificaciones.crear.mock.calls[0][0];
        expect(notif.titulo).toBe('Importación finalizada con advertencias');
        expect(notif.payload.resultado).toBe('CON_ADVERTENCIAS');
        const fin = h.eventos[h.eventos.length - 1];
        expect(fin).toMatchObject({ evento: 'finalizada' });
        expect(fin.estado.errorPostProceso).toContain('Deadlock');
    });

    it('B-7: si las 12 filas dan error termina CON_ERRORES, notifica IMPORTACION_ERROR y no dice "fallida"', async () => {
        const h = armar({ filas: 12, processor: { processRow: jest.fn().mockRejectedValue(new Error('fila inválida')) } });

        await expect(h.service.processImportJob(h.job, 1)).resolves.toEqual({ total: 12, ok: 0, err: 12 });

        expect(h.remesaRow.estadoProceso).toBe('FINALIZADA');
        expect(h.eventos[h.eventos.length - 1].estado.resultado).toBe('CON_ERRORES');
        const notif = h.notificaciones.crear.mock.calls[0][0];
        expect(notif.tipo).toBe('IMPORTACION_ERROR');
        expect(notif.titulo).toBe('Importación sin filas cargadas');
        expect(textoNotificacion(notif).toLowerCase()).not.toContain('fallida');
    });

    it('B-8: una re-ejecución reinicia los contadores, suma el intento, sigue creciendo rev y deja un warn', async () => {
        const warn = jest.spyOn(Logger.prototype, 'warn');
        const h = armar({
            filas: 10,
            previa: {
                fase: 'PROCESANDO', rev: 7, intentos: 1, procesadas: 1000, ok: 1000, totalEsperado: 10,
                encoladaAt: new Date('2026-10-05T14:00:00Z'), startedAt: new Date('2026-10-05T14:00:01Z'),
            },
        });

        await h.service.processImportJob(h.job, 1);

        const iniciada = h.eventos[0];
        expect(iniciada.evento).toBe('iniciada');
        expect(iniciada.estado).toMatchObject({ intentos: 2, procesadas: 0, ok: 0 });
        expect(iniciada.estado.rev).toBeGreaterThan(7);
        expect(warn.mock.calls.some(([m]) => String(m).includes('Re-ejecución'))).toBe(true);
        // `encoladaAt` solo se escribe si estaba en null: el de la fila previa se conserva.
        expect(h.fila().encoladaAt).toEqual(new Date('2026-10-05T14:00:00Z'));
    });

    it('B-9: sin fila previa (job del código viejo) la crea y termina normal', async () => {
        const h = armar({ filas: 10, previa: null });
        expect(h.fila()).toBeNull();

        await h.service.processImportJob(h.job, 1);

        expect(h.fila()).toMatchObject({ resultado: 'OK', intentos: 1 });
        expect(h.fila().encoladaAt).toBeInstanceOf(Date);
        expect(h.eventos[h.eventos.length - 1].estado.resultado).toBe('OK');
    });

    it('B-10: sin dueño persiste y emite con usuarioId null y no crea notificación', async () => {
        const h = armar({ filas: 10, sinDueno: true });

        await h.service.processImportJob(h.job, 1);

        h.eventos.forEach((e) => expect(e.estado.usuarioId).toBeNull());
        expect(h.eventos[h.eventos.length - 1].estado).toMatchObject({ resultado: 'OK', usuarioNombre: 'Sistema' });
        expect(h.notificaciones.crear).not.toHaveBeenCalled();
        expect(h.remesaRow.estadoProceso).toBe('FINALIZADA');
    });

    it('B-11: si notificaciones.crear rechaza la carga sigue FINALIZADA, resuelve y no hay segunda finalizada', async () => {
        const h = armar({ filas: 10 });
        h.notificaciones.crear.mockRejectedValue(new Error('no entra en la columna'));

        await expect(h.service.processImportJob(h.job, 1)).resolves.toEqual({ total: 10, ok: 10, err: 0 });

        expect(h.remesaRow.estadoProceso).toBe('FINALIZADA');
        expect(h.eventos.filter((e) => e.evento === 'finalizada')).toHaveLength(1);
        expect(h.fila().resultado).toBe('OK');
    });

    it('B-12: si el emisor de socket tira en todas las llamadas la carga termina FINALIZADA igual', async () => {
        const h = armar({ filas: 10 });
        for (const m of ['emitImportIniciada', 'emitImportProgreso', 'emitImportFinalizada']) {
            h.realtime[m].mockImplementation(() => { throw new Error('socket caído'); });
        }

        await expect(h.service.processImportJob(h.job, 1)).resolves.toEqual({ total: 10, ok: 10, err: 0 });

        expect(h.remesaRow.estadoProceso).toBe('FINALIZADA');
        expect(h.fila()).toMatchObject({ resultado: 'OK', porcentaje: 100 });
    });

    it('las advertencias de parseo pasadas de 500 dejan una fila más con cuántas se omitieron', async () => {
        const h = armar();
        const advertencias = Array.from({ length: 620 }, (_, i) => `aviso ${i}`);

        await (h.service as any).registrarAdvertenciasDeParseo(1, advertencias);

        expect(h.importerrors).toHaveLength(501);
        expect(h.importerrors[0].errorMsg).toBe('[parseo] aviso 0');
        expect(h.importerrors[500].errorMsg).toBe(
            '[parseo] Se omitieron 120 advertencias más (se guardan las primeras 500).',
        );
    });

    it('sin avisos de parseo el contador de advertencias queda en 0 y no hay filas [parseo]', async () => {
        const h = armar({ filas: 3 });
        await h.service.processImportJob(h.job, 1);
        expect(h.fila().advertencias).toBe(0);
        expect(h.importerrors).toHaveLength(0);
    });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Correcciones de la auditoría (F1 a F9)
 * ──────────────────────────────────────────────────────────────────────────── */

const errorDePrisma = () => {
    const e: any = new Error(
        'Invalid `prisma.deudor.create()` invocation in\n/app/dist/modules/imports/processors/deudores.processor.js:88:40\n\n' +
        '  85 const x = await prisma.deudor.create({\n→ 88   data: {...}\n\nUnique constraint failed on the constraint: `Deudor_documento_key`',
    );
    e.code = 'P2002';
    return e;
};

describe('processImportJob — correcciones de la auditoría', () => {
    it('F1b: si la lectura inicial de la remesa tira, la carga queda FALLIDA con el motivo en vez de EN_COLA', async () => {
        const h = armar({ findUniqueRechaza: true });

        await expect(h.service.processImportJob(h.job, 1)).rejects.toThrow('la base no responde');

        expect(h.tx.remesa.updateMany).toHaveBeenCalledWith({
            where: { id: 1, estadoProceso: { notIn: ['FINALIZADA', 'FALLIDA'] } },
            data: { estadoProceso: 'FALLIDA' },
        });
        const up = h.tx.import_progreso.upsert.mock.calls[0][0];
        expect(up.update).toMatchObject({ fase: 'TERMINADA', resultado: 'FALLIDA', error: 'la base no responde' });
        expect(up.update.finishedAt).toBeInstanceOf(Date);
    });

    it('G4: si la remesa ya era terminal, la compensación no la pisa', async () => {
        const h = armar({ findUniqueRechaza: true, remesa: { estadoProceso: 'FINALIZADA' } });

        await expect(h.service.processImportJob(h.job, 1)).rejects.toThrow('la base no responde');

        expect(h.tx.remesa.updateMany).toHaveBeenCalledTimes(1);
        expect(h.tx.import_progreso.upsert).not.toHaveBeenCalled();
        expect(h.prisma.remesa.update).not.toHaveBeenCalled();
    });

    it('G5: un job sobre un borrador (fila de progreso sin encoladaAt) se ignora y no procesa ni emite', async () => {
        const h = armar({ filas: 10, previa: { fase: 'BORRADOR', encoladaAt: null } });
        const warn = jest.spyOn(Logger.prototype, 'warn');

        await expect(h.service.processImportJob(h.job, 1)).resolves.toMatchObject({ ignorado: true, ok: 0 });

        expect(h.processor.processRow).not.toHaveBeenCalled();
        expect(h.prisma.remesa.update).not.toHaveBeenCalled();
        expect(h.eventos).toHaveLength(0);
        expect(warn.mock.calls.some(([m]) => String(m).includes('es un borrador'))).toBe(true);
    });

    it('G5: un borrador anterior al deploy (sin fila) no lo alcanza la guarda', async () => {
        const h = armar({ filas: 3, previa: null });
        await expect(h.service.processImportJob(h.job, 1)).resolves.toEqual({ total: 3, ok: 3, err: 0 });
    });

    it('G7: los avisos se cuentan con rowNumber 0 y lo que el runner ya anotó (post-proceso, avisos de MULTICLAVES) no se cuenta doble', async () => {
        // Un afterAll que tira escribe UNA fila [post-proceso] (ya contada en memoria); la base la devuelve en el count.
        const h = armar({
            filas: 5, avisosEnBase: 1,
            processor: { afterAll: jest.fn().mockRejectedValue(new Error('x')) },
        });
        await h.service.processImportJob(h.job, 1);
        expect(h.prisma.importerror.count.mock.calls[0][0].where.rowNumber).toBe(0);
        expect(h.fila().advertencias).toBe(1);
    });

    it('F2: si no se puede registrar la fase POST_PROCESO igual corre el afterAll y la carga termina FINALIZADA', async () => {
        const h = armar({
            filas: 10,
            updateRechaza: (d) => d.progreso?.upsert?.create?.fase === 'POST_PROCESO',
        });

        await expect(h.service.processImportJob(h.job, 1)).resolves.toEqual({ total: 10, ok: 10, err: 0 });

        expect(h.processor.afterAll).toHaveBeenCalledTimes(1);
        expect(h.remesaRow.estadoProceso).toBe('FINALIZADA');
        expect(h.fila().resultado).toBe('OK');
    });

    it('F3: un afterAll que tira un error real de Prisma guarda un motivo legible (última línea + código), sin rutas ni código', async () => {
        const h = armar({ filas: 5, processor: { afterAll: jest.fn().mockRejectedValue(errorDePrisma()) } });

        await h.service.processImportJob(h.job, 1);

        expect(h.fila().errorPostProceso).toBe('Unique constraint failed on the constraint: `Deudor_documento_key` (P2002)');
        expect(h.importerrors.find((e) => String(e.errorMsg).startsWith('[post-proceso]'))!.errorMsg)
            .toBe('[post-proceso] Unique constraint failed on the constraint: `Deudor_documento_key` (P2002)');
        const notif = h.notificaciones.crear.mock.calls[0][0];
        expect(notif.mensaje).toContain('Unique constraint failed');
        expect(notif.mensaje).not.toContain('invocation');
    });

    it('F3: una carga FALLIDA por un error de Prisma guarda y notifica el motivo legible, no el fragmento de código', async () => {
        // Una excepción real (no una fila con error): el `updateProgress` del lote rechaza.
        const h2 = armar({ filas: 5, job: { updateProgress: jest.fn().mockRejectedValue(errorDePrisma()) } });

        await expect(h2.service.processImportJob(h2.job, 1)).rejects.toBeDefined();

        expect(h2.fila().error).toBe('Unique constraint failed on the constraint: `Deudor_documento_key` (P2002)');
        expect(h2.fila().error).not.toContain('/app/dist');
        expect(h2.notificaciones.crear.mock.calls[0][0].mensaje).not.toContain('invocation');
    });

    it('F4: un job sobre una carga ya terminada no la reprocesa ni emite, y devuelve los contadores que tiene', async () => {
        const fin = new Date('2026-10-05T14:00:00Z');
        const h = armar({
            filas: 250,
            remesa: { estadoProceso: 'FINALIZADA' },
            previa: { fase: 'TERMINADA', resultado: 'OK', procesadas: 250, ok: 248, err: 2, finishedAt: fin, startedAt: fin, encoladaAt: fin },
        });
        const warn = jest.spyOn(Logger.prototype, 'warn');

        await expect(h.service.processImportJob(h.job, 1)).resolves.toEqual({ total: 250, ok: 248, err: 2, ignorado: true });

        expect(h.processor.processRow).not.toHaveBeenCalled();
        expect(h.prisma.remesa.update).not.toHaveBeenCalled();
        expect(h.eventos).toHaveLength(0);
        expect(h.notificaciones.crear).not.toHaveBeenCalled();
        expect(warn.mock.calls.some(([m]) => String(m).includes('ya terminó'))).toBe(true);
    });

    it('F4: la guarda es en negativo: una FINALIZADA sin fila de progreso (fixture vieja) se procesa como siempre', async () => {
        const h = armar({ filas: 3, remesa: { estadoProceso: 'FINALIZADA' }, previa: null });
        await expect(h.service.processImportJob(h.job, 1)).resolves.toEqual({ total: 3, ok: 3, err: 0 });
    });

    it('F6: si fallar() no puede persistir, la notificación lo dice y no se emite finalizada', async () => {
        const h = armar({
            plantilla: { defaultEstadoSituacionId: null, defaultEstadoGestionId: null },
            updateRechaza: (d) => d.estadoProceso === 'FALLIDA',
        });

        await expect(h.service.processImportJob(h.job, 1)).rejects.toThrow(/estado inicial/);

        expect(h.eventos.map((e) => e.evento)).toEqual(['iniciada']);
        expect(h.remesaRow.estadoProceso).toBe('PROCESANDO');
        const notif = h.notificaciones.crear.mock.calls[0][0];
        expect(notif.titulo).toBe('Importación fallida');
        expect(notif.mensaje).toContain('estado inicial');
        expect(notif.mensaje).toContain('El estado no se pudo registrar: la carga puede figurar todavía en proceso.');
        expect(notif.mensaje.length).toBeLessThanOrEqual(1000);
    });

    it('F7: suma a `advertencias` los avisos que escribieron los processors, contando solo por prefijo de aviso', async () => {
        const h = armar({ filas: 5, avisosEnBase: 3 });

        await h.service.processImportJob(h.job, 1);

        expect(h.fila().advertencias).toBe(3);
        expect(h.eventos[h.eventos.length - 1].estado.advertencias).toBe(3);
        const where = h.prisma.importerror.count.mock.calls[0][0].where;
        expect(where.remesaId).toBe(1);
        expect(where.OR).toEqual([
            { errorMsg: { startsWith: '[aviso]' } },
            { errorMsg: { startsWith: '[parseo]' } },
            { errorMsg: { startsWith: '[post-proceso]' } },
        ]);
    });

    it('F7: si no hay avisos de processors, `advertencias` queda en 0; y un count que falla no tumba la carga', async () => {
        const h = armar({ filas: 5 });
        await h.service.processImportJob(h.job, 1);
        expect(h.fila().advertencias).toBe(0);

        const h2 = armar({ filas: 5 });
        h2.prisma.importerror.count.mockRejectedValue(new Error('timeout'));
        await expect(h2.service.processImportJob(h2.job, 1)).resolves.toMatchObject({ ok: 5 });
        expect(h2.remesaRow.estadoProceso).toBe('FINALIZADA');
    });

    it('F9: un error de negocio (HttpException) se loguea como warn y uno inesperado como error con stack', async () => {
        const error = jest.spyOn(Logger.prototype, 'error');
        const negocio = armar({ plantilla: { defaultEstadoSituacionId: null, defaultEstadoGestionId: null } });
        await expect(negocio.service.processImportJob(negocio.job, 1)).rejects.toBeInstanceOf(BadRequestException);
        expect(error).not.toHaveBeenCalled();

        const inesperado = armar({ filas: 3, job: { updateProgress: jest.fn().mockRejectedValue(new Error('boom')) } });
        await expect(inesperado.service.processImportJob(inesperado.job, 1)).rejects.toThrow('boom');
        expect(error.mock.calls.some(([m, stack]) => String(m).includes('falló') && typeof stack === 'string')).toBe(true);
    });

    it('el updateProgress final que rechaza (después del post-proceso) no convierte la carga en FALLIDA', async () => {
        const h = armar({ filas: 10 });
        let n = 0;
        h.job.updateProgress = jest.fn().mockImplementation(() => (++n === 2 ? Promise.reject(new Error('redis')) : Promise.resolve()));

        await expect(h.service.processImportJob(h.job, 1)).resolves.toEqual({ total: 10, ok: 10, err: 0 });

        expect(h.remesaRow.estadoProceso).toBe('FINALIZADA');
        expect(h.eventos.filter((e) => e.evento === 'finalizada')).toHaveLength(1);
        expect(h.eventos[h.eventos.length - 1].estado.resultado).toBe('OK');
    });

    it('H3: si falla la segunda escritura de la compensación no queda la primera (van en una sola transacción)', async () => {
        const h = armar({ findUniqueRechaza: true });
        h.tx.import_progreso.upsert.mockRejectedValue(new Error('upsert falló'));
        // La transacción real revierte todo: acá se afirma que ambas pasan por `$transaction` y nunca sueltas.
        h.prisma.$transaction.mockImplementation(async (fn: any) => { await fn(h.tx); });

        await expect(h.service.processImportJob(h.job, 1)).rejects.toThrow('la base no responde');

        expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(h.tx.remesa.updateMany).toHaveBeenCalledTimes(1);
        expect(h.prisma.remesa.update).not.toHaveBeenCalled();
    });

    it('H2: si la remesa se borró mientras iniciar() esperaba el lock, corta antes de procesar y no emite finalizada', async () => {
        const h = armar({ filas: 10 });
        const original = h.prisma.remesa.findUnique.getMockImplementation()!;
        // 1ª lectura: existe; la relectura posterior a iniciar(): ya no.
        h.prisma.remesa.findUnique.mockImplementationOnce(original).mockResolvedValueOnce(null);

        await expect(h.service.processImportJob(h.job, 1)).resolves.toMatchObject({ ignorado: true });

        expect(h.processor.processRow).not.toHaveBeenCalled();
        expect(h.eventos.map((e) => e.evento)).toEqual(['iniciada']);
        expect(h.notificaciones.crear).not.toHaveBeenCalled();
    });

    it('H4/H5: una remesa inexistente y una sin archivo o plantilla son NotFoundException (negocio, no Error común)', async () => {
        const inexistente = armar();
        inexistente.prisma.remesa.findUnique.mockResolvedValue(null);
        await expect(inexistente.service.processImportJob(inexistente.job, 1)).rejects.toBeInstanceOf(NotFoundException);

        const sinArchivo = armar({ remesa: { archivo: null } });
        const error = jest.spyOn(Logger.prototype, 'error');
        await expect(sinArchivo.service.processImportJob(sinArchivo.job, 1)).rejects.toBeInstanceOf(NotFoundException);
        expect(error).not.toHaveBeenCalled();
    });

    it('G7: los avisos de lectura de MULTICLAVES ya anotados por el runner no se cuentan doble con los de la base', async () => {
        (parseMulticlaves as jest.Mock).mockReturnValue({
            tramites: [{ nroTramite: '1' }, { nroTramite: '2' }],
            avisos: [
                { codigo: 'SOLO_TOTAL', cantidad: 5, ejemplos: ['1'] },
                { codigo: 'OTRO', cantidad: 1, ejemplos: ['2'] },
            ],
            resumen: { lineas: 2, tramites: 2, rechazados: 0, porAviso: {} },
        });
        const h = armar({
            remesa: { categoria: 'MULTICLAVES', totalFilas: 0 },
            plantilla: { mappingJson: { columns: {}, multiclaves: { codigosGestor: ['1'] } } },
            avisosEnBase: 2, // las dos filas [aviso] que escribió el runner
        });

        await h.service.processImportJob(h.job, 1);

        expect(h.eventos[h.eventos.length - 1].estado).toMatchObject({ advertencias: 2, totalEsperado: 2 });
    });

    describe('ramas pre-parseadas (MULTIRREGISTRO)', () => {
        const armarMulti = (advertencias: string[], avisosEnBase = 0) => {
            (parseMultirregistro as jest.Mock).mockReturnValue({
                filas: [{ nroCliente: '1' }, { nroCliente: '2' }, { nroCliente: '3' }],
                advertencias,
                resumen: { lineas: 3, porTipo: {}, casos: 3, facturas: 0, bajas: 0, ignoradas: 0 },
            });
            return armar({
                remesa: { categoria: 'MULTIRREGISTRO', totalFilas: 0 },
                plantilla: { mappingJson: { columns: {}, multirregistro: { tipoLinea: {} } } },
                avisosEnBase,
            });
        };

        it('fija el total esperado del parseo aunque la vista previa lo dejara en 0, y cuenta las advertencias reales', async () => {
            const h = armarMulti(['a', 'b']);

            await h.service.processImportJob(h.job, 1);

            const progresos = h.eventos.filter((e) => e.evento === 'progreso');
            expect(progresos.length).toBeGreaterThan(0);
            progresos.forEach((e) => expect(e.estado.totalEsperado).toBe(3));
            expect(h.eventos[h.eventos.length - 1].estado).toMatchObject({ totalEsperado: 3, advertencias: 2, ok: 3 });
        });

        it('con más de 500 advertencias el contador dice el total real y no baja con lo que hay en la base', async () => {
            const h = armarMulti(Array.from({ length: 600 }, (_, i) => `a${i}`), 501);
            const warn = jest.spyOn(Logger.prototype, 'warn');

            await h.service.processImportJob(h.job, 1);

            expect(h.eventos[h.eventos.length - 1].estado.advertencias).toBe(600);
            expect(h.importerrors).toHaveLength(501);
            // F9a: un solo warn por la carga con advertencias de parseo.
            expect(warn.mock.calls.filter(([m]) => String(m).includes('advertencia(s) de parseo'))).toHaveLength(1);
        });
    });
});
