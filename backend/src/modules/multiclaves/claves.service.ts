import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { DeudorBloqueoService } from '../deudores/utils/deudor-bloqueo';
import { calcularVtoImpreso, esClaveVencida } from './cupon-pdf.service';

/** Tolerancia (en pesos) para avisar que el saldo del caso difiere del saldo que informó Telecom. */
const TOLERANCIA_SALDO_DISTINTO = 1;

/**
 * Resumen y navegación de una carga de MULTICLAVES, más (fase 2) las claves de un caso para la
 * ficha. Nada de esto escribe: todo se calcula con queries, la carga misma la hace
 * `MulticlavesProcessor` y el cupón/convenio los escribe `CuponService`.
 *
 * Ver `docs/multiclaves-spec.md` §5.7, §6, §9.
 */
@Injectable()
export class ClavesService {
    private readonly logger = new Logger(ClavesService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly bloqueo: DeudorBloqueoService,
    ) { }

    /** 404 si la remesa no existe o no es de categoría MULTICLAVES. */
    private async assertRemesaMulticlaves(remesaId: number) {
        const remesa = await this.prisma.remesa.findUnique({
            where: { id: remesaId },
            select: { id: true, empresaId: true, categoria: true, errFilas: true },
        });
        if (!remesa || remesa.categoria !== 'MULTICLAVES') {
            throw new NotFoundException(`Remesa ${remesaId} no encontrada o no es una carga de claves de pago`);
        }
        return remesa;
    }

    /**
     * `GET /multiclaves/lotes/:remesaId/resumen` (spec §5.7, §9.3). Todo por query — no se guarda
     * un JSON de resultado: "con caso" cambia sola cuando llega el CA, que es lo que se busca.
     */
    async resumenLote(remesaId: number) {
        const t0 = Date.now();
        const remesa = await this.assertRemesaMulticlaves(remesaId);

        const [claves, avisosRaw, reemplazadasPorEsta] = await Promise.all([
            this.prisma.clave_pago.findMany({ where: { remesaId }, select: { nroTramite: true, estado: true } }),
            this.prisma.importerror.findMany({ where: { remesaId, rowNumber: 0 }, select: { errorMsg: true } }),
            this.prisma.clave_pago.count({ where: { reemplazadaPorRemesaId: remesaId } }),
        ]);

        const nroTramites = [...new Set(claves.map((c) => c.nroTramite))];
        const vigentes = claves.filter((c) => c.estado === 'VIGENTE').length;
        const reemplazadasEnEsta = claves.filter((c) => c.estado === 'REEMPLAZADA').length;

        // Fase 1.1: trámites que esta carga trajo con una única clave (SOLO_TOTAL, sin la de
        // quita). Barato: se cuenta en memoria sobre las filas que ya se trajeron arriba — todas
        // las claves de un mismo trámite cargadas por ESTA remesa comparten tanda, así que agrupar
        // por `nroTramite` y contar los grupos de tamaño 1 alcanza, sin otra query.
        const clavesPorTramite = new Map<string, number>();
        for (const c of claves) clavesPorTramite.set(c.nroTramite, (clavesPorTramite.get(c.nroTramite) ?? 0) + 1);
        const soloTotal = [...clavesPorTramite.values()].filter((n) => n === 1).length;

        let conCaso = 0;
        for (let i = 0; i < nroTramites.length; i += 1000) {
            const chunk = nroTramites.slice(i, i + 1000);
            const casos = await this.prisma.deudor.findMany({
                where: { empresaId: remesa.empresaId, nroCliente: { in: chunk } },
                select: { nroCliente: true },
                distinct: ['nroCliente'],
            });
            conCaso += casos.length;
        }

        // Los avisos quedan en `importerror` con el texto `[aviso] CODIGO: N caso(s) …` — los del
        // parseo (imports.service.ts, rama MULTICLAVES) salen en una sola fila por código, pero los
        // que emite el processor por lote (TANDA_ANTERIOR) pueden repetirse una vez por cada lote
        // de la carga: se suman por código en vez de listarlos por separado.
        const porCodigo = new Map<string, number>();
        for (const e of avisosRaw) {
            const m = /^\[aviso\] (\w+): (\d+)/.exec(e.errorMsg);
            if (m) porCodigo.set(m[1], (porCodigo.get(m[1]) ?? 0) + Number(m[2]));
        }
        const avisos = [...porCodigo.entries()].map(([codigo, cantidad]) => ({ codigo, cantidad }));

        this.logger.log(
            `Resumen multiclaves remesa=${remesaId}: tramites=${nroTramites.length} conCaso=${conCaso} ` +
            `en ${Date.now() - t0}ms`,
        );

        return {
            tramites: nroTramites.length,
            claves: claves.length,
            vigentes,
            reemplazadasEnEsta,
            reemplazadasPorEsta,
            soloTotal,
            conCaso,
            sinCaso: nroTramites.length - conCaso,
            rechazados: remesa.errFilas,
            avisos,
        };
    }

    /**
     * `GET /multiclaves/lotes/:remesaId/sin-caso` (spec §5.7, §9.3): lista paginada de los
     * trámites de esta carga que todavía no tienen caso en la empresa, para reclamar o esperar el CA.
     */
    async sinCaso(remesaId: number, page = 1, pageSize = 50) {
        // `page`/`pageSize` vienen de un query param: un valor negativo, en 0 o gigante no puede
        // convertirse en un `slice` inválido ni en traer la lista completa de un archivo de 7.478
        // trámites de una sola vez.
        page = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
        pageSize = Number.isFinite(pageSize) ? Math.min(200, Math.max(1, Math.floor(pageSize))) : 50;

        const remesa = await this.assertRemesaMulticlaves(remesaId);

        const claves = await this.prisma.clave_pago.findMany({
            where: { remesaId },
            select: { nroTramite: true, tipo: true, importe: true, fechaVencimiento: true },
        });

        const porTramite = new Map<string, { total?: (typeof claves)[number]; quita?: (typeof claves)[number] }>();
        for (const c of claves) {
            const entry = porTramite.get(c.nroTramite) ?? {};
            if (c.tipo === 'TOTAL') entry.total = c; else entry.quita = c;
            porTramite.set(c.nroTramite, entry);
        }

        const nroTramites = [...porTramite.keys()];
        const conCaso = new Set<string>();
        for (let i = 0; i < nroTramites.length; i += 1000) {
            const chunk = nroTramites.slice(i, i + 1000);
            const casos = await this.prisma.deudor.findMany({
                where: { empresaId: remesa.empresaId, nroCliente: { in: chunk } },
                select: { nroCliente: true },
                distinct: ['nroCliente'],
            });
            for (const c of casos) if (c.nroCliente) conCaso.add(c.nroCliente);
        }

        const sinCasoTramites = nroTramites.filter((n) => !conCaso.has(n)).sort();
        const total = sinCasoTramites.length;
        const desde = Math.max(0, (page - 1) * pageSize);
        const items = sinCasoTramites.slice(desde, desde + pageSize).map((nroTramite) => {
            const entry = porTramite.get(nroTramite)!;
            const referencia = entry.total ?? entry.quita!;
            return {
                nroTramite,
                // String, no number: es un Decimal (§4.1) y el importe viaja dentro de un código de
                // barras — convertirlo a number en el camino podría perder precisión en un import
                // que no la controla (acá es solo lectura, pero la regla es la misma en todo el módulo).
                importeTotal: entry.total ? entry.total.importe.toString() : null,
                importeQuita: entry.quita ? entry.quita.importe.toString() : null,
                fechaVencimiento: referencia.fechaVencimiento.toISOString().slice(0, 10),
            };
        });

        return { total, items };
    }

    /**
     * `GET /multiclaves/deudores/:deudorId/claves` (spec §9.1): las claves del trámite de este
     * caso (`clave_pago.nroTramite = deudor.nroCliente`, misma empresa — §6.2) para la ficha.
     */
    async clavesDelCaso(deudorId: number, incluirReemplazadas = false) {
        const t0 = Date.now();
        const deudor = await this.prisma.deudor.findUnique({
            where: { id: deudorId },
            select: { id: true, empresaId: true, nroCliente: true, saldo: true, montoTotal: true, estadoSituacionId: true },
        });
        if (!deudor) throw new NotFoundException(`Deudor ${deudorId} no encontrado`);

        const nroTramite = (deudor.nroCliente ?? '').trim() || null;
        const cuentaCancelada = this.bloqueo.estaBloqueado(deudor.estadoSituacionId);

        if (!nroTramite) {
            return {
                nroTramite: null,
                claves: [],
                avisos: { cuentaCancelada, saldoDistinto: null, otrosCasosDelTramite: [], plantillaCuponConfigurada: false },
            };
        }

        const [claves, otrosCasosIds] = await Promise.all([
            this.prisma.clave_pago.findMany({
                where: {
                    empresaId: deudor.empresaId,
                    nroTramite,
                    ...(incluirReemplazadas ? {} : { estado: 'VIGENTE' }),
                },
                include: { remesa: { select: { id: true, numeroRemesa: true, createdAt: true } } },
                orderBy: [{ tipo: 'asc' }],
            }),
            // Cruda porque `nroTramite` sale de un `TRIM(deudor.nroCliente)` (línea de arriba): un
            // `where: { nroCliente: nroTramite }` de Prisma compara IGUAL, sin trim, así que un
            // caso hermano cargado con espacios alrededor del número (`" 1841012140"`, visto en la
            // auditoría) no matcheaba — quedaba afuera del aviso de "otro caso con este trámite"
            // aunque fuera exactamente el mismo trámite. `TRIM` de MySQL para que las dos
            // resoluciones (la propia y la de los hermanos) usen el mismo criterio.
            this.prisma.$queryRaw<Array<{ id: number }>>`
                SELECT id FROM deudor WHERE empresaId = ${deudor.empresaId} AND TRIM(nroCliente) = ${nroTramite} AND id <> ${deudorId}
            `,
        ]);

        const otrosCasos = otrosCasosIds.length
            ? await this.prisma.deudor.findMany({
                where: {
                    id: { in: otrosCasosIds.map((o) => o.id) },
                    estadoSituacion: { is: { categoria: { not: 'CANCELADO' } } },
                },
                select: {
                    id: true,
                    remesa: { select: { numeroRemesa: true } },
                    estadoSituacion: { select: { clave: true } },
                    estadoGestion: { select: { clave: true } },
                },
            })
            : [];

        const convenios = claves.length
            ? await this.prisma.convenio.findMany({
                where: { origen: 'CLAVE_PAGO', estado: 'ACTIVO', clavePagoId: { in: claves.map((c) => c.id) } },
                select: { id: true, deudorId: true, clavePagoId: true, createdAt: true },
            })
            : [];
        const convenioPorClave = new Map(convenios.filter((c) => c.clavePagoId != null).map((c) => [c.clavePagoId as number, c]));

        // El saldo de referencia de Telecom es el de la TOTAL (§4.1: `saldoTramite` es el mismo en
        // las dos claves del par) — si por lo que sea no hay TOTAL vigente, se usa el que haya.
        const claveTotal = claves.find((c) => c.tipo === 'TOTAL') ?? claves[0] ?? null;
        const saldoTramiteRef = claveTotal ? Number(claveTotal.saldoTramite) : null;
        const saldoCaso = deudor.saldo ?? deudor.montoTotal ?? null;
        const saldoDistinto =
            saldoTramiteRef != null && saldoCaso != null && Math.abs(saldoCaso - saldoTramiteRef) > TOLERANCIA_SALDO_DISTINTO
                ? { saldoCaso, saldoTramite: String(saldoTramiteRef) }
                : null;

        this.logger.log(`Claves del caso ${deudorId} (trámite=${nroTramite}): ${claves.length} en ${Date.now() - t0}ms`);

        return {
            nroTramite,
            claves: claves.map((c) => {
                const convenio = convenioPorClave.get(c.id) ?? null;
                return {
                    id: c.id,
                    tipo: c.tipo,
                    nroConvenio: c.nroConvenio,
                    importe: String(c.importe),
                    saldoTramite: String(c.saldoTramite),
                    fechaVencimiento: c.fechaVencimiento.toISOString().slice(0, 10),
                    vtoImpreso: calcularVtoImpreso(c.fechaVencimiento),
                    vencida: esClaveVencida(c.fechaVencimiento),
                    // NUNCA la clave de 22 dígitos ni el código de barras completos (D6): con eso
                    // alcanza para armar un cupón cobrable sin pasar por el convenio, a cualquiera
                    // con `convenios.ver`. Solo los últimos 4 dígitos, para identificarla en la UI.
                    // Hallazgo de la auditoría de la fase 2 — ver también `cupon.service.ts#preview`.
                    clavePagoUltimos4: c.clavePago.slice(-4),
                    estado: c.estado,
                    lote: { remesaId: c.remesa.id, numeroRemesa: c.remesa.numeroRemesa, cargadaEn: c.remesa.createdAt.toISOString() },
                    convenioActivo: convenio
                        ? { id: convenio.id, deudorId: convenio.deudorId, esEsteCaso: convenio.deudorId === deudorId, createdAt: convenio.createdAt.toISOString() }
                        : null,
                };
            }),
            avisos: {
                cuentaCancelada,
                saldoDistinto,
                otrosCasosDelTramite: otrosCasos.map((o) => ({
                    deudorId: o.id,
                    numeroRemesa: o.remesa?.numeroRemesa ?? '',
                    situacion: o.estadoSituacion?.clave ?? null,
                    enGestion: o.estadoGestion?.clave !== 'GES-094',
                })),
                // Fase 3: se completa cuando exista `configuracion.multiclaves.templateCuponId`.
                plantillaCuponConfigurada: false,
            },
        };
    }
}
