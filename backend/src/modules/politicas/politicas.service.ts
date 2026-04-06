import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePoliticaDto } from './dtos/create-politica.dto';
import { UpdatePoliticaDto } from './dtos/update-politica.dto';

@Injectable()
export class PoliticasService {
  private readonly logger = new Logger(PoliticasService.name);

  constructor(private prisma: PrismaService) {}

  async findAll(empresaId?: number) {
    this.logger.log(`Listando políticas${empresaId ? ` de empresa ${empresaId}` : ''}`);

    const where = empresaId ? { empresaId } : {};

    return this.prisma.politica.findMany({
      where,
      include: {
        empresa: true,
      },
      orderBy: { nombre: 'asc' },
    });
  }

  async findOne(id: number) {
    this.logger.log(`Buscando política ${id}`);

    const politica = await this.prisma.politica.findUnique({
      where: { id },
      include: {
        empresa: true,
        remesas: true,
      },
    });

    if (!politica) {
      throw new NotFoundException(`Política ${id} no encontrada`);
    }

    return politica;
  }

  async create(dto: CreatePoliticaDto) {
    this.logger.log(`Creando política: ${dto.nombre}`);

    const politica = await this.prisma.politica.create({
      data: {
        empresaId: dto.empresaId,
        nombre: dto.nombre,
        descripcion: dto.descripcion,
        formasDePago: dto.formasDePago,
        tipoAtencion: dto.tipoAtencion,
        datosExtra: dto.datosExtra,
        activa: dto.activa ?? true,
      },
      include: {
        empresa: true,
      },
    });

    this.logger.log(`Política creada con ID ${politica.id}`);
    return politica;
  }

  async update(id: number, dto: UpdatePoliticaDto) {
    this.logger.log(`Actualizando política ${id}`);

    const existing = await this.prisma.politica.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Política ${id} no encontrada`);
    }

    const politica = await this.prisma.politica.update({
      where: { id },
      data: {
        ...(dto.nombre !== undefined && { nombre: dto.nombre }),
        ...(dto.descripcion !== undefined && { descripcion: dto.descripcion }),
        ...(dto.formasDePago !== undefined && { formasDePago: dto.formasDePago }),
        ...(dto.tipoAtencion !== undefined && { tipoAtencion: dto.tipoAtencion }),
        ...(dto.datosExtra !== undefined && { datosExtra: dto.datosExtra }),
        ...(dto.activa !== undefined && { activa: dto.activa }),
      },
      include: {
        empresa: true,
      },
    });

    this.logger.log(`Política ${id} actualizada`);
    return politica;
  }

  async remove(id: number) {
    this.logger.log(`Desactivando política ${id}`);

    const existing = await this.prisma.politica.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Política ${id} no encontrada`);
    }

    const politica = await this.prisma.politica.update({
      where: { id },
      data: { activa: false },
    });

    this.logger.log(`Política ${id} desactivada`);
    return politica;
  }
}
