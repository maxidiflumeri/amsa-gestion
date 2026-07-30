// processors/multiarchivo.processor.ts
import { AccionAusenteCaso, CasosCedenteProcessor, MotivosBajaConfig } from './casos-cedente.processor';
import { ProcessContext } from './processor.interface';
import { placeholderDocumento } from '../utils/documento';

/**
 * Procesador MULTIARCHIVO — paquete de varios archivos que se cargan juntos (Toyota TCFA).
 *
 * El cruce de los archivos lo hace `utils/multiarchivo-parser.ts`; la lógica de negocio vive en
 * {@link CasosCedenteProcessor}, compartida con MULTIRREGISTRO.
 *
 * Diferencias de esta cartera respecto de la cuenta 87, todas resueltas por la base a partir de lo
 * que emite el parser:
 *  - Trae **CUIT/CUIL real** en el 100% de los casos → el placeholder casi nunca se usa.
 *  - Trae el **vencimiento real** de cada cuota.
 *  - La baja dice **de qué cliente** es → la factura se resuelve sin ambigüedad.
 *  - El motivo de baja viene con **código numérico** (`IDMotivo`), más estable que el texto.
 *
 * Spec: `docs/imports-toyota-tcfa-spec.md`.
 */
export class MultiarchivoProcessor extends CasosCedenteProcessor {
    readonly category = 'MULTIARCHIVO';

    protected motivosBaja(ctx: ProcessContext): MotivosBajaConfig | undefined {
        return ctx.multiarchivoConfig?.bajas;
    }

    /**
     * El archivo de deudores de TCFA es un snapshot completo de la cartera vigente, así que un caso
     * que deja de venir es un caso que el cedente retiró. Aun así el default es `IGNORAR`:
     * desasignar es destructivo a escala y solo debe activarse desde la plantilla, con la confirmación
     * de que el cedente manda siempre la cartera entera.
     */
    protected accionAusente(ctx: ProcessContext): AccionAusenteCaso {
        return ctx.multiarchivoConfig?.accionAusente === 'DESASIGNAR' ? 'DESASIGNAR' : 'IGNORAR';
    }

    /**
     * Cartera nueva: se usa el placeholder canónico (`SIN-DNI-`), el mismo que el resto de las
     * categorías, para que `esDocumentoPlaceholder()` lo reconozca y una actualización posterior
     * pueda completarlo con el documento real.
     */
    protected placeholderDocumento(nroCliente: string): string {
        return placeholderDocumento(nroCliente);
    }
}
