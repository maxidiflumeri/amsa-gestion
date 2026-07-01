import { IsInt, IsNumber, IsString, IsDateString, IsOptional } from 'class-validator';

export class CreatePagoDto {
    @IsInt()
    deudorId: number;

    @IsDateString()
    fecha: string;

    @IsNumber()
    importe: number;

    @IsOptional()
    @IsString()
    observacion?: string;
}
