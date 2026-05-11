import { IsObject, IsOptional, IsEnum, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { DefinicionPlantillaDto, Raiz } from './plantilla.dto';

export class EjecutarDto {
  @IsOptional()
  @IsObject()
  filtrosVars?: Record<string, any>;
}

export class PreviewDto {
  @IsObject()
  @ValidateNested()
  @Type(() => DefinicionPlantillaDto)
  definicion: DefinicionPlantillaDto;

  @IsOptional()
  @IsObject()
  filtrosVars?: Record<string, any>;

  @IsOptional()
  @IsEnum(Raiz)
  raiz?: Raiz;
}
