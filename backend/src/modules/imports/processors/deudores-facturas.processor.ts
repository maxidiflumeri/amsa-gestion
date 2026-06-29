import { ICategoryProcessor, MappedRow, ProcessContext, RowValidationResult } from './processor.interface';
import { Prisma } from '@prisma/client';
import { clearContactoImportCaches, prepararContactoImport } from '../utils/contacto-import';
import { nroClienteDeFila } from '../utils/nro-cliente';

export class DeudoresYFacturasProcessor implements ICategoryProcessor {
    readonly category = 'DEUDORES_Y_FACTURAS';
    
    // Caché simple en memoria por llamada executeRemesa para evitar 
    // constantes Upserts si el archivo trae muchas filas del mismo deudor seguido.
    // Clave: documento
    private debtorCache: Map<string, number> = new Map();

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

    private parseIntSafe(val: any): number | undefined {
        if (val === null || val === undefined || val === '') return undefined;
        const num = parseInt(String(val).replace(/[^\d-]/g, ''), 10);
        return isNaN(num) ? 0 : num;
    }

    private parseDateSafe(val: any): Date | undefined {
        if (!val) return undefined;
        const d = new Date(val);
        return isNaN(d.getTime()) ? undefined : d;
    }

    private getRowInvoicesSum(row: MappedRow): number {
        let sum = 0;
        if (row.nroFactura && row.importe) {
            sum += this.parseFloatSafe(row.importe) || 0;
        }
        if (row._blocks) {
            for (const b of row._blocks) {
                if ((b.entity === 'FACTURA' || b.entity === 'MIXTO' || b.entity === 'DEUDORES_Y_FACTURAS') && b.data.nroFactura) {
                    sum += this.parseFloatSafe(b.data.importe) || 0;
                }
            }
        }
        return sum;
    }

    validateRow(row: MappedRow, _ctx: ProcessContext): RowValidationResult {
        if (!row.documento) {
            return { valid: false, error: 'Campo requerido faltante: documento (Deudor)' };
        }
        if (!nroClienteDeFila(row)) {
            return { valid: false, error: 'Campo requerido faltante: nro_cliente (Deudor)' };
        }

        const hasMainFactura = !!row.nroFactura;
        const hasBlocksFactura = row._blocks?.some(b => b.entity === 'FACTURA' && b.data.nroFactura);

        if (!hasMainFactura && !hasBlocksFactura) {
            return { valid: false, error: 'Debe ingresar al menos una Factura (nroFactura) ya sea principal o en su bloque dinámico' };
        }

        // Validar si es estrictamente obligatorio que un contacto venga correcto:
        // Decidimos NO fallar la fila entera si el teléfono es malo. 
        // Simplemente se guardará el valor original sin normalizar.

        return { valid: true };
    }

    async processRow(row: MappedRow, ctx: ProcessContext): Promise<void> {
        const documentoStr = String(row.documento);
        const nroCliente = nroClienteDeFila(row);

        let deudorId: number;

        // 1. Gestionar el Deudor (Aislado por Remesa, Enriquecido Históricamente)
        let isNewForThisRemesa = !this.debtorCache.has(documentoStr);
        
        // Si no está en cache, verificamos en DB por las dudas (pudo ser guardado por otro proceso o en una corrida previa interrumpida)
        if (isNewForThisRemesa) {
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
        }
        
        const montoTotalParsed = this.parseFloatSafe(row.montoTotal);
        const rowInvoicesSum = this.getRowInvoicesSum(row);
        
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
                montoTotal: montoTotalParsed ?? rowInvoicesSum,
                fechaVencimiento: this.parseDateSafe(row.fechaVencimiento) ?? null,
                camposAdicionales: row.camposAdicionales ?? Prisma.JsonNull,
                estadoSituacionId: ctx.defaults.estadoSituacionId,
                estadoGestionId: ctx.defaults.estadoGestionId,
            },
            update: {
                nroCliente: nroCliente || undefined,
                nombre: row.nombre ?? undefined,
                apellido: row.apellido ?? undefined,
                montoTotal: montoTotalParsed !== undefined
                    ? montoTotalParsed
                    : { increment: rowInvoicesSum },
                fechaVencimiento: this.parseDateSafe(row.fechaVencimiento) ?? undefined,
                camposAdicionales: row.camposAdicionales ?? undefined,
            },
        });

        deudorId = deudor.id;

        // -- ENRIQUECIMIENTO HISTÓRICO GLOBAL --
        if (isNewForThisRemesa && !this.debtorCache.has(documentoStr)) {
            this.debtorCache.set(documentoStr, deudorId);
            
            if (documentoStr) {
                // Buscamos TODOS los contactos históricos de cualquier deudor que comparta este DNI
                const historicContacts = await ctx.prisma.contacto.findMany({
                    where: {
                        deudor: {
                            documento: documentoStr,
                            // Excluimos la remesa actual para no auto-clonar lo que recién insertamos/vamos a insertar
                            remesaId: { not: ctx.remesaId }
                        }
                    },
                    // Usamos distinct para no traer 5 teléfonos idénticos si apareció en 5 campañas pasadas
                    distinct: ['tipo', 'valor'],
                    select: { tipo: true, valor: true, subtipo: true, prioridad: true, validado: true, whatsapp: true }
                });

                if (historicContacts.length > 0) {
                    // Preparamos el payload masivo ignorando duplicados si es necesario,
                    // Prisma `createMany` con `skipDuplicates` es ideal aquí.
                    await ctx.prisma.contacto.createMany({
                        data: historicContacts.map(hc => ({
                            deudorId: deudorId,
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

        // 2. Insertar / Actualizar la Factura Principal
        if (row.nroFactura) {
            await this.upsertFactura(deudorId, row, ctx);
        }

        // 3. Procesar Facturas y Contactos en bloques dinámicos
        if (row._blocks) {
            for (const b of row._blocks) {
                if ((b.entity === 'FACTURA' || b.entity === 'MIXTO' || b.entity === 'DEUDORES_Y_FACTURAS') && b.data.nroFactura) {
                    await this.upsertFactura(deudorId, b.data, ctx);
                } else if (b.entity === 'CONTACTO') {
                    const tieneValor = !!b.data.valor;
                    const tieneDireccion = !!(b.data.direccion_calle || b.data.direccion_numero || b.data.direccion_localidad || b.data.direccion_provincia);
                    if (tieneValor || tieneDireccion) {
                        await this.upsertContacto(deudorId, b.data, ctx);
                    }
                }
            }
        }
    }

    private async upsertContacto(deudorId: number, data: any, ctx: ProcessContext) {
        const prep = await prepararContactoImport({
            tipo: data.tipo,
            valor: data.valor,
            direccion_calle: data.direccion_calle,
            direccion_numero: data.direccion_numero,
            direccion_cp: data.direccion_cp,
            direccion_localidad: data.direccion_localidad,
            direccion_provincia: data.direccion_provincia,
        }, ctx.validarDomicilios);

        if (!prep) return;

        await ctx.prisma.contacto.upsert({
            where: {
                deudorId_tipo_valor: {
                    deudorId: deudorId,
                    tipo: prep.tipo,
                    valor: prep.valor,
                },
            },
            create: {
                deudorId: deudorId,
                tipo: prep.tipo,
                valor: prep.valor,
                subtipo: data.subtipo ?? null,
                prioridad: this.parseIntSafe(data.prioridad) ?? 0,
                validado: prep.validado,
            },
            update: {
                subtipo: data.subtipo ?? undefined,
                prioridad: this.parseIntSafe(data.prioridad) ?? undefined,
                validado: prep.validado,
            },
        });
    }

    private async upsertFactura(deudorId: number, data: any, ctx: ProcessContext) {
        await ctx.prisma.factura.upsert({
            where: {
                deudorId_nroFactura: {
                    deudorId: deudorId,
                    nroFactura: String(data.nroFactura),
                },
            },
            create: {
                deudorId: deudorId,
                nroFactura: String(data.nroFactura),
                importe: this.parseFloatSafe(data.importe) ?? 0,
                fechaEmision: this.parseDateSafe(data.fechaEmision) ?? new Date(),
                vencimiento: this.parseDateSafe(data.vencimiento) ?? new Date(),
                estado: data.estado ?? 'PENDIENTE'
            },
            update: {
                importe: this.parseFloatSafe(data.importe) ?? undefined,
                fechaEmision: this.parseDateSafe(data.fechaEmision) ?? undefined,
                vencimiento: this.parseDateSafe(data.vencimiento) ?? undefined,
                estado: data.estado ?? undefined
            },
        });
    }

    async afterAll(_ctx: ProcessContext): Promise<void> {
        clearContactoImportCaches();
        this.debtorCache.clear();
    }
}
