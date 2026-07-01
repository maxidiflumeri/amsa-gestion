import { Controller, Get, Post, Delete, Body, Param, Query, ParseIntPipe } from '@nestjs/common';
import { PagosService } from './pagos.service';
import { CreatePagoDto } from './dtos/create-pago.dto';
import { Permisos, UsuarioActual } from '../../auth/decorators';
import { Audit } from '../transacciones/audit.decorator';
import { AuditModulo, AuditTipo } from '../transacciones/audit.enums';

@Controller('pagos')
@Permisos('pagos.ver')
export class PagosController {
    constructor(private readonly pagos: PagosService) {}

    @Get()
    findByDeudor(@Query('deudorId', ParseIntPipe) deudorId: number) {
        return this.pagos.findByDeudor(deudorId);
    }

    @Post()
    @Permisos('pagos.crear')
    @Audit({
        modulo: AuditModulo.GESTION,
        entidad: 'Pago',
        tipo: AuditTipo.CREATE,
        entidadIdFromResponse: 'id',
        resumen: (_res, req) => `Cargó pago manual ($${req.body?.importe}) para deudor ${req.body?.deudorId}`,
        data: (res, req) => ({ params: req.body, after: res }),
    })
    crear(@Body() dto: CreatePagoDto, @UsuarioActual() usuario: { sub: number }) {
        return this.pagos.crearManual(dto, usuario?.sub);
    }

    @Delete(':id')
    @Permisos('pagos.eliminar')
    @Audit({
        modulo: AuditModulo.GESTION,
        entidad: 'Pago',
        tipo: AuditTipo.DELETE,
        entidadIdParam: 'id',
        resumen: (_res, req) => `Eliminó pago ${req.params.id}`,
    })
    eliminar(@Param('id', ParseIntPipe) id: number, @UsuarioActual() usuario: { sub: number }) {
        return this.pagos.eliminar(id, usuario?.sub);
    }
}
