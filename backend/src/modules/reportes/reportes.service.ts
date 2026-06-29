import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePlantillaDto, UpdatePlantillaDto, FormatoSalida } from './dto/plantilla.dto';
import { EjecutarDto, PreviewDto } from './dto/ejecutar.dto';
import { ExecutorService } from './executor/executor.service';
import { XlsxExportador } from './exportadores/xlsx.exportador';
import { CsvExportador } from './exportadores/csv.exportador';
import { TxtExportador } from './exportadores/txt.exportador';
import { PdfExportador } from './exportadores/pdf.exportador';
import { FilaConSubtotales } from './executor/grouping.service';

@Injectable()
export class ReportesService {
  private readonly logger = new Logger(ReportesService.name);

  constructor(
    private prisma: PrismaService,
    private executor: ExecutorService,
    private xlsxExportador: XlsxExportador,
    private csvExportador: CsvExportador,
    private txtExportador: TxtExportador,
    private pdfExportador: PdfExportador,
  ) {}

  async findAllFormatosTel() {
    return this.prisma.formato_telefono.findMany({
      where: { activo: true },
      orderBy: { nombre: 'asc' },
    });
  }

  async createFormatoTel(data: { nombre: string; descripcion?: string; patron: string }) {
    this.logger.log(`Creando formato de teléfono: ${data.nombre}`);
    return this.prisma.formato_telefono.create({ data });
  }

  async findAll(empresaId?: number) {
    this.logger.log(`Buscando plantillas, empresaId=${empresaId}`);

    return this.prisma.plantilla_reporte.findMany({
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
        // _count.ejecuciones: si ya se ejecutó alguna vez, no se permite cambiar de empresa.
        _count: { select: { ejecuciones: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: number) {
    const plantilla = await this.prisma.plantilla_reporte.findUnique({
      where: { id },
      include: {
        empresa: true,
        creadoPor: {
          select: { id: true, nombre: true, email: true },
        },
      },
    });

    if (!plantilla) {
      throw new NotFoundException(`Plantilla ${id} no encontrada`);
    }

    return plantilla;
  }

  async create(dto: CreatePlantillaDto, usuarioId?: number) {
    this.logger.log(`Creando plantilla: ${dto.nombre}`);

    return this.prisma.plantilla_reporte.create({
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

  async update(id: number, dto: UpdatePlantillaDto) {
    await this.findOne(id);

    this.logger.log(`Actualizando plantilla ${id}`);

    return this.prisma.plantilla_reporte.update({
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

    this.logger.log(`Soft delete plantilla ${id}`);

    return this.prisma.plantilla_reporte.update({
      where: { id },
      data: { activo: false },
    });
  }

  async duplicate(
    id: number,
    dto?: { nombre?: string; empresaId?: number | null },
    usuarioId?: number,
  ) {
    const original = await this.findOne(id);

    // empresaId: undefined → conserva la del original; null → Global; number → esa empresa.
    const empresaDestino = dto?.empresaId !== undefined ? dto.empresaId : original.empresaId;
    if (empresaDestino != null) {
      const emp = await this.prisma.empresa.findUnique({ where: { id: empresaDestino } });
      if (!emp) throw new NotFoundException('Empresa destino no encontrada');
    }

    const nombre = dto?.nombre?.trim() || `${original.nombre} (copia)`;
    this.logger.log(`Duplicando plantilla ${id} → "${nombre}" empresa=${empresaDestino ?? 'Global'}`);

    return this.prisma.plantilla_reporte.create({
      data: {
        nombre,
        descripcion: original.descripcion,
        raiz: original.raiz,
        empresaId: empresaDestino,
        definicion: original.definicion as unknown as Prisma.InputJsonValue,
        formatoSalida: original.formatoSalida,
        opcionesFormato: (original.opcionesFormato || Prisma.JsonNull) as unknown as Prisma.InputJsonValue,
        creadoPorId: usuarioId,
      },
    });
  }

  /** Cambia la empresa de una plantilla de reporte. Solo si nunca se ejecutó. empresaId null = Global. */
  async cambiarEmpresa(id: number, empresaId: number | null) {
    const plantilla = await this.findOne(id);
    if (plantilla.empresaId === empresaId) {
      throw new BadRequestException('La plantilla ya pertenece a esa empresa');
    }

    if (empresaId != null) {
      const emp = await this.prisma.empresa.findUnique({ where: { id: empresaId } });
      if (!emp) throw new NotFoundException('Empresa destino no encontrada');
    }

    const ejecuciones = await this.prisma.ejecucion_reporte.count({ where: { plantillaId: id } });
    if (ejecuciones > 0) {
      throw new BadRequestException(
        `No se puede cambiar de empresa: la plantilla ya tiene ${ejecuciones} ejecución(es). Cloná la plantilla a la empresa deseada.`,
      );
    }

    this.logger.log(`Cambiando empresa de plantilla reporte ${id} → ${empresaId ?? 'Global'}`);
    return this.prisma.plantilla_reporte.update({
      where: { id },
      data: { empresaId },
    });
  }

  async ejecutar(id: number, dto: EjecutarDto, usuarioId: number): Promise<Buffer> {
    const plantilla = await this.findOne(id);

    this.logger.log(`Ejecutando plantilla ${id} en modo SYNC`);

    const startTime = Date.now();
    let ejecucionId: number | null = null;

    try {
      const ejecucion = await this.prisma.ejecucion_reporte.create({
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

      await this.prisma.ejecucion_reporte.update({
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
        await this.prisma.ejecucion_reporte.update({
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

  async preview(dto: PreviewDto) {
    this.logger.log('Ejecutando preview');

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
      case FormatoSalida.XLSX:
        return this.xlsxExportador.generar(filas, columnas, opciones);
      case FormatoSalida.CSV:
        return this.csvExportador.generar(filas, columnas, opciones);
      case FormatoSalida.TXT:
        return this.txtExportador.generar(filas, columnas, opciones);
      case FormatoSalida.PDF:
        return this.pdfExportador.generar(filas, columnas, opciones);
      default:
        throw new BadRequestException(`Formato ${formato} no soportado`);
    }
  }
}
