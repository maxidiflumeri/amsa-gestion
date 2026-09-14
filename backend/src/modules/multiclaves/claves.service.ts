import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

/**
 * Resumen y navegación de una carga de MULTICLAVES, y (fases 2-3) claves del caso y config de
 * empresa. En esta fase 1 solo `resumenLote` y `sinCaso` (§5.7 y §9.3 del spec) — nada de esto
 * escribe: todo se calcula con queries, la carga misma la hace `MulticlavesProcessor`.
 *
 * Ver `docs/multiclaves-spec.md` §5.7, §6, §9.
 */
@Injectable()
export class ClavesService {
    private readonly logger = new Logger(ClavesService.name);

    constructor(private readonly prisma: PrismaService) { }

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
}
