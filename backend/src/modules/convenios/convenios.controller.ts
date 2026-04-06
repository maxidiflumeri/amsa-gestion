import { Controller, Get, Post, Put, Body, Param, Query, ParseIntPipe } from '@nestjs/common';
import { ConveniosService } from './convenios.service';
import { CreateConvenioDto } from './dtos/create-convenio.dto';

@Controller('convenios')
export class ConveniosController {
  constructor(private readonly conveniosService: ConveniosService) {}

  @Get()
  findByDeudor(@Query('deudorId', ParseIntPipe) deudorId: number) {
    return this.conveniosService.findByDeudor(deudorId);
  }

  @Post()
  create(@Body() dto: CreateConvenioDto) {
    return this.conveniosService.create(dto);
  }

  @Put(':id/anular')
  anular(@Param('id', ParseIntPipe) id: number) {
    return this.conveniosService.anularConvenio(id);
  }

  @Put('cuotas/:cuotaId/pagar')
  marcarPagada(
    @Param('cuotaId', ParseIntPipe) cuotaId: number,
    @Body() body: { fecha: string; importe: number; observacion?: string },
  ) {
    return this.conveniosService.marcarCuotaPagada(cuotaId, body);
  }
}
