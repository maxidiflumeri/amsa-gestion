import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Post,
    Put,
    Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Permisos, UsuarioActual } from '../../auth/decorators';
import { Audit } from '../transacciones/audit.decorator';
import { AuditModulo, AuditTipo } from '../transacciones/audit.enums';
import { SesionAgenteService } from './sesion-agente.service';
import { EstadoAgenteService } from './estado-agente.service';
import { CampañaAgenteService } from './campaña-agente.service';
import { SetEstadoDto, AsignarCampañaDto } from './dto/neotel-api.dto';

@Controller('neotel')
export class NeotelSesionController {
    constructor(
        private readonly sesionSvc:  SesionAgenteService,
        private readonly estadoSvc:  EstadoAgenteService,
        private readonly campaniaSvc: CampañaAgenteService,
    ) {}

    // ─── Sesión ───────────────────────────────────────────────────────────────

    /**
     * POST /neotel/sesion/login
     * Inicia la sesión del agente en Neotel.
     * Si Neotel responde con error de negocio (ej. "Position Externo6001 not found"),
     * el error burbujea como 502 ServiceUnavailableException.
     */
    @Post('sesion/login')
    @HttpCode(HttpStatus.OK)
    @Permisos('telefonia.usar')
    @Audit({
        modulo:                AuditModulo.TELEFONIA,
        entidad:               'SesionAgenteNeotel',
        tipo:                  AuditTipo.TEL_LOGIN,
        entidadIdFromResponse: 'sesionId',
        resumen:               (res) => `Login Neotel: extensión=${res?.device}`,
    })
    login(
        @UsuarioActual() usuario: { sub: number },
        @Req() req: Request,
    ) {
        return this.sesionSvc.loginAgente(usuario.sub, {
            ip:        req.ip,
            userAgent: req.headers['user-agent'],
        });
    }

    /**
     * POST /neotel/sesion/logout
     * Cierra la sesión del agente en Neotel y libera la caché Redis.
     */
    @Post('sesion/logout')
    @HttpCode(HttpStatus.OK)
    @Permisos('telefonia.usar')
    @Audit({
        modulo:  AuditModulo.TELEFONIA,
        entidad: 'SesionAgenteNeotel',
        tipo:    AuditTipo.TEL_LOGOUT,
        resumen: () => 'Logout Neotel',
    })
    logout(@UsuarioActual() usuario: { sub: number }) {
        return this.sesionSvc.logoutAgente(usuario.sub);
    }

    /**
     * GET /neotel/sesion/actual
     * Devuelve la sesión activa del agente (desde Redis con fallback a DB).
     * Retorna null si no hay sesión activa.
     */
    @Get('sesion/actual')
    @Permisos('telefonia.usar')
    getSesionActual(@UsuarioActual() usuario: { sub: number }) {
        return this.sesionSvc.getSesionActiva(usuario.sub);
    }

    // ─── Estado ───────────────────────────────────────────────────────────────

    /**
     * PUT /neotel/estado
     * Cambia el estado del agente (DISPONIBLE, EN_PAUSA, ADMINISTRATIVO).
     * Para EN_PAUSA es obligatorio enviar motivoPausaId.
     */
    @Put('estado')
    @HttpCode(HttpStatus.OK)
    @Permisos('telefonia.usar')
    @Audit({
        modulo:  AuditModulo.TELEFONIA,
        entidad: 'EstadoAgenteEvento',
        tipo:    AuditTipo.TEL_ESTADO_CAMBIAR,
        resumen: (res) => `Estado cambiado a ${res?.estado}`,
    })
    setEstado(
        @UsuarioActual() usuario: { sub: number },
        @Body() dto: SetEstadoDto,
    ) {
        return this.estadoSvc.setEstado(usuario.sub, dto.estado, dto.motivoPausaId);
    }

    /**
     * GET /neotel/estado/actual
     * Devuelve el estado actual del agente (desde Redis con fallback a DB).
     */
    @Get('estado/actual')
    @Permisos('telefonia.usar')
    getEstadoActual(@UsuarioActual() usuario: { sub: number }) {
        return this.estadoSvc.getEstadoActual(usuario.sub);
    }

    /**
     * GET /neotel/motivos-pausa
     * Devuelve los motivos de pausa activos configurados por el admin.
     */
    @Get('motivos-pausa')
    @Permisos('telefonia.usar')
    listarMotivosPausa() {
        return this.estadoSvc.listarMotivosPausa();
    }

    // ─── Campañas ─────────────────────────────────────────────────────────────

    /**
     * GET /neotel/campanias
     * Lista las campanias activas disponibles.
     */
    @Get('campanias')
    @Permisos('telefonia.usar')
    listarCampañas() {
        return this.campaniaSvc.listarCampañasDisponibles();
    }

    /**
     * POST /neotel/campania/asignar
     * Asigna el agente a una campania Neotel y registra la entrada.
     */
    @Post('campania/asignar')
    @HttpCode(HttpStatus.OK)
    @Permisos('telefonia.usar')
    @Audit({
        modulo:  AuditModulo.TELEFONIA,
        entidad: 'CampaniaSesionNeotel',
        tipo:    AuditTipo.TEL_CAMPAÑA_ENTER,
        resumen: (res) => `Campaña asignada: ${res?.campañaActiva?.nombre}`,
    })
    asignarCampaña(
        @UsuarioActual() usuario: { sub: number },
        @Body() dto: AsignarCampañaDto,
    ) {
        return this.campaniaSvc.asignarCampaña(usuario.sub, dto.campañaNeotelId);
    }

    /**
     * POST /neotel/campania/desasignar
     * Desasigna el agente de la campania activa.
     */
    @Post('campania/desasignar')
    @HttpCode(HttpStatus.OK)
    @Permisos('telefonia.usar')
    @Audit({
        modulo:  AuditModulo.TELEFONIA,
        entidad: 'CampaniaSesionNeotel',
        tipo:    AuditTipo.TEL_CAMPAÑA_LEAVE,
        resumen: () => 'Campaña desasignada',
    })
    desasignarCampaña(@UsuarioActual() usuario: { sub: number }) {
        return this.campaniaSvc.desasignarCampaña(usuario.sub);
    }
}
