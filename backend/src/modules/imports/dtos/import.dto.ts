// src/import/import.dto.ts
import { FiltroFila, ImportCategoria } from '../mapping-types';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

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
     * trae los **valores** del corte —los mismos que devolvió `division-preview`—, su **filtro** y
     * el número de remesa que le corresponde. Ausente = una remesa por archivo, el comportamiento
     * de siempre.
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
    divisiones?: Array<{
        valores: Record<string, string>;
        numeroRemesa: string;
        /** Filtros calculados por `division-preview`. Ver la validación en `imports.service`. */
        filtros?: FiltroFila[];
        /**
         * Cargar este corte aunque ya esté cargado, en curso o a medias en otra remesa del mismo archivo
         * (§10.5.6). Sin esto el alta responde 409. El asistente lo manda solo tras una confirmación explícita.
         */
        repetir?: boolean;
    }>;
}

/** Confirmación de una carga dividida: las N remesas se encolan juntas y en orden (§10.5.2). */
export class EjecutarGrupoDto {
    @IsArray({ message: 'Las remesas de la carga dividida tienen que ser una lista.' })
    @ArrayMinSize(2, { message: 'Una carga dividida necesita al menos 2 remesas.' })
    @ArrayMaxSize(100, { message: 'Una carga dividida admite como máximo 100 remesas.' })
    @IsInt({ each: true, message: 'Cada remesa de la carga dividida tiene que ser un número entero.' })
    @Type(() => Number)
    remesaIds!: number[];

    @IsOptional()
    @IsInt({ message: 'La remesa de origen tiene que ser un número entero.' })
    @Type(() => Number)
    remesaOrigenId?: number;

    @IsOptional()
    @IsArray({ message: 'Las remesas de origen tienen que ser una lista.' })
    @IsInt({ each: true, message: 'Cada remesa de origen tiene que ser un número entero.' })
    @Type(() => Number)
    remesaOrigenIds?: number[];
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