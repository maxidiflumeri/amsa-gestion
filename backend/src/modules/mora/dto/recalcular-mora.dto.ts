import { IsBoolean, IsInt, IsOptional, IsPositive, Matches } from 'class-validator';

export class RecalcularMoraDto {
    @IsInt()
    @IsPositive()
    empresaId: number;

    /** Fecha de valuación. Por defecto hoy. */
    @IsOptional()
    @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fecha debe tener el formato YYYY-MM-DD' })
    fecha?: string;

    @IsOptional()
    @IsBoolean()
    dryRun?: boolean;
}
