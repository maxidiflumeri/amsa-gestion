import { IsString, IsOptional, IsInt, IsBoolean, IsEnum, IsObject, ValidateNested, IsArray } from 'class-validator';
import { Type } from 'class-transformer';

export enum FormatoSalidaV2 {
  XLSX = 'xlsx',
  CSV = 'csv',
  TXT = 'txt',
  PDF = 'pdf',
}

export enum RaizV2 {
  DEUDOR = 'deudor',
}

export class ColumnaDto {
  @IsString()
  id: string;

  @IsString()
  path: string;

  @IsString()
  label: string;

  @IsOptional()
  @IsString()
  tipo?: 'texto' | 'numero' | 'fecha' | 'boolean' | 'moneda';

  @IsOptional()
  @IsString()
  formato?: string;

  @IsOptional()
  @IsInt()
  ancho?: number;

  @IsOptional()
  @IsString()
  cardinalidad?: 'expandir' | 'concatenar' | 'primero' | 'ultimo';

  @IsOptional()
  @IsString()
  separadorConcat?: string;
}

export class FiltroDto {
  @IsString()
  id: string;

  @IsString()
  path: string;

  @IsString()
  operador: string;

  @IsOptional()
  valor?: any;

  @IsOptional()
  @IsBoolean()
  variable?: boolean;

  @IsOptional()
  @IsString()
  labelVariable?: string;

  @IsOptional()
  valorPorDefecto?: any;
}

export class OrdenamientoDto {
  @IsString()
  path: string;

  @IsString()
  direccion: 'asc' | 'desc';
}

export class AgrupacionDto {
  @IsString()
  path: string;

  @IsOptional()
  @IsBoolean()
  mostrarSubtotales?: boolean;

  @IsOptional()
  @IsBoolean()
  saltoPagina?: boolean;
}

export class TotalDto {
  @IsString()
  path: string;

  @IsString()
  funcion: 'sum' | 'avg' | 'count' | 'min' | 'max';

  @IsOptional()
  @IsString()
  label?: string;
}

export class DefinicionPlantillaDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ColumnaDto)
  columnas: ColumnaDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FiltroDto)
  filtros?: FiltroDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrdenamientoDto)
  ordenamientos?: OrdenamientoDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AgrupacionDto)
  agrupaciones?: AgrupacionDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TotalDto)
  totales?: TotalDto[];

  @IsOptional()
  @IsString()
  cardinalidadDefault?: 'expandir' | 'concatenar' | 'primero' | 'ultimo';

  @IsOptional()
  @IsInt()
  limiteFilas?: number;
}

export class CreatePlantillaV2Dto {
  @IsString()
  nombre: string;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @IsEnum(RaizV2)
  raiz: RaizV2;

  @IsOptional()
  @IsInt()
  empresaId?: number;

  @IsObject()
  @ValidateNested()
  @Type(() => DefinicionPlantillaDto)
  definicion: DefinicionPlantillaDto;

  @IsEnum(FormatoSalidaV2)
  formatoSalida: FormatoSalidaV2;

  @IsOptional()
  @IsObject()
  opcionesFormato?: any;
}

export class UpdatePlantillaV2Dto {
  @IsOptional()
  @IsString()
  nombre?: string;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => DefinicionPlantillaDto)
  definicion?: DefinicionPlantillaDto;

  @IsOptional()
  @IsEnum(FormatoSalidaV2)
  formatoSalida?: FormatoSalidaV2;

  @IsOptional()
  @IsObject()
  opcionesFormato?: any;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
