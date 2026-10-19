import { IsBoolean, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class ActualizarFuncionDto {
    @IsOptional()
    @IsBoolean()
    habilitada?: boolean;

    /** `null` = sin tope propio (solo rige el global). `IsOptional` deja pasar null y undefined. */
    @IsOptional()
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0)
    @Max(10000)
    topeMensualUsd?: number | null;

    /** Tope de gasto de UN turno de la función. `null` = vuelve al de código de la función (o al global). */
    @IsOptional()
    @IsNumber({ maxDecimalPlaces: 4 })
    @Min(0.005)
    @Max(2)
    topeTurnoUsd?: number | null;

    /** Turnos por persona por día en esta función. `null` = sin límite propio (rige igual el global). */
    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(1000)
    limiteDiarioUsuario?: number | null;
}
