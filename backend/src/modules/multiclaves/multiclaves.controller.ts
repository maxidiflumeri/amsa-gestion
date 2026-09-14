import { Controller, DefaultValuePipe, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { Permisos } from '../../auth/decorators';
import { ClavesService } from './claves.service';

/**
 * Endpoints de MULTICLAVES. Fase 1: solo el resumen y la lista de sin-caso de una carga (§5.7,
 * §9.3 del spec). Las claves del caso, el cupón y la config de empresa llegan en las fases 2-3.
 */
@Controller('multiclaves')
export class MulticlavesController {
    constructor(private readonly claves: ClavesService) { }

    @Get('lotes/:remesaId/resumen')
    @Permisos('importacion.ver_historial')
    resumenLote(@Param('remesaId', ParseIntPipe) remesaId: number) {
        return this.claves.resumenLote(remesaId);
    }

    @Get('lotes/:remesaId/sin-caso')
    @Permisos('importacion.ver_historial')
    sinCaso(
        @Param('remesaId', ParseIntPipe) remesaId: number,
        @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
        @Query('pageSize', new DefaultValuePipe(50), ParseIntPipe) pageSize: number,
    ) {
        // El acotado de page/pageSize (1..200) vive en el servicio: es la misma regla para acá y
        // para cualquier otro llamador (scripts, tests) que no pase por este controller.
        return this.claves.sinCaso(remesaId, page, pageSize);
    }
}
