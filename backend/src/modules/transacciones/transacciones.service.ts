// src/transacciones/transacciones.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { RegistrarTransaccionDto } from './dtos/registrar-transaccion.dto';
import { QueryTransaccionesDto } from './dtos/query-transacciones.dto';
import { LoggerService } from 'src/common/logger/logger.service';

@Injectable()
export class TransaccionesService {
    constructor(private prisma: PrismaService, private logger: LoggerService) { }

    async registrar(dto: RegistrarTransaccionDto) {
        const tx = this.prisma.transaccion.create({
            data: {
                usuarioId: dto.usuarioId,
                deudorId: dto.deudorId ?? null,
                entidad: dto.entidad,
                entidadId: dto.entidadId ?? null,
                tipo: dto.tipo,
                resumen: dto.resumen ?? null,
                data: dto.data ?? undefined,
                ip: dto.ip ?? null,
                userAgent: dto.userAgent ?? null,
            },
        });

        this.logger.debug(
            `Transacción registrada [${dto.entidad}:${dto.tipo}] deudor=${dto.deudorId} usuario=${dto.usuarioId}`,
            'TransaccionesService',
        );

        return tx;
    }

    async findAll(q: QueryTransaccionesDto) {
        const where: any = {};
        if (q.deudorId) where.deudorId = q.deudorId;
        if (q.usuarioId) where.usuarioId = q.usuarioId;
        if (q.entidad) where.entidad = q.entidad;
        if (q.entidadId) where.entidadId = q.entidadId;
        if (q.tipo) where.tipo = q.tipo;

        const take = q.limit && q.limit > 0 ? Math.min(q.limit, 200) : 50;
        const skip = q.offset && q.offset > 0 ? q.offset : 0;

        const [items, total] = await this.prisma.$transaction([
            this.prisma.transaccion.findMany({
                where,
                include: { usuario: true },
                orderBy: { createdAt: 'desc' },
                take,
                skip,
            }),
            this.prisma.transaccion.count({ where }),
        ]);

        return { total, items };
    }
}