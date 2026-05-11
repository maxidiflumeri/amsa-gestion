import { Controller, Get, Post, Body, Patch, Param, Delete, Query, ParseIntPipe } from '@nestjs/common';
import { ParametrosService } from './parametros.service';
import { Permisos } from '../../auth/decorators';

@Controller('parametros')
@Permisos('parametros.ver')
export class ParametrosController {
    constructor(private readonly parametrosService: ParametrosService) {}

    @Get('grupos')
    getGrupos() {
        return this.parametrosService.getGrupos();
    }

    @Get()
    findAll(
        @Query('grupo') grupo?: string,
        @Query('empresaId') empresaId?: string,
        @Query('activo') activo?: string,
    ) {
        const activoFilter = activo === 'true' ? true : activo === 'false' ? false : undefined;
        return this.parametrosService.findAll({
            grupo,
            empresaId: empresaId ? parseInt(empresaId) : undefined,
            activo: activoFilter,
        });
    }

    @Get(':id')
    findOne(@Param('id', ParseIntPipe) id: number) {
        return this.parametrosService.findOne(id);
    }

    @Post()
    @Permisos('parametros.crear')
    create(@Body() data: { grupo: string; clave: string; descripcion: string; padreId?: number; categoria?: string; esGlobal?: boolean; activo?: boolean }) {
        return this.parametrosService.create(data);
    }

    @Patch(':id/activo')
    @Permisos('parametros.editar')
    toggleActivo(@Param('id', ParseIntPipe) id: number) {
        return this.parametrosService.toggleActivo(id);
    }

    @Patch(':id')
    @Permisos('parametros.editar')
    update(
        @Param('id', ParseIntPipe) id: number,
        @Body() data: { grupo?: string; clave?: string; descripcion?: string; padreId?: number; categoria?: string; esGlobal?: boolean; activo?: boolean },
    ) {
        return this.parametrosService.update(id, data);
    }

    @Delete(':id')
    @Permisos('parametros.eliminar')
    remove(@Param('id', ParseIntPipe) id: number) {
        return this.parametrosService.remove(id);
    }

    @Post(':id/empresas')
    @Permisos('parametros.editar')
    setEmpresas(@Param('id', ParseIntPipe) id: number, @Body() body: { empresaIds: number[] }) {
        return this.parametrosService.setEmpresasForParametro(id, body.empresaIds);
    }
}