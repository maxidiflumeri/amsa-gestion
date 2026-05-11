import {
  IsOptional,
  IsString,
  IsInt,
  IsObject,
  Min,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum EstadoEjecucion {
  PENDIENTE = 'PENDIENTE',
  EJECUTANDO = 'EJECUTANDO',
  FINALIZADA = 'FINALIZADA',
  FALLIDA = 'FALLIDA',
  CANCELADA = 'CANCELADA',
}

export class ListarEjecucionesQueryDto {
  @IsOptional()
  @IsEnum(EstadoEjecucion)
  estado?: EstadoEjecucion;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  plantillaId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}

export class EstimarDto {
  @IsOptional()
  @IsObject()
  filtrosVars?: Record<string, any>;
}

export interface EstimarResponse {
  totalEstimado: number;
  modoSugerido: 'sync' | 'async';
  umbral: number;
}

export interface EncolarEjecucionResponse {
  ejecucionId: number;
  modo: 'async';
  estado: string;
}
