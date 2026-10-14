/**
 * AccionesProcessor — `saltearCanceladas` (spec §10.7).
 *
 * Antes de la fase 4a de multiclaves, `saltearCanceladas` comparaba contra la clave `SIT-050`
 * pelada. Desde la fase 4a resuelve por la categoría CANCELADO completa (SIT-050 a SIT-053, y desde
 * esta misma fase también SIT-054 "Cancelado con quita") vía `idsSituacionCancelada`.
 *
 * Hallazgo de la auditoría (importante #7): la ampliación no es solo "sumar SIT-054" — también
 * cambia el comportamiento para SIT-051/052/053, que antes NO se salteaban. Este archivo no
 * existía antes de la fase 4a (`AccionesProcessor` no tenía cobertura unitaria dedicada).
 */
import { AccionesProcessor } from './acciones.processor';
import { ProcessContext } from './processor.interface';
import { _resetCacheSituacionesCerradas } from '../utils/situaciones-cerradas';

beforeEach(() => {
    _resetCacheSituacionesCerradas();
});

/** Prisma mockeado con una lista de deudores fija, más el catálogo de categoría CANCELADO. */
function makeCtx(deudores: Array<{ id: number; estadoSituacionId: number | null; nombre?: string }>) {
    const deudorUpdate = jest.fn().mockResolvedValue({});
    const parametroFindMany = jest.fn().mockImplementation(({ where }: any) => {
        if (where?.categoria === 'CANCELADO') {
            return Promise.resolve([50, 51, 52, 53, 54].map((id) => ({ id, clave: `SIT-0${id}` })));
        }
        return Promise.resolve([]);
    });

    const prisma: any = {
        deudor: {
            findMany: jest.fn().mockResolvedValue(
                deudores.map((d) => ({
                    id: d.id, estadoSituacionId: d.estadoSituacionId, estadoGestionId: null, motivoNoPagoId: null,
                    nombre: d.nombre ?? 'X', apellido: '', montoTotal: 100, fechaVencimiento: null, nroCliente: String(d.id),
                    camposAdicionales: null,
                })),
            ),
            update: deudorUpdate,
        },
        parametro: { findMany: parametroFindMany },
        remesa: { update: jest.fn().mockResolvedValue({}) },
        accion_masiva_snapshot: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    // La transacción interactiva: el callback recibe el mismo falso como `tx`.
    prisma.$transaction = jest.fn().mockImplementation((fn: any) => fn(prisma));

    const ctx = {
        prisma,
        remesaId: 1,
        empresaId: 10,
        usuarioId: 1,
        auditoria: { log: jest.fn().mockResolvedValue(undefined) },
        accionesConfig: {
            matchMode: 'DEUDOR',
            matchColumn: { field: 'id', fromIndex: 0 },
            saltearCanceladas: true,
            operaciones: [{ tipo: 'SET_CAMPO', campo: 'nombre', modo: 'ESTATICO', valor: 'TOCADO' }],
        },
    } as unknown as ProcessContext;

    return { ctx, prisma, deudorUpdate };
}

const fila = (id: number) => ({ _raw: [String(id)] } as any);

describe('AccionesProcessor — saltearCanceladas resuelve por categoría CANCELADO', () => {
    it.each([
        ['SIT-050 (Cancelado / Pagado)', 50],
        ['SIT-051 (Cancelado antes de la gestión)', 51],
        ['SIT-052 (Cancelado a liquidar)', 52],
        ['SIT-053 (Cancelado a monto histórico)', 53],
        ['SIT-054 (Cancelado con quita, multiclaves)', 54],
    ])('saltea un caso en %s', async (_nombre, sitId) => {
        const { ctx, deudorUpdate } = makeCtx([{ id: 1, estadoSituacionId: sitId }]);

        const proc = new AccionesProcessor();
        await proc.processRow(fila(1), ctx);
        await proc.afterAll(ctx);

        expect(deudorUpdate).not.toHaveBeenCalled();
    });

    it('NO saltea un caso en una situación viva (no CANCELADO)', async () => {
        const { ctx, deudorUpdate } = makeCtx([{ id: 2, estadoSituacionId: 41 /* SIT-041, Pago parcial */ }]);
        const proc = new AccionesProcessor();

        await proc.processRow(fila(2), ctx);
        await proc.afterAll(ctx);

        expect(deudorUpdate).toHaveBeenCalledWith({ where: { id: 2 }, data: { nombre: 'TOCADO' } });
    });

    it('un lote mixto: toca solo al vivo, saltea el cancelado con quita', async () => {
        const { ctx, deudorUpdate, prisma } = makeCtx([]);
        prisma.deudor.findMany
            .mockResolvedValueOnce([
                { id: 1, estadoSituacionId: 54, estadoGestionId: null, motivoNoPagoId: null, nombre: 'A', apellido: '', montoTotal: 100, fechaVencimiento: null, nroCliente: '1', camposAdicionales: null },
            ])
            .mockResolvedValueOnce([
                { id: 2, estadoSituacionId: 41, estadoGestionId: null, motivoNoPagoId: null, nombre: 'B', apellido: '', montoTotal: 100, fechaVencimiento: null, nroCliente: '2', camposAdicionales: null },
            ]);

        const proc = new AccionesProcessor();
        await proc.processRow(fila(1), ctx);
        await proc.processRow(fila(2), ctx);
        await proc.afterAll(ctx);

        expect(deudorUpdate).toHaveBeenCalledTimes(1);
        expect(deudorUpdate).toHaveBeenCalledWith({ where: { id: 2 }, data: { nombre: 'TOCADO' } });
    });

    it('modo degradado: sin ningún código CANCELADO seedeado, no saltea a nadie (muestra de más, no de menos)', async () => {
        const { ctx, deudorUpdate, prisma } = makeCtx([{ id: 1, estadoSituacionId: 50 }]);
        prisma.parametro.findMany.mockResolvedValue([]);

        const proc = new AccionesProcessor();
        await proc.processRow(fila(1), ctx);
        await proc.afterAll(ctx);

        expect(deudorUpdate).toHaveBeenCalledWith({ where: { id: 1 }, data: { nombre: 'TOCADO' } });
    });

    it('con saltearCanceladas apagado, toca a todos sin importar la situación', async () => {
        const { ctx, deudorUpdate } = makeCtx([{ id: 1, estadoSituacionId: 54 }]);
        (ctx.accionesConfig as any).saltearCanceladas = false;

        const proc = new AccionesProcessor();
        await proc.processRow(fila(1), ctx);
        await proc.afterAll(ctx);

        expect(deudorUpdate).toHaveBeenCalledWith({ where: { id: 1 }, data: { nombre: 'TOCADO' } });
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// C3b — cada caso se escribe con sus snapshots en UNA transacción (spec C3 §17.5.1)
// ─────────────────────────────────────────────────────────────────────────────────────────────

const deudorFila = (id: number, sit = 41) => ({
    id, estadoSituacionId: sit, estadoGestionId: null, motivoNoPagoId: null, nombre: 'X', apellido: '', montoTotal: 100,
    fechaVencimiento: null, nroCliente: String(id), camposAdicionales: null,
});

/**
 * Un prisma ESTRICTO: las escrituras viven solo en `tx`. Si el processor escribe con `ctx.prisma` en vez de con el
 * cliente de la transacción, la prueba falla. Registra el orden de las llamadas (`log`) y qué transacciones se
 * confirmaron y cuáles hicieron rollback.
 */
function makeCtxC3b(opts: {
    operaciones: any[];
    deudoresPorId?: Record<number, any[]>;
    contactosPorDeudor?: Record<number, any[]>;
    falla?: (llamada: string, id?: number) => Error | undefined;
    matchMode?: 'DEUDOR' | 'CONTACTO';
}) {
    const log: string[] = [];
    const confirmadas: string[][] = [];
    const snapshotsGuardados: any[] = [];
    let siguienteComentario = 500;
    let txNro = 0;

    const noEscribe = (nombre: string) => jest.fn().mockImplementation(() => {
        throw new Error(`escritura fuera de la transacción: ${nombre}`);
    });

    const crearTx = (propias: string[]) => ({
        comentario: {
            create: jest.fn().mockImplementation(async ({ data }: any) => {
                propias.push(`comentario.create(${data.deudorId})`);
                const e = opts.falla?.('comentario.create', data.deudorId);
                if (e) throw e;
                return { id: ++siguienteComentario };
            }),
        },
        contacto: {
            findMany: jest.fn().mockImplementation(async ({ where }: any) => opts.contactosPorDeudor?.[where.deudorId] ?? []),
            deleteMany: jest.fn().mockImplementation(async ({ where }: any) => {
                propias.push(`contacto.deleteMany(${where.id.in.join(',')})`);
                return { count: where.id.in.length };
            }),
        },
        deudor: {
            update: jest.fn().mockImplementation(async ({ where }: any) => {
                propias.push(`deudor.update(${where.id})`);
                const e = opts.falla?.('deudor.update', where.id);
                if (e) throw e;
                return {};
            }),
        },
        parametro: { findUnique: jest.fn().mockResolvedValue({ id: 99 }) },
        accion_masiva_snapshot: {
            createMany: jest.fn().mockImplementation(async ({ data }: any) => {
                propias.push(`snapshots.createMany(${data.length})`);
                const e = opts.falla?.('snapshots.createMany');
                if (e) throw e;
                snapshotsGuardados.push(...data);
                return { count: data.length };
            }),
        },
    });

    const prisma: any = {
        deudor: {
            findMany: jest.fn().mockImplementation(async ({ where }: any) => opts.deudoresPorId?.[Number(where?.id ?? where?.nroCliente)] ?? []),
            update: noEscribe('deudor.update'),
        },
        comentario: { create: noEscribe('comentario.create') },
        contacto: { findMany: noEscribe('contacto.findMany'), deleteMany: noEscribe('contacto.deleteMany') },
        accion_masiva_snapshot: { createMany: noEscribe('accion_masiva_snapshot.createMany') },
        parametro: { findMany: jest.fn().mockResolvedValue([]) },
        remesa: {
            update: jest.fn().mockImplementation(async () => { log.push('remesa.update'); return {}; }),
        },
        $transaction: jest.fn().mockImplementation(async (fn: any, options: any) => {
            const propias: string[] = [];
            log.push(`tx${++txNro}:begin timeout=${options?.timeout}`);
            try {
                const r = await fn(crearTx(propias));
                confirmadas.push(propias);
                log.push(`tx${txNro}:commit`);
                return r;
            } catch (e) {
                log.push(`tx${txNro}:rollback`);
                throw e;
            }
        }),
    };

    const ctx = {
        prisma,
        remesaId: 7,
        empresaId: 10,
        usuarioId: 3,
        auditoria: { log: jest.fn().mockResolvedValue(undefined) },
        progreso: { resumen: jest.fn(), subfase: jest.fn() },
        accionesConfig: {
            matchMode: opts.matchMode ?? 'DEUDOR',
            matchColumn: { field: 'id', fromIndex: 0 },
            contactoValor: { fromIndex: 0, tipo: 'telefono' },
            saltearCanceladas: false,
            operaciones: opts.operaciones,
        },
    } as unknown as ProcessContext;

    return { ctx, prisma, log, confirmadas, snapshotsGuardados };
}

const OPS_COMPLETAS = [
    { tipo: 'ADD_COMENTARIO', modo: 'ESTATICO', valor: 'Gestión masiva' },
    { tipo: 'DELETE_CONTACTO', modo: 'COLUMNA', fromIndex: 1, contactoTipo: 'telefono' },
    { tipo: 'SET_CAMPO', campo: 'nombre', modo: 'ESTATICO', valor: 'TOCADO' },
];
const contactoDe = (id: number, deudorId: number, valor = '1155550000') => ({
    id, deudorId, tipo: 'telefono', valor, subtipo: null, prioridad: 1, validado: false, whatsapp: false,
});
const fila2 = (id: number, tel = '1155550000') => ({ _raw: [String(id), tel] } as any);

describe('AccionesProcessor — C3b: cada caso con sus snapshots en una transacción', () => {
    it('un caso escribe comentario, contactos, update y UN createMany con los 3 snapshots dentro de la misma transacción, con deudorId', async () => {
        const e = makeCtxC3b({
            operaciones: OPS_COMPLETAS,
            deudoresPorId: { 1: [deudorFila(1)] },
            contactosPorDeudor: { 1: [contactoDe(80, 1)] },
        });
        const proc = new AccionesProcessor();

        await proc.processRow(fila2(1), e.ctx);

        expect(e.prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(e.confirmadas).toEqual([[
            'comentario.create(1)', 'contacto.deleteMany(80)', 'deudor.update(1)', 'snapshots.createMany(3)',
        ]]);
        expect(e.snapshotsGuardados.map(s => [s.entidad, s.accion, s.deudorId])).toEqual([
            ['comentario', 'INSERT', 1], ['contacto', 'DELETE', 1], ['deudor', 'UPDATE', 1],
        ]);
        // El timeout de la transacción es explícito (el de Prisma son 5 s).
        expect(e.prisma.$transaction.mock.calls[0][1]).toEqual({ maxWait: 10_000, timeout: 30_000 });
    });

    it('el borde que motiva C3b: la transacción del caso 2 tira, el caso 1 queda con sus snapshots, el 2 sin nada, los contadores reflejan solo el 1 y la fila es un error', async () => {
        const e = makeCtxC3b({
            operaciones: OPS_COMPLETAS,
            deudoresPorId: { 1: [deudorFila(1)], 2: [deudorFila(2)] },
            contactosPorDeudor: { 1: [contactoDe(80, 1)], 2: [contactoDe(81, 2)] },
            falla: (llamada, id) => (llamada === 'deudor.update' && id === 2 ? new Error('lock wait timeout') : undefined),
        });
        const proc = new AccionesProcessor();

        await proc.processRow(fila2(1), e.ctx);
        await expect(proc.processRow(fila2(2), e.ctx)).rejects.toThrow('lock wait timeout');
        await proc.afterAll(e.ctx);

        expect(e.log.filter(l => /commit|rollback/.test(l))).toEqual(['tx1:commit', 'tx2:rollback']);
        // Solo el caso 1 llegó a guardar snapshots: el 2 hizo rollback entero, con su comentario y su baja de contacto.
        expect(e.snapshotsGuardados.map(s => s.deudorId)).toEqual([1, 1, 1]);
        const aud = (e.ctx.auditoria.log as jest.Mock).mock.calls[0][0];
        expect(aud.data).toMatchObject({ deudoresAfectados: 1, comentariosCreados: 1, contactosEliminados: 1 });
    });

    it('un P2034 (deadlock) se reintenta una vez y el caso cuenta una sola vez', async () => {
        let intentos = 0;
        const e = makeCtxC3b({
            operaciones: [{ tipo: 'ADD_COMENTARIO', modo: 'ESTATICO', valor: 'x' }],
            deudoresPorId: { 1: [deudorFila(1)] },
            falla: (llamada) => (llamada === 'comentario.create' && ++intentos === 1
                ? Object.assign(new Error('deadlock'), { code: 'P2034' }) : undefined),
        });
        const proc = new AccionesProcessor();

        await proc.processRow(fila2(1), e.ctx);
        await proc.afterAll(e.ctx);

        expect(e.prisma.$transaction).toHaveBeenCalledTimes(2);
        expect(e.log.filter(l => /commit|rollback/.test(l))).toEqual(['tx1:rollback', 'tx2:commit']);
        const aud = (e.ctx.auditoria.log as jest.Mock).mock.calls[0][0];
        expect(aud.data).toMatchObject({ deudoresAfectados: 1, comentariosCreados: 1 });
        expect(e.snapshotsGuardados).toHaveLength(1);
    });

    it('un segundo P2034, o cualquier otro error, no se reintenta más', async () => {
        const conflicto = () => Object.assign(new Error('deadlock'), { code: 'P2034' });
        const dos = makeCtxC3b({
            operaciones: [{ tipo: 'ADD_COMENTARIO', modo: 'ESTATICO', valor: 'x' }],
            deudoresPorId: { 1: [deudorFila(1)] },
            falla: (llamada) => (llamada === 'comentario.create' ? conflicto() : undefined),
        });
        await expect(new AccionesProcessor().processRow(fila2(1), dos.ctx)).rejects.toMatchObject({ code: 'P2034' });
        expect(dos.prisma.$transaction).toHaveBeenCalledTimes(2);

        const otro = makeCtxC3b({
            operaciones: [{ tipo: 'ADD_COMENTARIO', modo: 'ESTATICO', valor: 'x' }],
            deudoresPorId: { 1: [deudorFila(1)] },
            falla: (llamada) => (llamada === 'comentario.create' ? new Error('otra cosa') : undefined),
        });
        await expect(new AccionesProcessor().processRow(fila2(1), otro.ctx)).rejects.toThrow('otra cosa');
        expect(otro.prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('la marca accionSnapshotsPorCaso se escribe una sola vez y antes de la primera transacción', async () => {
        const e = makeCtxC3b({
            operaciones: [{ tipo: 'SET_CAMPO', campo: 'nombre', modo: 'ESTATICO', valor: 'T' }],
            deudoresPorId: { 1: [deudorFila(1)], 2: [deudorFila(2)] },
        });
        const proc = new AccionesProcessor();

        await proc.processRow(fila2(1), e.ctx);
        await proc.processRow(fila2(2), e.ctx);

        expect(e.prisma.remesa.update).toHaveBeenCalledTimes(1);
        expect(e.prisma.remesa.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { accionSnapshotsPorCaso: true } });
        expect(e.log[0]).toBe('remesa.update');
    });

    it('si la marca falla, la fila falla sin escribir nada y la fila siguiente la reintenta', async () => {
        const e = makeCtxC3b({
            operaciones: [{ tipo: 'SET_CAMPO', campo: 'nombre', modo: 'ESTATICO', valor: 'T' }],
            deudoresPorId: { 1: [deudorFila(1)] },
        });
        e.prisma.remesa.update.mockRejectedValueOnce(new Error('base caída'));
        const proc = new AccionesProcessor();

        await expect(proc.processRow(fila2(1), e.ctx)).rejects.toThrow('base caída');
        expect(e.prisma.$transaction).not.toHaveBeenCalled();
        await proc.processRow(fila2(1), e.ctx);
        expect(e.prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('modo CONTACTO: una transacción por fila, con la marca antes, y los snapshots llevan el deudorId de cada contacto', async () => {
        const e = makeCtxC3b({
            matchMode: 'CONTACTO',
            operaciones: [],
        });
        // En modo CONTACTO el where no trae deudorId: el falso devuelve contactos de dos casos.
        const crearOrig = e.prisma.$transaction.getMockImplementation()!;
        e.prisma.$transaction.mockImplementation(async (fn: any, o: any) => crearOrig(async (tx: any) => {
            tx.contacto.findMany = jest.fn().mockResolvedValue([contactoDe(90, 11), contactoDe(91, 12)]);
            return fn(tx);
        }, o));
        const proc = new AccionesProcessor();

        await proc.processRow({ _raw: ['1155550000'] } as any, e.ctx);

        expect(e.log[0]).toBe('remesa.update');
        expect(e.snapshotsGuardados.map(s => [s.entidad, s.deudorId])).toEqual([['contacto', 11], ['contacto', 12]]);
    });

    it('el afterAll no escribe snapshots, y si auditoria.log tira, no tira', async () => {
        const e = makeCtxC3b({
            operaciones: [{ tipo: 'SET_CAMPO', campo: 'nombre', modo: 'ESTATICO', valor: 'T' }],
            deudoresPorId: { 1: [deudorFila(1)] },
        });
        (e.ctx.auditoria.log as jest.Mock).mockRejectedValue(new Error('auditoría caída'));
        const proc = new AccionesProcessor();
        await proc.processRow(fila2(1), e.ctx);
        e.prisma.$transaction.mockClear();

        await expect(proc.afterAll(e.ctx)).resolves.toBeUndefined();

        expect(e.prisma.$transaction).not.toHaveBeenCalled();
        expect((e.ctx.progreso!.subfase as jest.Mock)).not.toHaveBeenCalled();
    });

    it('un documento repetido en dos filas da dos transacciones y los snapshots en el orden de siempre (el segundo, con id mayor)', async () => {
        const e = makeCtxC3b({
            operaciones: [{ tipo: 'ADD_COMENTARIO', modo: 'ESTATICO', valor: 'x' }],
            deudoresPorId: { 1: [deudorFila(1)] },
        });
        const proc = new AccionesProcessor();

        await proc.processRow(fila2(1), e.ctx);
        await proc.processRow(fila2(1), e.ctx);

        expect(e.prisma.$transaction).toHaveBeenCalledTimes(2);
        expect(e.snapshotsGuardados.map(s => s.entidadId)).toEqual([501, 502]);
    });

    it('dos casos de una misma fila (documento repetido) van en dos transacciones: el segundo no arrastra al primero', async () => {
        const e = makeCtxC3b({
            operaciones: [{ tipo: 'SET_CAMPO', campo: 'nombre', modo: 'ESTATICO', valor: 'T' }],
            deudoresPorId: { 1: [deudorFila(1), deudorFila(2)] },
            falla: (llamada, id) => (llamada === 'deudor.update' && id === 2 ? new Error('boom') : undefined),
        });
        const proc = new AccionesProcessor();

        await expect(proc.processRow(fila2(1), e.ctx)).rejects.toThrow('boom');

        expect(e.log.filter(l => /commit|rollback/.test(l))).toEqual(['tx1:commit', 'tx2:rollback']);
        expect(e.snapshotsGuardados.map(s => s.deudorId)).toEqual([1]);
    });
});
