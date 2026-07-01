import { IsInt, IsNumber, IsString, IsDateString, IsOptional } from 'class-validator';

export class CreatePromesaDto {
    @IsInt()
    deudorId: number;

    @IsDateString()
    fechaPromesa: string;

    @IsOptional()
    @IsNumber()
    monto?: number;

    @IsOptional()
    @IsString()
    observacion?: string;
}
