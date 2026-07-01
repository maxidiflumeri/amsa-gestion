// utils/monto-facturas.ts
import { Prisma } from '@prisma/client';
import { ProcessContext } from '../processors/processor.interface';

const CHUNK = 500;

/**
 * Recalcula `deudor.montoTotal` a partir de la suma de sus facturas, según el modo
 * configurado en la plantilla (`ctx.montoDeudorDesdeFacturas`), y luego consolida la
 * situación/saldo de los deudores tocados.
 *
 * - `NO`: no hace nada (el importe lo trae el archivo de deudores).
 * - `SI_VACIO`: solo completa el importe de los deudores que quedaron en null/0.
 * - `SIEMPRE`: pisa `montoTotal` con la suma de facturas.
 *
 * Idempotente: usa una suma agregada (`SELECT SUM(...)`) contra la tabla `factura`,
 * no incrementos, así reimportar el mismo archivo produce el mismo resultado.
 * Debe llamarse desde el `afterAll` del processor con los deudores tocados en el batch.
 */
export async function recalcularMontoTotalDesdeFacturas(
    ctx: ProcessContext,
    deudorIds: number[],
): Promise<void> {
    if (ctx.montoDeudorDesdeFacturas === 'NO') return;
    if (!deudorIds.length) return;

    const soloVacio =
        ctx.montoDeudorDesdeFacturas === 'SI_VACIO'
            ? Prisma.sql`AND (d.montoTotal IS NULL OR d.montoTotal = 0)`
            : Prisma.empty;

    for (let i = 0; i < deudorIds.length; i += CHUNK) {
        const chunk = deudorIds.slice(i, i + CHUNK);
        await ctx.prisma.$executeRaw(Prisma.sql`
            UPDATE deudor d
            SET d.montoTotal = (
                SELECT COALESCE(SUM(f.importe), 0)
                FROM factura f
                WHERE f.deudorId = d.id
            )
            WHERE d.id IN (${Prisma.join(chunk)})
              AND EXISTS (SELECT 1 FROM factura f2 WHERE f2.deudorId = d.id)
              ${soloVacio}
        `);
    }

    // Reconciliar saldo/situación (por si ya existían pagos previos para estos deudores).
    // Si Σpagos == 0 el consolidador hace skip, así que en la carga inicial es un no-op barato.
    await ctx.consolidacion.consolidar({ tipo: 'DEUDORES', deudorIds });
}

/**
 * Mergea datos adicionales (extras del archivo) dentro de `deudor.camposAdicionales`
 * SIN pisar las claves que el deudor ya tenga del import de deudores.
 *
 * `extrasPorDeudor` mapea deudorId → objeto de claves/valores acumulado durante el batch.
 * Ante clave repetida gana el último valor cargado (los extras son atributos a nivel deudor
 * repetidos por fila de factura). Se llama desde el `afterAll` del processor de facturas.
 */
export async function mergeCamposAdicionalesEnDeudores(
    ctx: ProcessContext,
    extrasPorDeudor: Map<number, Record<string, any>>,
): Promise<void> {
    if (extrasPorDeudor.size === 0) return;

    const ids = [...extrasPorDeudor.keys()];
    for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        const existentes = await ctx.prisma.deudor.findMany({
            where: { id: { in: chunk } },
            select: { id: true, camposAdicionales: true },
        });

        for (const d of existentes) {
            const nuevos = extrasPorDeudor.get(d.id);
            if (!nuevos || Object.keys(nuevos).length === 0) continue;

            const base =
                d.camposAdicionales &&
                typeof d.camposAdicionales === 'object' &&
                !Array.isArray(d.camposAdicionales)
                    ? (d.camposAdicionales as Record<string, any>)
                    : {};

            await ctx.prisma.deudor.update({
                where: { id: d.id },
                data: { camposAdicionales: { ...base, ...nuevos } },
            });
        }
    }
}
