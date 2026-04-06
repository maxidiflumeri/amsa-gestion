import { Controller, Get, Post, Put, Delete, Body, Param, Query, ParseIntPipe } from '@nestjs/common';
import { PoliticasService } from './politicas.service';
import { CreatePoliticaDto } from './dtos/create-politica.dto';
import { UpdatePoliticaDto } from './dtos/update-politica.dto';

@Controller('politicas')
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
  create(@Body() dto: CreatePoliticaDto) {
    return this.politicasService.create(dto);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePoliticaDto) {
    return this.politicasService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.politicasService.remove(id);
  }
}
