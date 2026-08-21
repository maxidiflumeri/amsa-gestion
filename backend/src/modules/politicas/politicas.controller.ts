import { Controller, Get, Post, Put, Delete, Body, Param, Query, ParseIntPipe } from '@nestjs/common';
import { PoliticasService } from './politicas.service';
import { CreatePoliticaDto } from './dtos/create-politica.dto';
import { UpdatePoliticaDto } from './dtos/update-politica.dto';
import { Permisos } from '../../auth/decorators';
import { Audit } from '../transacciones/audit.decorator';
import { AuditModulo, AuditTipo } from '../transacciones/audit.enums';

@Controller('politicas')
@Permisos('politicas.ver')
export class PoliticasController {
  constructor(private readonly politicasService: PoliticasService) {}

  /**
   * `empresaId` es opcional: sin él se listan las políticas de todas las empresas.
   *
   * El `ParseIntPipe` sin `{ optional: true }` rechazaba `undefined`, así que el `?` de la firma y el
   * `findAll(empresaId?)` del servicio —que soporta `where = {}`— eran inalcanzables: no había forma
   * de listar todas.
   */
  @Get()
  findAll(@Query('empresaId', new ParseIntPipe({ optional: true })) empresaId?: number) {
    return this.politicasService.findAll(empresaId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.politicasService.findOne(id);
  }

  @Post()
  @Permisos('politicas.crear')
  @Audit({
    modulo: AuditModulo.GESTION,
    entidad: 'Politica',
    tipo: AuditTipo.CREATE,
    entidadIdFromResponse: 'id',
    empresaId: (res) => res?.empresaId,
    resumen: (res) => `Creó política "${res?.nombre}"`,
    data: (res, req) => ({ params: req.body, after: res }),
  })
  create(@Body() dto: CreatePoliticaDto) {
    return this.politicasService.create(dto);
  }

  @Put(':id')
  @Permisos('politicas.editar')
  @Audit({
    modulo: AuditModulo.GESTION,
    entidad: 'Politica',
    tipo: AuditTipo.UPDATE,
    entidadIdParam: 'id',
    empresaId: (res) => res?.empresaId,
    resumen: (res, req) => `Actualizó política ${req.params.id}`,
    data: (res, req) => ({ params: req.body, after: res }),
  })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePoliticaDto) {
    return this.politicasService.update(id, dto);
  }

  @Delete(':id')
  @Permisos('politicas.eliminar')
  @Audit({
    modulo: AuditModulo.GESTION,
    entidad: 'Politica',
    tipo: AuditTipo.DELETE,
    entidadIdParam: 'id',
    resumen: (res, req) => `Eliminó política ${req.params.id}`,
  })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.politicasService.remove(id);
  }
}
