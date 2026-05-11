import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TODOS_LOS_PERMISOS, TODAS_LAS_KEYS } from '../../auth/permisos-catalogo';
import { CreateRolDto } from './dto/create-rol.dto';
import { UpdateRolDto } from './dto/update-rol.dto';

@Injectable()
export class RolesService {
    private readonly logger = new Logger(RolesService.name);

    constructor(private readonly prisma: PrismaService) {}

    async findAll() {
        return this.prisma.rol.findMany({
            include: { _count: { select: { usuarios: true } } },
            orderBy: { creadoAt: 'asc' },
        });
    }

    async findOne(id: number) {
        const rol = await this.prisma.rol.findUnique({
            where: { id },
            include: { _count: { select: { usuarios: true } } },
        });
        if (!rol) throw new NotFoundException(`Rol ${id} no encontrado`);
        return rol;
    }

    private validarPermisos(permisos: string[]): void {
        const invalidas = permisos.filter((p) => !TODAS_LAS_KEYS.includes(p));
        if (invalidas.length > 0) {
            throw new BadRequestException(
                `Las siguientes claves de permiso no son válidas: ${invalidas.join(', ')}`,
            );
        }
    }

    async create(dto: CreateRolDto) {
        this.validarPermisos(dto.permisos);
        this.logger.log(`Creando rol: ${dto.nombre}`);
        return this.prisma.rol.create({
            data: {
                nombre: dto.nombre,
                permisos: dto.permisos,
            },
        });
    }

    async update(id: number, dto: UpdateRolDto) {
        await this.findOne(id);
        if (dto.permisos !== undefined) {
            this.validarPermisos(dto.permisos);
        }
        this.logger.log(`Actualizando rol: ${id}`);
        return this.prisma.rol.update({
            where: { id },
            data: {
                ...(dto.nombre !== undefined && { nombre: dto.nombre }),
                ...(dto.permisos !== undefined && { permisos: dto.permisos }),
            },
        });
    }

    async remove(id: number) {
        const rol = await this.findOne(id);
        const count = (rol as any)._count?.usuarios ?? 0;
        if (count > 0) {
            throw new ConflictException(
                `No se puede eliminar el rol "${rol.nombre}" porque tiene ${count} usuario(s) asignado(s).`,
            );
        }
        this.logger.log(`Eliminando rol: ${id} (${rol.nombre})`);
        await this.prisma.rol.delete({ where: { id } });
        return { mensaje: 'Rol eliminado correctamente' };
    }

    getPermisosCatalogo() {
        return TODOS_LOS_PERMISOS;
    }
}
