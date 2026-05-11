import { Controller, Get, Post, Body, Patch, Param, Delete, ParseIntPipe } from '@nestjs/common';
import { EmpresasService } from './empresas.service';
import { Permisos } from '../../auth/decorators';
import { Audit } from '../transacciones/audit.decorator';
import { AuditModulo, AuditTipo } from '../transacciones/audit.enums';

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
    @Audit({
        modulo: AuditModulo.ADMIN,
        entidad: 'Empresa',
        tipo: AuditTipo.CREATE,
        entidadIdFromResponse: 'id',
        empresaId: (res) => res?.id,
        resumen: (res) => `Creó empresa "${res?.nombre}"`,
        data: (res, req) => ({ params: req.body, after: res }),
    })
    create(@Body() data: { nombre: string; cuit?: string; configuracion?: any }) {
        return this.empresasService.create(data);
    }

    @Patch(':id')
    @Permisos('empresas.editar')
    @Audit({
        modulo: AuditModulo.ADMIN,
        entidad: 'Empresa',
        tipo: AuditTipo.UPDATE,
        entidadIdParam: 'id',
        empresaId: (res, req) => Number(req.params.id),
        resumen: (res, req) => `Actualizó empresa ${req.params.id}`,
        data: (res, req) => ({ params: req.body, after: res }),
    })
    update(@Param('id', ParseIntPipe) id: number, @Body() data: { nombre?: string; cuit?: string; configuracion?: any }) {
        return this.empresasService.update(id, data);
    }

    @Delete(':id')
    @Permisos('empresas.eliminar')
    @Audit({
        modulo: AuditModulo.ADMIN,
        entidad: 'Empresa',
        tipo: AuditTipo.DELETE,
        entidadIdParam: 'id',
        empresaId: (res, req) => Number(req.params.id),
        resumen: (res, req) => `Eliminó empresa ${req.params.id}`,
    })
    remove(@Param('id', ParseIntPipe) id: number) {
        return this.empresasService.remove(id);
    }

    @Post(':id/parametros')
    @Permisos('empresas.editar')
    @Audit({
        modulo: AuditModulo.ADMIN,
        entidad: 'EmpresaParametros',
        tipo: AuditTipo.UPDATE,
        entidadIdParam: 'id',
        empresaId: (res, req) => Number(req.params.id),
        resumen: (res, req) => `Asignó parámetros a empresa ${req.params.id}`,
        data: (res, req) => ({ params: req.body }),
    })
    setParametros(@Param('id', ParseIntPipe) id: number, @Body() body: { parametroIds: number[] }) {
        return this.empresasService.assignParametros(id, body.parametroIds);
    }
}
