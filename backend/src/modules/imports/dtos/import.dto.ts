// src/import/import.dto.ts
import { FiltroFila, ImportCategoria } from '../mapping-types';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

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

/** `GET /import/historial` (docs/imports-progreso-c2-spec.md §4.4). */
export class HistorialQueryDto {
    @IsInt({ message: 'La empresa tiene que ser un número entero.' })
    @Type(() => Number)
    empresaId!: number;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Type(() => Number)
    page?: number;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(100)
    @Type(() => Number)
    pageSize?: number;

    @IsOptional()
    @IsString()
    @MaxLength(60)
    q?: string;
}

/** `GET /import/errores/:remesaId` y su CSV. */
export class ErroresQueryDto {
    @IsOptional()
    @IsInt()
    @Min(1)
    @Type(() => Number)
    page?: number;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(200)
    @Type(() => Number)
    pageSize?: number;

    @IsOptional()
    @IsIn(['TODOS', 'FILA', 'AVISO'])
    tipo?: 'TODOS' | 'FILA' | 'AVISO';

    @IsOptional()
    @IsIn(['asc', 'desc'])
    orden?: 'asc' | 'desc';

    /**
     * Los `pageSize` (máx. 20) errores y avisos más nuevos, del más nuevo al más viejo; `page` se ignora (C3a).
     * `true`/`false` como texto; cualquier otro valor se deja como llegó para que `@IsBoolean` lo rechace con un 400.
     */
    @IsOptional()
    @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
    @IsBoolean({ message: 'reciente tiene que ser true o false.' })
    reciente?: boolean;
}

/** `POST /import/remesas/confirmar-pendientes`. */
export class ConfirmarPendientesDto {
    @IsArray({ message: 'Las importaciones tienen que ser una lista.' })
    @ArrayMinSize(1, { message: 'Indicá al menos una importación.' })
    @ArrayMaxSize(100, { message: 'Se admiten como máximo 100 importaciones.' })
    @IsInt({ each: true, message: 'Cada importación tiene que ser un número entero.' })
    @Type(() => Number)
    remesaIds!: number[];
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