import { IsOptional, IsEnum, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { RaizV2 } from './plantilla-v2.dto';

export class CatalogoQueryDto {
  @IsOptional()
  @IsEnum(RaizV2)
  raiz?: RaizV2;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  @Type(() => Number)
  depth?: number;
}

export class CamposAdicionalesQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  empresaId?: number;
}

export interface NodoCatalogo {
  path: string;
  nombre: string;
  label: string;
  tipo: 'escalar' | 'relacion-1-1' | 'relacion-1-n' | 'json';
  tipoEscalar?: 'texto' | 'numero' | 'fecha' | 'boolean' | 'enum';
  enumValues?: string[];
  cardinalidad?: '1-1' | '1-N' | 'opcional';
  agregadoresPermitidos?: string[];
  filtrosPermitidos?: string[];
  hijos?: NodoCatalogo[];
  oculto?: boolean;
}
