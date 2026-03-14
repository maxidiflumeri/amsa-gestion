import { Controller, Get, Post, Body, Patch, Param, Delete, ParseIntPipe } from '@nestjs/common';
import { EmpresasService } from './empresas.service';

@Controller('empresas')
export class EmpresasController {
    constructor(private readonly empresasService: EmpresasService) { }

    @Get()
    findAll() {
        return this.empresasService.findAll();
    }

    @Get(':id')
    findOne(@Param('id', ParseIntPipe) id: number) {
        return this.empresasService.findOne(id);
    }

    @Post()
    create(@Body() data: { nombre: string; cuit?: string; configuracion?: any }) {
        return this.empresasService.create(data);
    }

    @Patch(':id')
    update(@Param('id', ParseIntPipe) id: number, @Body() data: { nombre?: string; cuit?: string; configuracion?: any }) {
        return this.empresasService.update(id, data);
    }

    @Delete(':id')
    remove(@Param('id', ParseIntPipe) id: number) {
        return this.empresasService.remove(id);
    }

    @Post(':id/parametros')
    setParametros(@Param('id', ParseIntPipe) id: number, @Body() body: { parametroIds: number[] }) {
        return this.empresasService.assignParametros(id, body.parametroIds);
    }
}

