import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class ParametrosService {
    constructor(private prisma: PrismaService) { }

    findAll(filters: { grupo?: string; empresaId?: number } = {}) {
        const where: any = {};
        if (filters.grupo) where.grupo = filters.grupo;
        if (filters.empresaId) {
            where.empresas = {
                some: { empresaId: filters.empresaId }
            };
        }

        return this.prisma.parametro.findMany({
            where,
            include: { 
                parametroPadre: true,
                empresas: true,
                subParametros: true
            },
            orderBy: [{ grupo: 'asc' }, { id: 'asc' }],
        });
    }

    findByGrupo(grupo: string) {
        return this.findAll({ grupo });
    }

    async findOne(id: number) {
        const p = await this.prisma.parametro.findUnique({
            where: { id },
            include: { subParametros: true, empresas: true },
        });
        if (!p) throw new NotFoundException('Parámetro no encontrado');
        return p;
    }

    create(data: { grupo: string; clave: string; descripcion: string; padreId?: number }) {
        return this.prisma.parametro.create({
            data,
        });
    }

    async update(id: number, data: { grupo?: string; clave?: string; descripcion?: string; padreId?: number }) {
        await this.findOne(id);
        return this.prisma.parametro.update({
            where: { id },
            data,
        });
    }

    async remove(id: number) {
        await this.findOne(id);
        return this.prisma.parametro.delete({
            where: { id },
        });
    }

    // --- ASIGNACIONES A EMPRESAS ---
    async assignToCompanies(parametroId: number, empresaIds: number[]) {
        // Primero eliminamos todas las asignaciones existentes para este parámetro
        await this.prisma.empresa_parametro.deleteMany({
            where: { parametroId },
        });

        // Luego creamos las nuevas
        if (empresaIds.length > 0) {
            return this.prisma.empresa_parametro.createMany({
                data: empresaIds.map(empresaId => ({
                    parametroId,
                    empresaId,
                })),
            });
        }
    }

    async setEmpresasForParametro(parametroId: number, empresaIds: number[]) {
        return this.assignToCompanies(parametroId, empresaIds);
    }
}