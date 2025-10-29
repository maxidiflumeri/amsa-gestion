import { Controller, Get, Query } from '@nestjs/common';
import { ParametrosService } from './parametros.service';

@Controller('parametros')
export class ParametrosController {
    constructor(private readonly parametrosService: ParametrosService) { }

    @Get()
    getByGrupo(@Query('grupo') grupo: string) {
        return this.parametrosService.findByGrupo(grupo);
    }
}