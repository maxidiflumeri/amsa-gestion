import { BadRequestException, Controller, ForbiddenException, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { FormatoExport, TransaccionesService } from './transacciones.service';
import { QueryTransaccionesDto } from './dtos/query-transacciones.dto';
import { Permisos } from '../../auth/decorators';

@Controller('transacciones')
@Permisos('auditoria.ver')
export class TransaccionesController {
    constructor(private readonly service: TransaccionesService) { }

    @Get()
    findAll(@Query() query: QueryTransaccionesDto, @Req() req: any) {
        const usuario = req['usuario'];
        const permisos: string[] = Array.isArray(usuario?.permisos) ? usuario.permisos : [];
        const verTodos = permisos.includes('auditoria.ver_todos');
        const restrictUsuarioId = verTodos ? null : (usuario?.sub ?? null);
        return this.service.findAll(query, restrictUsuarioId);
    }

    @Get('stats')
    stats(@Query() query: QueryTransaccionesDto, @Req() req: any) {
        const usuario = req['usuario'];
        const permisos: string[] = Array.isArray(usuario?.permisos) ? usuario.permisos : [];
        const verTodos = permisos.includes('auditoria.ver_todos');
        const restrictUsuarioId = verTodos ? null : (usuario?.sub ?? null);
        return this.service.stats(query, restrictUsuarioId);
    }

    @Post('export')
    async exportar(
        @Query() query: QueryTransaccionesDto & { formato?: FormatoExport },
        @Req() req: any,
        @Res() res: Response,
    ) {
        const usuario = req['usuario'];
        const permisos: string[] = Array.isArray(usuario?.permisos) ? usuario.permisos : [];
        if (!permisos.includes('auditoria.exportar')) {
            throw new ForbiddenException('Falta permiso auditoria.exportar');
        }
        const formato = (query.formato ?? 'xlsx') as FormatoExport;
        if (!['xlsx', 'csv', 'pdf'].includes(formato)) {
            throw new BadRequestException('Formato inválido');
        }
        const verTodos = permisos.includes('auditoria.ver_todos');
        const restrictUsuarioId = verTodos ? null : (usuario?.sub ?? null);

        const { buffer, mimeType, filename } = await this.service.exportar(query, formato, restrictUsuarioId);
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.service.findOne(+id);
    }
}
