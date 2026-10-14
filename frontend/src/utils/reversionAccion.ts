// Textos y reglas puras de la reversión de una acción masiva (docs/imports-progreso-c3-spec.md §17.6 y §17.8).
// Funciones puras: no leen el DOM ni el reloj.
import type { StatusValue } from '../components/ui';
import type { CodigoNoRevertible, CoberturaReversion, ReversionAccionDto, ReversionResumenDto } from '../types/reversionAccion';
import { formatearNumero, plural } from './estadoCarga';

const ESTADOS: readonly string[] = ['EN_COLA', 'REVIRTIENDO', 'TERMINADA', 'FALLIDA', 'INTERRUMPIDA'];

/** Un número del DTO que un backend raro puede mandar mal: nunca NaN ni negativo en pantalla. */
const num = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);

/** El payload de `accion:revertir:progreso` / `:terminada` (y el `reversion` del historial) tiene la forma que la pantalla necesita. */
export function esReversionResumen(x: unknown): x is ReversionResumenDto {
    if (typeof x !== 'object' || x === null) return false;
    const r = x as Record<string, unknown>;
    return typeof r.remesaId === 'number' && typeof r.empresaId === 'number' && typeof r.estado === 'string' && ESTADOS.includes(r.estado);
}

/** Hay una reversión en cola o corriendo: el botón se bloquea y la lista tiene que seguir mirándola. */
export function reversionActiva(r: Pick<ReversionResumenDto, 'estado'> | null | undefined): boolean {
    return r?.estado === 'EN_COLA' || r?.estado === 'REVIRTIENDO';
}

/** La reversión no terminó y se puede retomar. */
export function reversionCortada(r: Pick<ReversionResumenDto, 'estado'> | null | undefined): boolean {
    return r?.estado === 'FALLIDA' || r?.estado === 'INTERRUMPIDA';
}

/**
 * Una ACCIONES que terminó FALLIDA sin haber procesado ninguna fila (la retomable de «No se cargó ninguna fila»): no hay
 * nada que revertir, el camino es Retomar. Solo mira lo que el DTO ya trae.
 */
export function fallidaSinFilas(c: { estadoProceso?: string; retomable?: boolean; procesadas?: number }): boolean {
    return c.estadoProceso === 'FALLIDA' && (c.retomable === true || c.procesadas === 0);
}

/**
 * Qué se queda con la pantalla cuando llega un evento: el estado nuevo, salvo que sea uno viejo que llegó tarde
 * (un `progreso` después de `terminada`, o una tanda que ya se había superado en el mismo intento).
 */
export function fusionarReversion(previa: ReversionResumenDto | null | undefined, nueva: ReversionResumenDto): ReversionResumenDto {
    if (!previa) return nueva;
    if (previa.estado === 'TERMINADA' && nueva.estado !== 'TERMINADA') return previa;
    // El EN_COLA de la respuesta del POST puede llegar después de lo que ya mandó el socket del mismo intento.
    if (nueva.estado === 'EN_COLA' && previa.estado !== 'EN_COLA' && previa.encoladaAt === nueva.encoladaAt) return previa;
    if (
        previa.estado === 'REVIRTIENDO' &&
        nueva.estado === 'REVIRTIENDO' &&
        previa.encoladaAt === nueva.encoladaAt &&
        num(nueva.hechos) < num(previa.hechos)
    ) {
        return previa;
    }
    return nueva;
}

export interface EtiquetaReversion {
    etiqueta: string;
    status: StatusValue;
    /** Segunda línea: el motivo de una reversión que no terminó. */
    detalle: string | null;
}

/** Lo que dice el chip de la reversión: «En cola», «Revirtiendo 40 %», «Revertida», «Reversión interrumpida: H de T», «La reversión falló». */
export function etiquetaDeReversion(r: ReversionResumenDto): EtiquetaReversion {
    const error = typeof r.error === 'string' && r.error.trim() !== '' ? r.error : null;
    switch (r.estado) {
        case 'EN_COLA':
            return { etiqueta: 'En cola', status: 'pending', detalle: null };
        case 'REVIRTIENDO':
            return { etiqueta: `Revirtiendo ${Math.min(100, Math.max(0, Math.floor(num(r.porcentaje))))} %`, status: 'running', detalle: null };
        case 'TERMINADA':
            return { etiqueta: 'Revertida', status: 'completed', detalle: null };
        case 'INTERRUMPIDA':
            return {
                etiqueta: `Reversión interrumpida: ${formatearNumero(r.hechos)} de ${formatearNumero(r.total)}`,
                status: 'warning',
                detalle: error,
            };
        default:
            return { etiqueta: 'La reversión falló', status: 'failed', detalle: error };
    }
}

/** Lo que dejó una reversión terminada, en líneas. Lo que no se pudo deshacer sale como aviso, no se pierde. */
export function lineasDeReversionTerminada(r: ReversionResumenDto): Array<{ texto: string; aviso: boolean }> {
    const out: Array<{ texto: string; aviso: boolean }> = [];
    const cambios = num(r.deudoresRevertidos);
    const contactos = num(r.contactosRestaurados);
    const comentarios = num(r.comentariosBorrados);
    out.push({
        texto:
            `Se deshicieron ${formatearNumero(cambios)} ${plural(cambios, 'cambio de datos', 'cambios de datos')}, ` +
            `se ${plural(contactos, 'restauró', 'restauraron')} ${formatearNumero(contactos)} ${plural(contactos, 'contacto', 'contactos')} y ` +
            `se ${plural(comentarios, 'borró', 'borraron')} ${formatearNumero(comentarios)} ${plural(comentarios, 'comentario', 'comentarios')}.`,
        aviso: false,
    });
    const sinCaso = num(r.casosQueNoExistian);
    if (sinCaso > 0) {
        out.push({
            texto: `${formatearNumero(sinCaso)} ${plural(sinCaso, 'cambio no se pudo deshacer porque su caso ya no existe', 'cambios no se pudieron deshacer porque su caso ya no existe')}.`,
            aviso: true,
        });
    }
    const contactosSinCaso = num(r.contactosSinCaso);
    if (contactosSinCaso > 0) {
        out.push({
            texto: `${formatearNumero(contactosSinCaso)} ${plural(contactosSinCaso, 'contacto no se restauró porque su caso ya no existe', 'contactos no se restauraron porque su caso ya no existe')}.`,
            aviso: true,
        });
    }
    return out;
}

/** Siempre va al final de lo que dice el diálogo. */
export const TEXTO_PISA_EDICIONES = 'Si alguien editó a mano alguno de estos casos después de la acción, esos cambios se pisan.';

/** Lo que el diálogo muestra cuando la cobertura no es exacta: no hay forma de afirmar que Revertir deshace todo. */
export const TEXTO_COBERTURA_INEXACTA = 'Los datos guardados para revertir pueden no cubrir todo lo que hizo la acción: puede quedar una parte sin deshacer.';

/** Los textos de §17.8 por código (el backend manda el `texto` en `motivo`; estos son los de respaldo y los de las pruebas). */
export const TEXTO_MOTIVO: Record<CodigoNoRevertible, string> = {
    YA_REVERTIDA: 'Esta acción masiva ya se revirtió.',
    REVERSION_EN_CURSO: 'Esta acción ya se está revirtiendo. Mirá el avance en el Historial.',
    REVERTIR_CARGA_EN_CURSO: 'La acción masiva todavía está corriendo. Cancelala, o esperá a que termine, y después revertila.',
    REVERTIR_NO_TERMINO: 'Esta acción masiva no terminó bien: los datos para revertirla no se guardaron. Avisá a soporte; no la vuelvas a cargar.',
    REVERTIR_INCOMPLETO: 'Los datos para revertir esta acción no se guardaron completos: Revertir desharía solo una parte. Avisá a soporte.',
    REVERTIR_NADA: 'Esta acción masiva no llegó a cambiar ningún caso: no hay nada que revertir.',
};

/** Por qué no se puede revertir: el texto del backend y, si no vino, el de respaldo del código. */
export function textoDeMotivo(motivo: ReversionAccionDto['motivo']): string | null {
    if (motivo == null) return null;
    return typeof motivo.texto === 'string' && motivo.texto.trim() !== '' ? motivo.texto : (TEXTO_MOTIVO[motivo.code] ?? null);
}

/**
 * Lo que dice el diálogo de Revertir antes de confirmar, en párrafos. Lo que va entre `**` se muestra en negrita.
 * Nunca afirma más de lo que sabe: la cantidad de casos sale de los snapshots pendientes.
 */
export function lineasDeCobertura(c: CoberturaReversion): string[] {
    const casos = num(c.casos);
    const cambios = num(c.cambiosDeCaso);
    const contactos = num(c.contactos);
    const comentarios = num(c.comentarios);
    const out: string[] = [];
    out.push(
        `Se van a deshacer los cambios en **${formatearNumero(casos)} ${plural(casos, 'caso', 'casos')}**: ` +
            `${formatearNumero(cambios)} ${plural(cambios, 'cambio de datos', 'cambios de datos')}, ` +
            `${formatearNumero(contactos)} ${plural(contactos, 'contacto a restaurar', 'contactos a restaurar')} y ` +
            `${formatearNumero(comentarios)} ${plural(comentarios, 'comentario a borrar', 'comentarios a borrar')}.`,
    );
    if (c.cargaCortada) {
        out.push(
            c.filasProcesadas != null && c.totalFilas != null && c.totalFilas > 0
                ? `La acción se cortó después de procesar ${formatearNumero(c.filasProcesadas)} de ${formatearNumero(c.totalFilas)} filas: Revertir deshace exactamente lo que alcanzó a hacer.`
                : 'La acción se cortó antes de terminar: Revertir deshace exactamente lo que alcanzó a hacer.',
        );
    }
    const ya = num(c.yaRevertidos);
    if (ya > 0) {
        out.push(`Un intento anterior ya revirtió ${formatearNumero(ya)} ${plural(ya, 'cambio', 'cambios')}; ahora se deshacen los que faltan.`);
    }
    if (!c.exacta) out.push(TEXTO_COBERTURA_INEXACTA);
    out.push(TEXTO_PISA_EDICIONES);
    return out;
}

/** El aviso al pedir la reversión (202). */
export const TEXTO_REVERSION_PEDIDA = 'Reversión en curso: te avisamos al terminar';
/** El aviso cuando la acción ya estaba revertida (200). */
export const TEXTO_YA_REVERTIDA = 'La acción ya estaba revertida';

/** Tooltips del botón Revertir (§17.6). */
export const MOTIVO_YA_REVERTIDA = 'Ya se revirtió';
export const MOTIVO_SE_ESTA_REVIRTIENDO = 'Se está revirtiendo';
export const AYUDA_REVERTIR_CORTADA = 'Revertir (sigue desde donde quedó)';

/** En el diálogo de cancelar una acción masiva en curso (§17.6): cancelar solo corta; deshacer es un paso aparte (D6). `**` = negrita. */
export const TEXTO_CANCELAR_ACCIONES =
    'Lo que ya se aplicó queda aplicado. Después lo podés deshacer con **Revertir** desde el Historial: deshace exactamente lo que alcanzó a hacer.';
