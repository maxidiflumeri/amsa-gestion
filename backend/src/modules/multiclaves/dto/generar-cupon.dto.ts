import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Contrato completo del spec (§9.2): incluye `ENVIAR`/`DESCARGAR_Y_ENVIAR` para no romper el
 * contrato cuando la fase 3 (envío por mail) se implemente. Esta fase 2 sólo implementa `DESCARGAR`
 * — `CuponService.generar` corta con 400 `ACCION_NO_DISPONIBLE` para las otras dos. Ver desvíos en
 * el CHANGELOG de la fase 2.
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
