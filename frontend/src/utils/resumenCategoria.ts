// "Qué hizo la carga": las líneas de texto que salen del `resumenCategoria` de una carga terminada
// (docs/imports-progreso-c3-spec.md §6.1 y §6.2). Función pura: no lee el DOM ni el reloj.
import type { EstadoCargaDto, ResumenCategoria } from '../types/importProgreso';
import { formatearNumero, plural } from './estadoCarga';

export type TonoLinea = 'normal' | 'aviso';
export interface LineaDeResumen { texto: string; tono: TonoLinea }
export type CargaParaResumen = Pick<EstadoCargaDto, 'ok' | 'err' | 'cancelada' | 'resultado'>;

/** "1 caso nuevo" / "3 casos nuevos" (con punto de miles). */
const cant = (n: number, uno: string, varios: string): string => `${formatearNumero(n)} ${plural(n, uno, varios)}`;

/** Un número del DTO que un backend raro puede mandar mal: nunca NaN ni negativo en pantalla. */
const num = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);

/**
 * Las líneas del resumen de una carga. `[]` si el resumen es null/undefined (carga en curso, anterior a C3a o interrumpida)
 * o si su `tipo` no se conoce. Una línea con cero no se muestra, salvo las que el diseño marca "siempre".
 */
export function lineasDeResumen(r: ResumenCategoria | null | undefined, carga: CargaParaResumen): LineaDeResumen[] {
    if (r == null || typeof r !== 'object') return [];
    const out: LineaDeResumen[] = [];
    const normal = (texto: string) => out.push({ texto, tono: 'normal' });
    const aviso = (texto: string) => out.push({ texto, tono: 'aviso' });
    /** Agrega la línea solo si `n` > 0. */
    const si = (n: number, tono: TonoLinea, uno: string, varios: string) => {
        if (n > 0) out.push({ texto: `${formatearNumero(n)} ${n === 1 ? uno : varios}`, tono });
    };

    switch (r.tipo) {
        case 'DEUDORES_Y_FACTURAS': {
            // Acá lo normal es una fila por factura: varias filas sobre el mismo caso no son un problema.
            normal(cant(num(r.casosNuevos), 'caso nuevo', 'casos nuevos'));
            const conFacturas = num(r.casosConFacturas);
            if (conFacturas > 0) normal(`Facturas en ${cant(conFacturas, 'caso', 'casos')}`);
            si(num(r.contactosCopiados), 'normal', 'contacto copiado de casos anteriores del mismo cliente', 'contactos copiados de casos anteriores del mismo cliente');
            break;
        }
        case 'DEUDORES': {
            const nuevos = num(r.casosNuevos);
            normal(cant(nuevos, 'caso nuevo', 'casos nuevos'));
            const repetidas = num(carga.ok) - nuevos;
            if (repetidas > 0) {
                aviso(
                    `${formatearNumero(repetidas)} ${repetidas === 1 ? 'fila cayó' : 'filas cayeron'} sobre un caso que esta misma carga ya había creado: ` +
                        'el archivo repite la identidad del caso y la última fila pisó a la anterior',
                );
            }
            const copiados = num(r.contactosCopiados);
            si(copiados, 'normal', 'contacto copiado de casos anteriores del mismo cliente', 'contactos copiados de casos anteriores del mismo cliente');
            break;
        }
        case 'FACTURAS': {
            const casos = num(r.casosConFacturas);
            if (casos > 0) normal(`Facturas en ${cant(casos, 'caso', 'casos')}`);
            si(num(r.clientesInexistentes), 'aviso', 'cliente del archivo no existe en la remesa de origen (su fila figura como error)', 'clientes del archivo no existen en la remesa de origen (sus filas figuran como error)');
            break;
        }
        case 'CONTACTOS':
        case 'ENRIQUECIMIENTO': {
            si(num(r.contactosCargados), 'normal', 'contacto principal cargado', 'contactos principales cargados');
            const sin = num(r.filasSinContactoValido);
            if (sin > 0) {
                aviso(
                    sin === 1
                        ? '1 fila no tenía un contacto principal válido (vacío, o un teléfono o mail que no se pudo normalizar): ese contacto no se cargó y la fila no figura como error'
                        : `${formatearNumero(sin)} filas no tenían un contacto principal válido (vacío, o un teléfono o mail que no se pudo normalizar): ese contacto no se cargó y la fila no figura como error`,
                );
            }
            break;
        }
        case 'PAGOS': {
            const casos = num(r.casosConPagos);
            if (casos > 0) normal(`Pagos en ${cant(casos, 'caso', 'casos')}`);
            si(num(r.yaCargados), 'normal', 'pago ya estaba cargado y no se duplicó', 'pagos ya estaban cargados y no se duplicaron');
            si(num(r.negativos), 'aviso', 'pago con importe negativo: aumenta la deuda del caso', 'pagos con importe negativo: aumentan la deuda del caso');
            si(num(r.facturasMarcadas), 'normal', 'factura marcada como pagada', 'facturas marcadas como pagadas');
            if (r.claves != null && typeof r.claves === 'object') {
                si(num(r.claves.noCargada), 'aviso', 'clave no está cargada', 'claves no están cargadas');
                si(num(r.claves.otraEmpresa), 'aviso', 'clave es de otra empresa', 'claves son de otra empresa');
                si(num(r.claves.ilegible), 'aviso', 'referencia ilegible', 'referencias ilegibles');
                si(num(r.claves.casosFueraDeRemesaOrigen), 'aviso', 'caso fuera de las remesas de origen', 'casos fuera de las remesas de origen');
            }
            break;
        }
        case 'ACTUALIZACIONES': {
            const coinc = num(r.coincidencias);
            normal(
                `${formatearNumero(coinc)} ${coinc === 1 ? 'fila coincidió' : 'filas coincidieron'} con ${coinc === 1 ? 'un caso' : 'casos'} de la cartera · ` +
                    `${cant(num(r.casosNuevos), 'caso nuevo', 'casos nuevos')} · ${cant(num(r.reasignados), 'reasignado', 'reasignados')}`,
            );
            const a = r.ausentes;
            if (a == null || typeof a !== 'object') break;
            switch (a.resultado) {
                case 'APLICADO':
                    if (a.accion === 'PAGO_TODO') {
                        si(num(a.pagosGenerados), 'normal', 'caso ausente del archivo se dio por pagado', 'casos ausentes del archivo se dieron por pagados');
                        si(num(a.salteadosSinMonto), 'aviso', 'ausente sin importe no se tocó', 'ausentes sin importe no se tocaron');
                    } else if (a.accion === 'DESASIGNAR') {
                        si(num(a.desasignados), 'normal', 'caso ausente del archivo se desasignó', 'casos ausentes del archivo se desasignaron');
                    } else if (a.accion === 'IGNORAR') {
                        normal('Los casos ausentes del archivo no se tocaron (la plantilla dice ignorarlos)');
                    }
                    break;
                case 'ABORTADO_SIN_COINCIDENCIAS':
                    aviso(
                        a.accion === 'DESASIGNAR'
                            ? 'No se desasignó a ningún ausente: ninguna fila del archivo coincidió con un caso que ya estuviera en la remesa de origen. Revisá el archivo, la plantilla y la remesa de origen.'
                            : 'No se dio por pagado a ningún ausente: ninguna fila del archivo coincidió con un caso que ya estuviera en la remesa de origen. Revisá el archivo, la plantilla y la remesa de origen.',
                    );
                    break;
                case 'OMITIDO_SOLO_DATOS':
                    normal('Los ausentes no se tocaron: la plantilla solo actualiza datos, o el archivo no trajo importes');
                    break;
                case 'SIN_REMESA_ORIGEN':
                    (a.accion === 'IGNORAR' ? normal : aviso)('Los ausentes no se tocaron: la carga no tiene remesa de origen con la que compararlos');
                    break;
                case 'NO_LLEGO':
                    if (carga.cancelada === true || carga.resultado === 'FALLIDA') aviso('El cierre de los ausentes no corrió');
                    else if (carga.resultado != null) aviso('El cierre de los ausentes no llegó a terminar: mirá el aviso de la carga.');
                    break;
            }
            break;
        }
        case 'ACCIONES': {
            const partes = [
                cant(num(r.deudoresAfectados), 'caso afectado', 'casos afectados'),
                ...(num(r.comentariosCreados) > 0 ? [cant(num(r.comentariosCreados), 'comentario', 'comentarios')] : []),
                ...(num(r.contactosEliminados) > 0 ? [cant(num(r.contactosEliminados), 'contacto eliminado', 'contactos eliminados')] : []),
            ];
            normal(partes.join(' · '));
            si(num(r.saltadosCancelados), 'normal', 'caso cancelado se salteó', 'casos cancelados se saltearon');
            si(num(r.filasSinMatch), 'aviso', 'fila no encontró ningún caso', 'filas no encontraron ningún caso');
            break;
        }
        case 'MULTIRREGISTRO':
        case 'MULTIARCHIVO': {
            const movimientos = [
                [num(r.altas), 'alta', 'altas'],
                [num(r.actualizados), 'actualizado', 'actualizados'],
                [num(r.reasignados), 'reasignado', 'reasignados'],
                [num(r.desasignados), 'desasignado', 'desasignados'],
            ] as const;
            const partes = movimientos.filter(([n]) => n > 0).map(([n, uno, varios]) => cant(n, uno, varios));
            if (partes.length > 0) normal(partes.join(' · '));
            const bajas = num(r.bajas);
            if (bajas > 0) {
                const detalle = [
                    ...(num(r.bajasPago) > 0 ? [`${formatearNumero(num(r.bajasPago))} por pago`] : []),
                    ...(num(r.bajasRetiradas) > 0 ? [`${formatearNumero(num(r.bajasRetiradas))} ${plural(num(r.bajasRetiradas), 'retirada', 'retiradas')} por el cedente`] : []),
                ];
                normal(`${cant(bajas, 'baja', 'bajas')}${detalle.length > 0 ? `: ${detalle.join(', ')}` : ''}`);
            }
            si(num(r.bajasYaAplicadas), 'normal', 'baja por pago ya estaba aplicada y no se volvió a registrar', 'bajas por pago ya estaban aplicadas y no se volvieron a registrar');
            const sinMatch = num(r.bajasSinMatch);
            const ambiguas = num(r.bajasAmbiguas);
            if (sinMatch > 0 || ambiguas > 0) {
                aviso([
                    ...(sinMatch > 0 ? [cant(sinMatch, 'baja sin factura que coincida', 'bajas sin factura que coincida')] : []),
                    ...(ambiguas > 0 ? [cant(ambiguas, 'ambigua', 'ambiguas')] : []),
                ].join(', '));
            }
            si(num(r.casosDadosDeBaja), 'normal', 'caso quedó sin facturas vigentes y salió de gestión', 'casos quedaron sin facturas vigentes y salieron de gestión');
            break;
        }
        case 'MULTICLAVES': {
            const tramites = r.tramites;
            const partes: string[] = [];
            if (typeof tramites === 'number' && tramites > 0) {
                const sub = [
                    ...(typeof r.conCaso === 'number' ? [`${formatearNumero(r.conCaso)} con caso`] : []),
                    ...(typeof r.sinCaso === 'number' ? [`${formatearNumero(r.sinCaso)} sin caso`] : []),
                ];
                partes.push(`${cant(tramites, 'trámite', 'trámites')}${sub.length > 0 ? `: ${sub.join(', ')}` : ''}`);
            }
            const ya = num(r.yaCargadas);
            if (ya > 0) partes.push(`${formatearNumero(ya)} ${plural(ya, 'ya estaba cargado', 'ya estaban cargados')}`);
            if (partes.length > 0) normal(partes.join(' · '));
            break;
        }
        default:
            // Un tipo que este frontend no conoce (un backend más nuevo): no se dibuja nada.
            return [];
    }
    return out;
}
