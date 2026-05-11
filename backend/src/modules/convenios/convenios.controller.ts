import { Controller, Get, Post, Put, Body, Param, Query, ParseIntPipe } from '@nestjs/common';
import { ConveniosService } from './convenios.service';
import { CreateConvenioDto } from './dtos/create-convenio.dto';
import { Permisos } from '../../auth/decorators';

@Controller('convenios')
@Permisos('convenios.ver')
export class ConveniosController {
  constructor(private readonly conveniosService: ConveniosService) {}

  @Get()
  findByDeudor(@Query('deudorId', ParseIntPipe) deudorId: number) {
    return this.conveniosService.findByDeudor(deudorId);
  }

  @Post()
  @Permisos('convenios.crear')
  create(@Body() dto: CreateConvenioDto) {
    return this.conveniosService.create(dto);
  }

  @Put(':id/anular')
  @Permisos('convenios.cancelar')
  anular(@Param('id', ParseIntPipe) id: number) {
    return this.conveniosService.anularConvenio(id);
  }

  @Put('cuotas/:cuotaId/pagar')
  @Permisos('convenios.registrar_pago')
  marcarPagada(
    @Param('cuotaId', ParseIntPipe) cuotaId: number,
    @Body() body: { fecha: string; importe: number; observacion?: string },
  ) {
    return this.conveniosService.marcarCuotaPagada(cuotaId, body);
  }
}
