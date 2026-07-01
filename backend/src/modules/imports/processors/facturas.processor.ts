// processors/facturas.processor.ts
import { ICategoryProcessor, MappedRow, ProcessContext, RowValidationResult } from './processor.interface';
import { Prisma } from '@prisma/client';
import { procesarBloquesDeudor } from '../utils/procesar-bloques';
import { mergeCamposAdicionalesEnDeudores, recalcularMontoTotalDesdeFacturas } from '../utils/monto-facturas';

export class FacturasProcessor implements ICategoryProcessor {
    readonly category = 'FACTURAS';

    /** Deudores tocados en este batch → se recalcula su montoTotal en afterAll. */
    private touchedDeudorIds = new Set<number>();
    /** Extras (datos adicionales del archivo de facturas) acumulados por deudor → se mergean en afterAll. */
    private extrasPorDeudor = new Map<number, Record<string, any>>();

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
                  AND nroCliente = ${nroCliente}
                LIMIT 1
            `,
        );

        if (!rows.length) {
            throw new Error(`Deudor no encontrado (nro_cliente=${nroCliente})`);
        }

        const deudor = rows[0];

        // Bloques repetitivos del archivo → al deudor encontrado.
        await procesarBloquesDeudor(deudor.id, row._blocks, ctx);

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

        // Trackear el deudor para recalcular su montoTotal en afterAll.
        this.touchedDeudorIds.add(deudor.id);

        // Datos adicionales configurados en el mapeo de facturas → se cargan en el deudor.
        if (row.camposAdicionales && Object.keys(row.camposAdicionales).length > 0) {
            const prev = this.extrasPorDeudor.get(deudor.id) ?? {};
            this.extrasPorDeudor.set(deudor.id, { ...prev, ...row.camposAdicionales });
        }
    }

    /**
     * Al finalizar todas las filas: (1) recalcula `montoTotal` del deudor desde la suma
     * de facturas según el modo de la plantilla y consolida saldo/situación; (2) mergea
     * los datos adicionales del archivo en `deudor.camposAdicionales`.
     */
    async afterAll(ctx: ProcessContext): Promise<void> {
        await recalcularMontoTotalDesdeFacturas(ctx, [...this.touchedDeudorIds]);
        await mergeCamposAdicionalesEnDeudores(ctx, this.extrasPorDeudor);
        this.touchedDeudorIds.clear();
        this.extrasPorDeudor.clear();
    }
}
