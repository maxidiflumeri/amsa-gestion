import { ArrayMinSize, IsArray, IsInt, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * `PATCH /multiclaves/empresas/:empresaId/config` (spec §9.4). Todos los campos opcionales: se
 * mergean sobre lo que ya había en `configuracion.multiclaves` — ver `ClavesService.actualizarConfig`.
 */
export class MulticlavesConfigDto {
    /** Plantilla de Sender preseleccionada al abrir el diálogo (sigue siendo opcional elegir otra,
     * o ninguna, al generar el cupón — fase 3, D-plantilla-opcional). `null` para quitarla. */
    @IsOptional()
    @IsInt()
    templateCuponId?: number | null;

    @IsOptional()
    @IsString()
    @Matches(/^GES-\d+$/, { message: 'gestionAlGenerar debe tener la forma GES-<número>' })
    gestionAlGenerar?: string;

    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(300)
    leyendaTalonCedente?: string;

    @IsOptional()
    @IsArray()
    @ArrayMinSize(1)
    @IsString({ each: true })
    mediosDePago?: string[];
}
