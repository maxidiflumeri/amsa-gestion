import {
    Controller,
    Get,
} from '@nestjs/common';
import { Permisos, UsuarioActual } from '../../auth/decorators';
import { Audit } from '../transacciones/audit.decorator';
import { AuditModulo, AuditTipo } from '../transacciones/audit.enums';
import { AgenteTelefoniaService } from './agente-telefonia.service';

// ─── /neotel/sip-credentials ─────────────────────────────────────────────────

@Controller('neotel')
export class NeotelController {
    constructor(private readonly agenteSvc: AgenteTelefoniaService) {}

    /**
     * GET /neotel/sip-credentials
     * Devuelve las credenciales SIP descifradas para el agente del usuario logueado.
     * Solo se llama cuando el usuario presiona "Conectar" en el softphone.
     */
    @Get('sip-credentials')
    @Permisos('telefonia.usar')
    @Audit({
        modulo:   AuditModulo.TELEFONIA,
        entidad:  'AgenteTelefonia',
        tipo:     AuditTipo.TEL_SIP_CREDENTIALS_OBTENIDAS,
        resumen:  () => 'Credenciales SIP obtenidas',
    })
    getSipCredentials(@UsuarioActual() usuario: { sub: number }) {
        return this.agenteSvc.getCredencialesParaUsuario(usuario.sub);
    }
}

// ─── /admin/neotel/agentes ────────────────────────────────────────────────────
// ABM de agentes movido al módulo de Usuarios (PATCH /usuarios/:id con esAgente + agente config).
// Se conserva solo el GET para debug/listado. POST, PATCH y DELETE fueron removidos.

@Controller('admin/neotel/agentes')
export class NeotelAdminController {
    constructor(private readonly agenteSvc: AgenteTelefoniaService) {}

    @Get()
    @Permisos('telefonia.admin')
    @Audit({
        modulo:  AuditModulo.TELEFONIA,
        entidad: 'AgenteTelefonia',
        tipo:    AuditTipo.TEL_AGENTE_LISTADO,
        resumen: () => 'Listado de agentes telefónicos',
    })
    listar() {
        return this.agenteSvc.listar();
    }
}
