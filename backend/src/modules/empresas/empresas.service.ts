import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class EmpresasService {
    constructor(private prisma: PrismaService) { }

    findAll() {
        return this.prisma.empresa.findMany({
            orderBy: { nombre: 'asc' },
        });
    }

    async findOne(id: number) {
        const empresa = await this.prisma.empresa.findUnique({
            where: { id },
        });
        if (!empresa) throw new NotFoundException('Empresa no encontrada');
        return empresa;
    }

    create(data: { nombre: string; cuit?: string; configuracion?: any }) {
        return this.prisma.empresa.create({
            data,
        });
    }

    async update(id: number, data: { nombre?: string; cuit?: string; configuracion?: any }) {
        await this.findOne(id);
        return this.prisma.empresa.update({
            where: { id },
            data,
        });
    }

    async remove(id: number) {
        await this.findOne(id);
        return this.prisma.empresa.delete({
            where: { id },
        });
    }

    // --- ASIGNACIONES DE PARÁMETROS ---
    async assignParametros(empresaId: number, parametroIds: number[]) {
        // Primero eliminamos todas las asignaciones existentes para esta empresa
        await this.prisma.empresa_parametro.deleteMany({
            where: { empresaId },
        });

        // Luego creamos las nuevas
        if (parametroIds.length > 0) {
            return this.prisma.empresa_parametro.createMany({
                data: parametroIds.map(parametroId => ({
                    empresaId,
                    parametroId,
                })),
            });
        }
    }
}
