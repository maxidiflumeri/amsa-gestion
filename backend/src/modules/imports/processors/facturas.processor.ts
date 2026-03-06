// processors/facturas.processor.ts
import { ICategoryProcessor, MappedRow, ProcessContext, RowValidationResult } from './processor.interface';
import { Prisma } from '@prisma/client';

export class FacturasProcessor implements ICategoryProcessor {
    readonly category = 'FACTURAS';

    validateRow(row: MappedRow, _ctx: ProcessContext): RowValidationResult {
        const nroCliente = String(row.nro_cliente ?? '').trim();
        if (!nroCliente) {
            return { valid: false, error: 'nro_cliente no encontrado en factura' };
        }
        if (!row.nroFactura) {
            return { valid: false, error: 'Campo requerido faltante: nroFactura' };
        }
        return { valid: true };
    }

    async processRow(row: MappedRow, ctx: ProcessContext): Promise<void> {
        const nroCliente = String(row.nro_cliente ?? '').trim();
        if (!nroCliente) throw new Error('nro_cliente no encontrado en factura');

        // Buscar deudor en la remesa de origen (la de deudores)
        const targetRemesaId = ctx.remesaOrigenId ?? ctx.remesaId;

        const rows = await ctx.prisma.$queryRaw<{ id: number }[]>(
            Prisma.sql`
                SELECT id
                FROM deudor
                WHERE empresaId = ${ctx.empresaId}
                  AND remesaId = ${targetRemesaId}
                  AND JSON_UNQUOTE(JSON_EXTRACT(camposAdicionales, '$.nro_cliente')) = ${nroCliente}
                LIMIT 1
            `,
        );

        if (!rows.length) {
            throw new Error(`Deudor no encontrado (nro_cliente=${nroCliente})`);
        }

        const deudor = rows[0];

        await ctx.prisma.factura.upsert({
            where: {
                deudorId_nroFactura: {
                    deudorId: deudor.id,
                    nroFactura: String(row.nroFactura),
                },
            },
            create: {
                deudorId: deudor.id,
                nroFactura: String(row.nroFactura),
                importe: row.importe ?? 0,
                fechaEmision: row.fechaEmision ?? new Date(),
                vencimiento: row.vencimiento ?? new Date(),
            },
            update: {
                importe: row.importe ?? undefined,
                fechaEmision: row.fechaEmision ?? undefined,
                vencimiento: row.vencimiento ?? undefined,
            },
        });
    }
}
