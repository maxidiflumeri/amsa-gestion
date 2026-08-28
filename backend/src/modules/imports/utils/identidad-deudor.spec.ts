/**
 * Identidad del caso dentro de la remesa.
 *
 * El bug que motiva estos tests: en Telecom Personal un mismo DNI tiene la cuenta madre (`…0001`)
 * y las hijas (`…0002`, `…0003`), cada una con su deuda. Con la identidad clavada en el documento,
 * la segunda y la tercera fila no creaban un caso: hacían `update` sobre el primero, así que
 * ganaba la última del archivo. En el CA del 27/05 se perdían 119 de 19.439 cuentas, y después
 * TODAS sus facturas y pagos fallaban con "Deudor no encontrado".
 */
import { ProcessContext } from '../processors/processor.interface';
import { claveIdentidad, numeroDeCasos, upsertDeudorPorIdentidad } from './identidad-deudor';

/** Prisma mockeado con una "tabla" deudor en memoria. */
function makeCtx(identidad: 'DOCUMENTO' | 'NRO_CLIENTE') {
    const filas: any[] = [];
    let seq = 0;

    const findFirst = jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(
            filas.find(
                (f) =>
                    f.empresaId === where.empresaId &&
                    f.remesaId === where.remesaId &&
                    (where.documento === undefined || f.documento === where.documento) &&
                    (where.nroCliente === undefined || f.nroCliente === where.nroCliente),
            ) ?? null,
        ),
    );
    const create = jest.fn().mockImplementation(({ data }: any) => {
        const fila = { id: ++seq, ...data };
        filas.push(fila);
        return Promise.resolve({ id: fila.id });
    });
    const update = jest.fn().mockImplementation(({ where, data }: any) => {
        const fila = filas.find((f) => f.id === where.id);
        for (const [k, v] of Object.entries(data)) if (v !== undefined) fila[k] = v;
        return Promise.resolve(fila);
    });

    const ctx = {
        prisma: { deudor: { findFirst, create, update } },
        empresaId: 10,
        remesaId: 7,
        identidadDeudor: identidad,
        defaults: { estadoSituacionId: 1, estadoGestionId: 2 },
    } as unknown as ProcessContext;

    return { ctx, filas, create, update };
}

/** Las tres cuentas de Zerrizuela, tal como vienen en el CA del 27/05. */
const CUENTAS = [
    { documento: '33756285', nroCliente: '2450286211', montoTotal: 10_000 },
    { documento: '33756285', nroCliente: '2451517286', montoTotal: 20_000 },
    { documento: '33756285', nroCliente: '2455387479', montoTotal: 30_000 },
];

const fila = (c: (typeof CUENTAS)[number]) => ({
    documento: c.documento,
    nroCliente: c.nroCliente,
    nombre: 'Natalia Romina',
    apellido: 'Zerrizuela',
    montoTotal: c.montoTotal,
});

describe('identidad NRO_CLIENTE — un DNI con varias cuentas', () => {
    it('carga las tres cuentas como tres casos, no una', async () => {
        const { ctx, filas } = makeCtx('NRO_CLIENTE');

        for (const c of CUENTAS) await upsertDeudorPorIdentidad(ctx, fila(c));

        expect(filas).toHaveLength(3);
        expect(filas.map((f) => f.nroCliente)).toEqual([
            '2450286211', '2451517286', '2455387479',
        ]);
        // Cada cuenta conserva SU deuda: con la identidad por documento, las tres colapsaban en la
        // primera y el monto quedaba en 30.000 (el de la última fila del archivo).
        expect(filas.map((f) => f.montoTotal)).toEqual([10_000, 20_000, 30_000]);
    });

    it('las tres comparten el documento sin pisarse', async () => {
        const { ctx, filas } = makeCtx('NRO_CLIENTE');

        for (const c of CUENTAS) await upsertDeudorPorIdentidad(ctx, fila(c));

        expect(filas.every((f) => f.documento === '33756285')).toBe(true);
    });

    it('reimportar el mismo archivo es idempotente: actualiza, no duplica', async () => {
        const { ctx, filas, create } = makeCtx('NRO_CLIENTE');

        for (const c of CUENTAS) await upsertDeudorPorIdentidad(ctx, fila(c));
        for (const c of CUENTAS) await upsertDeudorPorIdentidad(ctx, fila(c));

        expect(filas).toHaveLength(3);
        expect(create).toHaveBeenCalledTimes(3);
    });

    it('avisa cuál es nuevo, para no reenriquecer contactos en cada corrida', async () => {
        const { ctx } = makeCtx('NRO_CLIENTE');

        const primera = await upsertDeudorPorIdentidad(ctx, fila(CUENTAS[0]));
        const segunda = await upsertDeudorPorIdentidad(ctx, fila(CUENTAS[0]));

        expect(primera.creado).toBe(true);
        expect(segunda.creado).toBe(false);
        expect(segunda.id).toBe(primera.id);
    });

    it('una fila sin nro de cliente cae al documento en vez de crear un caso suelto por fila', async () => {
        const { ctx, filas } = makeCtx('NRO_CLIENTE');

        await upsertDeudorPorIdentidad(ctx, { ...fila(CUENTAS[0]), nroCliente: null });
        await upsertDeudorPorIdentidad(ctx, { ...fila(CUENTAS[1]), nroCliente: null });

        expect(filas).toHaveLength(1);
    });

    it('completa el documento cuando el cedente lo manda en una bajada posterior', async () => {
        const { ctx, filas } = makeCtx('NRO_CLIENTE');

        await upsertDeudorPorIdentidad(ctx, {
            ...fila(CUENTAS[0]),
            documento: 'SIN-DNI-2450286211',
        });
        await upsertDeudorPorIdentidad(ctx, fila(CUENTAS[0]));

        expect(filas).toHaveLength(1);
        expect(filas[0].documento).toBe('33756285');
    });
});

describe('identidad DOCUMENTO — el comportamiento de siempre', () => {
    it('agrupa las tres cuentas del mismo DNI en un solo caso', async () => {
        const { ctx, filas } = makeCtx('DOCUMENTO');

        for (const c of CUENTAS) await upsertDeudorPorIdentidad(ctx, fila(c));

        expect(filas).toHaveLength(1);
        // Gana la última fila del archivo, igual que antes.
        expect(filas[0].nroCliente).toBe('2455387479');
    });

    it('es el default: una plantilla sin el campo no cambia de comportamiento', async () => {
        const { ctx, filas } = makeCtx('DOCUMENTO');
        delete (ctx as any).identidadDeudor;

        for (const c of CUENTAS) await upsertDeudorPorIdentidad(ctx, fila(c));

        expect(filas).toHaveLength(1);
    });
});

describe('claveIdentidad', () => {
    it('usa el nro de cliente cuando la plantilla lo pide y la fila lo trae', () => {
        expect(claveIdentidad('NRO_CLIENTE', { documento: '123', nroCliente: '999' }))
            .toEqual({ campo: 'nroCliente', valor: '999' });
    });

    it('cae al documento si la fila no trae nro de cliente', () => {
        expect(claveIdentidad('NRO_CLIENTE', { documento: '123', nroCliente: null }))
            .toEqual({ campo: 'documento', valor: '123' });
    });

    it('con identidad por documento ignora el nro de cliente', () => {
        expect(claveIdentidad('DOCUMENTO', { documento: '123', nroCliente: '999' }))
            .toEqual({ campo: 'documento', valor: '123' });
    });
});

describe('numeroDeCasos — cuántos casos produce un archivo', () => {
    const filasCA = [
        { documento: '33756285', nroCliente: '2450286211' },
        { documento: '33756285', nroCliente: '2451517286' },
        { documento: '33756285', nroCliente: '2455387479' },
        { documento: '38245130', nroCliente: '2215100780' },
    ];

    it('por documento cuenta personas', () => {
        expect(numeroDeCasos('DOCUMENTO', filasCA)).toBe(2);
    });

    it('por nro de cliente cuenta cuentas', () => {
        expect(numeroDeCasos('NRO_CLIENTE', filasCA)).toBe(4);
    });
});
