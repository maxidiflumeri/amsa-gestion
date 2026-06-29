import { ProcessContext } from '../processors/processor.interface';
import { prepararContactoImport } from './contacto-import';

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

async function upsertContactoBloque(deudorId: number, data: any, ctx: ProcessContext) {
    const prep = await prepararContactoImport(
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
    );
    if (!prep) return;
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
            if (tieneValor || tieneDireccion) {
                await upsertContactoBloque(deudorId, b.data, ctx);
            }
        }
    }
}
