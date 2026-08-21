/**
 * MoraService
 *
 * Recargo por mora del régimen de AYSA. Dos responsabilidades:
 *
 *  1. **Generar el índice diario** a partir de la tasa mensual que informa el cedente.
 *     El índice es una cadena acumulativa estilo CER/UVA que arranca en 2001.
 *  2. **Valuar la deuda** de un caso a una fecha, con la fórmula de docs/mora-aysa-spec.md §1,
 *     verificada al centavo contra 15 casos reales y contra el estado de deuda de AYSA.
 *
 * La regla de oro está en `generarMes`: **la cadena nunca se reinicia en 1**. Ese fue exactamente
 * el bug que rompió el CRM del cedente tres meses seguidos y le puso todas las deudas actualizadas
 * en negativo (§8.1). Por eso el método falla duro si falta el índice del día anterior, en vez de
 * arrancar de cero.
 */
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
    CONFIG_MORA_DEFAULT,
    ConfigMora,
    TIPO_DEUDA_ACTUALIZADA,
    aIsoFecha,
    diasDelMes,
    fechaUtc,
    formatearPeriodo,
    parsearPeriodo,
    redondear2,
} from './mora.constants';
import { coeficienteMora, conceptosMora } from './mora.formula';
import {
    DetalleMoraFactura,
    EstadoTasa,
    MoraDeudor,
    PrevioGeneracion,
    ResultadoGeneracion,
    ResultadoRecalculo,
} from './interfaces/mora.interface';

/**
 * El recálculo masivo es un UPDATE ... JOIN sobre toda la cartera (1,1M de facturas en AYSA), así que
 * no entra en los 5 segundos que Prisma le da por defecto a una transacción interactiva. Se hace en
 * transacción para no dejar la cartera a medio resetear si algo falla.
 */
const TIMEOUT_RECALCULO_MS = Number(process.env.MORA_RECALCULO_TIMEOUT_MS ?? 300_000);

/**
 * Origen que lleva el índice que genera este servicio. Cualquier otro valor (`UD60`) es dato del
 * cedente: más fiel que lo que se reconstruye desde la tasa mensual, porque hubo meses con más de
 * una tasa vigente (docs/mora-aysa-spec.md §5.2). Pisarlo es una degradación, no una corrección.
 */
const ORIGEN_CALCULADO = 'CALCULADO';

@Injectable()
export class MoraService {
    private readonly logger = new Logger(MoraService.name);

    constructor(private readonly prisma: PrismaService) {}

    // ─── Configuración ────────────────────────────────────────────────────────

    /**
     * Parámetros del régimen. Salen de `empresa.configuracion.mora` y caen al default si no están.
     * Se mergean campo por campo para que una config parcial no rompa el resto.
     */
    async obtenerConfig(empresaId: number): Promise<ConfigMora> {
        const empresa = await this.prisma.empresa.findUnique({
            where: { id: empresaId },
            select: { configuracion: true },
        });
        if (!empresa) throw new NotFoundException(`No existe la empresa ${empresaId}`);

        const raw = (empresa.configuracion as Record<string, unknown> | null)?.mora as
            | Partial<ConfigMora>
            | undefined;
        if (!raw) return { ...CONFIG_MORA_DEFAULT };

        return {
            recargoFijo: numeroValido(raw.recargoFijo) ?? CONFIG_MORA_DEFAULT.recargoFijo,
            recargoGestion: numeroValido(raw.recargoGestion) ?? CONFIG_MORA_DEFAULT.recargoGestion,
            iva: numeroValido(raw.iva) ?? CONFIG_MORA_DEFAULT.iva,
            diasBase: numeroValido(raw.diasBase) ?? CONFIG_MORA_DEFAULT.diasBase,
            multiplicadores: raw.multiplicadores ?? CONFIG_MORA_DEFAULT.multiplicadores,
        };
    }

    // ─── Generación del índice ────────────────────────────────────────────────

    /**
     * Genera el índice diario de un mes para los tres tipos y, si hace falta, **regenera todos los
     * meses posteriores**: la cadena es acumulativa, así que cambiar un mes invalida los que siguen.
     *
     * @param permitirInicioDeCadena Solo para arrancar una cadena desde cero en una empresa sin
     *   historia. Es un acto deliberado y queda logueado en warn: si se usa por error sobre una
     *   cadena existente, todas las deudas actualizadas quedan mal.
     * @param permitirPisarMigrado Necesario para regenerar meses cuyo índice vino migrado del
     *   cedente. Reemplaza dato autoritativo por una reconstrucción: se pide explícito.
     */
    async generarMes(
        empresaId: number,
        periodo: string,
        tasaBase: number,
        opts: {
            usuarioId?: number;
            fuente?: string;
            observacion?: string;
            permitirInicioDeCadena?: boolean;
            permitirPisarMigrado?: boolean;
        } = {},
    ): Promise<ResultadoGeneracion> {
        const t0 = Date.now();
        this.logger.log(
            `Generación de índice iniciada empresaId=${empresaId} periodo=${periodo} tasaBase=${tasaBase}`,
        );

        if (!(tasaBase > 0) || tasaBase > 100) {
            throw new BadRequestException(
                `Tasa fuera de rango: ${tasaBase}. Se espera la tasa mensual como la informa el cedente ` +
                `(por ejemplo 2.169 para 2,169%), sin dividir por 100.`,
            );
        }
        const config = await this.obtenerConfig(empresaId);

        // Se valida ANTES de tocar `tasa_mora`: si la generación falla después del upsert, queda una
        // tasa cargada con cero días de índice, que en la tabla se lee como si estuviera puesta.
        const previo = await this.preverGeneracion(empresaId, periodo);

        if (previo.cadenaVacia && !opts.permitirInicioDeCadena) {
            throw new BadRequestException(
                `Esta empresa no tiene ningún índice cargado, así que ${periodo} sería el arranque de ` +
                `la cadena. Es una decisión deliberada: confirmala desde la pantalla o mandá ` +
                `permitirInicioDeCadena. Los meses anteriores a ${periodo} quedan sin poder calcularse.`,
            );
        }

        if (!previo.cadenaVacia && previo.faltaDiaAnterior) {
            throw new BadRequestException(
                `Falta el índice del día anterior a ${periodo}. La cadena es acumulativa y no se puede ` +
                `reiniciar: generá primero los meses anteriores. (Arrancar en 1 a mitad de la serie es ` +
                `el bug que puso todas las deudas en negativo en el sistema del cedente — ver ` +
                `mora-aysa-spec.md §8.1.)`,
            );
        }

        if (previo.periodosMigrados.length && !opts.permitirPisarMigrado) {
            throw new BadRequestException(
                `Generar ${periodo} reemplazaría el índice migrado del cedente de ${previo.periodosMigrados.length} ` +
                `mes(es): ${previo.periodosMigrados.slice(0, 12).join(', ')}` +
                (previo.periodosMigrados.length > 12 ? ` y ${previo.periodosMigrados.length - 12} más` : '') +
                `. El índice migrado es más fiel que el que se reconstruye desde una tasa mensual única, ` +
                `porque hubo meses con más de una tasa vigente. Si igual querés hacerlo, mandá ` +
                `permitirPisarMigrado.`,
            );
        }

        if (opts.permitirPisarMigrado && previo.periodosMigrados.length) {
            this.logger.warn(
                `Pisando índice migrado empresaId=${empresaId} periodos=${previo.periodosMigrados.join(',')} ` +
                `usuarioId=${opts.usuarioId ?? 'SYS'}`,
            );
        }

        await this.prisma.tasa_mora.upsert({
            where: { empresaId_periodo: { empresaId, periodo } },
            create: {
                empresaId,
                periodo,
                tasaBase: new Prisma.Decimal(tasaBase.toFixed(6)),
                fuente: opts.fuente ?? 'MAIL_AYSA',
                observacion: opts.observacion,
                usuarioId: opts.usuarioId,
            },
            update: {
                tasaBase: new Prisma.Decimal(tasaBase.toFixed(6)),
                fuente: opts.fuente ?? 'MAIL_AYSA',
                observacion: opts.observacion,
                usuarioId: opts.usuarioId,
            },
        });

        const generado = await this.generarUnMes(empresaId, periodo, tasaBase, config, opts.permitirInicioDeCadena);

        // La cadena es acumulativa: los meses posteriores ya generados quedaron inválidos.
        const posteriores = previo.periodosPosteriores;
        const regenerados: string[] = [];
        for (const p of posteriores) {
            const tasa = await this.prisma.tasa_mora.findUnique({
                where: { empresaId_periodo: { empresaId, periodo: p } },
                select: { tasaBase: true },
            });
            if (!tasa) {
                this.logger.warn(
                    `El periodo ${p} tiene índice pero no tiene tasa cargada; no se puede regenerar. ` +
                    `Su cadena queda desactualizada hasta que se cargue la tasa.`,
                );
                continue;
            }
            await this.generarUnMes(empresaId, p, Number(tasa.tasaBase), config, false);
            regenerados.push(p);
        }

        const finales = await this.indicesDeCierre(empresaId, periodo);
        const durationMs = Date.now() - t0;
        this.logger.log(
            `Generación de índice completada empresaId=${empresaId} periodo=${periodo} ` +
            `dias=${generado.dias} regenerados=${regenerados.length} en ${durationMs}ms`,
        );

        return {
            periodo,
            tasaBase,
            diasGenerados: generado.dias,
            indicesFinales: finales,
            periodosRegenerados: regenerados,
            durationMs,
        };
    }

    /**
     * Estado de la cadena antes de cargar una tasa, para que la pantalla pregunte lo que
     * corresponda **antes** de mandar la carga.
     *
     * Existe porque la pantalla lo deducía de las filas que tenía a mano —las últimas 24— y con eso
     * no alcanzaba: recargar un mes más viejo que esa ventana regeneraba cientos de meses sin
     * preguntar nada.
     */
    async preverGeneracion(empresaId: number, periodo: string): Promise<PrevioGeneracion> {
        const { anio, mes } = parsearPeriodo(periodo);
        const primerDia = fechaUtc(anio, mes, 1);
        const diaAnterior = new Date(primerDia.getTime() - 86400000);

        const [tasa, totalIndice, indiceAnterior, posteriores, migrados] = await Promise.all([
            this.prisma.tasa_mora.findUnique({
                where: { empresaId_periodo: { empresaId, periodo } },
                select: { periodo: true },
            }),
            this.prisma.indice_mora.count({ where: { empresaId } }),
            this.prisma.indice_mora.count({
                where: { empresaId, tipo: TIPO_DEUDA_ACTUALIZADA, fecha: diaAnterior },
            }),
            this.periodosPosteriores(empresaId, periodo),
            // El mes que se carga se pisa a sí mismo, así que va incluido en el rango.
            this.prisma.$queryRaw<{ periodo: string }[]>`
                SELECT DISTINCT DATE_FORMAT(fecha, '%Y-%m') AS periodo
                FROM indice_mora
                WHERE empresaId = ${empresaId} AND fecha >= ${primerDia} AND origen <> ${ORIGEN_CALCULADO}
                ORDER BY periodo ASC
            `,
        ]);

        return {
            periodo,
            yaHayTasa: tasa != null,
            cadenaVacia: totalIndice === 0,
            faltaDiaAnterior: indiceAnterior === 0,
            periodosPosteriores: posteriores,
            periodosMigrados: migrados.map((m) => m.periodo),
        };
    }

    /** Encadena los días de UN mes para los tres tipos. No toca los meses posteriores. */
    private async generarUnMes(
        empresaId: number,
        periodo: string,
        tasaBase: number,
        config: ConfigMora,
        permitirInicioDeCadena = false,
    ): Promise<{ dias: number }> {
        const { anio, mes } = parsearPeriodo(periodo);
        const dias = diasDelMes(anio, mes);
        const diaAnterior = new Date(fechaUtc(anio, mes, 1).getTime() - 86400000);

        const filas: Prisma.indice_moraCreateManyInput[] = [];

        for (const [tipoStr, mult] of Object.entries(config.multiplicadores)) {
            const tipo = parseInt(tipoStr, 10);
            const tasaTipo = (tasaBase * mult) / 100;

            const previo = await this.prisma.indice_mora.findUnique({
                where: { empresaId_tipo_fecha: { empresaId, tipo, fecha: diaAnterior } },
                select: { indice: true },
            });

            let anterior: number;
            if (previo) {
                anterior = Number(previo.indice);
            } else {
                const hayCadena = await this.prisma.indice_mora.count({ where: { empresaId, tipo } });
                if (hayCadena > 0 || !permitirInicioDeCadena) {
                    throw new BadRequestException(
                        `Falta el índice del ${aIsoFecha(diaAnterior)} para el tipo ${tipo}. La cadena es ` +
                        `acumulativa y no se puede reiniciar: generá primero los meses anteriores. ` +
                        `(Arrancar en 1 a mitad de la serie es el bug que puso todas las deudas en negativo ` +
                        `en el sistema del cedente — ver mora-aysa-spec.md §8.1.)`,
                    );
                }
                this.logger.warn(
                    `Iniciando cadena de mora desde 1 para empresaId=${empresaId} tipo=${tipo} periodo=${periodo}. ` +
                    `Solo es correcto si esta empresa no tiene historia previa.`,
                );
                anterior = 1;
            }

            const factor = Math.pow(1 + tasaTipo, 1 / config.diasBase);
            for (let d = 1; d <= dias; d++) {
                anterior = anterior * factor;
                filas.push({
                    empresaId,
                    tipo,
                    fecha: fechaUtc(anio, mes, d),
                    tasa: new Prisma.Decimal(tasaTipo.toFixed(8)),
                    indice: new Prisma.Decimal(anterior.toFixed(12)),
                    origen: ORIGEN_CALCULADO,
                });
            }
        }

        await this.prisma.$transaction([
            this.prisma.indice_mora.deleteMany({
                where: { empresaId, fecha: { gte: fechaUtc(anio, mes, 1), lte: fechaUtc(anio, mes, dias) } },
            }),
            this.prisma.indice_mora.createMany({ data: filas }),
        ]);

        return { dias };
    }

    /** Periodos con índice generado posteriores a `periodo`, ordenados. */
    private async periodosPosteriores(empresaId: number, periodo: string): Promise<string[]> {
        const { anio, mes } = parsearPeriodo(periodo);
        const desde = fechaUtc(anio, mes, diasDelMes(anio, mes));
        const filas = await this.prisma.$queryRaw<{ periodo: string }[]>`
            SELECT DISTINCT DATE_FORMAT(fecha, '%Y-%m') AS periodo
            FROM indice_mora
            WHERE empresaId = ${empresaId} AND fecha > ${desde}
            ORDER BY periodo ASC
        `;
        return filas.map((f) => f.periodo);
    }

    /** Índice del último día del mes, por tipo. Sirve para cotejar a ojo contra el CRM del cedente. */
    private async indicesDeCierre(empresaId: number, periodo: string): Promise<Record<string, string>> {
        const { anio, mes } = parsearPeriodo(periodo);
        const cierre = fechaUtc(anio, mes, diasDelMes(anio, mes));
        const filas = await this.prisma.indice_mora.findMany({
            where: { empresaId, fecha: cierre },
            select: { tipo: true, indice: true },
        });
        return Object.fromEntries(filas.map((f) => [String(f.tipo), f.indice.toString()]));
    }

    // ─── Cálculo ──────────────────────────────────────────────────────────────

    /**
     * Valúa las facturas de un caso a una fecha. Devuelve el detalle por factura, que es lo que
     * muestra la ficha, con los mismos conceptos que el estado de deuda de AYSA.
     *
     * Una factura que todavía no venció **no devenga nada**: ni interés, ni recargo fijo, ni
     * gestión, ni IVA. Es lo que hace AYSA (sus facturas del mes siguiente salen con todo en cero).
     */
    async calcularDeudor(deudorId: number, fecha?: Date): Promise<MoraDeudor> {
        const deudor = await this.prisma.deudor.findUnique({
            where: { id: deudorId },
            select: {
                id: true,
                empresaId: true,
                facturas: {
                    select: { id: true, nroFactura: true, importe: true, vencimiento: true },
                    orderBy: { vencimiento: 'asc' },
                },
            },
        });
        if (!deudor) throw new NotFoundException(`No existe el deudor ${deudorId}`);

        const config = await this.obtenerConfig(deudor.empresaId);
        const corte = fecha ? normalizarFecha(fecha) : hoyUtc();

        // Un solo viaje a la base por todos los índices que hacen falta.
        const fechasNecesarias = new Set<number>([corte.getTime()]);
        for (const f of deudor.facturas) fechasNecesarias.add(normalizarFecha(f.vencimiento).getTime());

        const indices = await this.prisma.indice_mora.findMany({
            where: {
                empresaId: deudor.empresaId,
                tipo: TIPO_DEUDA_ACTUALIZADA,
                fecha: { in: [...fechasNecesarias].map((t) => new Date(t)) },
            },
            select: { fecha: true, indice: true },
        });
        // Se guardan como Decimal, no como Number: la aritmética tiene que dar lo mismo que la
        // versión SQL de `recalcularCartera` (ver mora.formula.ts).
        const porFecha = new Map(indices.map((i) => [normalizarFecha(i.fecha).getTime(), i.indice]));

        const indiceCorte = porFecha.get(corte.getTime());
        const advertencias: string[] = [];
        if (indiceCorte == null) {
            advertencias.push(
                `No hay índice generado para el ${aIsoFecha(corte)}. Cargá la tasa del mes para poder actualizar.`,
            );
        }

        const detalle: DetalleMoraFactura[] = [];
        let sinIndice = 0;
        for (const f of deudor.facturas) {
            const vto = normalizarFecha(f.vencimiento);
            const capital = f.importe;
            const base: DetalleMoraFactura = {
                facturaId: f.id,
                nroFactura: f.nroFactura,
                vencimiento: aIsoFecha(vto),
                diasMora: 0,
                capital,
                coeficiente: 1,
                intRec: 0,
                recAjEj: 0,
                iva: 0,
                total: redondear2(capital),
            };

            if (vto >= corte) {
                detalle.push({ ...base, nota: 'NO_VENCIDA' });
                continue;
            }
            const indiceVto = porFecha.get(vto.getTime());
            if (indiceVto == null || indiceCorte == null) {
                sinIndice++;
                detalle.push({ ...base, nota: 'SIN_INDICE' });
                continue;
            }

            const c = conceptosMora(capital, coeficienteMora(indiceCorte, indiceVto), config);
            detalle.push({
                ...base,
                diasMora: Math.round((corte.getTime() - vto.getTime()) / 86400000),
                coeficiente: c.coeficiente.toNumber(),
                intRec: c.intRec.toNumber(),
                recAjEj: c.recAjEj.toNumber(),
                iva: c.iva.toNumber(),
                total: c.total.toNumber(),
            });
        }

        if (sinIndice > 0) {
            advertencias.push(
                `${sinIndice} factura(s) sin índice para su vencimiento: se toman sin recargo. ` +
                `Revisá que el índice cubra el rango de vencimientos de la cartera.`,
            );
        }

        // La suma también en Decimal: sumar los valores ya redondeados en punto flotante reintroduce
        // el centavo de diferencia contra el SUM() de MySQL que se buscó evitar en mora.formula.ts.
        const suma = (sel: (d: DetalleMoraFactura) => number) =>
            detalle.reduce((a, d) => a.plus(new Prisma.Decimal(sel(d))), new Prisma.Decimal(0));
        const capital = suma((d) => d.capital);
        const intRec = suma((d) => d.intRec);
        const recAjEj = suma((d) => d.recAjEj);
        const iva = suma((d) => d.iva);
        const recargo = intRec.plus(recAjEj).plus(iva);

        return {
            deudorId,
            fechaCalculo: aIsoFecha(corte),
            capital: capital.toDecimalPlaces(2).toNumber(),
            intRec: intRec.toDecimalPlaces(2).toNumber(),
            recAjEj: recAjEj.toDecimalPlaces(2).toNumber(),
            iva: iva.toDecimalPlaces(2).toNumber(),
            recargo: recargo.toDecimalPlaces(2).toNumber(),
            total: capital.plus(recargo).toDecimalPlaces(2).toNumber(),
            facturas: detalle,
            advertencias,
        };
    }

    /**
     * Recalcula y persiste `deudor.recargoMora` de toda una empresa, en SQL.
     *
     * Es un JOIN contra `indice_mora`, no un loop: con AYSA son 1,1M de facturas. El redondeo va
     * por factura y por concepto, igual que en `calcularDeudor` (docs/mora-aysa-spec.md §6.1).
     */
    async recalcularCartera(
        empresaId: number,
        opts: { fecha?: Date; dryRun?: boolean } = {},
    ): Promise<ResultadoRecalculo> {
        const t0 = Date.now();
        const dryRun = opts.dryRun ?? false;
        const corte = opts.fecha ? normalizarFecha(opts.fecha) : hoyUtc();
        const iso = aIsoFecha(corte);
        const config = await this.obtenerConfig(empresaId);

        this.logger.log(
            `Recálculo de mora iniciado empresaId=${empresaId} fecha=${iso} dryRun=${dryRun}`,
        );

        const hayIndice = await this.prisma.indice_mora.count({
            where: { empresaId, tipo: TIPO_DEUDA_ACTUALIZADA, fecha: corte },
        });
        if (!hayIndice) {
            throw new BadRequestException(
                `No hay índice para el ${iso}. Cargá la tasa del mes antes de recalcular.`,
            );
        }

        const [{ evaluados }] = await this.prisma.$queryRaw<{ evaluados: bigint }[]>`
            SELECT COUNT(*) AS evaluados FROM deudor WHERE empresaId = ${empresaId}
        `;
        const [{ sinIndice }] = await this.prisma.$queryRaw<{ sinIndice: bigint }[]>`
            SELECT COUNT(*) AS sinIndice
            FROM factura f
            JOIN deudor d ON d.id = f.deudorId
            LEFT JOIN indice_mora iv
                   ON iv.empresaId = d.empresaId AND iv.tipo = ${TIPO_DEUDA_ACTUALIZADA}
                  AND iv.fecha = DATE(f.vencimiento)
            WHERE d.empresaId = ${empresaId} AND f.vencimiento < ${corte} AND iv.fecha IS NULL
        `;

        let actualizados = 0;
        if (!dryRun) {
            await this.prisma.$transaction(async (tx) => {
                // Los casos sin facturas vencidas no entran en el JOIN de abajo; se los pone en cero
                // primero para que no queden con un recargo viejo.
                await tx.$executeRaw`
                    UPDATE deudor
                    SET recargoMora = 0, deudaActualizada = montoTotal, moraCalculadaEn = NOW()
                    WHERE empresaId = ${empresaId}
                `;
                actualizados = await tx.$executeRaw`
                    UPDATE deudor d
                    JOIN (
                        SELECT deudorId,
                               ROUND(SUM(intrec + recajej + ROUND(${config.iva} * (intrec + recajej), 2)), 2) AS recargo
                        FROM (
                            SELECT b.deudorId, b.intrec,
                                   ROUND(${config.recargoGestion} * (b.cap + b.intrec), 2) AS recajej
                            FROM (
                                -- CAST a DECIMAL a proposito: factura.importe es DOUBLE y MySQL
                                -- contagia el tipo, asi que sin esto toda la cadena se calcula en
                                -- punto flotante. 0,10 x (un valor de 2 decimales) cae exacto en
                                -- medio centavo 1 de cada 10 veces, y en binario ese .635 es
                                -- .63499...: redondea para abajo y el total queda corto.
                                SELECT f.deudorId, CAST(f.importe AS DECIMAL(20, 2)) AS cap,
                                       ROUND(CAST(f.importe AS DECIMAL(20, 2))
                                             * (ih.indice / iv.indice - 1 + ${config.recargoFijo}), 2) AS intrec
                                FROM factura f
                                JOIN deudor dd      ON dd.id = f.deudorId
                                JOIN indice_mora iv ON iv.empresaId = dd.empresaId AND iv.tipo = ${TIPO_DEUDA_ACTUALIZADA}
                                                   AND iv.fecha = DATE(f.vencimiento)
                                JOIN indice_mora ih ON ih.empresaId = dd.empresaId AND ih.tipo = ${TIPO_DEUDA_ACTUALIZADA}
                                                   AND ih.fecha = ${corte}
                                WHERE dd.empresaId = ${empresaId} AND f.vencimiento < ${corte}
                            ) b
                        ) c
                        GROUP BY deudorId
                    ) x ON x.deudorId = d.id
                    SET d.recargoMora = x.recargo,
                        d.deudaActualizada = COALESCE(d.montoTotal, 0) + x.recargo,
                        d.moraCalculadaEn = NOW()
                `;
            }, { timeout: TIMEOUT_RECALCULO_MS, maxWait: 15_000 });
        }

        const durationMs = Date.now() - t0;
        this.logger.log(
            `Recálculo de mora completado empresaId=${empresaId} fecha=${iso} ` +
            `evaluados=${Number(evaluados)} actualizados=${actualizados} en ${durationMs}ms`,
        );

        return {
            empresaId,
            fechaCalculo: iso,
            deudoresEvaluados: Number(evaluados),
            deudoresActualizados: actualizados,
            facturasSinIndice: Number(sinIndice),
            dryRun,
            durationMs,
        };
    }

    // ─── Estado ───────────────────────────────────────────────────────────────

    /**
     * Tasas cargadas y días de índice generados por mes, de más nuevo a más viejo.
     * Es lo que mira el panel de ajustes para ver si falta cargar el mes corriente.
     */
    async estadoTasas(empresaId: number, ultimosMeses = 24): Promise<EstadoTasa[]> {
        const filas = await this.prisma.$queryRaw<
            { periodo: string; tasaBase: Prisma.Decimal | null; fuente: string | null; diasIndice: bigint }[]
        >`
            SELECT p.periodo,
                   t.tasaBase,
                   t.fuente,
                   COALESCE(i.dias, 0) AS diasIndice
            FROM (
                SELECT DISTINCT DATE_FORMAT(fecha, '%Y-%m') AS periodo FROM indice_mora WHERE empresaId = ${empresaId}
                UNION
                SELECT periodo FROM tasa_mora WHERE empresaId = ${empresaId}
            ) p
            LEFT JOIN tasa_mora t ON t.empresaId = ${empresaId} AND t.periodo = p.periodo
            LEFT JOIN (
                SELECT DATE_FORMAT(fecha, '%Y-%m') AS periodo, COUNT(*) AS dias
                FROM indice_mora
                WHERE empresaId = ${empresaId} AND tipo = ${TIPO_DEUDA_ACTUALIZADA}
                GROUP BY 1
            ) i ON i.periodo = p.periodo
            ORDER BY p.periodo DESC
            LIMIT ${ultimosMeses}
        `;

        return filas.map((f) => {
            const { anio, mes } = parsearPeriodo(f.periodo);
            const dias = Number(f.diasIndice);
            return {
                periodo: f.periodo,
                tasaBase: f.tasaBase != null ? Number(f.tasaBase) : null,
                fuente: f.fuente,
                diasIndice: dias,
                completo: dias === diasDelMes(anio, mes),
            };
        });
    }

    /**
     * Meses sin índice completo entre el más viejo cargado y el mes corriente.
     * Un hueco acá significa que cualquier deuda que lo cruce se valúa mal.
     */
    async mesesFaltantes(empresaId: number): Promise<string[]> {
        const estado = await this.estadoTasas(empresaId, 1000);
        if (!estado.length) return [];
        const completos = new Set(estado.filter((e) => e.completo).map((e) => e.periodo));

        // El barrido arranca en el vencimiento más viejo de la cartera, no en el mes más viejo que ya
        // tiene índice: si el índice empieza en 2020 y hay facturas de 2015, esos cinco años son
        // justamente los que van a salir SIN_INDICE y antes no se reportaban como faltantes.
        const [{ minVto }] = await this.prisma.$queryRaw<{ minVto: Date | null }[]>`
            SELECT MIN(f.vencimiento) AS minVto
            FROM factura f
            JOIN deudor d ON d.id = f.deudorId
            WHERE d.empresaId = ${empresaId}
        `;
        const primerIndice = parsearPeriodo(estado[estado.length - 1].periodo);
        const primero = minVto
            ? (() => {
                const v = { anio: minVto.getUTCFullYear(), mes: minVto.getUTCMonth() + 1 };
                // El más viejo de los dos: no tiene sentido pedir meses posteriores al inicio del índice.
                return v.anio < primerIndice.anio || (v.anio === primerIndice.anio && v.mes < primerIndice.mes)
                    ? v
                    : primerIndice;
            })()
            : primerIndice;
        const hoy = hoyUtc();

        const faltantes: string[] = [];
        let anio = primero.anio;
        let mes = primero.mes;
        while (anio < hoy.getUTCFullYear() || (anio === hoy.getUTCFullYear() && mes <= hoy.getUTCMonth() + 1)) {
            const p = formatearPeriodo(anio, mes);
            if (!completos.has(p)) faltantes.push(p);
            mes++;
            if (mes > 12) { mes = 1; anio++; }
        }
        return faltantes;
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function numeroValido(x: unknown): number | undefined {
    return typeof x === 'number' && Number.isFinite(x) ? x : undefined;
}

/** Lleva cualquier Date a medianoche UTC, que es como se guardan las columnas `@db.Date`. */
function normalizarFecha(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * El día de hoy **según el calendario local**, llevado a medianoche UTC para poder comparar contra
 * las columnas `@db.Date`.
 *
 * No es lo mismo que `normalizarFecha(new Date())`: eso lee los componentes en UTC, así que en
 * Argentina (UTC−3) a partir de las 21:00 devuelve el día de mañana — y pide un índice que todavía
 * no existe. El último día del mes eso hacía fallar el recálculo con la tasa correctamente cargada.
 */
function hoyUtc(): Date {
    const ahora = new Date();
    return new Date(Date.UTC(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()));
}
