import { Controller, Get, Post, Put, Delete, Body, Param, Query, ParseIntPipe } from '@nestjs/common';
import { PoliticasService } from './politicas.service';
import { CreatePoliticaDto } from './dtos/create-politica.dto';
import { UpdatePoliticaDto } from './dtos/update-politica.dto';
import { Permisos } from '../../auth/decorators';

@Controller('politicas')
@Permisos('politicas.ver')
export class PoliticasController {
  constructor(private readonly politicasService: PoliticasService) {}

  @Get()
  findAll(@Query('empresaId', ParseIntPipe) empresaId?: number) {
    return this.politicasService.findAll(empresaId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.politicasService.findOne(id);
  }

  @Post()
  @Permisos('politicas.crear')
  create(@Body() dto: CreatePoliticaDto) {
    return this.politicasService.create(dto);
  }

  @Put(':id')
  @Permisos('politicas.editar')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePoliticaDto) {
    return this.politicasService.update(id, dto);
  }

  @Delete(':id')
  @Permisos('politicas.eliminar')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.politicasService.remove(id);
  }
}
