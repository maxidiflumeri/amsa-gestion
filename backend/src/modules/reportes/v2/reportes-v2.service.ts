import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreatePlantillaV2Dto, UpdatePlantillaV2Dto, FormatoSalidaV2 } from './dto/plantilla-v2.dto';
import { EjecutarV2Dto, PreviewV2Dto } from './dto/ejecutar-v2.dto';
import { ExecutorService } from './executor/executor.service';
import { XlsxV2Exportador } from './exportadores/xlsx-v2.exportador';
import { CsvV2Exportador } from './exportadores/csv-v2.exportador';
import { TxtV2Exportador } from './exportadores/txt-v2.exportador';
import { PdfV2Exportador } from './exportadores/pdf-v2.exportador';
import { FilaConSubtotales } from './executor/grouping.service';

@Injectable()
export class ReportesV2Service {
  private readonly logger = new Logger(ReportesV2Service.name);

  constructor(
    private prisma: PrismaService,
    private executor: ExecutorService,
    private xlsxExportador: XlsxV2Exportador,
    private csvExportador: CsvV2Exportador,
    private txtExportador: TxtV2Exportador,
    private pdfExportador: PdfV2Exportador,
  ) {}

  async findAll(empresaId?: number) {
    this.logger.log(`Buscando plantillas v2, empresaId=${empresaId}`);

    return this.prisma.plantilla_reporte_v2.findMany({
      where: empresaId ? { empresaId, activo: true } : { activo: true },
      include: {
        empresa: true,
        creadoPor: {
          select: {
            id: true,
            nombre: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: number) {
    const plantilla = await this.prisma.plantilla_reporte_v2.findUnique({
      where: { id },
      include: {
        empresa: true,
        creadoPor: {
          select: { id: true, nombre: true, email: true },
        },
      },
    });

    if (!plantilla) {
      throw new NotFoundException(`Plantilla v2 ${id} no encontrada`);
    }

    return plantilla;
  }

  async create(dto: CreatePlantillaV2Dto, usuarioId?: number) {
    this.logger.log(`Creando plantilla v2: ${dto.nombre}`);

    return this.prisma.plantilla_reporte_v2.create({
      data: {
        nombre: dto.nombre,
        descripcion: dto.descripcion,
        raiz: dto.raiz,
        empresaId: dto.empresaId,
        definicion: dto.definicion as unknown as Prisma.InputJsonValue,
        formatoSalida: dto.formatoSalida,
        opcionesFormato: (dto.opcionesFormato || Prisma.JsonNull) as unknown as Prisma.InputJsonValue,
        creadoPorId: usuarioId,
      },
      include: {
        empresa: true,
        creadoPor: {
          select: { id: true, nombre: true, email: true },
        },
      },
    });
  }

  async update(id: number, dto: UpdatePlantillaV2Dto) {
    await this.findOne(id);

    this.logger.log(`Actualizando plantilla v2 ${id}`);

    return this.prisma.plantilla_reporte_v2.update({
      where: { id },
      data: {
        nombre: dto.nombre,
        descripcion: dto.descripcion,
        definicion: dto.definicion ? (dto.definicion as unknown as Prisma.InputJsonValue) : undefined,
        formatoSalida: dto.formatoSalida,
        opcionesFormato: dto.opcionesFormato ? (dto.opcionesFormato as unknown as Prisma.InputJsonValue) : undefined,
        activo: dto.activo,
      },
      include: {
        empresa: true,
        creadoPor: {
          select: { id: true, nombre: true, email: true },
        },
      },
    });
  }

  async remove(id: number) {
    await this.findOne(id);

    this.logger.log(`Soft delete plantilla v2 ${id}`);

    return this.prisma.plantilla_reporte_v2.update({
      where: { id },
      data: { activo: false },
    });
  }

  async duplicate(id: number, usuarioId?: number) {
    const original = await this.findOne(id);

    this.logger.log(`Duplicando plantilla v2 ${id}`);

    return this.prisma.plantilla_reporte_v2.create({
      data: {
        nombre: `${original.nombre} (copia)`,
        descripcion: original.descripcion,
        raiz: original.raiz,
        empresaId: original.empresaId,
        definicion: original.definicion as unknown as Prisma.InputJsonValue,
        formatoSalida: original.formatoSalida,
        opcionesFormato: (original.opcionesFormato || Prisma.JsonNull) as unknown as Prisma.InputJsonValue,
        creadoPorId: usuarioId,
      },
    });
  }

  async ejecutar(id: number, dto: EjecutarV2Dto, usuarioId: number): Promise<Buffer> {
    const plantilla = await this.findOne(id);

    this.logger.log(`Ejecutando plantilla v2 ${id} en modo SYNC`);

    const startTime = Date.now();
    let ejecucionId: number | null = null;

    try {
      const ejecucion = await this.prisma.ejecucion_reporte_v2.create({
        data: {
          plantillaId: id,
          usuarioId,
          filtrosUsados: (dto.filtrosVars || {}) as Prisma.InputJsonValue,
          estado: 'EJECUTANDO',
          modo: 'SYNC',
        },
      });

      ejecucionId = ejecucion.id;

      const resultado = await this.executor.execute(
        plantilla.definicion as any,
        plantilla.raiz,
        dto.filtrosVars,
        false,
      );

      const bufferOrPromise = this.exportar(
        resultado.filas,
        resultado.columnas,
        plantilla.formatoSalida,
        plantilla.opcionesFormato as any,
      );

      const buffer = bufferOrPromise instanceof Promise ? await bufferOrPromise : bufferOrPromise;

      const duracion = Date.now() - startTime;

      await this.prisma.ejecucion_reporte_v2.update({
        where: { id: ejecucionId },
        data: {
          estado: 'FINALIZADA',
          totalFilas: resultado.totalFilas,
          duracionMs: duracion,
          finishedAt: new Date(),
        },
      });

      this.logger.log(`Ejecución ${ejecucionId} finalizada en ${duracion}ms`);

      return buffer;
    } catch (error) {
      this.logger.error(`Error en ejecución ${ejecucionId}`, error.stack);

      if (ejecucionId) {
        await this.prisma.ejecucion_reporte_v2.update({
          where: { id: ejecucionId },
          data: {
            estado: 'FALLIDA',
            errorMsg: error.message,
            finishedAt: new Date(),
            duracionMs: Date.now() - startTime,
          },
        });
      }

      throw error;
    }
  }

  async preview(dto: PreviewV2Dto) {
    this.logger.log('Ejecutando preview v2');

    const raiz = dto.raiz || 'deudor';

    const resultado = await this.executor.execute(dto.definicion, raiz, dto.filtrosVars, true);

    return {
      columnas: resultado.columnas,
      filas: resultado.filas,
      total: resultado.totalFilas,
      modo: 'sync',
    };
  }

  async getVariables(id: number) {
    const plantilla = await this.findOne(id);

    const definicion = plantilla.definicion as any;

    if (!definicion.filtros || definicion.filtros.length === 0) {
      return [];
    }

    const variables = definicion.filtros
      .filter((filtro: any) => filtro.variable === true)
      .map((filtro: any) => ({
        id: filtro.id,
        path: filtro.path,
        operador: filtro.operador,
        label: filtro.labelVariable || filtro.id,
        valorPorDefecto: filtro.valorPorDefecto,
        requerido: filtro.valorPorDefecto === undefined,
      }));

    return variables;
  }

  private exportar(
    filas: Record<string, any>[] | FilaConSubtotales[],
    columnas: string[],
    formato: string,
    opciones?: any,
  ): Buffer | Promise<Buffer> {
    switch (formato) {
      case FormatoSalidaV2.XLSX:
        return this.xlsxExportador.generar(filas, columnas, opciones);
      case FormatoSalidaV2.CSV:
        return this.csvExportador.generar(filas, columnas, opciones);
      case FormatoSalidaV2.TXT:
        return this.txtExportador.generar(filas, columnas, opciones);
      case FormatoSalidaV2.PDF:
        return this.pdfExportador.generar(filas, columnas, opciones);
      default:
        throw new BadRequestException(`Formato ${formato} no soportado`);
    }
  }
}
