// processors/actualizaciones.processor.ts
import { ICategoryProcessor, MappedRow, ProcessContext, RowValidationResult } from './processor.interface';
import { Prisma } from '@prisma/client';
import { normalizarTelefonoArgentino } from '../../../common/utils/phone-utils';

/**
 * Procesador ACTUALIZACIONES — tres escenarios:
 *
 * A) Deudor ENCONTRADO en remesa origen → reconciliación por cuota/factura y/o montoTotal
 *    - Cuota en DB ausente del archivo → PAGADA + pago automático
 *    - Cuota nueva en archivo → insertar
 *    - montoTotal del archivo es fuente de verdad del total
 *
 * B) Deudor en el archivo pero NO en remesa origen → NUEVO CASO
 *    - Se crea como deudor nuevo (en la remesa de la actualización)
 *    - Se procesan sus facturas, contactos, etc.
 *
 * C) [afterAll] Deudor en remesa origen que NO apareció en el archivo → PAGÓ TODO
 *    - Todas sus facturas pendientes → PAGADA
 *    - Pago por el sum de esas facturas
 *    - montoTotal → 0
 */
export class ActualizacionesProcessor implements ICategoryProcessor {
    readonly category = 'ACTUALIZACIONES';

    /** IDs de deudores de la remesa origen que fueron procesados en este batch */
    private processedDeudorIds = new Set<number>();

    private parseFloatSafe(val: any): number {
        if (val === null || val === undefined || val === '') return 0;
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
        if (!row.documento && !row.nro_cliente) {
            return { valid: false, error: 'Campo requerido: documento o nro_cliente' };
        }

        const hasFacturaBlocks = row._blocks?.some(
            b => (b.entity === 'FACTURA' || b.entity === 'DEUDORES_Y_FACTURAS') && b.data.nroFactura
        );
        const hasMontoTotal = row.montoTotal !== undefined && row.montoTotal !== null && row.montoTotal !== '';

        if (!hasFacturaBlocks && !hasMontoTotal) {
            return {
                valid: false,
                error: 'Debe incluir bloques con nroFactura o el campo montoTotal',
            };
        }
        return { valid: true };
    }

    async processRow(row: MappedRow, ctx: ProcessContext): Promise<void> {
        if (!ctx.remesaOrigenId) {
            throw new Error('ACTUALIZACIONES requiere una remesa de origen (remesaOrigenId)');
        }

        // ── 1. Buscar deudor en la remesa de origen ───────────────────────────────
        let deudorId: number | null = null;

        if (row.documento) {
            const documentoStr = String(row.documento).trim();
            const found = await ctx.prisma.deudor.findUnique({
                where: {
                    empresaId_documento_remesaId: {
                        empresaId: ctx.empresaId,
                        documento: documentoStr,
                        remesaId: ctx.remesaOrigenId,
                    },
                },
                select: { id: true },
            });
            if (found) deudorId = found.id;
        }

        if (!deudorId && row.nro_cliente) {
            const nroCliente = String(row.nro_cliente).trim();
            const rows = await ctx.prisma.$queryRaw<{ id: number }[]>(
                Prisma.sql`
                    SELECT id FROM deudor
                    WHERE empresaId = ${ctx.empresaId}
                      AND remesaId = ${ctx.remesaOrigenId}
                      AND nroCliente = ${nroCliente}
                    LIMIT 1
                `
            );
            if (rows.length) deudorId = rows[0].id;
        }

        // ── ESCENARIO B: Deudor nuevo, no estaba en la remesa origen ─────────────
        if (!deudorId) {
            await this.crearNuevoDeudor(row, ctx);
            return;
        }

        // Registrar que este deudor fue visto en el archivo
        this.processedDeudorIds.add(deudorId);

        // ── ESCENARIO A: Deudor existente → reconciliación ────────────────────────
        await this.reconciliarDeudor(deudorId, row, ctx);
    }

    /**
     * ESCENARIO B: Crear un deudor completamente nuevo a partir de los datos del archivo.
     * Se asocia a la remesa de la actualización (ctx.remesaId).
     */
    private async crearNuevoDeudor(row: MappedRow, ctx: ProcessContext): Promise<void> {
        const documentoStr = row.documento ? String(row.documento).trim() : `SIN_DOC_${Date.now()}`;
        const montoNuevo = row.montoTotal ? this.parseFloatSafe(row.montoTotal) : 0;

        // Calcular sum de facturas del archivo si no hay montoTotal
        let montoCalculado = montoNuevo;
        if (!montoNuevo && row._blocks) {
            for (const b of row._blocks) {
                if ((b.entity === 'FACTURA' || b.entity === 'DEUDORES_Y_FACTURAS') && b.data.nroFactura) {
                    montoCalculado += this.parseFloatSafe(b.data.importe);
                }
            }
        }

        const deudor = await ctx.prisma.deudor.create({
            data: {
                empresaId: ctx.empresaId,
                remesaId: ctx.remesaId,  // actualizaciones remesa
                documento: documentoStr,
                nombre: row.nombre ?? '',
                apellido: row.apellido ?? '',
                montoTotal: montoCalculado,
                fechaVencimiento: this.parseDateSafe(row.fechaVencimiento) ?? null,
                camposAdicionales: row.camposAdicionales ?? Prisma.JsonNull,
                estadoSituacionId: ctx.defaults.estadoSituacionId,
                estadoGestionId: ctx.defaults.estadoGestionId,
            },
        });

        // Enriquecimiento histórico de contactos
        if (documentoStr && !documentoStr.startsWith('SIN_DOC')) {
            const historicContacts = await ctx.prisma.contacto.findMany({
                where: { deudor: { documento: documentoStr, remesaId: { not: ctx.remesaId } } },
                distinct: ['tipo', 'valor'],
                select: { tipo: true, valor: true, subtipo: true, prioridad: true, validado: true, whatsapp: true },
            });
            if (historicContacts.length > 0) {
                await ctx.prisma.contacto.createMany({
                    data: historicContacts.map(hc => ({ deudorId: deudor.id, ...hc })),
                    skipDuplicates: true,
                });
            }
        }

        // Insertar facturas del archivo
        if (row._blocks) {
            for (const b of row._blocks) {
                if ((b.entity === 'FACTURA' || b.entity === 'DEUDORES_Y_FACTURAS') && b.data.nroFactura) {
                    await ctx.prisma.factura.create({
                        data: {
                            deudorId: deudor.id,
                            nroFactura: String(b.data.nroFactura).trim(),
                            importe: this.parseFloatSafe(b.data.importe),
                            fechaEmision: this.parseDateSafe(b.data.fechaEmision) ?? new Date(),
                            vencimiento: this.parseDateSafe(b.data.vencimiento) ?? new Date(),
                            estado: 'PENDIENTE',
                        },
                    });
                } else if (b.entity === 'CONTACTO' && b.data.valor) {
                    await this.upsertContacto(deudor.id, b.data, ctx);
                }
            }
        }
    }

    /**
     * ESCENARIO A: Reconciliar deudor existente contra los datos del archivo.
     */
    private async reconciliarDeudor(deudorId: number, row: MappedRow, ctx: ProcessContext): Promise<void> {
        const hasFacturaBlocks = row._blocks?.some(
            b => (b.entity === 'FACTURA' || b.entity === 'DEUDORES_Y_FACTURAS') && b.data.nroFactura
        );
        const hasMontoTotal = row.montoTotal !== undefined && row.montoTotal !== null && row.montoTotal !== '';
        const montoNuevo = hasMontoTotal ? this.parseFloatSafe(row.montoTotal) : null;

        if (hasFacturaBlocks) {
            // ── Modo A: reconciliación por nroFactura ─────────────────────────────
            const facturasEnDB = await ctx.prisma.factura.findMany({
                where: { deudorId, estado: { not: 'PAGADA' } },
                select: { id: true, nroFactura: true, importe: true },
            });

            const nrosEnArchivo = new Map<string, { importe?: number; fechaEmision?: Date; vencimiento?: Date }>();
            for (const b of (row._blocks ?? [])) {
                if ((b.entity === 'FACTURA' || b.entity === 'DEUDORES_Y_FACTURAS') && b.data.nroFactura) {
                    const nro = String(b.data.nroFactura).trim();
                    nrosEnArchivo.set(nro, {
                        importe: b.data.importe !== undefined && b.data.importe !== ''
                            ? this.parseFloatSafe(b.data.importe)
                            : undefined,
                        fechaEmision: this.parseDateSafe(b.data.fechaEmision),
                        vencimiento: this.parseDateSafe(b.data.vencimiento),
                    });
                }
            }

            const nrosEnDB = new Set(facturasEnDB.map(f => f.nroFactura));
            const importePorCuota = (montoNuevo !== null && nrosEnArchivo.size > 0)
                ? montoNuevo / nrosEnArchivo.size
                : null;

            // Cuotas pagadas (en DB pero no en archivo)
            for (const facDB of facturasEnDB) {
                if (!nrosEnArchivo.has(facDB.nroFactura)) {
                    await ctx.prisma.factura.update({ where: { id: facDB.id }, data: { estado: 'PAGADA' } });
                    const importePago = facDB.importe > 0 ? facDB.importe : (importePorCuota ?? 0);
                    if (importePago > 0) {
                        await ctx.prisma.pago.create({
                            data: {
                                deudorId,
                                fecha: new Date(),
                                importe: importePago,
                                origenArchivo: `ACTUALIZACION_REMESA_${ctx.remesaId}`,
                                observacion: `Pago automático - ${facDB.nroFactura}`,
                            },
                        });
                    }
                }
            }

            // Cuotas nuevas (en archivo pero no en DB)
            for (const [nroFactura, datos] of nrosEnArchivo) {
                if (!nrosEnDB.has(nroFactura)) {
                    const importeFactura = datos.importe ?? importePorCuota ?? 0;
                    await ctx.prisma.factura.create({
                        data: {
                            deudorId,
                            nroFactura,
                            importe: importeFactura,
                            fechaEmision: datos.fechaEmision ?? new Date(),
                            vencimiento: datos.vencimiento ?? new Date(),
                            estado: 'PENDIENTE',
                        },
                    });
                } else if (datos.importe !== undefined) {
                    const facExistente = facturasEnDB.find(f => f.nroFactura === nroFactura)!;
                    if (Math.abs(facExistente.importe - datos.importe) > 0.001) {
                        await ctx.prisma.factura.update({
                            where: { id: facExistente.id },
                            data: { importe: datos.importe },
                        });
                    }
                }
            }

            // Actualizar total
            const totalFinal = montoNuevo !== null
                ? montoNuevo
                : Number((await ctx.prisma.factura.aggregate({
                    where: { deudorId, estado: { not: 'PAGADA' } }, _sum: { importe: true }
                }))._sum.importe ?? 0);

            await ctx.prisma.deudor.update({ where: { id: deudorId }, data: { montoTotal: totalFinal } });

        } else if (montoNuevo !== null) {
            // ── Modo B: solo montoTotal, sin bloques ──────────────────────────────
            const deudorActual = await ctx.prisma.deudor.findUnique({
                where: { id: deudorId }, select: { montoTotal: true }
            });
            const montoActual = deudorActual ? Number(deudorActual.montoTotal) : 0;
            const delta = montoActual - montoNuevo;

            if (delta > 0.001) {
                await ctx.prisma.pago.create({
                    data: {
                        deudorId, fecha: new Date(), importe: delta,
                        origenArchivo: `ACTUALIZACION_REMESA_${ctx.remesaId}`,
                        observacion: `Pago automático: ${montoActual} → ${montoNuevo}`,
                    },
                });
            } else if (delta < -0.001) {
                await ctx.prisma.factura.create({
                    data: {
                        deudorId, nroFactura: `AJUSTE-${ctx.remesaId}-${Date.now()}`,
                        importe: Math.abs(delta), fechaEmision: new Date(),
                        vencimiento: new Date(), estado: 'PENDIENTE',
                    },
                });
            }
            await ctx.prisma.deudor.update({ where: { id: deudorId }, data: { montoTotal: montoNuevo } });
        }
    }

    /**
     * ESCENARIO C (afterAll): Deudores de la remesa origen que NO aparecieron en
     * el archivo → asumimos que pagaron todo.
     */
    async afterAll(ctx: ProcessContext): Promise<void> {
        if (!ctx.remesaOrigenId) return;

        // Obtener todos los deudores de la remesa origen
        const deudoresOrigen = await ctx.prisma.deudor.findMany({
            where: { remesaId: ctx.remesaOrigenId, empresaId: ctx.empresaId },
            select: { id: true },
        });

        for (const { id: deudorId } of deudoresOrigen) {
            if (this.processedDeudorIds.has(deudorId)) continue;  // ya fue procesado

            // Este deudor no vino en el archivo → pagó todo
            const facturasPendientes = await ctx.prisma.factura.findMany({
                where: { deudorId, estado: { not: 'PAGADA' } },
                select: { id: true, importe: true },
            });

            if (facturasPendientes.length === 0) continue;

            const totalPagado = facturasPendientes.reduce((sum, f) => sum + f.importe, 0);

            // Marcar todas como pagadas
            await ctx.prisma.factura.updateMany({
                where: { id: { in: facturasPendientes.map(f => f.id) } },
                data: { estado: 'PAGADA' },
            });

            // Generar un pago por el total
            if (totalPagado > 0) {
                await ctx.prisma.pago.create({
                    data: {
                        deudorId,
                        fecha: new Date(),
                        importe: totalPagado,
                        origenArchivo: `ACTUALIZACION_REMESA_${ctx.remesaId}`,
                        observacion: `Pago total automático: deudor ausente en actualización`,
                    },
                });
            }

            // Deuda en 0
            await ctx.prisma.deudor.update({
                where: { id: deudorId },
                data: { montoTotal: 0 },
            });
        }
    }

    private async upsertContacto(deudorId: number, data: any, ctx: ProcessContext): Promise<void> {
        const tipoContacto = String(data.tipo || 'telefono').trim().toLowerCase();
        let valorFinal = String(data.valor).trim();
        let isValidado = false;

        if (['telefono', 'celular', 'whatsapp'].includes(tipoContacto)) {
            const val = normalizarTelefonoArgentino(valorFinal);
            if (val.valido && val.e164) { valorFinal = val.e164; isValidado = true; }
        }

        await ctx.prisma.contacto.upsert({
            where: { deudorId_tipo_valor: { deudorId, tipo: tipoContacto, valor: valorFinal } },
            create: {
                deudorId, tipo: tipoContacto, valor: valorFinal,
                subtipo: data.subtipo ?? null,
                prioridad: parseInt(String(data.prioridad || '0'), 10),
                validado: isValidado,
            },
            update: { subtipo: data.subtipo ?? undefined, validado: isValidado },
        });
    }
}
