import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateComentarioDto } from './dtos/create-comentario.dto';

@Injectable()
export class ComentariosService {
    constructor(private prisma: PrismaService) { }

    async create(dto: CreateComentarioDto) {
        return this.prisma.comentario.create({
            data: {
                texto: dto.texto,
                origen: dto.origen ?? 'manual',
                usuarioId: dto.usuarioId ?? null,
                deudorId: dto.deudorId,
            },
            include: { usuario: true },
        });
    }

    async remove(id: number) {
        const comentario = await this.prisma.comentario.findUnique({ where: { id } });
        if (!comentario) throw new NotFoundException('Comentario no encontrado');

        await this.prisma.comentario.delete({ where: { id } });
        return comentario;
    }

    async findByDeudor(deudorId: number) {
        return this.prisma.comentario.findMany({
            where: { deudorId },
            include: { usuario: true },
            orderBy: { fecha: 'desc' },
        });
    }
}