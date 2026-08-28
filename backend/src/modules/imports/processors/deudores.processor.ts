// processors/deudores.processor.ts
import { ICategoryProcessor, MappedRow, ProcessContext, RowValidationResult } from './processor.interface';
import { Logger } from '@nestjs/common';
import { nroClienteDeFila } from '../utils/nro-cliente';
import { documentoDeFila } from '../utils/documento';
import { procesarBloquesDeudor } from '../utils/procesar-bloques';
import { enriquecerContactosHistoricos } from '../utils/enriquecimiento-historico';
import { upsertDeudorPorIdentidad } from '../utils/identidad-deudor';

export class DeudoresProcessor implements ICategoryProcessor {
    readonly category = 'DEUDORES';
    private readonly logger = new Logger(DeudoresProcessor.name);
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

        // Qué identifica al caso dentro de la remesa lo decide la plantilla: para casi todas las
        // carteras es el documento, para las de telefonía es el número de cuenta (un mismo DNI
        // tiene la cuenta madre y las hijas, y cada una es un caso). Ver `identidad-deudor.ts`.
        const { id: deudorId, creado } = await upsertDeudorPorIdentidad(ctx, {
            documento: documentoStr,
            nroCliente: nroCliente || null,
            nombre: row.nombre ?? '',
            apellido: row.apellido ?? '',
            montoTotal: this.parseFloatSafe(row.montoTotal),
            fechaVencimiento: this.parseDateSafe(row.fechaVencimiento),
            camposAdicionales: row.camposAdicionales,
        });

        // Bloques repetitivos (facturas/contactos) → se procesan en cualquier categoría.
        await procesarBloquesDeudor(deudorId, row._blocks, ctx);

        // Autoenriquecimiento de contactos desde la propia base (histórico por DNI).
        // Solo para deudores nuevos en esta remesa; el helper saltea placeholders (sin DNI).
        if (creado) {
            this.contactosEnriquecidos += await enriquecerContactosHistoricos(ctx, deudorId, documentoStr);
        }
    }

    async afterAll(_ctx: ProcessContext): Promise<void> {
        if (this.contactosEnriquecidos > 0) {
            this.logger.log(
                `Autoenriquecimiento histórico: ${this.contactosEnriquecidos} contactos copiados desde la base.`,
            );
        }
        this.contactosEnriquecidos = 0;
    }
}
