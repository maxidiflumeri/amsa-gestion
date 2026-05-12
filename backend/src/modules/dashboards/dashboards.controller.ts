import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DashboardsService } from './dashboards.service';
import { DashboardsExportService } from './dashboards-export.service';
import { SnapshotDto } from './dtos/snapshot.dto';
import { ExportDashboardDto } from './dtos/export.dto';
import { DrillDownDto } from './dtos/drill-down.dto';
import { Permisos } from '../../auth/decorators';
import { Audit } from '../transacciones/audit.decorator';
import { AuditModulo, AuditTipo } from '../transacciones/audit.enums';

@Controller('dashboards')
@Permisos('dashboards.ver')
export class DashboardsController {
    constructor(
        private readonly service: DashboardsService,
        private readonly exportService: DashboardsExportService,
    ) { }

    private resolverRestrictEmpresaId(req: any): number | null {
        const usuario = req['usuario'];
        const permisos: string[] = Array.isArray(usuario?.permisos) ? usuario.permisos : [];
        const verTodas = permisos.includes('dashboards.ver_todas_empresas');
        return verTodas ? null : (usuario?.empresaId ?? null);
    }

    @Post('remesa/snapshot')
    @Audit({
        modulo: AuditModulo.DASHBOARDS,
        entidad: 'Tablero',
        tipo: AuditTipo.VER_TABLERO,
        empresaId: (_res, req) => req.body?.empresaId ?? null,
        resumen: (_res, req) => {
            const { empresaId, remesaId, desde, hasta } = req.body || {};
            const partes: string[] = [];
            if (empresaId) partes.push(`empresa ${empresaId}`);
            if (remesaId) partes.push(`remesa ${remesaId}`);
            if (desde && hasta) partes.push(`${desde}..${hasta}`);
            return `Vio tablero remesa ${partes.join(' / ')}`.trim();
        },
        data: (_res, req) => ({ params: req.body }),
    })
    async snapshot(@Body() dto: SnapshotDto, @Req() req: any) {
        const restrictEmpresaId = this.resolverRestrictEmpresaId(req);
        return this.service.snapshot(dto, restrictEmpresaId);
    }

    @Post('remesa/export')
    @Permisos('dashboards.exportar')
    @Audit({
        modulo: AuditModulo.DASHBOARDS,
        entidad: 'Tablero',
        tipo: AuditTipo.EXPORTAR_TABLERO,
        empresaId: (_res, req) => req.body?.empresaId ?? null,
        resumen: (_res, req) => {
            const { formato, empresaId, remesaId } = req.body || {};
            const partes: string[] = [];
            if (empresaId) partes.push(`empresa ${empresaId}`);
            if (remesaId) partes.push(`remesa ${remesaId}`);
            return `Exportó tablero (${formato}) ${partes.join(' / ')}`.trim();
        },
        data: (_res, req) => ({ params: req.body }),
    })
    async exportar(
        @Body() dto: ExportDashboardDto,
        @Req() req: any,
        @Res() res: Response,
    ): Promise<void> {
        const restrictEmpresaId = this.resolverRestrictEmpresaId(req);
        const snapshot = await this.service.snapshot(dto, restrictEmpresaId);
        const { buffer, mimeType, filename } = await this.exportService.generar(
            dto.formato,
            snapshot,
            dto.nombreTablero,
        );

        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', String(buffer.length));
        res.send(buffer);
    }

    @Post('remesa/drill-down/deudores')
    @Audit({
        modulo: AuditModulo.DASHBOARDS,
        entidad: 'Deudor',
        tipo: AuditTipo.VER_DETALLE,
        empresaId: (_res, req) => req.body?.empresaId ?? null,
        resumen: (_res, req) => {
            const { dimension, valor } = req.body || {};
            return `Drill-down tablero ${dimension}=${valor}`;
        },
        data: (_res, req) => ({ params: req.body }),
    })
    async drillDown(@Body() dto: DrillDownDto, @Req() req: any) {
        const restrictEmpresaId = this.resolverRestrictEmpresaId(req);
        return this.service.drillDown(dto, restrictEmpresaId);
    }
}
