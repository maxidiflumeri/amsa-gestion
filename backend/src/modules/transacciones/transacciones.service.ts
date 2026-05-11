import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { RegistrarTransaccionDto } from './dtos/registrar-transaccion.dto';
import { QueryTransaccionesDto } from './dtos/query-transacciones.dto';
import { LoggerService } from 'src/common/logger/logger.service';
import { XlsxExportador } from '../reportes/exportadores/xlsx.exportador';
import { CsvExportador } from '../reportes/exportadores/csv.exportador';
import { PdfExportador } from '../reportes/exportadores/pdf.exportador';

export type FormatoExport = 'xlsx' | 'csv' | 'pdf';

@Injectable()
export class TransaccionesService {
    constructor(
        private prisma: PrismaService,
        private logger: LoggerService,
        private xlsx: XlsxExportador,
        private csv: CsvExportador,
        private pdf: PdfExportador,
    ) { }

    async registrar(dto: RegistrarTransaccionDto) {
        const tx = await this.prisma.transaccion.create({
            data: {
                usuarioId: dto.usuarioId ?? null,
                empresaId: dto.empresaId ?? null,
                modulo: dto.modulo ?? 'SISTEMA',
                deudorId: dto.deudorId ?? null,
                entidad: dto.entidad,
                entidadId: dto.entidadId ?? null,
                tipo: dto.tipo,
                severidad: dto.severidad ?? 'INFO',
                estado: dto.estado ?? 'OK',
                recursoTexto: dto.recursoTexto ?? null,
                resumen: dto.resumen ?? null,
                data: dto.data ?? undefined,
                ip: dto.ip ?? null,
                userAgent: dto.userAgent ?? null,
            },
        });

        this.logger.debug(
            `Auditoría [${dto.modulo}/${dto.entidad}:${dto.tipo}] estado=${dto.estado ?? 'OK'} usuario=${dto.usuarioId ?? 'SYS'}`,
            'TransaccionesService',
        );

        return tx;
    }

    private buildWhere(q: QueryTransaccionesDto, restrictUsuarioId?: number | null, restrictEmpresaId?: number | null): Prisma.transaccionWhereInput {
        const where: Prisma.transaccionWhereInput = {};
        if (q.deudorId) where.deudorId = q.deudorId;
        if (q.usuarioId) where.usuarioId = q.usuarioId;
        if (q.empresaId) where.empresaId = q.empresaId;
        if (q.entidad) where.entidad = q.entidad;
        if (q.entidadId) where.entidadId = q.entidadId;
        if (q.tipo) where.tipo = q.tipo;
        if (q.modulo) where.modulo = q.modulo;
        if (q.severidad) where.severidad = q.severidad;
        if (q.estado) where.estado = q.estado;
        if (q.desde || q.hasta) {
            where.createdAt = {};
            if (q.desde) (where.createdAt as any).gte = new Date(q.desde);
            if (q.hasta) (where.createdAt as any).lte = new Date(q.hasta);
        }
        if (q.q) {
            where.OR = [
                { resumen: { contains: q.q } },
                { recursoTexto: { contains: q.q } },
                { entidad: { contains: q.q } },
                { tipo: { contains: q.q } },
            ];
        }
        if (restrictUsuarioId != null) where.usuarioId = restrictUsuarioId;
        if (restrictEmpresaId != null) where.empresaId = restrictEmpresaId;
        return where;
    }

    async findAll(q: QueryTransaccionesDto, restrictUsuarioId?: number | null, restrictEmpresaId?: number | null) {
        const where = this.buildWhere(q, restrictUsuarioId, restrictEmpresaId);
        const take = q.limit && q.limit > 0 ? Math.min(q.limit, 500) : 50;
        const skip = q.offset && q.offset > 0 ? q.offset : 0;
        const orderDir = q.orderDir ?? 'desc';

        const [items, total] = await this.prisma.$transaction([
            this.prisma.transaccion.findMany({
                where,
                include: {
                    usuario: { select: { id: true, nombre: true, email: true, avatarUrl: true } },
                    empresa: { select: { id: true, nombre: true } },
                    deudor: { select: { id: true, documento: true, nombre: true, apellido: true } },
                },
                orderBy: { createdAt: orderDir },
                take,
                skip,
            }),
            this.prisma.transaccion.count({ where }),
        ]);

        return { total, items };
    }

    async findOne(id: number) {
        return this.prisma.transaccion.findUnique({
            where: { id },
            include: {
                usuario: { select: { id: true, nombre: true, email: true, avatarUrl: true } },
                empresa: { select: { id: true, nombre: true } },
                deudor: { select: { id: true, documento: true, nombre: true, apellido: true } },
            },
        });
    }

    async stats(q: QueryTransaccionesDto, restrictUsuarioId?: number | null, restrictEmpresaId?: number | null) {
        const where = this.buildWhere(q, restrictUsuarioId, restrictEmpresaId);
        const ahora = new Date();
        const hoy = new Date(ahora); hoy.setHours(0, 0, 0, 0);
        const semana = new Date(ahora); semana.setDate(semana.getDate() - 7);
        const mes = new Date(ahora); mes.setDate(mes.getDate() - 30);
        const hace24h = new Date(ahora.getTime() - 24 * 60 * 60 * 1000);

        const [totalHoy, totalSemana, totalMes, porModulo, porTipo, porUsuarioRaw, fallidos24h, serieRaw] =
            await Promise.all([
                this.prisma.transaccion.count({ where: { ...where, createdAt: { gte: hoy } } }),
                this.prisma.transaccion.count({ where: { ...where, createdAt: { gte: semana } } }),
                this.prisma.transaccion.count({ where: { ...where, createdAt: { gte: mes } } }),
                this.prisma.transaccion.groupBy({ by: ['modulo'], where, _count: { _all: true } }),
                this.prisma.transaccion.groupBy({ by: ['tipo'], where, _count: { _all: true }, orderBy: { _count: { tipo: 'desc' } }, take: 15 }),
                this.prisma.transaccion.groupBy({ by: ['usuarioId'], where, _count: { _all: true }, orderBy: { _count: { usuarioId: 'desc' } }, take: 10 }),
                this.prisma.transaccion.count({ where: { ...where, estado: 'FALLIDO', createdAt: { gte: hace24h } } }),
                this.prisma.$queryRaw<{ fecha: Date; count: bigint }[]>`
                    SELECT DATE(createdAt) as fecha, COUNT(*) as count
                    FROM transaccion
                    WHERE createdAt >= ${mes}
                    GROUP BY DATE(createdAt)
                    ORDER BY fecha ASC
                `,
            ]);

        const userIds = porUsuarioRaw.map((u) => u.usuarioId).filter((u): u is number => u != null);
        const usuarios = userIds.length
            ? await this.prisma.usuario.findMany({
                where: { id: { in: userIds } },
                select: { id: true, nombre: true, email: true },
            })
            : [];
        const usuariosMap = new Map(usuarios.map((u) => [u.id, u]));

        return {
            totales: { hoy: totalHoy, semana: totalSemana, mes: totalMes },
            porModulo: porModulo.map((p) => ({ modulo: p.modulo, count: p._count._all })),
            porTipo: porTipo.map((p) => ({ tipo: p.tipo, count: p._count._all })),
            porUsuario: porUsuarioRaw.map((p) => ({
                usuarioId: p.usuarioId,
                nombre: p.usuarioId != null ? usuariosMap.get(p.usuarioId)?.nombre ?? null : 'Sistema',
                count: p._count._all,
            })),
            fallidos: { ultimas24h: fallidos24h },
            seriePorDia: serieRaw.map((r) => ({ fecha: r.fecha, count: Number(r.count) })),
        };
    }

    async exportar(
        q: QueryTransaccionesDto,
        formato: FormatoExport,
        restrictUsuarioId?: number | null,
        restrictEmpresaId?: number | null,
    ): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
        const where = this.buildWhere(q, restrictUsuarioId, restrictEmpresaId);
        const orderDir = q.orderDir ?? 'desc';

        const items = await this.prisma.transaccion.findMany({
            where,
            include: {
                usuario: { select: { id: true, nombre: true, email: true } },
                empresa: { select: { id: true, nombre: true } },
                deudor: { select: { id: true, documento: true, nombre: true, apellido: true } },
            },
            orderBy: { createdAt: orderDir },
            take: 10000,
        });

        const columnas = [
            'Fecha',
            'Usuario',
            'Email',
            'Empresa',
            'Módulo',
            'Entidad',
            'Tipo',
            'Severidad',
            'Estado',
            'Deudor',
            'Resumen',
            'Recurso',
            'IP',
        ];

        const filas = items.map((it) => ({
            Fecha: new Date(it.createdAt).toISOString(),
            Usuario: it.usuario?.nombre ?? 'Sistema',
            Email: it.usuario?.email ?? '',
            Empresa: it.empresa?.nombre ?? '',
            Módulo: it.modulo,
            Entidad: it.entidad,
            Tipo: it.tipo,
            Severidad: it.severidad,
            Estado: it.estado,
            Deudor: it.deudor ? `${it.deudor.nombre ?? ''} ${it.deudor.apellido ?? ''} (${it.deudor.documento ?? ''})`.trim() : '',
            Resumen: it.resumen ?? '',
            Recurso: it.recursoTexto ?? '',
            IP: it.ip ?? '',
        }));

        const stamp = new Date().toISOString().slice(0, 10);

        if (formato === 'xlsx') {
            const buffer = await this.xlsx.generar(filas, columnas, { autoWidth: true, freezeRow: true });
            return {
                buffer,
                mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                filename: `auditoria_${stamp}.xlsx`,
            };
        }

        if (formato === 'csv') {
            const buffer = this.csv.generar(filas, columnas, { separador: ',', bom: true });
            return { buffer, mimeType: 'text/csv', filename: `auditoria_${stamp}.csv` };
        }

        const buffer = await this.pdf.generar(filas, columnas, { landscape: true, pageSize: 'A4' });
        return { buffer, mimeType: 'application/pdf', filename: `auditoria_${stamp}.pdf` };
    }
}
