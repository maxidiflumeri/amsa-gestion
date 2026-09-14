// processors/multiclaves.processor.ts
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
    BatchRow, BatchRowError, ICategoryProcessor, MappedRow, ProcessContext, RowValidationResult,
} from './processor.interface';
import { TramiteClaves } from '../utils/multiclaves-parser';
import { formatoImporteCupon } from '../../multiclaves/utils/clave-pago';

/** Filas/ids por `createMany`/`updateMany`. Acota el tamaño del statement, no la cantidad de queries. */
const CHUNK_ESCRITURA = 1000;

/**
 * Timeout explícito de las transacciones de escritura: el default de Prisma (5.000 ms) alcanza
 * sobrado para las pocas queries en lote que quedan tras agrupar, pero un margen mayor cubre la
 * latencia real de RDS sin arriesgar un "Transaction not found" a mitad de una reemisión grande.
 */
const TX_OPTS = { timeout: 30_000, maxWait: 10_000 };

/** Parte un array en bloques de a lo sumo `size`. */
function enBloques<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

/**
 * Procesador de la categoría MULTICLAVES (claves de pago de Telecom/Personal).
 *
 * El runner lo trata como preparsado, igual que MULTIRREGISTRO/MULTIARCHIVO: una "fila" acá es un
 * **trámite** entero (`TramiteClaves`, con sus 2 claves ya clasificadas TOTAL/QUITA), armado por
 * `utils/multiclaves-parser.ts`. `validateRow` filtra los trámites que el parser ya rechazó;
 * `processBatch` resuelve idempotencia, reemisión y conflictos entre trámites contra la base.
 *
 * **Sin estado de instancia**: este processor es un singleton del registry, compartido entre todas
 * las corridas (`processor-registry.ts`). Los contadores del resumen se calculan con queries en
 * `afterAll`, no se acumulan en campos de la instancia.
 *
 * Ver `docs/multiclaves-spec.md` §5.5.
 */
export class MulticlavesProcessor implements ICategoryProcessor {
    readonly category = 'MULTICLAVES';
    private readonly logger = new Logger(MulticlavesProcessor.name);

    validateRow(row: MappedRow, _ctx: ProcessContext): RowValidationResult {
        const t = row as unknown as TramiteClaves;
        if (t.rechazo) {
            return {
                valid: false,
                error: `[${t.rechazo.motivo}] líneas ${t.lineas.join(',')}: ${t.rechazo.detalle}`,
            };
        }
        return { valid: true };
    }

    /** Camino de una sola fila: delega en `processBatch` con un lote de 1 (mismo criterio que FACTURAS). */
    async processRow(row: MappedRow, ctx: ProcessContext): Promise<void> {
        const [fallo] = await this.processBatch([{ row, idx: 0 }], ctx);
        if (fallo) throw new Error(fallo.error);
    }

    async processBatch(rows: BatchRow[], ctx: ProcessContext): Promise<BatchRowError[]> {
        const errores: BatchRowError[] = [];
        const tramites = rows.map((r) => ({ idx: r.idx, t: r.row as unknown as TramiteClaves }));

        const nroConvenios = [...new Set(tramites.flatMap(({ t }) => t.claves!.map((c) => c.nroConvenio)))];
        const nroTramites = [...new Set(tramites.map(({ t }) => t.nroTramite))];

        // 1. Convenios de este lote que ya existen en CUALQUIER empresa (idempotencia + conflicto).
        const existentes = await ctx.prisma.clave_pago.findMany({
            where: { nroConvenio: { in: nroConvenios } },
            select: {
                id: true, empresaId: true, nroTramite: true, nroConvenio: true,
                empresa: { select: { nombre: true } },
                remesa: { select: { numeroRemesa: true } },
            },
        });
        const existentePorConvenio = new Map(existentes.map((e) => [e.nroConvenio, e]));

        // 2. Claves VIGENTE de esos trámites, en ESTA empresa (para decidir reemisión vs. carga nueva).
        const vigentes = await ctx.prisma.clave_pago.findMany({
            where: { empresaId: ctx.empresaId, nroTramite: { in: nroTramites }, estado: 'VIGENTE' },
            select: { id: true, nroTramite: true, remesaId: true, fechaVencimiento: true },
        });
        const vigentesPorTramite = new Map<string, typeof vigentes>();
        for (const v of vigentes) {
            const lista = vigentesPorTramite.get(v.nroTramite) ?? [];
            lista.push(v);
            vigentesPorTramite.set(v.nroTramite, lista);
        }

        interface Plan {
            idx: number;
            nroTramite: string;
            reemplazarVigentesIds?: number[];
            inserts?: Prisma.clave_pagoCreateManyInput[];
            esTandaAnterior?: boolean;
        }
        const planes: Plan[] = [];
        let nuevos = 0;
        let reemisiones = 0;
        let yaCargadas = 0;

        for (const { idx, t } of tramites) {
            const claves = t.claves!;
            const existentesDeEstas = claves
                .map((c) => existentePorConvenio.get(c.nroConvenio))
                .filter((e): e is NonNullable<typeof e> => !!e);

            // b. Alguno de los convenios ya existe en OTRA empresa u OTRO trámite → conflicto.
            const conflicto = existentesDeEstas.find(
                (e) => e.empresaId !== ctx.empresaId || e.nroTramite !== t.nroTramite,
            );
            if (conflicto) {
                // `empresa`/`remesa` sobreviven solo si esas filas todavía existen: `remesaId` es una
                // FK RESTRICT (nunca debería faltar), pero se resuelve con fallback igual — un wipe
                // manual de cartera que no respete el orden (clave_pago antes que remesa) no puede
                // tirar abajo el processor por un `.nombre`/`.numeroRemesa` de `undefined`.
                errores.push({
                    idx,
                    error:
                        `[CONVENIO_YA_EXISTE] El convenio ${conflicto.nroConvenio} ya está cargado para el ` +
                        `trámite ${conflicto.nroTramite} en la empresa ${conflicto.empresa?.nombre ?? `#${conflicto.empresaId}`} ` +
                        `(remesa ${conflicto.remesa?.numeroRemesa ?? '(remesa eliminada)'}).`,
                });
                continue;
            }

            // a. Los dos convenios ya existen, en este mismo (empresa, trámite) → recarga idempotente (R4).
            if (existentesDeEstas.length === 2) {
                yaCargadas++;
                continue;
            }

            // c. Solo uno de los dos convenios existe (mismo trámite) → inconsistencia, no se toca.
            if (existentesDeEstas.length === 1) {
                errores.push({
                    idx,
                    error:
                        `[TANDA_PARCIAL] El trámite ${t.nroTramite} ya tiene cargado el convenio ` +
                        `${existentesDeEstas[0].nroConvenio} pero no el otro de su par; no se modifica nada. ` +
                        'Revisar manualmente antes de recargar.',
                });
                continue;
            }

            // d. Ningún convenio existe todavía: decide si es carga nueva o reemisión de una tanda vigente.
            const vig = vigentesPorTramite.get(t.nroTramite) ?? [];
            const datos = (estado: 'VIGENTE' | 'REEMPLAZADA', reemplazadaPorRemesaId: number | null): Prisma.clave_pagoCreateManyInput[] =>
                claves.map((c) => ({
                    empresaId: ctx.empresaId,
                    remesaId: ctx.remesaId,
                    nroTramite: t.nroTramite,
                    nroConvenio: c.nroConvenio,
                    tipo: c.tipo,
                    importe: formatoImporteCupon(c.importeCentavos),
                    saldoTramite: formatoImporteCupon(t.saldoTramiteCentavos!),
                    fechaVencimiento: new Date(`${c.fechaVencimiento}T00:00:00.000Z`),
                    clavePago: c.clavePago,
                    codigoBarras: c.codigoBarras,
                    codigoGestor: c.codigoGestor,
                    marca: c.marca,
                    estado,
                    reemplazadaEn: estado === 'REEMPLAZADA' ? new Date() : null,
                    reemplazadaPorRemesaId: estado === 'REEMPLAZADA' ? reemplazadaPorRemesaId : null,
                    lineaArchivo: c.linea,
                }));

            if (vig.length === 0) {
                nuevos++;
                planes.push({ idx, nroTramite: t.nroTramite, inserts: datos('VIGENTE', null) });
                continue;
            }

            const vtoNuevoMax = claves.reduce((m, c) => (c.fechaVencimiento > m ? c.fechaVencimiento : m), claves[0].fechaVencimiento);
            const vtoVigMax = vig.reduce((m, v) => {
                const iso = v.fechaVencimiento.toISOString().slice(0, 10);
                return iso > m ? iso : m;
            }, vig[0].fechaVencimiento.toISOString().slice(0, 10));

            if (vtoNuevoMax >= vtoVigMax) {
                // La tanda nueva es igual o más reciente: las vigentes actuales quedan REEMPLAZADA.
                reemisiones++;
                planes.push({
                    idx,
                    nroTramite: t.nroTramite,
                    reemplazarVigentesIds: vig.map((v) => v.id),
                    inserts: datos('VIGENTE', null),
                });
            } else {
                // La tanda nueva es más vieja que la vigente: entra directo como REEMPLAZADA por la
                // remesa que trajo la vigente actual (aviso TANDA_ANTERIOR — se carga igual, R2).
                planes.push({ idx, nroTramite: t.nroTramite, inserts: datos('REEMPLAZADA', vig[0].remesaId), esTandaAnterior: true });
            }
        }

        // 4. Escribir. TODO el lote en un puñado de queries, no una por trámite: con 1.000 trámites
        //    (el tamaño del lote del runner), una query por trámite dentro de una única transacción
        //    interactiva se corta con el timeout — Prisma abre una transacción de verdad en la base
        //    y cada round-trip cuenta contra ese reloj. El auditor lo midió: ~2.000 escrituras
        //    (1 update + 1 insert por trámite) alcanzan y sobran para reventar el default de 5s.
        //
        //    El `data` de las actualizaciones es el mismo para TODO el lote (siempre
        //    `reemplazadaPorRemesaId: ctx.remesaId`), así que se puede juntar en una sola lista de
        //    ids y aplicar en bloques — no hace falta ir trámite por trámite para eso.
        const aEscribir = planes.filter((p) => p.inserts?.length);

        const escribirEnBloque = async (tx: Prisma.TransactionClient) => {
            const todosReemplazoIds = aEscribir.flatMap((p) => p.reemplazarVigentesIds ?? []);
            for (const bloque of enBloques(todosReemplazoIds, CHUNK_ESCRITURA)) {
                await tx.clave_pago.updateMany({
                    where: { id: { in: bloque } },
                    data: { estado: 'REEMPLAZADA', reemplazadaEn: new Date(), reemplazadaPorRemesaId: ctx.remesaId },
                });
            }
            const todosInserts = aEscribir.flatMap((p) => p.inserts!);
            for (const bloque of enBloques(todosInserts, CHUNK_ESCRITURA)) {
                await tx.clave_pago.createMany({ data: bloque });
            }
        };

        // Solo para el camino de reintento (por trámite): acá sí conviene una escritura chica por
        // plan, porque lo que se busca es aislar CUÁL trámite rompe, no la performance.
        const escribirPlan = (tx: Prisma.TransactionClient, p: Plan) => {
            const acciones: Promise<unknown>[] = [];
            if (p.reemplazarVigentesIds?.length) {
                acciones.push(tx.clave_pago.updateMany({
                    where: { id: { in: p.reemplazarVigentesIds } },
                    data: { estado: 'REEMPLAZADA', reemplazadaEn: new Date(), reemplazadaPorRemesaId: ctx.remesaId },
                }));
            }
            acciones.push(tx.clave_pago.createMany({ data: p.inserts! }));
            return Promise.all(acciones);
        };

        if (aEscribir.length > 0) {
            try {
                await ctx.prisma.$transaction(escribirEnBloque, TX_OPTS);
            } catch (e: any) {
                this.logger.warn(`Multiclaves remesa=${ctx.remesaId}: falló el lote (${e.message}), reintentando trámite por trámite`);
                for (const p of aEscribir) {
                    try {
                        await ctx.prisma.$transaction((tx) => escribirPlan(tx, p), TX_OPTS);
                    } catch (e2: any) {
                        // El mensaje de Prisma trae la ruta del servidor y un trozo de código: al operador
                        // le llega el motivo, y el detalle queda en el log.
                        this.logger.warn(`Multiclaves remesa=${ctx.remesaId} trámite=${p.nroTramite}: ${e2.message}`);
                        const error = e2?.code === 'P2002'
                            ? `[CONVENIO_YA_EXISTE] Un convenio del trámite ${p.nroTramite} ya está cargado (se cargó en paralelo con esta importación)`
                            : `Error al guardar las claves de pago del trámite ${p.nroTramite}`;
                        errores.push({ idx: p.idx, error });
                    }
                }
            }
        }

        // Aviso TANDA_ANTERIOR (§5.4, R2): la tanda entró igual, pero no quedó vigente porque ya
        // había una con vencimiento posterior. Solo se avisa por los trámites que efectivamente se
        // escribieron (si el plan falló arriba, ya quedó como error, no como aviso).
        const idsConError = new Set(errores.map((e) => e.idx));
        const tandasAnteriores = aEscribir
            .filter((p) => p.esTandaAnterior && !idsConError.has(p.idx))
            .map((p) => p.nroTramite);
        if (tandasAnteriores.length > 0) {
            await ctx.prisma.importerror.createMany({
                data: [{
                    remesaId: ctx.remesaId,
                    rowNumber: 0,
                    rawRow: tandasAnteriores.slice(0, 20) as any,
                    errorMsg:
                        `[aviso] TANDA_ANTERIOR: ${tandasAnteriores.length} caso(s) ` +
                        `(ej: ${tandasAnteriores.slice(0, 5).join(', ')})`,
                }],
            });
        }

        this.logger.debug(
            `Multiclaves remesa=${ctx.remesaId} lote: nuevos=${nuevos} reemisiones=${reemisiones} ` +
            `yaCargadas=${yaCargadas} errores=${errores.length}`,
        );

        return errores;
    }

    /**
     * Log del resumen final. Todo se calcula con queries: el processor no arrastra contadores de
     * instancia entre corridas (es un singleton compartido por el registry).
     */
    async afterAll(ctx: ProcessContext): Promise<void> {
        const t0 = Date.now();
        const [cargadas, reemplazadas, tramitesDistintos] = await Promise.all([
            ctx.prisma.clave_pago.count({ where: { remesaId: ctx.remesaId } }),
            ctx.prisma.clave_pago.count({ where: { reemplazadaPorRemesaId: ctx.remesaId } }),
            ctx.prisma.clave_pago.findMany({
                where: { remesaId: ctx.remesaId },
                select: { nroTramite: true },
                distinct: ['nroTramite'],
            }),
        ]);

        const nroTramites = tramitesDistintos.map((t) => t.nroTramite);
        let conCaso = 0;
        if (nroTramites.length > 0) {
            const casos = await ctx.prisma.deudor.findMany({
                where: { empresaId: ctx.empresaId, nroCliente: { in: nroTramites } },
                select: { nroCliente: true },
                distinct: ['nroCliente'],
            });
            conCaso = casos.length;
        }

        this.logger.log(
            `Multiclaves remesa=${ctx.remesaId}: cargadas=${cargadas} reemplazadas=${reemplazadas} ` +
            `tramites=${nroTramites.length} conCaso=${conCaso} sinCaso=${nroTramites.length - conCaso} ` +
            `en ${Date.now() - t0}ms`,
        );
    }
}
