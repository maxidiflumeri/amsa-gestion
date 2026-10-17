import { IsBoolean, IsInt, IsNumber, IsObject, IsOptional, Max, Min } from 'class-validator';
import { PrecioModelo } from './asistente.tipos';

export class ActualizarConfigDto {
    @IsOptional()
    @IsBoolean()
    habilitado?: boolean;

    @IsOptional()
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0)
    @Max(10000)
    topeMensualUsd?: number;

    @IsOptional()
    @IsInt()
    @Min(10)
    @Max(99)
    avisoPorcentaje?: number;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(1000)
    limiteDiarioUsuario?: number;

    @IsOptional()
    @IsNumber({ maxDecimalPlaces: 4 })
    @Min(0.005)
    @Max(1)
    topeTurnoUsd?: number;

    /** Se valida a fondo en el servicio (`validarPrecios`). */
    @IsOptional()
    @IsObject()
    precios?: Record<string, PrecioModelo>;
}
