import { Controller, Get, Post, Put, Body, Param, Query, ParseIntPipe } from '@nestjs/common';
import { ConveniosService } from './convenios.service';
import { CreateConvenioDto } from './dtos/create-convenio.dto';
import { Permisos } from '../../auth/decorators';
import { Audit } from '../transacciones/audit.decorator';
import { AuditModulo, AuditTipo } from '../transacciones/audit.enums';

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
  @Audit({
    modulo: AuditModulo.GESTION,
    entidad: 'Convenio',
    tipo: AuditTipo.CREATE,
    entidadIdFromResponse: 'id',
    resumen: (res, req) => `Creó convenio para deudor ${req.body?.deudorId}`,
    data: (res, req) => ({ params: req.body, after: res }),
  })
  create(@Body() dto: CreateConvenioDto) {
    return this.conveniosService.create(dto);
  }

  @Put(':id/anular')
  @Permisos('convenios.cancelar')
  @Audit({
    modulo: AuditModulo.GESTION,
    entidad: 'Convenio',
    tipo: 'CANCELAR',
    entidadIdParam: 'id',
    resumen: (res, req) => `Anuló convenio ${req.params.id}`,
  })
  anular(@Param('id', ParseIntPipe) id: number) {
    return this.conveniosService.anularConvenio(id);
  }

  @Put('cuotas/:cuotaId/pagar')
  @Permisos('convenios.registrar_pago')
  @Audit({
    modulo: AuditModulo.GESTION,
    entidad: 'ConvenioCuota',
    tipo: 'PAGAR',
    entidadIdParam: 'cuotaId',
    resumen: (res, req) => `Registró pago cuota ${req.params.cuotaId} ($${req.body?.importe})`,
    data: (res, req) => ({ params: req.body, after: res }),
  })
  marcarPagada(
    @Param('cuotaId', ParseIntPipe) cuotaId: number,
    @Body() body: { fecha: string; importe: number; observacion?: string },
  ) {
    return this.conveniosService.marcarCuotaPagada(cuotaId, body);
  }
}
