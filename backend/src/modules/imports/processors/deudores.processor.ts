// processors/deudores.processor.ts
import { ICategoryProcessor, MappedRow, ProcessContext, RowValidationResult } from './processor.interface';
import { Prisma } from '@prisma/client';
import { nroClienteDeFila } from '../utils/nro-cliente';
import { documentoDeFila, esDocumentoPlaceholder } from '../utils/documento';
import { procesarBloquesDeudor } from '../utils/procesar-bloques';

export class DeudoresProcessor implements ICategoryProcessor {
    readonly category = 'DEUDORES';

    private parseFloatSafe(val: any): number | undefined {
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

    private parseDateSafe(val: any): Date | undefined {
        if (!val) return undefined;
        const d = new Date(val);
        return isNaN(d.getTime()) ? undefined : d;
    }

    validateRow(row: MappedRow, _ctx: ProcessContext): RowValidationResult {
        // El DNI puede faltar (asignaciones sin documento): en ese caso se identifica
        // por nro_cliente y se guarda un placeholder que el DNI real pisa luego.
        if (!row.documento && !nroClienteDeFila(row)) {
            return { valid: false, error: 'Campo requerido faltante: documento o nro_cliente' };
        }
        return { valid: true };
    }

    async processRow(row: MappedRow, ctx: ProcessContext): Promise<void> {
        const documentoStr = documentoDeFila(row);
        const nroCliente = nroClienteDeFila(row);
        let isNewForThisRemesa = true;

        const existingInRemesa = await ctx.prisma.deudor.findUnique({
            where: {
                empresaId_documento_remesaId: {
                    empresaId: ctx.empresaId,
                    documento: documentoStr,
                    remesaId: ctx.remesaId,
                }
            },
            select: { id: true }
        });

        if (existingInRemesa) {
            isNewForThisRemesa = false;
        }

        const deudor = await ctx.prisma.deudor.upsert({
            where: {
                empresaId_documento_remesaId: {
                    empresaId: ctx.empresaId,
                    documento: documentoStr,
                    remesaId: ctx.remesaId,
                },
            },
            create: {
                empresaId: ctx.empresaId,
                remesaId: ctx.remesaId,
                documento: documentoStr,
                nroCliente: nroCliente || null,
                nombre: row.nombre ?? '',
                apellido: row.apellido ?? '',
                montoTotal: this.parseFloatSafe(row.montoTotal) ?? null,
                fechaVencimiento: this.parseDateSafe(row.fechaVencimiento) ?? null,
                camposAdicionales: row.camposAdicionales ?? Prisma.JsonNull,
                estadoSituacionId: ctx.defaults.estadoSituacionId,
                estadoGestionId: ctx.defaults.estadoGestionId,
            },
            update: {
                nroCliente: nroCliente || undefined,
                nombre: row.nombre ?? undefined,
                apellido: row.apellido ?? undefined,
                montoTotal: this.parseFloatSafe(row.montoTotal) ?? undefined,
                fechaVencimiento: this.parseDateSafe(row.fechaVencimiento) ?? undefined,
                camposAdicionales: row.camposAdicionales ?? undefined,
            },
        });

        // Bloques repetitivos (facturas/contactos) → se procesan en cualquier categoría.
        await procesarBloquesDeudor(deudor.id, row._blocks, ctx);

        // -- ENRIQUECIMIENTO HISTÓRICO GLOBAL (Cross-Empresa / Cross-Remesa) --
        // Se saltea con placeholder (deudor sin DNI): no hay histórico que matchear
        // hasta que llegue el DNI real por la actualización.
        if (isNewForThisRemesa && documentoStr && !esDocumentoPlaceholder(documentoStr)) {
            const historicContacts = await ctx.prisma.contacto.findMany({
                where: {
                    deudor: {
                        documento: documentoStr,
                        remesaId: { not: ctx.remesaId }
                    }
                },
                distinct: ['tipo', 'valor'],
                select: { tipo: true, valor: true, subtipo: true, prioridad: true, validado: true, whatsapp: true }
            });

            if (historicContacts.length > 0) {
                await ctx.prisma.contacto.createMany({
                    data: historicContacts.map(hc => ({
                        deudorId: deudor.id,
                        tipo: hc.tipo,
                        valor: hc.valor,
                        subtipo: hc.subtipo,
                        prioridad: hc.prioridad,
                        validado: hc.validado,
                        whatsapp: hc.whatsapp
                    })),
                    skipDuplicates: true
                });
            }
        }
    }
}
