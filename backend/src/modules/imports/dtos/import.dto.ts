// src/import/import.dto.ts
import { ImportCategoria } from '../mapping-types';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreatePlantillaDto {
    empresaId!: number;
    nombre!: string;
    categoria!: ImportCategoria;
    version?: number;
    separador?: string;
    tieneHeader?: boolean;
    mappingJson!: any;        // MappingJson
    defaultEstadoSituacionId?: number | null;
    defaultEstadoGestionId?: number | null;
}

export class CreateRemesaDto {
    @IsInt()
    @Type(() => Number)
    empresaId!: number;

    /**
     * Número de remesa. **Opcional**: si viene vacío, el backend genera el correlativo de la
     * empresa (`00001`, `00002`, …) en `resolverNumeroRemesa`. Antes era obligatorio y el frontend
     * lo rellenaba con `Date.now()`, que producía los "números de remesa random".
     */
    @IsOptional()
    @IsString()
    numeroRemesa?: string;

    @IsString()
    @IsNotEmpty()
    nombre!: string;

    @IsString()
    @IsNotEmpty()
    categoria!: ImportCategoria | string;

    @IsInt()
    @Type(() => Number)
    plantillaId!: number;

    @Type(() => Number)
    remesaOrigenId?: number;

    @IsString()
    @IsOptional()
    hoja?: string;

    @IsString()
    @IsOptional()
    fechaVencimiento?: string;

    // Viene por multipart como string "true"/"false"; lo normalizamos a boolean.
    @IsOptional()
    @Transform(({ value }) => value === true || value === 'true')
    @IsBoolean()
    validarDomicilios?: boolean;

    /**
     * División del archivo en varias remesas, una por corte (nómina / gestión).
     *
     * Llega como JSON dentro del multipart, así que se parsea en el `@Transform`. Cada entrada
     * trae los **valores** del corte —los mismos que devolvió `division-preview`— y el número de
     * remesa que le corresponde. Ausente = una remesa por archivo, el comportamiento de siempre.
     */
    @IsOptional()
    @Transform(({ value }) => {
        if (value == null || value === '') return undefined;
        if (Array.isArray(value)) return value;
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : undefined;
        } catch {
            return undefined;
        }
    })
    @IsArray()
    divisiones?: Array<{ valores: Record<string, string>; numeroRemesa: string }>;
}

export class ClonarPlantillaDto {
    @IsString()
    @IsOptional()
    nombre?: string;

    @IsInt()
    @Type(() => Number)
    @IsOptional()
    empresaId?: number;
}

export class CambiarEmpresaPlantillaDto {
    @IsInt()
    @Type(() => Number)
    empresaId!: number;
}