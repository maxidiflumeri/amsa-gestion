// Nombres de las subfases del post-proceso y el helper de consolidación con reporte
// (docs/imports-progreso-realtime-spec.md §9.4.4 y §9.5.4).
//
// Los nombres viven en un solo lugar para que la pantalla, la wiki y los tests digan lo mismo.
import { ConsolidacionScope } from '../../consolidacion/interfaces/consolidacion-result.interface';
import type { ProcessContext } from '../processors/processor.interface';

export const SUBFASE = {
    DESASIGNANDO_AUSENTES: 'Desasignando ausentes',
    CERRANDO_AUSENTES: 'Cerrando ausentes',
    CONSOLIDANDO_REMESA_ORIGEN: 'Consolidando la remesa de origen',
    CONSOLIDANDO_REMESA_CARGA: 'Consolidando la remesa de la carga',
    CERRANDO_PROMESAS: 'Cerrando promesas cumplidas',
    CONSOLIDANDO_CASOS_CON_PAGOS: 'Consolidando casos con pagos',
    RECALCULANDO_IMPORTES: 'Recalculando importes',
    CONSOLIDANDO_CASOS: 'Consolidando casos',
    UNIENDO_DATOS_ADICIONALES: 'Uniendo datos adicionales',
    CONSOLIDANDO_CASOS_TOCADOS: 'Consolidando casos tocados',
    BUSCANDO_PAGOS_DE_CLAVES: 'Buscando pagos de estas claves',
    GUARDANDO_DATOS_PARA_REVERTIR: 'Guardando datos para revertir',
} as const;

/**
 * Consolida informando "N de M" como subfase. Sin canal de reporte, la llamada es EXACTAMENTE la de
 * siempre (un argumento): hay specs que afirman `consolidar` llamado con un solo argumento.
 */
export function consolidarConProgreso(ctx: ProcessContext, scope: ConsolidacionScope, nombre: string) {
    if (!ctx.progreso) return ctx.consolidacion.consolidar(scope);
    ctx.progreso.subfase(nombre);
    return ctx.consolidacion.consolidar(scope, {
        onProgress: (hecho, total) => ctx.progreso?.subfase(nombre, hecho, total),
    });
}
