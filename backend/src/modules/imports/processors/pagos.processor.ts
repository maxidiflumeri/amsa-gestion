// processors/pagos.processor.ts
import { ICategoryProcessor, MappedRow, ProcessContext, RowValidationResult } from './processor.interface';
import { Prisma } from '@prisma/client';
import { procesarBloquesDeudor } from '../utils/procesar-bloques';

export class PagosProcessor implements ICategoryProcessor {
    readonly category = 'PAGOS';

    validateRow(row: MappedRow, _ctx: ProcessContext): RowValidationResult {
        const nroCliente = String(row.nro_cliente ?? '').trim();
        if (!nroCliente) {
            return { valid: false, error: 'nro_cliente es requerido para pagos' };
        }
        if (row.importe == null) {
            return { valid: false, error: 'Campo requerido faltante: importe' };
        }
        return { valid: true };
    }

    async processRow(row: MappedRow, ctx: ProcessContext): Promise<void> {
        const nroCliente = String(row.nro_cliente ?? '').trim();
        if (!nroCliente) throw new Error('nro_cliente es requerido para pagos');

        // Buscar deudor por nro_cliente en camposAdicionales
        const deudorRows = await ctx.prisma.$queryRaw<{ id: number }[]>(
            Prisma.sql`
                SELECT id
                FROM deudor
                WHERE empresaId = ${ctx.empresaId}
                  AND remesaId = ${ctx.remesaId}
                  AND nroCliente = ${nroCliente}
                LIMIT 1
            `,
        );

        if (!deudorRows.length) {
            throw new Error(`Deudor no encontrado para pago (nro_cliente=${nroCliente})`);
        }

        const deudor = deudorRows[0];

        // Bloques repetitivos del archivo → al deudor encontrado.
        await procesarBloquesDeudor(deudor.id, row._blocks, ctx);

        await ctx.prisma.pago.create({
            data: {
                deudorId: deudor.id,
                fecha: row.fecha ?? new Date(),
                importe: row.importe ?? 0,
                origenArchivo: row.origenArchivo ?? null,
                observacion: row.observacion ?? null,
            },
        });
    }
}
