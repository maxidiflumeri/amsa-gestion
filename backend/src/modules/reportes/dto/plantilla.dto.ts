import { IsString, IsOptional, IsInt, IsBoolean, IsEnum, IsObject, ValidateNested, IsArray } from 'class-validator';
import { Type } from 'class-transformer';

export enum FormatoSalida {
  XLSX = 'xlsx',
  CSV = 'csv',
  TXT = 'txt',
  PDF = 'pdf',
}

export enum Raiz {
  DEUDOR = 'deudor',
  TRANSACCION = 'transaccion',
}

export class ColumnaDto {
  @IsString()
  id: string;

  /** Vacío = columna fija: no sale de los datos, imprime `valorFijo`. Ver `esColumnaFija`. */
  @IsString()
  path: string;

  @IsString()
  label: string;

  /** Solo para columnas fijas: el texto que va en todas las filas. Sin él, la columna sale vacía. */
  @IsOptional()
  @IsString()
  valorFijo?: string;

  @IsOptional()
  @IsString()
  tipo?: 'texto' | 'numero' | 'fecha' | 'boolean' | 'moneda' | 'telefono';

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

  @IsOptional()
  @IsInt()
  formatoTelefonoId?: number;
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

  @IsOptional()
  @IsBoolean()
  obligatorio?: boolean;
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

export class CreatePlantillaDto {
  @IsString()
  nombre: string;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @IsEnum(Raiz)
  raiz: Raiz;

  @IsOptional()
  @IsInt()
  empresaId?: number;

  @IsObject()
  @ValidateNested()
  @Type(() => DefinicionPlantillaDto)
  definicion: DefinicionPlantillaDto;

  @IsEnum(FormatoSalida)
  formatoSalida: FormatoSalida;

  @IsOptional()
  @IsObject()
  opcionesFormato?: any;
}

export class DuplicarPlantillaDto {
  @IsOptional()
  @IsString()
  nombre?: string;

  // undefined → conserva empresa del original; null → Global; number → esa empresa.
  @IsOptional()
  @IsInt()
  empresaId?: number | null;
}

export class CambiarEmpresaReporteDto {
  // null = Global (sin empresa).
  @IsOptional()
  @IsInt()
  empresaId?: number | null;
}

export class UpdatePlantillaDto {
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
  @IsEnum(FormatoSalida)
  formatoSalida?: FormatoSalida;

  @IsOptional()
  @IsObject()
  opcionesFormato?: any;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
