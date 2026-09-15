/**
 * `empresa.configuracion.multiclaves` (spec §9.5), con sus defaults y su validación.
 *
 * Mismo patrón que `promesas.service.ts` (`maxDiasEmpresa`): se lee el JSON de la empresa, se valida
 * campo por campo y lo que no pasa cae al default con un `warn` — un catálogo incompleto o un typo
 * en la config no puede bloquear la generación de un cupón.
 *
 * Fase 2 solo LEE esta config (`gestionAlGenerar`, `leyendaTalonCedente`, `mediosDePago`) — el
 * endpoint para escribirla (`PATCH /multiclaves/empresas/:id/config`, §9.4) y `templateCuponId`
 * llegan en la fase 3 junto con el envío por mail. Sin ese endpoint, hoy la única forma de cambiar
 * estos valores es a mano en `empresa.configuracion` — documentado en la wiki.
 */

export interface ConfigMulticlaves {
    /** Plantilla de Sender para el mail del cupón (fase 3). `null` hasta que se configure. */
    templateCuponId: number | null;
    /** Código de gestión (`parametro.clave`) al que pasa el caso al generar un cupón nuevo. */
    gestionAlGenerar: string;
    leyendaTalonCedente: string;
    mediosDePago: string[];
}

export const CONFIG_MULTICLAVES_DEFAULT: ConfigMulticlaves = {
    templateCuponId: null,
    gestionAlGenerar: 'GES-050',
    leyendaTalonCedente: 'TALON PARA Telecom Personal Argentina S.A. - FIRMA, SELLO Y FECHA AL DORSO',
    mediosDePago: ['PAGO FACIL', 'RAPIPAGO', 'BAPRO PAGOS', 'COBRO EXPRESS'],
};

/** `GES-\d+` — la forma de las claves de gestión del catálogo (`parametro.clave`, grupo 'gestion'). */
const RE_CLAVE_GESTION = /^GES-\d+$/;

/**
 * Resuelve `configuracion.multiclaves` con sus defaults, tolerando un JSON vacío, parcial o con
 * valores de forma inválida (nunca lanza: lo inválido cae al default).
 */
export function resolverConfigMulticlaves(configuracion: unknown): ConfigMulticlaves {
    const raw = (configuracion as { multiclaves?: Partial<ConfigMulticlaves> } | null | undefined)?.multiclaves;
    if (!raw || typeof raw !== 'object') return { ...CONFIG_MULTICLAVES_DEFAULT };

    const gestionAlGenerar =
        typeof raw.gestionAlGenerar === 'string' && RE_CLAVE_GESTION.test(raw.gestionAlGenerar)
            ? raw.gestionAlGenerar
            : CONFIG_MULTICLAVES_DEFAULT.gestionAlGenerar;

    const leyendaTalonCedente =
        typeof raw.leyendaTalonCedente === 'string' && raw.leyendaTalonCedente.trim().length > 0
            ? raw.leyendaTalonCedente
            : CONFIG_MULTICLAVES_DEFAULT.leyendaTalonCedente;

    const mediosDePago =
        Array.isArray(raw.mediosDePago) &&
        raw.mediosDePago.length > 0 &&
        raw.mediosDePago.every((m) => typeof m === 'string' && m.trim().length > 0)
            ? raw.mediosDePago
            : CONFIG_MULTICLAVES_DEFAULT.mediosDePago;

    const templateCuponId = typeof raw.templateCuponId === 'number' ? raw.templateCuponId : null;

    return { templateCuponId, gestionAlGenerar, leyendaTalonCedente, mediosDePago };
}
