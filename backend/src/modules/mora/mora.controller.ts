/**
 * MoraController
 *
 * Endpoints del recargo por mora, bajo /api/mora (el prefijo /api viene de main.ts).
 *
 *   GET  /mora/tasas?empresaId=       → tasas cargadas por mes y si el índice está completo
 *   GET  /mora/tasas/faltantes?...    → meses sin índice completo hasta el mes corriente
 *   POST /mora/tasas                  → carga la tasa del mes y genera el índice
 *   GET  /mora/deudor/:id?fecha=      → deuda actualizada con el detalle por factura
 *   POST /mora/recalcular             → recalcula y persiste el recargo de toda una empresa
 *
 * Auth: JWT global. Permisos finos: 'mora.ver', 'mora.gestionar_tasas', 'mora.recalcular'.
 */
import {
    Body,
    Controller,
    Get,
    Logger,
    Param,
    ParseIntPipe,
    Post,
    Query,
} from '@nestjs/common';
import { Permisos, UsuarioActual } from '../../auth/decorators';
import { MoraService } from './mora.service';
import { CargarTasaDto } from './dto/cargar-tasa.dto';
import { RecalcularMoraDto } from './dto/recalcular-mora.dto';

@Controller('mora')
export class MoraController {
    private readonly logger = new Logger(MoraController.name);

    constructor(private readonly mora: MoraService) {}

    @Get('tasas')
    @Permisos('mora.ver')
    async tasas(
        @Query('empresaId', ParseIntPipe) empresaId: number,
        @Query('meses') meses?: string,
    ) {
        const n = meses ? parseInt(meses, 10) : 24;
        return this.mora.estadoTasas(empresaId, Number.isFinite(n) && n > 0 ? n : 24);
    }

    /**
     * Estado de la cadena antes de cargar una tasa: si arrancaría la cadena, si hay un hueco, y qué
     * meses se van a regenerar. La pantalla lo usa para preguntar lo que corresponda antes de mandar.
     */
    @Get('tasas/previo')
    @Permisos('mora.ver')
    async previo(
        @Query('empresaId', ParseIntPipe) empresaId: number,
        @Query('periodo') periodo: string,
    ) {
        return this.mora.preverGeneracion(empresaId, periodo);
    }

    @Get('tasas/faltantes')
    @Permisos('mora.ver')
    async faltantes(@Query('empresaId', ParseIntPipe) empresaId: number) {
        const periodos = await this.mora.mesesFaltantes(empresaId);
        return { empresaId, faltantes: periodos, cantidad: periodos.length };
    }

    /**
     * Carga la tasa del mes y genera el índice de los tres tipos.
     * Si ya había meses posteriores generados, los regenera: la cadena es acumulativa.
     */
    @Post('tasas')
    @Permisos('mora.gestionar_tasas')
    async cargarTasa(@Body() dto: CargarTasaDto, @UsuarioActual() usuario: { sub: number }) {
        this.logger.log(
            `Carga de tasa intent empresaId=${dto.empresaId} periodo=${dto.periodo} ` +
            `tasaBase=${dto.tasaBase} usuarioId=${usuario?.sub}`,
        );
        return this.mora.generarMes(dto.empresaId, dto.periodo, dto.tasaBase, {
            usuarioId: usuario?.sub,
            fuente: dto.fuente,
            observacion: dto.observacion,
            permitirInicioDeCadena: dto.permitirInicioDeCadena,
            permitirPisarMigrado: dto.permitirPisarMigrado,
        });
    }

    /** Deuda actualizada de un caso, con el desglose por factura que muestra la ficha. */
    @Get('deudor/:id')
    @Permisos('mora.ver')
    async deudor(
        @Param('id', ParseIntPipe) id: number,
        @Query('fecha') fecha?: string,
    ) {
        const f = fecha ? new Date(`${fecha}T00:00:00.000Z`) : undefined;
        return this.mora.calcularDeudor(id, f && !isNaN(f.getTime()) ? f : undefined);
    }

    @Post('recalcular')
    @Permisos('mora.recalcular')
    async recalcular(@Body() dto: RecalcularMoraDto, @UsuarioActual() usuario: { sub: number }) {
        this.logger.log(
            `Recálculo de mora intent empresaId=${dto.empresaId} fecha=${dto.fecha ?? 'hoy'} ` +
            `dryRun=${dto.dryRun ?? false} usuarioId=${usuario?.sub}`,
        );
        const fecha = dto.fecha ? new Date(`${dto.fecha}T00:00:00.000Z`) : undefined;
        return this.mora.recalcularCartera(dto.empresaId, {
            fecha: fecha && !isNaN(fecha.getTime()) ? fecha : undefined,
            dryRun: dto.dryRun,
        });
    }
}
