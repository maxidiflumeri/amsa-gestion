/**
 * Alta, vista previa, encolado, lecturas y borrado alrededor del progreso de una carga
 * (docs/imports-progreso-realtime-spec.md §8.9.1 C). `prisma` va mockeado, como en el resto de los
 * specs de cableado de imports.
 */
import {
    BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException,
} from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as xlsx from 'xlsx';
import { ImportService } from './imports.service';
import { parseMultirregistro } from './utils/multirregistro-parser';

jest.mock('./utils/multirregistro-parser', () => ({ parseMultirregistro: jest.fn() }));

let dir: string;
beforeAll(() => {
    Logger.overrideLogger(false);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imports-progreso-http-'));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const FILA = {
    remesaId: 1, rev: 3, fase: 'BORRADOR', subfase: null, porcentaje: 0, totalEsperado: 0, procesadas: 0, ok: 0, err: 0,
    descartadas: 0, advertencias: 0, nuevos: null, actualizados: null, resultado: null, error: null, errorPostProceso: null,
    resumen: null, intentos: 0, jobId: null, grupoId: null, grupoOrden: null, grupoTotal: null, cancelSolicitadaAt: null,
    encoladaAt: null, startedAt: null, heartbeatAt: null, finishedAt: null,
};

const REMESA = {
    id: 1, empresaId: 10, numeroRemesa: '00001', nombre: 'Carga', categoria: 'DEUDORES', estadoProceso: 'VALIDANDO',
    totalFilas: 912, okFilas: 50, errFilas: 0, usuarioCreadorId: 3, usuarioCreador: { id: 3, nombre: 'Maxi' },
};

/* ────────────────────────────────────────────────────────────────────────────
 * executeRemesa
 * ──────────────────────────────────────────────────────────────────────────── */

interface OpcionesEjecutar {
    estadoProceso?: string;
    totalFilas?: number;
    encoladaAt?: Date | null;
    otrasEnCurso?: number[];
    queueFalla?: boolean;
}

function armarEjecutar(o: OpcionesEjecutar = {}) {
    const fila = {
        estadoProceso: o.estadoProceso ?? 'VALIDANDO',
        totalFilas: o.totalFilas ?? 912,
        encoladaAt: o.encoladaAt ?? null,
    };
    const updates: any[] = [];
    const sqls: string[] = [];
    const valores: any[][] = [];
    const tx: any = {
        $queryRaw: jest.fn().mockImplementation((strings: TemplateStringsArray, ...vals: any[]) => {
            const sql = strings.join('?');
            sqls.push(sql);
            valores.push(vals);
            if (sql.includes('FROM usuario')) return Promise.resolve([{ id: 3 }]);
            if (sql.includes('LEFT JOIN import_progreso')) return Promise.resolve([fila]);
            if (sql.includes('JOIN remesa r')) return Promise.resolve((o.otrasEnCurso ?? []).map((remesaId) => ({ remesaId })));
            return Promise.resolve([]);
        }),
        remesa: {
            update: jest.fn().mockImplementation(({ data }: any) => {
                updates.push(data);
                const c = data.progreso.upsert.create;
                return Promise.resolve({
                    ...REMESA, estadoProceso: 'PENDIENTE', okFilas: 0, errFilas: 0,
                    progreso: { ...FILA, ...c, remesaId: 1 },
                });
            }),
        },
    };
    const prisma: any = {
        remesa: {
            findUnique: jest.fn().mockResolvedValue({ id: 1, categoria: 'DEUDORES' }),
            update: jest.fn().mockImplementation(({ data }: any) => { updates.push(data); return Promise.resolve({}); }),
        },
        $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
    };
    const queue: any = {
        add: o.queueFalla ? jest.fn().mockRejectedValue(new Error('ECONNREFUSED redis')) : jest.fn().mockResolvedValue({ id: 'job-7' }),
    };
    const realtime: any = { emitImportProgreso: jest.fn() };
    const requestContext: any = { get: jest.fn().mockReturnValue(undefined) };
    const service = new ImportService(
        prisma, {} as any, queue, realtime, {} as any, requestContext, {} as any, {} as any, {} as any,
    );
    return { service, prisma, tx, queue, realtime, updates, sqls, valores };
}

describe('executeRemesa', () => {
    it('C-1: sobre un borrador validado deja la fila EN_COLA, encola una vez, emite y devuelve la carga', async () => {
        const h = armarEjecutar();

        const res = await h.service.executeRemesa(1, 3);

        expect(h.tx.remesa.update).toHaveBeenCalledTimes(1);
        const data = h.updates[0];
        expect(data).toMatchObject({ estadoProceso: 'PENDIENTE', usuarioCreadorId: 3, okFilas: 0, errFilas: 0 });
        expect(data.progreso.upsert.create).toMatchObject({ fase: 'EN_COLA', totalEsperado: 912 });
        expect(data.progreso.upsert.create.encoladaAt).toBeInstanceOf(Date);
        // La rama que corre siempre es `update` (la fila nace con la remesa): tiene que escribir `encoladaAt`.
        expect(data.progreso.upsert.update).toMatchObject({ fase: 'EN_COLA', rev: { increment: 1 }, finishedAt: null, resultado: null, totalEsperado: 912, porcentaje: 0 });
        expect(data.progreso.upsert.update.encoladaAt).toBeInstanceOf(Date);
        expect(data.progreso.upsert.update.encoladaAt).toEqual(data.progreso.upsert.create.encoladaAt);
        expect(h.queue.add).toHaveBeenCalledTimes(1);
        expect(h.queue.add.mock.calls[0][1]).toMatchObject({ remesaId: 1, usuarioId: 3 });
        expect(h.realtime.emitImportProgreso).toHaveBeenCalledTimes(1);
        expect(h.realtime.emitImportProgreso.mock.calls[0][0]).toMatchObject({ fase: 'EN_COLA', enCurso: true, ok: 0 });
        expect(res).toMatchObject({ message: 'Importación encolada correctamente', remesaId: 1 });
        expect(res.carga).toMatchObject({ fase: 'EN_COLA', enCurso: true, terminal: false, totalEsperado: 912, progreso: 0 });
        // El mutex es la fila del usuario, y la lectura de la remesa también toma el lock.
        expect(h.sqls[0]).toContain('FROM usuario');
        expect(h.sqls[0]).toContain('FOR UPDATE');
        expect(h.valores[0]).toEqual([3]);
        const lectura = h.sqls.findIndex((q) => q.includes('LEFT JOIN import_progreso'));
        expect(h.sqls[lectura]).toContain('FOR UPDATE');
        expect(h.valores[lectura]).toEqual([1]);
        // Y guarda el id del job para poder sacarlo de la cola si la carga nunca arranca.
        expect(h.prisma.remesa.update).toHaveBeenCalledWith({
            where: { id: 1 }, data: { progreso: { update: { jobId: 'job-7' } } },
        });
    });

    it('C-2: sobre una remesa ya encolada responde 409 y no encola', async () => {
        const h = armarEjecutar({ estadoProceso: 'PENDIENTE', encoladaAt: new Date() });

        await expect(h.service.executeRemesa(1, 3)).rejects.toThrow(ConflictException);
        await expect(h.service.executeRemesa(1, 3)).rejects.toThrow('Esta importación ya fue confirmada.');
        expect(h.queue.add).not.toHaveBeenCalled();
        expect(h.tx.remesa.update).not.toHaveBeenCalled();
    });

    it('C-3: sobre una FINALIZADA responde 409', async () => {
        const h = armarEjecutar({ estadoProceso: 'FINALIZADA' });
        await expect(h.service.executeRemesa(1, 3)).rejects.toThrow(ConflictException);
        expect(h.queue.add).not.toHaveBeenCalled();
    });

    it('C-4: una VALIDANDO con totalFilas 0 responde 400 y no encola', async () => {
        const h = armarEjecutar({ estadoProceso: 'VALIDANDO', totalFilas: 0 });
        await expect(h.service.executeRemesa(1, 3)).rejects.toThrow(BadRequestException);
        await expect(h.service.executeRemesa(1, 3)).rejects.toThrow(/no encontró filas/);
        expect(h.queue.add).not.toHaveBeenCalled();
    });

    it('C-5: una PENDIENTE (sin vista previa) con totalFilas 0 encola', async () => {
        const h = armarEjecutar({ estadoProceso: 'PENDIENTE', totalFilas: 0 });
        await expect(h.service.executeRemesa(1, 3)).resolves.toMatchObject({ remesaId: 1 });
        expect(h.queue.add).toHaveBeenCalledTimes(1);
    });

    it('C-6: si el usuario ya tiene otra en curso responde 409', async () => {
        const h = armarEjecutar({ otrasEnCurso: [55] });
        await expect(h.service.executeRemesa(1, 3)).rejects.toThrow(/Ya tenés una importación en curso/);
        expect(h.queue.add).not.toHaveBeenCalled();
        expect(h.tx.remesa.update).not.toHaveBeenCalled();
    });

    it('C-7 / F5: si queue.add rechaza la remesa vuelve a borrador (no FALLIDA) y responde 503; reintentar funciona', async () => {
        const h = armarEjecutar({ queueFalla: true });

        await expect(h.service.executeRemesa(1, 3)).rejects.toThrow(ServiceUnavailableException);

        const compensacion = h.prisma.remesa.update.mock.calls[0][0].data;
        expect(compensacion.estadoProceso).toBe('VALIDANDO');
        expect(compensacion.progreso.update).toMatchObject({ fase: 'BORRADOR', encoladaAt: null, jobId: null, rev: { increment: 1 } });
        expect(JSON.stringify(compensacion)).not.toContain('FALLIDA');
        expect(h.realtime.emitImportProgreso).not.toHaveBeenCalled();

        // Con el job ya encolado la segunda vez, el mismo borrador se puede confirmar de nuevo.
        h.queue.add.mockResolvedValue({ id: 'job-8' });
        await expect(h.service.executeRemesa(1, 3)).resolves.toMatchObject({ remesaId: 1 });
    });

    describe('H1: tope de tiempo con la cola', () => {
        beforeEach(() => { jest.useFakeTimers(); process.env.IMPORTS_QUEUE_TIMEOUT_MS = '10000'; });
        afterEach(() => { jest.useRealTimers(); delete process.env.IMPORTS_QUEUE_TIMEOUT_MS; });

        it('un add que no resuelve nunca da 503 y deja el borrador dentro del tope', async () => {
            const h = armarEjecutar();
            h.queue.add.mockReturnValue(new Promise(() => undefined));

            const promesa = h.service.executeRemesa(1, 3);
            const resultado = promesa.then(() => 'ok', (e) => e);
            await jest.advanceTimersByTimeAsync(9_999);
            expect(h.prisma.remesa.update).not.toHaveBeenCalled(); // todavía esperando
            await jest.advanceTimersByTimeAsync(2);

            const e = await resultado;
            expect(e).toBeInstanceOf(ServiceUnavailableException);
            expect(h.prisma.remesa.update.mock.calls[0][0].data.progreso.update).toMatchObject({ fase: 'BORRADOR', encoladaAt: null });
        });

        it('un add que resuelve DESPUÉS del tope no tiene efectos: no guarda jobId ni emite', async () => {
            const h = armarEjecutar();
            let resolver!: (v: unknown) => void;
            h.queue.add.mockReturnValue(new Promise((r) => { resolver = r; }));

            const resultado = h.service.executeRemesa(1, 3).then(() => 'ok', (e) => e);
            await jest.advanceTimersByTimeAsync(10_001);
            expect(await resultado).toBeInstanceOf(ServiceUnavailableException);
            const llamadas = h.prisma.remesa.update.mock.calls.length;

            resolver({ id: 'tardio' });
            await jest.advanceTimersByTimeAsync(1);

            expect(h.prisma.remesa.update.mock.calls.length).toBe(llamadas);
            expect(JSON.stringify(h.prisma.remesa.update.mock.calls)).not.toContain('tardio');
            expect(h.realtime.emitImportProgreso).not.toHaveBeenCalled();
        });

        it('un add que rechaza tarde no deja una promesa rechazada sin manejar', async () => {
            const h = armarEjecutar();
            let rechazar!: (e: Error) => void;
            h.queue.add.mockReturnValue(new Promise((_, rej) => { rechazar = rej; }));
            const sinManejar = jest.fn();
            process.on('unhandledRejection', sinManejar);

            const resultado = h.service.executeRemesa(1, 3).then(() => 'ok', (e) => e);
            await jest.advanceTimersByTimeAsync(10_001);
            await resultado;
            rechazar(new Error('redis volvió y falló'));
            await jest.advanceTimersByTimeAsync(10);
            await Promise.resolve();

            process.off('unhandledRejection', sinManejar);
            expect(sinManejar).not.toHaveBeenCalled();
        });

        it('el tope se configura con IMPORTS_QUEUE_TIMEOUT_MS', async () => {
            process.env.IMPORTS_QUEUE_TIMEOUT_MS = '500';
            const h = armarEjecutar();
            h.queue.add.mockReturnValue(new Promise(() => undefined));
            const resultado = h.service.executeRemesa(1, 3).then(() => 'ok', (e) => e);
            await jest.advanceTimersByTimeAsync(501);
            expect(await resultado).toBeInstanceOf(ServiceUnavailableException);
        });
    });

    it('F5: una remesa que estaba PENDIENTE (sin vista previa) vuelve a PENDIENTE', async () => {
        const h = armarEjecutar({ queueFalla: true, estadoProceso: 'PENDIENTE', totalFilas: 0 });
        await expect(h.service.executeRemesa(1, 3)).rejects.toThrow(ServiceUnavailableException);
        expect(h.prisma.remesa.update.mock.calls[0][0].data.estadoProceso).toBe('PENDIENTE');
    });

    it('la consulta de "otras en curso" mira la fila de progreso (encolada y sin terminar), no estadoProceso', async () => {
        const h = armarEjecutar();
        await h.service.executeRemesa(1, 3);
        const sql = h.sqls.find((q) => q.includes('JOIN remesa r') && !q.includes('LEFT JOIN'))!;
        expect(sql).toContain('p.encoladaAt IS NOT NULL');
        expect(sql).toContain('p.finishedAt IS NULL');
        expect(sql).not.toContain('estadoProceso');
        // Mira las del MISMO usuario que confirma, no las de otro.
        expect(sql).toContain('r.usuarioCreadorId = ?');
        const i = h.sqls.indexOf(sql);
        expect(h.valores[i]).toEqual([3]);
    });

    it('el bloqueo por usuario no se activa con las cargas en curso de OTRO usuario (la consulta ya filtra por el suyo)', async () => {
        const h = armarEjecutar();
        await h.service.executeRemesa(1, 9);
        const i = h.sqls.findIndex((q) => q.includes('JOIN remesa r') && !q.includes('LEFT JOIN'));
        expect(h.valores[i]).toEqual([9]);
        expect(h.valores[0]).toEqual([9]);
    });
});

/* ────────────────────────────────────────────────────────────────────────────
 * validateRemesa
 * ──────────────────────────────────────────────────────────────────────────── */

function armarValidar(remesa: Record<string, unknown>, plantilla: Record<string, unknown> = {}) {
    const prisma: any = {
        remesa: {
            findUnique: jest.fn().mockResolvedValue({
                id: 1, empresaId: 10, categoria: 'DEUDORES', estadoProceso: 'PENDIENTE', archivo: path.join(dir, 'x.csv'),
                hoja: null, filtroFilas: null, progreso: null,
                plantilla: {
                    separador: '|', tieneHeader: false, mappingJson: { columns: { a: { fromIndex: 0 } } }, ...plantilla,
                },
                ...remesa,
            }),
            update: jest.fn().mockResolvedValue({}),
        },
    };
    const service = new ImportService(
        prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    return { service, prisma };
}

describe('validateRemesa', () => {
    it('C-8: sobre una FINALIZADA y sobre una encolada responde 409 y no escribe', async () => {
        const fin = armarValidar({ estadoProceso: 'FINALIZADA' });
        await expect(fin.service.validateRemesa(1)).rejects.toThrow(ConflictException);
        await expect(fin.service.validateRemesa(1)).rejects.toThrow('Esta importación ya fue confirmada: no se puede volver a validar.');
        expect(fin.prisma.remesa.update).not.toHaveBeenCalled();

        const enCola = armarValidar({ estadoProceso: 'PENDIENTE', progreso: { encoladaAt: new Date() } });
        await expect(enCola.service.validateRemesa(1)).rejects.toThrow(ConflictException);
        expect(enCola.prisma.remesa.update).not.toHaveBeenCalled();

        const procesando = armarValidar({ estadoProceso: 'PROCESANDO' });
        await expect(procesando.service.validateRemesa(1)).rejects.toThrow(ConflictException);
    });

    it('una remesa sin estadoProceso en la fixture (borrador) sigue pudiendo validarse', async () => {
        // La guarda está escrita en negativo: lo que no es PROCESANDO/FINALIZADA/FALLIDA ni tiene encoladaAt pasa.
        const archivo = path.join(dir, 'borrador.csv');
        fs.writeFileSync(archivo, '1\n2\n3\n');
        const h = armarValidar({ estadoProceso: undefined, archivo });
        await expect(h.service.validateRemesa(1)).resolves.toMatchObject({ total: 3 });
    });

    it('C-9: MULTIRREGISTRO persiste VALIDANDO, totalFilas y totalEsperado (#10)', async () => {
        (parseMultirregistro as jest.Mock).mockReturnValue({
            filas: [
                { _tipo: 'CASO', nroCliente: '1', nombre: 'A', _blocks: [] },
                { _tipo: 'CASO', nroCliente: '2', nombre: 'B', _blocks: [] },
                { _tipo: 'BAJA', aviso: '9', motivo: 'x' },
            ],
            advertencias: [],
            resumen: { lineas: 3, porTipo: {}, casos: 2, facturas: 0, bajas: 1, ignoradas: 0 },
        });
        const archivo = path.join(dir, 'multi.txt');
        fs.writeFileSync(archivo, 'x');
        const h = armarValidar(
            { categoria: 'MULTIRREGISTRO', archivo },
            { mappingJson: { columns: {}, multirregistro: { tipoLinea: {} } } },
        );

        const res = await h.service.validateRemesa(1);

        expect(res.total).toBe(3);
        const data = h.prisma.remesa.update.mock.calls[0][0].data;
        expect(data).toMatchObject({ estadoProceso: 'VALIDANDO', totalFilas: 3, okFilas: 3, errFilas: 0 });
        expect(data.progreso.upsert).toEqual({
            create: { fase: 'BORRADOR', totalEsperado: 3 },
            update: { totalEsperado: 3 },
        });
    });

    it('la vista previa de una carga común también deja totalEsperado en la fila del borrador', async () => {
        const archivo = path.join(dir, 'comun.csv');
        fs.writeFileSync(archivo, '1\n2\n3\n4\n');
        const h = armarValidar({ archivo });
        await h.service.validateRemesa(1);
        const data = h.prisma.remesa.update.mock.calls[0][0].data;
        expect(data.progreso.upsert.update).toEqual({ totalEsperado: 4 });
        // Un borrador no se transmite: no incrementa rev.
        expect(JSON.stringify(data.progreso)).not.toContain('increment');
    });

    it('la vista previa de MULTICLAVES persiste el total de trámites en remesa y en la fila del borrador', async () => {
        const archivoPath = path.join(dir, 'multi-preview.csv');
        const contenido = [
            'NRO_TRAMITE|NRO_CONVENIO|SALDO_TRAMITE|IMPORTE_TOTAL_CLAVE|CLAVE_PAGO|FECHA_VENCIMIENTO|SEC_COD_BARRA|CODIGO_GESTOR|APELLIDO_NOMBRE_RAZON_SOCIAL',
            '1841012140|96311343|39760.03|39760.03|0096311343000039760032|20261027|49800039760032710202600000000000096311343000000009|1008|Ana Maya S.A.|C',
            '1841012140|96332206|39760.03|19880.01|0096332206000019880014|20261027|49800019880012710202600000000000096332206000000007|1008|Ana Maya S.A.|C',
            '2577727090|96259966|272350.9|272350.9|0096259966000272350908|20261027|49800272350902710202600000000000096259966000000007|1008|Ana Maya S.A.|C',
        ].join('\n');
        fs.writeFileSync(archivoPath, Buffer.from(contenido, 'latin1'));
        const prisma: any = {
            remesa: {
                findUnique: jest.fn().mockResolvedValue({
                    id: 42, empresaId: 1, categoria: 'MULTICLAVES', archivo: archivoPath, archivos: null,
                    plantilla: { mappingJson: { entity: 'MIXTO', matchKeys: [], columns: {}, multiclaves: { codigosGestor: ['1008'] } }, separador: '|', tieneHeader: true },
                }),
                update: jest.fn().mockResolvedValue({}),
            },
            deudor: { findMany: jest.fn().mockResolvedValue([]) },
            clave_pago: { findMany: jest.fn().mockResolvedValue([]) },
            empresa: { findMany: jest.fn().mockResolvedValue([]) },
        };
        const service = new ImportService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);

        const r = await service.validateRemesa(42);

        expect(r.total).toBe(2);
        const data = prisma.remesa.update.mock.calls[0][0].data;
        expect(data).toMatchObject({ estadoProceso: 'VALIDANDO', totalFilas: 2, okFilas: 2, errFilas: 0 });
        expect(data.progreso.upsert).toEqual({ create: { fase: 'BORRADOR', totalEsperado: 2 }, update: { totalEsperado: 2 } });
    });

    it('C-10: con remesa.hoja = "Hoja2" el total es el de la Hoja2 (#19)', async () => {
        const wb = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet([['a'], ['b']]), 'Hoja1');
        xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet([['1'], ['2'], ['3'], ['4'], ['5']]), 'Hoja2');
        const archivo = path.join(dir, 'dos-hojas.xlsx');
        xlsx.writeFile(wb, archivo);

        const conHoja = armarValidar({ archivo, hoja: 'Hoja2' });
        await expect(conHoja.service.validateRemesa(1)).resolves.toMatchObject({ total: 5 });

        // Sin `hoja` en la remesa, lee la primera (como siempre).
        const sinHoja = armarValidar({ archivo, hoja: null });
        await expect(sinHoja.service.validateRemesa(1)).resolves.toMatchObject({ total: 2 });
        // Y un `hoja` explícito (query) manda sobre el de la remesa.
        await expect(conHoja.service.validateRemesa(1, 50, 'Hoja1')).resolves.toMatchObject({ total: 2 });
    });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Lecturas: en-curso, progreso, status
 * ──────────────────────────────────────────────────────────────────────────── */

function armarLecturas(opts: { remesas?: any[]; remesa?: any | null } = {}) {
    const prisma: any = {
        remesa: {
            findMany: jest.fn().mockResolvedValue(opts.remesas ?? []),
            findUnique: jest.fn().mockResolvedValue(opts.remesa === undefined ? null : opts.remesa),
        },
    };
    const service = new ImportService(
        prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    return { service, prisma };
}

describe('lecturas del estado de la carga', () => {
    it('C-11: listarEnCurso filtra por la fila de progreso (no por estadoProceso) y devuelve el porcentaje real', async () => {
        const remesa = {
            ...REMESA, estadoProceso: 'PROCESANDO',
            progreso: {
                ...FILA, fase: 'PROCESANDO', porcentaje: 50, totalEsperado: 1000, procesadas: 500, ok: 500,
                encoladaAt: new Date('2026-10-05T14:00:00Z'), startedAt: new Date('2026-10-05T14:00:01Z'),
            },
        };
        const h = armarLecturas({ remesas: [remesa] });

        const conPermiso = await h.service.listarEnCurso({ sub: 3, permisos: ['importacion.ver_progreso_otros'] });

        const where = h.prisma.remesa.findMany.mock.calls[0][0].where;
        expect(where).toEqual({ progreso: { is: { encoladaAt: { not: null }, finishedAt: null } } });
        expect(JSON.stringify(where)).not.toContain('estadoProceso');
        expect(conPermiso).toHaveLength(1);
        expect(conPermiso[0]).toMatchObject({ remesaId: 1, progreso: 50, enCurso: true, fase: 'PROCESANDO' });

        await h.service.listarEnCurso({ sub: 3, permisos: [] });
        const whereSin = h.prisma.remesa.findMany.mock.calls[1][0].where;
        expect(whereSin).toMatchObject({ usuarioCreadorId: 3, progreso: { is: { encoladaAt: { not: null }, finishedAt: null } } });
        expect(h.prisma.remesa.findMany.mock.calls[0][0].orderBy).toEqual({ progreso: { encoladaAt: 'asc' } });
    });

    it('C-12: progreso(id) responde 404 si no existe y sintetiza una remesa heredada sin fila', async () => {
        await expect(armarLecturas({ remesa: null }).service.progreso(999)).rejects.toThrow(NotFoundException);

        const heredada = armarLecturas({ remesa: { ...REMESA, estadoProceso: 'VALIDANDO', totalFilas: 912, okFilas: 912, progreso: null } });
        const e = await heredada.service.progreso(98);
        expect(e).toMatchObject({ rev: 0, enCurso: false, progreso: 0, fase: 'BORRADOR', ok: 0, resultado: null });
    });

    it('C-13: status(id) trae carga, duracionMs sale de la fila y jobimport es null', async () => {
        const remesa = {
            ...REMESA, estadoProceso: 'FINALIZADA', empresa: { id: 10, nombre: 'E' }, plantilla: null, politica: null,
            createdAt: new Date(), updatedAt: new Date(), fechaVencimiento: null,
            usuarioCreador: { id: 3, nombre: 'Maxi', email: 'm@x.com' },
            progreso: {
                ...FILA, fase: 'TERMINADA', resultado: 'OK', porcentaje: 100, procesadas: 900, ok: 900, totalEsperado: 900,
                encoladaAt: new Date('2026-10-05T14:00:00Z'), startedAt: new Date('2026-10-05T14:00:01Z'),
                finishedAt: new Date('2026-10-05T14:00:04Z'),
            },
        };
        const h = armarLecturas({ remesa });

        const r = await h.service.status(1);

        expect(r.jobimport).toBeNull();
        expect(r.carga).toMatchObject({ resultado: 'OK', duracionMs: 3000, terminal: true, progreso: 100 });
        expect(r.duracionMs).toBe(3000);
        expect(h.prisma.remesa.findUnique.mock.calls[0][0].include).not.toHaveProperty('jobimport');
        expect(h.prisma.remesa.findUnique.mock.calls[0][0].include.progreso).toBe(true);
    });
});

/* ────────────────────────────────────────────────────────────────────────────
 * deleteRemesa
 * ──────────────────────────────────────────────────────────────────────────── */

describe('deleteRemesa', () => {
    const user = { sub: 3, permisos: ['importacion.eliminar'] };

    function armarBorrado(remesa: Record<string, unknown>, notificacionFalla = false) {
        const tx: any = {
            contacto: { deleteMany: jest.fn() }, campoextra: { deleteMany: jest.fn() }, factura: { deleteMany: jest.fn() },
            deudor: { deleteMany: jest.fn() }, jobimport: { deleteMany: jest.fn() }, importerror: { deleteMany: jest.fn() },
            remesa: { delete: jest.fn() },
        };
        const prisma: any = {
            remesa: { findUnique: jest.fn().mockResolvedValue({ id: 1, categoria: 'DEUDORES', estadoProceso: 'VALIDANDO', usuarioCreadorId: 3, ...remesa }) },
            deudor: { findMany: jest.fn().mockResolvedValue([]) },
            notificacion: { findMany: jest.fn().mockResolvedValue([{ usuarioId: 3 }, { usuarioId: 4 }]), deleteMany: notificacionFalla ? jest.fn().mockRejectedValue(new Error('lock')) : jest.fn().mockResolvedValue({ count: 2 }) },
            $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
        };
        const notificaciones: any = { contador: jest.fn().mockResolvedValue({ noLeidas: 1 }) };
        const realtime: any = { emitToUser: jest.fn() };
        const service = new ImportService(
            prisma, {} as any, {} as any, realtime, notificaciones, {} as any, {} as any, {} as any, {} as any,
        );
        return { service, prisma, tx, realtime, notificaciones };
    }

    const enCola = (extra: Record<string, unknown> = {}) => ({
        estadoProceso: 'PENDIENTE',
        progreso: { encoladaAt: new Date(), startedAt: null, finishedAt: null, jobId: 'job-7', ...extra },
    });
    const conCola = (h: ReturnType<typeof armarBorrado>, job: any) => {
        h.service['importQueue'] = { getJob: jest.fn().mockResolvedValue(job) } as any;
        return (h.service['importQueue'] as any).getJob as jest.Mock;
    };

    it('C-14: una carga que ya arrancó y no terminó no se puede borrar (400); un borrador sí y limpia sus notificaciones', async () => {
        const arrancada = armarBorrado(enCola({ startedAt: new Date() }));
        const getJob = conCola(arrancada, null);
        await expect(arrancada.service.deleteRemesa(1, user)).rejects.toThrow('No se puede eliminar una importación en curso');
        expect(arrancada.tx.remesa.delete).not.toHaveBeenCalled();
        expect(arrancada.prisma.notificacion.deleteMany).not.toHaveBeenCalled();
        expect(getJob).not.toHaveBeenCalled();

        const borrador = armarBorrado({ progreso: { encoladaAt: null, finishedAt: null } });
        await expect(borrador.service.deleteRemesa(1, user)).resolves.toMatchObject({ deleted: true });
        expect(borrador.tx.remesa.delete).toHaveBeenCalledTimes(1);
        expect(borrador.prisma.notificacion.deleteMany).toHaveBeenCalledWith({ where: { entidadTipo: 'REMESA', entidadId: 1 } });
        // Re-emite el contador de no leídas de los usuarios afectados.
        expect(borrador.realtime.emitToUser).toHaveBeenCalledWith(3, 'notificacion:contador', { noLeidas: 1 });
        expect(borrador.realtime.emitToUser).toHaveBeenCalledWith(4, 'notificacion:contador', { noLeidas: 1 });
        // Va DESPUÉS de la transacción confirmada, no adentro.
        expect(borrador.prisma.$transaction.mock.invocationCallOrder[0])
            .toBeLessThan(borrador.prisma.notificacion.deleteMany.mock.invocationCallOrder[0]);
    });

    it('F1a: una carga en cola que no arrancó y cuyo job no existe se puede borrar', async () => {
        const h = armarBorrado(enCola());
        const getJob = conCola(h, null);
        await expect(h.service.deleteRemesa(1, user)).resolves.toMatchObject({ deleted: true });
        expect(getJob).toHaveBeenCalledWith('job-7');
    });

    it('F1a: si el job está esperando se lo saca de la cola y se borra', async () => {
        const h = armarBorrado(enCola());
        const job = { getState: jest.fn().mockResolvedValue('waiting'), remove: jest.fn().mockResolvedValue(undefined) };
        conCola(h, job);
        await expect(h.service.deleteRemesa(1, user)).resolves.toMatchObject({ deleted: true });
        expect(job.remove).toHaveBeenCalledTimes(1);
        expect(job.remove.mock.invocationCallOrder[0]).toBeLessThan(h.tx.remesa.delete.mock.invocationCallOrder[0]);
    });

    it('F1a: si el job está activo, o no se lo pudo sacar, responde 400 y no borra', async () => {
        const activo = armarBorrado(enCola());
        conCola(activo, { getState: jest.fn().mockResolvedValue('active'), remove: jest.fn() });
        await expect(activo.service.deleteRemesa(1, user)).rejects.toThrow(BadRequestException);
        expect(activo.tx.remesa.delete).not.toHaveBeenCalled();

        const noSaca = armarBorrado(enCola());
        conCola(noSaca, { getState: jest.fn().mockResolvedValue('waiting'), remove: jest.fn().mockRejectedValue(new Error('locked')) });
        await expect(noSaca.service.deleteRemesa(1, user)).rejects.toThrow(BadRequestException);
        expect(noSaca.tx.remesa.delete).not.toHaveBeenCalled();
    });

    it('G2: un usuario que no es dueño ni tiene ver_progreso_otros recibe 403 SIN tocar la cola', async () => {
        const h = armarBorrado({ ...enCola(), usuarioCreadorId: 3 });
        const job = { getState: jest.fn().mockResolvedValue('waiting'), remove: jest.fn() };
        const getJob = conCola(h, job);

        await expect(h.service.deleteRemesa(1, { sub: 9, permisos: ['importacion.eliminar'] })).rejects.toThrow(ForbiddenException);

        expect(getJob).not.toHaveBeenCalled();
        expect(job.remove).not.toHaveBeenCalled();
        expect(h.tx.remesa.delete).not.toHaveBeenCalled();
    });

    it('G3: sin jobId guardado busca el job por data.remesaId entre los de la cola', async () => {
        const activo = armarBorrado(enCola({ jobId: null }));
        (activo.service as any).importQueue = {
            getJobs: jest.fn().mockResolvedValue([
                { id: 'otro', data: { remesaId: 2 }, getState: jest.fn() },
                { id: 'x', data: { remesaId: 1 }, getState: jest.fn().mockResolvedValue('active'), remove: jest.fn() },
            ]),
        };
        await expect(activo.service.deleteRemesa(1, user)).rejects.toThrow(BadRequestException);
        expect(activo.tx.remesa.delete).not.toHaveBeenCalled();

        const waiting = { id: 'x', data: { remesaId: 1 }, getState: jest.fn().mockResolvedValue('delayed'), remove: jest.fn().mockResolvedValue(undefined) };
        const esperando = armarBorrado(enCola({ jobId: null }));
        (esperando.service as any).importQueue = { getJobs: jest.fn().mockResolvedValue([waiting]) };
        await expect(esperando.service.deleteRemesa(1, user)).resolves.toMatchObject({ deleted: true });
        expect(waiting.remove).toHaveBeenCalledTimes(1);

        const ninguno = armarBorrado(enCola({ jobId: null }));
        (ninguno.service as any).importQueue = { getJobs: jest.fn().mockResolvedValue([{ id: 'o', data: { remesaId: 2 } }]) };
        await expect(ninguno.service.deleteRemesa(1, user)).resolves.toMatchObject({ deleted: true });
    });

    it('G3: si el worker tomó la carga entre la lectura y la transacción, el borrado se aborta con 400', async () => {
        // La lectura inicial es vieja (borrador); dentro de la transacción ya figura PROCESANDO con startedAt.
        const h = armarBorrado({ progreso: { encoladaAt: null, startedAt: null, finishedAt: null, jobId: null } });
        h.tx.$queryRaw = jest.fn().mockResolvedValue([{ estadoProceso: 'PROCESANDO', startedAt: new Date(), finishedAt: null }]);

        await expect(h.service.deleteRemesa(1, user)).rejects.toThrow('No se puede eliminar una importación en curso');

        expect(h.tx.remesa.delete).not.toHaveBeenCalled();
        const sql = (h.tx.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join('?');
        expect(sql).toContain('FOR UPDATE');
        expect(h.prisma.notificacion.deleteMany).not.toHaveBeenCalled();
    });

    it('G3: la relectura dentro de la transacción deja borrar una carga terminada (tiene startedAt pero también finishedAt)', async () => {
        const h = armarBorrado({ estadoProceso: 'FINALIZADA', progreso: { encoladaAt: new Date(), startedAt: new Date(), finishedAt: new Date(), jobId: 'j' } });
        h.tx.$queryRaw = jest.fn().mockResolvedValue([{ estadoProceso: 'FINALIZADA', startedAt: new Date(), finishedAt: new Date() }]);
        await expect(h.service.deleteRemesa(1, user)).resolves.toMatchObject({ deleted: true });
    });

    it('H1: una consulta a la cola que no responde da 400 dentro del tope, sin borrar', async () => {
        jest.useFakeTimers();
        try {
            process.env.IMPORTS_QUEUE_TIMEOUT_MS = '10000';
            for (const cola of [
                { getJob: jest.fn().mockReturnValue(new Promise(() => undefined)) },
                { getJob: jest.fn().mockResolvedValue({ id: 'j', getState: jest.fn().mockReturnValue(new Promise(() => undefined)) }) },
                { getJob: jest.fn().mockResolvedValue({ id: 'j', getState: jest.fn().mockResolvedValue('waiting'), remove: jest.fn().mockReturnValue(new Promise(() => undefined)) }) },
            ]) {
                const h = armarBorrado(enCola());
                (h.service as any).importQueue = cola;
                const resultado = h.service.deleteRemesa(1, user).then(() => 'ok', (e) => e);
                await jest.advanceTimersByTimeAsync(10_001);
                expect(await resultado).toBeInstanceOf(BadRequestException);
                expect(h.tx.remesa.delete).not.toHaveBeenCalled();
            }
            const sinId = armarBorrado(enCola({ jobId: null }));
            (sinId.service as any).importQueue = { getJobs: jest.fn().mockReturnValue(new Promise(() => undefined)) };
            const r = sinId.service.deleteRemesa(1, user).then(() => 'ok', (e) => e);
            await jest.advanceTimersByTimeAsync(10_001);
            expect(await r).toBeInstanceOf(BadRequestException);
        } finally {
            jest.useRealTimers();
            delete process.env.IMPORTS_QUEUE_TIMEOUT_MS;
        }
    });

    it('H5: getJobs se consulta incluyendo el estado active', async () => {
        const h = armarBorrado(enCola({ jobId: null }));
        const getJobs = jest.fn().mockResolvedValue([]);
        (h.service as any).importQueue = { getJobs };
        await h.service.deleteRemesa(1, user);
        expect(getJobs.mock.calls[0][0]).toEqual(expect.arrayContaining(['active', 'waiting']));
    });

    it('H5: verificarNoArrancada frena también a una carga con startedAt sin finishedAt aunque su estado no sea PROCESANDO', async () => {
        const h = armarBorrado({ progreso: { encoladaAt: null, startedAt: null, finishedAt: null, jobId: null } });
        h.tx.$queryRaw = jest.fn().mockResolvedValue([{ estadoProceso: 'PENDIENTE', startedAt: new Date(), finishedAt: null }]);
        await expect(h.service.deleteRemesa(1, user)).rejects.toThrow('No se puede eliminar una importación en curso');
        expect(h.tx.remesa.delete).not.toHaveBeenCalled();
    });

    it('H5: el borrado de MULTICLAVES también relee la remesa dentro de la transacción y aborta si el worker la tomó', async () => {
        const h = armarBorrado({ categoria: 'MULTICLAVES', progreso: { encoladaAt: null, startedAt: null, finishedAt: null, jobId: null } });
        h.prisma.convenio = { count: jest.fn().mockResolvedValue(0) };
        h.tx.$queryRaw = jest.fn().mockResolvedValue([{ estadoProceso: 'PROCESANDO', startedAt: new Date(), finishedAt: null }]);

        await expect(h.service.deleteRemesa(1, user)).rejects.toThrow('No se puede eliminar una importación en curso');

        expect(h.tx.$queryRaw).toHaveBeenCalledTimes(1);
        expect(h.tx.remesa.delete).not.toHaveBeenCalled();
    });

    it('F1a: si no se puede consultar la cola, 400; y una cola sin getJob (mocks viejos) o sin jobId no bloquea', async () => {
        const caida = armarBorrado(enCola());
        (caida.service as any).importQueue = { getJob: jest.fn().mockRejectedValue(new Error('redis')) };
        await expect(caida.service.deleteRemesa(1, user)).rejects.toThrow(BadRequestException);

        const sinGetJob = armarBorrado(enCola());
        await expect(sinGetJob.service.deleteRemesa(1, user)).resolves.toMatchObject({ deleted: true });

        const sinId = armarBorrado(enCola({ jobId: null }));
        await expect(sinId.service.deleteRemesa(1, user)).resolves.toMatchObject({ deleted: true });
    });

    it('una carga terminada (con fila) sí se puede borrar', async () => {
        const h = armarBorrado({
            estadoProceso: 'FINALIZADA', progreso: { encoladaAt: new Date(), finishedAt: new Date() },
        });
        await expect(h.service.deleteRemesa(1, user)).resolves.toMatchObject({ deleted: true });
    });

    it('si la limpieza de notificaciones falla, la remesa igual se borró y la llamada no falla', async () => {
        const h = armarBorrado({}, true);
        await expect(h.service.deleteRemesa(1, user)).resolves.toMatchObject({ deleted: true });
        expect(h.tx.remesa.delete).toHaveBeenCalledTimes(1);
    });

    it('una carga PROCESANDO heredada, sin fila, sigue bloqueada', async () => {
        const h = armarBorrado({ estadoProceso: 'PROCESANDO', progreso: null });
        await expect(h.service.deleteRemesa(1, user)).rejects.toThrow(BadRequestException);
        // Y una PROCESANDO con fila que ya arrancó tampoco.
        const h2 = armarBorrado({ estadoProceso: 'PROCESANDO', progreso: { encoladaAt: new Date(), startedAt: new Date(), finishedAt: null, jobId: 'j' } });
        await expect(h2.service.deleteRemesa(1, user)).rejects.toThrow(BadRequestException);
    });
});

/* ────────────────────────────────────────────────────────────────────────────
 * createRemesa y crearRemesaConNumeroSeguro
 * ──────────────────────────────────────────────────────────────────────────── */

function armarAlta() {
    const create = jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 99, ...data }));
    const prisma: any = {
        plantillaimport: { findUnique: jest.fn().mockResolvedValue({ id: 7, mappingJson: { columns: {} }, tieneHeader: true }) },
        remesa: { findMany: jest.fn().mockResolvedValue([{ numeroRemesa: '00608' }]), create },
    };
    const files: any = { saveBuffer: jest.fn().mockResolvedValue({ path: '/uploads/a.csv', hash: 'h' }) };
    const service = new ImportService(
        prisma, files, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    return { service, create };
}

const p2002 = (meta?: Record<string, unknown>) =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test', meta });

describe('createRemesa', () => {
    it('C-15: el create lleva la fila de progreso en BORRADOR y el usuario creador', async () => {
        const { service, create } = armarAlta();

        await service.createRemesa(
            { empresaId: 5, nombre: 'Carga', categoria: 'DEUDORES', plantillaId: 7 } as any,
            [{ originalname: 'a.csv', buffer: Buffer.from('1\n') }],
            3,
        );

        expect(create).toHaveBeenCalledTimes(1);
        const data = create.mock.calls[0][0].data;
        expect(data.progreso).toEqual({ create: { fase: 'BORRADOR' } });
        expect(data.usuarioCreadorId).toBe(3);
    });
});

describe('crearRemesaConNumeroSeguro', () => {
    function armarMulticlaves(errores: unknown[]) {
        const create = jest.fn();
        for (const e of errores) create.mockRejectedValueOnce(e);
        create.mockImplementation(({ data }: any) => Promise.resolve({ id: 99, ...data }));
        const prisma: any = {
            plantillaimport: { findUnique: jest.fn().mockResolvedValue({ id: 7, mappingJson: { columns: {}, multiclaves: {} }, tieneHeader: true }) },
            remesa: { findMany: jest.fn().mockResolvedValue([]), create },
        };
        const files: any = { saveBuffer: jest.fn().mockResolvedValue({ path: '/uploads/a.csv', hash: 'h' }) };
        const service = new ImportService(
            prisma, files, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
        );
        const alta = () => service.createRemesa(
            { empresaId: 5, nombre: 'Claves', categoria: 'MULTICLAVES', plantillaId: 7 } as any,
            [{ originalname: 'a.csv', buffer: Buffer.from('1\n') }],
            3,
        );
        return { create, alta };
    }

    it('C-16: un P2002 sin meta reintenta con sufijo', async () => {
        const h = armarMulticlaves([p2002()]);
        await h.alta();
        expect(h.create).toHaveBeenCalledTimes(2);
        expect(h.create.mock.calls[1][0].data.numeroRemesa).toMatch(/-2$/);
    });

    it('C-16: un P2002 con meta.target del número reintenta con sufijo', async () => {
        const h = armarMulticlaves([p2002({ modelName: 'remesa', target: 'Remesa_empresaId_numeroRemesa_key' })]);
        await h.alta();
        expect(h.create).toHaveBeenCalledTimes(2);
    });

    it('C-16: un P2002 con meta.target de otra clave (la PK de una fila de progreso huérfana) se relanza sin reintentar', async () => {
        const huerfana = p2002({ modelName: 'remesa', target: 'PRIMARY' });
        const h = armarMulticlaves([huerfana]);
        await expect(h.alta()).rejects.toBe(huerfana);
        expect(h.create).toHaveBeenCalledTimes(1);
    });
});
