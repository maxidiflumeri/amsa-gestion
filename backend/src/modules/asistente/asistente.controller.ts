import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, Res, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { Permisos, UsuarioActual } from '../../auth/decorators';
import { AsistenteService } from './asistente.service';
import type { UsuarioJwt } from './asistente.service';
import { ConversacionesService } from './conversaciones.service';
import { AccionDto } from './dto/accion.dto';
import { CalificarDto } from './dto/calificar.dto';
import { ConversacionesQueryDto, EstadoQueryDto } from './dto/conversaciones-query.dto';
import { ConversacionDetalle, ConversacionResumen, EstadoAsistente, EventoSse } from './dto/asistente.tipos';
import { PreguntarDto } from './dto/preguntar.dto';
import { TopesService } from './topes.service';

/** Cada cuánto se manda `: ping` para que el ALB (60 s sin bytes) no corte un turno largo. */
export const PING_SSE_MS = 15_000;

function usuarioValido(u: UsuarioJwt | undefined): UsuarioJwt {
    if (!u?.sub) throw new UnauthorizedException('Sesión inválida');
    return u;
}

@Controller('asistente')
export class AsistenteController {
    constructor(
        private readonly servicio: AsistenteService,
        private readonly conversaciones: ConversacionesService,
        private readonly topes: TopesService,
    ) {}

    /**
     * Sin `@Audit` ni retorno: la respuesta es un stream SSE que escribe este método (`@Res()`). Los errores previos al
     * stream (validación, 404, 409, 429, 503) salen como JSON normal, porque todavía no se escribió nada.
     */
    @Post('preguntar')
    @Permisos('asistente.usar')
    async preguntar(@Body() dto: PreguntarDto, @UsuarioActual() u: UsuarioJwt, @Res() res: Response): Promise<void> {
        const turno = await this.servicio.preparar(usuarioValido(u), dto);

        res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
        res.flushHeaders();

        const abierta = () => !res.writableEnded && !res.destroyed;
        const escribir = (e: EventoSse) => {
            if (abierta()) res.write(`event: ${e.evento}\ndata: ${JSON.stringify(e.data)}\n\n`);
        };
        const ping = setInterval(() => {
            if (abierta()) res.write(': ping\n\n');
        }, PING_SSE_MS);

        // Cerrar el fetch corta el stream de Bedrock: deja de gastar. Se escucha la respuesta (no el request, que en
        // Node ≥ 16 emite `close` al terminar de leer el cuerpo).
        res.on('close', () => {
            if (!res.writableEnded) turno.abortar();
        });
        if (res.destroyed) turno.abortar();

        escribir({ evento: 'inicio', data: turno.inicio });
        try {
            await turno.correr(escribir);
        } finally {
            clearInterval(ping);
            if (!res.writableEnded) res.end();
        }
    }

    @Get('estado')
    @Permisos('asistente.usar')
    estado(@UsuarioActual() u: UsuarioJwt, @Query() q: EstadoQueryDto): Promise<EstadoAsistente> {
        return this.topes.estado(usuarioValido(u).sub, q.funcion ?? 'ayuda');
    }

    @Get('conversaciones')
    @Permisos('asistente.usar')
    listar(@UsuarioActual() u: UsuarioJwt, @Query() q: ConversacionesQueryDto): Promise<ConversacionResumen[]> {
        return this.conversaciones.listar(usuarioValido(u).sub, q.limite ?? 20, q.funcion);
    }

    @Get('conversaciones/:id')
    @Permisos('asistente.usar')
    detalle(@UsuarioActual() u: UsuarioJwt, @Param('id', ParseIntPipe) id: number): Promise<ConversacionDetalle> {
        return this.conversaciones.detalle(usuarioValido(u).sub, id);
    }

    @Post('mensajes/:id/calificacion')
    @Permisos('asistente.usar')
    @HttpCode(204)
    async calificar(
        @UsuarioActual() u: UsuarioJwt,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: CalificarDto,
    ): Promise<void> {
        await this.conversaciones.calificar(usuarioValido(u).sub, id, dto.valor, dto.comentario);
    }

    @Post('mensajes/:id/accion')
    @Permisos('asistente.usar')
    @HttpCode(204)
    async accion(
        @UsuarioActual() u: UsuarioJwt,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: AccionDto,
    ): Promise<void> {
        await this.conversaciones.registrarAccion(usuarioValido(u).sub, id, dto.accionId, dto.resultado);
    }
}
