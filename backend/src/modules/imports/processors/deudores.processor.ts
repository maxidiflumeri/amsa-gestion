// processors/deudores.processor.ts
import { ICategoryProcessor, MappedRow, ProcessContext, RowValidationResult } from './processor.interface';
import { Prisma } from '@prisma/client';

export class DeudoresProcessor implements ICategoryProcessor {
    readonly category = 'DEUDORES';

    validateRow(row: MappedRow, _ctx: ProcessContext): RowValidationResult {
        if (!row.documento) {
            return { valid: false, error: 'Campo requerido faltante: documento' };
        }
        return { valid: true };
    }

    async processRow(row: MappedRow, ctx: ProcessContext): Promise<void> {
        await ctx.prisma.deudor.upsert({
            where: {
                empresaId_documento_remesaId: {
                    empresaId: ctx.empresaId,
                    documento: String(row.documento),
                    remesaId: ctx.remesaId,
                },
            },
            create: {
                empresaId: ctx.empresaId,
                remesaId: ctx.remesaId,
                documento: String(row.documento),
                nombre: row.nombre ?? '',
                apellido: row.apellido ?? '',
                montoTotal: row.montoTotal ?? null,
                fechaVencimiento: row.fechaVencimiento ?? null,
                camposAdicionales: row.camposAdicionales ?? Prisma.JsonNull,
                estadoSituacionId: ctx.defaults.estadoSituacionId,
                estadoGestionId: ctx.defaults.estadoGestionId,
            },
            update: {
                nombre: row.nombre ?? undefined,
                apellido: row.apellido ?? undefined,
                montoTotal: row.montoTotal ?? undefined,
                fechaVencimiento: row.fechaVencimiento ?? undefined,
                camposAdicionales: row.camposAdicionales ?? undefined,
            },
        });
    }
}
