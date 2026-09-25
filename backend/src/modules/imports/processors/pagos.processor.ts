// processors/pagos.processor.ts
import { ICategoryProcessor, MappedRow, ProcessContext, RowValidationResult } from './processor.interface';
import { Prisma } from '@prisma/client';
import { Logger } from '@nestjs/common';
import { procesarBloquesDeudor } from '../utils/procesar-bloques';
import { normalizarReferenciaClave } from '../../multiclaves/utils/clave-pago';

/**
 * Importe del pago como número.
 *
 * No alcanza con confiar en que la plantilla haya puesto `toNumber`: el orden de los transforms lo
 * elige el operador, y `removeDashes` después de `toNumber` devolvía texto. Con eso el importe
 * llegaba a Prisma como `"68062.52"` y la fila moría con un error de tipo ilegible
 * (`Expected Float, provided String`) en vez de cargarse.
 *
 * Devuelve `null` si no hay forma de leerlo como número, y ahí la fila se rechaza con un mensaje
 * que dice qué pasó.
 */
export function importeDePago(valor: any): number | null {
    if (valor == null || valor === '') return null;
    if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;

    let s = String(valor).trim().replace(/[^\d.,-]/g, '');
    if (!s) return null;

    const ultimaComa = s.lastIndexOf(',');
    const ultimoPunto = s.lastIndexOf('.');
    if (ultimaComa > ultimoPunto) s = s.replace(/\./g, '').replace(/,/g, '.');
    else if (ultimoPunto > ultimaComa) s = s.replace(/,/g, '');
    else if (ultimaComa !== -1) s = s.replace(/,/g, '.');

    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
}

/**
 * Referencia de clave de pago (multiclaves) de una fila de PAGOS, normalizada.
 *
 * `0`, vacío, `-` y `00000000` significan "sin clave" (las filas comunes del archivo real de
 * Telecom/Personal, spec §10.2) y NO cuentan como aviso. Cualquier otro valor que no normalice
 * (ni 8, 22 ni 50 dígitos) es `REFERENCIA_CLAVE_ILEGIBLE`: la fila se carga igual como pago común.
 */
export function refClaveDeFila(crudo: any): { refClave: string | null; ilegible: boolean } {
    const t = crudo == null ? '' : String(crudo).trim();
    if (t === '' || t === '0' || t === '-' || t === '00000000') return { refClave: null, ilegible: false };
    const norm = normalizarReferenciaClave(t);
    if (norm == null) return { refClave: null, ilegible: true };
    return { refClave: norm, ilegible: false };
}

/** Candidato a caso para un pago: lo mínimo que hace falta para el desempate estable. */
interface CandidatoDeudor {
    id: number;
    remesa: { createdAt: Date } | null;
}

/**
 * Desempate determinista y ESTABLE entre varios casos candidatos del mismo trámite: la remesa más
 * reciente y, si sigue habiendo empate, el `id` más alto.
 *
 * Reemplaza al `LIMIT 1` sin `ORDER BY` que tenía el camino común antes de la fase 4a — una moneda
 * al aire medida en producción sobre 5.448 `nroCliente` repetidos de la empresa 9 (TELECOM).
 *
 * A propósito NO mira la situación del caso (¿está cancelado?). La primera versión de esta función
 * sí lo hacía ("preferir el no cancelado"), y un auditor encontró que eso duplica cobros: la propia
 * carga de pagos CAMBIA esa situación al cancelar un caso, así que una recarga del mismo archivo
 * evalúa el criterio con datos distintos a los de la primera carga, elige el caso HERMANO (que
 * ahora es "el no cancelado") y le crea un segundo pago — con clave (dos casos en "Cancelado con
 * quita" por el mismo cobro) y sin ella (dos casos en SIT-050 por un cobro que era uno solo). El
 * desempate tiene que depender solo de hechos que la propia importación no pueda cambiar
 * (`remesa.createdAt`, `id`); la defensa real contra duplicar cuando hay más de un candidato es
 * `pagoYaExisteEnAlgunCandidato()`, que busca en TODOS los candidatos, no solo en el elegido.
 */
export function elegirPorRemesaMasRecienteYId<T extends CandidatoDeudor>(candidatos: T[]): T {
    return [...candidatos].sort((a, b) => {
        const aFecha = a.remesa?.createdAt?.getTime() ?? 0;
        const bFecha = b.remesa?.createdAt?.getTime() ?? 0;
        if (aFecha !== bFecha) return bFecha - aFecha;
        return b.id - a.id;
    })[0];
}

/** Candidatos de un trámite/nroCliente, más cuál de ellos recibiría un pago NUEVO. */
interface Candidatos {
    /** TODOS los casos candidatos — el anti-duplicados busca en todos, no solo en `elegido`. */
    ids: number[];
    /** El caso que recibiría un pago genuinamente nuevo, si no hay duplicado en ningún candidato. */
    elegido: number;
    /** `true` si `elegido` salió de un convenio de clave activo (criterios 1 y 2 de los pagos con clave). */
    porConvenio?: boolean;
}

export class PagosProcessor implements ICategoryProcessor {
    readonly category = 'PAGOS';
    private readonly logger = new Logger(PagosProcessor.name);

    /**
     * IDs de deudores que recibieron pagos en este batch.
     * Se usa en afterAll para consolidar solo los deudores tocados (optimización §4.2).
     */
    private processedDeudorIds = new Set<number>();

    /** Facturas que se marcaron PAGADA porque el archivo dijo qué comprobante se cobró. */
    private facturasMarcadas = 0;

    /** Pagos salteados por ser un cobro que ya estaba cargado (archivo acumulativo). */
    private yaCargados = 0;

    /** Pagos con importe negativo: no bajan la deuda, la suben. Se avisa al terminar. */
    private negativos = 0;

    // ─── Contadores de multiclaves (fase 4a, spec §10.3e) — se resetean junto con los de arriba ──

    /** Filas cuyo `nroConvenio` normaliza a una clave cargada en ESTA empresa. */
    private claveCargada = 0;
    /** Filas cuyo `nroConvenio` normaliza a una clave cargada, pero de OTRA empresa. */
    private claveOtraEmpresa = 0;
    /** Filas cuyo `nroConvenio` normaliza a una referencia válida que no está en `clave_pago`. */
    private claveNoCargada = 0;
    /** Filas con algo en la columna del convenio que no normaliza a ninguna forma conocida. */
    private referenciaIlegible = 0;
    /** Trámites de una clave con más de un caso candidato en la empresa (desempate aplicado). */
    private tramitesEnVariosCasos = 0;
    /** Casos que solo se encontraron fuera de las remesas de origen de esta carga. */
    private casosFueraDeRemesaOrigen = 0;

    private resetContadores(): void {
        this.facturasMarcadas = 0;
        this.yaCargados = 0;
        this.negativos = 0;
        this.claveCargada = 0;
        this.claveOtraEmpresa = 0;
        this.claveNoCargada = 0;
        this.referenciaIlegible = 0;
        this.tramitesEnVariosCasos = 0;
        this.casosFueraDeRemesaOrigen = 0;
    }

    validateRow(row: MappedRow, _ctx: ProcessContext): RowValidationResult {
        const nroCliente = String(row.nro_cliente ?? '').trim();
        if (!nroCliente) {
            return { valid: false, error: 'nro_cliente es requerido para pagos' };
        }
        // La UI de mapeo de PAGOS expone el campo del importe como `monto` (label "Monto");
        // se acepta como alias de `importe` para no rechazar plantillas mapeadas con esa clave.
        const bruto = row.importe ?? row.monto;
        if (bruto == null || bruto === '') {
            return { valid: false, error: 'Campo requerido faltante: importe (o monto)' };
        }
        if (importeDePago(bruto) == null) {
            return { valid: false, error: `El importe "${bruto}" no es un número` };
        }
        return { valid: true };
    }

    /**
     * Candidatos de un pago hecho con una clave de pago (multiclaves, spec §10.3c). Devuelve `null`
     * si el trámite de la clave no tiene ningún caso en la empresa.
     *
     * `ids` —lo que mira el anti-duplicados— son SIEMPRE todos los casos del trámite en la empresa,
     * no solo los de las remesas elegidas: el caso que recibe el pago puede cambiar entre dos cargas
     * del mismo archivo (se anuló o se emitió un convenio en el medio), y si el anti-duplicados no
     * mirara el caso donde quedó el primer pago, la recarga lo duplicaría en otro caso (hallazgo de
     * la auditoría del 2026-09-25).
     *
     * `elegido` es el que recibiría un pago NUEVO:
     *  1. el caso con el convenio ACTIVO de esta clave exacta, en toda la empresa;
     *  2. el caso con cualquier convenio ACTIVO de origen CLAVE_PAGO del trámite, en toda la empresa
     *     (es el caso desde el que se gestionan las claves: ver `multiclaves/utils/caso-del-tramite.ts`);
     *  3. desempate estable por remesa/id entre los casos de las remesas de origen o, si no hay
     *     ninguno ahí, entre todos (aviso `casosFueraDeRemesaOrigen`).
     *
     * 1 y 2 van en toda la empresa porque el convenio ya dice qué caso pagó: acotados a las remesas
     * elegidas, un trámite que estaba en la remesa de agosto (con el convenio) y en la de septiembre
     * mandaba el pago al caso de septiembre si solo se elegía esa, y el del convenio no se cancelaba.
     */
    private async candidatosPorClave(
        ctx: ProcessContext,
        clave: { id: number; nroTramite: string },
        targetRemesaIds: number[],
    ): Promise<Candidatos | null> {
        const enRemesasOrigen = (
            await ctx.prisma.$queryRaw<{ id: number }[]>(
                Prisma.sql`
                    SELECT id FROM deudor
                    WHERE empresaId = ${ctx.empresaId}
                      AND remesaId IN (${Prisma.join(targetRemesaIds)})
                      AND TRIM(nroCliente) = ${clave.nroTramite}
                `,
            )
        ).map((r) => r.id);

        const todos = (
            await ctx.prisma.$queryRaw<{ id: number }[]>(
                Prisma.sql`
                    SELECT id FROM deudor
                    WHERE empresaId = ${ctx.empresaId} AND TRIM(nroCliente) = ${clave.nroTramite}
                `,
            )
        ).map((r) => r.id);
        // Por las dudas de una carrera entre las dos lecturas: `ids` tiene que incluir a los dos.
        const ids = [...new Set([...todos, ...enRemesasOrigen])];
        if (ids.length === 0) return null;

        const porConvenio = (deudorId: number): Candidatos => {
            if (!enRemesasOrigen.includes(deudorId)) this.casosFueraDeRemesaOrigen++;
            if (ids.length > 1) this.tramitesEnVariosCasos++;
            return { ids, elegido: deudorId, porConvenio: true };
        };

        // Criterio 1: convenio ACTIVO con clavePagoId = esta clave exacta. Solo entre los casos del
        // trámite: un caso cuyo nroCliente cambió después de emitir el convenio ya no es candidato.
        const conClaveExacta = await ctx.prisma.convenio.findFirst({
            where: { clavePagoId: clave.id, estado: 'ACTIVO', deudorId: { in: ids } },
            select: { deudorId: true },
        });
        if (conClaveExacta) return porConvenio(conClaveExacta.deudorId);

        // Criterio 2: cualquier convenio de origen CLAVE_PAGO activo del mismo trámite.
        const conOrigenClave = await ctx.prisma.convenio.findFirst({
            where: {
                estado: 'ACTIVO',
                origen: 'CLAVE_PAGO',
                deudorId: { in: ids },
                clavePago: { nroTramite: clave.nroTramite },
            },
            select: { deudorId: true },
        });
        if (conOrigenClave) return porConvenio(conOrigenClave.deudorId);

        // Criterios 3 y 4, estables: remesa más reciente, después id DESC. NUNCA "no cancelado" —
        // ver el comentario de `elegirPorRemesaMasRecienteYId`.
        let pool = enRemesasOrigen;
        if (pool.length === 0) {
            this.casosFueraDeRemesaOrigen++;
            pool = ids;
        }
        if (pool.length === 1) return { ids, elegido: pool[0] };

        this.tramitesEnVariosCasos++;
        const candidatos = await ctx.prisma.deudor.findMany({
            where: { id: { in: pool } },
            select: { id: true, remesa: { select: { createdAt: true } } },
        });
        return { ids, elegido: elegirPorRemesaMasRecienteYId(candidatos).id };
    }

    /**
     * Camino común (sin clave, o clave no cargada / de otra empresa): mismo alcance de siempre
     * (nroCliente dentro de las remesas de origen), con el desempate estable de
     * `elegirPorRemesaMasRecienteYId` en vez del `LIMIT 1` sin orden de antes.
     */
    private async candidatosComunes(
        ctx: ProcessContext,
        nroCliente: string,
        targetRemesaIds: number[],
    ): Promise<Candidatos | null> {
        const ids = (
            await ctx.prisma.$queryRaw<{ id: number }[]>(
                Prisma.sql`
                    SELECT id FROM deudor
                    WHERE empresaId = ${ctx.empresaId}
                      AND remesaId IN (${Prisma.join(targetRemesaIds)})
                      AND nroCliente = ${nroCliente}
                `,
            )
        ).map((r) => r.id);

        if (ids.length === 0) return null;
        if (ids.length === 1) return { ids, elegido: ids[0] };

        const candidatos = await ctx.prisma.deudor.findMany({
            where: { id: { in: ids } },
            select: { id: true, remesa: { select: { createdAt: true } } },
        });
        return { ids, elegido: elegirPorRemesaMasRecienteYId(candidatos).id };
    }

    async processRow(row: MappedRow, ctx: ProcessContext): Promise<void> {
        const nroCliente = String(row.nro_cliente ?? '').trim();
        if (!nroCliente) throw new Error('nro_cliente es requerido para pagos');

        // Los pagos apuntan a una remesa origen distinta a la del propio archivo; usar ctx.remesaId
        // acá hacía fallar la búsqueda con "Deudor no encontrado" aunque el nro_cliente fuera correcto.
        //
        // Tema 2: si vienen varias remesas origen (archivo de pagos para toda la empresa), se busca
        // el nroCliente en cualquiera de ellas → una sola corrida cubre las N remesas.
        const targetRemesaIds = ctx.remesaOrigenIds?.length
            ? ctx.remesaOrigenIds
            : [ctx.remesaOrigenId ?? ctx.remesaId];

        // Referencia de clave de pago (multiclaves, spec §10.2/§10.3a). Se resuelve ANTES que el
        // caso: si el `nroConvenio` matchea una clave cargada de esta empresa, el caso se busca por
        // el trámite de la clave, no por el `nroCliente` del archivo (que en este mismo archivo real
        // vale lo mismo, pero no hay por qué asumirlo en general).
        const { refClave: refClaveCruda, ilegible } = refClaveDeFila(row.nroConvenio);
        if (ilegible) this.referenciaIlegible++;

        let candidatos: Candidatos | null;
        let clave: { id: number; nroTramite: string } | null = null;

        if (refClaveCruda) {
            const claveEncontrada = await ctx.prisma.clave_pago.findUnique({
                where: { nroConvenio: refClaveCruda },
                select: { id: true, empresaId: true, nroTramite: true },
            });
            if (claveEncontrada && claveEncontrada.empresaId !== ctx.empresaId) {
                this.claveOtraEmpresa++;
            } else if (claveEncontrada) {
                this.claveCargada++;
                clave = { id: claveEncontrada.id, nroTramite: claveEncontrada.nroTramite };
            } else {
                this.claveNoCargada++;
            }
        }

        if (clave) {
            candidatos = await this.candidatosPorClave(ctx, clave, targetRemesaIds);
            if (!candidatos) {
                throw new Error(
                    `El trámite ${clave.nroTramite} de la clave ${refClaveCruda} no tiene caso en esta empresa`,
                );
            }
        } else {
            candidatos = await this.candidatosComunes(ctx, nroCliente, targetRemesaIds);
            if (!candidatos) {
                throw new Error(`Deudor no encontrado para pago (nro_cliente=${nroCliente})`);
            }
        }

        const { ids: candidatoIds, elegido: deudorId, porConvenio: elegidoPorConvenio } = candidatos;

        // La referencia se guarda tal como normalizó, aunque la clave todavía no esté cargada en
        // esta empresa (R13: cuando se cargue, la consolidación siguiente cancela sola) o sea de
        // otra empresa (el join de la consolidación exige `empresaId` igual, así que no cancela
        // cruzado — solo queda de dato). `refClaveCruda` ya es `null` en los casos "sin clave" e
        // "ilegible" (`refClaveDeFila`).
        const refClave = refClaveCruda;

        // Bloques repetitivos del archivo → al caso elegido.
        await procesarBloquesDeudor(deudorId, row._blocks, ctx);

        const importe = importeDePago(row.importe ?? row.monto) ?? 0;
        if (importe < 0) this.negativos++;

        // Identificador del cobro en el sistema del cedente (`PAYMENT_ID` en los archivos de
        // Telecom/Personal). Es la clave de idempotencia real: mientras exista, un archivo
        // acumulativo se puede recargar cuantas veces haga falta sin duplicar nada, sin depender
        // de que la fecha y el importe coincidan.
        const idExternoDelArchivo = row.idExterno != null && String(row.idExterno).trim() !== ''
            ? String(row.idExterno).trim()
            : null;

        // Identificador del comprobante que cobró, si la plantilla lo mapea. Se guarda en el pago y
        // participa del anti-duplicados de más abajo.
        const observacion = row.observacion != null && String(row.observacion).trim() !== ''
            ? String(row.observacion).trim()
            : null;

        // Fecha del pago: se respeta la mapeada en la plantilla (campo `fecha`, o su alias
        // `fechaPago` que expone la UI). Si no vino o es inválida, se usa la fecha del día.
        const fechaRaw = row.fecha ?? row.fechaPago;
        const fechaParsed = fechaRaw != null && fechaRaw !== '' ? new Date(fechaRaw) : null;
        const fechaPago = fechaParsed && !isNaN(fechaParsed.getTime()) ? fechaParsed : new Date();

        // `idExterno` derivado (D16, spec §10.3b): los pagos con clave de la muestra real NO traen
        // `PAYMENT_ID` (columna vacía). Sin un identificador propio, la única defensa sería la
        // heurística de día + importe + observación. Se deriva uno con prefijo `MC-` —nunca puede
        // colisionar con un id numérico del cedente— más el día y los centavos, para que un segundo
        // pago de la MISMA clave en otro día (Telecom podría aceptar pagar en partes, Q6) no choque
        // contra la unique `(deudorId, idExterno)` y se pierda.
        let idExterno = idExternoDelArchivo;
        let idExternoDerivado = false;
        if (!idExterno && refClave) {
            const yyyymmdd = fechaPago.toISOString().slice(0, 10).replace(/-/g, '');
            const centavos = Math.round(importe * 100);
            idExterno = `MC-${refClave}-${yyyymmdd}-${centavos}`;
            idExternoDerivado = true;
        }

        // ─── Anti-duplicados — SIEMPRE contra TODOS los candidatos del trámite, nunca solo contra
        // `deudorId` (hallazgo de la auditoría de la fase 4a): si el trámite tiene más de un caso, el
        // desempate puede elegir uno u otro en cargas sucesivas (aunque ahora es estable, un cambio
        // de criterio en un deploy futuro o un dato que no contemplamos podría volver a moverlo). Si
        // el pago ya está imputado a CUALQUIERA de los candidatos, no se crea uno nuevo en otro.

        // Anti-dup por identificador del cedente (o derivado): si este cobro ya se cargó, no se
        // hace nada. Va antes que todo lo demás porque es el criterio exacto; el resto son
        // heurísticas. Corre siempre que haya `idExterno`, sea del archivo o derivado.
        if (idExterno) {
            const ya = await ctx.prisma.pago.findFirst({
                where: { deudorId: { in: candidatoIds }, idExterno },
                select: { id: true },
            });
            if (ya) {
                this.yaCargados++;
                return;
            }
        }

        // Anti-dup (spec §3.1): si ya hay un pago MANUAL no confirmado con este importe exacto en
        // CUALQUIERA de los candidatos del trámite → confirmarlo en vez de duplicar. Un claim por
        // fila. Mirar solo el caso elegido (hallazgo de la re-auditoría de la fase 4a) duplicaba el
        // cobro cuando el trámite tiene dos casos: el gestor registra el pago a mano en el caso que
        // abrió y el desempate elige el otro, así que el import creaba un segundo pago y dejaba el
        // manual sin confirmar. Se prefiere el del caso elegido, y si no hay, el más viejo.
        const claimBase = { origen: 'MANUAL', confirmadoImport: false, importe };
        // Primero el caso elegido: si el gestor cargó el pago ahí, se confirma ahí.
        const claim =
            (await ctx.prisma.pago.findFirst({
                where: { deudorId, ...claimBase },
                orderBy: { fecha: 'asc' },
                select: { id: true, deudorId: true },
            })) ??
            // Si no, cualquiera de los otros casos del mismo trámite.
            (candidatoIds.length > 1
                ? await ctx.prisma.pago.findFirst({
                    where: { deudorId: { in: candidatoIds.filter((id) => id !== deudorId) }, ...claimBase },
                    orderBy: { fecha: 'asc' },
                    select: { id: true, deudorId: true },
                })
                : null);

        if (claim) {
            // Pago a mano en OTRO caso del trámite. Si el caso elegido tiene el convenio de clave, el
            // cobro es de ese caso: se mueve ahí, porque la consolidación cancela mirando los pagos del
            // propio caso y, dejado en el otro, el caso del convenio no se cancelaba nunca (hallazgo
            // de la auditoría del 2026-09-25). Si no hay convenio se deja donde lo cargó el gestor. En
            // los dos casos el caso de origen también se re-consolida.
            const claimEnOtroCaso = claim.deudorId !== deudorId ? claim.deudorId : null;
            const mover = claimEnOtroCaso != null && !!elegidoPorConvenio;
            if (claimEnOtroCaso != null) {
                this.processedDeudorIds.add(claimEnOtroCaso);
                this.logger.log(
                    `Pago manual ${claim.id} confirmado desde el caso ${claimEnOtroCaso}` +
                    (mover ? ` y movido al caso ${deudorId}, que tiene el convenio de la clave` : ` (el elegido era ${deudorId})`),
                );
            }
            await ctx.prisma.pago.update({
                where: { id: claim.id },
                data: {
                    ...(mover ? { deudorId } : {}),
                    confirmadoImport: true,
                    confirmadoEn: new Date(),
                    origenArchivo: `PAGOS_REMESA_${ctx.remesaId}`,
                    idExterno,
                    // Hallazgo de la auditoría (fase 4a, importante #2): sin esto, un pago cargado a
                    // mano ANTES de que llegara el archivo de multiclaves quedaba confirmado pero sin
                    // `referenciaClave` — la regla (a) de la consolidación no lo veía y el caso se
                    // quedaba en SIT-041 con saldo en vez de SIT-054 con saldo 0.
                    referenciaClave: refClave,
                },
            });
        } else {
            // Anti-dup acumulativo (Tema 2): si ya existe un pago importado idéntico
            // (mismo día e importe, en CUALQUIERA de los candidatos) NO se reinserta. Hace
            // idempotente reimportar un archivo de pagos acumulativo (que repite pagos ya cargados).
            // La comparación es por día (no por timestamp exacto) porque cuando la fecha no
            // viene mapeada se usa `new Date()` y cada corrida tendría una hora distinta.
            const inicioDia = new Date(fechaPago);
            inicioDia.setHours(0, 0, 0, 0);
            const finDia = new Date(fechaPago);
            finDia.setHours(23, 59, 59, 999);

            // Con un `idExterno` DEL ARCHIVO la pregunta ya se respondió arriba de forma exacta;
            // repetirla por día+importe solo puede dar un falso positivo y perder plata. Un
            // `idExterno` DERIVADO (D16) NO saltea esta heurística: si el archivo se cargó una
            // primera vez sin mapear `nroConvenio` (sin idExterno del todo) y se recarga después
            // con el mapeo puesto, la búsqueda exacta por la llave derivada no encuentra nada —la
            // primera carga no la tiene— y sin la heurística de respaldo el pago se duplicaría.
            const yaImportado = (idExterno && !idExternoDerivado) ? null : await ctx.prisma.pago.findFirst({
                where: {
                    deudorId: { in: candidatoIds },
                    origen: 'IMPORT_PAGOS',
                    importe,
                    fecha: { gte: inicioDia, lte: finDia },
                    // Si la plantilla mapea un identificador del comprobante en `observacion`, dos
                    // cobros del mismo día y el mismo importe pero de comprobantes distintos NO son
                    // el mismo pago: hay que registrar los dos.
                    //
                    // Sin esto, un cliente que cancela varias cuotas iguales de un plan el mismo día
                    // queda con un solo pago registrado. Medido sobre el archivo de AYSA del 25/07:
                    // de 1.997 cobros por $18.353.107, se guardaban 1.192 y se perdían $2.443.138
                    // —el 13,3% de la cobranza—; una sola cuenta pagó 36 partidas de $195,04 el
                    // mismo día.
                    //
                    // Las plantillas que no mapean `observacion` no cambian: el criterio sigue
                    // siendo día + importe (ahora sobre cualquiera de los candidatos del trámite).
                    ...(observacion ? { observacion } : {}),
                },
                select: { id: true },
            });

            if (yaImportado) {
                // Pago ya cargado en una importación previa (en este caso o en un caso hermano del
                // mismo trámite) → skip idempotente. No se toca ningún deudor: no hubo movimiento
                // nuevo, no hace falta consolidar.
                this.yaCargados++;
                return;
            }

            await ctx.prisma.pago.create({
                data: {
                    deudorId,
                    fecha: fechaPago,
                    importe,
                    origen: 'IMPORT_PAGOS',
                    origenArchivo: row.origenArchivo ?? null,
                    observacion,
                    idExterno,
                    referenciaClave: refClave,
                },
            });
        }

        // Si el archivo dice QUÉ comprobante se cobró, esa factura pasa a PAGADA.
        //
        // Sin esto el saldo del deudor baja pero las facturas quedan todas en "pendiente", que fue
        // justamente lo que se reportó de la carga de AYSA: el archivo de novedades trae el número
        // de partida cobrada y no se estaba usando para nada más que el anti-duplicados.
        //
        // Solo aplica a las carteras cuyo archivo de pagos identifica el comprobante; las que no
        // mapean `observacion` no cambian. Es el mismo criterio de ACTUALIZACIONES y MULTIRREGISTRO.
        if (observacion) {
            const marcadas = await ctx.prisma.factura.updateMany({
                where: { deudorId, nroFactura: observacion, estado: { not: 'PAGADA' } },
                data: { estado: 'PAGADA' },
            });
            if (marcadas.count > 0) this.facturasMarcadas += marcadas.count;
        }

        // Trackear deudor tocado para la consolidación selectiva en afterAll
        this.processedDeudorIds.add(deudorId);
    }

    /**
     * Fase 3 — §4.2: Al finalizar todas las filas, consolidar la situación de los
     * deudores que recibieron pagos en este batch.
     *
     * Optimización: se consolida solo el subconjunto (scope DEUDORES) en lugar de
     * toda la remesa, ahorrando evaluar deudores sin movimientos.
     * Fallback a scope REMESA si el set está vacío (no debería ocurrir en práctica).
     */
    async afterAll(ctx: ProcessContext): Promise<void> {
        if (this.facturasMarcadas > 0) {
            this.logger.log(`${this.facturasMarcadas} factura(s) marcadas PAGADA por el comprobante del pago.`);
        }
        if (this.yaCargados > 0) {
            this.logger.log(
                `${this.yaCargados} pago(s) ya estaban cargados y se saltearon (archivo acumulativo).`,
            );
        }
        if (this.negativos > 0) {
            // No se corrige solo: un importe negativo puede ser una contracara legítima (un cobro
            // que se dio de baja). Pero si son notas de crédito, el mapeo necesita `removeDashes`
            // o la deuda SUBE en vez de bajar — el saldo es `montoTotal − Σpagos`.
            this.logger.warn(
                `${this.negativos} pago(s) con importe NEGATIVO en la remesa ${ctx.remesaId}: ` +
                'aumentan la deuda en vez de reducirla. Si son notas de crédito, agregá ' +
                '`removeDashes` al mapeo del importe.',
            );
        }

        const conClave = this.claveCargada + this.claveOtraEmpresa + this.claveNoCargada;
        if (conClave > 0) {
            this.logger.log(
                `Pagos remesa=${ctx.remesaId}: ${conClave} con clave (${this.claveCargada} cargadas, ` +
                `${this.claveOtraEmpresa} de otra empresa, ${this.claveNoCargada} sin cargar), ` +
                `${this.tramitesEnVariosCasos} trámite(s) en varios casos, ` +
                `${this.casosFueraDeRemesaOrigen} caso(s) fuera de la remesa origen.`,
            );
            if (this.claveNoCargada > 0) {
                await ctx.prisma.importerror.create({
                    data: {
                        remesaId: ctx.remesaId,
                        rowNumber: 0,
                        rawRow: [] as any,
                        errorMsg:
                            `[aviso] CLAVE_NO_CARGADA: ${this.claveNoCargada} pago(s) con un número de convenio ` +
                            'que no corresponde a ninguna clave cargada en esta empresa. No se cancela nada ' +
                            'hasta cargar las claves de esas nóminas y volver a consolidar.',
                    },
                }).catch((e: any) => this.logger.warn(`No se pudo guardar el aviso CLAVE_NO_CARGADA: ${e.message}`));
            }
            if (this.claveOtraEmpresa > 0) {
                await ctx.prisma.importerror.create({
                    data: {
                        remesaId: ctx.remesaId,
                        rowNumber: 0,
                        rawRow: [] as any,
                        errorMsg: `[aviso] CLAVE_DE_OTRA_EMPRESA: ${this.claveOtraEmpresa} pago(s) con convenio de una clave de otra empresa.`,
                    },
                }).catch((e: any) => this.logger.warn(`No se pudo guardar el aviso CLAVE_DE_OTRA_EMPRESA: ${e.message}`));
            }
            if (this.tramitesEnVariosCasos > 0) {
                await ctx.prisma.importerror.create({
                    data: {
                        remesaId: ctx.remesaId,
                        rowNumber: 0,
                        rawRow: [] as any,
                        errorMsg: `[aviso] TRAMITE_EN_VARIOS_CASOS: ${this.tramitesEnVariosCasos} trámite(s) con clave estaban en más de un caso; se desempató.`,
                    },
                }).catch((e: any) => this.logger.warn(`No se pudo guardar el aviso TRAMITE_EN_VARIOS_CASOS: ${e.message}`));
            }
            if (this.casosFueraDeRemesaOrigen > 0) {
                await ctx.prisma.importerror.create({
                    data: {
                        remesaId: ctx.remesaId,
                        rowNumber: 0,
                        rawRow: [] as any,
                        errorMsg: `[aviso] CASO_FUERA_DE_REMESA_ORIGEN: ${this.casosFueraDeRemesaOrigen} caso(s) de una clave se encontraron fuera de la(s) remesa(s) de origen elegidas.`,
                    },
                }).catch((e: any) => this.logger.warn(`No se pudo guardar el aviso CASO_FUERA_DE_REMESA_ORIGEN: ${e.message}`));
            }
        }
        if (this.referenciaIlegible > 0) {
            this.logger.warn(`${this.referenciaIlegible} fila(s) con un número de convenio ilegible (se cargaron como pago común).`);
            await ctx.prisma.importerror.create({
                data: {
                    remesaId: ctx.remesaId,
                    rowNumber: 0,
                    rawRow: [] as any,
                    errorMsg: `[aviso] REFERENCIA_CLAVE_ILEGIBLE: ${this.referenciaIlegible} fila(s) con un valor de convenio que no se pudo interpretar.`,
                },
            }).catch((e: any) => this.logger.warn(`No se pudo guardar el aviso REFERENCIA_CLAVE_ILEGIBLE: ${e.message}`));
        }

        this.resetContadores();

        if (this.processedDeudorIds.size > 0) {
            const deudorIds = [...this.processedDeudorIds];
            await ctx.consolidacion.consolidar({ tipo: 'DEUDORES', deudorIds });
            // Cerrar promesas VIGENTE que hayan quedado cumplidas por estos pagos (spec §5.5)
            await ctx.promesas.cerrarCumplidas(deudorIds);
        } else {
            // Fallback: consolidar la remesa origen (o la propia si no hay origen)
            await ctx.consolidacion.consolidar({
                tipo: 'REMESA',
                remesaId: ctx.remesaOrigenId ?? ctx.remesaId,
            });
        }
        this.processedDeudorIds.clear();
    }
}
