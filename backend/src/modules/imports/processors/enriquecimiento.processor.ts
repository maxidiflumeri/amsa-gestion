// processors/enriquecimiento.processor.ts
import { ICategoryProcessor, MappedRow, ProcessContext, RowValidationResult } from './processor.interface';
import { Prisma } from '@prisma/client';
import { normalizarTelefonoArgentino } from '../../../common/utils/phone-utils';

export class EnriquecimientoProcessor implements ICategoryProcessor {
    readonly category = 'ENRIQUECIMIENTO';

    validateRow(row: MappedRow, _ctx: ProcessContext): RowValidationResult {
        const nroCliente = String(row.nro_cliente ?? '').trim();
        const documento = String(row.documento ?? '').trim();
        
        if (!nroCliente && !documento) {
            return { valid: false, error: 'nro_cliente o documento es requerido para enriquecimiento' };
        }
        if (!row.valor) {
            return { valid: false, error: 'Campo requerido faltante: valor' };
        }

        const tipoContacto = String(row.tipo || 'telefono').trim().toLowerCase();
        if (tipoContacto === 'telefono' || tipoContacto === 'whatsapp') {
            const val = normalizarTelefonoArgentino(String(row.valor));
            if (!val.valido) {
                return { valid: false, error: `Número de teléfono inválido: ${row.valor}` };
            }
        }

        return { valid: true };
    }

    async processRow(row: MappedRow, ctx: ProcessContext): Promise<void> {
        const nroCliente = String(row.nro_cliente ?? '').trim();
        const documento = String(row.documento ?? '').trim();
        
        // El enriquecimiento busca deudores en la remesa de deudores seleccionada (o la actual)
        const targetRemesaId = ctx.remesaOrigenId ?? ctx.remesaId;

        // Armamos la condición combinada para buscar al deudor
        let deudorRows: { id: number }[] = [];

        if (documento) {
            deudorRows = await ctx.prisma.$queryRaw<{ id: number }[]>(
                Prisma.sql`
                    SELECT id 
                    FROM deudor 
                    WHERE empresaId = ${ctx.empresaId} 
                      AND remesaId = ${targetRemesaId} 
                      AND documento = ${documento}
                    LIMIT 1
                `,
            );
        }

        // Si no se encontró por documento y tenemos nro_cliente, buscamos por nro_cliente
        if (!deudorRows.length && nroCliente) {
            deudorRows = await ctx.prisma.$queryRaw<{ id: number }[]>(
                Prisma.sql`
                    SELECT id 
                    FROM deudor 
                    WHERE empresaId = ${ctx.empresaId} 
                      AND remesaId = ${targetRemesaId} 
                      AND JSON_UNQUOTE(JSON_EXTRACT(camposAdicionales, '$.nro_cliente')) = ${nroCliente}
                    LIMIT 1
                `,
            );
        }

        if (!deudorRows.length) {
            const usingStr = documento ? `documento=${documento}` : `nro_cliente=${nroCliente}`;
            throw new Error(`Deudor no encontrado para enriquecimiento (${usingStr}) en la remesa destino`);
        }

        const deudor = deudorRows[0];
        
        // Default to telefono if tipo is not provided, making sure it's lowercase
        const tipoContacto = String(row.tipo || 'telefono').trim().toLowerCase();
        
        let valorFinal = String(row.valor).trim();
        if (tipoContacto === 'telefono' || tipoContacto === 'whatsapp') {
            const val = normalizarTelefonoArgentino(valorFinal);
            if (val.valido && val.e164) {
                valorFinal = val.e164;
            }
        }

        // Upsert contacto
        await ctx.prisma.contacto.upsert({
            where: {
                deudorId_tipo_valor: {
                    deudorId: deudor.id,
                    tipo: tipoContacto,
                    valor: valorFinal,
                },
            },
            create: {
                deudorId: deudor.id,
                tipo: tipoContacto,
                valor: valorFinal,
                validado: false,
                subtipo: row.subtipo ? String(row.subtipo) : null,
            },
            update: {
                // If it exists, maybe update subtipo if provided
                ...(row.subtipo ? { subtipo: String(row.subtipo) } : {}),
            },
        });
    }
}
