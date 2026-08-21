import { Controller, Get, Post, Patch, Body, Param, Query, ParseIntPipe } from '@nestjs/common';
import { PromesasService } from './promesas.service';
import { CreatePromesaDto } from './dtos/create-promesa.dto';
import { Permisos, UsuarioActual } from '../../auth/decorators';
import { Audit } from '../transacciones/audit.decorator';
import { AuditModulo, AuditTipo } from '../transacciones/audit.enums';

@Controller('promesas')
@Permisos('promesas.ver')
export class PromesasController {
    constructor(private readonly promesas: PromesasService) {}

    @Get()
    findByDeudor(@Query('deudorId', ParseIntPipe) deudorId: number) {
        return this.promesas.findByDeudor(deudorId);
    }

    @Post()
    @Permisos('promesas.crear')
    @Audit({
        modulo: AuditModulo.GESTION,
        entidad: 'PromesaPago',
        tipo: AuditTipo.CREATE,
        entidadIdFromResponse: 'id',
        resumen: (_res, req) => `Cargó promesa de pago para deudor ${req.body?.deudorId}`,
        data: (res, req) => ({ params: req.body, after: res }),
    })
    crear(@Body() dto: CreatePromesaDto, @UsuarioActual() usuario: { sub: number }) {
        return this.promesas.crear(dto, usuario?.sub);
    }

    @Patch(':id/anular')
    @Permisos('promesas.cancelar')
    @Audit({
        modulo: AuditModulo.GESTION,
        entidad: 'PromesaPago',
        tipo: AuditTipo.ANULAR,
        entidadIdParam: 'id',
        resumen: (_res, req) => `Anuló promesa de pago ${req.params.id}`,
    })
    anular(@Param('id', ParseIntPipe) id: number, @UsuarioActual() usuario: { sub: number }) {
        return this.promesas.anular(id, usuario?.sub);
    }

    @Post('procesar-vencidas')
    @Permisos('promesas.procesar_vencidas')
    @Audit({
        modulo: AuditModulo.GESTION,
        entidad: 'PromesaPago',
        tipo: AuditTipo.EJECUTAR,
        resumen: () => 'Procesó promesas de pago vencidas (manual)',
        data: (res) => ({ after: res }),
    })
    procesarVencidas() {
        return this.promesas.procesarVencidas();
    }
}
