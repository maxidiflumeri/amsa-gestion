/**
 * Tests del MultiarchivoProcessor (Toyota TCFA).
 *
 * La lógica de negocio la comparte con MULTIRREGISTRO vía `CasosCedenteProcessor` y está cubierta en
 * `multirregistro.processor.spec.ts`. Acá se cubre lo que **cambia** en esta cartera:
 *  - viene CUIT/CUIL real → no se usa placeholder, y se completa el de los casos ya cargados;
 *  - viene el vencimiento real de cada cuota;
 *  - la baja dice de qué cliente es → la factura se resuelve sin ambigüedad;
 *  - el motivo de baja viene con código numérico;
 *  - hay casos sin cuotas que solo traen el total declarado por el cedente.
 */
import { MultiarchivoProcessor } from './multiarchivo.processor';
import { ProcessContext } from './processor.interface';

const GES_090 = 90;
const SIT_071 = 71;
const GES_094 = 94;
const SIT_050 = 50;
const GESTION_DEFAULT = 200;
/** Estado de gestión "real" de un caso activo, el que hay que preservar al desasignar. */
const GESTION_EN_TRAMITE = 210;

function makeCtx(overrides: Partial<ProcessContext> = {}) {
    const deudorCreate = jest.fn().mockResolvedValue({ id: 777 });
    const deudorUpdate = jest.fn().mockResolvedValue({});
    const deudorFindFirst = jest.fn().mockResolvedValue(null);
    const facturaCreate = jest.fn().mockResolvedValue({});
    const facturaUpdate = jest.fn().mockResolvedValue({});
    const facturaFindUnique = jest.fn().mockResolvedValue(null);
    const facturaFindMany = jest.fn().mockResolvedValue([]);
    const facturaCount = jest.fn().mockResolvedValue(0);
    const facturaAggregate = jest.fn().mockResolvedValue({ _sum: { importe: 0 }, _count: 1 });
    const contactoCreateMany = jest.fn().mockResolvedValue({ count: 0 });
    const pagoCreate = jest.fn().mockResolvedValue({});

    const deudorFindMany = jest.fn().mockResolvedValue([]);
    const transaction = jest.fn().mockImplementation((ops: any[]) => Promise.resolve(ops));

    const prisma: any = {
        parametro: {
            findUnique: jest.fn().mockImplementation(({ where }: any) => {
                if (where.clave === 'GES-090') return Promise.resolve({ id: GES_090 });
                if (where.clave === 'SIT-071') return Promise.resolve({ id: SIT_071 });
                if (where.clave === 'GES-094') return Promise.resolve({ id: GES_094 });
                if (where.clave === 'SIT-050') return Promise.resolve({ id: SIT_050 });
                return Promise.resolve(null);
            }),
            findMany: jest.fn().mockResolvedValue(
                [GESTION_DEFAULT, GESTION_EN_TRAMITE, GES_090, GES_094].map((id) => ({ id })),
            ),
        },
        $transaction: transaction,
        deudor: { findFirst: deudorFindFirst, findMany: deudorFindMany, create: deudorCreate, update: deudorUpdate },
        factura: {
            findUnique: facturaFindUnique,
            findFirst: jest.fn().mockResolvedValue(null),
            findMany: facturaFindMany,
            create: facturaCreate,
            update: facturaUpdate,
            aggregate: facturaAggregate,
            count: facturaCount,
        },
        contacto: { createMany: contactoCreateMany, findMany: jest.fn().mockResolvedValue([]) },
        pago: { create: pagoCreate },
    };

    const ctx = {
        prisma,
        remesaId: 42,
        empresaId: 87,
        usuarioId: 9,
        defaults: { estadoSituacionId: 100, estadoGestionId: 200 },
        consolidacion: { consolidar: jest.fn().mockResolvedValue({ aSIT050: 0, aSIT041: 0 }) },
        promesas: { cerrarCumplidas: jest.fn().mockResolvedValue(undefined) },
        auditoria: { log: jest.fn().mockResolvedValue(undefined) },
        // Config real de TCFA: solo el motivo 1 ("Pago de Cuota") es plata que entró.
        multiarchivoConfig: { bajas: { motivosPagoIds: ['1'], motivosPago: ['Pago de Cuota'] } },
        ...overrides,
    } as unknown as ProcessContext;

    return {
        ctx, prisma, deudorCreate, deudorUpdate, deudorFindFirst, deudorFindMany, transaction,
        facturaCreate, facturaUpdate, facturaFindUnique, facturaFindMany, facturaCount,
        facturaAggregate, contactoCreateMany, pagoCreate,
    };
}

/** Contexto con la desasignación de ausentes activada y una plantilla asociada. */
function makeCtxDesasignando(overrides: Partial<ProcessContext> = {}) {
    return makeCtx({
        plantillaId: 7,
        multiarchivoConfig: {
            accionAusente: 'DESASIGNAR',
            bajas: { motivosPagoIds: ['1'], motivosPago: ['Pago de Cuota'] },
        },
        ...overrides,
    } as any);
}

/**
 * Updates de desasignación. Se leen de `deudor.update` y no de `$transaction` porque el processor
 * construye el array llamando al update de a uno y después se lo pasa a la transacción.
 */
const desasignaciones = (deudorUpdate: jest.Mock) =>
    deudorUpdate.mock.calls
        .map((c: any) => c[0])
        .filter((u: any) => u.data?.estadoGestionId === GES_094);

const VTO = new Date(2026, 4, 8);

const caso = (over: Record<string, any> = {}) => ({
    _tipo: 'CASO',
    nroCliente: '488744',
    documento: '27179395431',
    nombre: 'SINCHICAY YMELDA VIVIAN',
    montoTotalDeclarado: 344483.87,
    camposAdicionales: { localidad: 'CORDOBA' },
    _blocks: [
        {
            entity: 'FACTURA',
            data: {
                nroFactura: '1127530-13', importe: 344483.87, contrato: '1127530', cuota: '13',
                vencimiento: VTO, detalle: 'Capital: 143394.21',
            },
        },
    ],
    ...over,
});

const baja = (over: Record<string, any> = {}) => ({
    _tipo: 'BAJA',
    nroCliente: '488744',
    nroFactura: '1127530-12',
    contrato: '1127530',
    cuota: '12',
    fecha: new Date(2026, 4, 29),
    motivo: 'Pago de Cuota',
    motivoId: '1',
    ...over,
});

describe('MultiarchivoProcessor — identidad', () => {
    it('crea el deudor con el CUIT real del archivo, sin placeholder', async () => {
        const { ctx, deudorCreate } = makeCtx();
        await new MultiarchivoProcessor().processRow(caso() as any, ctx);

        const data = deudorCreate.mock.calls[0][0].data;
        expect(data.documento).toBe('27179395431');
        expect(data.nroCliente).toBe('488744');
        expect(data.remesaId).toBe(42);
    });

    it('cae al placeholder canónico si el cedente no manda documento', async () => {
        const { ctx, deudorCreate } = makeCtx();
        await new MultiarchivoProcessor().processRow(caso({ documento: '' }) as any, ctx);

        // El mismo prefijo que el resto de las categorías, para que `esDocumentoPlaceholder()` lo
        // reconozca y una actualización posterior pueda completarlo.
        expect(deudorCreate.mock.calls[0][0].data.documento).toBe('SIN-DNI-488744');
    });

    it('completa el documento del caso que se había cargado con placeholder', async () => {
        const { ctx, prisma, deudorUpdate } = makeCtx();
        prisma.deudor.findFirst.mockResolvedValue({
            id: 555, nombre: 'SINCHICAY YMELDA VIVIAN', documento: 'SIN-DNI-488744', camposAdicionales: { localidad: 'CORDOBA' },
        });

        await new MultiarchivoProcessor().processRow(caso() as any, ctx);

        const update = deudorUpdate.mock.calls.find((c: any) => 'documento' in c[0].data);
        expect(update[0].data.documento).toBe('27179395431');
    });

    it('NO pisa un documento real ya cargado', async () => {
        const { ctx, prisma, deudorUpdate } = makeCtx();
        prisma.deudor.findFirst.mockResolvedValue({
            id: 555, nombre: 'SINCHICAY YMELDA VIVIAN', documento: '20999999999', camposAdicionales: { localidad: 'CORDOBA' },
        });

        await new MultiarchivoProcessor().processRow(caso() as any, ctx);

        // Un cambio de identidad lo tiene que revisar una persona, no pisarlo un import diario.
        expect(deudorUpdate.mock.calls.filter((c: any) => 'documento' in c[0].data)).toHaveLength(0);
    });

    it('busca el deudor en toda la empresa, no en la remesa del import', async () => {
        const { ctx, prisma } = makeCtx();
        await new MultiarchivoProcessor().processRow(caso() as any, ctx);

        expect(prisma.deudor.findFirst.mock.calls[0][0].where).toEqual({ empresaId: 87, nroCliente: '488744' });
    });
});

describe('MultiarchivoProcessor — facturas con vencimiento real', () => {
    it('crea la cuota con su vencimiento y el contrato en externalId', async () => {
        const { ctx, facturaCreate } = makeCtx();
        await new MultiarchivoProcessor().processRow(caso() as any, ctx);

        const d = facturaCreate.mock.calls[0][0].data;
        expect(d.nroFactura).toBe('1127530-13');
        expect(d.externalId).toBe('1127530');
        expect(d.vencimiento).toEqual(VTO);
        expect(d.importe).toBeCloseTo(344483.87, 2);
    });

    it('actualiza el vencimiento si el cedente lo corrió', async () => {
        const { ctx, prisma, facturaUpdate } = makeCtx();
        prisma.factura.findUnique.mockResolvedValue({
            id: 11, importe: 344483.87, detalle: 'Capital: 143394.21', externalId: '1127530',
            estado: 'PENDIENTE', vencimiento: new Date(2026, 3, 8),
        });

        await new MultiarchivoProcessor().processRow(caso() as any, ctx);

        expect(facturaUpdate).toHaveBeenCalledTimes(1);
        expect(facturaUpdate.mock.calls[0][0].data).toEqual({ vencimiento: VTO });
    });

    it('no gasta un UPDATE si la cuota llega igual que ayer', async () => {
        const { ctx, prisma, facturaUpdate } = makeCtx();
        prisma.factura.findUnique.mockResolvedValue({
            id: 11, importe: 344483.87, detalle: 'Capital: 143394.21', externalId: '1127530',
            estado: 'PENDIENTE', vencimiento: VTO,
        });

        await new MultiarchivoProcessor().processRow(caso() as any, ctx);

        expect(facturaUpdate).not.toHaveBeenCalled();
    });
});

describe('MultiarchivoProcessor — casos sin cuotas', () => {
    it('usa el total declarado por el cedente cuando el caso no trae ninguna cuota', async () => {
        // Son las asignaciones viejas de TCFA: traen TotalDeuda pero ya no traen detalle. Sin esto
        // quedarían en deuda 0 y desaparecerían de la cartera.
        const { ctx, prisma, deudorUpdate } = makeCtx();
        prisma.factura.aggregate.mockResolvedValue({ _sum: { importe: null }, _count: 0 });
        prisma.factura.count.mockResolvedValue(0);

        await new MultiarchivoProcessor().processRow(
            caso({ _blocks: [], montoTotalDeclarado: 70836 }) as any, ctx,
        );

        expect(deudorUpdate).toHaveBeenCalledWith({ where: { id: 777 }, data: { montoTotal: 70836 } });
    });

    it('NO resucita la deuda de un caso al que se le anularon todas las cuotas', async () => {
        const { ctx, prisma, deudorUpdate } = makeCtx();
        // 0 vigentes pero 3 facturas cargadas: el cedente se las retiró, la deuda real es 0.
        prisma.factura.aggregate.mockResolvedValue({ _sum: { importe: null }, _count: 0 });
        prisma.factura.count.mockResolvedValue(3);

        await new MultiarchivoProcessor().processRow(
            caso({ _blocks: [], montoTotalDeclarado: 70836 }) as any, ctx,
        );

        expect(deudorUpdate).toHaveBeenCalledWith({ where: { id: 777 }, data: { montoTotal: 0 } });
    });

    it('con cuotas, el montoTotal sale de la suma y no del total declarado', async () => {
        const { ctx, prisma, deudorUpdate } = makeCtx();
        prisma.factura.aggregate.mockResolvedValue({ _sum: { importe: 999999 }, _count: 1 });

        await new MultiarchivoProcessor().processRow(caso() as any, ctx);

        expect(deudorUpdate).toHaveBeenCalledWith({ where: { id: 777 }, data: { montoTotal: 999999 } });
        expect(prisma.factura.count).not.toHaveBeenCalled();
    });

    it('acepta el caso sin cuotas si trae total declarado, y lo rechaza si no', () => {
        const proc = new MultiarchivoProcessor();
        expect(proc.validateRow!(caso({ _blocks: [], montoTotalDeclarado: 70836 }) as any, {} as any).valid).toBe(true);
        expect(proc.validateRow!(caso({ _blocks: [], montoTotalDeclarado: undefined }) as any, {} as any).valid).toBe(false);
    });
});

describe('MultiarchivoProcessor — bajas resueltas por cliente', () => {
    const facturaDeBaja = { id: 11, deudorId: 321, importe: 344483.87 };

    it('resuelve la factura por (deudor, nroFactura) sin buscar por número en toda la empresa', async () => {
        const { ctx, prisma } = makeCtx();
        prisma.deudor.findFirst.mockResolvedValue({ id: 321 });
        prisma.factura.findUnique.mockResolvedValue(facturaDeBaja);
        prisma.factura.count.mockResolvedValue(1);

        await new MultiarchivoProcessor().processRow(baja() as any, ctx);

        expect(prisma.factura.findUnique.mock.calls[0][0].where).toEqual({
            deudorId_nroFactura: { deudorId: 321, nroFactura: '1127530-12' },
        });
        // El camino ambiguo de la cuenta 87 (findMany por número) no se usa: acá no hace falta.
        expect(prisma.factura.findMany).not.toHaveBeenCalled();
    });

    it('baja por PAGO (motivo 1): registra el pago por el importe de la cuota', async () => {
        const { ctx, prisma, pagoCreate, facturaUpdate } = makeCtx();
        prisma.deudor.findFirst.mockResolvedValue({ id: 321 });
        prisma.factura.findUnique.mockResolvedValue(facturaDeBaja);
        prisma.factura.count.mockResolvedValue(1);

        await new MultiarchivoProcessor().processRow(baja() as any, ctx);

        expect(pagoCreate).toHaveBeenCalledTimes(1);
        const pago = pagoCreate.mock.calls[0][0].data;
        expect(pago.deudorId).toBe(321);
        expect(pago.importe).toBeCloseTo(344483.87, 2);
        expect(pago.fecha).toEqual(new Date(2026, 4, 29));
        expect(facturaUpdate).toHaveBeenCalledWith({ where: { id: 11 }, data: { estado: 'PAGADA' } });
    });

    it.each([
        ['4', 'Envio a Gestion Especial'],
        ['3', 'Contrato Finalizado/Terminado'],
    ])('baja por motivo %s (%s): NO registra pago, solo anula la cuota', async (motivoId, motivo) => {
        const { ctx, prisma, pagoCreate, facturaUpdate } = makeCtx();
        prisma.deudor.findFirst.mockResolvedValue({ id: 321 });
        prisma.factura.findUnique.mockResolvedValue(facturaDeBaja);
        prisma.factura.count.mockResolvedValue(1);

        await new MultiarchivoProcessor().processRow(baja({ motivoId, motivo }) as any, ctx);

        // El cedente retira la cuota de la gestión: no entró plata.
        expect(pagoCreate).not.toHaveBeenCalled();
        expect(facturaUpdate).toHaveBeenCalledWith({ where: { id: 11 }, data: { estado: 'ANULADA' } });
    });

    it('el código de motivo gana sobre el texto', async () => {
        const { ctx, prisma, pagoCreate } = makeCtx();
        prisma.deudor.findFirst.mockResolvedValue({ id: 321 });
        prisma.factura.findUnique.mockResolvedValue(facturaDeBaja);
        prisma.factura.count.mockResolvedValue(1);

        // Texto que matchearía `motivosPago` pero con un código que no está en `motivosPagoIds`:
        // si el cedente reescribe el texto, manda el código.
        await new MultiarchivoProcessor().processRow(
            baja({ motivoId: '4', motivo: 'Pago de Cuota (reclasificado)' }) as any, ctx,
        );

        expect(pagoCreate).not.toHaveBeenCalled();
    });

    it('sin código en la fila cae al match por texto', async () => {
        const { ctx, prisma, pagoCreate } = makeCtx();
        prisma.deudor.findFirst.mockResolvedValue({ id: 321 });
        prisma.factura.findUnique.mockResolvedValue(facturaDeBaja);
        prisma.factura.count.mockResolvedValue(1);

        await new MultiarchivoProcessor().processRow(baja({ motivoId: '' }) as any, ctx);

        expect(pagoCreate).toHaveBeenCalledTimes(1);
    });

    it('PAGO PARCIAL: si le quedan cuotas vigentes el caso NO sale de gestión', async () => {
        // El escenario del archivo real: baja la cuota 12 por pago y sigue viva la 13.
        const { ctx, prisma, deudorUpdate } = makeCtx();
        prisma.deudor.findFirst.mockResolvedValue({ id: 321 });
        prisma.factura.findUnique.mockResolvedValue(facturaDeBaja);
        prisma.factura.count.mockResolvedValue(1); // le queda la cuota 13

        await new MultiarchivoProcessor().processRow(baja() as any, ctx);

        expect(deudorUpdate.mock.calls.filter((c: any) => 'estadoGestionId' in c[0].data)).toHaveLength(0);
    });

    it('sale de gestión cuando cae la última cuota vigente', async () => {
        const { ctx, prisma, deudorUpdate } = makeCtx();
        prisma.deudor.findFirst.mockResolvedValue({ id: 321 });
        prisma.factura.findUnique.mockResolvedValue(facturaDeBaja);
        prisma.factura.count.mockResolvedValue(0);

        await new MultiarchivoProcessor().processRow(baja() as any, ctx);

        expect(deudorUpdate).toHaveBeenCalledWith({
            where: { id: 321 },
            data: { estadoGestionId: GES_090, estadoSituacionId: SIT_071 },
        });
    });

    it('si el cliente de la baja no está cargado, avisa y sigue', async () => {
        const proc = new MultiarchivoProcessor();
        const { ctx, deudorUpdate, pagoCreate } = makeCtx();
        // Normal en la primera carga: 79 de las 85 bajas del archivo real son de clientes que no
        // están en la cartera de hoy.
        await expect(proc.processRow(baja() as any, ctx)).resolves.toBeUndefined();

        expect(deudorUpdate).not.toHaveBeenCalled();
        expect(pagoCreate).not.toHaveBeenCalled();
        expect((proc as any).bajasSinMatchCount).toBe(1);
    });

    it('si el cliente está cargado pero no tiene esa cuota, avisa y sigue', async () => {
        const proc = new MultiarchivoProcessor();
        const { ctx, prisma, deudorUpdate } = makeCtx();
        prisma.deudor.findFirst.mockResolvedValue({ id: 321 });
        prisma.factura.findUnique.mockResolvedValue(null);

        await expect(proc.processRow(baja() as any, ctx)).resolves.toBeUndefined();

        expect(deudorUpdate).not.toHaveBeenCalled();
        expect((proc as any).bajasSinMatchCount).toBe(1);
    });

    it('rechaza la baja sin número de factura', () => {
        const proc = new MultiarchivoProcessor();
        expect(proc.validateRow!({ _tipo: 'BAJA', nroCliente: '1' } as any, {} as any).valid).toBe(false);
        expect(proc.validateRow!(baja() as any, {} as any).valid).toBe(true);
    });
});

describe('MultiarchivoProcessor — contactos del codeudor', () => {
    it('guarda la relacion para distinguir al codeudor del titular', async () => {
        const { ctx, contactoCreateMany } = makeCtx();

        await new MultiarchivoProcessor().processRow(caso({
            _blocks: [
                { entity: 'FACTURA', data: { nroFactura: 'C-1', importe: 1, contrato: 'C', detalle: '' } },
                { entity: 'CONTACTO', data: { tipo: 'telefono', valor: '3416693578' } },
                { entity: 'CONTACTO', data: { tipo: 'telefono', valor: '3704006898', relacion: 'CODEUDOR' } },
                { entity: 'CONTACTO', data: { tipo: 'email', valor: 'co@mail.com', relacion: 'CODEUDOR' } },
            ],
        }) as any, ctx);

        const insertados = contactoCreateMany.mock.calls[0][0].data;
        // Llamar a un codeudor creyendo que es el titular es un problema real de gestión.
        expect(insertados.find((c: any) => c.valor === 'co@mail.com').relacion).toBe('CODEUDOR');
        expect(insertados.find((c: any) => c.valor.endsWith('6693578')).relacion).toBeUndefined();
        // `subtipo` es el tipo de línea de ENACOM: no se lo pisa con la relación.
        expect(insertados.every((c: any) => c.subtipo === undefined)).toBe(true);
    });
});

describe('MultiarchivoProcessor — desasignación de ausentes', () => {
    /** Cartera de 3 casos: el 777 viene hoy en el archivo, el 100 y el 200 no. */
    const cartera = [
        { id: 777, estadoGestionId: GESTION_EN_TRAMITE, estadoSituacionId: null },
        { id: 100, estadoGestionId: GESTION_EN_TRAMITE, estadoSituacionId: null },
        { id: 200, estadoGestionId: GESTION_DEFAULT, estadoSituacionId: null },
    ];

    it('está APAGADA por default: sin config no se toca a nadie', async () => {
        const proc = new MultiarchivoProcessor();
        const { ctx, prisma, deudorUpdate } = makeCtx();          // sin accionAusente
        prisma.deudor.findMany.mockResolvedValue(cartera);

        await proc.processRow(caso() as any, ctx);
        await proc.afterAll!(ctx);

        expect(desasignaciones(deudorUpdate)).toHaveLength(0);
        // Ni siquiera va a buscar la cartera: es la ruta barata para las carteras que no lo usan.
        expect(prisma.deudor.findMany).not.toHaveBeenCalled();
    });

    it('desasigna solo a los que no vinieron, guardando su estado previo', async () => {
        const proc = new MultiarchivoProcessor();
        const { ctx, prisma, deudorUpdate } = makeCtxDesasignando();
        prisma.deudor.findMany.mockResolvedValue(cartera);

        await proc.processRow(caso() as any, ctx);                 // crea el 777
        await proc.afterAll!(ctx);

        const hechas = desasignaciones(deudorUpdate);
        expect(hechas.map((u: any) => u.where.id).sort()).toEqual([100, 200]);
        // El previo se guarda para poder revertir: sin esto la re-asignación no sabría a qué volver.
        expect(hechas.find((u: any) => u.where.id === 100).data.estadoGestionPrevioAId).toBe(GESTION_EN_TRAMITE);
        expect(hechas.find((u: any) => u.where.id === 200).data.estadoGestionPrevioAId).toBe(GESTION_DEFAULT);
    });

    it('acota la cartera a la plantilla del import, no a toda la empresa', async () => {
        const proc = new MultiarchivoProcessor();
        const { ctx, prisma } = makeCtxDesasignando();
        prisma.deudor.findMany.mockResolvedValue(cartera);

        await proc.processRow(caso() as any, ctx);
        await proc.afterAll!(ctx);

        // Una empresa puede tener otras carteras cargadas por otras plantillas: si el universo fuera
        // `empresaId` a secas, este import las desasignaría de rebote.
        expect(prisma.deudor.findMany.mock.calls[0][0].where).toEqual({
            empresaId: 87,
            remesa: { plantillaId: 7 },
        });
    });

    it('NO toca a los cancelados ni a los ya dados de baja ni a los ya desasignados', async () => {
        const proc = new MultiarchivoProcessor();
        const { ctx, prisma, deudorUpdate } = makeCtxDesasignando();
        prisma.deudor.findMany.mockResolvedValue([
            { id: 100, estadoGestionId: GESTION_EN_TRAMITE, estadoSituacionId: SIT_050 },  // cancelado
            { id: 200, estadoGestionId: GES_090, estadoSituacionId: null },                // dado de baja
            { id: 300, estadoGestionId: GES_094, estadoSituacionId: null },                // ya desasignado
            { id: 400, estadoGestionId: GESTION_EN_TRAMITE, estadoSituacionId: null },     // este sí
        ]);

        await proc.processRow(caso() as any, ctx);
        await proc.afterAll!(ctx);

        expect(desasignaciones(deudorUpdate).map((u: any) => u.where.id)).toEqual([400]);
    });

    it('ABORTA si ninguna fila del archivo matcheó la cartera', async () => {
        // Es el guard del incidente del 2026-07-21: un batch fallido desasignó 342.792 deudores.
        const proc = new MultiarchivoProcessor();
        const { ctx, prisma, deudorUpdate } = makeCtxDesasignando();
        prisma.deudor.findMany.mockResolvedValue(cartera);

        await proc.afterAll!(ctx);                                 // sin procesar ningún caso

        expect(desasignaciones(deudorUpdate)).toHaveLength(0);
        expect(prisma.deudor.findMany).not.toHaveBeenCalled();
    });

    it('ABORTA si la remesa no tiene plantilla (no se puede acotar la cartera)', async () => {
        const proc = new MultiarchivoProcessor();
        const { ctx, prisma, deudorUpdate } = makeCtxDesasignando({ plantillaId: undefined });
        prisma.deudor.findMany.mockResolvedValue(cartera);

        await proc.processRow(caso() as any, ctx);
        await proc.afterAll!(ctx);

        expect(desasignaciones(deudorUpdate)).toHaveLength(0);
        expect(prisma.deudor.findMany).not.toHaveBeenCalled();
    });

    it('modo degradado: sin GES-094 seedeado no desasigna a nadie', async () => {
        const proc = new MultiarchivoProcessor();
        const { ctx, prisma, deudorUpdate } = makeCtxDesasignando();
        prisma.parametro.findUnique.mockImplementation(({ where }: any) =>
            Promise.resolve(where.clave === 'GES-090' ? { id: GES_090 } : null),
        );
        prisma.deudor.findMany.mockResolvedValue(cartera);

        await proc.processRow(caso() as any, ctx);
        await proc.afterAll!(ctx);

        expect(desasignaciones(deudorUpdate)).toHaveLength(0);
    });

    it('una baja NO cuenta como presente: el caso ausente igual se desasigna', async () => {
        // Que le hayan bajado una cuota no significa que el cedente lo siga asignando.
        const proc = new MultiarchivoProcessor();
        const { ctx, prisma, deudorUpdate } = makeCtxDesasignando();
        // 1ª búsqueda (el caso del archivo): no existe → se crea el 777.
        // 2ª búsqueda (la baja): resuelve al 100, que NO vino en el archivo de hoy.
        prisma.deudor.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 100 });
        prisma.factura.findUnique.mockResolvedValue({ id: 11, deudorId: 100, importe: 500 });
        prisma.factura.count.mockResolvedValue(2);

        await proc.processRow(caso() as any, ctx);                 // presente: 777
        await proc.processRow(baja({ nroCliente: '999' }) as any, ctx); // toca al 100, pero no vino
        prisma.deudor.findMany.mockResolvedValue(cartera);
        await proc.afterAll!(ctx);

        expect(desasignaciones(deudorUpdate).map((u: any) => u.where.id).sort()).toEqual([100, 200]);
    });

    it('registra la desasignación en la auditoría con la proporción de la cartera', async () => {
        const proc = new MultiarchivoProcessor();
        const { ctx, prisma } = makeCtxDesasignando();
        prisma.deudor.findMany.mockResolvedValue(cartera);

        await proc.processRow(caso() as any, ctx);
        await proc.afterAll!(ctx);

        const evento = (ctx.auditoria.log as jest.Mock).mock.calls
            .map((c: any) => c[0])
            .find((e: any) => e.resumen?.includes('Desasignación masiva'));
        expect(evento.data).toMatchObject({ count: 2, cartera: 3, enArchivo: 1, proporcion: 67 });
    });
});

describe('MultiarchivoProcessor — re-asignación', () => {
    it('el caso que vuelve al archivo sale de GES-094 y recupera su estado anterior', async () => {
        const proc = new MultiarchivoProcessor();
        const { ctx, prisma, deudorUpdate } = makeCtxDesasignando();
        prisma.deudor.findFirst.mockResolvedValue({
            id: 555, nombre: 'X', documento: '27179395431', camposAdicionales: null,
            estadoGestionId: GES_094, estadoGestionPrevioAId: GESTION_EN_TRAMITE, estadoSituacionId: null,
        });

        await proc.processRow(caso() as any, ctx);

        const update = deudorUpdate.mock.calls.map((c: any) => c[0]).find((u: any) => 'estadoGestionId' in u.data);
        expect(update.data).toMatchObject({
            estadoGestionId: GESTION_EN_TRAMITE,
            estadoGestionPrevioAId: null,
        });
    });

    it('cae al default de la plantilla si el estado previo ya no existe', async () => {
        const proc = new MultiarchivoProcessor();
        const { ctx, prisma, deudorUpdate } = makeCtxDesasignando();
        prisma.deudor.findFirst.mockResolvedValue({
            id: 555, nombre: 'X', documento: '27179395431', camposAdicionales: null,
            estadoGestionId: GES_094, estadoGestionPrevioAId: 9999, estadoSituacionId: null,
        });

        await proc.processRow(caso() as any, ctx);

        const update = deudorUpdate.mock.calls.map((c: any) => c[0]).find((u: any) => 'estadoGestionId' in u.data);
        expect(update.data.estadoGestionId).toBe(GESTION_DEFAULT);
    });

    it('NO re-asigna a un caso cancelado', async () => {
        const proc = new MultiarchivoProcessor();
        const { ctx, prisma, deudorUpdate } = makeCtxDesasignando();
        prisma.deudor.findFirst.mockResolvedValue({
            id: 555, nombre: 'X', documento: '27179395431', camposAdicionales: null,
            estadoGestionId: GES_094, estadoGestionPrevioAId: GESTION_EN_TRAMITE, estadoSituacionId: SIT_050,
        });

        await proc.processRow(caso() as any, ctx);

        expect(deudorUpdate.mock.calls.filter((c: any) => 'estadoGestionId' in c[0].data)).toHaveLength(0);
    });

    it('no toca la gestión del caso que ya estaba activo', async () => {
        const proc = new MultiarchivoProcessor();
        const { ctx, prisma, deudorUpdate } = makeCtxDesasignando();
        prisma.deudor.findFirst.mockResolvedValue({
            id: 555, nombre: 'SINCHICAY YMELDA VIVIAN', documento: '27179395431',
            camposAdicionales: { localidad: 'CORDOBA' },
            estadoGestionId: GESTION_EN_TRAMITE, estadoGestionPrevioAId: null, estadoSituacionId: null,
        });

        await proc.processRow(caso() as any, ctx);

        expect(deudorUpdate.mock.calls.filter((c: any) => 'estadoGestionId' in c[0].data)).toHaveLength(0);
    });

    it('con la desasignación apagada, no hace ninguna query de parámetros de más', async () => {
        const proc = new MultiarchivoProcessor();
        const { ctx, prisma } = makeCtx();                          // sin accionAusente
        prisma.deudor.findFirst.mockResolvedValue({
            id: 555, nombre: 'X', documento: '27179395431', camposAdicionales: null,
            estadoGestionId: GES_094, estadoGestionPrevioAId: GESTION_EN_TRAMITE, estadoSituacionId: null,
        });

        await proc.processRow(caso() as any, ctx);

        // La cuenta 87 comparte esta base y no usa desasignación: no debe pagar el costo.
        expect(prisma.parametro.findUnique).not.toHaveBeenCalledWith(
            expect.objectContaining({ where: { clave: 'GES-094' } }),
        );
    });
});

describe('MultiarchivoProcessor — domicilio', () => {
    const conDireccion = (extra: Record<string, any> = {}) => caso({
        _blocks: [
            { entity: 'FACTURA', data: { nroFactura: 'C-1', importe: 1, contrato: 'C', detalle: '' } },
            {
                entity: 'CONTACTO',
                data: {
                    tipo: 'direccion', direccion_calle: 'AV SIEMPREVIVA', direccion_numero: '742',
                    direccion_cp: '3600', direccion_localidad: 'FORMOSA', direccion_provincia: 'FORMOSA',
                    ...extra,
                },
            },
        ],
    });

    it('carga el domicilio como contacto de tipo direccion', async () => {
        const { ctx, contactoCreateMany } = makeCtx();

        await new MultiarchivoProcessor().processRow(conDireccion() as any, ctx);

        const insertados = contactoCreateMany.mock.calls[0][0].data;
        const dir = insertados.find((c: any) => c.tipo === 'direccion');
        // El bloque no trae `valor` sino sus partes: el helper canónico arma el texto.
        expect(dir.valor).toBe('AV SIEMPREVIVA 742, FORMOSA, FORMOSA (CP 3600)');
        // Sin `validarDomicilios` no se llama a Georef, así que queda sin verificar.
        expect(dir.validado).toBe(false);
    });

    it('marca la dirección del codeudor', async () => {
        const { ctx, contactoCreateMany } = makeCtx();

        await new MultiarchivoProcessor().processRow(conDireccion({ relacion: 'CODEUDOR' }) as any, ctx);

        expect(contactoCreateMany.mock.calls[0][0].data.find((c: any) => c.tipo === 'direccion').relacion)
            .toBe('CODEUDOR');
    });

    it('anexa piso y departamento al número', async () => {
        const { ctx, contactoCreateMany } = makeCtx();

        await new MultiarchivoProcessor().processRow(
            conDireccion({ direccion_numero: '849 Piso 4 Dpto A' }) as any, ctx,
        );

        expect(contactoCreateMany.mock.calls[0][0].data.find((c: any) => c.tipo === 'direccion').valor)
            .toContain('849 Piso 4 Dpto A');
    });
});

describe('MultiarchivoProcessor — consolidación final', () => {
    it('consolida los deudores tocados, estén en la remesa de hoy o en una previa', async () => {
        const proc = new MultiarchivoProcessor();
        const { ctx, prisma } = makeCtx();

        await proc.processRow(caso() as any, ctx);          // alta → id 777 (remesa de hoy)
        prisma.deudor.findFirst.mockResolvedValue({ id: 321 });
        prisma.factura.findUnique.mockResolvedValue({ id: 11, deudorId: 321, importe: 100 });
        prisma.factura.count.mockResolvedValue(1);
        await proc.processRow(baja() as any, ctx);          // baja → id 321 (remesa vieja)

        await proc.afterAll!(ctx);

        const scope = (ctx.consolidacion.consolidar as jest.Mock).mock.calls[0][0];
        expect(scope.tipo).toBe('DEUDORES');
        expect([...scope.deudorIds].sort()).toEqual([321, 777]);
        expect(ctx.promesas.cerrarCumplidas).toHaveBeenCalledWith([321]);
    });
});
