import { IsOptional, Matches } from 'class-validator';

export class ConsumoQueryDto {
    @IsOptional()
    @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'El mes tiene que tener el formato AAAA-MM.' })
    mes?: string;
}
