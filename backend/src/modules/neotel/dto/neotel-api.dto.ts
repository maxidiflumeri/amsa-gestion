import {
    IsBoolean,
    IsEnum,
    IsInt,
    IsNotEmpty,
    IsOptional,
    IsString,
    Min,
} from 'class-validator';

/** Estados que el agente puede establecer manualmente vía API */
export type EstadoAgenteManual = 'DISPONIBLE' | 'EN_PAUSA' | 'ADMINISTRATIVO';

// ─── Admin: ABM AgenteTelefonia ───────────────────────────────────────────────

export class CreateAgenteTelefoniaDto {
    @IsInt()
    @Min(1)
    usuarioId!: number;

    @IsString()
    @IsNotEmpty()
    usuarioNeotel!: string;

    /** Clave Neotel en plano — se cifra al guardar */
    @IsString()
    @IsNotEmpty()
    claveNeotel!: string;

    @IsString()
    @IsNotEmpty()
    device!: string;

    @IsString()
    @IsNotEmpty()
    sipAuthUser!: string;

    /** Clave SIP en plano — se cifra al guardar */
    @IsString()
    @IsNotEmpty()
    sipPassword!: string;

    @IsOptional()
    @IsString()
    sipDisplayName?: string;

    @IsOptional()
    @IsBoolean()
    habilitado?: boolean;
}

export class UpdateAgenteTelefoniaDto {
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    usuarioNeotel?: string;

    /** Si se envía, se cifra al guardar */
    @IsOptional()
    @IsString()
    claveNeotel?: string;

    @IsOptional()
    @IsString()
    @IsNotEmpty()
    device?: string;

    @IsOptional()
    @IsString()
    @IsNotEmpty()
    sipAuthUser?: string;

    /** Si se envía, se cifra al guardar */
    @IsOptional()
    @IsString()
    sipPassword?: string;

    @IsOptional()
    @IsString()
    sipDisplayName?: string;

    @IsOptional()
    @IsBoolean()
    habilitado?: boolean;
}

// ─── Respuestas tipadas ───────────────────────────────────────────────────────

export interface SipCredentialsResponse {
    extension:   string;
    sipUri:      string;
    authUser:    string;
    password:    string;
    wssUrl:      string;
    displayName: string;
}

export interface AgenteTelefoniaResponse {
    id:             number;
    usuarioId:      number;
    usuarioNeotel:  string;
    device:         string;
    sipAuthUser:    string;
    sipDisplayName: string | null;
    habilitado:     boolean;
    createdAt:      Date;
    updatedAt:      Date;
    // password fields NUNCA en la respuesta
}

// ─── T5: Sesión + Estado + Campaña ────────────────────────────────────────────

const ESTADOS_MANUALES = ['DISPONIBLE', 'EN_PAUSA', 'ADMINISTRATIVO'] as const;

export class SetEstadoDto {
    @IsEnum(ESTADOS_MANUALES, {
        message: `estado debe ser uno de: ${ESTADOS_MANUALES.join(', ')}`,
    })
    estado!: EstadoAgenteManual;

    @IsOptional()
    @IsInt()
    @Min(1)
    motivoPausaId?: number;
}

export class AsignarCampañaDto {
    @IsInt()
    @Min(1)
    campañaNeotelId!: number;
}
