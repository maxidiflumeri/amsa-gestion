import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateConvenioDto } from './dtos/create-convenio.dto';

@Injectable()
export class ConveniosService {
  private readonly logger = new Logger(ConveniosService.name);

  constructor(private prisma: PrismaService) {}

  async findByDeudor(deudorId: number) {
    this.logger.log(`Listando convenios del deudor ${deudorId}`);

    return this.prisma.convenio.findMany({
      where: { deudorId },
      include: {
        usuario: true,
        cuotas: {
          orderBy: { nroCuota: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(dto: CreateConvenioDto) {
    this.logger.log(`Creando convenio tipo ${dto.tipo} para deudor ${dto.deudorId}`);

    const deudor = await this.prisma.deudor.findUnique({
      where: { id: dto.deudorId },
    });

    if (!deudor) {
      throw new NotFoundException(`Deudor ${dto.deudorId} no encontrado`);
    }

    if (dto.tipo === 'AUTOMATICO') {
      return this.createAutomatico(dto);
    } else if (dto.tipo === 'LIBRE') {
      return this.createLibre(dto);
    } else {
      throw new BadRequestException('Tipo de convenio inválido. Debe ser AUTOMATICO o LIBRE');
    }
  }

  private async createAutomatico(dto: CreateConvenioDto) {
    const montoCuota = dto.montoTotal / dto.cantCuotas;
    const fechaInicio = new Date(dto.fechaInicio);

    const cuotas: { nroCuota: number; fechaVencimiento: Date; importe: number; estado: string }[] = [];
    for (let i = 1; i <= dto.cantCuotas; i++) {
      const fechaVencimiento = new Date(fechaInicio);
      fechaVencimiento.setDate(fechaVencimiento.getDate() + 30 * (i - 1));

      cuotas.push({
        nroCuota: i,
        fechaVencimiento,
        importe: montoCuota,
        estado: 'PENDIENTE',
      });
    }

    const convenio = await this.prisma.convenio.create({
      data: {
        deudorId: dto.deudorId,
        usuarioId: dto.usuarioId,
        tipo: dto.tipo,
        estado: 'ACTIVO',
        montoTotal: dto.montoTotal,
        cantCuotas: dto.cantCuotas,
        montoCuota,
        fechaInicio: new Date(dto.fechaInicio),
        observaciones: dto.observaciones,
        cuotas: {
          create: cuotas,
        },
      },
      include: {
        usuario: true,
        cuotas: {
          orderBy: { nroCuota: 'asc' },
        },
      },
    });

    this.logger.log(`Convenio automático creado con ID ${convenio.id}, ${dto.cantCuotas} cuotas generadas`);
    return convenio;
  }

  private async createLibre(dto: CreateConvenioDto) {
    if (!dto.cuotas || dto.cuotas.length === 0) {
      throw new BadRequestException('Para convenio LIBRE debe proporcionar las cuotas manualmente');
    }

    if (dto.cuotas.length !== dto.cantCuotas) {
      throw new BadRequestException(
        `La cantidad de cuotas proporcionadas (${dto.cuotas.length}) no coincide con cantCuotas (${dto.cantCuotas})`
      );
    }

    const sumaImportes = dto.cuotas.reduce((sum, c) => sum + c.importe, 0);
    const montoCuotaPromedio = sumaImportes / dto.cuotas.length;

    const convenio = await this.prisma.convenio.create({
      data: {
        deudorId: dto.deudorId,
        usuarioId: dto.usuarioId,
        tipo: dto.tipo,
        estado: 'ACTIVO',
        montoTotal: dto.montoTotal,
        cantCuotas: dto.cantCuotas,
        montoCuota: montoCuotaPromedio,
        fechaInicio: new Date(dto.fechaInicio),
        observaciones: dto.observaciones,
        cuotas: {
          create: dto.cuotas.map(c => ({
            nroCuota: c.nroCuota,
            fechaVencimiento: new Date(c.fechaVencimiento),
            importe: c.importe,
            estado: 'PENDIENTE',
          })),
        },
      },
      include: {
        usuario: true,
        cuotas: {
          orderBy: { nroCuota: 'asc' },
        },
      },
    });

    this.logger.log(`Convenio libre creado con ID ${convenio.id}, ${dto.cuotas.length} cuotas cargadas`);
    return convenio;
  }

  async marcarCuotaPagada(cuotaId: number, pagoData: { fecha: string; importe: number; observacion?: string }) {
    this.logger.log(`Marcando cuota ${cuotaId} como pagada con pago asociado`);

    const cuota = await this.prisma.cuota_convenio.findUnique({
      where: { id: cuotaId },
      include: { convenio: true },
    });

    if (!cuota) {
      throw new NotFoundException(`Cuota ${cuotaId} no encontrada`);
    }
    if (cuota.estado === 'PAGADA') {
      throw new BadRequestException('La cuota ya está marcada como pagada');
    }

    const fechaPago = new Date(pagoData.fecha);

    const [cuotaActualizada] = await this.prisma.$transaction([
      this.prisma.cuota_convenio.update({
        where: { id: cuotaId },
        data: { estado: 'PAGADA', fechaPago },
      }),
      this.prisma.pago.create({
        data: {
          deudorId: cuota.convenio.deudorId,
          fecha: fechaPago,
          importe: pagoData.importe,
          origenArchivo: `CONVENIO_${cuota.convenio.id}`,
          observacion: pagoData.observacion ?? `Cuota ${cuota.nroCuota} convenio #${cuota.convenio.id}`,
        },
      }),
    ]);

    this.logger.log(`Cuota ${cuotaId} pagada y pago generado para deudor ${cuota.convenio.deudorId}`);
    return cuotaActualizada;
  }

  async anularConvenio(convenioId: number) {
    this.logger.log(`Anulando convenio ${convenioId}`);

    const convenio = await this.prisma.convenio.findUnique({
      where: { id: convenioId },
    });

    if (!convenio) {
      throw new NotFoundException(`Convenio ${convenioId} no encontrado`);
    }

    if (convenio.estado !== 'ACTIVO') {
      throw new BadRequestException(`El convenio ya está en estado ${convenio.estado}`);
    }

    const updated = await this.prisma.convenio.update({
      where: { id: convenioId },
      data: { estado: 'ANULADO' },
      include: {
        usuario: true,
        cuotas: {
          orderBy: { nroCuota: 'asc' },
        },
      },
    });

    this.logger.log(`Convenio ${convenioId} anulado`);
    return updated;
  }

  async updateEstadosCuotas() {
    this.logger.log('Actualizando estados de cuotas vencidas');

    const now = new Date();
    const result = await this.prisma.cuota_convenio.updateMany({
      where: {
        estado: 'PENDIENTE',
        fechaVencimiento: {
          lt: now,
        },
      },
      data: {
        estado: 'VENCIDA',
      },
    });

    this.logger.log(`${result.count} cuotas marcadas como vencidas`);
    return result;
  }
}
