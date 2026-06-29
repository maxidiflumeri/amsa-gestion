// processors/contactos.processor.ts
import { ICategoryProcessor, MappedRow, ProcessContext, RowValidationResult } from './processor.interface';
import { Prisma } from '@prisma/client';
import { clearContactoImportCaches, prepararContactoImport } from '../utils/contacto-import';
import { procesarBloquesDeudor } from '../utils/procesar-bloques';

export class ContactosProcessor implements ICategoryProcessor {
    readonly category = 'CONTACTOS';

    validateRow(row: MappedRow, _ctx: ProcessContext): RowValidationResult {
        if (!row.nro_cliente && !row.documento) {
            return { valid: false, error: 'nro_cliente o documento es requerido para contactos' };
        }

        const tipoContacto = String(row.tipo || 'telefono').trim().toLowerCase();
        const tieneEstructurada =
            !!(row.direccion_calle || row.direccion_numero || row.direccion_localidad || row.direccion_provincia);

        if (tipoContacto === 'direccion') {
            if (!row.valor && !tieneEstructurada) {
                return { valid: false, error: 'Campo requerido faltante: valor o columnas de dirección' };
            }
        } else if (!row.valor) {
            return { valid: false, error: 'Campo requerido faltante: valor' };
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
                      AND nroCliente = ${nroCliente}
                    LIMIT 1
                `,
            );
        }

        if (!deudorRows.length) {
            const usingStr = documento ? `documento=${documento}` : `nro_cliente=${nroCliente}`;
            throw new Error(`Deudor no encontrado para contacto (${usingStr})`);
        }

        const deudor = deudorRows[0];

        // Bloques repetitivos del archivo → al deudor encontrado (aunque no haya contacto principal).
        await procesarBloquesDeudor(deudor.id, row._blocks, ctx);

        const prep = await prepararContactoImport({
            tipo: row.tipo,
            valor: row.valor,
            direccion_calle: row.direccion_calle,
            direccion_numero: row.direccion_numero,
            direccion_cp: row.direccion_cp,
            direccion_localidad: row.direccion_localidad,
            direccion_provincia: row.direccion_provincia,
        }, ctx.validarDomicilios);

        if (!prep) return;

        await ctx.prisma.contacto.upsert({
            where: {
                deudorId_tipo_valor: {
                    deudorId: deudor.id,
                    tipo: prep.tipo,
                    valor: prep.valor,
                },
            },
            create: {
                deudorId: deudor.id,
                tipo: prep.tipo,
                valor: prep.valor,
                subtipo: row.subtipo ?? null,
                prioridad: row.prioridad ?? null,
                validado: prep.validado,
            },
            update: {
                subtipo: row.subtipo ?? undefined,
                prioridad: row.prioridad ?? undefined,
                validado: prep.validado,
            },
        });
    }

    async afterAll(_ctx: ProcessContext): Promise<void> {
        clearContactoImportCaches();
    }
}
