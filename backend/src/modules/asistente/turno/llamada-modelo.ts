import type { ContentBlock, Message, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages';
import { ClienteModelo, TipoBloque } from '../modelo/cliente-modelo';
import { USO_VACIO, UsoTokens, usoDeUsage } from '../modelo/precios';
import { TopeError } from './errores';
import type { TrazaLlamada } from './traza';

/**
 * Una iteración del loop de un turno, común a las dos funciones del asistente (ayuda y reportes): verificar los topes,
 * abrir el stream, costear con el `usage` (también si se abortó o falló) y registrar la llamada. Pura: habla con
 * puertos, no con Prisma (docs/asistente-reportes-spec.md §3).
 */

export interface LlamadaRegistro {
    usuarioId: number | null;
    conversacionId: number | null;
    mensajeId: number | null;
    funcion: string;
    modelo: string;
    iteracion: number;
    uso: UsoTokens;
    ms: number;
    stopReason: string | null;
    error: string | null;
}

export interface PuertoMedicion {
    /** Registra la llamada y devuelve su costo en USD. Nunca debe perder el costo. */
    registrarLlamada(l: LlamadaRegistro): Promise<number>;
}

export interface PuertoTopes {
    /** Lanza `TopeError` si ya no se puede llamar al modelo (mensual, de la función o del turno). */
    verificarIteracion(funcion: string, costoTurno: number): Promise<void>;
}

/**
 * Un stream cortado con Detener trae en `usage` solo la salida del `message_start`. Se estima la que alcanzó a generar
 * por el texto ya emitido (unos 3 caracteres por token), para que el costo no quede por debajo de lo facturado.
 */
export function usoAbortado(uso: UsoTokens, textoEmitido: string): UsoTokens {
    return { ...uso, salida: Math.max(uso.salida, Math.ceil(textoEmitido.length / 3)) };
}

/**
 * La clase del error, para `asistente_llamada.error` y el detalle (docs/asistente-detalle-spec.md §7.3.6). Los errores del
 * SDK no tienen `name` propio (`err.name` da «Error» para un timeout y para un 429): la clase sale del constructor. Los de
 * AWS sí traen `name` ('AccessDeniedException') y ese gana.
 */
export function claseDeError(err: unknown): string {
    const e = err as { name?: unknown; constructor?: { name?: unknown } } | null;
    const propio = typeof e?.name === 'string' && e.name !== 'Error' ? e.name : null;
    const clase = typeof e?.constructor?.name === 'string' && e.constructor.name !== 'Error' ? e.constructor.name : null;
    return (propio ?? clase ?? 'Error').slice(0, 120);
}

/**
 * El largo en caracteres de cada bloque de la respuesta, para repartir los tokens entre tramos (§7.3). Solo el número: el
 * razonamiento ni se mira, y del `tool_use` se cuenta el JSON del input sin guardarlo.
 */
export function largosDe(content: ContentBlock[] | undefined): { indice: number; tipo: TipoBloque; caracteres: number }[] {
    try {
        return (content ?? []).map((b, indice) => {
            if (b.type === 'text') return { indice, tipo: 'text' as const, caracteres: b.text.length };
            if (b.type === 'tool_use') return { indice, tipo: 'tool_use' as const, caracteres: JSON.stringify(b.input ?? {}).length };
            if (b.type === 'thinking' || b.type === 'redacted_thinking') return { indice, tipo: b.type, caracteres: 0 };
            return { indice, tipo: 'otro' as const, caracteres: 0 };
        });
    } catch {
        return [];
    }
}

export interface IdsLlamada {
    usuarioId: number | null;
    conversacionId: number | null;
    mensajeId: number | null;
}

export interface EntradaLlamada {
    funcion: string;
    modelo: string;
    iteracion: number;
    ids: IdsLlamada;
    params: MessageCreateParamsNonStreaming;
    signal: AbortSignal;
    /** Lo gastado en las iteraciones anteriores del turno: para el tope por turno. */
    costoTurno: number;
    /** Cada fragmento de texto a medida que llega. */
    onTexto?: (delta: string) => void;
    /** Timeout de la llamada. Sin esto rige el del cliente. */
    timeoutMs?: number;
    /** El medidor de esta llamada (docs/asistente-detalle-spec.md). Sin él, se llama exactamente igual. */
    traza?: TrazaLlamada;
}

export type ResultadoLlamada =
    | { tipo: 'ok'; msg: Message; costo: number; textoIter: string }
    | { tipo: 'abortada'; costo: number; textoIter: string }
    | { tipo: 'fallo'; costo: number; textoIter: string; error: any };

export interface DependenciasLlamada {
    cliente: ClienteModelo;
    topes: PuertoTopes;
    medicion: PuertoMedicion;
}

/**
 * Lanza `TopeError` si el tope no deja llamar (antes de gastar nada). Una llamada que se aborta o falla se registra igual:
 * el costo nunca se pierde.
 */
export async function llamarModelo(deps: DependenciasLlamada, e: EntradaLlamada): Promise<ResultadoLlamada> {
    // Medir nunca rompe una respuesta: cada enganche va envuelto.
    const medir = (f: (t: TrazaLlamada) => void) => {
        if (!e.traza) return;
        try {
            f(e.traza);
        } catch {
            /* el medidor nunca lanza; esto es por si alguien le pasa otra implementación */
        }
    };

    try {
        await deps.topes.verificarIteracion(e.funcion, e.costoTurno);
    } catch (err) {
        if (err instanceof TopeError) medir((t) => t.cortadaPorTope(err.codigo));
        throw err;
    }
    medir((t) => t.stream());

    const base = { ...e.ids, funcion: e.funcion, modelo: e.modelo, iteracion: e.iteracion };
    let textoIter = '';
    const ti = Date.now();
    const stream = deps.cliente.stream(e.params, e.signal, e.timeoutMs !== undefined ? { timeoutMs: e.timeoutMs } : undefined);
    stream.onTexto((d) => {
        textoIter += d;
        e.onTexto?.(d);
    });
    if (e.traza && stream.onEvento) {
        try {
            stream.onEvento((ev) => medir((t) => t.evento(ev)));
        } catch {
            /* sin desglose: la llamada se mide igual */
        }
    }

    let msg: Message;
    try {
        msg = await stream.finalMessage();
    } catch (err: any) {
        medir((t) => t.finStream());
        const abortado = e.signal.aborted || err?.constructor?.name === 'APIUserAbortError';
        const parcial = abortado ? stream.parcial() : undefined;
        const uso = abortado ? usoAbortado(usoDeUsage(stream.parcial()?.usage), textoIter) : { ...USO_VACIO };
        const clase = claseDeError(err);
        const costo = await deps.medicion.registrarLlamada({
            ...base,
            uso,
            ms: Date.now() - ti,
            stopReason: null,
            error: abortado ? 'abortado' : clase,
        });
        medir((t) =>
            t.cerrar({
                uso,
                costo,
                stopReason: null,
                abortada: abortado,
                clase: abortado ? null : clase,
                usoEstimado: abortado,
                largos: largosDe(parcial?.content),
            }),
        );
        return abortado ? { tipo: 'abortada', costo, textoIter } : { tipo: 'fallo', costo, textoIter, error: err };
    }
    medir((t) => t.finStream());

    const uso = usoDeUsage(msg.usage);
    const costo = await deps.medicion.registrarLlamada({
        ...base,
        uso,
        ms: Date.now() - ti,
        stopReason: msg.stop_reason,
        error: null,
    });
    medir((t) =>
        t.cerrar({ uso, costo, stopReason: msg.stop_reason, abortada: false, clase: null, usoEstimado: false, largos: largosDe(msg.content) }),
    );
    return { tipo: 'ok', msg, costo, textoIter };
}
