import { Controller, Get, Post, Body, Patch, Param, Delete, Query, ParseIntPipe, Put } from '@nestjs/common';
import { ParametrosService } from './parametros.service';
import { Permisos } from '../../auth/decorators';
import { Audit } from '../transacciones/audit.decorator';
import { AuditModulo, AuditTipo } from '../transacciones/audit.enums';

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
    @Audit({
        modulo: AuditModulo.ADMIN,
        entidad: 'Parametro',
        tipo: AuditTipo.CREATE,
        entidadIdFromResponse: 'id',
        resumen: (res) => `Creó parámetro ${res?.grupo}.${res?.clave}`,
        data: (res, req) => ({ params: req.body, after: res }),
    })
    create(@Body() data: { grupo: string; clave: string; descripcion: string; padreId?: number; categoria?: string; esGlobal?: boolean; activo?: boolean }) {
        return this.parametrosService.create(data);
    }

    @Patch(':id/activo')
    @Permisos('parametros.editar')
    @Audit({
        modulo: AuditModulo.ADMIN,
        entidad: 'Parametro',
        tipo: 'TOGGLE_ACTIVO',
        entidadIdParam: 'id',
        resumen: (res, req) => `Cambió activo de parámetro ${req.params.id}`,
        data: (res) => ({ after: { activo: res?.activo } }),
    })
    toggleActivo(@Param('id', ParseIntPipe) id: number) {
        return this.parametrosService.toggleActivo(id);
    }

    @Patch(':id')
    @Permisos('parametros.editar')
    @Audit({
        modulo: AuditModulo.ADMIN,
        entidad: 'Parametro',
        tipo: AuditTipo.UPDATE,
        entidadIdParam: 'id',
        resumen: (res, req) => `Actualizó parámetro ${req.params.id}`,
        data: (res, req) => ({ params: req.body, after: res }),
    })
    update(
        @Param('id', ParseIntPipe) id: number,
        @Body() data: { grupo?: string; clave?: string; descripcion?: string; padreId?: number; categoria?: string; esGlobal?: boolean; activo?: boolean },
    ) {
        return this.parametrosService.update(id, data);
    }

    @Delete(':id')
    @Permisos('parametros.eliminar')
    @Audit({
        modulo: AuditModulo.ADMIN,
        entidad: 'Parametro',
        tipo: AuditTipo.DELETE,
        entidadIdParam: 'id',
        resumen: (res, req) => `Eliminó parámetro ${req.params.id}`,
    })
    remove(@Param('id', ParseIntPipe) id: number) {
        return this.parametrosService.remove(id);
    }

    @Post(':id/empresas')
    @Permisos('parametros.editar')
    @Audit({
        modulo: AuditModulo.ADMIN,
        entidad: 'ParametroEmpresas',
        tipo: AuditTipo.UPDATE,
        entidadIdParam: 'id',
        resumen: (res, req) => `Asignó empresas a parámetro ${req.params.id}`,
        data: (res, req) => ({ params: req.body }),
    })
    setEmpresas(@Param('id', ParseIntPipe) id: number, @Body() body: { empresaIds: number[] }) {
        return this.parametrosService.setEmpresasForParametro(id, body.empresaIds);
    }

    /**
     * Asigna o desasigna **un código en una empresa**.
     *
     * Es lo que usa la solapa de asignación. Existe aparte de `POST :id/empresas` porque ese
     * reescribe la lista completa de empresas del parámetro: dos administradores configurando
     * empresas distintas al mismo tiempo se pisaban.
     */
    @Put(':id/empresas/:empresaId')
    @Permisos('parametros.editar')
    @Audit({
        modulo: AuditModulo.ADMIN,
        entidad: 'ParametroEmpresas',
        tipo: AuditTipo.UPDATE,
        entidadIdParam: 'id',
        resumen: (_res, req) =>
            `${req.body?.asignado ? 'Asignó' : 'Desasignó'} el parámetro ${req.params.id} en la empresa ${req.params.empresaId}`,
        data: (_res, req) => ({ params: { ...req.params, ...req.body } }),
    })
    setAsignacion(
        @Param('id', ParseIntPipe) id: number,
        @Param('empresaId', ParseIntPipe) empresaId: number,
        @Body() body: { asignado: boolean },
    ) {
        return this.parametrosService.setAsignacion(id, empresaId, body.asignado === true);
    }
}
