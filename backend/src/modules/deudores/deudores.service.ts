import { Injectable } from '@nestjs/common';
import { Deudor, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateDeudorDto } from './dtos/create-deudor.dto';

@Injectable()
export class DeudoresService {
    constructor(private prisma: PrismaService) { }

    async findAll(): Promise<Deudor[]> {
        return this.prisma.deudor.findMany({
            include: { empresa: true, remesa: true },
        });
    }

    async findOne(id: number): Promise<Deudor | null> {
        return this.prisma.deudor.findUnique({
            where: { id },
            include: {
                empresa: true,
                remesa: true,
                comentarios: {
                    include: {
                        usuario: true, // 👈 Incluye la relación con Usuario
                    },
                },
                contactos: true,
                facturas: true,
                pagos: true,
                campoExtras: true,
                estadoSituacion: true,
                estadoGestion: true,
            },
        });
    }

    async create(dto: CreateDeudorDto): Promise<Deudor> {
        const {
            empresaId,
            remesaId,
            estadoSituacionId,
            estadoGestionId,
            ...rest
        } = dto;

        return this.prisma.deudor.create({
            data: {
                ...rest,
                empresa: { connect: { id: empresaId } },
                remesa: { connect: { id: remesaId } },
                ...(estadoSituacionId && { estadoSituacion: { connect: { id: estadoSituacionId } } }),
                ...(estadoGestionId && { estadoGestion: { connect: { id: estadoGestionId } } }),
            },
        });
    }

    async update(id: number, data: Prisma.DeudorUpdateInput): Promise<Deudor> {
        return this.prisma.deudor.update({
            where: { id },
            data,
        });
    }

    async delete(id: number): Promise<Deudor> {
        return this.prisma.deudor.delete({
            where: { id },
        });
    }
}