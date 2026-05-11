// src/import/import.controller.ts
import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImportService } from './imports.service';
import { CreatePlantillaDto, CreateRemesaDto } from './dtos/import.dto';
import { Permisos, UsuarioActual } from '../../auth/decorators';
import { Audit } from '../transacciones/audit.decorator';
import { AuditModulo, AuditTipo } from '../transacciones/audit.enums';

interface UsuarioJwt {
    sub: number;
    email: string;
    rol: string;
    permisos: string[];
}

@Controller('import')
@Permisos('importacion.ver_historial')
export class ImportController {
    constructor(private readonly service: ImportService) { }

    // --- CATEGORÍAS ---
    @Get('categorias')
    getCategories() {
        return this.service.getCategories();
    }

    @Get('empresas')
    getEmpresas() {
        return this.service.listEmpresas();
    }

    // --- PLANTILLAS ---
    @Post('plantillas')
    @Permisos('plantillas_import.crear')
    @Audit({
        modulo: AuditModulo.IMPORT,
        entidad: 'PlantillaImport',
        tipo: AuditTipo.CREATE,
        entidadIdFromResponse: 'id',
        empresaId: (res) => res?.empresaId,
        resumen: (res) => `Creó plantilla import "${res?.nombre}"`,
        data: (res, req) => ({ params: req.body, after: res }),
    })
    createPlantilla(@Body() dto: CreatePlantillaDto) {
        return this.service.createPlantilla(dto);
    }

    @Get('plantillas/:empresaId/:categoria')
    @Permisos('plantillas_import.ver')
    listPlantillas(@Param('empresaId', ParseIntPipe) empresaId: number, @Param('categoria') categoria: string) {
        return this.service.listPlantillas(empresaId, categoria);
    }

    @Get('plantillas/:empresaId')
    listAllPlantillas(@Param('empresaId', ParseIntPipe) empresaId: number) {
        return this.service.listPlantillas(empresaId);
    }

    @Get('plantilla/:id')
    getPlantilla(@Param('id', ParseIntPipe) id: number) {
        return this.service.getPlantilla(id);
    }

    @Post('plantillas/preview')
    @UseInterceptors(FileInterceptor('file'))
    previewFile(
        @UploadedFile() file: any,
        @Body('separador') separador?: string,
        @Body('tieneHeader') tieneHeader?: string,
    ) {
        return this.service.previewFile(
            file,
            separador || '|',
            tieneHeader === 'true',
        );
    }

    @Post('plantillas/:id')
    @Permisos('plantillas_import.editar')
    @Audit({
        modulo: AuditModulo.IMPORT,
        entidad: 'PlantillaImport',
        tipo: AuditTipo.UPDATE,
        entidadIdParam: 'id',
        empresaId: (res) => res?.empresaId,
        resumen: (res, req) => `Actualizó plantilla import ${req.params.id}`,
        data: (res, req) => ({ params: req.body, after: res }),
    })
    updatePlantilla(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: Partial<CreatePlantillaDto>,
    ) {
        return this.service.updatePlantilla(id, dto);
    }

    @Post('plantillas/:id/delete')
    @Permisos('plantillas_import.eliminar')
    @Audit({
        modulo: AuditModulo.IMPORT,
        entidad: 'PlantillaImport',
        tipo: AuditTipo.DELETE,
        entidadIdParam: 'id',
        resumen: (res, req) => `Eliminó plantilla import ${req.params.id}`,
    })
    deletePlantilla(@Param('id', ParseIntPipe) id: number) {
        return this.service.deletePlantilla(id);
    }

    // --- REMESAS ---
    @Post('remesas')
    @UseInterceptors(FileInterceptor('file'))
    @Audit({
        modulo: AuditModulo.IMPORT,
        entidad: 'Remesa',
        tipo: AuditTipo.CREATE,
        entidadIdFromResponse: 'id',
        empresaId: (res, req) => Number(req.body?.empresaId) || undefined,
        resumen: (res, req) => `Creó remesa para empresa ${req.body?.empresaId}`,
        data: (res, req) => ({ params: { ...req.body, file: undefined }, after: res }),
    })
    createRemesa(@Body() dto: CreateRemesaDto, @UploadedFile() file: any) {
        return this.service.createRemesa(dto, file);
    }

    @Get('remesas/empresa/:empresaId')
    listRemesas(
        @Param('empresaId', ParseIntPipe) empresaId: number,
        @Query('categoria') categoria?: string,
    ) {
        return this.service.listRemesas(empresaId, categoria);
    }

    @Post('validar/:id')
    @Permisos('importacion.ejecutar')
    @Audit({
        modulo: AuditModulo.IMPORT,
        entidad: 'Remesa',
        tipo: 'VALIDAR',
        entidadIdParam: 'id',
        resumen: (res, req) => `Validó remesa ${req.params.id}`,
    })
    validate(@Param('id', ParseIntPipe) id: number) {
        return this.service.validateRemesa(id);
    }

    @Post('ejecutar/:id')
    @Permisos('importacion.ejecutar')
    @Audit({
        modulo: AuditModulo.IMPORT,
        entidad: 'Remesa',
        tipo: AuditTipo.IMPORT_START,
        entidadIdParam: 'id',
        resumen: (res, req) => `Inició ejecución remesa ${req.params.id}`,
        data: (res, req) => ({ params: req.body }),
    })
    run(
        @Param('id', ParseIntPipe) id: number,
        @UsuarioActual() user: UsuarioJwt,
        @Body('remesaOrigenId') remesaOrigenId?: number,
    ) {
        return this.service.executeRemesa(id, user.sub, remesaOrigenId ? Number(remesaOrigenId) : undefined);
    }

    @Get('en-curso')
    @Permisos('importacion.ver_historial')
    getEnCurso(@UsuarioActual() user: UsuarioJwt) {
        return this.service.listarEnCurso(user);
    }

    @Get('remesas/:id')
    status(@Param('id', ParseIntPipe) id: number) {
        return this.service.status(id);
    }

    // --- ERRORES ---
    @Get('errores/:remesaId')
    getErrors(
        @Param('remesaId', ParseIntPipe) remesaId: number,
        @Query('page') page?: string,
        @Query('pageSize') pageSize?: string,
    ) {
        return this.service.getErrors(
            remesaId,
            page ? parseInt(page, 10) : 1,
            pageSize ? parseInt(pageSize, 10) : 50,
        );
    }

    // --- POLÍTICA ---
    @Put('remesas/:id/politica')
    @Audit({
        modulo: AuditModulo.IMPORT,
        entidad: 'Remesa',
        tipo: AuditTipo.UPDATE,
        entidadIdParam: 'id',
        resumen: (res, req) => `Cambió política de remesa ${req.params.id}`,
        data: (res, req) => ({ params: req.body }),
    })
    updatePolitica(
        @Param('id', ParseIntPipe) id: number,
        @Body('politicaId') politicaId: number | null,
    ) {
        return this.service.updatePolitica(id, politicaId);
    }

    // --- ELIMINAR REMESA ---
    @Delete('remesas/:id')
    @Permisos('importacion.eliminar')
    @Audit({
        modulo: AuditModulo.IMPORT,
        entidad: 'Remesa',
        tipo: AuditTipo.DELETE,
        entidadIdParam: 'id',
        resumen: (res, req) => `Eliminó remesa ${req.params.id}`,
    })
    deleteRemesa(
        @Param('id', ParseIntPipe) id: number,
        @UsuarioActual() user: UsuarioJwt,
    ) {
        return this.service.deleteRemesa(id, { sub: user.sub, permisos: user.permisos });
    }
}
