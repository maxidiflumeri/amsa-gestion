import { IsString, IsOptional, IsNumber, IsDateString, IsInt, IsJSON } from 'class-validator';

export class CreateDeudorDto {
    @IsString()
    documento: string;

    @IsString()
    nombre: string;

    @IsString()
    apellido: string;

    @IsOptional()
    @IsNumber()
    montoTotal?: number;

    @IsOptional()
    @IsDateString()
    fechaVencimiento?: string;

    @IsOptional()
    @IsInt()
    estadoSituacionId?: number;

    @IsOptional()
    @IsInt()
    estadoGestionId?: number;

    @IsOptional()
    @IsJSON()
    camposAdicionales?: any;

    @IsInt()
    empresaId: number;

    @IsInt()
    remesaId: number;
}