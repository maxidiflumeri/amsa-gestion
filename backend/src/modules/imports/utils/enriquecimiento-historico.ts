// utils/enriquecimiento-historico.ts
import { ProcessContext } from '../processors/processor.interface';
import { esDocumentoPlaceholder } from './documento';

/**
 * Autoenriquecimiento de contactos desde la propia base.
 *
 * Copia al deudor recién dado de alta los contactos históricos de CUALQUIER deudor con el
 * MISMO documento (match EXACTO por DNI), en OTRA remesa — cross-empresa y cross-remesa. Así,
 * si un DNI ya estuvo alguna vez en la base con un teléfono/mail y hoy llega una asignación
 * nueva que NO lo trae, ese contacto se arrastra a la asignación nueva.
 *
 * No duplica: `skipDuplicates` sobre el unique (deudorId, tipo, valor), así que si la
 * asignación actual ya cargó ese mismo dato, no se repite. Aplica a todo tipo de contacto.
 *
 * DEBE llamarse desde TODO processor que dé de alta un deudor NUEVO (DEUDORES,
 * DEUDORES_Y_FACTURAS, ACTUALIZACIONES caso nuevo, etc.) para que el comportamiento sea
 * consistente en cualquier tipo de importación.
 *
 * Nota: el match es por string exacto de `documento`. Si el mismo DNI está guardado con
 * formatos distintos entre cargas (ej. CUIL vs DNI, espacios o ceros a la izquierda), no
 * matchea — eso se resuelve normalizando el documento en las transformaciones de la plantilla.
 *
 * @returns cantidad de contactos históricos efectivamente copiados al deudor.
 */
export async function enriquecerContactosHistoricos(
    ctx: ProcessContext,
    deudorId: number,
    documento: string | null | undefined,
): Promise<number> {
    const doc = String(documento ?? '').trim();
    // Sin DNI real (placeholder) no hay histórico que matchear todavía.
    if (!doc || esDocumentoPlaceholder(doc) || doc.startsWith('SIN_DOC')) return 0;

    const historicos = await ctx.prisma.contacto.findMany({
        where: {
            deudor: {
                documento: doc,
                // Excluimos la remesa actual para no auto-clonar lo que recién insertamos.
                remesaId: { not: ctx.remesaId },
            },
        },
        // distinct para no traer N veces el mismo teléfono/mail si apareció en varias campañas.
        distinct: ['tipo', 'valor'],
        select: { tipo: true, valor: true, subtipo: true, prioridad: true, validado: true, whatsapp: true },
    });
    if (historicos.length === 0) return 0;

    const res = await ctx.prisma.contacto.createMany({
        data: historicos.map((hc) => ({ deudorId, ...hc })),
        skipDuplicates: true,
    });
    return res.count;
}
