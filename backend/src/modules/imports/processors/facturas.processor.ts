// processors/facturas.processor.ts
import {
    BatchRow, BatchRowError, ICategoryProcessor, MappedRow, ProcessContext, RowValidationResult,
} from './processor.interface';
import { Prisma } from '@prisma/client';
import { procesarBloquesDeudor } from '../utils/procesar-bloques';
import { mergeCamposAdicionalesEnDeudores, recalcularMontoTotalDesdeFacturas } from '../utils/monto-facturas';

/** Filas por `INSERT ... ON DUPLICATE KEY UPDATE`. Acota el tamaño del statement contra MySQL. */
const CHUNK_UPSERT = 500;

export class FacturasProcessor implements ICategoryProcessor {
    readonly category = 'FACTURAS';

    /** Deudores tocados en este batch → se recalcula su montoTotal en afterAll. */
    private touchedDeudorIds = new Set<number>();
    /** Extras (datos adicionales del archivo de facturas) acumulados por deudor → se mergean en afterAll. */
    private extrasPorDeudor = new Map<number, Record<string, any>>();
    /**
     * `nroCliente` → `deudorId` de la remesa origen, cacheado **entre lotes**.
     *
     * Un archivo de facturas repite el mismo cliente en muchas filas (AYSA: 1.115.323 partidas de
     * 21.335 cuentas, ~52 por caso), así que sin cache el mismo deudor se resuelve decenas de veces.
     * El mapa completo de una cartera grande son decenas de miles de entradas: entra sobrado.
     */
    private deudorPorNroCliente = new Map<string, number>();
    /** nroCliente que ya se buscaron y no existen: evita repetir la búsqueda fallida en cada lote. */
    private inexistentes = new Set<string>();

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

    /**
     * Camino de una sola fila. Delega en `processBatch` con un lote de 1 para que exista una única
     * implementación (mismo criterio que ACTUALIZACIONES).
     */
    async processRow(row: MappedRow, ctx: ProcessContext): Promise<void> {
        const [fallo] = await this.processBatch([{ row, idx: 0 }], ctx);
        if (fallo) throw new Error(fallo.error);
    }

    /**
     * Camino por LOTE.
     *
     * Antes cada fila hacía un `SELECT` del deudor y un `upsert` de la factura: con las 1.115.323
     * partidas de una bajada de AYSA son 2,2 millones de round-trips a MySQL, o sea horas. Acá los
     * deudores del lote se resuelven con un `IN (...)` (y quedan cacheados para los lotes
     * siguientes) y las facturas se escriben con un `INSERT ... ON DUPLICATE KEY UPDATE` cada 500.
     */
    async processBatch(rows: BatchRow[], ctx: ProcessContext): Promise<BatchRowError[]> {
        const errores: BatchRowError[] = [];
        const targetRemesaId = ctx.remesaOrigenId ?? ctx.remesaId;

        // ── 1. Resolver los deudores que faltan, todos juntos ────────────────────────
        const aBuscar = [...new Set(
            rows
                .map((r) => String(r.row.nro_cliente ?? '').trim())
                .filter((n) => n && !this.deudorPorNroCliente.has(n) && !this.inexistentes.has(n)),
        )];

        for (let i = 0; i < aBuscar.length; i += CHUNK_UPSERT) {
            const chunk = aBuscar.slice(i, i + CHUNK_UPSERT);
            const encontrados = await ctx.prisma.deudor.findMany({
                where: { empresaId: ctx.empresaId, remesaId: targetRemesaId, nroCliente: { in: chunk } },
                select: { id: true, nroCliente: true },
            });
            for (const d of encontrados) {
                if (d.nroCliente) this.deudorPorNroCliente.set(d.nroCliente, d.id);
            }
        }
        for (const n of aBuscar) {
            if (!this.deudorPorNroCliente.has(n)) this.inexistentes.add(n);
        }

        // ── 2. Armar las facturas a escribir ────────────────────────────────────────
        /** Última fila por (deudorId, nroFactura): si el archivo repite una factura, gana la última. */
        const porClave = new Map<string, { idx: number; deudorId: number; datos: FacturaDatos }>();
        /** Filas con bloques repetitivos, que se procesan de a una (no son el caso común). */
        const conBloques: Array<{ idx: number; deudorId: number; row: MappedRow }> = [];

        for (const { row, idx } of rows) {
            const nroCliente = String(row.nro_cliente ?? '').trim();
            const deudorId = this.deudorPorNroCliente.get(nroCliente);
            if (!deudorId) {
                errores.push({ idx, error: `Deudor no encontrado (nro_cliente=${nroCliente})` });
                continue;
            }

            const nroFactura = String(row.nroFactura);
            porClave.set(`${deudorId}|${nroFactura}`, {
                idx,
                deudorId,
                datos: {
                    deudorId,
                    nroFactura,
                    // `null` = la fila no trae el dato. Se distingue de 0 porque al actualizar una
                    // factura ya cargada hay que **conservar** lo que estaba, no ponerle 0.
                    importe: row.importe == null || row.importe === '' ? null : Number(row.importe) || 0,
                    fechaEmision: aFecha(row.fechaEmision),
                    vencimiento: aFecha(row.vencimiento),
                },
            });

            if (row._blocks?.length) conBloques.push({ idx, deudorId, row });

            this.touchedDeudorIds.add(deudorId);

            // Datos adicionales configurados en el mapeo de facturas → se cargan en el deudor.
            if (row.camposAdicionales && Object.keys(row.camposAdicionales).length > 0) {
                const prev = this.extrasPorDeudor.get(deudorId) ?? {};
                this.extrasPorDeudor.set(deudorId, { ...prev, ...row.camposAdicionales });
            }
        }

        // ── 3. Escribir las facturas ────────────────────────────────────────────────
        // Las filas completas van en bloque; las que no traen algún campo van de a una, porque el
        // `upsert` de Prisma las deja intactas en la factura existente y el `INSERT ... ON DUPLICATE
        // KEY UPDATE` no puede expresar "no toques esta columna solo en estas filas". En los
        // archivos reales el camino de a una casi no se usa: AYSA trae los tres campos siempre.
        const todas = [...porClave.values()];
        const completas = todas.filter((c) => esCompleta(c.datos));
        const parciales = todas.filter((c) => !esCompleta(c.datos));

        for (let i = 0; i < completas.length; i += CHUNK_UPSERT) {
            const chunk = completas.slice(i, i + CHUNK_UPSERT);
            try {
                await upsertFacturasEnBloque(ctx, chunk.map((c) => c.datos));
            } catch (e: any) {
                // El chunk entero falló: se reintenta fila por fila para no perder las buenas y
                // para que el error apunte a la que realmente lo causó.
                for (const c of chunk) {
                    try {
                        await upsertFacturasEnBloque(ctx, [c.datos]);
                    } catch (e2: any) {
                        errores.push({ idx: c.idx, error: e2.message ?? e.message ?? 'Error al guardar la factura' });
                    }
                }
            }
        }

        for (const c of parciales) {
            try {
                await upsertFacturaParcial(ctx, c.datos);
            } catch (e: any) {
                errores.push({ idx: c.idx, error: e.message ?? 'Error al guardar la factura' });
            }
        }

        // ── 4. Bloques repetitivos, si el mapeo los declara ─────────────────────────
        for (const { idx, deudorId, row } of conBloques) {
            try {
                await procesarBloquesDeudor(deudorId, row._blocks, ctx);
            } catch (e: any) {
                errores.push({ idx, error: e.message ?? 'Error procesando los bloques de la fila' });
            }
        }

        return errores;
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
        this.deudorPorNroCliente.clear();
        this.inexistentes.clear();
    }
}

/** `null` en un campo significa "la fila del archivo no lo trae". */
interface FacturaDatos {
    deudorId: number;
    nroFactura: string;
    importe: number | null;
    fechaEmision: Date | null;
    vencimiento: Date | null;
}

/** Trae los tres campos, así que se puede escribir en bloque sin perder nada de lo ya cargado. */
const esCompleta = (f: FacturaDatos): boolean =>
    f.importe != null && f.fechaEmision != null && f.vencimiento != null;

/** Normaliza a `Date` lo que traiga el mapeo, sin inventar una fecha si no se puede. */
function aFecha(valor: unknown): Date | null {
    if (valor == null || valor === '') return null;
    const d = valor instanceof Date ? valor : new Date(valor as string);
    return isNaN(d.getTime()) ? null : d;
}

/**
 * Inserta o actualiza las facturas del chunk en un solo statement, contra el unique
 * `(deudorId, nroFactura)`. Todas tienen que estar completas ({@link esCompleta}).
 *
 * Reimportar el mismo archivo es idempotente: la fila existente se pisa con los mismos valores.
 * `estado`, `externalId` y `detalle` no se tocan — los escriben otras categorías (MULTIRREGISTRO
 * guarda ahí el contrato y el desglose) y este import no tiene con qué completarlos.
 */
async function upsertFacturasEnBloque(ctx: ProcessContext, facturas: FacturaDatos[]): Promise<void> {
    if (facturas.length === 0) return;

    const values = facturas.map(
        (f) => Prisma.sql`(${f.deudorId}, ${f.nroFactura}, ${f.importe}, ${f.fechaEmision}, ${f.vencimiento}, 'PENDIENTE')`,
    );

    // `estado` solo se escribe al CREAR: si la factura ya existe puede estar PAGADA o ANULADA por un
    // import de pagos o de bajas, y reimportar el archivo del cedente no debe resucitarla a pendiente.
    await ctx.prisma.$executeRaw(Prisma.sql`
        INSERT INTO factura (deudorId, nroFactura, importe, fechaEmision, vencimiento, estado)
        VALUES ${Prisma.join(values)}
        ON DUPLICATE KEY UPDATE
            importe = VALUES(importe),
            fechaEmision = VALUES(fechaEmision),
            vencimiento = VALUES(vencimiento)
    `);
}

/**
 * Escribe una factura a la que le falta algún campo, conservando en la existente lo que el archivo
 * no trae. Es el comportamiento histórico del processor, para las plantillas que mapean solo parte
 * de los campos y reimportan el archivo sobre una cartera ya cargada.
 */
async function upsertFacturaParcial(ctx: ProcessContext, f: FacturaDatos): Promise<void> {
    await ctx.prisma.factura.upsert({
        where: { deudorId_nroFactura: { deudorId: f.deudorId, nroFactura: f.nroFactura } },
        create: {
            deudorId: f.deudorId,
            nroFactura: f.nroFactura,
            importe: f.importe ?? 0,
            fechaEmision: f.fechaEmision ?? new Date(),
            vencimiento: f.vencimiento ?? new Date(),
            estado: 'PENDIENTE',
        },
        update: {
            importe: f.importe ?? undefined,
            fechaEmision: f.fechaEmision ?? undefined,
            vencimiento: f.vencimiento ?? undefined,
        },
    });
}
