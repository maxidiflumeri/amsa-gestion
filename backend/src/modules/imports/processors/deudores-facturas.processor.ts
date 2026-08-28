import { ICategoryProcessor, MappedRow, ProcessContext, RowValidationResult } from './processor.interface';
import { Logger } from '@nestjs/common';
import { clearContactoImportCaches, prepararContactoImport } from '../utils/contacto-import';
import { nroClienteDeFila } from '../utils/nro-cliente';
import { documentoDeFila } from '../utils/documento';
import { procesarBloquesDeudor } from '../utils/procesar-bloques';
import { recalcularMontoTotalDesdeFacturas } from '../utils/monto-facturas';
import { urlComprobanteValida } from '../utils/url-comprobante';
import { enriquecerContactosHistoricos } from '../utils/enriquecimiento-historico';
import { claveIdentidad, upsertDeudorPorIdentidad } from '../utils/identidad-deudor';

export class DeudoresYFacturasProcessor implements ICategoryProcessor {
    readonly category = 'DEUDORES_Y_FACTURAS';
    private readonly logger = new Logger(DeudoresYFacturasProcessor.name);

    // Caché simple en memoria por llamada executeRemesa para evitar
    // constantes Upserts si el archivo trae muchas filas del mismo deudor seguido.
    // La clave es la que identifica al caso según la plantilla (documento o nro de cliente): con
    // identidad por nro de cliente, cachear por documento metía las tres cuentas de un mismo DNI
    // en la misma entrada. Ver `identidad-deudor.ts`.
    private debtorCache: Map<string, number> = new Map();
    /** Deudores tocados en este batch → se recalcula su montoTotal en afterAll. */
    private touchedDeudorIds = new Set<number>();
    /** Contactos copiados desde el histórico en este batch (autoenriquecimiento). */
    private contactosEnriquecidos = 0;

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

    validateRow(row: MappedRow, _ctx: ProcessContext): RowValidationResult {
        // El DNI puede faltar: en ese caso se identifica por nro_cliente y se guarda
        // un placeholder que el DNI real pisa luego (ver utils/documento.ts).
        if (!row.documento && !nroClienteDeFila(row)) {
            return { valid: false, error: 'Campo requerido faltante: documento o nro_cliente (Deudor)' };
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
        const documentoStr = documentoDeFila(row);
        const nroCliente = nroClienteDeFila(row);

        const montoTotalParsed = this.parseFloatSafe(row.montoTotal);

        // 1. Gestionar el Deudor (Aislado por Remesa, Enriquecido Históricamente).
        // La clave del caché es la misma que identifica al caso en la base: con identidad por nro
        // de cliente, las tres cuentas de un mismo DNI son tres entradas distintas.
        const clave = claveIdentidad(ctx.identidadDeudor ?? 'DOCUMENTO', {
            documento: documentoStr,
            nroCliente: nroCliente || null,
        }).valor;

        const { id: deudorId, creado } = await upsertDeudorPorIdentidad(ctx, {
            documento: documentoStr,
            nroCliente: nroCliente || null,
            nombre: row.nombre ?? '',
            apellido: row.apellido ?? '',
            // El importe se reconcilia en afterAll desde la suma real de facturas
            // (idempotente). Solo se persiste acá si vino explícito en el archivo.
            montoTotal: montoTotalParsed,
            fechaVencimiento: this.parseDateSafe(row.fechaVencimiento),
            camposAdicionales: row.camposAdicionales,
        });

        this.touchedDeudorIds.add(deudorId);

        // -- AUTOENRIQUECIMIENTO DE CONTACTOS DESDE LA PROPIA BASE (histórico por DNI) --
        if (creado && !this.debtorCache.has(clave)) {
            this.debtorCache.set(clave, deudorId);
            this.contactosEnriquecidos += await enriquecerContactosHistoricos(ctx, deudorId, documentoStr);
        }

        // 2. Insertar / Actualizar la Factura Principal
        if (row.nroFactura) {
            await this.upsertFactura(deudorId, row, ctx);
        }

        // 3. Procesar Facturas y Contactos en bloques dinámicos (lógica común a todas las categorías)
        await procesarBloquesDeudor(deudorId, row._blocks, ctx);
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
                urlComprobante: urlComprobanteValida(data.urlComprobante),
                estado: data.estado ?? 'PENDIENTE'
            },
            update: {
                importe: this.parseFloatSafe(data.importe) ?? undefined,
                fechaEmision: this.parseDateSafe(data.fechaEmision) ?? undefined,
                vencimiento: this.parseDateSafe(data.vencimiento) ?? undefined,
                urlComprobante: urlComprobanteValida(data.urlComprobante) ?? undefined,
                estado: data.estado ?? undefined
            },
        });
    }

    async afterAll(ctx: ProcessContext): Promise<void> {
        // Reconciliar el importe del deudor con la suma real de facturas (según modo)
        // y consolidar saldo/situación. Idempotente.
        await recalcularMontoTotalDesdeFacturas(ctx, [...this.touchedDeudorIds]);
        if (this.contactosEnriquecidos > 0) {
            this.logger.log(
                `Autoenriquecimiento histórico: ${this.contactosEnriquecidos} contactos copiados desde la base.`,
            );
        }
        clearContactoImportCaches();
        this.debtorCache.clear();
        this.touchedDeudorIds.clear();
        this.contactosEnriquecidos = 0;
    }
}
