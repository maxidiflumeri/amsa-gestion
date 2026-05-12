import { IsInt, IsString, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';

export class CreateContactoDto {
    @IsString()
    @IsNotEmpty()
    tipo: string;

    @IsString()
    @IsNotEmpty()
    valor: string;

    @IsInt()
    deudorId: number;

    @IsOptional()
    @IsBoolean()
    whatsapp?: boolean;

    @IsOptional()
    @IsInt()
    prioridad?: number | null;

    @IsOptional()
    @IsBoolean()
    validado?: boolean;

    @IsOptional()
    @IsString()
    direccionLocalidad?: string;

    @IsOptional()
    @IsString()
    direccionProvincia?: string;

    @IsOptional()
    @IsString()
    direccionCp?: string;
}