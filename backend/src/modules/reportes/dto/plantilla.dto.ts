import { IsString, IsOptional, IsInt, IsBoolean, IsEnum, IsObject, IsIn, Min, Max, ValidateNested, IsArray } from 'class-validator';
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
  tipo?: 'texto' | 'numero' | 'fecha' | 'boolean' | 'moneda' | 'telefono' | 'dias';

  @IsOptional()
  @IsString()
  formato?: string;

  /** E3, solo `tipo: 'numero'`: cantidad de decimales (0 a 4). Sin él, los que tenga el número. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(4)
  decimales?: number;

  /** E3, solo `tipo: 'numero'`: `,` (default) o `.`. */
  @IsOptional()
  @IsIn([',', '.'])
  separadorDecimal?: ',' | '.';

  /** E3, solo `tipo: 'numero'`: `.` (default), `,` o vacío (sin separador de miles). */
  @IsOptional()
  @IsIn(['.', ',', ''])
  separadorMiles?: '.' | ',' | '';

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

  /**
   * Sin `@IsIn`: el `ValidationPipe` le antepone al mensaje el camino técnico (`definicion.filtros.0.`).
   * El operador lo valida `validarDefinicion` en el servicio —al crear, actualizar y en el preview—,
   * con el nombre del filtro y sin prefijo.
   */
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

  /**
   * Id de la columna sobre la que se calcula. Obligatorio en la práctica si dos columnas comparten
   * el `path` (si no, el total es ambiguo y da 400). Un total guardado con solo `path` sigue andando
   * cuando hay una única columna con ese campo.
   */
  @IsOptional()
  @IsString()
  columnaId?: string;

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

  /**
   * Id de la propuesta del asistente de la que salió esta plantilla (el editor lo manda al guardar lo
   * que armó el asistente). Se acepta y por ahora no hace nada acá: el vínculo lo resuelve el módulo
   * del asistente, y un id ajeno o inexistente nunca hace fallar el alta.
   */
  @IsOptional()
  @IsInt()
  asistentePropuestaId?: number;
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
