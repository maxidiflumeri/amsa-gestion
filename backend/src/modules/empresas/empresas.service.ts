import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class EmpresasService {
    private readonly logger = new Logger(EmpresasService.name);

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
        this.logger.log(`Creando empresa nombre=${data.nombre}`);
        return this.prisma.empresa.create({
            data,
        });
    }

    async update(id: number, data: { nombre?: string; cuit?: string; configuracion?: any }) {
        this.logger.log(`Actualizando empresa id=${id}`);
        await this.findOne(id);
        return this.prisma.empresa.update({
            where: { id },
            data,
        });
    }

    async remove(id: number) {
        this.logger.log(`Eliminando empresa id=${id}`);
        await this.findOne(id);
        return this.prisma.empresa.delete({
            where: { id },
        });
    }

    async assignParametros(empresaId: number, parametroIds: number[]) {
        this.logger.log(`Asignando ${parametroIds.length} parámetros a empresa id=${empresaId}`);
        await this.prisma.empresa_parametro.deleteMany({
            where: { empresaId },
        });

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
