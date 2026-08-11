// processors/casos-cedente.processor.ts
import { ICategoryProcessor, MappedRow, ProcessContext, RowValidationResult } from './processor.interface';
import { Prisma } from '@prisma/client';
import { Logger } from '@nestjs/common';
import { normalizarTelefonoArgentino, esPosibleTelefono } from '../../../common/utils/phone-utils';
import { mergeAdicionales, adicionalesEquivalentes } from '../utils/campos-adicionales';
import { enriquecerContactosHistoricos } from '../utils/enriquecimiento-historico';
import { prepararContactoImport } from '../utils/contacto-import';
import { parseFechaCedente } from '../utils/fecha-cedente';
import { AuditModulo, AuditTipo } from '../../transacciones/audit.enums';

/**
 * Base de los procesadores de **carteras que el cedente manda como casos completos + bajas sueltas**.
 *
 * Cubre los dos formatos que operamos con esa lógica, que difieren solo en cómo llega el archivo:
 *
 *  - **MULTIRREGISTRO** (Toyota cuenta 87): un TXT con varios tipos de línea (`CLI`/`GES`/`DET`/`BAJ`).
 *  - **MULTIARCHIVO** (Toyota TCFA): un paquete de 4 archivos (Deudores, DetalleDeuda, Bajas, CoDeudores).
 *
 * Cada parser resuelve su formato y emite las **mismas filas normalizadas**, así que la lógica de
 * negocio —que es la parte cara y la que ya nos costó incidentes— vive una sola vez acá. Las filas
 * son de dos clases, distinguidas por `_tipo`:
 *
 *  - **CASO**: un cliente con sus facturas (una por aviso o por cuota) y sus contactos.
 *      - El deudor se busca por `nroCliente` en **toda la empresa**, no en una remesa: como cada día
 *        los casos nuevos entran en una remesa nueva, un cliente ya cargado puede estar en cualquier
 *        remesa previa. Buscarlo por remesa lo duplicaría a diario.
 *      - Las facturas se upsertean por `(deudorId, nroFactura)`: si ya existe se le actualizan importe,
 *        desglose y vencimiento (los días de mora cambian todos los días), si no se crea.
 *      - `montoTotal` del deudor = Σ de sus facturas.
 *
 *  - **BAJA**: una factura a dar de baja. El motivo decide si el cliente **pagó** (se registra el pago)
 *      o si el cedente la **retiró** de la gestión (se anula, sin inventar plata que nunca entró).
 *      El deudor sale de gestión (`GES-090` + `SIT-071`) **solo si se queda sin ninguna factura
 *      vigente**: si tenía 6 y bajaron 2, se sigue trabajando por las otras 4.
 *
 * Specs: `docs/imports-actualizacion-diaria-y-multirregistro-spec.md` §B (cuenta 87) y
 * `docs/imports-toyota-tcfa-spec.md` (TCFA).
 */

/**
 * Motivos que se toman como "la factura se pagó" cuando la plantilla no configura nada.
 * Deliberadamente corto: solo lo que inequívocamente indica cobro.
 */
const MOTIVOS_PAGO_DEFAULT = ['Pago'];

/** Estado de GESTIÓN de un caso dado de baja: sale del circuito de trabajo. */
const CLAVE_GESTION_BAJA = 'GES-090';
/** Estado de SITUACIÓN de un caso dado de baja: refleja en qué terminó la deuda. */
const CLAVE_SITUACION_BAJA = 'SIT-071';
/** Estado de GESTIÓN de un caso que el cedente sacó de la cartera (reversible). */
const CLAVE_GESTION_DESASIGNADO = 'GES-094';
/** Estado de SITUACIÓN de un caso cancelado: nunca se lo desasigna ni se lo re-asigna. */
const CLAVE_SITUACION_CANCELADO = 'SIT-050';

/** Qué hacer con los casos de la cartera ausentes del archivo. */
export type AccionAusenteCaso = 'DESASIGNAR' | 'IGNORAR';

/**
 * A partir de qué proporción de la cartera desasignada se loguea una alerta.
 * No frena el import —la acción es una decisión explícita de la plantilla— pero deja rastro en el
 * log y en la auditoría, que es lo que faltó para detectar rápido el incidente del 2026-07-21.
 */
const UMBRAL_ALERTA_DESASIGNACION = 0.5;

/** Parte de la config de la plantilla que decide qué baja es un cobro. */
export interface MotivosBajaConfig {
    /**
     * Códigos de motivo que significan que la factura se cobró. Cuando el cedente manda un código
     * numérico es preferible al texto: el texto lo puede reescribir sin avisar, el código no.
     */
    motivosPagoIds?: string[];
    /** Motivos por texto (match por "empieza con", sin distinguir mayúsculas). */
    motivosPago?: string[];
}

export abstract class CasosCedenteProcessor implements ICategoryProcessor {
    abstract readonly category: string;

    protected readonly logger = new Logger(this.constructor.name);

    /** De dónde saca esta categoría los motivos de baja que cuentan como pago. */
    protected abstract motivosBaja(ctx: ProcessContext): MotivosBajaConfig | undefined;

    /**
     * Documento a usar cuando el archivo **no trae** DNI/CUIT. Cada categoría define el suyo porque
     * el prefijo queda persistido en la base y cambiarlo partiría en dos una cartera ya cargada.
     */
    protected abstract placeholderDocumento(nroCliente: string): string;

    /**
     * Qué hacer con los casos de la cartera que no vinieron en el archivo.
     *
     * El default es `IGNORAR` y las categorías cuyo archivo **no** es un snapshot completo (la cuenta
     * 87 manda solo los avisos del día) no lo redefinen: para ellas un caso ausente no significa nada.
     */
    protected accionAusente(_ctx: ProcessContext): AccionAusenteCaso {
        return 'IGNORAR';
    }

    /** Deudores creados en esta corrida (para el resumen). */
    private altasCount = 0;
    /** Deudores existentes que se actualizaron. */
    private actualizadosCount = 0;
    /** Bajas aplicadas y bajas cuya factura no se encontró. */
    private bajasCount = 0;
    private bajasSinMatchCount = 0;
    /** Bajas que matchearon más de un deudor: no se aplican, hay que resolverlas a mano. */
    private bajasAmbiguasCount = 0;
    /** Bajas por pago (se registró un pago) y bajas por retiro del cedente (sin pago). */
    private bajasPagoCount = 0;
    private bajasRetiradasCount = 0;
    /** Deudores que quedaron sin ninguna factura vigente y salieron de gestión. */
    private deudoresDadosDeBajaCount = 0;
    /**
     * Deudores tocados en esta corrida (altas, actualizaciones y bajas), para consolidarlos al
     * final. NO alcanza con consolidar la remesa del import: ahí solo están los casos nuevos del
     * día, y un deudor de una remesa previa al que hoy se le registró un pago por baja quedaría
     * sin recalcular el saldo ni pasar a cancelado.
     */
    private deudoresTocados = new Set<number>();
    /**
     * Deudores que vinieron como CASO en el archivo de esta corrida.
     *
     * Distinto de `deudoresTocados`, que además incluye los tocados por una baja: que a un caso le
     * hayan bajado una cuota **no** significa que siga asignado. Este es el conjunto de "presentes"
     * que decide a quién NO desasignar.
     */
    private deudoresEnSnapshot = new Set<number>();
    /** Deudores a los que se les registró un pago en esta corrida (para cerrar promesas cumplidas). */
    private deudoresConPago = new Set<number>();
    /** Casos que volvieron al archivo y salieron de GES-094. */
    private reasignadosCount = 0;
    /** Casos que dejaron de venir y se desasignaron. */
    private desasignadosCount = 0;
    /** Contactos copiados del histórico al dar de alta un caso. */
    private contactosEnriquecidos = 0;
    /** ids de GES-090 y SIT-071; `null` = no seedeado (modo degradado). */
    private bajaIdCache: number | null | undefined = undefined;
    private situacionBajaIdCache: number | null | undefined = undefined;
    /** ids de GES-094 y SIT-050 (desasignación); `null` = no seedeado. */
    private desasignadoIdCache: number | null | undefined = undefined;
    private canceladoIdCache: number | null | undefined = undefined;
    /** ids de los parámetros del grupo "gestion", para validar el previo al re-asignar. */
    private gestionesValidasCache: Set<number> | undefined = undefined;
    /** Para no repetir el aviso de "motivosPago sin configurar" una vez por baja. */
    private avisoMotivosPagoEmitido = false;

    private reset(): void {
        this.altasCount = 0;
        this.actualizadosCount = 0;
        this.bajasCount = 0;
        this.bajasSinMatchCount = 0;
        this.bajasAmbiguasCount = 0;
        this.bajasPagoCount = 0;
        this.bajasRetiradasCount = 0;
        this.deudoresDadosDeBajaCount = 0;
        this.deudoresTocados.clear();
        this.deudoresEnSnapshot.clear();
        this.deudoresConPago.clear();
        this.reasignadosCount = 0;
        this.desasignadosCount = 0;
        this.contactosEnriquecidos = 0;
        this.bajaIdCache = undefined;
        this.situacionBajaIdCache = undefined;
        this.desasignadoIdCache = undefined;
        this.canceladoIdCache = undefined;
        this.gestionesValidasCache = undefined;
        this.avisoMotivosPagoEmitido = false;
    }

    /**
     * Número de factura de una fila de BAJA. MULTIARCHIVO lo manda compuesto (`contrato-cuota`);
     * MULTIRREGISTRO manda el nro de aviso en `aviso`.
     */
    private nroFacturaDeBaja(row: MappedRow): string {
        return String(row.nroFactura ?? row.aviso ?? '').trim();
    }

    validateRow(row: MappedRow): RowValidationResult {
        if (row._tipo === 'BAJA') {
            return this.nroFacturaDeBaja(row)
                ? { valid: true }
                : { valid: false, error: 'Baja sin número de factura/aviso' };
        }
        if (!row.nroCliente) return { valid: false, error: 'Caso sin número de cliente' };
        const facturas = (row._blocks ?? []).filter((b) => b.entity === 'FACTURA');
        // Un caso puede venir sin facturas si el cedente solo informa el total de la deuda
        // (en TCFA son las asignaciones viejas que ya no traen detalle de cuotas).
        if (facturas.length === 0 && row.montoTotalDeclarado == null) {
            return { valid: false, error: 'Caso sin facturas ni total declarado' };
        }
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
        const p = await ctx.prisma.parametro.findUnique({ where: { clave: CLAVE_GESTION_BAJA }, select: { id: true } });
        this.bajaIdCache = p?.id ?? null;
        if (this.bajaIdCache == null) {
            this.logger.warn(
                `${CLAVE_GESTION_BAJA} no seedeado — las bajas del archivo quedan inactivas en este batch. ` +
                'Correr seed-codigos-curados.ts para habilitarlas.',
            );
        }
        return this.bajaIdCache;
    }

    /**
     * Resuelve (y cachea) el id de SIT-071 "Dado de baja / Rescisión".
     *
     * La gestión (GES-090) dice que el caso sale del circuito de trabajo; la situación dice en qué
     * terminó la deuda. Si el caso se cerró por cobro, la consolidación del `afterAll` pisa esta
     * situación con SIT-050 (cancelado); si el cedente lo retiró sin pago, Σpagos es 0, la
     * consolidación lo saltea y queda SIT-071, que es lo correcto.
     *
     * Si no está seedeado se sigue adelante con la baja de gestión: es un dato de color, no debe
     * frenar el cierre del caso.
     */
    private async resolverSituacionBaja(ctx: ProcessContext): Promise<number | null> {
        if (this.situacionBajaIdCache !== undefined) return this.situacionBajaIdCache;
        const p = await ctx.prisma.parametro.findUnique({ where: { clave: CLAVE_SITUACION_BAJA }, select: { id: true } });
        this.situacionBajaIdCache = p?.id ?? null;
        if (this.situacionBajaIdCache == null) {
            this.logger.warn(
                `${CLAVE_SITUACION_BAJA} no seedeado — los casos dados de baja conservan su situación ` +
                'anterior. La baja de gestión se aplica igual.',
            );
        }
        return this.situacionBajaIdCache;
    }

    /**
     * Un cliente con sus facturas. Alta o actualización según exista ya en la empresa.
     */
    private async procesarCaso(row: MappedRow, ctx: ProcessContext): Promise<void> {
        const nroCliente = String(row.nroCliente).trim();

        // Match EMPRESA-WIDE, no por remesa: ver comentario de clase.
        const existente = await ctx.prisma.deudor.findFirst({
            where: { empresaId: ctx.empresaId, nroCliente },
            select: {
                id: true, nombre: true, documento: true, camposAdicionales: true,
                estadoGestionId: true, estadoGestionPrevioAId: true, estadoSituacionId: true,
            },
            orderBy: { id: 'asc' },
        });

        // El archivo puede traer el CUIT/CUIL real (TCFA) o no traer nada (cuenta 87).
        const documentoArchivo = String(row.documento ?? '').trim();
        let deudorId: number;

        if (existente) {
            deudorId = existente.id;
            const data: Prisma.deudorUncheckedUpdateInput = {};
            if (row.nombre && !String(existente.nombre ?? '').trim()) data.nombre = String(row.nombre);
            // Si el caso se había cargado con placeholder y ahora el cedente manda el documento
            // real, se completa. Nunca se pisa un documento real con otro: eso es un cambio de
            // identidad que tiene que revisar una persona.
            if (documentoArchivo && this.esPlaceholder(existente.documento, nroCliente)) {
                data.documento = documentoArchivo;
            }
            if (row.camposAdicionales && Object.keys(row.camposAdicionales).length > 0) {
                const merged = mergeAdicionales(existente.camposAdicionales, row.camposAdicionales);
                if (!adicionalesEquivalentes(existente.camposAdicionales, merged)) data.camposAdicionales = merged;
            }
            // Si el caso venía desasignado y hoy volvió al archivo, vuelve a su estado anterior.
            const reasignacion = await this.calcularReasignacion(existente, ctx);
            if (reasignacion) {
                Object.assign(data, reasignacion);
                this.reasignadosCount++;
            }
            if (Object.keys(data).length > 0) {
                await ctx.prisma.deudor.update({ where: { id: deudorId }, data });
            }
            this.actualizadosCount++;
        } else {
            const documento = documentoArchivo || this.placeholderDocumento(nroCliente);
            const creado = await ctx.prisma.deudor.create({
                data: {
                    empresaId: ctx.empresaId,
                    remesaId: ctx.remesaId, // los casos nuevos van a la remesa del día
                    documento,
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
            this.contactosEnriquecidos += await enriquecerContactosHistoricos(ctx, deudorId, documento);
        }

        await this.upsertFacturas(deudorId, row, ctx);
        await this.upsertContactos(deudorId, row, ctx);
        await this.ajustarMonto(deudorId, ctx, this.montoDeclarado(row));
        this.deudoresTocados.add(deudorId);
        this.deudoresEnSnapshot.add(deudorId);
    }

    /* ────────────────────────────────────────────────────────────────────────
     * Ausentes del snapshot: desasignación y su inverso, la re-asignación.
     * ──────────────────────────────────────────────────────────────────────── */

    /** Resuelve (y cachea) el id de GES-094 "Desasignado". `null` si no está seedeado. */
    private async resolverParametroDesasignado(ctx: ProcessContext): Promise<number | null> {
        if (this.desasignadoIdCache !== undefined) return this.desasignadoIdCache;
        const p = await ctx.prisma.parametro.findUnique({
            where: { clave: CLAVE_GESTION_DESASIGNADO }, select: { id: true },
        });
        this.desasignadoIdCache = p?.id ?? null;
        if (this.desasignadoIdCache == null) {
            this.logger.warn(
                `${CLAVE_GESTION_DESASIGNADO} no seedeado — la acción de ausentes "Desasignar" queda ` +
                'inactiva en este batch. Correr seed-codigos-curados.ts para habilitarla.',
            );
        }
        return this.desasignadoIdCache;
    }

    /** Resuelve (y cachea) el id de SIT-050 "Cancelado". `null` si no está seedeado. */
    private async resolverParametroCancelado(ctx: ProcessContext): Promise<number | null> {
        if (this.canceladoIdCache !== undefined) return this.canceladoIdCache;
        const p = await ctx.prisma.parametro.findUnique({
            where: { clave: CLAVE_SITUACION_CANCELADO }, select: { id: true },
        });
        this.canceladoIdCache = p?.id ?? null;
        return this.canceladoIdCache;
    }

    /** ids de los parámetros de gestión, una sola query por batch, para validar el previo. */
    private async resolverGestionesValidas(ctx: ProcessContext): Promise<Set<number>> {
        if (this.gestionesValidasCache !== undefined) return this.gestionesValidasCache;
        const gestiones = await ctx.prisma.parametro.findMany({
            where: { grupo: 'gestion' }, select: { id: true },
        });
        this.gestionesValidasCache = new Set(gestiones.map((g) => g.id));
        return this.gestionesValidasCache;
    }

    /**
     * Inverso de la desasignación: si el caso venía en GES-094 y hoy volvió al archivo, se le
     * restaura el estado de gestión que tenía antes (o el default de la plantilla si el previo ya
     * no existe). Los cancelados (SIT-050) no se tocan. Idempotente.
     */
    private async calcularReasignacion(
        deudor: { id: number; estadoGestionId: number | null; estadoGestionPrevioAId: number | null; estadoSituacionId: number | null },
        ctx: ProcessContext,
    ): Promise<Prisma.deudorUncheckedUpdateInput | null> {
        if (this.accionAusente(ctx) !== 'DESASIGNAR') return null;

        const desasignadoId = await this.resolverParametroDesasignado(ctx);
        if (desasignadoId == null) return null;
        if (deudor.estadoGestionId !== desasignadoId) return null; // no estaba desasignado

        const canceladoId = await this.resolverParametroCancelado(ctx);
        if (canceladoId != null && deudor.estadoSituacionId === canceladoId) {
            this.logger.log(`Deudor ${deudor.id} en ${CLAVE_SITUACION_CANCELADO} — no se re-asigna.`);
            return null;
        }

        let nuevoGestionId = deudor.estadoGestionPrevioAId ?? ctx.defaults.estadoGestionId;
        if (deudor.estadoGestionPrevioAId != null) {
            const validas = await this.resolverGestionesValidas(ctx);
            if (!validas.has(deudor.estadoGestionPrevioAId)) nuevoGestionId = ctx.defaults.estadoGestionId;
        }

        return { estadoGestionId: nuevoGestionId || null, estadoGestionPrevioAId: null };
    }

    /**
     * Desasigna (GES-094) los casos de la cartera que NO vinieron en el archivo de hoy.
     *
     * **Es la operación más destructiva del import**: toca miles de deudores de una y los saca del
     * circuito de trabajo. Por eso está apagada por default, acotada a la cartera de esta plantilla,
     * y con un guard que aborta si el archivo no matcheó nada. No toca deuda, pagos ni facturas: es
     * reversible (`estadoGestionPrevioAId`) y el caso vuelve solo si reaparece mañana.
     */
    private async desasignarAusentes(ctx: ProcessContext): Promise<void> {
        if (this.accionAusente(ctx) !== 'DESASIGNAR') return;

        const desasignadoId = await this.resolverParametroDesasignado(ctx);
        if (desasignadoId == null) return; // degradado, ya logueó

        // Guard 1: si el archivo no trajo un solo caso, no corresponde a esta cartera (mal mapeado,
        // empresa equivocada, batch fallido). Desasignar acá borraría la cartera entera. Es el
        // mismo guard que se agregó a ACTUALIZACIONES después de que un batch fallido desasignara
        // 342.792 deudores de Toyota (CHANGELOG 2026-07-21).
        if (this.deudoresEnSnapshot.size === 0) {
            this.logger.warn(
                `Desasignación ABORTADA (remesa=${ctx.remesaId}): 0 casos del archivo matchearon la ` +
                'cartera. No se desasigna a nadie para no vaciarla. Revisá el mapeo, el separador y la ' +
                'empresa del archivo.',
            );
            return;
        }

        // Guard 2: sin plantilla no hay forma de saber qué deudores son "de esta cartera", y el
        // universo pasaría a ser toda la empresa —que puede tener otras carteras cargadas por otras
        // plantillas y quedarían desasignadas de rebote.
        if (!ctx.plantillaId) {
            this.logger.warn(
                `Desasignación ABORTADA (remesa=${ctx.remesaId}): la remesa no tiene plantilla asociada, ` +
                'así que no se puede acotar la cartera. No se desasigna a nadie.',
            );
            return;
        }

        const canceladoId = await this.resolverParametroCancelado(ctx);
        const bajaId = await this.resolverParametroBaja(ctx);

        // La cartera son los casos que cargó ESTA plantilla, no todos los de la empresa.
        const cartera = await ctx.prisma.deudor.findMany({
            where: { empresaId: ctx.empresaId, remesa: { plantillaId: ctx.plantillaId } },
            select: { id: true, estadoGestionId: true, estadoSituacionId: true },
        });

        const paraDesasignar: Array<{ id: number; previo: number | null }> = [];
        for (const d of cartera) {
            if (this.deudoresEnSnapshot.has(d.id)) continue;                    // vino en el archivo
            if (canceladoId != null && d.estadoSituacionId === canceladoId) continue; // cancelado
            if (bajaId != null && d.estadoGestionId === bajaId) continue;       // ya dado de baja
            if (d.estadoGestionId === desasignadoId) continue;                  // ya desasignado
            paraDesasignar.push({ id: d.id, previo: d.estadoGestionId ?? null });
        }

        if (paraDesasignar.length === 0) {
            this.logger.log(`${this.category} remesa=${ctx.remesaId}: sin casos nuevos para desasignar.`);
            return;
        }

        const proporcion = cartera.length > 0 ? paraDesasignar.length / cartera.length : 0;
        if (proporcion >= UMBRAL_ALERTA_DESASIGNACION) {
            // No frena: desasignar es una decisión explícita de la plantilla. Pero deja rastro, que
            // es lo que faltó para detectar rápido el incidente de julio.
            this.logger.warn(
                `Desasignación MASIVA en remesa=${ctx.remesaId}: ${paraDesasignar.length} de ` +
                `${cartera.length} casos de la cartera (${Math.round(proporcion * 100)}%). ` +
                `El archivo trajo ${this.deudoresEnSnapshot.size} casos. Si no esperabas una baja de ` +
                'cartera así de grande, revisá que el archivo del cedente haya venido completo.',
            );
        }

        // Un UPDATE por deudor (cada uno guarda un previo distinto) → chunks transaccionales.
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

        this.desasignadosCount = paraDesasignar.length;
        this.logger.log(
            `${this.category} remesa=${ctx.remesaId}: ${paraDesasignar.length} casos desasignados ` +
            `(${CLAVE_GESTION_DESASIGNADO}) de una cartera de ${cartera.length}.`,
        );
        await ctx.auditoria.log({
            modulo: AuditModulo.IMPORT,
            entidad: 'remesa',
            entidadId: ctx.remesaId,
            tipo: AuditTipo.UPDATE,
            usuarioId: ctx.usuarioId ?? null,
            empresaId: ctx.empresaId,
            resumen:
                `Desasignación masiva: ${paraDesasignar.length} casos ausentes del archivo → ` +
                CLAVE_GESTION_DESASIGNADO,
            data: {
                count: paraDesasignar.length,
                cartera: cartera.length,
                enArchivo: this.deudoresEnSnapshot.size,
                proporcion: Math.round(proporcion * 100),
                remesaId: ctx.remesaId,
                plantillaId: ctx.plantillaId,
            },
        });
    }

    /** True si el documento guardado es el placeholder que genera esta categoría. */
    private esPlaceholder(documento: string | null | undefined, nroCliente: string): boolean {
        return !documento || documento === this.placeholderDocumento(nroCliente);
    }

    /** Deuda declarada por el cedente, si la manda y es un número usable. */
    private montoDeclarado(row: MappedRow): number | undefined {
        const v = Number(row.montoTotalDeclarado);
        return Number.isFinite(v) && v > 0 ? v : undefined;
    }

    /**
     * Crea o actualiza una factura por aviso/cuota. El archivo diario reenvía las vigentes con el
     * importe y los días de mora del día, así que una ya cargada se actualiza en vez de duplicarse.
     */
    private async upsertFacturas(deudorId: number, row: MappedRow, ctx: ProcessContext): Promise<void> {
        for (const b of row._blocks ?? []) {
            if (b.entity !== 'FACTURA' || !b.data.nroFactura) continue;
            const nroFactura = String(b.data.nroFactura).trim();
            const importe = Number(b.data.importe) || 0;
            const detalle = b.data.detalle ? String(b.data.detalle) : null;
            const contrato = b.data.contrato ? String(b.data.contrato).trim() : null;
            // TCFA manda el vencimiento real de la cuota; la cuenta 87 no trae ninguno.
            const vencimiento = b.data.vencimiento instanceof Date ? b.data.vencimiento : null;

            const actual = await ctx.prisma.factura.findUnique({
                where: { deudorId_nroFactura: { deudorId, nroFactura } },
                select: { id: true, importe: true, detalle: true, externalId: true, estado: true, vencimiento: true },
            });

            if (!actual) {
                const hoy = new Date();
                await ctx.prisma.factura.create({
                    data: {
                        deudorId,
                        nroFactura,
                        importe,
                        externalId: contrato,
                        detalle,
                        fechaEmision: hoy,
                        vencimiento: vencimiento ?? hoy,
                        estado: 'PENDIENTE',
                    },
                });
                continue;
            }

            // Solo se escribe si algo cambió: en un archivo diario la mayoría de las facturas llega
            // igual que ayer y un UPDATE por factura sería puro desperdicio.
            const data: Prisma.facturaUncheckedUpdateInput = {};
            if (Math.abs((actual.importe ?? 0) - importe) > 0.001) data.importe = importe;
            if (detalle !== actual.detalle) data.detalle = detalle;
            if (contrato && contrato !== actual.externalId) data.externalId = contrato;
            if (vencimiento && actual.vencimiento?.getTime() !== vencimiento.getTime()) {
                data.vencimiento = vencimiento;
            }
            if (Object.keys(data).length > 0) {
                await ctx.prisma.factura.update({ where: { id: actual.id }, data });
            }
        }
    }

    /**
     * Inserta los contactos nuevos del caso; el unique (deudorId, tipo, valor) evita duplicar.
     *
     * Teléfonos: se guarda el E.164. Si el número no normaliza —ni siquiera deduciendo el código de
     * área de los otros teléfonos del caso— se descarta: sin característica no se puede marcar.
     *
     * Direcciones: las resuelve `prepararContactoImport`, el mismo helper que usan el resto de las
     * categorías — arma el texto a partir de calle/número/CP/localidad/provincia y, **solo si la
     * remesa pidió validar domicilios**, lo normaliza contra Georef. Sin ese flag no hay llamadas de
     * red: es formateo puro.
     */
    private async upsertContactos(deudorId: number, row: MappedRow, ctx: ProcessContext): Promise<void> {
        const nuevos: Array<{ deudorId: number; tipo: string; valor: string; validado: boolean; relacion?: string }> = [];

        // Los teléfonos del caso se prestan la característica entre sí (ver `normalizarTelefonoArgentino`).
        const telefonosDelCaso = (row._blocks ?? [])
            .filter((b) => b.entity === 'CONTACTO' && String(b.data?.tipo ?? 'telefono') === 'telefono')
            .map((b) => String(b.data?.valor ?? ''))
            .filter(Boolean);

        for (const b of row._blocks ?? []) {
            if (b.entity !== 'CONTACTO') continue;
            const tipo = String(b.data.tipo ?? 'telefono');
            // `relacion` dice de QUIÉN es el dato: TCFA manda los datos del codeudor junto con los
            // del titular, y llamar a uno creyendo que es el otro es un problema real de gestión.
            // Va en su propia columna y no en `subtipo`, que guarda el tipo de línea de ENACOM y
            // decide si se puede marcar como WhatsApp.
            const relacion = b.data.relacion ? String(b.data.relacion) : undefined;

            if (tipo === 'direccion') {
                // El bloque de dirección no trae `valor` sino sus partes, así que no puede pasar
                // por el camino de abajo.
                const preparado = await prepararContactoImport(b.data, ctx.validarDomicilios ?? false);
                if (!preparado) continue;
                nuevos.push({
                    deudorId, tipo: preparado.tipo, valor: preparado.valor,
                    validado: preparado.validado, ...(relacion ? { relacion } : {}),
                });
                continue;
            }

            if (!b.data.valor) continue;
            let valor = String(b.data.valor).trim();
            let validado = false;

            if (tipo === 'telefono') {
                // Misma política que el resto del pipeline: o se normaliza (deduciendo el área de
                // los otros teléfonos del caso si hace falta), o se descarta. Un número sin
                // característica no se puede marcar.
                const val = normalizarTelefonoArgentino(valor, { otrosTelefonos: telefonosDelCaso });
                if (!val.valido || !val.e164) continue;
                valor = val.e164;
                validado = true;
            }
            if (!valor) continue;
            nuevos.push({ deudorId, tipo, valor, validado, ...(relacion ? { relacion } : {}) });
        }

        if (nuevos.length > 0) {
            await ctx.prisma.contacto.createMany({ data: nuevos, skipDuplicates: true });
        }
    }

    /**
     * `montoTotal` del deudor = Σ de sus facturas, **excluyendo las ANULADAS**: ésas son facturas que
     * el cedente retiró de la gestión y ya no se reclaman, así que dejan de contar como deuda. Las
     * PAGADAS sí siguen sumando —fueron deuda real— y es el pago registrado el que baja el saldo.
     *
     * Si el deudor **no tiene ninguna factura cargada** y el cedente declara un total, se usa ése: es
     * el caso de las asignaciones viejas de TCFA, que traen `TotalDeuda` pero ya no traen el detalle
     * de las cuotas. Sin esto quedarían con deuda 0 y desaparecerían de la cartera.
     */
    private async ajustarMonto(deudorId: number, ctx: ProcessContext, montoDeclarado?: number): Promise<void> {
        const agg = await ctx.prisma.factura.aggregate({
            where: { deudorId, estado: { not: 'ANULADA' } },
            _sum: { importe: true },
            _count: true,
        });

        let total = agg._sum.importe ?? 0;

        if (montoDeclarado != null && (agg._count ?? 0) === 0) {
            // Ojo: 0 facturas vigentes también pasa cuando TODAS se anularon por baja. Ahí el saldo
            // real es 0 y restaurar el total declarado resucitaría deuda que el cedente retiró.
            const cargadas = await ctx.prisma.factura.count({ where: { deudorId } });
            if (cargadas === 0) total = montoDeclarado;
        }

        await ctx.prisma.deudor.update({ where: { id: deudorId }, data: { montoTotal: total } });
    }

    /**
     * Baja de una factura puntual (un aviso en la cuenta 87, una cuota en TCFA).
     *
     * La factura casi nunca viene en el archivo del día —el cedente la saca del detalle y la informa
     * por separado—, así que se resuelve contra lo ya cargado, empresa-wide.
     */
    private async procesarBaja(row: MappedRow, ctx: ProcessContext): Promise<void> {
        const nroFactura = this.nroFacturaDeBaja(row);
        const bajaId = await this.resolverParametroBaja(ctx);
        if (bajaId == null) return; // modo degradado, ya logueó

        const encontrada = await this.buscarFacturaDeBaja(row, nroFactura, ctx);
        if (!encontrada) return; // ya contabilizó y logueó el motivo

        const { id: facturaId, deudorId, importe } = encontrada;
        const motivo = row.motivo ? String(row.motivo).trim() : '';

        // El motivo decide si la factura se cerró porque el cliente PAGÓ o porque el cedente la
        // retiró de la gestión. En Toyota 9 de cada 10 bajas son "Días de Mora Excedidos", que NO
        // es un pago: registrar uno inventaría plata que nunca entró.
        if (this.esBajaPorPago(row, motivo, ctx)) {
            await ctx.prisma.pago.create({
                data: {
                    deudorId,
                    fecha: parseFechaCedente(row.fecha) ?? (row.fecha instanceof Date ? row.fecha : new Date()),
                    importe,
                    origen: `IMPORT_${this.category}`,
                    origenArchivo: `${this.category}_REMESA_${ctx.remesaId}`,
                    observacion: `Baja de ${nroFactura}: ${motivo || 'pago'}`,
                },
            });
            await ctx.prisma.factura.update({ where: { id: facturaId }, data: { estado: 'PAGADA' } });
            this.deudoresConPago.add(deudorId);
            this.bajasPagoCount++;
        } else {
            // Retirada de la gestión: deja de contar para la deuda (ver ajustarMonto).
            await ctx.prisma.factura.update({ where: { id: facturaId }, data: { estado: 'ANULADA' } });
            this.bajasRetiradasCount++;
        }

        // La deuda del deudor se recalcula sobre las facturas que siguen vigentes.
        await this.ajustarMonto(deudorId, ctx);
        this.deudoresTocados.add(deudorId);

        // El deudor sale de gestión SOLO si se quedó sin ninguna factura vigente: si tenía 6 y
        // bajaron 2, sigue trabajándose por las otras 4.
        const vigentes = await ctx.prisma.factura.count({
            where: { deudorId, estado: { notIn: ['PAGADA', 'ANULADA'] } },
        });
        if (vigentes === 0) {
            const situacionBajaId = await this.resolverSituacionBaja(ctx);
            await ctx.prisma.deudor.update({
                where: { id: deudorId },
                data: {
                    estadoGestionId: bajaId,
                    ...(situacionBajaId != null ? { estadoSituacionId: situacionBajaId } : {}),
                },
            });
            this.deudoresDadosDeBajaCount++;
        }

        this.bajasCount++;
    }

    /**
     * Resuelve la factura de una baja.
     *
     * Si el archivo dice **de qué cliente** es la baja (TCFA), se llega al deudor primero y a la
     * factura por su unique: no hay ambigüedad posible. Si no lo dice (cuenta 87, que solo manda el
     * nro de aviso) hay que buscar por número en toda la empresa, y ahí sí puede matchear a más de
     * un deudor —el unique de `factura` es `(deudorId, nroFactura)`, no `(empresaId, nroFactura)`—.
     * En ese caso no se da de baja a ninguno: sacar de gestión al equivocado es un error silencioso.
     */
    private async buscarFacturaDeBaja(
        row: MappedRow,
        nroFactura: string,
        ctx: ProcessContext,
    ): Promise<{ id: number; deudorId: number; importe: number } | null> {
        const nroCliente = row.nroCliente ? String(row.nroCliente).trim() : '';

        if (nroCliente) {
            const deudor = await ctx.prisma.deudor.findFirst({
                where: { empresaId: ctx.empresaId, nroCliente },
                select: { id: true },
                orderBy: { id: 'asc' },
            });
            if (!deudor) {
                this.bajasSinMatchCount++;
                this.logger.warn(`Baja de ${nroFactura}: el cliente ${nroCliente} no está cargado — se omite.`);
                return null;
            }
            const factura = await ctx.prisma.factura.findUnique({
                where: { deudorId_nroFactura: { deudorId: deudor.id, nroFactura } },
                select: { id: true, deudorId: true, importe: true },
            });
            if (!factura) {
                // Normal en la primera carga: la baja refiere a una cuota que nunca gestionamos.
                this.bajasSinMatchCount++;
                this.logger.warn(
                    `Baja de ${nroFactura}: el cliente ${nroCliente} está cargado pero no tiene esa factura — se omite.`,
                );
                return null;
            }
            return factura;
        }

        // Se traen DOS para poder detectar la ambigüedad descrita arriba.
        const facturas = await ctx.prisma.factura.findMany({
            where: { nroFactura, deudor: { empresaId: ctx.empresaId } },
            select: { id: true, deudorId: true, importe: true },
            take: 2,
        });

        if (facturas.length === 0) {
            this.bajasSinMatchCount++;
            this.logger.warn(`Baja de ${nroFactura}: no se encontró la factura en la empresa — se omite.`);
            return null;
        }
        if (facturas.length > 1) {
            this.bajasAmbiguasCount++;
            this.logger.warn(
                `Baja de ${nroFactura}: hay más de un deudor con ese número de factura en la empresa ` +
                `(${facturas.map((f) => f.deudorId).join(', ')}). No se da de baja a ninguno para no sacar ` +
                `de gestión al equivocado — revisar a mano.`,
            );
            return null;
        }
        return facturas[0];
    }

    /**
     * ¿Esta baja significa que entró plata?
     *
     * Se prefiere el **código** de motivo cuando el cedente lo manda y la plantilla lo declara: el
     * texto lo puede reescribir sin avisar. Si no hay código, se cae al match por texto.
     *
     * Si la plantilla **no trae** la lista de motivos (config creada antes de que existiera el campo)
     * se usa un default razonable en vez de asumir que ninguna baja es un pago. Esa suposición ya
     * rompió una vez en prod: la plantilla de la cuenta 87 se había creado sin `motivosPago` y el
     * aviso 171298, que vino como "Pago de Cuota/Aviso", terminó ANULADO en vez de cobrado — se
     * perdió el registro de un pago de $82.706,87. Un array vacío explícito sí se respeta: es una
     * decisión, no un olvido.
     */
    private esBajaPorPago(row: MappedRow, motivo: string, ctx: ProcessContext): boolean {
        const cfg = this.motivosBaja(ctx);
        const motivoId = row.motivoId != null ? String(row.motivoId).trim() : '';

        if (Array.isArray(cfg?.motivosPagoIds) && motivoId) {
            return cfg!.motivosPagoIds!.includes(motivoId);
        }

        let motivos = cfg?.motivosPago;
        if (!Array.isArray(motivos)) {
            motivos = MOTIVOS_PAGO_DEFAULT;
            if (!this.avisoMotivosPagoEmitido) {
                this.avisoMotivosPagoEmitido = true;
                this.logger.warn(
                    `La plantilla no define los motivos de baja por cobro: se usa el default ` +
                    `${JSON.stringify(MOTIVOS_PAGO_DEFAULT)}. Conviene declararlo explícitamente en la ` +
                    `plantilla con la lista de motivos que el cedente usa para las bajas por cobro.`,
                );
            }
        }
        return motivos.some((m) => motivo.toLowerCase().startsWith(m.toLowerCase()));
    }

    async afterAll(ctx: ProcessContext): Promise<void> {
        // Antes de consolidar: los ausentes salen de gestión, pero sin tocar deuda ni pagos, así que
        // el orden respecto de la consolidación es indistinto. Va primero para que el log de cierre
        // pueda incluir el conteo.
        await this.desasignarAusentes(ctx);

        this.logger.log(
            `${this.category} remesa=${ctx.remesaId}: ${this.altasCount} casos nuevos, ` +
            `${this.actualizadosCount} actualizados, ${this.bajasCount} facturas dadas de baja ` +
            `(${this.bajasPagoCount} por pago, ${this.bajasRetiradasCount} retiradas), ` +
            `${this.deudoresDadosDeBajaCount} deudores sin facturas vigentes → ${CLAVE_GESTION_BAJA}` +
            (this.bajasSinMatchCount > 0 ? `, ${this.bajasSinMatchCount} bajas sin match` : '') +
            (this.bajasAmbiguasCount > 0 ? `, ${this.bajasAmbiguasCount} bajas ambiguas (sin aplicar)` : '') +
            (this.desasignadosCount > 0 ? `, ${this.desasignadosCount} ausentes desasignados` : '') +
            (this.reasignadosCount > 0 ? `, ${this.reasignadosCount} re-asignados` : ''),
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
                `Import ${this.category}: ${this.altasCount} altas, ${this.actualizadosCount} actualizaciones, ` +
                `${this.bajasCount} facturas de baja (${this.bajasPagoCount} por pago), ` +
                `${this.deudoresDadosDeBajaCount} deudores fuera de gestión`,
            data: {
                altas: this.altasCount,
                actualizados: this.actualizadosCount,
                bajas: this.bajasCount,
                bajasSinMatch: this.bajasSinMatchCount,
                bajasAmbiguas: this.bajasAmbiguasCount,
                bajasPorPago: this.bajasPagoCount,
                bajasRetiradas: this.bajasRetiradasCount,
                deudoresDadosDeBaja: this.deudoresDadosDeBajaCount,
                desasignados: this.desasignadosCount,
                reasignados: this.reasignadosCount,
                remesaId: ctx.remesaId,
            },
        });

        // Consolidación final: recalcula `saldo` y la situación (SIT-050 cancelado / SIT-041 pago
        // parcial) de TODOS los deudores tocados, estén en la remesa de hoy o en una previa. Es el
        // paso que convierte los pagos registrados por las bajas en saldo 0 + cancelado.
        const ids = [...this.deudoresTocados];
        if (ids.length > 0) {
            const t0 = Date.now();
            const r = await ctx.consolidacion.consolidar({ tipo: 'DEUDORES', deudorIds: ids });
            this.logger.log(
                `Consolidación de ${ids.length} deudores tocados: ${r.aSIT050} cancelados, ` +
                `${r.aSIT041} pago parcial en ${Date.now() - t0}ms`,
            );
        }

        // Las promesas de pago que hayan quedado cumplidas por los pagos de las bajas se cierran,
        // igual que en el resto de las categorías que generan pagos.
        if (this.deudoresConPago.size > 0) {
            await ctx.promesas.cerrarCumplidas([...this.deudoresConPago]);
        }

        this.reset();
    }
}
