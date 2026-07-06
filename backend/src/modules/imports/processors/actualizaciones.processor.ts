// processors/actualizaciones.processor.ts
import { ICategoryProcessor, MappedRow, ProcessContext, RowValidationResult } from './processor.interface';
import { Prisma } from '@prisma/client';
import { Logger } from '@nestjs/common';
import { normalizarTelefonoArgentino, esPosibleTelefono } from '../../../common/utils/phone-utils';
import { reconciliarSaldo, reconciliarAusente } from '../utils/reconciliar-actualizacion';
import { esDocumentoPlaceholder } from '../utils/documento';
import { mergeAdicionales } from '../utils/campos-adicionales';

/**
 * Procesador ACTUALIZACIONES — tres escenarios:
 *
 * A) Deudor ENCONTRADO en remesa origen → reconciliación por cuota/factura y/o montoTotal
 *    - Cuota en DB ausente del archivo → PAGADA + pago automático
 *    - Cuota nueva en archivo → insertar
 *    - montoTotal es INMUTABLE (Fase 3): no se actualiza (spec §1 regla 7)
 *
 * B) Deudor en el archivo pero NO en remesa origen → NUEVO CASO
 *    - Se crea como deudor nuevo (en la remesa de la actualización)
 *    - Se procesan sus facturas, contactos, etc.
 *
 * C) [afterAll] Deudor en remesa origen que NO apareció en el archivo → PAGÓ TODO
 *    - Todas sus facturas pendientes → PAGADA
 *    - Pago por el sum de esas facturas
 *    - montoTotal NO se toca (inmutable). ConsolidacionSituacionService lleva la situación a SIT-050.
 */
export class ActualizacionesProcessor implements ICategoryProcessor {
    readonly category = 'ACTUALIZACIONES';
    private readonly logger = new Logger(ActualizacionesProcessor.name);

    /** IDs de deudores de la remesa origen que fueron procesados en este batch */
    private processedDeudorIds = new Set<number>();
    /** IDs de deudores a los que se les generó un pago en este batch (para cerrar promesas cumplidas) */
    private pagosDeudorIds = new Set<number>();
    /**
     * ¿Alguna fila trajo datos de deuda (facturas o montoTotal)? Defensa en profundidad:
     * si un archivo etiquetado como ACTUALIZACIONES no trae ningún dato de deuda, se omite
     * el escenario C (marcar ausentes como pagados) aunque el modo sea RECONCILIAR.
     */
    private sawReconciliationData = false;

    /** Limpia el estado acumulado del batch. */
    private reset(): void {
        this.processedDeudorIds.clear();
        this.pagosDeudorIds.clear();
        this.sawReconciliationData = false;
    }

    /** Σpagos actual de un deudor (para reconciliar sin duplicar). */
    private async sumPagos(deudorId: number, ctx: ProcessContext): Promise<number> {
        const agg = await ctx.prisma.pago.aggregate({ where: { deudorId }, _sum: { importe: true } });
        return agg._sum.importe ?? 0;
    }

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

    validateRow(row: MappedRow, ctx: ProcessContext): RowValidationResult {
        if (!row.documento && !row.nro_cliente) {
            return { valid: false, error: 'Campo requerido: documento o nro_cliente' };
        }

        // Modo SOLO_DATOS: solo se actualiza identidad (DNI) y datos adicionales; no se
        // exige info de deuda. Alcanza con la identidad + algo para actualizar.
        if (ctx.modoActualizacion === 'SOLO_DATOS') {
            const hasAdicionales =
                !!row.camposAdicionales && Object.keys(row.camposAdicionales).length > 0;
            if (!row.documento && !hasAdicionales && !row.nombre && !row.apellido) {
                return {
                    valid: false,
                    error: 'En modo "solo datos" la fila debe traer DNI y/o datos adicionales para actualizar',
                };
            }
            return { valid: true };
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

        const soloDatos = ctx.modoActualizacion === 'SOLO_DATOS';

        // Registrar si el archivo trae datos de deuda (para el guard del escenario C).
        const hasFacturaBlocks = row._blocks?.some(
            b => (b.entity === 'FACTURA' || b.entity === 'DEUDORES_Y_FACTURAS') && b.data.nroFactura
        );
        const hasMontoTotal = row.montoTotal !== undefined && row.montoTotal !== null && row.montoTotal !== '';
        if (hasFacturaBlocks || hasMontoTotal) this.sawReconciliationData = true;

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
            // En modo "solo datos" no se crean deudores: es una actualización de existentes.
            if (soloDatos) {
                const ref = row.documento ? `documento=${row.documento}` : `nro_cliente=${row.nro_cliente}`;
                this.logger.warn(`Deudor no encontrado en la remesa origen (${ref}) — se omite (modo solo datos).`);
                return;
            }
            await this.crearNuevoDeudor(row, ctx);
            return;
        }

        // Registrar que este deudor fue visto en el archivo
        this.processedDeudorIds.add(deudorId);

        // ── ESCENARIO A: Deudor existente ─────────────────────────────────────────
        // Siempre se completa DNI (pisa el placeholder) + se mergean los datos adicionales.
        await this.actualizarIdentidadYAdicionales(deudorId, row, ctx);

        // La reconciliación de deuda solo corre en modo RECONCILIAR.
        if (!soloDatos) {
            await this.reconciliarDeudor(deudorId, row, ctx);
        }
    }

    /**
     * Completa la identidad y los datos adicionales de un deudor existente.
     * - DNI: si la fila trae documento y el deudor tiene un placeholder (cargado sin DNI),
     *   se pisa con el DNI real (salvo que otro deudor de la remesa ya tenga ese DNI).
     * - camposAdicionales: merge "gana el valor nuevo" (reemplaza claves existentes).
     * - nombre/apellido: se rellenan solo si están vacíos (no se pisan datos buenos).
     */
    private async actualizarIdentidadYAdicionales(
        deudorId: number,
        row: MappedRow,
        ctx: ProcessContext,
    ): Promise<void> {
        const actual = await ctx.prisma.deudor.findUnique({
            where: { id: deudorId },
            select: { documento: true, nombre: true, apellido: true, camposAdicionales: true },
        });
        if (!actual) return;

        const data: Prisma.deudorUpdateInput = {};

        // DNI real del archivo → completa el placeholder.
        const dniArchivo = row.documento ? String(row.documento).trim() : '';
        if (dniArchivo && dniArchivo !== actual.documento) {
            if (esDocumentoPlaceholder(actual.documento)) {
                const conflicto = await ctx.prisma.deudor.findFirst({
                    where: {
                        empresaId: ctx.empresaId,
                        remesaId: ctx.remesaOrigenId,
                        documento: dniArchivo,
                        id: { not: deudorId },
                    },
                    select: { id: true },
                });
                if (conflicto) {
                    this.logger.warn(
                        `No se actualiza el DNI del deudor ${deudorId}: ya existe otro deudor (${conflicto.id}) ` +
                        `con ese documento en la remesa ${ctx.remesaOrigenId}.`,
                    );
                } else {
                    data.documento = dniArchivo;
                }
            } else {
                // El deudor ya tenía un DNI real distinto → no se pisa (posible error de datos).
                this.logger.warn(
                    `Deudor ${deudorId} ya tiene un DNI real distinto al del archivo — no se pisa el documento.`,
                );
            }
        }

        // Datos adicionales: merge con "gana el valor nuevo".
        if (row.camposAdicionales && Object.keys(row.camposAdicionales).length > 0) {
            data.camposAdicionales = mergeAdicionales(actual.camposAdicionales, row.camposAdicionales);
        }

        // Nombre/apellido: rellenar solo si el actual está vacío.
        if (row.nombre && !String(actual.nombre ?? '').trim()) data.nombre = String(row.nombre);
        if (row.apellido && !String(actual.apellido ?? '').trim()) data.apellido = String(row.apellido);

        if (Object.keys(data).length > 0) {
            await ctx.prisma.deudor.update({ where: { id: deudorId }, data });
        }
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
                                origen: 'IMPORT_ACTUALIZACION',
                                origenArchivo: `ACTUALIZACION_REMESA_${ctx.remesaId}`,
                                observacion: `Pago automático - ${facDB.nroFactura}`,
                            },
                        });
                        this.pagosDeudorIds.add(deudorId);
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

        } else if (montoNuevo !== null) {
            // ── Modo B: valor único = SALDO que queda (spec §3.2) ─────────────────
            // Reconciliación por total contra los pagos ya registrados (no duplica
            // pagos manuales ni actualizaciones sucesivas).
            const deudorActual = await ctx.prisma.deudor.findUnique({
                where: { id: deudorId }, select: { montoTotal: true }
            });
            const montoOriginal = deudorActual ? Number(deudorActual.montoTotal) : 0; // inmutable
            const saldoArchivo = montoNuevo;
            const yaPagado = await this.sumPagos(deudorId, ctx);

            const r = reconciliarSaldo(montoOriginal, saldoArchivo, yaPagado);
            if (r.tipo === 'pago') {
                await ctx.prisma.pago.create({
                    data: {
                        deudorId, fecha: new Date(), importe: r.importe,
                        origen: 'IMPORT_ACTUALIZACION',
                        origenArchivo: `ACTUALIZACION_REMESA_${ctx.remesaId}`,
                        observacion: `Reconciliación saldo: original ${montoOriginal} − saldo ${saldoArchivo} − pagos ${yaPagado}`,
                    },
                });
                this.pagosDeudorIds.add(deudorId);
            } else if (r.tipo === 'ajuste') {
                // La deuda creció (saldo informado > original): nueva factura de ajuste.
                await ctx.prisma.factura.create({
                    data: {
                        deudorId, nroFactura: `AJUSTE-${ctx.remesaId}-${deudorId}-${Math.round(r.importe)}`,
                        importe: r.importe, fechaEmision: new Date(),
                        vencimiento: new Date(), estado: 'PENDIENTE',
                    },
                });
            }
            // montoTotal es inmutable (spec §1 regla 7). No se actualiza.
        }
    }

    /**
     * ESCENARIO C (afterAll): Deudores de la remesa origen que NO aparecieron en
     * el archivo → asumimos que pagaron todo.
     *
     * Fase 3 — §4.3:
     *  - Se mantiene la lógica de pago automático + marcar facturas PAGADA.
     *  - Se ELIMINA la escritura de montoTotal: 0 (montoTotal es inmutable, spec §1 regla 7).
     *  - Al final se delega la actualización de saldo y estadoSituacionId al consolidador.
     */
    async afterAll(ctx: ProcessContext): Promise<void> {
        if (!ctx.remesaOrigenId) return;

        // Guard: en modo SOLO_DATOS (o si el archivo no trajo ningún dato de deuda) NO se
        // marca a los ausentes como "pagó todo" ni se reconcilia deuda. Solo se actualizaron
        // identidad/adicionales de los deudores presentes en el archivo.
        if (ctx.modoActualizacion === 'SOLO_DATOS' || !this.sawReconciliationData) {
            this.logger.log(
                `ACTUALIZACIONES modo=${ctx.modoActualizacion}, datosDeDeuda=${this.sawReconciliationData}: ` +
                `se omite la marcación de ausentes como pagados y la consolidación de deuda.`,
            );
            this.reset();
            return;
        }

        // Obtener todos los deudores de la remesa origen
        const deudoresOrigen = await ctx.prisma.deudor.findMany({
            where: { remesaId: ctx.remesaOrigenId, empresaId: ctx.empresaId },
            select: { id: true },
        });

        // Traer montoTotal (original inmutable) para reconciliar contra Σpagos.
        const deudoresConMonto = await ctx.prisma.deudor.findMany({
            where: { remesaId: ctx.remesaOrigenId, empresaId: ctx.empresaId },
            select: { id: true, montoTotal: true },
        });

        for (const { id: deudorId, montoTotal } of deudoresConMonto) {
            if (this.processedDeudorIds.has(deudorId)) continue;  // ya fue procesado en el archivo

            // Este deudor no vino en el archivo → pagó todo. Reconciliar contra Σpagos.
            const yaPagado = await this.sumPagos(deudorId, ctx);
            const r = reconciliarAusente(montoTotal == null ? null : Number(montoTotal), yaPagado);

            if (r.tipo === 'skip') {
                this.logger.warn(`Deudor ${deudorId} ausente pero montoTotal 0/nulo — no se reconcilia.`);
                continue;
            }

            if (r.tipo === 'pago') {
                await ctx.prisma.pago.create({
                    data: {
                        deudorId,
                        fecha: new Date(),
                        importe: r.importe,
                        origen: 'IMPORT_ACTUALIZACION',
                        origenArchivo: `ACTUALIZACION_REMESA_${ctx.remesaId}`,
                        observacion: `Pago total automático: deudor ausente en actualización`,
                    },
                });
                this.pagosDeudorIds.add(deudorId);
            }

            // Marcar facturas pendientes como PAGADA (deudor saldado)
            if (r.marcarFacturasPagadas) {
                await ctx.prisma.factura.updateMany({
                    where: { deudorId, estado: { not: 'PAGADA' } },
                    data: { estado: 'PAGADA' },
                });
            }
            // montoTotal NO se toca (inmutable). La consolidación posterior lleva la situación a SIT-050.
        }

        // Consolidar deudores de la remesa origen (escenario C + deudores del archivo que estaban en esa remesa)
        await ctx.consolidacion.consolidar({ tipo: 'REMESA', remesaId: ctx.remesaOrigenId });

        // Si hay deudores nuevos del escenario B (ctx.remesaId !== ctx.remesaOrigenId), consolidarlos también
        if (ctx.remesaId !== ctx.remesaOrigenId) {
            await ctx.consolidacion.consolidar({ tipo: 'REMESA', remesaId: ctx.remesaId });
        }

        // Cerrar promesas VIGENTE que hayan quedado cumplidas por los pagos generados (spec §5.5)
        if (this.pagosDeudorIds.size > 0) {
            await ctx.promesas.cerrarCumplidas([...this.pagosDeudorIds]);
        }
        this.reset();
    }

    private async upsertContacto(deudorId: number, data: any, ctx: ProcessContext): Promise<void> {
        const tipoContacto = String(data.tipo || 'telefono').trim().toLowerCase();
        let valorFinal = String(data.valor).trim();
        let isValidado = false;

        if (['telefono', 'celular', 'whatsapp'].includes(tipoContacto)) {
            const val = normalizarTelefonoArgentino(valorFinal);
            if (val.valido && val.e164) {
                valorFinal = val.e164;
                isValidado = true;
            } else if (!esPosibleTelefono(valorFinal)) {
                // Basura evidente o relleno → no se carga.
                return;
            }
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
