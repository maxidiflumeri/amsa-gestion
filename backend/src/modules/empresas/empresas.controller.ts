import { Controller, Get, Post, Body, Patch, Param, Delete, ParseIntPipe } from '@nestjs/common';
import { EmpresasService } from './empresas.service';
import { Permisos } from '../../auth/decorators';

@Controller('empresas')
@Permisos('empresas.ver')
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
    @Permisos('empresas.crear')
    create(@Body() data: { nombre: string; cuit?: string; configuracion?: any }) {
        return this.empresasService.create(data);
    }

    @Patch(':id')
    @Permisos('empresas.editar')
    update(@Param('id', ParseIntPipe) id: number, @Body() data: { nombre?: string; cuit?: string; configuracion?: any }) {
        return this.empresasService.update(id, data);
    }

    @Delete(':id')
    @Permisos('empresas.eliminar')
    remove(@Param('id', ParseIntPipe) id: number) {
        return this.empresasService.remove(id);
    }

    @Post(':id/parametros')
    @Permisos('empresas.editar')
    setParametros(@Param('id', ParseIntPipe) id: number, @Body() body: { parametroIds: number[] }) {
        return this.empresasService.assignParametros(id, body.parametroIds);
    }
}

