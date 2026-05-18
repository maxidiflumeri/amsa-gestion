import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class ParametrosService {
    private readonly logger = new Logger(ParametrosService.name);

    constructor(private prisma: PrismaService) {}

    findAll(filters: { grupo?: string; empresaId?: number; activo?: boolean } = {}) {
        const where: any = {};
        if (filters.grupo) where.grupo = filters.grupo;
        if (filters.activo !== undefined) where.activo = filters.activo;
        if (filters.empresaId) {
            where.empresas = { some: { empresaId: filters.empresaId, activo: true } };
        }
        return this.prisma.parametro.findMany({
            where,
            include: { parametroPadre: true, empresas: true, subParametros: true },
            orderBy: [{ grupo: 'asc' }, { clave: 'asc' }],
        });
    }

    async getGrupos() {
        const grupos = await this.prisma.parametro.groupBy({
            by: ['grupo'],
            _count: { id: true },
            orderBy: { grupo: 'asc' },
        });
        return grupos.map(g => ({ grupo: g.grupo, total: g._count.id }));
    }

    findByGrupo(grupo: string) {
        return this.findAll({ grupo, activo: true });
    }

    async findOne(id: number) {
        const p = await this.prisma.parametro.findUnique({
            where: { id },
            include: { subParametros: true, empresas: true },
        });
        if (!p) throw new NotFoundException('Parámetro no encontrado');
        return p;
    }

    create(data: { grupo: string; clave: string; descripcion: string; padreId?: number; categoria?: string; esGlobal?: boolean; activo?: boolean }) {
        this.logger.log(`Creando parámetro grupo=${data.grupo} clave=${data.clave}`);
        return this.prisma.parametro.create({ data });
    }

    async update(id: number, data: { grupo?: string; clave?: string; descripcion?: string; padreId?: number; categoria?: string; esGlobal?: boolean; activo?: boolean }) {
        this.logger.log(`Actualizando parámetro id=${id}`);
        await this.findOne(id);
        return this.prisma.parametro.update({ where: { id }, data });
    }

    async toggleActivo(id: number) {
        const p = await this.findOne(id);
        this.logger.log(`Toggle activo parámetro id=${id} activo=${p.activo} → ${!p.activo}`);
        return this.prisma.parametro.update({
            where: { id },
            data: { activo: !p.activo },
        });
    }

    async remove(id: number) {
        this.logger.log(`Eliminando parámetro id=${id}`);
        await this.findOne(id);
        return this.prisma.parametro.delete({ where: { id } });
    }

    async assignToCompanies(parametroId: number, empresaIds: number[]) {
        await this.prisma.empresa_parametro.deleteMany({ where: { parametroId } });
        if (empresaIds.length > 0) {
            return this.prisma.empresa_parametro.createMany({
                data: empresaIds.map(empresaId => ({ parametroId, empresaId })),
            });
        }
    }

    async setEmpresasForParametro(parametroId: number, empresaIds: number[]) {
        return this.assignToCompanies(parametroId, empresaIds);
    }
}