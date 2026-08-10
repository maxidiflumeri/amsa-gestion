// processors/pagos.processor.ts
import { ICategoryProcessor, MappedRow, ProcessContext, RowValidationResult } from './processor.interface';
import { Prisma } from '@prisma/client';
import { procesarBloquesDeudor } from '../utils/procesar-bloques';

export class PagosProcessor implements ICategoryProcessor {
    readonly category = 'PAGOS';

    /**
     * IDs de deudores que recibieron pagos en este batch.
     * Se usa en afterAll para consolidar solo los deudores tocados (optimización §4.2).
     */
    private processedDeudorIds = new Set<number>();

    validateRow(row: MappedRow, _ctx: ProcessContext): RowValidationResult {
        const nroCliente = String(row.nro_cliente ?? '').trim();
        if (!nroCliente) {
            return { valid: false, error: 'nro_cliente es requerido para pagos' };
        }
        // La UI de mapeo de PAGOS expone el campo del importe como `monto` (label "Monto");
        // se acepta como alias de `importe` para no rechazar plantillas mapeadas con esa clave.
        if (row.importe == null && row.monto == null) {
            return { valid: false, error: 'Campo requerido faltante: importe (o monto)' };
        }
        return { valid: true };
    }

    async processRow(row: MappedRow, ctx: ProcessContext): Promise<void> {
        const nroCliente = String(row.nro_cliente ?? '').trim();
        if (!nroCliente) throw new Error('nro_cliente es requerido para pagos');

        // Buscar deudor en la(s) remesa(s) de origen (las de deudores), igual que facturas/contactos.
        // Los pagos apuntan a una remesa origen distinta a la del propio archivo; usar ctx.remesaId
        // acá hacía fallar la búsqueda con "Deudor no encontrado" aunque el nro_cliente fuera correcto.
        //
        // Tema 2: si vienen varias remesas origen (archivo de pagos para toda la empresa), se busca
        // el nroCliente en cualquiera de ellas → una sola corrida cubre las N remesas.
        const targetRemesaIds = ctx.remesaOrigenIds?.length
            ? ctx.remesaOrigenIds
            : [ctx.remesaOrigenId ?? ctx.remesaId];

        const deudorRows = await ctx.prisma.$queryRaw<{ id: number }[]>(
            Prisma.sql`
                SELECT id
                FROM deudor
                WHERE empresaId = ${ctx.empresaId}
                  AND remesaId IN (${Prisma.join(targetRemesaIds)})
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

        const importe = row.importe ?? row.monto ?? 0;

        // Identificador del comprobante que cobró, si la plantilla lo mapea. Se guarda en el pago y
        // participa del anti-duplicados de más abajo.
        const observacion = row.observacion != null && String(row.observacion).trim() !== ''
            ? String(row.observacion).trim()
            : null;

        // Fecha del pago: se respeta la mapeada en la plantilla (campo `fecha`, o su alias
        // `fechaPago` que expone la UI). Si no vino o es inválida, se usa la fecha del día.
        const fechaRaw = row.fecha ?? row.fechaPago;
        const fechaParsed = fechaRaw != null && fechaRaw !== '' ? new Date(fechaRaw) : null;
        const fechaPago = fechaParsed && !isNaN(fechaParsed.getTime()) ? fechaParsed : new Date();

        // Anti-dup (spec §3.1): si ya hay un pago MANUAL no confirmado del mismo deudor
        // con este importe exacto → confirmarlo en vez de duplicar. Un claim por fila.
        const claim = await ctx.prisma.pago.findFirst({
            where: {
                deudorId: deudor.id,
                origen: 'MANUAL',
                confirmadoImport: false,
                importe,
            },
            orderBy: { fecha: 'asc' },
            select: { id: true },
        });

        if (claim) {
            await ctx.prisma.pago.update({
                where: { id: claim.id },
                data: {
                    confirmadoImport: true,
                    confirmadoEn: new Date(),
                    origenArchivo: `PAGOS_REMESA_${ctx.remesaId}`,
                },
            });
        } else {
            // Anti-dup acumulativo (Tema 2): si ya existe un pago importado idéntico
            // (mismo deudor, mismo día e importe) NO se reinserta. Hace idempotente
            // reimportar un archivo de pagos acumulativo (que repite pagos ya cargados).
            // La comparación es por día (no por timestamp exacto) porque cuando la fecha no
            // viene mapeada se usa `new Date()` y cada corrida tendría una hora distinta.
            const inicioDia = new Date(fechaPago);
            inicioDia.setHours(0, 0, 0, 0);
            const finDia = new Date(fechaPago);
            finDia.setHours(23, 59, 59, 999);

            const yaImportado = await ctx.prisma.pago.findFirst({
                where: {
                    deudorId: deudor.id,
                    origen: 'IMPORT_PAGOS',
                    importe,
                    fecha: { gte: inicioDia, lte: finDia },
                    // Si la plantilla mapea un identificador del comprobante en `observacion`, dos
                    // cobros del mismo día y el mismo importe pero de comprobantes distintos NO son
                    // el mismo pago: hay que registrar los dos.
                    //
                    // Sin esto, un cliente que cancela varias cuotas iguales de un plan el mismo día
                    // queda con un solo pago registrado. Medido sobre el archivo de AYSA del 25/07:
                    // de 1.997 cobros por $18.353.107, se guardaban 1.192 y se perdían $2.443.138
                    // —el 13,3% de la cobranza—; una sola cuenta pagó 36 partidas de $195,04 el
                    // mismo día.
                    //
                    // Las plantillas que no mapean `observacion` no cambian: el criterio sigue
                    // siendo deudor + día + importe.
                    ...(observacion ? { observacion } : {}),
                },
                select: { id: true },
            });

            if (yaImportado) {
                // Pago ya cargado en una importación previa → skip idempotente.
                // No se toca el deudor: no hubo movimiento, no hace falta consolidar.
                return;
            }

            await ctx.prisma.pago.create({
                data: {
                    deudorId: deudor.id,
                    fecha: fechaPago,
                    importe,
                    origen: 'IMPORT_PAGOS',
                    origenArchivo: row.origenArchivo ?? null,
                    observacion,
                },
            });
        }

        // Trackear deudor tocado para la consolidación selectiva en afterAll
        this.processedDeudorIds.add(deudor.id);
    }

    /**
     * Fase 3 — §4.2: Al finalizar todas las filas, consolidar la situación de los
     * deudores que recibieron pagos en este batch.
     *
     * Optimización: se consolida solo el subconjunto (scope DEUDORES) en lugar de
     * toda la remesa, ahorrando evaluar deudores sin movimientos.
     * Fallback a scope REMESA si el set está vacío (no debería ocurrir en práctica).
     */
    async afterAll(ctx: ProcessContext): Promise<void> {
        if (this.processedDeudorIds.size > 0) {
            const deudorIds = [...this.processedDeudorIds];
            await ctx.consolidacion.consolidar({ tipo: 'DEUDORES', deudorIds });
            // Cerrar promesas VIGENTE que hayan quedado cumplidas por estos pagos (spec §5.5)
            await ctx.promesas.cerrarCumplidas(deudorIds);
        } else {
            // Fallback: consolidar la remesa origen (o la propia si no hay origen)
            await ctx.consolidacion.consolidar({
                tipo: 'REMESA',
                remesaId: ctx.remesaOrigenId ?? ctx.remesaId,
            });
        }
        this.processedDeudorIds.clear();
    }
}
