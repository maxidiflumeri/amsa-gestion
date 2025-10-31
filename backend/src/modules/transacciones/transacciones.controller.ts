// src/transacciones/transacciones.controller.ts
import { Controller, Get, Query } from '@nestjs/common';
import { TransaccionesService } from './transacciones.service';
import { QueryTransaccionesDto } from './dtos/query-transacciones.dto';

@Controller('transacciones')
export class TransaccionesController {
    constructor(private readonly service: TransaccionesService) { }

    @Get()
    findAll(@Query() query: QueryTransaccionesDto) {
        return this.service.findAll(query);
    }
}