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
import { ReportesV2Service } from './reportes-v2.service';
import { CatalogoService } from './catalogo/catalogo.service';
import {
  CreatePlantillaV2Dto,
  UpdatePlantillaV2Dto,
} from './dto/plantilla-v2.dto';
import { EjecutarV2Dto, PreviewV2Dto } from './dto/ejecutar-v2.dto';
import {
  CatalogoQueryDto,
  CamposAdicionalesQueryDto,
} from './dto/catalogo.dto';
import {
  EstimarV2Dto,
  ListarEjecucionesQueryDto,
} from './dto/ejecuciones-v2.dto';
import { EjecucionesV2Service } from './ejecuciones/ejecuciones-v2.service';

const DEFAULT_USUARIO_ID = 1;

function resolverUsuarioId(req: Request): number {
  const headerVal = req.header('x-usuario-id');
  if (headerVal) {
    const parsed = parseInt(headerVal, 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  const anyReq = req as any;
  if (anyReq.user?.id && Number.isFinite(anyReq.user.id)) {
    return anyReq.user.id;
  }
  return DEFAULT_USUARIO_ID;
}

function resolverEmpresaId(req: Request): number | null {
  const headerVal = req.header('x-empresa-id');
  if (headerVal) {
    const parsed = parseInt(headerVal, 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return null;
}

@Controller('reportes/v2')
export class ReportesV2Controller {
  private readonly logger = new Logger(ReportesV2Controller.name);

  constructor(
    private reportesService: ReportesV2Service,
    private catalogoService: CatalogoService,
    private ejecucionesService: EjecucionesV2Service,
  ) {}

  @Get('catalogo')
  async getCatalogo(@Query() query: CatalogoQueryDto) {
    const raiz = query.raiz || 'deudor';
    const depth = query.depth || 3;

    this.logger.log(`GET /reportes/v2/catalogo raiz=${raiz} depth=${depth}`);

    return this.catalogoService.getCatalogo(raiz, depth);
  }

  @Get('catalogo/campos-adicionales')
  async getCamposAdicionalesKeys(
    @Query() query: CamposAdicionalesQueryDto,
  ) {
    this.logger.log(
      `GET /reportes/v2/catalogo/campos-adicionales empresaId=${query.empresaId ?? 'all'}`,
    );
    const keys = await this.catalogoService.getCamposAdicionalesKeys(
      query.empresaId,
    );
    return { keys };
  }

  @Post('catalogo/invalidate-cache')
  invalidateCatalogCache() {
    this.logger.log('POST /reportes/v2/catalogo/invalidate-cache');
    this.catalogoService.invalidateCache();
    return { message: 'Cache invalidado' };
  }

  @Get('plantillas')
  async findAll(@Query('empresaId') empresaId?: string) {
    this.logger.log(`GET /reportes/v2/plantillas empresaId=${empresaId}`);

    const empresaIdNum = empresaId ? parseInt(empresaId, 10) : undefined;

    if (empresaId && Number.isNaN(empresaIdNum!)) {
      throw new BadRequestException('empresaId debe ser un número');
    }

    return this.reportesService.findAll(empresaIdNum);
  }

  @Get('plantillas/:id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    this.logger.log(`GET /reportes/v2/plantillas/${id}`);
    return this.reportesService.findOne(id);
  }

  @Post('plantillas')
  async create(@Body() dto: CreatePlantillaV2Dto) {
    this.logger.log(`POST /reportes/v2/plantillas`);
    return this.reportesService.create(dto);
  }

  @Patch('plantillas/:id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePlantillaV2Dto,
  ) {
    this.logger.log(`PATCH /reportes/v2/plantillas/${id}`);
    return this.reportesService.update(id, dto);
  }

  @Delete('plantillas/:id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    this.logger.log(`DELETE /reportes/v2/plantillas/${id}`);
    return this.reportesService.remove(id);
  }

  @Post('plantillas/:id/duplicar')
  async duplicate(@Param('id', ParseIntPipe) id: number) {
    this.logger.log(`POST /reportes/v2/plantillas/${id}/duplicar`);
    return this.reportesService.duplicate(id);
  }

  @Post('plantillas/:id/estimar')
  async estimar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EstimarV2Dto,
  ) {
    this.logger.log(`POST /reportes/v2/plantillas/${id}/estimar`);
    return this.ejecucionesService.estimar(id, dto.filtrosVars);
  }

  @Post('plantillas/:id/ejecutar')
  async ejecutar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EjecutarV2Dto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    this.logger.log(`POST /reportes/v2/plantillas/${id}/ejecutar`);

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
  async preview(@Body() dto: PreviewV2Dto) {
    this.logger.log('POST /reportes/v2/preview');
    return this.reportesService.preview(dto);
  }

  @Get('plantillas/:id/variables')
  async getVariables(@Param('id', ParseIntPipe) id: number) {
    this.logger.log(`GET /reportes/v2/plantillas/${id}/variables`);
    return this.reportesService.getVariables(id);
  }

  @Get('ejecuciones')
  async listarEjecuciones(
    @Req() req: Request,
    @Query() query: ListarEjecucionesQueryDto,
  ) {
    const usuarioId = resolverUsuarioId(req);
    const empresaId = resolverEmpresaId(req);

    this.logger.log(
      `GET /reportes/v2/ejecuciones usuarioId=${usuarioId} estado=${query.estado}`,
    );

    return this.ejecucionesService.listar(usuarioId, empresaId, query);
  }

  @Get('ejecuciones/:id')
  async obtenerEjecucion(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
  ) {
    const usuarioId = resolverUsuarioId(req);
    this.logger.log(`GET /reportes/v2/ejecuciones/${id}`);
    return this.ejecucionesService.obtener(id, usuarioId);
  }

  @Get('ejecuciones/:id/descargar')
  async descargarEjecucion(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const usuarioId = resolverUsuarioId(req);
    this.logger.log(`GET /reportes/v2/ejecuciones/${id}/descargar`);

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
    this.logger.log(`POST /reportes/v2/ejecuciones/${id}/cancelar`);
    return this.ejecucionesService.cancelar(id, usuarioId);
  }

  @Delete('ejecuciones/:id')
  async eliminarEjecucion(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
  ) {
    const usuarioId = resolverUsuarioId(req);
    this.logger.log(`DELETE /reportes/v2/ejecuciones/${id}`);
    return this.ejecucionesService.eliminar(id, usuarioId);
  }
}
