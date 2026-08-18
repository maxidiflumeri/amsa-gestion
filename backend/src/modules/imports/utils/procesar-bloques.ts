import { ProcessContext } from '../processors/processor.interface';
import { ContextoCaso, prepararContactoImport } from './contacto-import';

/**
 * Procesamiento común de "bloques repetitivos" (mapping.blocks → row._blocks).
 *
 * Cada bloque tiene un `entity` (FACTURA o CONTACTO) y su `data`. Esta función se
 * llama desde CUALQUIER processor después de resolver el deudor, para que los
 * bloques se carguen sin importar la categoría de la importación (deudores,
 * contactos, enriquecimiento, pagos, facturas, etc.).
 */

type Bloque = { entity: string; data: Record<string, any> };

const ENTITIES_FACTURA = new Set(['FACTURA', 'MIXTO', 'DEUDORES_Y_FACTURAS']);

function parseFloatSafe(val: any): number | undefined {
    if (val === null || val === undefined || val === '') return undefined;
    if (typeof val === 'number') return val;
    let s = String(val).replace(/[^\d.,-]/g, '');
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma > lastDot) {
        s = s.replace(/\./g, '').replace(/,/g, '.');
    } else if (lastDot > lastComma) {
        s = s.replace(/,/g, '');
    } else if (lastComma !== -1) {
        s = s.replace(/,/g, '.');
    }
    const num = parseFloat(s);
    return isNaN(num) ? 0 : num;
}

function parseIntSafe(val: any): number | undefined {
    if (val === null || val === undefined || val === '') return undefined;
    const num = parseInt(String(val).replace(/[^\d-]/g, ''), 10);
    return isNaN(num) ? 0 : num;
}

function parseDateSafe(val: any): Date | undefined {
    if (!val) return undefined;
    const d = new Date(val);
    return isNaN(d.getTime()) ? undefined : d;
}

async function upsertFacturaBloque(deudorId: number, data: any, ctx: ProcessContext) {
    await ctx.prisma.factura.upsert({
        where: { deudorId_nroFactura: { deudorId, nroFactura: String(data.nroFactura) } },
        create: {
            deudorId,
            nroFactura: String(data.nroFactura),
            importe: parseFloatSafe(data.importe) ?? 0,
            fechaEmision: parseDateSafe(data.fechaEmision) ?? new Date(),
            vencimiento: parseDateSafe(data.vencimiento) ?? new Date(),
            estado: data.estado ?? 'PENDIENTE',
        },
        update: {
            importe: parseFloatSafe(data.importe) ?? undefined,
            fechaEmision: parseDateSafe(data.fechaEmision) ?? undefined,
            vencimiento: parseDateSafe(data.vencimiento) ?? undefined,
            estado: data.estado ?? undefined,
        },
    });
}

function prepararContactoBloque(
    data: any,
    ctx: ProcessContext,
    contextoCaso: ContextoCaso,
) {
    return prepararContactoImport(
        {
            tipo: data.tipo,
            valor: data.valor,
            direccion_calle: data.direccion_calle,
            direccion_numero: data.direccion_numero,
            direccion_cp: data.direccion_cp,
            direccion_localidad: data.direccion_localidad,
            direccion_provincia: data.direccion_provincia,
        },
        ctx.validarDomicilios,
        contextoCaso,
    );
}

async function upsertContactoBloque(
    deudorId: number,
    data: any,
    prep: { tipo: string; valor: string; validado: boolean },
    ctx: ProcessContext,
) {
    await ctx.prisma.contacto.upsert({
        where: { deudorId_tipo_valor: { deudorId, tipo: prep.tipo, valor: prep.valor } },
        create: {
            deudorId,
            tipo: prep.tipo,
            valor: prep.valor,
            subtipo: data.subtipo ?? null,
            prioridad: parseIntSafe(data.prioridad) ?? 0,
            validado: prep.validado,
        },
        update: {
            subtipo: data.subtipo ?? undefined,
            prioridad: parseIntSafe(data.prioridad) ?? undefined,
            validado: prep.validado,
        },
    });
}

/**
 * Procesa los bloques repetitivos de una fila, asociándolos al deudor indicado.
 * - FACTURA (o MIXTO/DEUDORES_Y_FACTURAS): requiere nroFactura.
 * - CONTACTO: requiere valor o dirección estructurada.
 */
export async function procesarBloquesDeudor(
    deudorId: number,
    blocks: Bloque[] | undefined,
    ctx: ProcessContext,
): Promise<void> {
    if (!blocks?.length) return;

    // Se arma UNA vez para toda la fila: los teléfonos se ayudan entre sí y comparten el domicilio.
    const contextoCaso = contextoDelCaso(blocks);

    // Un mismo dato puede venir en dos bloques de la MISMA fila: en AYSA el domicilio de servicio y
    // el de facturación coinciden en el 68% de los casos, y los siete teléfonos repiten números.
    // Como la clave del contacto es (deudor, tipo, valor), el segundo bloque no crea otra fila: le
    // pisa `subtipo` y `prioridad` a la primera. El domicilio que es los dos terminaba rotulado
    // FACTURACION y ordenado abajo, que es justo al revés de lo que pide la gestión.
    // Gana el primer bloque que aportó el dato: el orden de los bloques en la plantilla es la
    // prioridad que declaró el operador.
    const yaCargados = new Set<string>();

    for (const b of blocks) {
        if (!b?.entity || !b.data) continue;
        if (ENTITIES_FACTURA.has(b.entity) && b.data.nroFactura) {
            await upsertFacturaBloque(deudorId, b.data, ctx);
        } else if (b.entity === 'CONTACTO') {
            const tieneValor = !!b.data.valor;
            const tieneDireccion = !!(
                b.data.direccion_calle ||
                b.data.direccion_numero ||
                b.data.direccion_localidad ||
                b.data.direccion_provincia
            );
            if (!tieneValor && !tieneDireccion) continue;

            const prep = await prepararContactoBloque(b.data, ctx, contextoCaso);
            if (!prep) continue;

            // La clave es la del contacto ya normalizado: dos escrituras distintas del mismo
            // teléfono (`1564435038` y `+541564435038`) son el mismo dato recién después de pasar
            // por `prepararContactoImport`.
            const clave = `${prep.tipo}\u0000${prep.valor}`;
            if (yaCargados.has(clave)) continue;
            yaCargados.add(clave);

            await upsertContactoBloque(deudorId, b.data, prep, ctx);
        }
    }
}

/**
 * Junta de los bloques de la fila lo que sirve para normalizar los teléfonos que vienen sin código
 * de área: los otros teléfonos del mismo caso y el código postal del domicilio.
 *
 * Es lo que permite resolver un `1564435038` suelto: si el caso trae además un `1142407390`, la
 * característica es 11. Ver `normalizarTelefonoArgentino`.
 */
export function contextoDelCaso(blocks: Bloque[] | undefined): ContextoCaso {
    if (!blocks?.length) return { telefonos: [] };
    return contextoDeBloques(blocks);
}

function contextoDeBloques(blocks: Bloque[]): ContextoCaso {
    const telefonos: string[] = [];
    let codigoPostal: string | undefined;

    for (const b of blocks) {
        if (b?.entity !== 'CONTACTO' || !b.data) continue;
        const tipo = String(b.data.tipo ?? '').toLowerCase();
        if ((tipo === 'telefono' || tipo === 'celular' || tipo === 'whatsapp') && b.data.valor) {
            telefonos.push(String(b.data.valor));
        }
        // Del domicilio alcanza con el primero que traiga CP: los dos de un mismo caso (servicio y
        // facturación) están casi siempre en la misma zona.
        if (!codigoPostal && b.data.direccion_cp) codigoPostal = String(b.data.direccion_cp);
    }

    return { telefonos, codigoPostal };
}
