// src/import/import.controller.ts
import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImportService } from './imports.service';
import { CreatePlantillaDto, CreateRemesaDto } from './dtos/import.dto';
import { Permisos } from '../../auth/decorators';

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
    updatePlantilla(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: Partial<CreatePlantillaDto>,
    ) {
        return this.service.updatePlantilla(id, dto);
    }

    @Post('plantillas/:id/delete')
    deletePlantilla(@Param('id', ParseIntPipe) id: number) {
        return this.service.deletePlantilla(id);
    }

    // --- REMESAS ---
    @Post('remesas')
    @UseInterceptors(FileInterceptor('file'))
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
    validate(@Param('id', ParseIntPipe) id: number) {
        return this.service.validateRemesa(id);
    }

    @Post('ejecutar/:id')
    @Permisos('importacion.ejecutar')
    run(
        @Param('id', ParseIntPipe) id: number,
        @Body('remesaOrigenId') remesaOrigenId?: number,
    ) {
        return this.service.executeRemesa(id, remesaOrigenId ? Number(remesaOrigenId) : undefined);
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
    updatePolitica(
        @Param('id', ParseIntPipe) id: number,
        @Body('politicaId') politicaId: number | null,
    ) {
        return this.service.updatePolitica(id, politicaId);
    }
}