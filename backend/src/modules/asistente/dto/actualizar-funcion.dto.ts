import { IsBoolean, IsNumber, IsOptional, Max, Min } from 'class-validator';

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
}
