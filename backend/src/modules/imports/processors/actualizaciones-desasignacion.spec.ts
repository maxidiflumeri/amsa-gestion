/**
 * Tests de Feature A — "Actualización diaria de gestión" del ActualizacionesProcessor.
 *
 * Cubre el flag `accionAusente`:
 *  - DESASIGNAR: los ausentes del archivo → GES-094 (guardando el previo). Ignora SIT-050,
 *    ya-desasignados y presentes. Un pago no se genera (no es "pagó todo").
 *  - Re-asignación: un presente que venía en GES-094 se restaura a su gestión previa (o al
 *    default si el previo ya no existe). Ignora SIT-050.
 *  - Idempotencia: correr con todos ya desasignados no produce updates.
 *  - Modo degradado: sin GES-094 seedeado, no se toca a nadie.
 *  - IGNORAR: no se desasigna a nadie.
 */
import { ActualizacionesProcessor } from './actualizaciones.processor';
import { ProcessContext } from './processor.interface';

const GES_094 = 94;
const SIT_050 = 50;
const DEFAULT_GESTION = 200;

function makeCtx(overrides: Partial<ProcessContext> = {}) {
    const deudorUpdate = jest.fn().mockResolvedValue({});
    const deudorCreate = jest.fn().mockResolvedValue({
        id: 777,
        documento: '30111222',
        nroCliente: null,
        nombre: 'JUANA',
        apellido: '',
        camposAdicionales: null,
        estadoGestionId: DEFAULT_GESTION,
        estadoGestionPrevioAId: null,
        estadoSituacionId: 100,
    });
    const parametroFindUnique = jest.fn().mockImplementation(({ where }: any) => {
        if (where.clave === 'GES-094') return Promise.resolve({ id: GES_094 });
        if (where.clave === 'SIT-050') return Promise.resolve({ id: SIT_050 });
        return Promise.resolve(null);
    });

    // La cartera que ve el PREFETCH del lote (findMany con documento/nroCliente IN). Vacía por
    // defecto = el deudor no existe en la remesa origen → escenario B.
    const carteraPrefetch = new Map<string, any>();
    /** Lo que devuelve el findMany "listado de la remesa" que usa el afterAll. */
    let listadoAfterAll: any[] = [];

    const deudorFindMany = jest.fn().mockImplementation(({ where }: any) => {
        if (where?.documento?.in) {
            return Promise.resolve(
                (where.documento.in as string[]).map((d) => carteraPrefetch.get(d)).filter(Boolean),
            );
        }
        if (where?.nroCliente?.in) {
            return Promise.resolve(
                [...carteraPrefetch.values()].filter(
                    (d) => d.nroCliente && (where.nroCliente.in as string[]).includes(d.nroCliente),
                ),
            );
        }
        return Promise.resolve(listadoAfterAll);
    });

    const prisma: any = {
        parametro: {
            findUnique: parametroFindUnique,
            findFirst: jest.fn().mockResolvedValue({ id: DEFAULT_GESTION }),
            findMany: jest.fn().mockResolvedValue([{ id: DEFAULT_GESTION }, { id: 210 }]),
        },
        deudor: {
            findMany: deudorFindMany,
            findUnique: jest.fn().mockResolvedValue(null),
            findFirst: jest.fn().mockResolvedValue(null),
            update: deudorUpdate,
            create: deudorCreate,
        },
        contacto: {
            findMany: jest.fn().mockResolvedValue([]),
            createMany: jest.fn().mockResolvedValue({ count: 0 }),
            upsert: jest.fn().mockResolvedValue({}),
        },
        factura: { create: jest.fn().mockResolvedValue({}) },
        $queryRaw: jest.fn().mockResolvedValue([]),
        // Consume las promesas del array, como hace la transacción real: si alguna falla, falla.
        $transaction: jest.fn((arr: any[]) => Promise.all(arr)),
    };
    const ctx = {
        prisma,
        remesaId: 10,
        remesaOrigenId: 5,
        empresaId: 1,
        usuarioId: 99,
        defaults: { estadoSituacionId: 100, estadoGestionId: DEFAULT_GESTION },
        consolidacion: { consolidar: jest.fn().mockResolvedValue(undefined) },
        promesas: { cerrarCumplidas: jest.fn().mockResolvedValue(undefined) },
        auditoria: { log: jest.fn().mockResolvedValue(undefined) },
        montoDeudorDesdeFacturas: 'SI_VACIO',
        modoActualizacion: 'RECONCILIAR',
        comportamientoDeudaMayor: 'FACTURA_NUEVA',
        crearNuevosCasos: true,
        accionAusente: 'DESASIGNAR',
        ...overrides,
    } as unknown as ProcessContext;
    /** Carga la cartera que verá el prefetch del lote (deudores existentes en la remesa origen). */
    const setCartera = (deudores: any[]) => {
        for (const d of deudores) carteraPrefetch.set(d.documento, d);
    };
    /** Define lo que devuelve el findMany "listado de la remesa" del afterAll. */
    const setListado = (deudores: any[]) => {
        listadoAfterAll = deudores;
    };

    return { ctx, prisma, deudorUpdate, deudorCreate, setCartera, setListado };
}

/** Deudor de cartera con los campos que trae el prefetch. */
function deudorEnCartera(over: Partial<Record<string, any>> = {}) {
    return {
        id: 111,
        documento: '20000001',
        nroCliente: null,
        nombre: 'PEDRO',
        apellido: 'GOMEZ',
        camposAdicionales: null,
        estadoGestionId: 210,
        estadoGestionPrevioAId: null,
        estadoSituacionId: null,
        ...over,
    };
}

describe('ActualizacionesProcessor — accionAusente=DESASIGNAR (afterAll)', () => {
    it('desasigna a los ausentes (GES-094) guardando el previo, e ignora SIT-050 / ya-desasignado / presente', async () => {
        const proc = new ActualizacionesProcessor();
        const { ctx, prisma, deudorUpdate } = makeCtx();

        prisma.deudor.findMany.mockResolvedValue([
            { id: 1, estadoGestionId: 210, estadoSituacionId: null }, // ausente normal → desasignar
            { id: 2, estadoGestionId: 210, estadoSituacionId: SIT_050 }, // cancelado → skip
            { id: 3, estadoGestionId: GES_094, estadoSituacionId: null }, // ya desasignado → skip
            { id: 4, estadoGestionId: 210, estadoSituacionId: null }, // presente en el archivo → skip
        ]);
        // Marcar al deudor 4 como visto en el archivo (match real contra la cartera)
        (proc as any).processedDeudorIds.add(4);
        (proc as any).matchedExistingCount = 1;

        await proc.afterAll(ctx);

        // Solo el deudor 1 se desasigna
        expect(deudorUpdate).toHaveBeenCalledTimes(1);
        expect(deudorUpdate).toHaveBeenCalledWith({
            where: { id: 1 },
            data: { estadoGestionId: GES_094, estadoGestionPrevioAId: 210 },
        });
        // Auditoría resumen (1 por batch)
        expect(ctx.auditoria.log).toHaveBeenCalledTimes(1);
        // No hubo datos de deuda → no se consolida ni se generan pagos
        expect(ctx.consolidacion.consolidar).not.toHaveBeenCalled();
    });

    it('idempotente: si todos los ausentes ya están en GES-094, no hace updates', async () => {
        const proc = new ActualizacionesProcessor();
        const { ctx, prisma, deudorUpdate } = makeCtx();

        prisma.deudor.findMany.mockResolvedValue([
            { id: 1, estadoGestionId: GES_094, estadoSituacionId: null },
            { id: 2, estadoGestionId: GES_094, estadoSituacionId: null },
        ]);
        (proc as any).matchedExistingCount = 1; // hubo match real → el guard no aplica

        await proc.afterAll(ctx);

        expect(deudorUpdate).not.toHaveBeenCalled();
        expect(ctx.auditoria.log).not.toHaveBeenCalled();
    });

    it('modo degradado: sin GES-094 seedeado no toca a nadie', async () => {
        const proc = new ActualizacionesProcessor();
        const { ctx, prisma, deudorUpdate } = makeCtx();
        prisma.parametro.findUnique.mockResolvedValue(null); // GES-094 y SIT-050 ausentes

        await proc.afterAll(ctx);

        expect(prisma.deudor.findMany).not.toHaveBeenCalled();
        expect(deudorUpdate).not.toHaveBeenCalled();
    });

    it('GUARD: si 0 filas matchearon la cartera (archivo fallido) NO desasigna a nadie', async () => {
        const proc = new ActualizacionesProcessor();
        const { ctx, prisma, deudorUpdate } = makeCtx();

        // La remesa origen tiene deudores, pero ninguna fila del archivo matcheó (matchedExistingCount=0,
        // el estado por defecto de un batch en el que todo falló la validación). No se debe tocar nada.
        prisma.deudor.findMany.mockResolvedValue([
            { id: 1, estadoGestionId: 210, estadoSituacionId: null },
            { id: 2, estadoGestionId: 210, estadoSituacionId: null },
        ]);

        await proc.afterAll(ctx);

        expect(deudorUpdate).not.toHaveBeenCalled();
        expect(ctx.auditoria.log).not.toHaveBeenCalled();
    });

    it('IGNORAR: no desasigna a ningún ausente', async () => {
        const proc = new ActualizacionesProcessor();
        const { ctx, prisma, deudorUpdate } = makeCtx({ accionAusente: 'IGNORAR' } as any);

        prisma.deudor.findMany.mockResolvedValue([
            { id: 1, estadoGestionId: 210, estadoSituacionId: null },
        ]);

        await proc.afterAll(ctx);

        expect(deudorUpdate).not.toHaveBeenCalled();
    });
});

describe('ActualizacionesProcessor — alta de casos nuevos (escenario B)', () => {
    it('SOLO_DATOS + crearNuevosCasos: da de alta el caso nuevo en la MISMA remesa origen y lo marca presente', async () => {
        const proc = new ActualizacionesProcessor();
        const { ctx, deudorCreate } = makeCtx({
            modoActualizacion: 'SOLO_DATOS',
            accionAusente: 'DESASIGNAR',
            crearNuevosCasos: true,
        } as any);

        // Cartera vacía → el prefetch no lo encuentra → se crea (escenario B).
        await proc.processRow({ documento: '30111222', nombre: 'JUANA' } as any, ctx);

        // Alta en la remesa ORIGEN (5), no en la del import (10) → cartera unificada, sin duplicar mañana.
        expect(deudorCreate).toHaveBeenCalledTimes(1);
        expect(deudorCreate.mock.calls[0][0].data.remesaId).toBe(5);
        // Marcado como presente (no se auto-desasigna en el afterAll) sin contar como match real.
        expect((proc as any).processedDeudorIds.has(777)).toBe(true);
        expect((proc as any).matchedExistingCount).toBe(0);
    });

    it('RECONCILIAR + PAGO_TODO: el caso nuevo también va a la remesa origen y se marca presente', async () => {
        const proc = new ActualizacionesProcessor();
        const { ctx, deudorCreate } = makeCtx({
            modoActualizacion: 'RECONCILIAR',
            accionAusente: 'PAGO_TODO',
            crearNuevosCasos: true,
        } as any);

        await proc.processRow({ documento: '30111222', nombre: 'JUANA', montoTotal: '1000' } as any, ctx);

        // El destino ya no depende de accionAusente: siempre la cartera (5), no la del import (10).
        expect(deudorCreate).toHaveBeenCalledTimes(1);
        expect(deudorCreate.mock.calls[0][0].data.remesaId).toBe(5);
        expect((proc as any).processedDeudorIds.has(777)).toBe(true);
        expect((proc as any).matchedExistingCount).toBe(0);
    });

    it('REGRESIÓN: un caso nuevo bajo PAGO_TODO no se marca "pagó todo" en el afterAll de la misma corrida', async () => {
        const proc = new ActualizacionesProcessor();
        const { ctx, prisma, setCartera, setListado } = makeCtx({
            modoActualizacion: 'RECONCILIAR',
            accionAusente: 'PAGO_TODO',
            crearNuevosCasos: true,
        } as any);
        const pagoCreate = jest.fn().mockResolvedValue({});
        prisma.pago = { create: pagoCreate, aggregate: jest.fn().mockResolvedValue({ _sum: { importe: 0 } }) };
        prisma.factura.updateMany = jest.fn().mockResolvedValue({ count: 0 });
        prisma.factura.findMany = jest.fn().mockResolvedValue([]);

        // El 111 ya está en la cartera; el 30111222 no (será alta con id 777).
        setCartera([deudorEnCartera({ id: 111, documento: '20000001' })]);

        // Un solo lote con las dos filas, como lo llama el runner.
        const fallos = await proc.processBatch(
            [
                { row: { documento: '20000001', montoTotal: '5000' } as any, idx: 0 },
                { row: { documento: '30111222', nombre: 'JUANA', montoTotal: '1000' } as any, idx: 1 },
            ],
            ctx,
        );
        expect(fallos).toEqual([]);

        // El afterAll recorre la cartera: el 111 y el recién creado 777 están presentes; solo el 222
        // estuvo ausente del archivo y es el único que debe reconciliarse como "pagó todo".
        setListado([
            { id: 111, montoTotal: 5000 },
            { id: 222, montoTotal: 3000 },
            { id: 777, montoTotal: 1000 },
        ]);

        await proc.afterAll(ctx);

        expect(pagoCreate).toHaveBeenCalledTimes(1);
        expect(pagoCreate.mock.calls[0][0].data.deudorId).toBe(222);
    });
});

describe('ActualizacionesProcessor — processBatch (performance del archivo diario)', () => {
    /** Lote típico de Toyota: SOLO_DATOS, todos existentes, mismos datos que ayer. */
    function loteToyota(n: number) {
        return Array.from({ length: n }, (_, i) => ({
            row: { documento: `DOC${i}`, nombre: 'JUAN', camposAdicionales: { DNI: `CUIL${i}` } } as any,
            idx: i,
        }));
    }

    it('resuelve todo el lote con UNA sola lectura, no una por fila', async () => {
        const proc = new ActualizacionesProcessor();
        const { ctx, prisma, setCartera } = makeCtx({ modoActualizacion: 'SOLO_DATOS' } as any);
        setCartera(
            Array.from({ length: 50 }, (_, i) =>
                deudorEnCartera({ id: 1000 + i, documento: `DOC${i}`, camposAdicionales: { DNI: `CUIL${i}` } }),
            ),
        );

        const fallos = await proc.processBatch(loteToyota(50), ctx);

        expect(fallos).toEqual([]);
        // Un findMany para las 50 filas (antes: 50 findUnique + 50 + 50).
        expect(prisma.deudor.findMany).toHaveBeenCalledTimes(1);
        expect(prisma.deudor.findUnique).not.toHaveBeenCalled();
        expect((proc as any).matchedExistingCount).toBe(50);
    });

    it('no gasta un UPDATE cuando los datos del archivo son idénticos a los guardados', async () => {
        const proc = new ActualizacionesProcessor();
        const { ctx, prisma, setCartera } = makeCtx({ modoActualizacion: 'SOLO_DATOS' } as any);
        setCartera(
            Array.from({ length: 50 }, (_, i) =>
                deudorEnCartera({ id: 1000 + i, documento: `DOC${i}`, camposAdicionales: { DNI: `CUIL${i}` } }),
            ),
        );

        await proc.processBatch(loteToyota(50), ctx);

        // Nada cambió → ni un update ni una transacción. Éste es el grueso del ahorro diario.
        expect(prisma.deudor.update).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('sí actualiza (y agrupa en una transacción) cuando el archivo trae un dato distinto', async () => {
        const proc = new ActualizacionesProcessor();
        const { ctx, prisma, setCartera } = makeCtx({ modoActualizacion: 'SOLO_DATOS' } as any);
        setCartera([
            deudorEnCartera({ id: 1, documento: 'DOC0', camposAdicionales: { DNI: 'VIEJO' } }),
            deudorEnCartera({ id: 2, documento: 'DOC1', camposAdicionales: { DNI: 'CUIL1' } }),
        ]);

        await proc.processBatch(loteToyota(2), ctx);

        // Solo el primero cambió (DNI VIEJO → CUIL0); el segundo ya estaba igual.
        expect(prisma.deudor.update).toHaveBeenCalledTimes(1);
        expect(prisma.deudor.update).toHaveBeenCalledWith({
            where: { id: 1 },
            data: { camposAdicionales: { DNI: 'CUIL0' } },
        });
        // Los updates del lote viajan en una sola transacción.
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('dos filas sin documento generan placeholders distintos (no chocan con el unique)', async () => {
        const proc = new ActualizacionesProcessor();
        const { ctx, deudorCreate } = makeCtx({ modoActualizacion: 'SOLO_DATOS' } as any);

        await proc.processBatch(
            [
                { row: { nombre: 'SIN DNI 1' } as any, idx: 0 },
                { row: { nombre: 'SIN DNI 2' } as any, idx: 1 },
            ],
            ctx,
        );

        expect(deudorCreate).toHaveBeenCalledTimes(2);
        const doc1 = deudorCreate.mock.calls[0][0].data.documento;
        const doc2 = deudorCreate.mock.calls[1][0].data.documento;
        expect(doc1).not.toBe(doc2);
        expect(doc1).toMatch(/^SIN_DOC_/);
    });

    it('un documento nuevo repetido dentro del MISMO lote se da de alta una sola vez', async () => {
        const proc = new ActualizacionesProcessor();
        const { ctx, deudorCreate } = makeCtx({ modoActualizacion: 'SOLO_DATOS' } as any);

        // El prefetch corre una vez por lote, así que sin dedupe interno la segunda fila
        // volvería a crear el mismo deudor.
        await proc.processBatch(
            [
                { row: { documento: '30111222', nombre: 'JUANA' } as any, idx: 0 },
                { row: { documento: '30111222', nombre: 'JUANA' } as any, idx: 1 },
            ],
            ctx,
        );

        expect(deudorCreate).toHaveBeenCalledTimes(1);
    });

    it('una fila que falla no arrastra al resto del lote', async () => {
        const proc = new ActualizacionesProcessor();
        const { ctx, deudorCreate, setCartera } = makeCtx({ modoActualizacion: 'SOLO_DATOS' } as any);
        setCartera([deudorEnCartera({ id: 1, documento: 'DOC0', camposAdicionales: { DNI: 'CUIL0' } })]);
        deudorCreate.mockRejectedValueOnce(new Error('documento inválido'));

        const fallos = await proc.processBatch(
            [
                { row: { documento: 'DOC0', camposAdicionales: { DNI: 'CUIL0' } } as any, idx: 0 },
                { row: { documento: 'NUEVO', nombre: 'X' } as any, idx: 1 },
            ],
            ctx,
        );

        expect(fallos).toEqual([{ idx: 1, error: 'documento inválido' }]);
        // La fila buena igual se procesó (quedó marcada como presente).
        expect((proc as any).processedDeudorIds.has(1)).toBe(true);
    });

    it('si la transacción del flush falla, solo cae la fila culpable (no el lote entero)', async () => {
        const proc = new ActualizacionesProcessor();
        const { ctx, deudorUpdate, setCartera } = makeCtx({ modoActualizacion: 'SOLO_DATOS' } as any);
        setCartera([
            deudorEnCartera({ id: 1, documento: 'DOC0', camposAdicionales: { DNI: 'VIEJO' } }),
            deudorEnCartera({ id: 2, documento: 'DOC1', camposAdicionales: { DNI: 'VIEJO' } }),
        ]);

        // El update del deudor 2 falla → tumba la transacción del lote; en el reintento
        // individual el 1 pasa y solo el 2 queda como error.
        deudorUpdate.mockImplementation(({ where }: any) =>
            where.id === 2 ? Promise.reject(new Error('Unique constraint failed')) : Promise.resolve({}),
        );

        const fallos = await proc.processBatch(loteToyota(2), ctx);

        expect(fallos).toEqual([{ idx: 1, error: 'Unique constraint failed' }]);
        // El deudor 1 sí se actualizó en el reintento.
        expect(deudorUpdate).toHaveBeenCalledWith({
            where: { id: 1 },
            data: { camposAdicionales: { DNI: 'CUIL0' } },
        });
    });

    it('devuelve UN error por fila aunque falle en dos fases (el runner cuenta por elemento)', async () => {
        const proc = new ActualizacionesProcessor();
        // RECONCILIAR: la fila pasa por el flush de identidad y por la reconciliación.
        const { ctx, prisma, deudorUpdate, setCartera } = makeCtx({ modoActualizacion: 'RECONCILIAR' } as any);
        setCartera([deudorEnCartera({ id: 1, documento: 'DOC0', camposAdicionales: { DNI: 'VIEJO' } })]);
        prisma.factura.findMany = jest.fn().mockRejectedValue(new Error('falla al reconciliar'));
        deudorUpdate.mockRejectedValue(new Error('falla el update'));

        const fallos = await proc.processBatch(
            [{ row: { documento: 'DOC0', camposAdicionales: { DNI: 'NUEVO' }, montoTotal: '100' } as any, idx: 0 }],
            ctx,
        );

        // Un solo error para idx 0, no dos.
        expect(fallos).toHaveLength(1);
        expect(fallos[0].idx).toBe(0);
    });

    it('respeta crearNuevosCasos=false: no crea ni cuenta al ausente de la cartera', async () => {
        const proc = new ActualizacionesProcessor();
        const { ctx, deudorCreate } = makeCtx({
            modoActualizacion: 'SOLO_DATOS',
            crearNuevosCasos: false,
        } as any);

        const fallos = await proc.processBatch([{ row: { documento: 'NUEVO' } as any, idx: 0 }], ctx);

        expect(fallos).toEqual([]);
        expect(deudorCreate).not.toHaveBeenCalled();
        expect((proc as any).matchedExistingCount).toBe(0);
    });

    it('cae al match por nro_cliente cuando el documento no está en la cartera', async () => {
        const proc = new ActualizacionesProcessor();
        const { ctx, prisma, setCartera } = makeCtx({ modoActualizacion: 'SOLO_DATOS' } as any);
        setCartera([deudorEnCartera({ id: 55, documento: 'OTRO-DOC', nroCliente: 'C-99' })]);

        await proc.processBatch(
            [{ row: { documento: 'NO-ESTA', nro_cliente: 'C-99' } as any, idx: 0 }],
            ctx,
        );

        // Dos lecturas: una por documento y otra por nroCliente para las que no matchearon.
        expect(prisma.deudor.findMany).toHaveBeenCalledTimes(2);
        expect((proc as any).processedDeudorIds.has(55)).toBe(true);
        expect((proc as any).matchedExistingCount).toBe(1);
    });
});

describe('ActualizacionesProcessor — re-asignación (calcularReasignacion)', () => {
    it('restaura el estado de gestión previo de un deudor que venía en GES-094', async () => {
        const proc = new ActualizacionesProcessor();
        const { ctx } = makeCtx();

        const data = await (proc as any).calcularReasignacion(
            deudorEnCartera({ id: 7, estadoGestionId: GES_094, estadoGestionPrevioAId: 210 }),
            ctx,
        );

        expect(data).toEqual({ estadoGestionId: 210, estadoGestionPrevioAId: null });
    });

    it('cae al default cuando el previo apunta a un parámetro inexistente', async () => {
        const proc = new ActualizacionesProcessor();
        const { ctx, prisma } = makeCtx();
        // El set de gestiones válidas no incluye al 999.
        prisma.parametro.findMany.mockResolvedValue([{ id: DEFAULT_GESTION }, { id: 210 }]);

        const data = await (proc as any).calcularReasignacion(
            deudorEnCartera({ id: 7, estadoGestionId: GES_094, estadoGestionPrevioAId: 999 }),
            ctx,
        );

        expect(data).toEqual({ estadoGestionId: DEFAULT_GESTION, estadoGestionPrevioAId: null });
    });

    it('no re-asigna a un deudor cancelado (SIT-050)', async () => {
        const proc = new ActualizacionesProcessor();
        const { ctx } = makeCtx();

        const data = await (proc as any).calcularReasignacion(
            deudorEnCartera({
                id: 7,
                estadoGestionId: GES_094,
                estadoGestionPrevioAId: 210,
                estadoSituacionId: SIT_050,
            }),
            ctx,
        );

        expect(data).toBeNull();
    });

    it('no hace nada si el deudor no estaba desasignado', async () => {
        const proc = new ActualizacionesProcessor();
        const { ctx } = makeCtx();

        const data = await (proc as any).calcularReasignacion(
            deudorEnCartera({ id: 7, estadoGestionId: 210, estadoGestionPrevioAId: null }),
            ctx,
        );

        expect(data).toBeNull();
    });

    it('la re-asignación se emite como update dentro del lote', async () => {
        const proc = new ActualizacionesProcessor();
        const { ctx, prisma, setCartera } = makeCtx({ modoActualizacion: 'SOLO_DATOS' } as any);
        setCartera([
            deudorEnCartera({ id: 7, documento: '20000001', estadoGestionId: GES_094, estadoGestionPrevioAId: 210 }),
        ]);

        await proc.processBatch([{ row: { documento: '20000001' } as any, idx: 0 }], ctx);

        expect(prisma.deudor.update).toHaveBeenCalledWith({
            where: { id: 7 },
            data: { estadoGestionId: 210, estadoGestionPrevioAId: null },
        });
        expect((proc as any).reasignadosCount).toBe(1);
    });
});
