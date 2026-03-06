// src/import/import.controller.ts
import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImportService } from './imports.service';
import { CreatePlantillaDto, CreateRemesaDto } from './dtos/import.dto';

@Controller('import')
export class ImportController {
    constructor(private readonly service: ImportService) { }

    // --- CATEGORÍAS ---
    @Get('categorias')
    getCategories() {
        return this.service.getCategories();
    }

    // --- PLANTILLAS ---
    @Post('plantillas')
    createPlantilla(@Body() dto: CreatePlantillaDto) {
        return this.service.createPlantilla(dto);
    }

    @Get('plantillas/:empresaId/:categoria')
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
    validate(@Param('id', ParseIntPipe) id: number) {
        return this.service.validateRemesa(id);
    }

    @Post('ejecutar/:id')
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
}