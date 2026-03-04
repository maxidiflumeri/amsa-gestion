// src/import/import.controller.ts
import { Body, Controller, Get, Param, ParseIntPipe, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImportService } from './imports.service';
import { CreatePlantillaDto, CreateRemesaDto } from './dtos/import.dto';

@Controller('import')
export class ImportController {
    constructor(private readonly service: ImportService) { }

    // PLANTILLAS
    @Post('plantillas')
    createPlantilla(@Body() dto: CreatePlantillaDto) {
        return this.service.createPlantilla(dto);
    }

    @Get('plantillas/:empresaId/:categoria')
    listPlantillas(@Param('empresaId', ParseIntPipe) empresaId: number, @Param('categoria') categoria: string) {
        return this.service.listPlantillas(empresaId, categoria);
    }

    // REMESAS
    @Post('remesas')
    @UseInterceptors(FileInterceptor('file'))
    createRemesa(@Body() dto: CreateRemesaDto, @UploadedFile() file: any) {        
        return this.service.createRemesa(dto, file);
    }

    @Post('validar/:id')
    validate(@Param('id', ParseIntPipe) id: number) {
        return this.service.validateRemesa(id);
    }

    @Post('ejecutar/:id')
    run(@Param('id', ParseIntPipe) id: number) {
        return this.service.executeRemesa(id);
    }

    @Get('remesas/:id')
    status(@Param('id', ParseIntPipe) id: number) {
        return this.service.status(id);
    }
}