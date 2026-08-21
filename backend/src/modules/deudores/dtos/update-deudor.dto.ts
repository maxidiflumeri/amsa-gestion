import { IsOptional } from 'class-validator';

export class UpdateDeudorDto {
    @IsOptional()
    estadoSituacionClave?: string;

    @IsOptional()
    estadoGestionClave?: string;

    /**
     * `undefined` conserva el motivo actual; `null` o `''` lo **borran**.
     *
     * La distinción importa: sin ella el motivo de no pago no se podía quitar nunca.
     */
    @IsOptional()
    motivoNoPagoClave?: string | null;
}
