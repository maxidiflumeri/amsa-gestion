// processors/multirregistro.processor.ts
import { CasosCedenteProcessor, MotivosBajaConfig } from './casos-cedente.processor';
import { ProcessContext } from './processor.interface';

/**
 * Procesador MULTIRREGISTRO — archivo con varios tipos de línea (Toyota cuenta 87).
 *
 * El parseo y la agrupación los hace `utils/multirregistro-parser.ts`; la lógica de negocio vive en
 * {@link CasosCedenteProcessor}, compartida con MULTIARCHIVO. Acá quedan solo las dos cosas propias
 * de esta cartera: de dónde salen los motivos de baja y qué documento se usa cuando no hay DNI.
 *
 * Spec: `docs/imports-actualizacion-diaria-y-multirregistro-spec.md` §B.
 */
export class MultirregistroProcessor extends CasosCedenteProcessor {
    readonly category = 'MULTIRREGISTRO';

    protected motivosBaja(ctx: ProcessContext): MotivosBajaConfig | undefined {
        // El archivo de la cuenta 87 no manda código de motivo, solo el texto.
        return ctx.multirregistroConfig?.baj;
    }

    /**
     * El archivo no trae DNI, así que el documento va con un placeholder derivado del nro de
     * cliente: estable entre días (no usa timestamp) y único dentro de la empresa.
     *
     * ⚠️ Usa el prefijo `SIN_DOC_` y NO el `placeholderDocumento()` canónico (`SIN-DNI-`) porque hay
     * cartera en producción cargada con éste desde 2026-07. Cambiarlo dejaría la misma empresa con
     * dos convenciones conviviendo, que es peor que una sola no estándar. Unificar requiere un
     * UPDATE puntual sobre los deudores ya cargados; hasta entonces, `enriquecimiento-historico.ts`
     * contempla los dos prefijos.
     */
    protected placeholderDocumento(nroCliente: string): string {
        return `SIN_DOC_${nroCliente}`;
    }
}
