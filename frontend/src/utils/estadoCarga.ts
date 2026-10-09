// Funciones puras del progreso de las importaciones. Las comparten el hook useEstadoCarga, los
// contextos y los componentes (wizard, detalle, campanita). Textos: docs/imports-progreso-realtime-spec.md §8.8.8 y §9.8.2.
import type { EstadoCargaDto } from '../types/importProgreso';

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
            return 'Quedaron sin guardar los datos que permiten revertir la acción. Avisá a soporte y no uses Revertir: puede deshacer solo una parte y se puede una sola vez.';
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

/** Título, severidad y detalle del resultado de una carga terminada (§8.8.8). */
export function presentarResultado(
    estado: Pick<
        EstadoCargaDto,
        'resultado' | 'ok' | 'err' | 'procesadas' | 'descartadas' | 'error' | 'errorPostProceso' | 'tipo'
    > &
        Partial<Pick<EstadoCargaDto, 'descartadasPorFiltro' | 'fueraDeCorte'>>,
): ResultadoPresentado {
    switch (estado.resultado) {
        case 'OK':
            return { severidad: 'success', titulo: 'Importación exitosa', detalle: null };
        case 'CON_ERRORES':
            if (estado.ok > 0) {
                return {
                    severidad: 'warning',
                    titulo: 'Importación finalizada con filas con error',
                    detalle: `${formatearNumero(estado.err)} de ${formatearNumero(estado.procesadas)} filas no se cargaron. Mirá el motivo de cada una en el detalle.`,
                };
            }
            return {
                severidad: 'error',
                titulo: 'No se cargó ninguna fila',
                detalle: `Las ${formatearNumero(estado.err)} filas dieron error.`,
            };
        case 'SIN_FILAS': {
            const porFiltro = descartadasPorFiltro(estado);
            const fuera = descartadasFueraDeCorte(estado);
            const oraciones: string[] = [];
            if (porFiltro > 0) oraciones.push(`El filtro de la plantilla descartó las ${formatearNumero(porFiltro)} filas.`);
            if (fuera > 0) oraciones.push(`${formatearNumero(fuera)} filas son de otros cortes de la división.`);
            return {
                severidad: 'warning',
                titulo: 'El archivo no tenía filas para procesar',
                detalle: oraciones.length > 0 ? oraciones.join(' ') : null,
            };
        }
        case 'CON_ADVERTENCIAS': {
            const motivo = estado.errorPostProceso ? `: ${sinPuntoFinal(estado.errorPostProceso)}` : '';
            const filas =
                estado.err > 0
                    ? `Se cargaron ${formatearNumero(estado.ok)} filas y ${formatearNumero(estado.err)} dieron error.`
                    : `Se cargaron ${formatearNumero(estado.ok)} filas.`;
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
                    ? `\n\nAntes del corte se cargaron al menos ${formatearNumero(estado.ok)} filas${estado.err > 0 ? ` y ${formatearNumero(estado.err)} dieron error` : ''}; el cierre de la carga no corrió.`
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

/** Orden de gravedad para elegir el encabezado del resumen: menor número = peor. */
function rangoGravedad(estado: Pick<EstadoCargaDto, 'resultado' | 'ok'>): number {
    switch (estado.resultado) {
        case 'FALLIDA':
            return 0;
        case 'CON_ADVERTENCIAS':
            return 1;
        case 'CON_ERRORES':
            return estado.ok === 0 ? 2 : 4;
        case 'SIN_FILAS':
            return 3;
        case 'OK':
            return 5;
        default:
            return 6;
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
    return typeof errorMsg === 'string' && /^\[(aviso|parseo|post-proceso)\]/.test(errorMsg);
}
