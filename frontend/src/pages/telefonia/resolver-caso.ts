/**
 * Resolución del caso a partir de lo que manda la Toolbar de Neotel.
 *
 * La campaña arma la URL con dos variables y **ninguna de las dos es necesariamente nuestro id**:
 *
 *   - `[[CLAVE]]` es el identificador del contacto / de la llamada **en Neotel**.
 *   - `[[DATA]]` es un campo libre, con los valores unidos por el SEPARADOR de la campaña, y es ahí
 *     donde viaja el id interno del deudor.
 *
 * Como el orden y el contenido de `DATA` los define quien carga la base, acá no se asume una
 * posición fija: se arma una lista de candidatos y el llamador prueba en orden hasta que uno
 * resuelva contra la API. Un candidato equivocado devuelve 404 y se pasa al siguiente; el costo es
 * una request de más en un caso raro, y a cambio la carga no se rompe si el día de mañana agregan
 * una columna adelante.
 */

/** Separador por defecto de `DATA`. Se puede sobreescribir por query (`&sep=;`). */
export const SEPARADOR_DEFAULT = '|';

/** Cuántos candidatos se prueban como máximo, para no encadenar requests si `DATA` viene largo. */
const MAX_CANDIDATOS = 4;

export interface ParamsLlamada {
    /** `data` crudo tal como llegó. */
    data?: string | null;
    /** `[[CLAVE]]`: id del contacto o de la llamada en Neotel. */
    clave?: string | null;
    /** Id de deudor mandado explícitamente, si alguna campaña se configura así. */
    deudor?: string | null;
    /** Separador de `DATA`. */
    sep?: string | null;
    /** Posición (0-based) del id de deudor dentro de `DATA`, si se quiere fijar. */
    pos?: string | null;
}

/** De dónde salió un id candidato. Define cuánta confianza merece. */
export type OrigenCandidato = 'explicito' | 'data' | 'clave';

export interface Candidato {
    id: number;
    origen: OrigenCandidato;
}

export interface CasoResuelto {
    /** Ids a probar contra la API, en orden de preferencia. */
    candidatos: Candidato[];
    /** Valores de `DATA` ya separados, para mostrar como contexto de la llamada. */
    valoresData: string[];
    /** Id del contacto/llamada en Neotel, si vino. Es informativo. */
    idNeotel: string | null;
}

const esEntero = (s: string): boolean => /^\d+$/.test(s);

/**
 * Arma la lista de ids candidatos a partir de los parámetros de la URL.
 *
 * Orden: el `deudor` explícito, después la posición fijada de `DATA`, después el resto de los
 * valores numéricos de `DATA`.
 *
 * ⚠️ **La `CLAVE` solo se usa si `DATA` no aportó ningún candidato.** Es tentador probarla siempre
 * "por las dudas", pero el id de contacto de Neotel y el nuestro son los dos enteros correlativos:
 * tarde o temprano uno coincide con un deudor que existe, y ahí la Toolbar abriría **la ficha de
 * otra persona** en medio de una llamada, sin que nada avise. Gestionar sobre el caso equivocado es
 * bastante peor que no abrir ninguno.
 *
 * Cuando sí se cae a la `CLAVE` —porque no hay nada más—, el candidato queda marcado con
 * `origen: 'clave'` para que la pantalla lo advierta y el operador confirme antes de gestionar.
 */
export function resolverCaso(params: ParamsLlamada): CasoResuelto {
    const separador = params.sep || SEPARADOR_DEFAULT;
    const clave = (params.clave ?? '').trim();

    const valoresData = (params.data ?? '')
        .split(separador)
        .map((v) => v.trim())
        .filter(Boolean);

    const candidatos: Candidato[] = [];
    const agregar = (v: string | null | undefined, origen: OrigenCandidato) => {
        const s = (v ?? '').trim();
        if (!esEntero(s)) return;
        const n = Number(s);
        if (n > 0 && !candidatos.some((c) => c.id === n)) candidatos.push({ id: n, origen });
    };

    agregar(params.deudor, 'explicito');

    const pos = Number(params.pos);
    if (Number.isInteger(pos) && pos >= 0 && pos < valoresData.length) {
        agregar(valoresData[pos], 'data');
    }

    for (const v of valoresData) agregar(v, 'data');

    // Último recurso, y solo si no hubo nada en DATA (ver el aviso de arriba).
    if (candidatos.length === 0) agregar(clave, 'clave');

    return {
        candidatos: candidatos.slice(0, MAX_CANDIDATOS),
        valoresData,
        idNeotel: clave || null,
    };
}
