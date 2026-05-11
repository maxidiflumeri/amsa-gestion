import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  Logger,
  Res,
  Req,
  BadRequestException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import * as path from 'path';
import { ReportesService } from './reportes.service';
import { CatalogoService } from './catalogo/catalogo.service';
import {
  CreatePlantillaDto,
  UpdatePlantillaDto,
} from './dto/plantilla.dto';
import { EjecutarDto, PreviewDto } from './dto/ejecutar.dto';
import {
  CatalogoQueryDto,
  CamposAdicionalesQueryDto,
} from './dto/catalogo.dto';
import {
  EstimarDto,
  ListarEjecucionesQueryDto,
} from './dto/ejecuciones.dto';
import { EjecucionesService } from './ejecuciones/ejecuciones.service';
import { Permisos } from '../../auth/decorators';
import { Audit } from '../transacciones/audit.decorator';
import { AuditModulo, AuditTipo } from '../transacciones/audit.enums';

function resolverUsuarioId(req: Request): number {
  const usuario = (req as any)['usuario'];
  if (usuario?.sub && Number.isFinite(usuario.sub)) return usuario.sub;
  return 1;
}

function resolverEmpresaId(req: Request): number | null {
  const headerVal = req.header('x-empresa-id');
  if (headerVal) {
    const parsed = parseInt(headerVal, 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return null;
}

@Controller('reportes')
@Permisos('reportes.ver')
export class ReportesController {
  private readonly logger = new Logger(ReportesController.name);

  constructor(
    private reportesService: ReportesService,
    private catalogoService: CatalogoService,
    private ejecucionesService: EjecucionesService,
  ) {}

  @Get('formatos-tel')
  async getFormatosTel() {
    this.logger.log('GET /reportes/formatos-tel');
    return this.reportesService.findAllFormatosTel();
  }

  @Post('formatos-tel')
  @Permisos('reportes.gestionar_formatos')
  async createFormatoTel(
    @Body() body: { nombre: string; descripcion?: string; patron: string },
  ) {
    this.logger.log(`POST /reportes/formatos-tel nombre=${body.nombre}`);
    return this.reportesService.createFormatoTel(body);
  }

  @Get('catalogo')
  async getCatalogo(@Query() query: CatalogoQueryDto) {
    const raiz = query.raiz || 'deudor';
    const depth = query.depth || 3;

    this.logger.log(`GET /reportes/catalogo raiz=${raiz} depth=${depth}`);

    return this.catalogoService.getCatalogo(raiz, depth);
  }

  @Get('catalogo/campos-adicionales')
  async getCamposAdicionalesKeys(
    @Query() query: CamposAdicionalesQueryDto,
  ) {
    this.logger.log(
      `GET /reportes/catalogo/campos-adicionales empresaId=${query.empresaId ?? 'all'}`,
    );
    const keys = await this.catalogoService.getCamposAdicionalesKeys(
      query.empresaId,
    );
    return { keys };
  }

  @Post('catalogo/invalidate-cache')
  invalidateCatalogCache() {
    this.logger.log('POST /reportes/catalogo/invalidate-cache');
    this.catalogoService.invalidateCache();
    return { message: 'Cache invalidado' };
  }

  @Get('plantillas')
  async findAll(@Query('empresaId') empresaId?: string) {
    this.logger.log(`GET /reportes/plantillas empresaId=${empresaId}`);

    const empresaIdNum = empresaId ? parseInt(empresaId, 10) : undefined;

    if (empresaId && Number.isNaN(empresaIdNum!)) {
      throw new BadRequestException('empresaId debe ser un número');
    }

    return this.reportesService.findAll(empresaIdNum);
  }

  @Get('plantillas/:id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    this.logger.log(`GET /reportes/plantillas/${id}`);
    return this.reportesService.findOne(id);
  }

  @Post('plantillas')
  @Permisos('reportes.crear')
  @Audit({
    modulo: AuditModulo.REPORTES,
    entidad: 'PlantillaReporte',
    tipo: AuditTipo.CREATE,
    entidadIdFromResponse: 'id',
    empresaId: (res) => res?.empresaId,
    resumen: (res) => `Creó plantilla reporte "${res?.nombre}"`,
    data: (res, req) => ({ params: req.body, after: { id: res?.id, nombre: res?.nombre } }),
  })
  async create(@Body() dto: CreatePlantillaDto) {
    this.logger.log(`POST /reportes/plantillas`);
    return this.reportesService.create(dto);
  }

  @Patch('plantillas/:id')
  @Permisos('reportes.editar')
  @Audit({
    modulo: AuditModulo.REPORTES,
    entidad: 'PlantillaReporte',
    tipo: AuditTipo.UPDATE,
    entidadIdParam: 'id',
    resumen: (res, req) => `Actualizó plantilla reporte ${req.params.id}`,
    data: (res, req) => ({ params: req.body }),
  })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePlantillaDto,
  ) {
    this.logger.log(`PATCH /reportes/plantillas/${id}`);
    return this.reportesService.update(id, dto);
  }

  @Delete('plantillas/:id')
  @Permisos('reportes.eliminar')
  @Audit({
    modulo: AuditModulo.REPORTES,
    entidad: 'PlantillaReporte',
    tipo: AuditTipo.DELETE,
    entidadIdParam: 'id',
    resumen: (res, req) => `Eliminó plantilla reporte ${req.params.id}`,
  })
  async remove(@Param('id', ParseIntPipe) id: number) {
    this.logger.log(`DELETE /reportes/plantillas/${id}`);
    return this.reportesService.remove(id);
  }

  @Post('plantillas/:id/duplicar')
  async duplicate(@Param('id', ParseIntPipe) id: number) {
    this.logger.log(`POST /reportes/plantillas/${id}/duplicar`);
    return this.reportesService.duplicate(id);
  }

  @Post('plantillas/:id/estimar')
  async estimar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EstimarDto,
  ) {
    this.logger.log(`POST /reportes/plantillas/${id}/estimar`);
    return this.ejecucionesService.estimar(id, dto.filtrosVars);
  }

  @Post('plantillas/:id/ejecutar')
  @Permisos('reportes.ejecutar')
  @Audit({
    modulo: AuditModulo.REPORTES,
    entidad: 'EjecucionReporte',
    tipo: AuditTipo.REPORTE_EJECUTAR,
    entidadIdParam: 'id',
    resumen: (res, req) => `Ejecutó reporte ${req.params.id}`,
    data: (res, req) => ({ params: req.body }),
  })
  async ejecutar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EjecutarDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    this.logger.log(`POST /reportes/plantillas/${id}/ejecutar`);

    const usuarioId = resolverUsuarioId(req);
    const filtrosVars = dto.filtrosVars || {};

    const estimacion = await this.ejecucionesService.estimar(id, filtrosVars);

    if (estimacion.modoSugerido === 'async') {
      const result = await this.ejecucionesService.encolarEjecucion(
        id,
        usuarioId,
        filtrosVars,
      );
      res.status(202).json(result);
      return;
    }

    const plantilla = await this.reportesService.findOne(id);
    const buffer = await this.reportesService.ejecutar(id, dto, usuarioId);

    const extension = plantilla.formatoSalida;
    const filename = `${plantilla.nombre.replace(/[^a-zA-Z0-9]/g, '_')}.${extension}`;

    const mimeTypes: Record<string, string> = {
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      csv: 'text/csv',
      txt: 'text/plain',
      pdf: 'application/pdf',
    };

    res.setHeader(
      'Content-Type',
      mimeTypes[extension] || 'application/octet-stream',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Post('preview')
  async preview(@Body() dto: PreviewDto) {
    this.logger.log('POST /reportes/preview');
    return this.reportesService.preview(dto);
  }

  @Get('plantillas/:id/variables')
  async getVariables(@Param('id', ParseIntPipe) id: number) {
    this.logger.log(`GET /reportes/plantillas/${id}/variables`);
    return this.reportesService.getVariables(id);
  }

  @Get('ejecuciones')
  async listarEjecuciones(
    @Req() req: Request,
    @Query() query: ListarEjecucionesQueryDto,
  ) {
    const usuarioId = resolverUsuarioId(req);
    const empresaId = resolverEmpresaId(req);
    const permisos: string[] = (req as any)['usuario']?.permisos ?? [];
    const verTodas = permisos.includes('reportes.ver_ejecuciones');

    this.logger.log(
      `GET /reportes/ejecuciones usuarioId=${usuarioId} estado=${query.estado} verTodas=${verTodas}`,
    );

    // Si tiene el permiso de ver todas, pasar usuarioId=0 para que el servicio no filtre
    return this.ejecucionesService.listar(verTodas ? 0 : usuarioId, empresaId, query);
  }

  @Get('ejecuciones/:id')
  async obtenerEjecucion(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
  ) {
    const usuarioId = resolverUsuarioId(req);
    this.logger.log(`GET /reportes/ejecuciones/${id}`);
    return this.ejecucionesService.obtener(id, usuarioId);
  }

  @Get('ejecuciones/:id/descargar')
  @Audit({
    modulo: AuditModulo.REPORTES,
    entidad: 'EjecucionReporte',
    tipo: AuditTipo.REPORTE_DESCARGAR,
    entidadIdParam: 'id',
    resumen: (res, req) => `Descargó ejecución ${req.params.id}`,
  })
  async descargarEjecucion(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const usuarioId = resolverUsuarioId(req);
    this.logger.log(`GET /reportes/ejecuciones/${id}/descargar`);

    const { ejecucion, stream } = await this.ejecucionesService.obtenerArchivo(
      id,
      usuarioId,
    );

    const ext = ejecucion.archivoPath
      ? path.extname(ejecucion.archivoPath).replace('.', '')
      : 'bin';

    const mimeTypes: Record<string, string> = {
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      csv: 'text/csv',
      txt: 'text/plain',
      pdf: 'application/pdf',
    };

    const baseName = `ejecucion_${ejecucion.id}.${ext}`;

    res.setHeader(
      'Content-Type',
      mimeTypes[ext] || 'application/octet-stream',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}"`);
    if (ejecucion.archivoTamano) {
      res.setHeader('Content-Length', String(ejecucion.archivoTamano));
    }

    stream.on('error', (err) => {
      this.logger.error(`Error streaming archivo ${id}: ${err.message}`);
      if (!res.headersSent) {
        res.status(500).json({ message: 'Error al leer archivo' });
      } else {
        res.end();
      }
    });

    stream.pipe(res);
  }

  @Post('ejecuciones/:id/cancelar')
  async cancelarEjecucion(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
  ) {
    const usuarioId = resolverUsuarioId(req);
    this.logger.log(`POST /reportes/ejecuciones/${id}/cancelar`);
    return this.ejecucionesService.cancelar(id, usuarioId);
  }

  @Delete('ejecuciones/:id')
  async eliminarEjecucion(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
  ) {
    const usuarioId = resolverUsuarioId(req);
    this.logger.log(`DELETE /reportes/ejecuciones/${id}`);
    return this.ejecucionesService.eliminar(id, usuarioId);
  }
}
