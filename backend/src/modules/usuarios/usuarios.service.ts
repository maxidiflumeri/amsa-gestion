import {
    BadRequestException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { UpdateUsuarioDto } from './dto/update-usuario.dto';

@Injectable()
export class UsuariosService {
    private readonly logger = new Logger(UsuariosService.name);

    constructor(private readonly prisma: PrismaService) {}

    async findAll() {
        return this.prisma.usuario.findMany({
            select: {
                id: true,
                nombre: true,
                email: true,
                avatarUrl: true,
                activo: true,
                rolId: true,
                rolObj: { select: { id: true, nombre: true } },
                createdAt: true,
            },
            orderBy: { nombre: 'asc' },
        });
    }

    async findOne(id: number) {
        const usuario = await this.prisma.usuario.findUnique({
            where: { id },
            select: {
                id: true,
                nombre: true,
                email: true,
                avatarUrl: true,
                activo: true,
                rolId: true,
                rolObj: { select: { id: true, nombre: true, permisos: true } },
                createdAt: true,
            },
        });
        if (!usuario) throw new NotFoundException(`Usuario ${id} no encontrado`);
        return usuario;
    }

    async create(dto: CreateUsuarioDto) {
        if (dto.email) {
            const existente = await this.prisma.usuario.findUnique({
                where: { email: dto.email },
            });
            if (existente) {
                throw new BadRequestException(`Ya existe un usuario con el email ${dto.email}`);
            }
        }

        this.logger.log(`Creando usuario: ${dto.email}`);
        return this.prisma.usuario.create({
            data: {
                nombre: dto.nombre,
                email: dto.email,
                rolId: dto.rolId ?? null,
                activo: dto.activo ?? true,
                updatedAt: new Date(),
            },
            select: {
                id: true,
                nombre: true,
                email: true,
                activo: true,
                rolId: true,
                rolObj: { select: { id: true, nombre: true } },
                createdAt: true,
            },
        });
    }

    async update(id: number, dto: UpdateUsuarioDto) {
        await this.findOne(id);
        this.logger.log(`Actualizando usuario: ${id}`);
        return this.prisma.usuario.update({
            where: { id },
            data: {
                ...(dto.rolId !== undefined && { rolId: dto.rolId }),
                ...(dto.activo !== undefined && { activo: dto.activo }),
                updatedAt: new Date(),
            },
            select: {
                id: true,
                nombre: true,
                email: true,
                activo: true,
                rolId: true,
                rolObj: { select: { id: true, nombre: true } },
            },
        });
    }

    async remove(id: number) {
        const usuario = await this.findOne(id);
        this.logger.log(`Eliminando usuario: ${id} (${usuario.email})`);
        await this.prisma.usuario.delete({ where: { id } });
        return { mensaje: 'Usuario eliminado correctamente' };
    }
}
