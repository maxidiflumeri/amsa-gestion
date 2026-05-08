import { IsObject, IsOptional, IsEnum, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { DefinicionPlantillaDto, RaizV2 } from './plantilla-v2.dto';

export class EjecutarV2Dto {
  @IsOptional()
  @IsObject()
  filtrosVars?: Record<string, any>;
}

export class PreviewV2Dto {
  @IsObject()
  @ValidateNested()
  @Type(() => DefinicionPlantillaDto)
  definicion: DefinicionPlantillaDto;

  @IsOptional()
  @IsObject()
  filtrosVars?: Record<string, any>;

  @IsOptional()
  @IsEnum(RaizV2)
  raiz?: RaizV2;
}
