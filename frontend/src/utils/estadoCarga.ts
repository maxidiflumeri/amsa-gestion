// Funciones puras del progreso de las importaciones. Las comparten el hook useEstadoCarga, los
// contextos y los componentes (wizard, detalle, campanita). Textos: docs/imports-progreso-realtime-spec.md §8.8.8 y §9.8.2.
import { isAxiosError } from 'axios';
import type { EstadoCargaDto } from '../types/importProgreso';
import type { CodigoErrorImport, ErrorDeCargaDto } from '../types/importHistorial';
import type { StatusValue } from '../components/ui';

/** Cada cuánto consulta el hook de una carga cuando el socket está caído. */
export const POLL_MS = 10_000;
/** Cada cuánto consulta la campanita cuando el socket está caído. */
export const POLL_LISTA_MS = 15_000;
/** Un socket conectado pero sin novedades por este tiempo se considera sospechoso: se consulta por HTTP. */
export const SILENCIO_MS = 30_000;
/** Cuánto tiene que durar la desconexión para mostrar el ícono de la barra superior (evita el parpadeo). */
export const GRACIA_INDICADOR_MS = 5_000;
/** Minutos sin señal del servidor (latido) a partir de los cuales la pantalla avisa. El latido es cada 15 s. */
export const SIN_SENAL_MIN = 2;
/** Minutos que una carga en cola como "la próxima" puede esperar sin que el servidor la tome antes de avisar. */
export const EN_COLA_SIN_TOMAR_MIN = 2;
/** Minutos sin que este navegador vea cambiar la fase, la subfase ni los contadores antes de avisar. */
export const SIN_CAMBIOS_MIN = 10;

/** Minutos que una cancelación pedida puede tardar en cortar antes de que la pantalla avise que no se honró (§10.8.4). */
export const CANCELACION_SIN_CORTAR_MIN = 2;

/** Minutos sin señal a partir de los cuales el aviso admite que el cierre automático no está ocurriendo. */
export const SIN_SENAL_AVISAR_MIN = 15;
/** Mínimo entre refrescos disparados por eventos de otras cargas (posición en la cola). */
export const REFRESCO_COLA_MS = 5_000;

/**
 * Limita una acción a una por `minMs`, con flanco de bajada: un pedido que cae dentro de la ventana no se
 * pierde, se programa para cuando la ventana cierra. `cancelar` apaga el que esté programado.
 */
export function crearRefrescoLimitado(accion: () => void, minMs: number) {
    let ultimo = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    return {
        pedir() {
            const ahora = Date.now();
            const espera = ultimo + minMs - ahora;
            if (espera <= 0) {
                if (timer) clearTimeout(timer);
                timer = null;
                ultimo = ahora;
                accion();
            } else if (timer === null) {
                timer = setTimeout(() => {
                    timer = null;
                    ultimo = Date.now();
                    accion();
                }, espera);
            }
        },
        cancelar() {
            if (timer) clearTimeout(timer);
            timer = null;
        },
    };
}

/** Cada cuánto consulta el Historial cuando no hay ninguna carga en curso a la vista (primera página, sin búsqueda). */
export const REFRESCO_HISTORIAL_QUIETO_MS = 60_000;

/** La palabra en singular si `n` es 1; si no, en plural ("fila" / "filas"). */
export function plural(n: number, uno: string, varios: string): string {
    return n === 1 ? uno : varios;
}

/** Número con separador de miles (es-AR). */
export function formatearNumero(n: number | null | undefined): string {
    // Un DTO de un backend viejo puede traer el campo sin definir: nunca tira, muestra 0.
    return typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('es-AR') : '0';
}

/** "menos de 1 min" · "~N min" · "~H h M min". */
export function formatearEspera(segundos: number): string {
    if (!Number.isFinite(segundos)) return 'menos de 1 min';
    const minutos = Math.round(segundos / 60);
    if (segundos < 60 || minutos < 1) return 'menos de 1 min';
    if (minutos < 60) return `~${minutos} min`;
    return `~${Math.floor(minutos / 60)} h ${minutos % 60} min`;
}

/** Megabytes con un decimal ("12,4"). */
export function formatearMegas(bytes: number): string {
    return ((Number.isFinite(bytes) ? bytes : 0) / 1_048_576).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Tamaño legible: en KB por debajo de 0,1 MB, en MB desde ahí. */
function formatearTamano(bytes: number): string {
    if (bytes < 104_858) {
        const kb = Math.round(bytes / 1024);
        return kb < 1 ? 'menos de 1 KB' : `${kb.toLocaleString('es-AR')} KB`;
    }
    return `${formatearMegas(bytes)} MB`;
}

/** Lo que se sabe de la subida de los archivos (no es una fase de la carga: es un estado de la pantalla). */
export interface ProgresoSubida {
    enviados: number;
    /** 0 = el navegador no sabe el tamaño total. */
    total: number;
}

/** Texto de la subida (§9.8.2). Con el total desconocido, sin porcentaje y solo los MB enviados. */
export function textoSubida(subida: ProgresoSubida): {
    principal: string;
    secundario: string;
    porcentaje: number | null;
} {
    if (subida.total > 0 && subida.enviados >= subida.total) {
        return {
            principal: 'Armando la vista previa…',
            secundario: 'El servidor está leyendo el archivo.',
            porcentaje: null,
        };
    }
    // Antes del primer byte enviado no se muestran cantidades: nunca un byte que no se envió.
    if (!(subida.enviados > 0)) {
        return {
            principal: 'Subiendo archivos…',
            secundario: '',
            porcentaje: subida.total > 0 ? 0 : null,
        };
    }
    if (subida.total > 0) {
        const porcentaje = Math.min(100, Math.floor((subida.enviados / subida.total) * 100));
        return {
            principal: `Subiendo archivos… ${porcentaje} %`,
            secundario: `${formatearTamano(subida.enviados)} de ${formatearTamano(subida.total)}`,
            porcentaje,
        };
    }
    return {
        principal: 'Subiendo archivos…',
        secundario: `${formatearTamano(subida.enviados)} enviados`,
        porcentaje: null,
    };
}

/** Descartadas de la vista previa por el filtro de la plantilla: el total menos las de otro corte. */
export function descartadasPorFiltroEnVistaPrevia(v: { descartadas?: number | null; fueraDeCorte?: number | null }): number {
    return Math.max(0, (v.descartadas ?? 0) - (v.fueraDeCorte ?? 0));
}

/** Todo lo que entra por socket pasa por acá antes de usarse: un payload con la forma vieja se ignora. */
export function esEstadoCarga(valor: unknown): valor is EstadoCargaDto {
    if (typeof valor !== 'object' || valor === null) return false;
    const v = valor as Record<string, unknown>;
    return (
        typeof v.remesaId === 'number' &&
        typeof v.rev === 'number' &&
        typeof v.terminal === 'boolean' &&
        typeof v.enCurso === 'boolean'
    );
}

/**
 * Devuelve `nuevo` si no había nada o si no es más viejo que `actual`; si no, `actual`.
 * Impide que una respuesta HTTP vieja pise un evento de socket más nuevo.
 */
export function fusionarEstadoCarga(
    actual: EstadoCargaDto | null,
    nuevo: EstadoCargaDto,
): EstadoCargaDto {
    if (actual === null || nuevo.rev >= actual.rev) return nuevo;
    return actual;
}

export interface EtiquetaFase {
    principal: string;
    secundario: string | null;
}

/**
 * Texto de la fase (§9.8.2). `contexto` solo cambia el BORRADOR: en el paso "Importando" del wizard es
 * "Enviando a la cola…" (todavía no hay estado o recién se confirmó); en el detalle es un borrador sin confirmar.
 * Los campos de la Fase B pueden no venir (backend de la Fase A): se leen con `== null`.
 */
export function etiquetaFase(
    estado: (Pick<EstadoCargaDto, 'fase'> & Partial<Pick<EstadoCargaDto, 'subfase' | 'enColaDelante'>>) | null,
    contexto: 'wizard' | 'detalle' = 'detalle',
): EtiquetaFase {
    if (estado === null) return { principal: 'Enviando a la cola…', secundario: null };
    switch (estado.fase) {
        case 'BORRADOR':
            return contexto === 'wizard'
                ? { principal: 'Enviando a la cola…', secundario: null }
                : { principal: 'Borrador', secundario: 'Vista previa sin confirmar. No se cargó nada.' };
        case 'EN_COLA': {
            const delante = estado.enColaDelante;
            if (delante == null) {
                return { principal: 'En cola', secundario: 'Esperando que termine otra importación.' };
            }
            if (delante <= 0) return { principal: 'En cola', secundario: 'Es la próxima: empieza en instantes.' };
            if (delante === 1) return { principal: 'En cola', secundario: 'Hay 1 importación antes que esta.' };
            return { principal: 'En cola', secundario: `Hay ${formatearNumero(delante)} importaciones antes que esta.` };
        }
        case 'LEYENDO':
            return { principal: 'Leyendo el archivo', secundario: 'Todavía no se procesó ninguna fila.' };
        case 'PROCESANDO':
            return { principal: 'Procesando', secundario: null };
        case 'POST_PROCESO':
            return {
                principal: 'Post-proceso',
                secundario:
                    estado.subfase != null && estado.subfase !== ''
                        ? estado.subfase
                        : 'Consolidando y cerrando la carga. Puede tardar varios minutos.',
            };
        default:
            return { principal: estado.fase, secundario: null };
    }
}

/** Filas que descartó el filtro de la plantilla. Respaldo para un backend de la Fase A: el total. */
export function descartadasPorFiltro(
    estado: Pick<EstadoCargaDto, 'descartadas'> & Partial<Pick<EstadoCargaDto, 'descartadasPorFiltro'>>,
): number {
    return estado.descartadasPorFiltro ?? estado.descartadas;
}

/** Filas de otro corte de la división. 0 si la remesa no tiene corte o la carga es anterior a la Fase B. */
export function descartadasFueraDeCorte(estado: Partial<Pick<EstadoCargaDto, 'fueraDeCorte'>>): number {
    return estado.fueraDeCorte ?? 0;
}

/** Casos que creó la carga; null si la categoría (o el backend) no lo informa: la pantalla no muestra un cero. */
export function casosNuevos(estado: Partial<Pick<EstadoCargaDto, 'nuevos'>>): number | null {
    return estado.nuevos ?? null;
}

/** Casos que ya existían y la carga tocó; null si no se informa. */
export function casosActualizados(estado: Partial<Pick<EstadoCargaDto, 'actualizados'>>): number | null {
    return estado.actualizados ?? null;
}

function esNumero(n: unknown): n is number {
    return typeof n === 'number' && Number.isFinite(n);
}

/** "≈ 34 filas/s · faltan ~4 min para terminar las filas". Null si no hay velocidad. */
export function lineaDeRitmo(estado: Partial<Pick<EstadoCargaDto, 'velocidad' | 'etaSegundos'>>): string | null {
    if (!esNumero(estado.velocidad)) return null;
    const velocidad = estado.velocidad.toLocaleString('es-AR', { maximumFractionDigits: 1 });
    const base = `≈ ${velocidad} filas/s`;
    if (!esNumero(estado.etaSegundos)) return base;
    return `${base} · faltan ${formatearEspera(estado.etaSegundos)} para terminar las filas`;
}

/** Espera abreviada para la campanita ("faltan ~4 min"). Null si no hay ETA. */
export function esperaAbreviada(estado: Partial<Pick<EstadoCargaDto, 'etaSegundos'>>): string | null {
    return esNumero(estado.etaSegundos) ? `faltan ${formatearEspera(estado.etaSegundos)}` : null;
}

export type SeveridadResultado = 'success' | 'warning' | 'error' | 'info';

export interface ResultadoPresentado {
    severidad: SeveridadResultado;
    titulo: string;
    detalle: string | null;
}

function sinPuntoFinal(texto: string): string {
    return texto.trim().replace(/[.\s]+$/, '');
}

/**
 * Qué quedó sin hacer cuando el post-proceso (`afterAll` del processor de la categoría) no terminó, y qué
 * hacer. Verificado contra `backend/src/modules/imports/processors/*.processor.ts`. Donde no se puede
 * afirmar un remedio con certeza, el texto dice qué quedó pendiente y manda a soporte.
 */
export function pendientePostProceso(tipo: string): string {
    switch (tipo) {
        case 'PAGOS':
            return 'Quedó sin hacer el recálculo de saldo y situación de los casos que recibieron pagos, y el cierre de las promesas cumplidas. Consolidá desde el Historial cada remesa de deudores que elegiste como origen al importar (no la de pagos: no tiene casos propios); si no te acordás cuáles fueron, o el detalle trae el aviso CASO_FUERA_DE_REMESA_ORIGEN, avisá a soporte. Las promesas las resuelve soporte.';
        case 'ACTUALIZACIONES':
            return 'Quedó sin hacer, o a medias, el cierre de los ausentes del archivo (según la plantilla: darlos por pagados, desasignarlos o nada), la consolidación de los casos y el cierre de las promesas cumplidas. Avisá a soporte.';
        case 'FACTURAS':
            return 'Quedó sin hacer el cálculo del importe de los casos desde sus facturas (salvo que la plantilla diga «No calcular»), la unión de los datos adicionales del archivo y la consolidación. Los casos que vinieron sin importe pueden haber quedado sin él. Avisá a soporte.';
        case 'DEUDORES_Y_FACTURAS':
            return 'Quedó sin hacer el cálculo del importe de los casos desde sus facturas (salvo que la plantilla diga «No calcular») y la consolidación. Los casos que vinieron sin importe pueden haber quedado sin él. Avisá a soporte.';
        case 'MULTIRREGISTRO':
            return 'Quedó sin hacer la consolidación de los casos tocados y el cierre de las promesas cumplidas. Avisá a soporte.';
        case 'MULTIARCHIVO':
            return 'Quedó sin hacer el cierre de los ausentes (desasignarlos, solo si la plantilla tiene activada la desasignación), la consolidación de los casos tocados y el cierre de las promesas cumplidas. Avisá a soporte.';
        case 'ACCIONES':
            return 'El cierre de la acción no terminó. Antes de deshacerla, abrí Revertir: el diálogo dice si se puede y cuánto cubre; si no se puede, avisá a soporte.';
        case 'MULTICLAVES':
            return 'Pudo quedar sin hacer la re-consolidación de los casos que ya tenían pagos con estas claves. Avisá a soporte.';
        case 'DEUDORES':
        case 'CONTACTOS':
        case 'ENRIQUECIMIENTO':
            return 'En esta categoría el cierre solo limpia datos internos: lo que se cargó quedó completo. Avisá a soporte con el motivo.';
        default:
            return 'Quedó pendiente el cierre de la carga. Avisá a soporte con el motivo.';
    }
}

/**
 * Las oraciones de «el archivo no tenía filas»: las que descartó el filtro de la plantilla y las de otros cortes de la
 * división, cada una con su singular. Las usan `presentarResultado` y el cartel de la vista previa del asistente.
 */
export function oracionesSinFilas(porFiltro: number, fuera: number): string[] {
    const oraciones: string[] = [];
    if (porFiltro > 0) {
        oraciones.push(
            porFiltro === 1
                ? 'El filtro de la plantilla descartó la única fila.'
                : `El filtro de la plantilla descartó las ${formatearNumero(porFiltro)} filas.`,
        );
    }
    if (fuera > 0) {
        oraciones.push(
            fuera === 1
                ? '1 fila es de otro corte de la división.'
                : `${formatearNumero(fuera)} filas son de otros cortes de la división.`,
        );
    }
    return oraciones;
}

/** Título, severidad y detalle del resultado de una carga terminada (§8.8.8). */
export function presentarResultado(
    estado: Pick<
        EstadoCargaDto,
        'resultado' | 'ok' | 'err' | 'procesadas' | 'descartadas' | 'error' | 'errorPostProceso' | 'tipo'
    > &
        Partial<Pick<EstadoCargaDto, 'descartadasPorFiltro' | 'fueraDeCorte' | 'cancelada' | 'interrumpidaPorReinicio'>>,
): ResultadoPresentado {
    // Una cancelada viaja como FALLIDA (§10.4.2): se mira antes del switch. Su `error` ya trae los párrafos y
    // el número exacto de filas cargadas: se muestra tal cual, sin el "Antes del corte se cargaron al menos…".
    if (estaCancelada(estado)) {
        return { severidad: 'warning', titulo: 'Importación cancelada', detalle: estado.error ? estado.error : null };
    }
    // Cortada por un reinicio (C3c): FALLIDA con números exactos en `error`, sin el "al menos" de la fallida común.
    if (estaInterrumpidaPorReinicio(estado)) {
        return {
            severidad: 'warning',
            titulo: 'Importación interrumpida por un reinicio del servidor',
            detalle: estado.error ? estado.error : null,
        };
    }
    switch (estado.resultado) {
        case 'OK':
            return { severidad: 'success', titulo: 'Importación exitosa', detalle: null };
        case 'CON_ERRORES':
            if (estado.ok > 0) {
                return {
                    severidad: 'warning',
                    titulo: 'Importación finalizada con filas con error',
                    detalle: `${formatearNumero(estado.err)} de ${formatearNumero(estado.procesadas)} filas ${estado.err === 1 ? 'no se cargó' : 'no se cargaron'}. Mirá el motivo de cada una en el detalle.`,
                };
            }
            return {
                severidad: 'error',
                titulo: 'No se cargó ninguna fila',
                detalle: estado.err === 1 ? 'La única fila dio error.' : `Las ${formatearNumero(estado.err)} filas dieron error.`,
            };
        case 'SIN_FILAS': {
            const oraciones = oracionesSinFilas(descartadasPorFiltro(estado), descartadasFueraDeCorte(estado));
            return {
                severidad: 'warning',
                titulo: 'El archivo no tenía filas para procesar',
                detalle: oraciones.length > 0 ? oraciones.join(' ') : null,
            };
        }
        case 'CON_ADVERTENCIAS': {
            const motivo = estado.errorPostProceso ? `: ${sinPuntoFinal(estado.errorPostProceso)}` : '';
            const cargadas = `${estado.ok === 1 ? 'Se cargó' : 'Se cargaron'} ${formatearNumero(estado.ok)} ${plural(estado.ok, 'fila', 'filas')}`;
            const filas =
                estado.err > 0
                    ? `${cargadas} y ${formatearNumero(estado.err)} ${plural(estado.err, 'dio', 'dieron')} error.`
                    : `${cargadas}.`;
            return {
                severidad: 'warning',
                titulo: 'Importación finalizada con advertencias',
                detalle: `${filas} Pero el post-proceso no terminó${motivo}. ${pendientePostProceso(estado.tipo)} No hace falta volver a subir el archivo.`,
            };
        }
        case 'FALLIDA': {
            const motivo = estado.error ? sinPuntoFinal(estado.error) : 'No se informó el motivo';
            // En ACTUALIZACIONES y FACTURAS `ok` solo avanza al cerrar cada lote: tras un corte es un piso. El motivo puede
            // traer varios párrafos (\n\n); esta oración va en el suyo.
            const cargadas =
                estado.ok > 0
                    ? `\n\nAntes del corte ${estado.ok === 1 ? 'se cargó' : 'se cargaron'} al menos ${formatearNumero(estado.ok)} ${plural(estado.ok, 'fila', 'filas')}${estado.err > 0 ? ` y ${formatearNumero(estado.err)} ${plural(estado.err, 'dio', 'dieron')} error` : ''}; el cierre de la carga no corrió.`
                    : '';
            return {
                severidad: 'error',
                titulo: 'La importación falló',
                detalle: `${motivo}.${cargadas}`,
            };
        }
        default:
            return { severidad: 'info', titulo: 'Importación finalizada', detalle: null };
    }
}

/** Orden de gravedad para elegir el encabezado del resumen: menor número = peor. Una cancelada va entre FALLIDA y CON_ADVERTENCIAS. */
function rangoGravedad(
    estado: Pick<EstadoCargaDto, 'resultado' | 'ok'> & Partial<Pick<EstadoCargaDto, 'cancelada' | 'interrumpidaPorReinicio'>>,
): number {
    if (estaCancelada(estado) || estaInterrumpidaPorReinicio(estado)) return 1;
    switch (estado.resultado) {
        case 'FALLIDA':
            return 0;
        case 'CON_ADVERTENCIAS':
            return 2;
        case 'CON_ERRORES':
            return estado.ok === 0 ? 3 : 5;
        case 'SIN_FILAS':
            return 4;
        case 'OK':
            return 6;
        default:
            return 7;
    }
}

/** La remesa de peor resultado de la lista (la primera en caso de empate). Null si la lista está vacía. */
export function peorResultado(estados: EstadoCargaDto[]): EstadoCargaDto | null {
    let peor: EstadoCargaDto | null = null;
    for (const e of estados) {
        if (peor === null || rangoGravedad(e) < rangoGravedad(peor)) peor = e;
    }
    return peor;
}

/**
 * La barra no puede mostrar un porcentaje honesto: en cola, en post-proceso, procesando sin total
 * conocido, o una fase que el cliente no conoce.
 */
export function barraIndeterminada(
    estado: Pick<EstadoCargaDto, 'fase' | 'terminal' | 'totalEsperado'> | null,
): boolean {
    if (estado === null) return true;
    if (estado.terminal) return false;
    if (estado.fase === 'PROCESANDO') return estado.totalEsperado <= 0;
    return true;
}

/** Edad en minutos (enteros) de un instante del servidor, medida con la hora del servidor del DTO más lo transcurrido desde que se recibió. */
function minutosDesdeServidor(
    servidorAhora: string | undefined,
    referencia: string | null | undefined,
    recibidoEn: number,
    ahora: number,
): number | null {
    const servidor = servidorAhora ? Date.parse(servidorAhora) : NaN;
    const instante = referencia ? Date.parse(referencia) : NaN;
    if (Number.isNaN(servidor) || Number.isNaN(instante)) return null;
    const edadMs = servidor - instante + Math.max(0, ahora - recibidoEn);
    return Math.max(0, Math.floor(edadMs / 60_000));
}

/**
 * Minutos (enteros) sin señal del servidor de una carga LEYENDO, PROCESANDO o POST_PROCESO. La edad del último
 * latido se mide con la hora del servidor (`servidorAhora − (heartbeatAt ?? startedAt)`, en el momento de
 * recibir el DTO) más lo transcurrido en el cliente desde que se recibió: no depende de que el reloj de la PC
 * coincida con el del servidor y avisa enseguida al abrir una carga ya colgada. Si el DTO no trae
 * `servidorAhora`, se cae a medir desde que este navegador vio por última vez una novedad (`vistoEn`).
 * Null si no aplica.
 */
export function minutosSinSenal(
    estado: Pick<EstadoCargaDto, 'fase' | 'enCurso' | 'heartbeatAt' | 'startedAt'> & { servidorAhora?: string },
    recibidoEn: number,
    vistoEn: number,
    ahora: number,
): number | null {
    if (!estado.enCurso || !(estado.fase === 'LEYENDO' || estado.fase === 'PROCESANDO' || estado.fase === 'POST_PROCESO')) {
        return null;
    }
    const medido = minutosDesdeServidor(estado.servidorAhora, estado.heartbeatAt ?? estado.startedAt, recibidoEn, ahora);
    if (medido !== null) return medido;
    return Math.max(0, Math.floor(Math.max(0, ahora - vistoEn) / 60_000));
}

/**
 * Minutos que lleva en la cola una carga que es "la próxima" (`enColaDelante === 0`), medidos desde que ESTA pantalla
 * la vio como la próxima (`proximaDesde`, epoch ms): una carga que esperó 30 minutos detrás de otra no está "sin tomar"
 * desde hace 30. Con la posición desconocida (`null`/`undefined`) devuelve null: no se avisa de lo que no se sabe.
 */
export function minutosEnColaSinTomar(
    estado: Pick<EstadoCargaDto, 'fase' | 'enCurso'> & Partial<Pick<EstadoCargaDto, 'enColaDelante'>>,
    proximaDesde: number | null,
    ahora: number,
): number | null {
    if (!estado.enCurso || estado.fase !== 'EN_COLA' || estado.enColaDelante !== 0 || proximaDesde === null) return null;
    return Math.max(0, Math.floor((ahora - proximaDesde) / 60_000));
}

/** Lo que cuenta como "avance" para el aviso de "sin cambios": si no cambia en 10 minutos, se avisa. */
export function firmaDeAvance(
    estado: Pick<EstadoCargaDto, 'remesaId' | 'fase' | 'procesadas' | 'ok' | 'err'> & Partial<Pick<EstadoCargaDto, 'subfase'>>,
): string {
    return `${estado.remesaId}|${estado.fase}|${estado.subfase ?? ''}|${estado.procesadas}|${estado.ok}|${estado.err}`;
}

/** Resultados que se muestran como advertencia en una notificación (ícono y toast). */
export function resultadoEsAdvertencia(resultado: unknown): boolean {
    return resultado === 'CON_ADVERTENCIAS' || resultado === 'CON_ERRORES' || resultado === 'SIN_FILAS';
}

/** Filas de `importerror` que son avisos de la carga y no errores de una fila (rowNumber 0 ≠ aviso: la primera fila de datos también es 0). */
export function esAvisoDeCarga(errorMsg: unknown): boolean {
    return typeof errorMsg === 'string' && /^\[(aviso|parseo|post-proceso)\]/i.test(errorMsg);
}

// ─── Fase C, entrega 1: carga dividida, cancelar y retomar (docs/imports-progreso-realtime-spec.md §10.8) ───
// Todo campo nuevo del DTO puede llegar `undefined` desde un backend de la Fase B: se lee con `== null` y
// siempre a través de estas funciones. El frontend no calcula si algo es cancelable o retomable: lo manda el backend.

/** La carga terminó por una cancelación. */
export function estaCancelada(estado: Partial<Pick<EstadoCargaDto, 'cancelada'>>): boolean {
    return estado.cancelada === true;
}

/** La carga la cortó un reinicio ordenado del servidor (C3c). Una cancelada del usuario nunca cuenta como tal. */
export function estaInterrumpidaPorReinicio(
    estado: Partial<Pick<EstadoCargaDto, 'cancelada' | 'interrumpidaPorReinicio'>>,
): boolean {
    return estado.interrumpidaPorReinicio === true && estado.cancelada !== true;
}

/** El backend dice que se puede pedir la cancelación ahora. */
export function esCancelable(estado: Partial<Pick<EstadoCargaDto, 'cancelable'>>): boolean {
    return estado.cancelable === true;
}

/** El backend dice que se puede volver a encolar tal cual (no cargó ninguna fila). */
export function esRetomable(estado: Partial<Pick<EstadoCargaDto, 'retomable'>>): boolean {
    return estado.retomable === true;
}

/** Cuándo se pidió cancelar, o null si nadie lo pidió (o el backend no informa el campo). */
export function cancelacionPedidaAt(estado: Partial<Pick<EstadoCargaDto, 'cancelacionPedidaAt'>>): string | null {
    return estado.cancelacionPedidaAt ?? null;
}

export interface DatosDeGrupo {
    grupoId: string;
    orden: number | null;
    total: number | null;
}

/** Los datos del grupo de una carga dividida, o null si la carga no es de un grupo. */
export function datosDeGrupo(
    estado: Partial<Pick<EstadoCargaDto, 'grupoId' | 'grupoOrden' | 'grupoTotal'>>,
): DatosDeGrupo | null {
    if (estado.grupoId == null) return null;
    return { grupoId: estado.grupoId, orden: estado.grupoOrden ?? null, total: estado.grupoTotal ?? null };
}

/** Cancelar y retomar piden `importacion.ejecutar`, y ser el dueño de la carga o tener `importacion.ver_progreso_otros`. */
export function puedeGestionarCarga(
    estado: Pick<EstadoCargaDto, 'usuarioId'>,
    usuarioId: number | null | undefined,
    tienePermiso: (key: string) => boolean,
): boolean {
    if (!tienePermiso('importacion.ejecutar')) return false;
    return (usuarioId != null && estado.usuarioId === usuarioId) || tienePermiso('importacion.ver_progreso_otros');
}

/**
 * Por qué una carga en curso no se puede cancelar ahora (§10.8.4). Null si no hay nada que explicar: la carga no
 * está en curso, el backend no informa `cancelable` o es cancelable.
 */
export function motivoNoCancelable(
    estado: Pick<EstadoCargaDto, 'enCurso' | 'fase' | 'tipo'> & Partial<Pick<EstadoCargaDto, 'cancelable' | 'cancelacionPedidaAt'>>,
): string | null {
    if (!estado.enCurso || estado.cancelable !== false) return null;
    if (cancelacionPedidaAt(estado) !== null) return 'Ya se pidió cancelar.';
    if (estado.fase === 'POST_PROCESO') {
        return 'La importación ya procesó todas las filas y está cerrando: en este paso no se puede cancelar.';
    }
    if (estado.tipo === 'ACCIONES' && estado.fase !== 'EN_COLA' && estado.fase !== 'BORRADOR') {
        return 'Una acción masiva que ya empezó no se cancela: esperá a que termine y usá Revertir.';
    }
    return null;
}

/**
 * Minutos (enteros) desde que se pidió cancelar, con la hora del servidor del DTO (como los otros avisos).
 * Null si nadie pidió cancelar.
 */
export function minutosDesdePedidoCancelacion(
    estado: Partial<Pick<EstadoCargaDto, 'cancelacionPedidaAt' | 'servidorAhora'>>,
    recibidoEn: number,
    ahora: number,
): number | null {
    return minutosDesdeServidor(estado.servidorAhora, estado.cancelacionPedidaAt, recibidoEn, ahora);
}

/**
 * El pedido de cancelación llegó cuando la carga ya estaba cerrando y terminó completa. Una FALLIDA no cuenta: si
 * murió por una interrupción con el pedido escrito, no "terminó completa".
 */
export function cancelacionLlegoTarde(
    estado: Pick<EstadoCargaDto, 'terminal' | 'resultado'> & Partial<Pick<EstadoCargaDto, 'cancelacionPedidaAt' | 'cancelada'>>,
): boolean {
    return estado.terminal && cancelacionPedidaAt(estado) !== null && !estaCancelada(estado) && estado.resultado !== 'FALLIDA';
}

/** Texto del pedido de cancelación que llegó tarde: solo dice "terminó completa" si el resultado es OK. */
export function textoCancelacionTardia(resultado: EstadoCargaDto['resultado']): string {
    return resultado === 'OK'
        ? 'Se pidió cancelar esta importación cuando ya estaba cerrando: terminó completa.'
        : 'Se pidió cancelar esta importación cuando ya estaba cerrando: el pedido llegó tarde y la carga terminó igual.';
}

/** Línea del diálogo de cancelar según la categoría, resumida de los textos de la notificación (§10.5.8). */
export function lineaCancelarPorCategoria(tipo: string): string {
    switch (tipo) {
        case 'DEUDORES':
        case 'DEUDORES_Y_FACTURAS':
            return 'Para cargarla completa después, vas a tener que eliminar esta importación desde el Historial y volver a subir el archivo.';
        case 'ACTUALIZACIONES':
            return 'Los casos ausentes del archivo no se tocan y los casos no se consolidan. Antes de volver a cargar el archivo, avisá a soporte.';
        default:
            return 'Antes de volver a cargar el archivo, avisá a soporte.';
    }
}

export type ColorChipEstado = 'default' | 'success' | 'warning' | 'error' | 'info';

/** Qué dice de una remesa la lista de la división, los chips del detalle y el Historial: una sola etiqueta (docs/imports-progreso-c2-spec.md §16.5). */
export interface EtiquetaDeEstado {
    etiqueta: string;
    /** Para `StatusChip` (Historial). */
    status: StatusValue;
    /** Para un `Chip` de MUI (asistente y detalle). */
    color: ColorChipEstado;
    /** Segunda línea bajo el chip. */
    secundaria: string | null;
    /** Título (y primera línea del motivo) para el tooltip del chip, en las terminales con algo que decir. */
    tooltip: string | null;
}

function colorDeStatus(status: StatusValue): ColorChipEstado {
    switch (status) {
        case 'completed':
        case 'success':
            return 'success';
        case 'failed':
        case 'error':
            return 'error';
        case 'warning':
            return 'warning';
        case 'running':
        case 'info':
            return 'info';
        default:
            return 'default';
    }
}

/** Título del resultado y primera línea de su motivo (el porqué entero está en el detalle). */
function tooltipDeResultado(carga: EstadoCargaDto): string {
    const r = presentarResultado(carga);
    const primera = (r.detalle ?? '').split('\n').find((l) => l.trim() !== '');
    return primera ? `${r.titulo}. ${primera.trim()}` : r.titulo;
}

/**
 * Qué dice el Historial de una remesa (tabla de §6.3 de docs/imports-progreso-c2-spec.md). Se evalúa en orden y gana
 * la primera que se cumple. Nunca muestra el `estadoProceso` crudo: no distingue un borrador de una en cola ni una
 * cancelada de una fallida. `pendienteDeEncolar` solo lo conoce el Historial.
 */
export function etiquetaDeEstado(
    carga: EstadoCargaDto,
    opciones: { pendienteDeEncolar?: unknown | null } = {},
): EtiquetaDeEstado {
    const armar = (etiqueta: string, status: StatusValue, secundaria: string | null = null, tooltip: string | null = null): EtiquetaDeEstado => ({
        etiqueta,
        status,
        color: colorDeStatus(status),
        secundaria,
        tooltip,
    });
    const c = carga;
    if (!c.enCurso && !c.terminal) {
        if (opciones.pendienteDeEncolar != null) {
            return armar('No se pudo encolar', 'warning', 'Se confirmó y la cola de trabajos no respondió. No se cargó nada.');
        }
        return armar('Borrador', 'pending', 'Vista previa sin confirmar.');
    }
    if (c.enCurso) {
        if (cancelacionPedidaAt(c) !== null) return armar('Cancelando…', 'warning');
        if (c.fase === 'EN_COLA') return armar('En cola', 'pending', etiquetaFase(c).secundario);
        if (c.fase === 'PROCESANDO' && c.totalEsperado > 0) {
            const partes = [`${formatearNumero(c.procesadas)} de ${formatearNumero(c.totalEsperado)}`];
            const espera = esperaAbreviada(c);
            if (espera !== null) partes.push(espera);
            return armar(`Procesando ${c.progreso} %`, 'running', partes.join(' · '));
        }
        const f = etiquetaFase(c);
        return armar(f.principal, 'running', f.secundario);
    }
    // Terminal.
    const conTooltip = (etiqueta: string, status: StatusValue) => armar(etiqueta, status, null, tooltipDeResultado(c));
    if (estaCancelada(c)) return conTooltip(c.startedAt == null ? 'Cancelada antes de empezar' : 'Cancelada', 'warning');
    if (estaInterrumpidaPorReinicio(c)) return conTooltip('Interrumpida por un reinicio', 'warning');
    switch (c.resultado) {
        case 'FALLIDA':
            return c.startedAt == null ? conTooltip('No llegó a empezar', 'failed') : conTooltip('Fallida', 'failed');
        case 'CON_ADVERTENCIAS':
            return conTooltip('Con advertencias', 'warning');
        case 'CON_ERRORES':
            return c.ok > 0 ? conTooltip('Finalizada con errores', 'warning') : conTooltip('Sin filas cargadas', 'failed');
        case 'SIN_FILAS':
            return conTooltip('Sin filas', 'warning');
        case 'OK':
            return armar('Finalizada', 'completed');
        default:
            return armar('Finalizada', 'neutral');
    }
}

// ─── Fase C, entrega 2b: la tarjeta de progreso (docs/imports-progreso-c2-spec.md §16.4) ───

export type EstadoPaso = 'hecho' | 'actual' | 'pendiente';
export interface PasoDeCarga {
    clave: 'EN_COLA' | 'PROCESANDO' | 'POST_PROCESO' | 'LISTO';
    etiqueta: string;
    detalle: string | null;
    estado: EstadoPaso;
    error: boolean;
}

/** Los cuatro pasos de una carga y en cuál está. Null si la fase es una que el cliente no conoce: no se dibujan pasos. */
export function pasosDeCarga(carga: EstadoCargaDto | null): PasoDeCarga[] | null {
    const etiquetas: Array<[PasoDeCarga['clave'], string]> = [
        ['EN_COLA', 'En cola'],
        ['PROCESANDO', 'Procesando'],
        ['POST_PROCESO', 'Post-proceso'],
        ['LISTO', 'Listo'],
    ];
    let actual = -1;
    let detalle: string | null = null;
    if (carga === null || (!carga.terminal && carga.fase === 'BORRADOR')) {
        actual = 0;
        detalle = 'Enviando a la cola…';
    } else if (carga.terminal) {
        actual = 3;
    } else {
        switch (carga.fase) {
            case 'EN_COLA':
                actual = 0;
                detalle = etiquetaFase(carga).secundario;
                break;
            case 'LEYENDO':
                actual = 1;
                detalle = 'Leyendo el archivo';
                break;
            case 'PROCESANDO':
                actual = 1;
                detalle = barraIndeterminada(carga) ? null : `${carga.progreso} %`;
                break;
            case 'POST_PROCESO':
                actual = 2;
                break;
            default:
                return null;
        }
    }
    const etiquetaListo = carga !== null && carga.terminal ? etiquetaDeEstado(carga).etiqueta : null;
    const fallo = carga !== null && carga.terminal && (carga.resultado === 'FALLIDA' || estaCancelada(carga));
    return etiquetas.map(([clave, etiqueta], i) => ({
        clave,
        etiqueta: clave === 'LISTO' && etiquetaListo !== null ? etiquetaListo : etiqueta,
        detalle: i === actual ? detalle : null,
        estado: i < actual ? 'hecho' : i === actual ? 'actual' : 'pendiente',
        error: clave === 'LISTO' && fallo,
    }));
}

/** La barra del grupo de una división: cuántas terminaron de las que la división tiene (aunque alguna se haya eliminado). */
export function resumenDeGrupo(remesas: EstadoCargaDto[], total: number): { terminadas: number; total: number; porcentaje: number } {
    const terminadas = remesas.filter((r) => r.terminal).length;
    return { terminadas, total, porcentaje: total > 0 ? Math.round((terminadas / total) * 100) : 0 };
}

/** La barra fina de cada remesa de la división. */
export function barraDeRemesa(r: EstadoCargaDto): { variante: 'determinate' | 'indeterminate'; valor: number } {
    if (r.terminal) return { variante: 'determinate', valor: 100 };
    if (r.fase === 'EN_COLA' || r.fase === 'BORRADOR' || (!r.enCurso && !r.terminal)) return { variante: 'determinate', valor: 0 };
    if (!barraIndeterminada(r)) return { variante: 'determinate', valor: r.progreso };
    return { variante: 'indeterminate', valor: 0 };
}

const LARGO_ULTIMO_ERROR = 160;

/** Una línea de "Últimos errores y avisos": el rótulo (fila o aviso) y la primera línea del mensaje, recortada. */
export function lineaDeUltimoError(e: ErrorDeCargaDto): { rotulo: string; texto: string } {
    const rotulo = e.tipo === 'FILA' && e.fila != null ? `Fila ${formatearNumero(e.fila)}` : e.tipo === 'AVISO' ? 'Aviso' : 'Fila';
    const primera = (typeof e.errorMsg === 'string' ? e.errorMsg : '').split('\n').map((l) => l.trim()).find((l) => l !== '') ?? '';
    const texto = primera.length > LARGO_ULTIMO_ERROR ? `${primera.slice(0, LARGO_ULTIMO_ERROR - 1).trimEnd()}…` : primera;
    return { rotulo, texto };
}

/** La remesa que se está mostrando de un grupo: la primera en curso según `grupoOrden`; si no hay, la última. */
export function remesaActualDelGrupo(remesas: EstadoCargaDto[]): EstadoCargaDto | null {
    return remesas.find((r) => r.enCurso) ?? remesas[remesas.length - 1] ?? null;
}

/** Todas las remesas del grupo terminaron (y hay al menos una). */
export function grupoTerminado(remesas: EstadoCargaDto[]): boolean {
    return remesas.length > 0 && remesas.every((r) => r.terminal);
}

// ─── Fase C, entrega 2a: el Historial y los errores de una carga (docs/imports-progreso-c2-spec.md §6.1) ───

const CODIGOS_DE_ERROR: readonly string[] = ['CORTE_YA_CARGADO', 'CORTE_YA_CONFIRMADO', 'NINGUNA_RETOMABLE', 'NO_ES_PENDIENTE', 'ORIGEN_DISTINTO', 'REVERTIR_NO_TERMINO', 'REVERTIR_INCOMPLETO', 'REVERSION_EN_CURSO', 'REVERTIR_CARGA_EN_CURSO', 'REVERTIR_NADA', 'REVERSION_FALLIDA', 'REVERSION_NO_ENCOLADA'];

/** El `code` que el backend agrega al cuerpo de un 409 que la pantalla reconoce. Null si no hay, no se conoce o no es un error de axios. */
export function codigoDeError(err: unknown): CodigoErrorImport | null {
    if (!isAxiosError(err)) return null;
    const data: unknown = err.response?.data;
    if (typeof data !== 'object' || data === null) return null;
    const code = (data as { code?: unknown }).code;
    return typeof code === 'string' && CODIGOS_DE_ERROR.includes(code) ? (code as CodigoErrorImport) : null;
}

/** El diálogo de confirmación de retomar una remesa (el detalle y el Historial). */
export const TEXTO_RETOMAR_UNA = {
    title: 'Retomar la remesa',
    description: 'Se vuelve a encolar la misma remesa, con el mismo archivo. No se cargó ninguna fila la vez anterior.',
    confirmLabel: 'Retomar',
};

/** El diálogo de confirmación de retomar varias remesas de una carga dividida. */
export const TEXTO_RETOMAR_VARIAS = {
    title: 'Retomar las remesas',
    description: 'Se vuelven a encolar las mismas remesas, con el mismo archivo. No se cargó ninguna fila la vez anterior.',
    confirmLabel: 'Retomar',
};

/**
 * Por qué una carga terminada ya no se puede retomar aunque su fila diga que sí: el corte figura en otra remesa
 * confirmada después. Null si no hay nada que explicar. Es el texto del 409, sin «desde el Historial» (acá ya se está ahí).
 */
export function motivoNoRetomablePorCorte(carga: Partial<Pick<EstadoCargaDto, 'corteRepetidoEn'>>): string | null {
    const remesas = carga.corteRepetidoEn;
    if (!Array.isArray(remesas) || remesas.length === 0) return null;
    return `El corte de esta remesa ya figura en la remesa ${remesas.join(', ')}: no se puede retomar. Si esta ya no hace falta, eliminala.`;
}

// ─── Fase C, entrega 3a: Revertir una acción masiva (docs/imports-progreso-c3-spec.md §6.3) ───

/** La reversión no devolvió respuesta, pero puede seguir corriendo en el servidor. */
export const TEXTO_REVERSION_SIN_RESPUESTA =
    'No llegó la respuesta del servidor. La reversión puede seguir corriendo: actualizá el Historial en unos minutos antes de volver a intentar.';

/** El pedido no obtuvo respuesta del servidor (corte de red, timeout) o el proxy respondió 502, 503 o 504. */
export function respuestaPerdida(err: unknown): boolean {
    if (!isAxiosError(err)) return false;
    const status = err.response?.status;
    return !err.response || status === 502 || status === 503 || status === 504;
}
