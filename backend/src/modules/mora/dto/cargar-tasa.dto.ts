import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsPositive, IsString, Matches, Max, MaxLength } from 'class-validator';

/**
 * Carga (o recarga) la tasa mensual del régimen de recargos y genera el índice del mes.
 *
 * `tasaBase` va **como la informa el cedente**: 2.169 para 2,169% mensual. Sin dividir por 100 y sin
 * multiplicar por nada — los tres tipos los deriva el sistema. En el CRM viejo el operador hacía las
 * tres multiplicaciones a mano y se equivocó 6 veces en 3 años.
 */
export class CargarTasaDto {
    @IsInt()
    @IsPositive()
    empresaId: number;

    @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'periodo debe tener el formato YYYY-MM' })
    periodo: string;

    @IsNumber()
    @IsPositive()
    @Max(100, { message: 'tasaBase se carga sin dividir por 100 (2.169 = 2,169% mensual)' })
    tasaBase: number;

    @IsOptional()
    @IsIn(['MAIL_AYSA', 'MIGRACION_UD60', 'CALIBRADA'])
    fuente?: 'MAIL_AYSA' | 'MIGRACION_UD60' | 'CALIBRADA';

    @IsOptional()
    @IsString()
    @MaxLength(1000)
    observacion?: string;

    /**
     * Arranca la cadena desde 1. Solo válido en una empresa sin historia de índice: usarlo sobre una
     * cadena existente deja todas las deudas actualizadas mal (ver mora-aysa-spec.md §8.1).
     */
    @IsOptional()
    @IsBoolean()
    permitirInicioDeCadena?: boolean;
}
