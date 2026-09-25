import { ProcessContext } from '../processors/processor.interface';

/**
 * Remesas donde se buscan los casos de un archivo que se aplica sobre casos ya cargados. Si el
 * operador eligió varias remesas origen, son esas; si no, la remesa origen única y, en su defecto,
 * la del propio archivo.
 */
export function remesasOrigenDelContexto(ctx: ProcessContext): number[] {
    return ctx.remesaOrigenIds?.length ? ctx.remesaOrigenIds : [ctx.remesaOrigenId ?? ctx.remesaId];
}

/**
 * Casos a los que va un contacto de CONTACTOS o ENRIQUECIMIENTO.
 *
 * El archivo del cedente puede cubrir varias asignaciones —las N remesas en que se dividió una
 * carga—, así que el caso se busca en cualquiera de las remesas elegidas. A diferencia de una
 * factura, un teléfono o un mail es de la **persona**: si está en dos de las remesas elegidas, el
 * contacto se carga en todos sus casos, no solo en uno.
 *
 * Se busca primero por documento y, si no aparece, por Nº de cliente (el orden de siempre).
 */
export async function deudoresDelContacto(
    documento: string,
    nroCliente: string,
    ctx: ProcessContext,
): Promise<number[]> {
    const base = { empresaId: ctx.empresaId, remesaId: { in: remesasOrigenDelContexto(ctx) } };

    if (documento) {
        const porDocumento = await ctx.prisma.deudor.findMany({
            where: { ...base, documento },
            select: { id: true },
            orderBy: { id: 'asc' },
        });
        if (porDocumento.length) return porDocumento.map((d) => d.id);
    }

    if (nroCliente) {
        const porNroCliente = await ctx.prisma.deudor.findMany({
            where: { ...base, nroCliente },
            select: { id: true },
            orderBy: { id: 'asc' },
        });
        return porNroCliente.map((d) => d.id);
    }

    return [];
}
