import {
  IsOptional,
  IsString,
  IsInt,
  IsObject,
  Min,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum EstadoEjecucionV2 {
  PENDIENTE = 'PENDIENTE',
  EJECUTANDO = 'EJECUTANDO',
  FINALIZADA = 'FINALIZADA',
  FALLIDA = 'FALLIDA',
  CANCELADA = 'CANCELADA',
}

export class ListarEjecucionesQueryDto {
  @IsOptional()
  @IsEnum(EstadoEjecucionV2)
  estado?: EstadoEjecucionV2;

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

export class EstimarV2Dto {
  @IsOptional()
  @IsObject()
  filtrosVars?: Record<string, any>;
}

export interface EstimarV2Response {
  totalEstimado: number;
  modoSugerido: 'sync' | 'async';
  umbral: number;
}

export interface EncolarEjecucionResponse {
  ejecucionId: number;
  modo: 'async';
  estado: string;
}
