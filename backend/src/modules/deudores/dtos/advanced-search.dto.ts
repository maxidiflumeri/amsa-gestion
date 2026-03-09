import { IsOptional, IsString, IsNumber } from 'class-validator';

export class AdvancedSearchDto {
    @IsOptional()
    @IsNumber()
    id?: number;

    @IsOptional()
    @IsString()
    empresa?: string;

    @IsOptional()
    @IsString()
    nombre?: string;

    @IsOptional()
    @IsString()
    apellido?: string;

    @IsOptional()
    @IsString()
    documento?: string;

    @IsOptional()
    @IsString()
    nroCliente?: string;

    @IsOptional()
    @IsString()
    email?: string;

    @IsOptional()
    @IsString()
    telefono?: string;
}
