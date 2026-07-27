// processors/actualizaciones.processor.ts
import { BatchRow, BatchRowError, ICategoryProcessor, MappedRow, ProcessContext, RowValidationResult } from './processor.interface';
import { Prisma } from '@prisma/client';
import { Logger } from '@nestjs/common';
import { normalizarTelefonoArgentino, esPosibleTelefono } from '../../../common/utils/phone-utils';
import { reconciliarSaldo, reconciliarAusente } from '../utils/reconciliar-actualizacion';
import { esDocumentoPlaceholder } from '../utils/documento';
import { adicionalesEquivalentes, mergeAdicionales } from '../utils/campos-adicionales';
import { enriquecerContactosHistoricos } from '../utils/enriquecimiento-historico';
import { AuditModulo, AuditTipo } from '../../transacciones/audit.enums';

/**
 * Procesador ACTUALIZACIONES — tres escenarios:
 *
 * A) Deudor ENCONTRADO en remesa origen → reconciliación por cuota/factura y/o montoTotal
 *    - Cuota en DB ausente del archivo → PAGADA + pago automático
 *    - Cuota nueva en archivo → insertar
 *    - montoTotal es INMUTABLE (Fase 3): no se actualiza (spec §1 regla 7)
 *
 * B) Deudor en el archivo pero NO en remesa origen → NUEVO CASO
 *    - Se crea SIEMPRE en la remesa origen (la cartera), no en la remesa del import: así queda
 *      junto al resto de la cartera y mañana se matchea en vez de duplicarse. Vale en cualquier
 *      modo (RECONCILIAR / SOLO_DATOS) y con cualquier accionAusente.
 *    - Se procesan sus facturas, contactos, etc.
 *
 * C) [afterAll] Deudor en remesa origen que NO apareció en el archivo → PAGÓ TODO
 *    - Todas sus facturas pendientes → PAGADA
 *    - Pago por el sum de esas facturas
 *    - montoTotal NO se toca (inmutable). ConsolidacionSituacionService lleva la situación a SIT-050.
 */
/**
 * Campos del deudor que el lote precarga. Con esto alcanza para decidir en memoria la
 * re-asignación y la actualización de identidad/adicionales, sin releer la DB por fila.
 */
const PREFETCH_SELECT = {
    id: true,
    documento: true,
    nroCliente: true,
    nombre: true,
    apellido: true,
    camposAdicionales: true,
    estadoGestionId: true,
    estadoGestionPrevioAId: true,
    estadoSituacionId: true,
} as const;

/** Deudor tal como lo trae el prefetch del lote. */
type DeudorPrefetch = {
    id: number;
    documento: string;
    nroCliente: string | null;
    nombre: string;
    apellido: string;
    camposAdicionales: Prisma.JsonValue | null;
    estadoGestionId: number | null;
    estadoGestionPrevioAId: number | null;
    estadoSituacionId: number | null;
};

export class ActualizacionesProcessor implements ICategoryProcessor {
    readonly category = 'ACTUALIZACIONES';
    private readonly logger = new Logger(ActualizacionesProcessor.name);

    /**
     * IDs de deudores considerados PRESENTES en el archivo de este batch (no se desasignan ni se
     * marcan como "pagó todo"): los que matchearon un deudor existente de la remesa origen y los
     * casos nuevos dados de alta en esa misma remesa origen (escenario B).
     */
    private processedDeudorIds = new Set<number>();
    /**
     * Cantidad de filas que matchearon un deudor EXISTENTE de la remesa origen. Se usa como
     * guard de seguridad de la desasignación: si ninguna fila del archivo matcheó la cartera
     * (archivo mal mapeado, empresa/remesa equivocada o batch fallido), NO se desasigna a nadie
     * para no borrar la cartera entera. Distinto de `processedDeudorIds`, que además cuenta altas.
     */
    private matchedExistingCount = 0;
    /** IDs de deudores a los que se les generó un pago en este batch (para cerrar promesas cumplidas) */
    private pagosDeudorIds = new Set<number>();
    /**
     * ¿Alguna fila trajo datos de deuda (facturas o montoTotal)? Defensa en profundidad:
     * si un archivo etiquetado como ACTUALIZACIONES no trae ningún dato de deuda, se omite
     * el escenario C (marcar ausentes como pagados) aunque el modo sea RECONCILIAR.
     */
    private sawReconciliationData = false;

    /**
     * Caches por batch de los parámetros GES-094 (desasignado) y SIT-050 (cancelado).
     * `undefined` = sin resolver aún; `null` = resuelto pero no seedeado (modo degradado).
     */
    private desasignadoIdCache: number | null | undefined = undefined;
    private sit050IdCache: number | null | undefined = undefined;
    /** IDs de parámetros del grupo "gestion" (para validar el previo al re-asignar). */
    private gestionesValidasCache: Set<number> | undefined = undefined;
    /** Deudores re-asignados en este batch (venían desasignados y volvieron al archivo). */
    private reasignadosCount = 0;
    /** Contactos copiados desde el histórico al crear casos nuevos (autoenriquecimiento). */
    private contactosEnriquecidos = 0;
    /** Secuencia para desambiguar los documentos placeholder de filas sin DNI. */
    private placeholderSeq = 0;

    /** Limpia el estado acumulado del batch. */
    private reset(): void {
        this.processedDeudorIds.clear();
        this.matchedExistingCount = 0;
        this.pagosDeudorIds.clear();
        this.sawReconciliationData = false;
        this.desasignadoIdCache = undefined;
        this.sit050IdCache = undefined;
        this.gestionesValidasCache = undefined;
        this.reasignadosCount = 0;
        this.contactosEnriquecidos = 0;
    }

    /** Resuelve (y cachea) el id del parámetro GES-094 "Desasignado". null si no está seedeado. */
    private async resolverParametroDesasignado(ctx: ProcessContext): Promise<number | null> {
        if (this.desasignadoIdCache !== undefined) return this.desasignadoIdCache;
        const p = await ctx.prisma.parametro.findUnique({
            where: { clave: 'GES-094' },
            select: { id: true },
        });
        if (!p) {
            this.logger.warn(
                'GES-094 no seedeado — la acción de ausentes "Desasignar" queda inactiva en este batch. ' +
                'Correr seed-codigos-curados.ts para habilitarla.',
            );
        }
        this.desasignadoIdCache = p?.id ?? null;
        return this.desasignadoIdCache;
    }

    /** Resuelve (y cachea) el id del parámetro SIT-050 "Cancelado". null si no está seedeado. */
    private async resolverParametroSit050(ctx: ProcessContext): Promise<number | null> {
        if (this.sit050IdCache !== undefined) return this.sit050IdCache;
        const p = await ctx.prisma.parametro.findUnique({
            where: { clave: 'SIT-050' },
            select: { id: true },
        });
        this.sit050IdCache = p?.id ?? null;
        return this.sit050IdCache;
    }

    /**
     * IDs de los parámetros del grupo "gestion", cargados una sola vez por batch. Reemplaza al
     * `findFirst` por deudor que hacía la re-asignación (una query por fila re-asignada).
     */
    private async resolverGestionesValidas(ctx: ProcessContext): Promise<Set<number>> {
        if (this.gestionesValidasCache !== undefined) return this.gestionesValidasCache;
        const gestiones = await ctx.prisma.parametro.findMany({
            where: { grupo: 'gestion' },
            select: { id: true },
        });
        this.gestionesValidasCache = new Set(gestiones.map((g) => g.id));
        return this.gestionesValidasCache;
    }

    /**
     * Re-asignación (inverso de la desasignación): si un deudor presente en el archivo venía
     * DESASIGNADO (GES-094), se le restaura el estado de gestión previo (`estadoGestionPrevioAId`,
     * o el default de la plantilla si el previo ya no existe) y se limpia el campo previo.
     * Los deudores en SIT-050 no se tocan. Idempotente: si no estaba desasignado, no hace nada.
     */
    private async calcularReasignacion(
        deudor: DeudorPrefetch,
        ctx: ProcessContext,
    ): Promise<Prisma.deudorUncheckedUpdateInput | null> {
        const desasignadoId = await this.resolverParametroDesasignado(ctx);
        if (desasignadoId == null) return null; // modo degradado
        if (deudor.estadoGestionId !== desasignadoId) return null; // no estaba desasignado

        const sit050Id = await this.resolverParametroSit050(ctx);
        if (sit050Id != null && deudor.estadoSituacionId === sit050Id) {
            this.logger.log(`Deudor ${deudor.id} en SIT-050 — no se re-asigna.`);
            return null;
        }

        // Restaurar el previo. Si apunta a un parámetro de gestión que ya no existe → default.
        let nuevoGestionId = deudor.estadoGestionPrevioAId ?? ctx.defaults.estadoGestionId;
        if (deudor.estadoGestionPrevioAId != null) {
            const gestionesValidas = await this.resolverGestionesValidas(ctx);
            if (!gestionesValidas.has(deudor.estadoGestionPrevioAId)) {
                nuevoGestionId = ctx.defaults.estadoGestionId;
            }
        }

        return { estadoGestionId: nuevoGestionId || null, estadoGestionPrevioAId: null };
    }

    /**
     * Desasigna (GES-094) los deudores de la remesa origen que NO aparecieron en el archivo.
     * Guarda el estado de gestión previo en `estadoGestionPrevioAId` para poder revertir.
     * No toca deuda/pagos/facturas/situación. Ignora cancelados (SIT-050) y ya desasignados.
     */
    private async desasignarAusentes(ctx: ProcessContext): Promise<void> {
        const desasignadoId = await this.resolverParametroDesasignado(ctx);
        if (desasignadoId == null) return; // degradado (ya logueó warn)

        // Guard de seguridad: si NINGUNA fila del archivo matcheó un deudor existente de la
        // remesa origen, el archivo no corresponde a esta cartera (mal mapeado, empresa/remesa
        // equivocada o batch fallido). Desasignar acá borraría la cartera entera. Se aborta.
        // (Este es el bug que desasignó 342.792 deudores de Toyota cuando todas las filas
        // fallaron la validación de deuda — ver CHANGELOG 2026-07-21.)
        if (this.matchedExistingCount === 0) {
            this.logger.warn(
                `Desasignación ABORTADA (remesa=${ctx.remesaId}, origen=${ctx.remesaOrigenId}): ` +
                `0 filas del archivo matchearon la cartera. No se desasigna a nadie para no borrar la cartera. ` +
                `Revisá el mapeo/separador/empresa del archivo.`,
            );
            return;
        }

        const sit050Id = await this.resolverParametroSit050(ctx);

        const deudores = await ctx.prisma.deudor.findMany({
            where: { remesaId: ctx.remesaOrigenId, empresaId: ctx.empresaId },
            select: { id: true, estadoGestionId: true, estadoSituacionId: true },
        });

        const paraDesasignar: Array<{ id: number; previo: number | null }> = [];
        for (const d of deudores) {
            if (this.processedDeudorIds.has(d.id)) continue;                    // vino en el archivo
            if (sit050Id != null && d.estadoSituacionId === sit050Id) continue; // cancelado
            if (d.estadoGestionId === desasignadoId) continue;                  // ya desasignado
            paraDesasignar.push({ id: d.id, previo: d.estadoGestionId ?? null });
        }

        if (paraDesasignar.length === 0) {
            this.logger.log(`Actualización diaria remesa=${ctx.remesaId}: sin deudores nuevos para desasignar.`);
            return;
        }

        // Un UPDATE por deudor (cada uno guarda un previo distinto) → chunks transaccionales de 500.
        const CHUNK = 500;
        for (let i = 0; i < paraDesasignar.length; i += CHUNK) {
            const chunk = paraDesasignar.slice(i, i + CHUNK);
            await ctx.prisma.$transaction(
                chunk.map((d) =>
                    ctx.prisma.deudor.update({
                        where: { id: d.id },
                        data: { estadoGestionId: desasignadoId, estadoGestionPrevioAId: d.previo },
                    }),
                ),
            );
        }

        this.logger.log(
            `Actualización diaria remesa=${ctx.remesaId}: ${paraDesasignar.length} deudores desasignados (GES-094).`,
        );
        await ctx.auditoria.log({
            modulo: AuditModulo.IMPORT,
            entidad: 'remesa',
            entidadId: ctx.remesaId,
            tipo: AuditTipo.UPDATE,
            usuarioId: ctx.usuarioId ?? null,
            empresaId: ctx.empresaId,
            resumen: `Desasignación masiva por actualización diaria: ${paraDesasignar.length} deudores → GES-094`,
            data: { count: paraDesasignar.length, remesaId: ctx.remesaId, remesaOrigenId: ctx.remesaOrigenId ?? null },
        });
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

    /**
     * Camino de una sola fila. Delega en `processBatch` con un lote de 1 para que exista una
     * única implementación (sin divergencias entre el camino por fila y el camino por lote).
     */
    async processRow(row: MappedRow, ctx: ProcessContext): Promise<void> {
        const [fallo] = await this.processBatch([{ row, idx: 0 }], ctx);
        if (fallo) throw new Error(fallo.error);
    }

    /**
     * Camino por LOTE (el que usa el runner). Resuelve las lecturas del lote entero con 1-2
     * `findMany ... IN (...)` y agrupa las escrituras en una sola transacción, en vez de pagar
     * 3-4 round-trips a la DB por fila.
     *
     * Motivación (CHANGELOG 2026-07-27): la actualización diaria de Toyota (~350k filas) tardaba
     * 91 min porque cada fila hacía: findUnique del deudor + findUnique para re-asignar +
     * findUnique para actualizar identidad + UPDATE. Las tres últimas eran redundantes (el mismo
     * deudor ya traído, y un UPDATE que reescribía el mismo JSON).
     *
     * Las ALTAS (escenario B) siguen siendo secuenciales: arrastran facturas, contactos y
     * autoenriquecimiento, y en el flujo diario son una fracción mínima de las filas.
     */
    async processBatch(rows: BatchRow[], ctx: ProcessContext): Promise<BatchRowError[]> {
        if (!ctx.remesaOrigenId) {
            throw new Error('ACTUALIZACIONES requiere una remesa de origen (remesaOrigenId)');
        }

        const errores: BatchRowError[] = [];
        const soloDatos = ctx.modoActualizacion === 'SOLO_DATOS';

        // Registrar si el archivo trae datos de deuda (para el guard del escenario C).
        for (const { row } of rows) {
            const hasFacturaBlocks = row._blocks?.some(
                b => (b.entity === 'FACTURA' || b.entity === 'DEUDORES_Y_FACTURAS') && b.data.nroFactura
            );
            const hasMontoTotal = row.montoTotal !== undefined && row.montoTotal !== null && row.montoTotal !== '';
            if (hasFacturaBlocks || hasMontoTotal) {
                this.sawReconciliationData = true;
                break;
            }
        }

        // ── 1. PREFETCH: una sola lectura por criterio para todo el lote ──────────
        const porDocumento = new Map<string, DeudorPrefetch>();
        const porNroCliente = new Map<string, DeudorPrefetch>();

        const documentos = [
            ...new Set(rows.filter(r => r.row.documento).map(r => String(r.row.documento).trim())),
        ];
        if (documentos.length > 0) {
            const encontrados = await ctx.prisma.deudor.findMany({
                where: {
                    empresaId: ctx.empresaId,
                    remesaId: ctx.remesaOrigenId,
                    documento: { in: documentos },
                },
                select: PREFETCH_SELECT,
            });
            for (const d of encontrados) porDocumento.set(d.documento, d);
        }

        // Fallback por nro_cliente, igual que el camino por fila: solo para las filas que no
        // matchearon por documento (o que no lo traen).
        const nrosCliente = [
            ...new Set(
                rows
                    .filter(r => {
                        if (!r.row.nro_cliente) return false;
                        const doc = r.row.documento ? String(r.row.documento).trim() : '';
                        return !doc || !porDocumento.has(doc);
                    })
                    .map(r => String(r.row.nro_cliente).trim()),
            ),
        ];
        if (nrosCliente.length > 0) {
            const encontrados = await ctx.prisma.deudor.findMany({
                where: {
                    empresaId: ctx.empresaId,
                    remesaId: ctx.remesaOrigenId,
                    nroCliente: { in: nrosCliente },
                },
                select: PREFETCH_SELECT,
            });
            for (const d of encontrados) {
                if (d.nroCliente && !porNroCliente.has(d.nroCliente)) porNroCliente.set(d.nroCliente, d);
            }
        }

        // ── 2. Resolver cada fila en memoria; acumular updates, crear las altas ───
        /** Updates pendientes del lote, con el idx de la fila que los originó (para reportar). */
        const updates: Array<{ idx: number; deudorId: number; data: Prisma.deudorUncheckedUpdateInput }> = [];
        /** Existentes que además necesitan reconciliación de deuda (modo RECONCILIAR). */
        const aReconciliar: Array<{ deudorId: number; row: MappedRow; idx: number }> = [];

        for (const { row, idx } of rows) {
            try {
                const doc = row.documento ? String(row.documento).trim() : '';
                let deudor = doc ? porDocumento.get(doc) : undefined;
                if (!deudor && row.nro_cliente) {
                    deudor = porNroCliente.get(String(row.nro_cliente).trim());
                }

                // ── ESCENARIO B: Deudor nuevo, no estaba en la remesa origen ─────
                // `crearNuevosCasos` es ORTOGONAL al modo: también en SOLO_DATOS se dan de alta
                // los casos nuevos (sin tocar deuda). Es el flujo de atención al cliente (Toyota).
                if (!deudor) {
                    // Flag crearNuevosCasos=false: solo actualizar existentes; los no encontrados
                    // se ignoran. Útil para archivos que cubren varias remesas y se aplican una
                    // por una sin duplicar los de las otras.
                    if (!ctx.crearNuevosCasos) {
                        const ref = row.documento ? `documento=${row.documento}` : `nro_cliente=${row.nro_cliente}`;
                        this.logger.warn(`Deudor no encontrado en la remesa origen (${ref}) — se omite (crearNuevosCasos=false).`);
                        continue;
                    }
                    // Alta secuencial. Se registra en el mapa del lote para que una fila repetida
                    // más adelante en el MISMO lote lo encuentre en vez de duplicarlo (el camino
                    // por fila lo lograba porque cada fila releía la DB).
                    const creado = await this.crearNuevoDeudor(row, ctx);
                    if (creado) {
                        porDocumento.set(creado.documento, creado);
                        if (creado.nroCliente) porNroCliente.set(creado.nroCliente, creado);
                    }
                    continue;
                }

                // Registrar que este deudor existente fue visto en el archivo (presente + match real)
                this.processedDeudorIds.add(deudor.id);
                this.matchedExistingCount++;

                // Re-asignación: si venía DESASIGNADO (GES-094) y hoy volvió a aparecer en el
                // archivo, se le restaura la gestión previa. Solo en modo DESASIGNAR.
                if (ctx.accionAusente === 'DESASIGNAR') {
                    const reasignacion = await this.calcularReasignacion(deudor, ctx);
                    if (reasignacion) {
                        updates.push({ idx, deudorId: deudor.id, data: reasignacion });
                        this.reasignadosCount++;
                    }
                }

                // ── ESCENARIO A: Deudor existente ────────────────────────────────
                // Siempre se completa DNI (pisa el placeholder) + se mergean los adicionales.
                const cambios = await this.calcularIdentidadYAdicionales(deudor, row, ctx);
                if (cambios) {
                    updates.push({ idx, deudorId: deudor.id, data: cambios });
                }

                if (!soloDatos) aReconciliar.push({ deudorId: deudor.id, row, idx });
            } catch (e: any) {
                errores.push({ idx, error: e?.message ?? 'Error desconocido' });
            }
        }

        // ── 3. Flush de las escrituras: N updates en UN solo round-trip ───────────
        if (updates.length > 0) {
            try {
                await ctx.prisma.$transaction(
                    updates.map((u) => ctx.prisma.deudor.update({ where: { id: u.deudorId }, data: u.data })),
                );
            } catch (e: any) {
                // La transacción es todo-o-nada: un update roto (ej. un documento que choca con
                // el unique) tumbaría el lote entero. Se reintenta uno por uno para que solo la
                // fila culpable quede como error, igual que en el camino fila a fila.
                this.logger.warn(
                    `Flush del lote falló (${updates.length} updates): ${e?.message}. Reintentando fila por fila.`,
                );
                for (const u of updates) {
                    try {
                        await ctx.prisma.deudor.update({ where: { id: u.deudorId }, data: u.data });
                    } catch (e2: any) {
                        errores.push({ idx: u.idx, error: e2?.message ?? 'Error desconocido' });
                    }
                }
            }
        }

        // ── 4. Reconciliación de deuda (solo RECONCILIAR): sigue siendo por deudor,
        // porque lee y escribe facturas/pagos de cada uno. Se saltean las filas que ya
        // fallaron antes: su estado quedó a medias y ya están contadas como error.
        const yaFallaron = new Set(errores.map((e) => e.idx));
        for (const { deudorId, row, idx } of aReconciliar) {
            if (yaFallaron.has(idx)) continue;
            try {
                await this.reconciliarDeudor(deudorId, row, ctx);
            } catch (e: any) {
                errores.push({ idx, error: e?.message ?? 'Error desconocido' });
            }
        }

        // Un error por fila: el runner cuenta `err` por elemento devuelto, así que dos
        // errores del mismo idx descuadrarían el total (ok + err ≠ filas del lote).
        const porIdx = new Map<number, BatchRowError>();
        for (const e of errores) if (!porIdx.has(e.idx)) porIdx.set(e.idx, e);
        return [...porIdx.values()];
    }

    /**
     * Calcula los cambios de identidad y datos adicionales de un deudor existente. Devuelve el
     * `data` del update, o `null` si no hay NADA que cambiar (para no gastar un UPDATE de más).
     * - DNI: si la fila trae documento y el deudor tiene un placeholder (cargado sin DNI),
     *   se pisa con el DNI real (salvo que otro deudor de la remesa ya tenga ese DNI).
     * - camposAdicionales: merge "gana el valor nuevo" (reemplaza claves existentes).
     * - nombre/apellido: se rellenan solo si están vacíos (no se pisan datos buenos).
     *
     * El deudor llega ya cargado por el prefetch del lote: no se relee la DB.
     */
    private async calcularIdentidadYAdicionales(
        actual: DeudorPrefetch,
        row: MappedRow,
        ctx: ProcessContext,
    ): Promise<Prisma.deudorUpdateInput | null> {
        const deudorId = actual.id;
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

        // Datos adicionales: merge con "gana el valor nuevo". Solo se incluye en el update si el
        // merge REALMENTE cambia algo: en un archivo diario las mismas columnas llegan idénticas
        // día tras día, y `mergeAdicionales` siempre devuelve un objeto nuevo — sin este chequeo
        // se gastaba un UPDATE por fila para reescribir el mismo JSON (ver CHANGELOG 2026-07-27).
        if (row.camposAdicionales && Object.keys(row.camposAdicionales).length > 0) {
            const merged = mergeAdicionales(actual.camposAdicionales, row.camposAdicionales);
            if (!adicionalesEquivalentes(actual.camposAdicionales, merged)) {
                data.camposAdicionales = merged;
            }
        }

        // Nombre/apellido: rellenar solo si el actual está vacío.
        if (row.nombre && !String(actual.nombre ?? '').trim()) data.nombre = String(row.nombre);
        if (row.apellido && !String(actual.apellido ?? '').trim()) data.apellido = String(row.apellido);

        return Object.keys(data).length > 0 ? data : null;
    }

    /**
     * ESCENARIO B: Crear un deudor completamente nuevo a partir de los datos del archivo.
     * Se asocia a la remesa ORIGEN (la cartera), no a la remesa del import.
     *
     * Devuelve el deudor creado para que el lote lo registre en su mapa: si el mismo documento
     * vuelve a aparecer más adelante en el MISMO lote, se trata como existente en vez de
     * duplicarlo (el camino por fila lo conseguía porque cada fila releía la DB).
     */
    private async crearNuevoDeudor(row: MappedRow, ctx: ProcessContext): Promise<DeudorPrefetch> {
        // Placeholder para filas sin documento. Lleva un contador además del timestamp: dos altas
        // seguidas caen en el mismo milisegundo (más aún ahora que el lote no intercala queries) y
        // `SIN_DOC_${Date.now()}` a secas chocaba con el unique (empresaId, documento, remesaId).
        const documentoStr = row.documento
            ? String(row.documento).trim()
            : `SIN_DOC_${Date.now()}_${++this.placeholderSeq}`;
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

        // Los casos nuevos se suman SIEMPRE a la misma cartera (la remesa origen), no a la remesa
        // del import: la remesa de un ACTUALIZACIONES es el contenedor del job, no una cartera. Así
        // al día siguiente se matchean (no se duplican) y quedan junto al resto de la cartera.
        // `processRow` ya garantiza que remesaOrigenId existe; el fallback es defensivo.
        const remesaDestinoId = ctx.remesaOrigenId ?? ctx.remesaId;

        const deudor = await ctx.prisma.deudor.create({
            data: {
                empresaId: ctx.empresaId,
                remesaId: remesaDestinoId,
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

        // Alta en la remesa origen → marcarlo PRESENTE, siempre. Recién creado, obviamente vino en
        // el archivo de hoy: el afterAll no debe tomarlo ni para desasignar (DESASIGNAR) ni para
        // marcarlo "pagó todo" (PAGO_TODO), que lo cancelaría (SIT-050) en la misma corrida.
        this.processedDeudorIds.add(deudor.id);

        // Autoenriquecimiento de contactos desde la propia base (histórico por DNI).
        this.contactosEnriquecidos += await enriquecerContactosHistoricos(ctx, deudor.id, documentoStr);

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

        return {
            id: deudor.id,
            documento: deudor.documento,
            nroCliente: deudor.nroCliente,
            nombre: deudor.nombre,
            apellido: deudor.apellido,
            camposAdicionales: deudor.camposAdicionales,
            estadoGestionId: deudor.estadoGestionId,
            estadoGestionPrevioAId: deudor.estadoGestionPrevioAId,
            estadoSituacionId: deudor.estadoSituacionId,
        };
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

            // ¿El plan maneja un importe REAL por cuota (modelo "factura con importe") o un
            // SALDO TOTAL único (modelo ahorro/plan: las cuotas son marcadores con importe 0 y
            // el monto viene en montoTotal)? En el modelo de saldo único NO se genera un pago
            // por cuota faltante (evita los "pagos fantasma" de dividir el saldo remanente por
            // la cantidad de cuotas): el pago se deriva del total con reconciliarSaldoTotal.
            const hayImportesReales =
                facturasEnDB.some(f => f.importe > 0) ||
                [...nrosEnArchivo.values()].some(d => (d.importe ?? 0) > 0);

            // Cuotas pagadas (en DB pero no en archivo) → PAGADA. Se registra un pago por cuota
            // SOLO cuando la factura tiene importe propio; en el modelo de saldo único el pago
            // se genera una única vez más abajo a partir del total.
            for (const facDB of facturasEnDB) {
                if (!nrosEnArchivo.has(facDB.nroFactura)) {
                    await ctx.prisma.factura.update({ where: { id: facDB.id }, data: { estado: 'PAGADA' } });
                    if (facDB.importe > 0) {
                        await ctx.prisma.pago.create({
                            data: {
                                deudorId,
                                fecha: new Date(),
                                importe: facDB.importe,
                                origen: 'IMPORT_ACTUALIZACION',
                                origenArchivo: `ACTUALIZACION_REMESA_${ctx.remesaId}`,
                                observacion: `Pago automático - ${facDB.nroFactura}`,
                            },
                        });
                        this.pagosDeudorIds.add(deudorId);
                    }
                }
            }

            // Cambio de deuda por cuotas. Se acumula el delta (importe real) para hacer crecer el
            // montoTotal del deudor en el modelo "factura con importe":
            //  - cuota nueva (en archivo, no en DB) → suma su importe completo.
            //  - cuota existente con importe corregido → suma el delta (nuevo − viejo), para que el
            //    total refleje el valor actualizado y no el de la carga original.
            let deudaAgregada = 0;
            for (const [nroFactura, datos] of nrosEnArchivo) {
                if (!nrosEnDB.has(nroFactura)) {
                    const importeFactura = datos.importe ?? 0;
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
                    if (importeFactura > 0) deudaAgregada += importeFactura;
                } else if (datos.importe !== undefined) {
                    const facExistente = facturasEnDB.find(f => f.nroFactura === nroFactura)!;
                    const delta = datos.importe - facExistente.importe;
                    if (Math.abs(delta) > 0.001) {
                        await ctx.prisma.factura.update({
                            where: { id: facExistente.id },
                            data: { importe: datos.importe },
                        });
                        deudaAgregada += delta;
                    }
                }
            }

            // ── Ajuste de deuda / pago según el modelo ────────────────────────────
            if (hasMontoTotal && !hayImportesReales && montoNuevo !== null) {
                // Modelo saldo único: un ÚNICO pago (o ajuste de deuda si el saldo creció) por
                // el total, reconciliando contra el original y los pagos ya registrados.
                await this.reconciliarSaldoTotal(deudorId, montoNuevo, ctx);
            } else if (deudaAgregada > 0) {
                // Modelo "factura con importe": llegó deuda nueva (cuota nueva y/o corrección al
                // alza de una cuota existente) → la deuda total del deudor debe crecer por ese delta
                // (antes la factura se agregaba/actualizaba pero montoTotal quedaba en el valor de la
                // carga original). Se setea el saldo directo porque la consolidación saltea a los
                // deudores con Σpagos == 0.
                const d = await ctx.prisma.deudor.findUnique({
                    where: { id: deudorId }, select: { montoTotal: true },
                });
                const nuevoMonto = (d ? Number(d.montoTotal) : 0) + deudaAgregada;
                const yaPagado = await this.sumPagos(deudorId, ctx);
                await ctx.prisma.deudor.update({
                    where: { id: deudorId },
                    data: { montoTotal: nuevoMonto, saldo: Math.max(0, nuevoMonto - yaPagado) },
                });
            }

        } else if (montoNuevo !== null) {
            // ── Modo B: valor único = SALDO que queda (spec §3.2) ─────────────────
            await this.reconciliarSaldoTotal(deudorId, montoNuevo, ctx);
        }
    }

    /**
     * Reconciliación por SALDO TOTAL único. La usan el Modo B (valor único) y el modelo
     * ahorro/plan del Modo A. El archivo trae el saldo que queda por pagar; `montoTotal` del
     * deudor es el ORIGINAL inmutable. Genera un ÚNICO pago por la diferencia (o sube la deuda
     * si el saldo creció), restando lo YA pagado para no duplicar. Nunca un pago por cuota.
     */
    private async reconciliarSaldoTotal(deudorId: number, saldoArchivo: number, ctx: ProcessContext): Promise<void> {
        const deudorActual = await ctx.prisma.deudor.findUnique({
            where: { id: deudorId }, select: { montoTotal: true },
        });
        const montoOriginal = deudorActual ? Number(deudorActual.montoTotal) : 0; // inmutable
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
            // La deuda creció (saldo informado > original). Para que el saldo del deudor suba hay
            // que mover montoTotal: la consolidación deriva saldo = montoTotal − Σpagos y además
            // saltea a los deudores sin pagos. montoTotal es monótono no-decreciente: solo crece
            // acá; las bajas siguen siendo pagos.
            // nuevoMonto = saldoArchivo + Σpagos  ⇒  montoTotal − Σpagos = saldoArchivo (outstanding real).
            const nuevoMonto = saldoArchivo + yaPagado;
            const crecimiento = nuevoMonto - montoOriginal;
            await this.subirDeudaDeudor(deudorId, nuevoMonto, saldoArchivo, crecimiento, ctx);
        }
    }

    /**
     * Sube la deuda de un deudor (montoTotal + saldo) y refleja el aumento en las facturas
     * según `ctx.comportamientoDeudaMayor`:
     *  - FACTURA_NUEVA: genera una factura de ajuste por la diferencia.
     *  - ACTUALIZAR_SALDO: si el deudor tiene una única factura pendiente, le pisa el importe
     *    al saldo informado (sin crear facturas nuevas). Si tiene 0 o >1, no toca facturas.
     * El `saldo` se setea directo porque la consolidación saltea a los deudores con Σpagos == 0;
     * si hay pagos, la consolidación del afterAll recomputa el mismo valor.
     */
    private async subirDeudaDeudor(
        deudorId: number,
        nuevoMonto: number,
        saldoArchivo: number,
        crecimiento: number,
        ctx: ProcessContext,
    ): Promise<void> {
        await ctx.prisma.deudor.update({
            where: { id: deudorId },
            data: { montoTotal: nuevoMonto, saldo: saldoArchivo },
        });

        if (ctx.comportamientoDeudaMayor === 'ACTUALIZAR_SALDO') {
            const pendientes = await ctx.prisma.factura.findMany({
                where: { deudorId, estado: { not: 'PAGADA' } },
                select: { id: true },
            });
            if (pendientes.length === 1) {
                await ctx.prisma.factura.update({
                    where: { id: pendientes[0].id },
                    data: { importe: saldoArchivo },
                });
            } else if (pendientes.length > 1) {
                this.logger.warn(
                    `Deudor ${deudorId}: ACTUALIZAR_SALDO con ${pendientes.length} facturas pendientes — ` +
                    `se actualizó el saldo del deudor pero no se tocó ninguna factura (no se puede desambiguar).`,
                );
            }
            return;
        }

        // FACTURA_NUEVA (default): factura de ajuste por el crecimiento de la deuda.
        await ctx.prisma.factura.create({
            data: {
                deudorId, nroFactura: `AJUSTE-${ctx.remesaId}-${deudorId}-${Math.round(crecimiento)}`,
                importe: crecimiento, fechaEmision: new Date(),
                vencimiento: new Date(), estado: 'PENDIENTE',
            },
        });
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

        // Resumen de autoenriquecimiento (casos nuevos del escenario B). Se loguea antes de las
        // ramas porque cada una llama a reset() (que pone el contador en 0).
        if (this.contactosEnriquecidos > 0) {
            this.logger.log(
                `Autoenriquecimiento histórico: ${this.contactosEnriquecidos} contactos copiados desde la base.`,
            );
        }

        // En SOLO_DATOS (o si el archivo no trajo datos de deuda) no se reconcilia deuda de los
        // presentes ni se toca a los ausentes por "pagó todo". La desasignación sí puede correr.
        const skipReconciliacionDeuda =
            ctx.modoActualizacion === 'SOLO_DATOS' || !this.sawReconciliationData;

        // ── RAMA DESASIGNAR / IGNORAR (archivo diario de gestión) ──────────────────
        // Los ausentes no "pagaron todo": se desasignan (GES-094) o se ignoran. La reconciliación
        // de deuda de los presentes ya corrió fila a fila en processRow; acá solo consolidamos.
        if (ctx.accionAusente === 'DESASIGNAR' || ctx.accionAusente === 'IGNORAR') {
            if (ctx.accionAusente === 'DESASIGNAR') {
                await this.desasignarAusentes(ctx);
            }

            if (this.reasignadosCount > 0) {
                this.logger.log(
                    `Actualización diaria remesa=${ctx.remesaId}: ${this.reasignadosCount} deudores re-asignados.`,
                );
                await ctx.auditoria.log({
                    modulo: AuditModulo.IMPORT,
                    entidad: 'remesa',
                    entidadId: ctx.remesaId,
                    tipo: AuditTipo.UPDATE,
                    usuarioId: ctx.usuarioId ?? null,
                    empresaId: ctx.empresaId,
                    resumen: `Re-asignación masiva por actualización diaria: ${this.reasignadosCount} deudores`,
                    data: { count: this.reasignadosCount, remesaId: ctx.remesaId, remesaOrigenId: ctx.remesaOrigenId ?? null },
                });
            }

            if (!skipReconciliacionDeuda) {
                await ctx.consolidacion.consolidar({ tipo: 'REMESA', remesaId: ctx.remesaOrigenId });
                if (ctx.remesaId !== ctx.remesaOrigenId) {
                    await ctx.consolidacion.consolidar({ tipo: 'REMESA', remesaId: ctx.remesaId });
                }
                if (this.pagosDeudorIds.size > 0) {
                    await ctx.promesas.cerrarCumplidas([...this.pagosDeudorIds]);
                }
            }

            this.reset();
            return;
        }

        // ── RAMA PAGO_TODO (comportamiento clásico) ────────────────────────────────
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

        // Los casos nuevos ya caen en la remesa origen, así que la de arriba los cubre. Esta segunda
        // consolidación queda como red para remesas de imports viejos (previos a este cambio) que sí
        // tienen deudores propios; si está vacía es un no-op.
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
