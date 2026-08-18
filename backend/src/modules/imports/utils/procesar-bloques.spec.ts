import { procesarBloquesDeudor } from './procesar-bloques';
import { ProcessContext } from '../processors/processor.interface';

/**
 * El dato repetido en dos bloques de la misma fila.
 *
 * La clave del contacto es `(deudor, tipo, valor)`, así que el segundo bloque no crea otra fila:
 * hace `update` sobre la primera. Sin dedup, el domicilio de AYSA que es a la vez el de servicio y
 * el de facturación —el 68% de la cartera— terminaba rotulado FACTURACION y ordenado abajo.
 */

type Upsert = { where: any; create: any; update: any };

function ctxFalso() {
    const upserts: Upsert[] = [];
    const ctx = {
        prisma: {
            contacto: {
                upsert: jest.fn(async (args: Upsert) => {
                    upserts.push(args);
                    return {};
                }),
            },
        },
        validarDomicilios: false,
    } as unknown as ProcessContext;
    return { ctx, upserts };
}

const bloqueDireccion = (subtipo: string, prioridad: string, calle: string) => ({
    entity: 'CONTACTO',
    data: {
        tipo: 'direccion',
        subtipo,
        prioridad,
        direccion_calle: calle,
        direccion_numero: '1234',
        direccion_cp: 'B1878',
        direccion_localidad: 'QUILMES',
    },
});

const bloqueTelefono = (valor: string) => ({
    entity: 'CONTACTO',
    data: { tipo: 'telefono', valor },
});

describe('procesarBloquesDeudor — el mismo dato en dos bloques de la fila', () => {
    it('el domicilio que es servicio y facturación queda rotulado SERVICIO, que es el primer bloque', async () => {
        const { ctx, upserts } = ctxFalso();

        await procesarBloquesDeudor(
            7,
            [
                bloqueDireccion('SERVICIO', '1', 'NOMEOLVIDES'),
                bloqueDireccion('FACTURACION', '2', 'NOMEOLVIDES'),
            ],
            ctx,
        );

        expect(upserts).toHaveLength(1);
        expect(upserts[0].create.subtipo).toBe('SERVICIO');
        expect(upserts[0].create.prioridad).toBe(1);
    });

    it('cuando los dos domicilios son distintos se cargan los dos, cada uno con su rótulo', async () => {
        const { ctx, upserts } = ctxFalso();

        await procesarBloquesDeudor(
            7,
            [
                bloqueDireccion('SERVICIO', '1', 'NOMEOLVIDES'),
                bloqueDireccion('FACTURACION', '2', 'LARRAÑAGA'),
            ],
            ctx,
        );

        expect(upserts).toHaveLength(2);
        expect(upserts.map((u) => u.create.subtipo)).toEqual(['SERVICIO', 'FACTURACION']);
        expect(upserts.map((u) => u.create.prioridad)).toEqual([1, 2]);
    });

    it('el mismo teléfono en dos columnas se guarda una sola vez', async () => {
        const { ctx, upserts } = ctxFalso();

        await procesarBloquesDeudor(
            7,
            [bloqueTelefono('1142407390'), bloqueTelefono('1142407390'), bloqueTelefono('1142407391')],
            ctx,
        );

        expect(upserts).toHaveLength(2);
    });

    it('dos escrituras del mismo número son el mismo dato: la dedup mira el valor ya normalizado', async () => {
        const { ctx, upserts } = ctxFalso();

        // El cedente manda el mismo teléfono en formato local y con característica.
        await procesarBloquesDeudor(
            7,
            [bloqueTelefono('+541142407390'), bloqueTelefono('42407390')],
            ctx,
        );

        expect(upserts).toHaveLength(1);
        expect(upserts[0].where.deudorId_tipo_valor.valor).toBe('+541142407390');
    });

    it('el bloque sin dato no se carga ni bloquea al siguiente', async () => {
        const { ctx, upserts } = ctxFalso();

        await procesarBloquesDeudor(
            7,
            [bloqueTelefono(''), bloqueTelefono('1142407390')],
            ctx,
        );

        expect(upserts).toHaveLength(1);
    });
});
