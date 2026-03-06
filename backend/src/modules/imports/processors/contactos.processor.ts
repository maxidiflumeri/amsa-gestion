// processors/contactos.processor.ts
import { ICategoryProcessor, MappedRow, ProcessContext, RowValidationResult } from './processor.interface';
import { Prisma } from '@prisma/client';
import { normalizarTelefonoArgentino } from '../../../common/utils/phone-utils';

export class ContactosProcessor implements ICategoryProcessor {
    readonly category = 'CONTACTOS';

    validateRow(row: MappedRow, _ctx: ProcessContext): RowValidationResult {
        if (!row.nro_cliente && !row.documento) {
            return { valid: false, error: 'nro_cliente o documento es requerido para contactos' };
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
        
        const targetRemesaId = ctx.remesaOrigenId ?? ctx.remesaId;

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
            throw new Error(`Deudor no encontrado para contacto (${usingStr})`);
        }

        const deudor = deudorRows[0];

        const tipoContacto = String(row.tipo || 'telefono').trim().toLowerCase();
        let valorFinal = String(row.valor).trim();
        
        if (tipoContacto === 'telefono' || tipoContacto === 'whatsapp') {
            const val = normalizarTelefonoArgentino(valorFinal);
            if (val.valido && val.e164) {
                valorFinal = val.e164;
            }
        }

        // Upsert con clave compuesta (deudorId + tipo + valor)
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
                subtipo: row.subtipo ?? null,
                prioridad: row.prioridad ?? null,
                validado: false,
            },
            update: {
                subtipo: row.subtipo ?? undefined,
                prioridad: row.prioridad ?? undefined,
            },
        });
    }
}
