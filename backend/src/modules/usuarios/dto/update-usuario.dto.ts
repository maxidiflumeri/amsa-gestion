import { IsBoolean, IsInt, IsOptional, IsPositive } from 'class-validator';

export class UpdateUsuarioDto {
    @IsOptional()
    @IsInt()
    @IsPositive()
    rolId?: number;

    @IsOptional()
    @IsBoolean()
    activo?: boolean;
}
