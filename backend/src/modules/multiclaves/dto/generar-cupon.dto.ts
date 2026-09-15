import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Contrato completo del spec (§9.2). Fase 3: `ENVIAR`/`DESCARGAR_Y_ENVIAR` ya están implementadas.
 */
export type AccionCupon = 'DESCARGAR' | 'ENVIAR' | 'DESCARGAR_Y_ENVIAR';

export class GenerarCuponDto {
    @IsInt()
    @Type(() => Number)
    deudorId!: number;

    @IsIn(['DESCARGAR', 'ENVIAR', 'DESCARGAR_Y_ENVIAR'])
    accion!: AccionCupon;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    @ArrayMaxSize(5)
    destinatarios?: string[];

    /**
     * Plantilla de Sender elegida por el operador (opcional, fase 3): sin ella se manda el mensaje
     * por defecto armado en Gestión (`utils/cupon-mail.ts`). Ya NO hace falta que la empresa tenga
     * una plantilla configurada de antemano — corrección del spec original, ver CHANGELOG fase 3.
     */
    @IsOptional()
    @IsInt()
    @Type(() => Number)
    templateId?: number;

    @IsOptional()
    @IsBoolean()
    guardarEmailComoContacto?: boolean;

    /** Confirmación explícita para pasar de una clave activa a otra (D7): anula el convenio
     * anterior. Exige además el permiso `convenios.cancelar` (verificado en el servicio). */
    @IsOptional()
    @IsBoolean()
    reemplazarConvenioActivo?: boolean;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    observacion?: string;
}
