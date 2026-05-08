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
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { ReportesV2Service } from './reportes-v2.service';
import { CatalogoService } from './catalogo/catalogo.service';
import { CreatePlantillaV2Dto, UpdatePlantillaV2Dto } from './dto/plantilla-v2.dto';
import { EjecutarV2Dto, PreviewV2Dto } from './dto/ejecutar-v2.dto';
import { CatalogoQueryDto } from './dto/catalogo.dto';

@Controller('reportes/v2')
export class ReportesV2Controller {
  private readonly logger = new Logger(ReportesV2Controller.name);

  constructor(
    private reportesService: ReportesV2Service,
    private catalogoService: CatalogoService,
  ) {}

  @Get('catalogo')
  async getCatalogo(@Query() query: CatalogoQueryDto) {
    const raiz = query.raiz || 'deudor';
    const depth = query.depth || 3;

    this.logger.log(`GET /reportes/v2/catalogo raiz=${raiz} depth=${depth}`);

    return this.catalogoService.getCatalogo(raiz, depth);
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

    if (empresaId && isNaN(empresaIdNum!)) {
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
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePlantillaV2Dto) {
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

  @Post('plantillas/:id/ejecutar')
  async ejecutar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EjecutarV2Dto,
    @Res() res: Response,
  ) {
    this.logger.log(`POST /reportes/v2/plantillas/${id}/ejecutar`);

    const plantilla = await this.reportesService.findOne(id);

    const buffer = await this.reportesService.ejecutar(id, dto, 1);

    const extension = plantilla.formatoSalida;
    const filename = `${plantilla.nombre.replace(/[^a-zA-Z0-9]/g, '_')}.${extension}`;

    const mimeTypes: Record<string, string> = {
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      csv: 'text/csv',
      txt: 'text/plain',
    };

    res.setHeader('Content-Type', mimeTypes[extension] || 'application/octet-stream');
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
}
