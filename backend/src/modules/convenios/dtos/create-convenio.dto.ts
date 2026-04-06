import { IsInt, IsNumber, IsString, IsDateString, IsOptional, IsArray, ValidateIf, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CuotaLibreDto {
  @IsInt()
  nroCuota: number;

  @IsDateString()
  fechaVencimiento: string;

  @IsNumber()
  importe: number;
}

export class CreateConvenioDto {
  @IsInt()
  deudorId: number;

  @IsOptional()
  @IsInt()
  usuarioId?: number;

  @IsString()
  tipo: string; // 'LIBRE' | 'AUTOMATICO'

  @IsNumber()
  montoTotal: number;

  @IsInt()
  cantCuotas: number;

  @IsDateString()
  fechaInicio: string;

  @IsOptional()
  @IsString()
  observaciones?: string;

  // Solo para LIBRE
  @ValidateIf(o => o.tipo === 'LIBRE')
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CuotaLibreDto)
  cuotas?: CuotaLibreDto[];
}
