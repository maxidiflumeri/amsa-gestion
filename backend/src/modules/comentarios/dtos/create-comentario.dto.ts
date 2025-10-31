import { IsInt, IsString, IsOptional } from 'class-validator';

export class CreateComentarioDto {
    @IsInt()
    deudorId: number;

    @IsOptional()
    @IsInt()
    usuarioId?: number;

    @IsString()
    texto: string;

    @IsOptional()
    @IsString()
    origen?: string; // 'manual', 'sistema', etc.
}