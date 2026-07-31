import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CODIGOS, RANGO_MAX_DIAS } from './codigos.constants';
import { SnapshotDto } from './dtos/snapshot.dto';
import { DrillDownDto } from './dtos/drill-down.dto';
import { resolverRango } from './rango-fechas';
import {
    BucketItem,
    DistribucionItem,
    SerieGestionItem,
    SeriePagoItem,
    SnapshotResponse,
    TopDeudor,
    TopMotivo,
} from './interfaces/snapshot.interface';

export interface DrillDownDeudor {
    id: number;
    nombreCompleto: string;
    documento: string;
    montoTotal: number;
    estadoSituacion: string | null;
    estadoGestion: string | null;
    motivoNoPago: string | null;
}

export interface DrillDownResponse {
    items: DrillDownDeudor[];
    total: number;
    page: number;
    pageSize: number;
    dimension: string;
    valor: string;
}

type Granularidad = 'dia' | 'semana' | 'mes';

@Injectable()
export class DashboardsService {
    private readonly logger = new Logger(DashboardsService.name);

    constructor(
        private prisma: PrismaService,
    ) { }

    async snapshot(dto: SnapshotDto, restrictEmpresaId: number | null): Promise<SnapshotResponse> {
        const t0 = Date.now();
        // Días COMPLETOS en hora local: `new Date('2026-07-31')` es medianoche UTC y dejaba
        // afuera todo el último día del rango. Ver `rango-fechas.ts`.
        const { desde, hasta } = resolverRango(dto.desde, dto.hasta);
        const diffDias = Math.ceil((hasta.getTime() - desde.getTime()) / 86_400_000);
        if (diffDias > RANGO_MAX_DIAS) {
            throw new BadRequestException(`Rango máximo permitido: ${RANGO_MAX_DIAS} días`);
        }
        if (diffDias > RANGO_MAX_DIAS * 0.8) {
            this.logger.warn(`Snapshot con rango amplio diffDias=${diffDias} (máx=${RANGO_MAX_DIAS})`);
        }

        const empresaIdEfectivo = restrictEmpresaId ?? dto.empresaId ?? null;

        if (dto.remesaId) {
            const rem = await this.prisma.remesa.findUnique({
                where: { id: dto.remesaId },
                select: { id: true, empresaId: true, nombre: true },
            });
            if (!rem) throw new NotFoundException('Remesa no encontrada');
            if (empresaIdEfectivo != null && rem.empresaId !== empresaIdEfectivo) {
                throw new BadRequestException('La remesa no pertenece a la empresa');
            }
        }

        const granularidad: Granularidad = dto.granularidad ?? this.resolverGranularidad(diffDias);

        const where: Prisma.deudorWhereInput = {};
        if (empresaIdEfectivo != null) where.empresaId = empresaIdEfectivo;
        if (dto.remesaId) where.remesaId = dto.remesaId;
        if (dto.situacionIds?.length) where.estadoSituacionId = { in: dto.situacionIds };
        if (dto.gestionIds?.length) where.estadoGestionId = { in: dto.gestionIds };
        if (dto.motivoIds?.length) where.motivoNoPagoId = { in: dto.motivoIds };

        const sqlDeudorWhere = this.buildSqlDeudorWhere(empresaIdEfectivo, dto);

        // Códigos canónicos: una sola consulta para resolver ids de claves de interés
        const claves = await this.prisma.parametro.findMany({
            where: {
                OR: [
                    { clave: { in: [...CODIGOS.CPC_SITUACION_CLAVES, CODIGOS.PROMESA_SITUACION_VIGENTE, CODIGOS.PROMESA_GESTION_CLAVE] } },
                    { grupo: 'situacion', categoria: { in: [CODIGOS.INCOBRABLE_CATEGORIA, CODIGOS.LEGAL_CATEGORIA, CODIGOS.CONTACTADO_CATEGORIA, CODIGOS.PAGANDO_CATEGORIA, CODIGOS.CANCELADO_CATEGORIA] } },
                ],
            },
            select: { id: true, clave: true, categoria: true },
        });
        const idsCpc = claves.filter(c => (CODIGOS.CPC_SITUACION_CLAVES as readonly string[]).includes(c.clave)).map(c => c.id);
        const idPromesaVigente = claves.find(c => c.clave === CODIGOS.PROMESA_SITUACION_VIGENTE)?.id ?? -1;
        const idPromesaGestion = claves.find(c => c.clave === CODIGOS.PROMESA_GESTION_CLAVE)?.id ?? -1;
        const idsIncobrable = claves.filter(c => c.categoria === CODIGOS.INCOBRABLE_CATEGORIA).map(c => c.id);
        const idsLegal = claves.filter(c => c.categoria === CODIGOS.LEGAL_CATEGORIA).map(c => c.id);
        const idsContactado = claves.filter(c => c.categoria === CODIGOS.CONTACTADO_CATEGORIA).map(c => c.id);
        const idsPagando = claves.filter(c => c.categoria === CODIGOS.PAGANDO_CATEGORIA).map(c => c.id);
        const idsCancelado = claves.filter(c => c.categoria === CODIGOS.CANCELADO_CATEGORIA).map(c => c.id);

        // ── Queries paralelas ──────────────────────────────────────────────
        const pagoDeudorWhere: Prisma.pagoWhereInput = {
            deudor: where,
            fecha: { gte: desde, lte: hasta },
        };

        const comentarioDeudorWhere: Prisma.comentarioWhereInput = {
            deudor: where,
            fecha: { gte: desde, lte: hasta },
        };

        const idsConPromesaEstado = idPromesaVigente > 0 ? [idPromesaVigente] : [];
        const idsConPagoEstado = [...idsPagando, ...idsCancelado];

        const [
            cantidadCasos,
            deudaAgg,
            pagosAgg,
            casosConPagoArr,
            promesasVigentes,
            cpcCount,
            casosSinGestion,
            casosIncobrables,
            casosLegales,
            grpSituacion,
            grpGestion,
            grpMotivo,
            empresaRec,
            remesaRec,
            bucketsMoraRaw,
            bucketsDeudaRaw,
            seriePagosRaw,
            serieGestionesRaw,
            moraRaw,
            funnelContactadosCount,
            funnelConPromesaCount,
            topDeudoresRaw,
        ] = await Promise.all([
            this.prisma.deudor.count({ where }),
            this.prisma.deudor.aggregate({ where, _sum: { montoTotal: true } }),
            this.prisma.pago.aggregate({
                where: pagoDeudorWhere,
                _sum: { importe: true },
                _avg: { importe: true },
                _count: true,
            }),
            this.prisma.pago.findMany({
                where: pagoDeudorWhere,
                distinct: ['deudorId'],
                select: { deudorId: true },
            }),
            idPromesaVigente > 0
                ? this.prisma.deudor.count({ where: { ...where, estadoSituacionId: idPromesaVigente } })
                : Promise.resolve(0),
            idsCpc.length
                ? this.prisma.deudor.count({ where: { ...where, estadoSituacionId: { in: idsCpc } } })
                : Promise.resolve(0),
            this.prisma.deudor.count({ where: { ...where, estadoGestionId: null } }),
            idsIncobrable.length
                ? this.prisma.deudor.count({ where: { ...where, estadoSituacionId: { in: idsIncobrable } } })
                : Promise.resolve(0),
            idsLegal.length
                ? this.prisma.deudor.count({ where: { ...where, estadoSituacionId: { in: idsLegal } } })
                : Promise.resolve(0),
            this.prisma.deudor.groupBy({ by: ['estadoSituacionId'], where, _count: { _all: true } }),
            this.prisma.deudor.groupBy({ by: ['estadoGestionId'], where, _count: { _all: true } }),
            this.prisma.deudor.groupBy({ by: ['motivoNoPagoId'], where, _count: { _all: true } }),
            empresaIdEfectivo != null
                ? this.prisma.empresa.findUnique({ where: { id: empresaIdEfectivo }, select: { id: true, nombre: true } })
                : Promise.resolve(null),
            dto.remesaId
                ? this.prisma.remesa.findUnique({ where: { id: dto.remesaId }, select: { id: true, nombre: true } })
                : Promise.resolve(null),
            this.queryBucketsMora(sqlDeudorWhere),
            this.queryBucketsDeuda(sqlDeudorWhere),
            this.querySeriePagos(sqlDeudorWhere, desde, hasta, granularidad),
            this.querySerieGestiones(sqlDeudorWhere, desde, hasta, granularidad),
            this.queryMoraPromedia(sqlDeudorWhere, desde, hasta),
            idsContactado.length
                ? this.prisma.deudor.count({ where: { ...where, estadoSituacionId: { in: idsContactado } } })
                : Promise.resolve(0),
            this.prisma.deudor.count({
                where: {
                    ...where,
                    OR: [
                        ...(idsConPromesaEstado.length ? [{ estadoSituacionId: { in: idsConPromesaEstado } }] : []),
                        ...(idPromesaGestion > 0 ? [{ estadoGestionId: idPromesaGestion }] : []),
                    ],
                },
            }),
            this.prisma.deudor.findMany({
                where,
                orderBy: { montoTotal: 'desc' },
                take: 10,
                select: {
                    id: true,
                    nombre: true,
                    apellido: true,
                    documento: true,
                    montoTotal: true,
                    estadoGestion: { select: { descripcion: true } },
                    estadoSituacion: { select: { descripcion: true } },
                },
            }),
        ]);

        const moraPromediaDias = moraRaw;

        // ── Resolver labels de parametros usados en distribuciones ────────
        const idsParametros = new Set<number>();
        for (const g of [...grpSituacion, ...grpGestion, ...grpMotivo]) {
            const id = (g as any).estadoSituacionId ?? (g as any).estadoGestionId ?? (g as any).motivoNoPagoId;
            if (id != null) idsParametros.add(id);
        }
        const parametros = idsParametros.size
            ? await this.prisma.parametro.findMany({
                where: { id: { in: Array.from(idsParametros) } },
                select: { id: true, clave: true, descripcion: true, categoria: true },
            })
            : [];
        const paramsMap = new Map(parametros.map(p => [p.id, p]));

        const buildDist = (
            arr: Array<{ _count: { _all: number };[k: string]: any }>,
            idField: string,
        ): DistribucionItem[] => {
            const total = arr.reduce((acc, r) => acc + r._count._all, 0);
            return arr
                .map(r => {
                    const id: number | null = r[idField] ?? null;
                    const p = id != null ? paramsMap.get(id) : null;
                    return {
                        id,
                        clave: p?.clave ?? null,
                        label: p?.descripcion ?? '(Sin asignar)',
                        categoria: p?.categoria ?? null,
                        cantidad: r._count._all,
                        porcentaje: total > 0 ? Math.round((r._count._all / total) * 10000) / 100 : 0,
                    };
                })
                .sort((a, b) => b.cantidad - a.cantidad);
        };

        const porSituacion = buildDist(grpSituacion as any, 'estadoSituacionId');
        const porGestion = buildDist(grpGestion as any, 'estadoGestionId');
        const porMotivo = buildDist(grpMotivo as any, 'motivoNoPagoId');

        // ── Top motivos (top 5 con dato no nulo) ──────────────────────────
        const topMotivos: TopMotivo[] = porMotivo
            .filter(m => m.id != null && m.clave != null)
            .slice(0, 5)
            .map(m => ({
                id: m.id as number,
                clave: m.clave as string,
                label: m.label,
                cantidad: m.cantidad,
                porcentaje: m.porcentaje,
            }));

        const topDeudores: TopDeudor[] = topDeudoresRaw.map(d => ({
            deudorId: d.id,
            nombreCompleto: `${d.apellido ?? ''} ${d.nombre ?? ''}`.trim(),
            documento: d.documento,
            monto: d.montoTotal ?? 0,
            estadoGestion: d.estadoGestion?.descripcion ?? null,
            estadoSituacion: d.estadoSituacion?.descripcion ?? null,
        }));

        // ── Funnel: con pago vía estado terminal + via pagos efectivos ────
        const idsPagaron = new Set(casosConPagoArr.map(p => p.deudorId));
        const conPagoPorEstado = idsConPagoEstado.length
            ? await this.prisma.deudor.findMany({
                where: { ...where, estadoSituacionId: { in: idsConPagoEstado } },
                select: { id: true },
            })
            : [];
        for (const d of conPagoPorEstado) idsPagaron.add(d.id);
        const funnelConPago = idsPagaron.size;

        const pagosPeriodo = pagosAgg._sum.importe ?? 0;
        const deudaTotal = deudaAgg._sum.montoTotal ?? 0;
        const ticketPromedio = pagosAgg._avg.importe ?? 0;

        this.logger.log(`Snapshot generado empresaId=${restrictEmpresaId ?? dto.empresaId ?? 'todos'} casos=${cantidadCasos} en ${Date.now() - t0}ms`);

        return {
            kpis: {
                cantidadCasos,
                deudaTotal,
                pagosPeriodo,
                porcentajeRecupero: deudaTotal > 0 ? Math.round((pagosPeriodo / deudaTotal) * 10000) / 100 : 0,
                casosConPago: casosConPagoArr.length,
                ticketPromedio,
                moraPromediaDias,
                promesasVigentes,
                porcentajeCpc: cantidadCasos > 0 ? Math.round((cpcCount / cantidadCasos) * 10000) / 100 : 0,
                casosSinGestion,
                casosIncobrables,
                casosLegales,
            },
            distribuciones: {
                porSituacion,
                porGestion,
                porMotivo,
                porMora: this.normalizeBuckets(bucketsMoraRaw, cantidadCasos, ['0-30', '31-60', '61-90', '91-180', '180+', 'Sin fecha']),
                porDeuda: this.normalizeBuckets(bucketsDeudaRaw, cantidadCasos, ['$0-10k', '$10k-50k', '$50k-200k', '$200k-1M', '$1M+'], true),
            },
            series: {
                granularidad,
                pagosPorPeriodo: seriePagosRaw,
                gestionesPorPeriodo: serieGestionesRaw,
            },
            top: {
                deudores: topDeudores,
                motivos: topMotivos,
            },
            funnel: {
                asignados: cantidadCasos,
                contactados: funnelContactadosCount,
                conPromesa: funnelConPromesaCount,
                conPago: funnelConPago,
            },
            meta: {
                empresaId: empresaRec?.id ?? null,
                empresaNombre: empresaRec?.nombre ?? null,
                remesaId: remesaRec?.id ?? null,
                remesaNombre: remesaRec?.nombre ?? null,
                desde: desde.toISOString(),
                hasta: hasta.toISOString(),
                generadoEn: new Date().toISOString(),
                totalDeudoresFiltrados: cantidadCasos,
            },
        };
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private resolverGranularidad(diffDias: number): Granularidad {
        if (diffDias <= 60) return 'dia';
        if (diffDias <= 365) return 'semana';
        return 'mes';
    }

    /**
     * Arma el fragmento SQL del WHERE de deudor para usar en $queryRaw.
     * Soporta los filtros más comunes (empresaId, remesaId, situacionIds, gestionIds, motivoIds).
     */
    private buildSqlDeudorWhere(empresaId: number | null, dto: SnapshotDto): Prisma.Sql {
        const parts: Prisma.Sql[] = [Prisma.sql`1 = 1`];
        if (empresaId != null) parts.push(Prisma.sql`d.empresaId = ${empresaId}`);
        if (dto.remesaId) parts.push(Prisma.sql`d.remesaId = ${dto.remesaId}`);
        if (dto.situacionIds?.length) parts.push(Prisma.sql`d.estadoSituacionId IN (${Prisma.join(dto.situacionIds)})`);
        if (dto.gestionIds?.length) parts.push(Prisma.sql`d.estadoGestionId IN (${Prisma.join(dto.gestionIds)})`);
        if (dto.motivoIds?.length) parts.push(Prisma.sql`d.motivoNoPagoId IN (${Prisma.join(dto.motivoIds)})`);
        return Prisma.join(parts, ' AND ');
    }

    private async queryMoraPromedia(deudorWhere: Prisma.Sql, desde: Date, hasta: Date): Promise<number | null> {
        const rows = await this.prisma.$queryRaw<Array<{ avgMora: number | null }>>`
            SELECT AVG(DATEDIFF(NOW(), d.fechaVencimiento)) AS avgMora
            FROM deudor d
            WHERE ${deudorWhere}
              AND d.fechaVencimiento IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM pago p WHERE p.deudorId = d.id AND p.fecha BETWEEN ${desde} AND ${hasta}
              )
        `;
        const v = rows[0]?.avgMora;
        return v != null ? Number(v) : null;
    }

    private async queryBucketsMora(deudorWhere: Prisma.Sql): Promise<Array<{ rango: string; cantidad: number }>> {
        const rows = await this.prisma.$queryRaw<Array<{ rango: string; cantidad: bigint }>>`
            SELECT
              CASE
                WHEN d.fechaVencimiento IS NULL THEN 'Sin fecha'
                WHEN DATEDIFF(NOW(), d.fechaVencimiento) BETWEEN 0 AND 30 THEN '0-30'
                WHEN DATEDIFF(NOW(), d.fechaVencimiento) BETWEEN 31 AND 60 THEN '31-60'
                WHEN DATEDIFF(NOW(), d.fechaVencimiento) BETWEEN 61 AND 90 THEN '61-90'
                WHEN DATEDIFF(NOW(), d.fechaVencimiento) BETWEEN 91 AND 180 THEN '91-180'
                ELSE '180+'
              END AS rango,
              COUNT(*) AS cantidad
            FROM deudor d
            WHERE ${deudorWhere}
            GROUP BY rango
        `;
        return rows.map(r => ({ rango: r.rango, cantidad: Number(r.cantidad) }));
    }

    private async queryBucketsDeuda(deudorWhere: Prisma.Sql): Promise<Array<{ rango: string; cantidad: number; suma: number }>> {
        const rows = await this.prisma.$queryRaw<Array<{ rango: string; cantidad: bigint; suma: number | null }>>`
            SELECT
              CASE
                WHEN d.montoTotal IS NULL OR d.montoTotal < 10000 THEN '$0-10k'
                WHEN d.montoTotal < 50000 THEN '$10k-50k'
                WHEN d.montoTotal < 200000 THEN '$50k-200k'
                WHEN d.montoTotal < 1000000 THEN '$200k-1M'
                ELSE '$1M+'
              END AS rango,
              COUNT(*) AS cantidad,
              SUM(d.montoTotal) AS suma
            FROM deudor d
            WHERE ${deudorWhere}
            GROUP BY rango
        `;
        return rows.map(r => ({ rango: r.rango, cantidad: Number(r.cantidad), suma: r.suma ? Number(r.suma) : 0 }));
    }

    private normalizeBuckets(
        rows: Array<{ rango: string; cantidad: number; suma?: number }>,
        total: number,
        orden: string[],
        incluirSuma = false,
    ): BucketItem[] {
        const map = new Map(rows.map(r => [r.rango, r]));
        return orden.map(rango => {
            const r = map.get(rango);
            const cantidad = r?.cantidad ?? 0;
            const item: BucketItem = {
                rango,
                cantidad,
                porcentaje: total > 0 ? Math.round((cantidad / total) * 10000) / 100 : 0,
            };
            if (incluirSuma) item.suma = r?.suma ?? 0;
            return item;
        });
    }

    private granularidadSql(granularidad: Granularidad, columna: Prisma.Sql): Prisma.Sql {
        if (granularidad === 'dia') return Prisma.sql`DATE_FORMAT(${columna}, '%Y-%m-%d')`;
        if (granularidad === 'mes') return Prisma.sql`DATE_FORMAT(${columna}, '%Y-%m-01')`;
        // semana: lunes como inicio
        return Prisma.sql`DATE_FORMAT(DATE_SUB(${columna}, INTERVAL WEEKDAY(${columna}) DAY), '%Y-%m-%d')`;
    }

    private async querySeriePagos(
        deudorWhere: Prisma.Sql,
        desde: Date,
        hasta: Date,
        granularidad: Granularidad,
    ): Promise<SeriePagoItem[]> {
        const bucketExpr = this.granularidadSql(granularidad, Prisma.sql`p.fecha`);
        const rows = await this.prisma.$queryRaw<Array<{ fecha: string; importe: number | null; cantidad: bigint }>>`
            SELECT
              ${bucketExpr} AS fecha,
              SUM(p.importe) AS importe,
              COUNT(*) AS cantidad
            FROM pago p
            INNER JOIN deudor d ON d.id = p.deudorId
            WHERE p.fecha BETWEEN ${desde} AND ${hasta}
              AND ${deudorWhere}
            GROUP BY fecha
            ORDER BY fecha ASC
        `;
        return rows.map(r => ({
            fecha: r.fecha,
            importe: r.importe ? Number(r.importe) : 0,
            cantidad: Number(r.cantidad),
        }));
    }

    private async querySerieGestiones(
        deudorWhere: Prisma.Sql,
        desde: Date,
        hasta: Date,
        granularidad: Granularidad,
    ): Promise<SerieGestionItem[]> {
        const bucketExpr = this.granularidadSql(granularidad, Prisma.sql`c.fecha`);
        const rows = await this.prisma.$queryRaw<Array<{ fecha: string; cantidad: bigint }>>`
            SELECT
              ${bucketExpr} AS fecha,
              COUNT(*) AS cantidad
            FROM comentario c
            INNER JOIN deudor d ON d.id = c.deudorId
            WHERE c.fecha BETWEEN ${desde} AND ${hasta}
              AND ${deudorWhere}
            GROUP BY fecha
            ORDER BY fecha ASC
        `;
        return rows.map(r => ({ fecha: r.fecha, cantidad: Number(r.cantidad) }));
    }

    // ── Drill-down ───────────────────────────────────────────────────────

    async drillDown(dto: DrillDownDto, restrictEmpresaId: number | null): Promise<DrillDownResponse> {
        const { desde, hasta } = resolverRango(dto.desde, dto.hasta);

        const empresaIdEfectivo = restrictEmpresaId ?? dto.empresaId ?? null;
        const page = Math.max(1, dto.page ?? 1);
        const pageSize = Math.min(100, Math.max(1, dto.pageSize ?? 25));

        const where: Prisma.deudorWhereInput = {};
        if (empresaIdEfectivo != null) where.empresaId = empresaIdEfectivo;
        if (dto.remesaId) where.remesaId = dto.remesaId;
        if (dto.situacionIds?.length) where.estadoSituacionId = { in: dto.situacionIds };
        if (dto.gestionIds?.length) where.estadoGestionId = { in: dto.gestionIds };
        if (dto.motivoIds?.length) where.motivoNoPagoId = { in: dto.motivoIds };

        // Filtros específicos por dimensión
        if (dto.dimension === 'situacion') {
            const v = dto.valor === 'null' ? null : Number(dto.valor);
            where.estadoSituacionId = v as any;
        } else if (dto.dimension === 'gestion') {
            const v = dto.valor === 'null' ? null : Number(dto.valor);
            where.estadoGestionId = v as any;
        } else if (dto.dimension === 'motivo') {
            const v = dto.valor === 'null' ? null : Number(dto.valor);
            where.motivoNoPagoId = v as any;
        }

        // Para mora/deuda usamos raw filtrado en memoria via ids — más simple y suficiente con paginación
        if (dto.dimension === 'mora' || dto.dimension === 'deuda') {
            const sqlWhere = this.buildSqlDeudorWhere(empresaIdEfectivo, dto);
            const idsRows = await this.queryIdsBucket(sqlWhere, dto.dimension, dto.valor);
            const ids = idsRows.map(r => r.id);
            if (ids.length === 0) {
                return { items: [], total: 0, page, pageSize, dimension: dto.dimension, valor: dto.valor };
            }
            where.id = { in: ids };
        }

        const [total, rows] = await Promise.all([
            this.prisma.deudor.count({ where }),
            this.prisma.deudor.findMany({
                where,
                orderBy: { montoTotal: 'desc' },
                skip: (page - 1) * pageSize,
                take: pageSize,
                select: {
                    id: true,
                    nombre: true,
                    apellido: true,
                    documento: true,
                    montoTotal: true,
                    estadoSituacion: { select: { descripcion: true } },
                    estadoGestion: { select: { descripcion: true } },
                    motivoNoPago: { select: { descripcion: true } },
                },
            }),
        ]);

        const items: DrillDownDeudor[] = rows.map(d => ({
            id: d.id,
            nombreCompleto: `${d.apellido ?? ''} ${d.nombre ?? ''}`.trim(),
            documento: d.documento,
            montoTotal: d.montoTotal ?? 0,
            estadoSituacion: d.estadoSituacion?.descripcion ?? null,
            estadoGestion: d.estadoGestion?.descripcion ?? null,
            motivoNoPago: d.motivoNoPago?.descripcion ?? null,
        }));

        return { items, total, page, pageSize, dimension: dto.dimension, valor: dto.valor };
    }

    private async queryIdsBucket(deudorWhere: Prisma.Sql, dimension: 'mora' | 'deuda', valor: string): Promise<Array<{ id: number }>> {
        if (dimension === 'mora') {
            const cond = this.condMora(valor);
            return this.prisma.$queryRaw<Array<{ id: number }>>`
                SELECT d.id FROM deudor d
                WHERE ${deudorWhere} AND ${cond}
            `;
        }
        const cond = this.condDeuda(valor);
        return this.prisma.$queryRaw<Array<{ id: number }>>`
            SELECT d.id FROM deudor d
            WHERE ${deudorWhere} AND ${cond}
        `;
    }

    private condMora(rango: string): Prisma.Sql {
        switch (rango) {
            case 'Sin fecha': return Prisma.sql`d.fechaVencimiento IS NULL`;
            case '0-30': return Prisma.sql`d.fechaVencimiento IS NOT NULL AND DATEDIFF(NOW(), d.fechaVencimiento) BETWEEN 0 AND 30`;
            case '31-60': return Prisma.sql`d.fechaVencimiento IS NOT NULL AND DATEDIFF(NOW(), d.fechaVencimiento) BETWEEN 31 AND 60`;
            case '61-90': return Prisma.sql`d.fechaVencimiento IS NOT NULL AND DATEDIFF(NOW(), d.fechaVencimiento) BETWEEN 61 AND 90`;
            case '91-180': return Prisma.sql`d.fechaVencimiento IS NOT NULL AND DATEDIFF(NOW(), d.fechaVencimiento) BETWEEN 91 AND 180`;
            case '180+': return Prisma.sql`d.fechaVencimiento IS NOT NULL AND DATEDIFF(NOW(), d.fechaVencimiento) > 180`;
            default: throw new BadRequestException(`Rango de mora inválido: ${rango}`);
        }
    }

    private condDeuda(rango: string): Prisma.Sql {
        switch (rango) {
            case '$0-10k': return Prisma.sql`(d.montoTotal IS NULL OR d.montoTotal < 10000)`;
            case '$10k-50k': return Prisma.sql`d.montoTotal >= 10000 AND d.montoTotal < 50000`;
            case '$50k-200k': return Prisma.sql`d.montoTotal >= 50000 AND d.montoTotal < 200000`;
            case '$200k-1M': return Prisma.sql`d.montoTotal >= 200000 AND d.montoTotal < 1000000`;
            case '$1M+': return Prisma.sql`d.montoTotal >= 1000000`;
            default: throw new BadRequestException(`Rango de deuda inválido: ${rango}`);
        }
    }
}
