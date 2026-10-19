import { IsBoolean } from 'class-validator';

export class ActualizarAdjuntoDto {
    /** Solo `false` hace algo: «La primera fila no es el encabezado». */
    @IsBoolean()
    primeraFilaEsEncabezado!: boolean;
}
