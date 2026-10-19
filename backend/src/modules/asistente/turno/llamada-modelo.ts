import type { Message, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages';
import { ClienteModelo } from '../modelo/cliente-modelo';
import { USO_VACIO, UsoTokens, usoDeUsage } from '../modelo/precios';

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
    await deps.topes.verificarIteracion(e.funcion, e.costoTurno);

    const base = { ...e.ids, funcion: e.funcion, modelo: e.modelo, iteracion: e.iteracion };
    let textoIter = '';
    const ti = Date.now();
    const stream = deps.cliente.stream(e.params, e.signal, e.timeoutMs !== undefined ? { timeoutMs: e.timeoutMs } : undefined);
    stream.onTexto((d) => {
        textoIter += d;
        e.onTexto?.(d);
    });

    let msg: Message;
    try {
        msg = await stream.finalMessage();
    } catch (err: any) {
        const abortado = e.signal.aborted || err?.constructor?.name === 'APIUserAbortError';
        const costo = await deps.medicion.registrarLlamada({
            ...base,
            uso: abortado ? usoAbortado(usoDeUsage(stream.parcial()?.usage), textoIter) : { ...USO_VACIO },
            ms: Date.now() - ti,
            stopReason: null,
            error: abortado ? 'abortado' : String(err?.name ?? 'Error').slice(0, 120),
        });
        return abortado ? { tipo: 'abortada', costo, textoIter } : { tipo: 'fallo', costo, textoIter, error: err };
    }

    const costo = await deps.medicion.registrarLlamada({
        ...base,
        uso: usoDeUsage(msg.usage),
        ms: Date.now() - ti,
        stopReason: msg.stop_reason,
        error: null,
    });
    return { tipo: 'ok', msg, costo, textoIter };
}
