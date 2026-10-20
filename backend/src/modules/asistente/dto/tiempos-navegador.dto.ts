import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Lo que midió el navegador desde que la persona apretó Enviar (docs/asistente-detalle-spec.md §6.1). */
export class TiemposNavegadorDto {
    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(900_000)
    primeraSenalMs?: number | null;

    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(900_000)
    primerTextoMs?: number | null;

    @IsInt()
    @Min(0)
    @Max(900_000)
    totalMs!: number;
}
