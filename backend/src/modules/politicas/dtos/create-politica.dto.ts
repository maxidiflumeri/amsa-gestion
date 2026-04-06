import { IsInt, IsOptional, IsString, IsBoolean } from 'class-validator';

export class CreatePoliticaDto {
  @IsInt()
  empresaId: number;

  @IsString()
  nombre: string;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @IsOptional()
  @IsString()
  formasDePago?: string;

  @IsOptional()
  @IsString()
  tipoAtencion?: string;

  @IsOptional()
  datosExtra?: any;

  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}
