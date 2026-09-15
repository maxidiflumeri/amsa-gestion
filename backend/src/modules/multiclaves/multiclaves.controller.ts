import { Body, Controller, DefaultValuePipe, Get, Param, ParseIntPipe, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Permisos, UsuarioActual } from '../../auth/decorators';
import { Audit } from '../transacciones/audit.decorator';
import { AuditModulo } from '../transacciones/audit.enums';
import { ClavesService } from './claves.service';
import { CuponService } from './cupon.service';
import type { UsuarioJwt } from './cupon.service';
import { GenerarCuponDto } from './dto/generar-cupon.dto';

/**
 * Endpoints de MULTICLAVES. Fase 1: resumen y sin-caso de una carga (§5.7, §9.3). Fase 2: claves
 * del caso para la ficha (§9.1) y el cupón (preview, generar, reimprimir — §9.2). La config de
 * empresa (§9.4) llega en la fase 3, junto con el envío por mail.
 */
@Controller('multiclaves')
export class MulticlavesController {
    constructor(
        private readonly claves: ClavesService,
        private readonly cupon: CuponService,
    ) { }

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

    @Get('deudores/:deudorId/claves')
    @Permisos('convenios.ver')
    clavesDelCaso(
        @Param('deudorId', ParseIntPipe) deudorId: number,
        @Query('incluirReemplazadas') incluirReemplazadas?: string,
    ) {
        return this.claves.clavesDelCaso(deudorId, incluirReemplazadas === 'true');
    }

    @Get('claves/:claveId/cupon/preview')
    @Permisos('convenios.generar_cupon')
    preview(
        @Param('claveId', ParseIntPipe) claveId: number,
        @Query('deudorId', ParseIntPipe) deudorId: number,
    ) {
        return this.cupon.preview(claveId, deudorId);
    }

    @Get('claves/:claveId/cupon/preview.pdf')
    @Permisos('convenios.generar_cupon')
    async previewPdf(
        @Param('claveId', ParseIntPipe) claveId: number,
        @Query('deudorId', ParseIntPipe) deudorId: number,
        @Res() res: Response,
    ): Promise<void> {
        const buffer = await this.cupon.previewPdf(claveId, deudorId);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename="cupon-vista-previa.pdf"');
        res.send(buffer);
    }

    @Post('claves/:claveId/cupon')
    @Permisos('convenios.generar_cupon')
    @Audit({
        modulo: AuditModulo.GESTION,
        entidad: 'Convenio',
        tipo: 'CUPON_GENERADO',
        entidadIdFromResponse: 'convenioId',
        resumen: (res, req) =>
            `Generó cupón de la clave ${req.params.claveId} para el deudor ${req.body?.deudorId}` +
            (res?.convenioReusado ? ' (reusado)' : '') +
            (res?.convenioAnuladoId ? ` — anuló convenio ${res.convenioAnuladoId}` : ''),
        data: (res, req) => ({ params: { claveId: req.params.claveId, ...req.body }, after: res }),
    })
    generar(
        @Param('claveId', ParseIntPipe) claveId: number,
        @Body() dto: GenerarCuponDto,
        @UsuarioActual() usuario: UsuarioJwt,
    ) {
        return this.cupon.generar(claveId, dto, usuario);
    }

    @Get('convenios/:convenioId/cupon.pdf')
    @Permisos('convenios.generar_cupon')
    async reimprimir(@Param('convenioId', ParseIntPipe) convenioId: number, @Res() res: Response): Promise<void> {
        const { buffer, nroTramite, tipo } = await this.cupon.obtenerPdfDeConvenio(convenioId);
        const filename = `cupon-${nroTramite}-${tipo.toLowerCase()}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
    }
}
