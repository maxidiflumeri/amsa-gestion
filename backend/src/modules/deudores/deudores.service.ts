import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { deudor, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateDeudorDto } from './dtos/create-deudor.dto';
import { UpdateDeudorDto } from './dtos/update-deudor.dto';
import { AdvancedSearchDto } from './dtos/advanced-search.dto';

@Injectable()
export class DeudoresService {
    private readonly logger = new Logger(DeudoresService.name);

    constructor(private prisma: PrismaService) { }

    async findAll(page?: number, limit?: number, search?: string) {
        let where: Prisma.deudorWhereInput = {};

        if (search) {
            where = {
                OR: [
                    { nombre: { contains: search } },
                    { apellido: { contains: search } },
                    { documento: { contains: search } },
                ],
            };

            const searchAsId = Number(search);
            if (!isNaN(searchAsId) && searchAsId > 0) {
                // Si el término de búsqueda puede ser un ID válido numérico, lo agregamos al OR.
                (where.OR as any[]).push({ id: searchAsId });
            }
        }

        if (page && limit) {
            const skip = (page - 1) * limit;
            const take = limit;

            const [data, total] = await Promise.all([
                this.prisma.deudor.findMany({
                    skip,
                    take,
                    where,
                    include: { empresa: true, remesa: true },
                }),
                this.prisma.deudor.count({ where }),
            ]);

            return {
                data,
                meta: {
                    total,
                    page,
                    limit,
                    totalPages: Math.ceil(total / limit),
                },
            };
        } else {
            const data = await this.prisma.deudor.findMany({
                where,
                include: { empresa: true, remesa: true },
            });
            return {
                data,
                meta: {
                    total: data.length,
                    page: 1,
                    limit: data.length,
                    totalPages: 1,
                },
            };
        }
    }

    async searchAdvanced(dto: AdvancedSearchDto) {
        const andConditions: Prisma.deudorWhereInput[] = [];

        if (dto.id) {
            andConditions.push({ id: dto.id });
        }
        if (dto.nombre) {
            andConditions.push({ nombre: { contains: dto.nombre } });
        }
        if (dto.apellido) {
            andConditions.push({ apellido: { contains: dto.apellido } });
        }
        if (dto.documento) {
            andConditions.push({ documento: { contains: dto.documento } });
        }
        if (dto.empresa) {
            andConditions.push({ empresa: { nombre: { contains: dto.empresa } } });
        }
        if (dto.nroCliente) {
            // Columna principal nroCliente + fallback a datos viejos (campoExtras / camposAdicionales)
            andConditions.push({
                OR: [
                    { nroCliente: { contains: dto.nroCliente } },
                    { campoExtras: { some: { valor: { contains: dto.nroCliente } } } },
                    { camposAdicionales: { string_contains: dto.nroCliente } }
                ]
            });
        }
        if (dto.nroRemesa) {
            andConditions.push({ remesa: { numeroRemesa: { contains: dto.nroRemesa } } });
        }
        if (dto.email) {
            andConditions.push({ contactos: { some: { tipo: 'email', valor: { contains: dto.email } } } });
        }
        if (dto.telefono) {
            andConditions.push({ contactos: { some: { tipo: 'telefono', valor: { contains: dto.telefono } } } });
        }

        // Si no mandaron filtros, podemos devolver vacío o todo con limit, pero elegimos los primeros 50
        const where: Prisma.deudorWhereInput = andConditions.length > 0 ? { AND: andConditions } : {};

        return this.prisma.deudor.findMany({
            where,
            take: 50,
            include: { empresa: true, remesa: true, contactos: true },
        });
    }

    async getEmpresas() {
        return this.prisma.empresa.findMany({
            select: {
                id: true,
                nombre: true,
            },
            orderBy: { nombre: 'asc' },
        });
    }

    async findOne(id: number): Promise<deudor | null> {
        return this.prisma.deudor.findUnique({
            where: { id },
            include: {
                empresa: true,
                remesa: { include: { politica: true } },
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
                motivoNoPago: true,
            },
        });
    }

    async findByDocumento(documento: string, excludeId?: number) {
        return this.prisma.deudor.findMany({
            where: {
                documento,
                ...(excludeId ? { id: { not: excludeId } } : {}),
            },
            include: {
                empresa: true,
                remesa: true,
                estadoSituacion: true,
                estadoGestion: true,
                motivoNoPago: true,
            },
            orderBy: { createdAt: 'desc' },
        });
    }

    async create(dto: CreateDeudorDto): Promise<deudor> {
        this.logger.log(`Creando deudor documento=${dto.documento} empresaId=${dto.empresaId}`);
        const {
            empresaId,
            remesaId,
            estadoSituacionId,
            estadoGestionId,
            ...rest
        } = dto;

        const d = await this.prisma.deudor.create({
            data: {
                ...rest,
                empresa: { connect: { id: empresaId } },
                remesa: { connect: { id: remesaId } },
                ...(estadoSituacionId && { estadoSituacion: { connect: { id: estadoSituacionId } } }),
                ...(estadoGestionId && { estadoGestion: { connect: { id: estadoGestionId } } }),
            },
        });
        this.logger.log(`Deudor creado id=${d.id} empresaId=${empresaId}`);
        return d;
    }


    async update(id: number, dto: UpdateDeudorDto) {
        this.logger.log(`Actualizando deudor id=${id}`);
        const { estadoSituacionClave, estadoGestionClave, motivoNoPagoClave } = dto;

        let data: any = {};

        if (estadoSituacionClave) {
            const estado = await this.prisma.parametro.findUnique({
                where: { clave: estadoSituacionClave },
            });
            if (!estado) throw new NotFoundException('Estado de situación no encontrado');
            data.estadoSituacionId = estado.id;
        }

        if (estadoGestionClave) {
            const gestion = await this.prisma.parametro.findUnique({
                where: { clave: estadoGestionClave },
            });
            if (!gestion) throw new NotFoundException('Estado de gestión no encontrado');
            data.estadoGestionId = gestion.id;
        }

        if (motivoNoPagoClave) {
            const motivo = await this.prisma.parametro.findUnique({
                where: { clave: motivoNoPagoClave },
            });
            if (motivo) data.motivoNoPagoId = motivo.id;
        }

        const deudor = await this.prisma.deudor.findUnique({ where: { id } });
        if (!deudor) throw new NotFoundException('Deudor no encontrado');

        const updated = await this.prisma.deudor.update({
            where: { id },
            data: {
                estadoSituacionId: data.estadoSituacionId ?? deudor.estadoSituacionId,
                estadoGestionId: data.estadoGestionId ?? deudor.estadoGestionId,
                motivoNoPagoId: data.motivoNoPagoId ?? deudor.motivoNoPagoId,
            },
            include: {
                estadoSituacion: true,
                estadoGestion: true,
                motivoNoPago: true,
            },
        });

        return { before: deudor, after: updated };
    }

    async delete(id: number): Promise<deudor> {
        this.logger.log(`Eliminando deudor id=${id}`);
        return this.prisma.deudor.delete({
            where: { id },
        });
    }
}