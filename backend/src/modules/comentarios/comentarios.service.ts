import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateComentarioDto } from './dtos/create-comentario.dto';
import { DeudorBloqueoService } from '../deudores/utils/deudor-bloqueo';

@Injectable()
export class ComentariosService {
    private readonly logger = new Logger(ComentariosService.name);

    constructor(
        private prisma: PrismaService,
        private bloqueo: DeudorBloqueoService,
    ) { }

    async create(dto: CreateComentarioDto) {
        await this.bloqueo.assertNoBloqueado(dto.deudorId, 'crear comentario');
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

        await this.bloqueo.assertNoBloqueado(comentario.deudorId, 'eliminar comentario');

        await this.prisma.comentario.delete({ where: { id } });
        return comentario;
    }

    async removePropio(id: number, usuarioId: number | undefined) {
        const comentario = await this.prisma.comentario.findUnique({ where: { id } });
        if (!comentario) throw new NotFoundException('Comentario no encontrado');

        // Un comentario **sin autor** no es de nadie, así que tampoco es "propio": lo escribió una
        // acción masiva o una importación. Antes la condición lo dejaba pasar, y con el permiso de
        // "eliminar comentarios propios" cualquiera podía borrar el rastro de lo que hizo un proceso.
        if (comentario.usuarioId === null) {
            this.logger.warn(`Usuario ${usuarioId} intentó eliminar el comentario ${id}, que no tiene autor`);
            throw new ForbiddenException(
                'Ese comentario lo dejó un proceso del sistema, no una persona: no se puede eliminar.',
            );
        }

        if (comentario.usuarioId !== usuarioId) {
            this.logger.warn(`Usuario ${usuarioId} intentó eliminar comentario ${id} de usuario ${comentario.usuarioId}`);
            throw new ForbiddenException('Solo podés eliminar tus propios comentarios.');
        }

        await this.bloqueo.assertNoBloqueado(comentario.deudorId, 'eliminar comentario propio');

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