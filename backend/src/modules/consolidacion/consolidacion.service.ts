/**
 * ConsolidacionSituacionService
 *
 * Recalcula `deudor.saldo` y transiciona `deudor.estadoSituacionId` en bloque
 * según los pagos acumulados en la tabla `pago`.
 *
 * REGLAS DE NEGOCIO (ver consolidacion-situacion-spec.md §1):
 *  - sum(pagos) == 0                                    → skip (no se toca el deudor).
 *  - sum(pagos) >= montoTotal * (1 − toleranciaPct)    → SIT-050 (Cancelado).
 *  - 0 < sum(pagos) < umbralCancelado                  → SIT-041 (Pago parcial).
 *  - saldoNuevo = max(0, montoTotal − sum(pagos))      → nunca negativo.
 *
 * Fase 4a de multiclaves (docs/multiclaves-spec.md §10) — una regla más, evaluada ANTES que las de
 * arriba (un caso puede tener la clave pagada con `montoTotal` nulo, o `Σpagos = 0` por un ajuste
 * negativo, y aun así haber pagado su clave):
 *
 *  - Regla del ARCHIVO (R11): un pago cuyo `referenciaClave` matchea una `clave_pago` de la MISMA
 *    empresa, por un importe que alcanza el de la clave (tolerancia en centavos), cancela el caso
 *    con `saldo = 0` — SIT-054 "Cancelado con quita" si la clave es QUITA, SIT-050 si es TOTAL —
 *    aunque no haya ningún convenio en la plataforma (D13).
 *  - TOTAL le gana a QUITA cuando las dos aplican a un mismo caso (determinista).
 *  - `SIT-054` puede no existir todavía en `parametro`: la regla NO deja de cancelar por eso —
 *    cancela a SIT-050 contando `sit054Degradado`, y se corrige sola en la corrida siguiente a que
 *    se cree el código (`prisma/scripts/alta-sit-054.ts`).
 *
 *  **Descartada — regla (b) del convenio (respaldo, R9/§10.10 del spec original).** El diseño
 *  original agregaba una segunda regla: si el caso tenía un convenio `CLAVE_PAGO` ACTIVO y
 *  `Σpagos (fecha ≥ día(createdAt) − 1) ≥ montoTotal del convenio`, cancelaba igual — pensada para
 *  pagos que llegan sin `nroConvenio` (manuales, o plantillas sin ese campo mapeado). Un auditor
 *  detectó que esto condona deuda sin respaldo real: un cobro común de $16.000 contra una deuda de
 *  $31.000 con un cupón de quita emitido dejaba el caso "Cancelado con quita" con saldo 0,
 *  perdonando $15.000 sin que Telecom hubiera confirmado nada — la regla solo mira el TOTAL
 *  acumulado desde una fecha, no de dónde vino la plata. El número de convenio del archivo del
 *  cedente (regla del archivo, arriba) es la única prueba real de que se pagó ESA clave; una
 *  condonación automática por monto no tiene ese respaldo y se saca del alcance de esta fase. Ver
 *  docs/multiclaves-spec.md §10.10 y §20.
 *
 * IMPORTANTE:
 *  - Este servicio escribe directo con prisma.deudor.updateMany / $executeRaw.
 *    NO pasa por DeudorBloqueoService (ver spec §8.4 y §10.10).
 *  - Es idempotente: correrlo N veces sobre el mismo estado produce el mismo resultado.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditoriaHelper } from '../transacciones/auditoria.helper';
import { AuditModulo, AuditTipo } from '../transacciones/audit.enums';
import { ConsolidacionResult, ConsolidacionScope } from './interfaces/consolidacion-result.interface';
import {
    DEFAULT_MODO_CLAVE, DEFAULT_TOLERANCIA_CLAVE_CENTAVOS, ModoClave, leerModoClave, leerToleranciaClaveCentavos,
} from './utils/config-clave-env';

const DEFAULT_BATCH_SIZE = 500;
const TOLERANCIA_MIN = 0;
const TOLERANCIA_MAX = 0.05;
const DEFAULT_TOLERANCIA = 0.01;
/** Diferencia mínima en pesos para considerar que el saldo cambió. */
const SALDO_EPSILON = 0.001;

interface ChunkRow {
    id: bigint | number;
    montoTotal: number | null;
    estadoSituacionId: bigint | number | null;
    saldo: number | null;
    totalPagado: string | number | bigint;
}

/** Una fila de la agregación de pagos-con-clave por caso (spec §10.5a). */
interface ClaveChunkRow {
    deudorId: bigint | number;
    claveId: bigint | number;
    nroConvenio: string;
    tipoClave: string; // 'TOTAL' | 'QUITA'
    importeClave: string | number;
    /** Saldo original del trámite (`clave_pago.saldoTramite`) — la base contra la que se calcula la
     * quita perdonada (spec §10.5e), NO el importe de la clave. */
    saldoTramite: string | number;
    nroTramite: string;
    nroClienteCaso: string | null;
    pagadoClave: string | number;
    mayorPagoClave: string | number;
    ultimaFecha: Date;
}

/** Decisión de cancelación por clave para un caso, lista para escribir en `aplicarChunk`. */
interface DecisionClave {
    tipoClave: 'TOTAL' | 'QUITA';
    claveId: number;
    nroConvenio: string;
    importeClave: number;
    /** Saldo original del trámite — para el mensaje de auditoría ("pagó $X de $saldoTramite"). */
    saldoTramite: number;
    pagado: number;
    ultimaFecha: Date;
}

@Injectable()
export class ConsolidacionSituacionService implements OnModuleInit {
    private readonly logger = new Logger(ConsolidacionSituacionService.name);

    private sit050Id: number | null = null;
    private sit041Id: number | null = null;
    /** `null` = SIT-054 no está seedeado (modo degradado, spec §10.7) — no lanza, cancela a SIT-050. */
    private sit054Id: number | null = null;
    private toleranciaPct: number = DEFAULT_TOLERANCIA;
    private toleranciaClaveCentavos: number = DEFAULT_TOLERANCIA_CLAVE_CENTAVOS;
    private modoClave: ModoClave = DEFAULT_MODO_CLAVE;

    constructor(
        private readonly prisma: PrismaService,
        private readonly auditoria: AuditoriaHelper,
    ) {}

    // ─── Inicialización ───────────────────────────────────────────────────────

    async onModuleInit(): Promise<void> {
        this.validarToleranciaEnv();
        this.validarConfigClaveEnv();
        await this.cachearParametrosSIT();
    }

    private validarToleranciaEnv(): void {
        const raw = process.env.CONSOLIDACION_TOLERANCIA_PCT;
        if (raw == null || raw.trim() === '') {
            this.toleranciaPct = DEFAULT_TOLERANCIA;
            this.logger.log(
                `CONSOLIDACION_TOLERANCIA_PCT no definida, usando default=${DEFAULT_TOLERANCIA}`,
            );
            return;
        }

        const parsed = parseFloat(raw);
        if (isNaN(parsed) || parsed < TOLERANCIA_MIN || parsed > TOLERANCIA_MAX) {
            throw new Error(
                `CONSOLIDACION_TOLERANCIA_PCT="${raw}" está fuera del rango aceptado [${TOLERANCIA_MIN}, ${TOLERANCIA_MAX}]. ` +
                `Corregir la variable de entorno y reiniciar. Valor recomendado: ${DEFAULT_TOLERANCIA}`,
            );
        }

        this.toleranciaPct = parsed;
        this.logger.log(`CONSOLIDACION_TOLERANCIA_PCT=${this.toleranciaPct}`);
    }

    /**
     * Fase 4a (spec §9.8/§10.5c): `CONSOLIDACION_TOLERANCIA_CLAVE_CENTAVOS` y
     * `CONSOLIDACION_CLAVE_MODO`. Un valor fuera de rango hace fallar el arranque, igual que la
     * tolerancia de siempre — a diferencia de SIT-054 ausente, que degrada en vez de romper: acá el
     * valor está simplemente mal escrito, no es un dato que "todavía no se cargó".
     */
    private validarConfigClaveEnv(): void {
        // Lectura y validación compartidas con `ClavesService` (utils/config-clave-env.ts) — un
        // único lugar que decide qué dicen estas dos variables, para que la ficha (chip "Pagada") y
        // la consolidación real nunca se desincronicen (hallazgo de la auditoría, menor #10).
        this.toleranciaClaveCentavos = leerToleranciaClaveCentavos();
        this.modoClave = leerModoClave();

        this.logger.log(
            `CONSOLIDACION_TOLERANCIA_CLAVE_CENTAVOS=${this.toleranciaClaveCentavos} CONSOLIDACION_CLAVE_MODO=${this.modoClave}`,
        );
    }

    private async cachearParametrosSIT(): Promise<void> {
        const [sit050, sit041, sit054] = await Promise.all([
            this.prisma.parametro.findUnique({ where: { clave: 'SIT-050' } }),
            this.prisma.parametro.findUnique({ where: { clave: 'SIT-041' } }),
            this.prisma.parametro.findUnique({ where: { clave: 'SIT-054' } }),
        ]);

        if (!sit050 || !sit041) {
            const faltantes = [
                !sit050 && 'SIT-050',
                !sit041 && 'SIT-041',
            ].filter(Boolean).join(', ');
            throw new Error(
                `Parámetros ${faltantes} no encontrados en la tabla parametro. ` +
                `Correr: npx ts-node prisma/seed-codigos-curados.ts`,
            );
        }

        this.sit050Id = sit050.id;
        this.sit041Id = sit041.id;

        // SIT-054 (multiclaves, spec §10.7): a diferencia de SIT-050/041, su ausencia NO frena el
        // arranque — degrada a SIT-050 y se corrige sola en cuanto se crea el código.
        this.sit054Id = sit054?.id ?? null;
        if (this.sit054Id == null) {
            this.logger.error(
                'SIT-054 no existe: las cancelaciones con quita (multiclaves) van a quedar en SIT-050. ' +
                'Correr: npx ts-node prisma/scripts/alta-sit-054.ts',
            );
        }

        this.logger.log(
            `Parámetros SIT cacheados: sit050Id=${this.sit050Id} sit041Id=${this.sit041Id} sit054Id=${this.sit054Id ?? '(ausente)'}`,
        );
    }

    /** Exponer para invalidación manual en hot reload o scripts admin. */
    async refrescarCache(): Promise<void> {
        this.logger.log('Refrescando cache de IDs de parámetros SIT...');
        await this.cachearParametrosSIT();
    }

    // ─── Método principal ─────────────────────────────────────────────────────

    async consolidar(
        scope: ConsolidacionScope,
        opts?: {
            dryRun?: boolean;
            onProgress?: (avance: number, total: number) => void;
            batchSize?: number;
            requestId?: string;
        },
    ): Promise<ConsolidacionResult> {
        const t0 = Date.now();
        const dryRun = opts?.dryRun ?? false;
        const batchSize = opts?.batchSize ?? DEFAULT_BATCH_SIZE;
        const reqId = opts?.requestId ?? '-';

        this.logger.log(
            `Consolidación iniciada scope=${scope.tipo} dryRun=${dryRun} batchSize=${batchSize} req=${reqId}`,
        );

        const result: ConsolidacionResult = {
            evaluados: 0,
            conPagos: 0,
            aSIT050: 0,
            aSIT041: 0,
            sinCambios: 0,
            saldoActualizado: 0,
            aSIT054: 0,
            aSIT050PorClave: 0,
            sit054Degradado: 0,
            durationMs: 0,
        };

        // 1. Resolver universo de deudorIds según scope
        const deudorIds = await this.resolverDeudorIds(scope);

        if (deudorIds.length === 0) {
            this.logger.log(
                `Consolidación scope=${scope.tipo} — sin deudores para evaluar. req=${reqId}`,
            );
            result.durationMs = Date.now() - t0;
            return result;
        }

        const total = deudorIds.length;
        const totalChunks = Math.ceil(total / batchSize);

        // 2. Procesar en chunks
        for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
            const start = chunkIdx * batchSize;
            const chunk = deudorIds.slice(start, start + batchSize);

            const chunkResult = await this.procesarChunk(chunk, dryRun);

            result.evaluados += chunkResult.evaluados;
            result.conPagos += chunkResult.conPagos;
            result.aSIT050 += chunkResult.aSIT050;
            result.aSIT041 += chunkResult.aSIT041;
            result.sinCambios += chunkResult.sinCambios;
            result.saldoActualizado += chunkResult.saldoActualizado;
            result.aSIT054 += chunkResult.aSIT054;
            result.aSIT050PorClave += chunkResult.aSIT050PorClave;
            result.sit054Degradado += chunkResult.sit054Degradado;

            const avance = Math.min(start + chunk.length, total);
            opts?.onProgress?.(avance, total);

            this.logger.verbose(
                `chunk ${chunkIdx + 1}/${totalChunks} evaluados=${chunkResult.evaluados} ` +
                `aSIT050=${chunkResult.aSIT050} aSIT041=${chunkResult.aSIT041} ` +
                `aSIT054=${chunkResult.aSIT054} aSIT050PorClave=${chunkResult.aSIT050PorClave} ` +
                `sinCambios=${chunkResult.sinCambios} req=${reqId}`,
            );
        }

        result.durationMs = Date.now() - t0;

        this.logger.log(
            `Consolidación done scope=${scope.tipo} evaluados=${result.evaluados} ` +
            `aSIT050=${result.aSIT050} aSIT041=${result.aSIT041} ` +
            `aSIT054=${result.aSIT054} aSIT050PorClave=${result.aSIT050PorClave} ` +
            `sit054Degradado=${result.sit054Degradado} ` +
            `sinCambios=${result.sinCambios} en ${result.durationMs}ms req=${reqId}`,
        );

        // 3. Auditoría (solo en apply, best-effort — si falla no rompemos la consolidación)
        if (!dryRun) {
            try {
                await this.auditoria.log({
                    modulo: AuditModulo.IMPORT,
                    entidad: 'Deudor',
                    tipo: AuditTipo.UPDATE,
                    resumen: `Consolidación scope=${scope.tipo} aSIT050=${result.aSIT050} aSIT041=${result.aSIT041} aSIT054=${result.aSIT054}`,
                    data: { params: scope as Record<string, any>, contexto: result as any },
                });
            } catch (e: any) {
                this.logger.warn(
                    `Auditoría de consolidación falló (best-effort): ${e?.message}`,
                );
            }
        }

        return result;
    }

    // ─── Resolución de scope ──────────────────────────────────────────────────

    private async resolverDeudorIds(scope: ConsolidacionScope): Promise<number[]> {
        if (scope.tipo === 'DEUDORES') {
            return scope.deudorIds;
        }

        if (scope.tipo === 'REMESA') {
            const rows = await this.prisma.deudor.findMany({
                where: { remesaId: scope.remesaId },
                select: { id: true },
            });
            return rows.map((r) => r.id);
        }

        if (scope.tipo === 'EMPRESA') {
            const rows = await this.prisma.deudor.findMany({
                where: { empresaId: scope.empresaId },
                select: { id: true },
            });
            return rows.map((r) => r.id);
        }

        // TODAS
        const rows = await this.prisma.deudor.findMany({ select: { id: true } });
        return rows.map((r) => r.id);
    }

    // ─── Procesamiento de un chunk ────────────────────────────────────────────

    private async procesarChunk(
        ids: number[],
        dryRun: boolean,
    ): Promise<Omit<ConsolidacionResult, 'durationMs'>> {
        const partial = {
            evaluados: 0,
            conPagos: 0,
            aSIT050: 0,
            aSIT041: 0,
            sinCambios: 0,
            saldoActualizado: 0,
            aSIT054: 0,
            aSIT050PorClave: 0,
            sit054Degradado: 0,
        };

        if (ids.length === 0) {
            return partial;
        }

        // Query agregada — una sola query para todo el chunk
        const rows = await this.prisma.$queryRaw<ChunkRow[]>`
            SELECT
                d.id,
                d.montoTotal,
                d.estadoSituacionId,
                d.saldo,
                COALESCE(SUM(p.importe), 0) AS totalPagado
            FROM deudor d
            LEFT JOIN pago p ON p.deudorId = d.id
            WHERE d.id IN (${Prisma.join(ids)})
            GROUP BY d.id, d.montoTotal, d.estadoSituacionId, d.saldo
        `;

        // ─── Fase 4a — regla (a): pagos con `referenciaClave` que matchea una clave de la MISMA
        // empresa del caso (spec §10.5a). Se joinea por `nroConvenio` + `empresaId` (único global),
        // NUNCA por `nroCliente`: eso haría que un `nroCliente` con espacios apague la regla sin que
        // nadie se entere. La comparación con el trámite se hace en memoria, más abajo.
        const clavesRows = ids.length
            ? await this.prisma.$queryRaw<ClaveChunkRow[]>`
                SELECT p.deudorId,
                       k.id            AS claveId,
                       k.nroConvenio   AS nroConvenio,
                       k.tipo          AS tipoClave,
                       k.importe       AS importeClave,
                       k.saldoTramite  AS saldoTramite,
                       k.nroTramite    AS nroTramite,
                       TRIM(d.nroCliente) AS nroClienteCaso,
                       SUM(p.importe)  AS pagadoClave,
                       MAX(p.importe)  AS mayorPagoClave,
                       MAX(p.fecha)    AS ultimaFecha
                FROM pago p
                JOIN deudor d      ON d.id = p.deudorId
                JOIN clave_pago k  ON k.nroConvenio = p.referenciaClave AND k.empresaId = d.empresaId
                WHERE p.deudorId IN (${Prisma.join(ids)}) AND p.referenciaClave IS NOT NULL
                GROUP BY p.deudorId, k.id, k.nroConvenio, k.tipo, k.importe, k.saldoTramite, k.nroTramite, d.nroCliente
            `
            : [];

        const clavesPorDeudor = new Map<number, ClaveChunkRow[]>();
        for (const r of clavesRows) {
            const deudorId = Number(r.deudorId);
            const lista = clavesPorDeudor.get(deudorId) ?? [];
            lista.push(r);
            clavesPorDeudor.set(deudorId, lista);
        }

        const sit050Ids: number[] = [];
        const sit041Ids: number[] = [];
        const sit054Ids: number[] = [];
        const sit050PorClaveIds: number[] = [];
        const decisionesClave = new Map<number, DecisionClave>();
        const now = new Date();

        for (const row of rows) {
            const deudorId = Number(row.id);
            const totalPagado = parseFloat(String(row.totalPagado));
            const saldoActual = row.saldo != null ? Number(row.saldo) : null;
            const estadoActual =
                row.estadoSituacionId != null ? Number(row.estadoSituacionId) : null;

            // ─── Regla de clave — ANTES de los salteos por montoTotal nulo o Σpagos=0: un caso
            // puede tener la clave pagada con `montoTotal` nulo, o `Σpagos=0` por un ajuste
            // negativo, y aun así haber pagado su clave (spec §10.5b).
            const decision = this.evaluarReglaDeClave(deudorId, clavesPorDeudor.get(deudorId));

            if (decision) {
                partial.evaluados++;

                const esQuita = decision.tipoClave === 'QUITA';
                const degradado = esQuita && this.sit054Id == null;
                if (degradado) partial.sit054Degradado++;
                const situacionDestino = esQuita ? (this.sit054Id ?? this.sit050Id!) : this.sit050Id!;

                const situacionCambia = situacionDestino !== estadoActual;
                const saldoCambia = saldoActual == null || Math.abs(0 - saldoActual) > SALDO_EPSILON;

                if (!situacionCambia && !saldoCambia) {
                    partial.sinCambios++;
                    continue;
                }

                if (esQuita) {
                    partial.aSIT054++;
                } else {
                    partial.aSIT050++;
                    partial.aSIT050PorClave++;
                }
                if (saldoCambia) partial.saldoActualizado++;

                if (!dryRun) {
                    if (esQuita) sit054Ids.push(deudorId); else sit050PorClaveIds.push(deudorId);
                    decisionesClave.set(deudorId, decision);
                }
                continue;
            }

            // ─── Reglas de siempre (Σpagos vs montoTotal) — SIN cambios de comportamiento.

            // Edge case §10.1: montoTotal nulo
            if (row.montoTotal == null) {
                if (totalPagado > 0) {
                    this.logger.warn(
                        `Deudor id=${deudorId} tiene montoTotal nulo y pagos > 0, no se consolida.`,
                    );
                }
                partial.sinCambios++;
                continue;
            }

            const montoTotal = Number(row.montoTotal);
            partial.evaluados++;

            // Regla 4: sin pagos → skip
            if (totalPagado === 0) {
                partial.sinCambios++;
                continue;
            }

            partial.conPagos++;

            // §10.2: saldo nunca negativo
            const saldoNuevo = Math.max(0, montoTotal - totalPagado);

            // Regla 2 y 3: umbral de cancelación
            const umbralCancelado = montoTotal * (1 - this.toleranciaPct);
            const situacionNuevaId =
                totalPagado >= umbralCancelado ? this.sit050Id! : this.sit041Id!;

            // Detectar cambios
            const saldoCambia =
                saldoActual == null ||
                Math.abs(saldoNuevo - saldoActual) > SALDO_EPSILON;
            const situacionCambia = situacionNuevaId !== estadoActual;

            if (!saldoCambia && !situacionCambia) {
                partial.sinCambios++;
                continue;
            }

            // Contadores
            if (situacionNuevaId === this.sit050Id) {
                partial.aSIT050++;
            } else {
                partial.aSIT041++;
            }

            if (saldoCambia) {
                partial.saldoActualizado++;
            }

            // Acumular para update (solo en apply)
            if (!dryRun) {
                if (situacionNuevaId === this.sit050Id) {
                    sit050Ids.push(deudorId);
                } else {
                    sit041Ids.push(deudorId);
                }
            }
        }

        // Escribir el chunk en una transacción
        if (!dryRun && (sit050Ids.length > 0 || sit041Ids.length > 0 || sit054Ids.length > 0 || sit050PorClaveIds.length > 0)) {
            await this.aplicarChunk(sit050Ids, sit041Ids, sit054Ids, sit050PorClaveIds, decisionesClave, now);
        }

        return partial;
    }

    /**
     * Regla de clave (spec §10.5): decide si un caso se cancela por el pago de una clave de pago
     * del cedente, mirando SOLO el archivo de cobros (`clavesDelCaso`, agregado por
     * `pago.referenciaClave` en `procesarChunk`). TOTAL le gana a QUITA cuando las dos están
     * cumplidas para el mismo caso.
     *
     * La regla (b) de respaldo (un convenio `CLAVE_PAGO` ACTIVO cumplido por monto, sin mirar de
     * dónde vino la plata) se descartó — ver el comentario de cabecera del archivo y
     * docs/multiclaves-spec.md §10.10/§20: condona deuda sin que el cedente haya confirmado que se
     * pagó ESA clave. Un pago que no trae `referenciaClave` (manual, o de una plantilla que no
     * mapea `nroConvenio`) simplemente no cancela con quita por esta vía — sigue las reglas de
     * siempre (Σpagos vs `montoTotal`).
     *
     * Centavos enteros, no pesos: `pago.importe` es `Float` y `clave_pago.importe` llega como
     * texto/Decimal — comparar en `Float` con una tolerancia en pesos arrastra el error de coma
     * flotante al lado equivocado del umbral.
     */
    private evaluarReglaDeClave(
        deudorId: number,
        clavesDelCaso: ClaveChunkRow[] | undefined,
    ): DecisionClave | null {
        if (!clavesDelCaso?.length) return null;

        const cumplidas = clavesDelCaso.filter((c) => {
            const nroClienteCaso = (c.nroClienteCaso ?? '').trim();
            if (nroClienteCaso !== c.nroTramite) {
                this.logger.warn(
                    `Deudor id=${deudorId}: un pago referencia la clave ${c.nroConvenio} (trámite ${c.nroTramite}) ` +
                    `pero el nroCliente del caso ("${nroClienteCaso}") no es ese trámite — no se cancela por esta regla.`,
                );
                return false;
            }
            const importeClaveCentavos = Math.round(parseFloat(String(c.importeClave)) * 100);
            const pagadoCentavos = Math.round(
                parseFloat(String(this.modoClave === 'PAGO_UNICO' ? c.mayorPagoClave : c.pagadoClave)) * 100,
            );
            return pagadoCentavos >= importeClaveCentavos - this.toleranciaClaveCentavos;
        });

        const total = cumplidas.find((c) => c.tipoClave === 'TOTAL');
        const quita = cumplidas.find((c) => c.tipoClave === 'QUITA');
        const ganadora = total ?? quita;
        if (!ganadora) return null;

        return {
            tipoClave: ganadora.tipoClave === 'TOTAL' ? 'TOTAL' : 'QUITA',
            claveId: Number(ganadora.claveId),
            nroConvenio: ganadora.nroConvenio,
            importeClave: parseFloat(String(ganadora.importeClave)),
            saldoTramite: parseFloat(String(ganadora.saldoTramite)),
            pagado: parseFloat(String(ganadora.pagadoClave)),
            ultimaFecha: ganadora.ultimaFecha,
        };
    }

    // ─── Escritura de un chunk ────────────────────────────────────────────────

    /**
     * Escribe los cambios del chunk en una transacción Prisma.
     *
     * Estrategia:
     *  - 2 updateMany para `estadoSituacionId` + `situacionConsolidadaEn` (uno por situación destino
     *    de la regla de siempre).
     *  - 2 $executeRaw para recalcular `saldo` con GREATEST(0, montoTotal - sum(pagos)) en SQL
     *    (evita traer valores a memoria y hace el cálculo final con la snapshot del momento exacto).
     *  - Fase 4a: 2 updateMany más para los cancelados por clave (SIT-054 / SIT-050 por TOTAL), con
     *    `saldo = 0` EXPLÍCITO — nunca pasan por los `$executeRaw` de arriba, que le devolverían a
     *    una cuenta cancelada con quita el 50% del saldo (spec §10.5d). Más el `UPDATE` de las
     *    cuotas de los convenios de clave cumplidos.
     *
     * Nota: el $executeRaw hace un sub-SELECT sobre `pago` para cada deudor, lo cual es
     * aceptable para chunks de 500 con índice pago(deudorId) — ver spec §10.6.
     */
    private async aplicarChunk(
        sit050Ids: number[],
        sit041Ids: number[],
        sit054Ids: number[],
        sit050PorClaveIds: number[],
        decisionesClave: Map<number, DecisionClave>,
        situacionConsolidadaEn: Date,
    ): Promise<void> {
        const ops: any[] = [];

        if (sit050Ids.length > 0) {
            ops.push(
                this.prisma.deudor.updateMany({
                    where: { id: { in: sit050Ids } },
                    data: {
                        estadoSituacionId: this.sit050Id!,
                        situacionConsolidadaEn,
                    },
                }),
            );
            ops.push(
                this.prisma.$executeRaw`
                    UPDATE deudor d
                    SET d.saldo = GREATEST(0, COALESCE(d.montoTotal, 0) - COALESCE(
                        (SELECT SUM(p.importe) FROM pago p WHERE p.deudorId = d.id), 0
                    ))
                    WHERE d.id IN (${Prisma.join(sit050Ids)})
                `,
            );
        }

        if (sit041Ids.length > 0) {
            ops.push(
                this.prisma.deudor.updateMany({
                    where: { id: { in: sit041Ids } },
                    data: {
                        estadoSituacionId: this.sit041Id!,
                        situacionConsolidadaEn,
                    },
                }),
            );
            ops.push(
                this.prisma.$executeRaw`
                    UPDATE deudor d
                    SET d.saldo = GREATEST(0, COALESCE(d.montoTotal, 0) - COALESCE(
                        (SELECT SUM(p.importe) FROM pago p WHERE p.deudorId = d.id), 0
                    ))
                    WHERE d.id IN (${Prisma.join(sit041Ids)})
                `,
            );
        }

        // Fase 4a — cancelados con quita (SIT-054, o SIT-050 degradado si el código no existe).
        if (sit054Ids.length > 0) {
            ops.push(
                this.prisma.deudor.updateMany({
                    where: { id: { in: sit054Ids } },
                    data: {
                        estadoSituacionId: this.sit054Id ?? this.sit050Id!,
                        situacionConsolidadaEn,
                        saldo: 0,
                    },
                }),
            );
        }

        // Fase 4a — cancelados por la clave TOTAL (van a SIT-050, como los de siempre, pero con
        // saldo 0 EXPLÍCITO en vez de recalculado: no importa si `montoTotal` es null o distinto
        // del importe de la clave, la cuenta quedó saldada).
        if (sit050PorClaveIds.length > 0) {
            ops.push(
                this.prisma.deudor.updateMany({
                    where: { id: { in: sit050PorClaveIds } },
                    data: {
                        estadoSituacionId: this.sit050Id!,
                        situacionConsolidadaEn,
                        saldo: 0,
                    },
                }),
            );
        }

        // Cuotas de los convenios de clave cumplidos → PAGADA (D17: el convenio sigue ACTIVO, solo
        // cambia la cuota — en toda la base solo se usan ACTIVO/ANULADO en `convenio.estado`).
        const claveIds = [...decisionesClave.values()].map((d) => d.claveId);
        let convenioPorClave = new Map<number, number>();
        if (claveIds.length > 0) {
            const convenios = await this.prisma.convenio.findMany({
                where: { clavePagoId: { in: claveIds }, estado: 'ACTIVO' },
                select: { id: true, clavePagoId: true },
            });
            convenioPorClave = new Map(convenios.filter((c) => c.clavePagoId != null).map((c) => [c.clavePagoId as number, c.id]));
            for (const decision of decisionesClave.values()) {
                const convenioId = convenioPorClave.get(decision.claveId);
                if (convenioId) {
                    ops.push(
                        this.prisma.cuota_convenio.updateMany({
                            where: { convenioId, estado: { in: ['PENDIENTE', 'VENCIDA'] } },
                            data: { estado: 'PAGADA', fechaPago: decision.ultimaFecha },
                        }),
                    );
                }
            }
        }

        await this.prisma.$transaction(ops);

        // Un registro **por caso** para las cancelaciones. El resto de las transiciones se auditan
        // como una sola corrida, pero "¿por qué se canceló este caso?" es la pregunta que más se
        // hace y la que la corrida no puede responder: filtrando por el deudor no aparecía nada.
        //
        // El volumen está acotado: un caso se cancela una sola vez — en la corrida siguiente ya no
        // cambia y no vuelve a registrarse.
        const auditorias: Promise<any>[] = [];

        if (sit050Ids.length > 0) {
            auditorias.push(
                ...sit050Ids.map((deudorId) =>
                    this.auditoria.log({
                        modulo: AuditModulo.GESTION,
                        entidad: 'Deudor',
                        entidadId: String(deudorId),
                        deudorId,
                        tipo: AuditTipo.UPDATE,
                        resumen: 'Cancelado por consolidación: lo pagado cubre la deuda',
                        data: { after: { estadoSituacion: 'SIT-050' }, contexto: { origen: 'consolidacion' } },
                    }),
                ),
            );
        }

        for (const [deudorId, decision] of decisionesClave) {
            const esQuita = decision.tipoClave === 'QUITA';
            // La quita perdonada es contra el SALDO ORIGINAL DEL TRÁMITE (`clave_pago.saldoTramite`),
            // no contra el importe de la clave — hallazgo de la auditoría: `importeClave − pagado`
            // da $0 con un pago exacto (que es el caso normal), cuando lo que hay que mostrar es
            // "pagó $15.500 de $31.000 — quita $15.500" (spec §10.5e), igual que ya hace la ficha
            // (`claves.service.ts`).
            const quita = esQuita ? Math.max(0, decision.saldoTramite - decision.pagado) : 0;
            const fmt = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const situacionTxt = esQuita && this.sit054Id != null ? 'SIT-054' : 'SIT-050';
            auditorias.push(
                this.auditoria.log({
                    modulo: AuditModulo.GESTION,
                    entidad: 'Deudor',
                    entidadId: String(deudorId),
                    deudorId,
                    tipo: AuditTipo.UPDATE,
                    resumen: esQuita
                        ? `Cancelado con quita por el pago de la clave QUITA ${decision.nroConvenio}: pagó $ ${fmt(decision.pagado)} de $ ${fmt(decision.saldoTramite)} — quita $ ${fmt(quita)}`
                        : `Cancelado por el pago de la clave TOTAL ${decision.nroConvenio}: pagó $ ${fmt(decision.pagado)} de $ ${fmt(decision.saldoTramite)}`,
                    data: {
                        after: { estadoSituacion: situacionTxt },
                        contexto: {
                            origen: 'consolidacion',
                            regla: 'CLAVE_PAGO_ARCHIVO',
                            claveId: decision.claveId,
                            nroConvenio: decision.nroConvenio,
                            tipoClave: decision.tipoClave,
                            importeClave: decision.importeClave,
                            saldoTramite: decision.saldoTramite,
                            pagado: decision.pagado,
                            deudorId,
                        },
                    },
                }),
            );
        }

        await Promise.all(auditorias);
    }
}
