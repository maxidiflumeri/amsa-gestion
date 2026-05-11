import { Controller, Get, Post, Patch, Delete, Body, Param, ParseIntPipe, Query, Res, Logger, Req } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ReportesService } from './reportes.service';
import { EjecutorService } from './ejecutor/ejecutor.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { Permisos } from '../../auth/decorators';

@Controller('reportes')
@Permisos('reportes.v1.ver')
export class ReportesController {
  private readonly logger = new Logger(ReportesController.name);

  constructor(
    private readonly reportesService: ReportesService,
    private readonly ejecutorService: EjecutorService,
    private readonly prisma: PrismaService,
  ) {}

  // ── Plantillas ───────────────────────────────────────────────────────────

  @Get('plantillas')
  findAll(@Query('empresaId') empresaId?: string) {
    return this.reportesService.findAllPlantillas(empresaId ? parseInt(empresaId) : undefined);
  }

  @Get('plantillas/:id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.reportesService.findOnePlantilla(id);
  }

  @Post('plantillas')
  @Permisos('reportes.v1.crear')
  create(@Body() body: any) {
    return this.reportesService.createPlantilla(body);
  }

  @Patch('plantillas/:id')
  @Permisos('reportes.v1.editar')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.reportesService.updatePlantilla(id, body);
  }

  @Delete('plantillas/:id')
  @Permisos('reportes.v1.eliminar')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.reportesService.deletePlantilla(id);
  }

  // ── Ejecución ────────────────────────────────────────────────────────────

  @Post('plantillas/:id/ejecutar')
  @Permisos('reportes.v1.ejecutar')
  async ejecutar(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { filtrosVars?: any; usuarioId?: number },
    @Res() res: Response,
    @Req() req: Request,
  ) {
    this.logger.log(`Ejecutando plantilla ${id}`);
    const plantilla = await this.reportesService.findOnePlantilla(id);
    const { buffer, mimeType, extension, totalFilas } = await this.ejecutorService.ejecutar(plantilla, body.filtrosVars || {});

    // Usar usuarioId del JWT
    const jwtUsuario = (req as any)['usuario'];
    const usuarioIdReal = jwtUsuario?.sub || body.usuarioId || 1;

    try {
      await this.prisma.ejecucion_reporte.create({
        data: {
          plantillaId: id,
          usuarioId: usuarioIdReal,
          filtrosUsados: body.filtrosVars || {},
          totalFilas,
        },
      });
    } catch (error) {
      this.logger.warn(`No se pudo registrar log de ejecución (ej. usuario inexistente): ${error.message}`);
    }

    const nombreArchivo = `${plantilla.nombre.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().slice(0, 10)}.${extension}`;
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
    res.send(buffer);
  }

  @Post('plantillas/:id/preview')
  async preview(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { filtrosVars?: any },
  ) {
    const plantilla = await this.reportesService.findOnePlantilla(id);
    return this.ejecutorService.preview(plantilla, body.filtrosVars || {});
  }

  @Get('campos-extra')
  async getCamposExtra(@Query('empresaId') empresaId?: string) {
    return this.reportesService.getCamposExtra(empresaId ? Number(empresaId) : undefined);
  }

  // ── Estadísticas de remesa ───────────────────────────────────────────────

  @Get('estadisticas/remesa/:remesaId')
  estadisticasRemesa(@Param('remesaId', ParseIntPipe) remesaId: number) {
    return this.reportesService.estadisticasRemesa(remesaId);
  }

  // ── Fuentes y Columnas disponibles ─────────────────────────────────────────────────

  @Get('fuentes')
  getFuentes() {
    return this.reportesService.getFuentesDisponibles();
  }

  @Get('columnas/:fuente')
  columnas(@Param('fuente') fuente: string) {
    return this.reportesService.getColumnasDisponibles(fuente);
  }

  // ── Formatos de teléfono ─────────────────────────────────────────────────

  @Get('formatos-tel')
  getFormatosTel() {
    return this.reportesService.findAllFormatosTel();
  }

  @Post('formatos-tel')
  @Permisos('reportes.v2.gestionar_formatos')
  createFormatoTel(@Body() body: { nombre: string; descripcion?: string; patron: string }) {
    return this.reportesService.createFormatoTel(body);
  }

  // ── Remesas por empresa (helper para filtros variables) ──────────────────
  @Get('remesas')
  async getRemesas(@Query('empresaId') empresaId?: string) {
    return this.prisma.remesa.findMany({
      where: empresaId ? { empresaId: parseInt(empresaId) } : undefined,
      select: { id: true, nombre: true, numeroRemesa: true, empresaId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}
