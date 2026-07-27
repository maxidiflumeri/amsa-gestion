// processors/multirregistro.processor.ts
import { ICategoryProcessor, MappedRow, ProcessContext, RowValidationResult } from './processor.interface';
import { Prisma } from '@prisma/client';
import { Logger } from '@nestjs/common';
import { normalizarTelefonoArgentino, esPosibleTelefono } from '../../../common/utils/phone-utils';
import { mergeAdicionales, adicionalesEquivalentes } from '../utils/campos-adicionales';
import { enriquecerContactosHistoricos } from '../utils/enriquecimiento-historico';
import { AuditModulo, AuditTipo } from '../../transacciones/audit.enums';

/**
 * Procesador MULTIRREGISTRO — archivos con varios tipos de línea (caso Toyota cuenta 87).
 *
 * El parseo y la agrupación los hace `utils/multirregistro-parser.ts`; acá llegan las filas ya
 * normalizadas, de dos clases (`_tipo`):
 *
 *  - **CASO**: un cliente con sus facturas (una por aviso) y sus contactos.
 *      - El deudor se busca por `nroCliente` en **toda la empresa**, no en una remesa: como cada
 *        día los casos nuevos entran en una remesa nueva (spec §B.1.3, B-D6), un cliente ya
 *        cargado puede estar en cualquier remesa previa. Buscarlo por remesa lo duplicaría a diario.
 *      - Las facturas se upsertean por `(deudorId, nroFactura=aviso)`: si el aviso ya existe se le
 *        actualiza importe y desglose (los días de mora cambian todos los días), si no se crea.
 *      - `montoTotal` del deudor = Σ de sus facturas.
 *
 *  - **BAJA**: un aviso a dar de baja. Se resuelve aviso → factura → deudor → `GES-090`.
 *      Las bajas refieren a avisos que **no** vienen en el GES del mismo archivo, así que la
 *      búsqueda también es empresa-wide.
 *
 * Spec: `docs/imports-actualizacion-diaria-y-multirregistro-spec.md` §B.
 */
export class MultirregistroProcessor implements ICategoryProcessor {
    readonly category = 'MULTIRREGISTRO';
    private readonly logger = new Logger(MultirregistroProcessor.name);

    /** Deudores creados en esta corrida (para el resumen). */
    private altasCount = 0;
    /** Deudores existentes que se actualizaron. */
    private actualizadosCount = 0;
    /** Bajas aplicadas y bajas cuyo aviso no se encontró. */
    private bajasCount = 0;
    private bajasSinMatchCount = 0;
    /** Contactos copiados del histórico al dar de alta un caso. */
    private contactosEnriquecidos = 0;
    /** id del parámetro GES-090; `null` = no seedeado (modo degradado). */
    private bajaIdCache: number | null | undefined = undefined;

    private reset(): void {
        this.altasCount = 0;
        this.actualizadosCount = 0;
        this.bajasCount = 0;
        this.bajasSinMatchCount = 0;
        this.contactosEnriquecidos = 0;
        this.bajaIdCache = undefined;
    }

    validateRow(row: MappedRow): RowValidationResult {
        if (row._tipo === 'BAJA') {
            return row.aviso ? { valid: true } : { valid: false, error: 'Baja sin número de aviso' };
        }
        if (!row.nroCliente) return { valid: false, error: 'Caso sin número de cliente' };
        const facturas = (row._blocks ?? []).filter((b) => b.entity === 'FACTURA');
        if (facturas.length === 0) return { valid: false, error: 'Caso sin ningún aviso' };
        return { valid: true };
    }

    async processRow(row: MappedRow, ctx: ProcessContext): Promise<void> {
        if (row._tipo === 'BAJA') {
            await this.procesarBaja(row, ctx);
            return;
        }
        await this.procesarCaso(row, ctx);
    }

    /** Resuelve (y cachea) el id de GES-090 "Dado de baja del sistema". */
    private async resolverParametroBaja(ctx: ProcessContext): Promise<number | null> {
        if (this.bajaIdCache !== undefined) return this.bajaIdCache;
        const p = await ctx.prisma.parametro.findUnique({ where: { clave: 'GES-090' }, select: { id: true } });
        this.bajaIdCache = p?.id ?? null;
        if (this.bajaIdCache == null) {
            this.logger.warn(
                'GES-090 no seedeado — las bajas del archivo quedan inactivas en este batch. ' +
                'Correr seed-codigos-curados.ts para habilitarlas.',
            );
        }
        return this.bajaIdCache;
    }

    /**
     * Un cliente con sus avisos. Alta o actualización según exista ya en la empresa.
     */
    private async procesarCaso(row: MappedRow, ctx: ProcessContext): Promise<void> {
        const nroCliente = String(row.nroCliente).trim();

        // Match EMPRESA-WIDE, no por remesa: ver comentario de clase.
        const existente = await ctx.prisma.deudor.findFirst({
            where: { empresaId: ctx.empresaId, nroCliente },
            select: { id: true, nombre: true, camposAdicionales: true },
            orderBy: { id: 'asc' },
        });

        let deudorId: number;

        if (existente) {
            deudorId = existente.id;
            const data: Prisma.deudorUncheckedUpdateInput = {};
            if (row.nombre && !String(existente.nombre ?? '').trim()) data.nombre = String(row.nombre);
            if (row.camposAdicionales && Object.keys(row.camposAdicionales).length > 0) {
                const merged = mergeAdicionales(existente.camposAdicionales, row.camposAdicionales);
                if (!adicionalesEquivalentes(existente.camposAdicionales, merged)) data.camposAdicionales = merged;
            }
            if (Object.keys(data).length > 0) {
                await ctx.prisma.deudor.update({ where: { id: deudorId }, data });
            }
            this.actualizadosCount++;
        } else {
            // El archivo no trae DNI, así que el documento va con placeholder derivado del nro de
            // cliente: estable entre días (no usa timestamp) y único dentro de la empresa.
            const creado = await ctx.prisma.deudor.create({
                data: {
                    empresaId: ctx.empresaId,
                    remesaId: ctx.remesaId, // los casos nuevos van a la remesa del día (B-D6)
                    documento: `SIN_DOC_${nroCliente}`,
                    nroCliente,
                    nombre: row.nombre ? String(row.nombre) : '',
                    apellido: '',
                    montoTotal: 0,
                    camposAdicionales: row.camposAdicionales ?? Prisma.JsonNull,
                    estadoSituacionId: ctx.defaults.estadoSituacionId,
                    estadoGestionId: ctx.defaults.estadoGestionId,
                },
            });
            deudorId = creado.id;
            this.altasCount++;
            this.contactosEnriquecidos += await enriquecerContactosHistoricos(ctx, deudorId, `SIN_DOC_${nroCliente}`);
        }

        await this.upsertFacturas(deudorId, row, ctx);
        await this.upsertContactos(deudorId, row, ctx);
        await this.recalcularMonto(deudorId, ctx);
    }

    /**
     * Crea o actualiza una factura por aviso. El archivo diario reenvía los avisos vigentes con el
     * importe y los días de mora del día, así que un aviso ya cargado se actualiza en vez de
     * duplicarse.
     */
    private async upsertFacturas(deudorId: number, row: MappedRow, ctx: ProcessContext): Promise<void> {
        for (const b of row._blocks ?? []) {
            if (b.entity !== 'FACTURA' || !b.data.nroFactura) continue;
            const nroFactura = String(b.data.nroFactura).trim();
            const importe = Number(b.data.importe) || 0;
            const detalle = b.data.detalle ? String(b.data.detalle) : null;
            const contrato = b.data.contrato ? String(b.data.contrato).trim() : null;

            const actual = await ctx.prisma.factura.findUnique({
                where: { deudorId_nroFactura: { deudorId, nroFactura } },
                select: { id: true, importe: true, detalle: true, externalId: true, estado: true },
            });

            if (!actual) {
                await ctx.prisma.factura.create({
                    data: {
                        deudorId,
                        nroFactura,
                        importe,
                        externalId: contrato,
                        detalle,
                        fechaEmision: new Date(),
                        vencimiento: new Date(),
                        estado: 'PENDIENTE',
                    },
                });
                continue;
            }

            // Solo se escribe si algo cambió: en un archivo diario la mayoría de los avisos llega
            // igual que ayer y un UPDATE por factura sería puro desperdicio.
            const data: Prisma.facturaUncheckedUpdateInput = {};
            if (Math.abs((actual.importe ?? 0) - importe) > 0.001) data.importe = importe;
            if (detalle !== actual.detalle) data.detalle = detalle;
            if (contrato && contrato !== actual.externalId) data.externalId = contrato;
            if (Object.keys(data).length > 0) {
                await ctx.prisma.factura.update({ where: { id: actual.id }, data });
            }
        }
    }

    /**
     * Inserta los contactos nuevos del caso; el unique (deudorId, tipo, valor) evita duplicar.
     * Mismo criterio que el resto de los processors: se guarda el E.164 y se marca validado
     * cuando el número normaliza; si no normaliza pero es plausible se guarda tal cual; la
     * basura evidente (ceros, secuencias de relleno) se descarta.
     */
    private async upsertContactos(deudorId: number, row: MappedRow, ctx: ProcessContext): Promise<void> {
        const nuevos: Array<{ deudorId: number; tipo: string; valor: string; validado: boolean }> = [];

        for (const b of row._blocks ?? []) {
            if (b.entity !== 'CONTACTO' || !b.data.valor) continue;
            const tipo = String(b.data.tipo ?? 'telefono');
            let valor = String(b.data.valor).trim();
            let validado = false;

            if (tipo === 'telefono') {
                const val = normalizarTelefonoArgentino(valor);
                if (val.valido && val.e164) {
                    valor = val.e164;
                    validado = true;
                } else if (!esPosibleTelefono(valor)) {
                    continue;
                }
            }
            if (!valor) continue;
            nuevos.push({ deudorId, tipo, valor, validado });
        }

        if (nuevos.length > 0) {
            await ctx.prisma.contacto.createMany({ data: nuevos, skipDuplicates: true });
        }
    }

    /** `montoTotal` del deudor = Σ de sus facturas (el archivo es la fuente de verdad de la deuda). */
    private async recalcularMonto(deudorId: number, ctx: ProcessContext): Promise<void> {
        const agg = await ctx.prisma.factura.aggregate({ where: { deudorId }, _sum: { importe: true } });
        const total = agg._sum.importe ?? 0;
        await ctx.prisma.deudor.update({ where: { id: deudorId }, data: { montoTotal: total } });
    }

    /**
     * Baja: el archivo manda el nro de aviso, que es el `nroFactura`. Se resuelve la factura para
     * llegar al deudor y se lo marca GES-090. La búsqueda es empresa-wide porque el aviso puede
     * haber entrado en cualquier remesa previa.
     */
    private async procesarBaja(row: MappedRow, ctx: ProcessContext): Promise<void> {
        const aviso = String(row.aviso).trim();
        const bajaId = await this.resolverParametroBaja(ctx);
        if (bajaId == null) return; // modo degradado, ya logueó

        const factura = await ctx.prisma.factura.findFirst({
            where: { nroFactura: aviso, deudor: { empresaId: ctx.empresaId } },
            select: { deudorId: true },
        });

        if (!factura) {
            // Normal en la primera carga y en bajas de casos que nunca se gestionaron acá.
            this.bajasSinMatchCount++;
            this.logger.warn(`Baja del aviso ${aviso}: no se encontró la factura en la empresa — se omite.`);
            return;
        }

        await ctx.prisma.deudor.update({
            where: { id: factura.deudorId },
            data: { estadoGestionId: bajaId },
        });
        this.bajasCount++;
    }

    async afterAll(ctx: ProcessContext): Promise<void> {
        this.logger.log(
            `MULTIRREGISTRO remesa=${ctx.remesaId}: ${this.altasCount} casos nuevos, ` +
            `${this.actualizadosCount} actualizados, ${this.bajasCount} bajas aplicadas` +
            (this.bajasSinMatchCount > 0 ? `, ${this.bajasSinMatchCount} bajas sin match` : ''),
        );
        if (this.contactosEnriquecidos > 0) {
            this.logger.log(`Autoenriquecimiento histórico: ${this.contactosEnriquecidos} contactos copiados desde la base.`);
        }

        await ctx.auditoria.log({
            modulo: AuditModulo.IMPORT,
            entidad: 'remesa',
            entidadId: ctx.remesaId,
            tipo: AuditTipo.UPDATE,
            usuarioId: ctx.usuarioId ?? null,
            empresaId: ctx.empresaId,
            resumen:
                `Import multirregistro: ${this.altasCount} altas, ${this.actualizadosCount} actualizaciones, ` +
                `${this.bajasCount} bajas`,
            data: {
                altas: this.altasCount,
                actualizados: this.actualizadosCount,
                bajas: this.bajasCount,
                bajasSinMatch: this.bajasSinMatchCount,
                remesaId: ctx.remesaId,
            },
        });

        // La situación de los casos nuevos y de los que cambiaron de deuda se recalcula igual que
        // en el resto de las categorías.
        await ctx.consolidacion.consolidar({ tipo: 'REMESA', remesaId: ctx.remesaId });
        this.reset();
    }
}
