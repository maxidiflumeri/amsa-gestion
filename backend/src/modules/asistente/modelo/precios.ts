import type { PrecioModelo } from '../dto/asistente.tipos';

/** Tokens de una llamada, ya desglosados para costearlos (docs/asistente-spec.md §11.1). */
export interface UsoTokens {
    entrada: number;
    salida: number;
    /** Parte de `salida` que fue thinking. Informativo: ya está sumada en `salida`. */
    thinking: number;
    cacheLectura: number;
    cacheEscritura5m: number;
    cacheEscritura1h: number;
}

/** Lo que usa `usoDeUsage` del `usage` del SDK (todo opcional: un `usage` parcial de un stream cortado). */
export interface UsageCrudo {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
    cache_creation?: { ephemeral_5m_input_tokens?: number | null; ephemeral_1h_input_tokens?: number | null } | null;
    output_tokens_details?: { thinking_tokens?: number | null } | null;
}

export const USO_VACIO: UsoTokens = {
    entrada: 0,
    salida: 0,
    thinking: 0,
    cacheLectura: 0,
    cacheEscritura5m: 0,
    cacheEscritura1h: 0,
};

const n = (v: number | null | undefined): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

export function usoDeUsage(usage: UsageCrudo | null | undefined): UsoTokens {
    if (!usage) return { ...USO_VACIO };
    const total = n(usage.cache_creation_input_tokens);
    let cw5m = n(usage.cache_creation?.ephemeral_5m_input_tokens);
    const cw1h = n(usage.cache_creation?.ephemeral_1h_input_tokens);
    // Sin desglose (o con un desglose que no suma lo que informa el total): todo el total como 5 minutos.
    if (cw5m + cw1h === 0 && total > 0) cw5m = total;
    return {
        entrada: n(usage.input_tokens),
        salida: n(usage.output_tokens),
        thinking: n(usage.output_tokens_details?.thinking_tokens),
        cacheLectura: n(usage.cache_read_input_tokens),
        cacheEscritura5m: cw5m,
        cacheEscritura1h: cw1h,
    };
}

/** Tokens del prompt: lo que cuenta para el umbral de la tarifa larga. */
export function tokensPrompt(uso: UsoTokens): number {
    return uso.entrada + uso.cacheLectura + uso.cacheEscritura5m + uso.cacheEscritura1h;
}

/**
 * USD por millón de tokens. El perfil regional (`us.`) cuesta global × 1,10 (Bedrock: "Regional endpoints include a
 * 10% pricing premium"). Haiku 5.5 cobra la tarifa "larga" cuando el prompt pasa los 100.000 tokens.
 */
export const PRECIOS_DEFAULT: Record<string, PrecioModelo> = {
    'us.anthropic.claude-haiku-5-5': {
        entrada: 0.11,
        salida: 0.55,
        cacheEscritura5m: 0.1375,
        cacheEscritura1h: 0.22,
        cacheLectura: 0.011,
        umbralLargo: 100000,
        largo: { entrada: 0.55, salida: 2.75, cacheEscritura5m: 0.6875, cacheEscritura1h: 1.1, cacheLectura: 0.055 },
    },
    'global.anthropic.claude-haiku-5-5': {
        entrada: 0.1,
        salida: 0.5,
        cacheEscritura5m: 0.125,
        cacheEscritura1h: 0.2,
        cacheLectura: 0.01,
        umbralLargo: 100000,
        largo: { entrada: 0.5, salida: 2.5, cacheEscritura5m: 0.625, cacheEscritura1h: 1.0, cacheLectura: 0.05 },
    },
    'anthropic.claude-haiku-5-5': {
        entrada: 0.1,
        salida: 0.5,
        cacheEscritura5m: 0.125,
        cacheEscritura1h: 0.2,
        cacheLectura: 0.01,
        umbralLargo: 100000,
        largo: { entrada: 0.5, salida: 2.5, cacheEscritura5m: 0.625, cacheEscritura1h: 1.0, cacheLectura: 0.05 },
    },
    'us.anthropic.claude-sonnet-5-5': {
        entrada: 2.2,
        salida: 11,
        cacheEscritura5m: 2.75,
        cacheEscritura1h: 4.4,
        cacheLectura: 0.11,
    },
    'us.anthropic.claude-opus-5-5': {
        entrada: 4.4,
        salida: 22,
        cacheEscritura5m: 5.5,
        cacheEscritura1h: 8.8,
        cacheLectura: 0.22,
    },
};

/**
 * El precio del modelo: el configurado por un administrador y, si no, el de código. `null` = no hay precio: el
 * asistente NO llama (nunca se cuenta un costo en cero).
 */
export function resolverPrecio(
    modelo: string,
    personalizados?: Record<string, PrecioModelo> | null,
): PrecioModelo | null {
    return personalizados?.[modelo] ?? PRECIOS_DEFAULT[modelo] ?? null;
}

/** USD de una llamada. Pura. */
export function calcularCosto(uso: UsoTokens, precio: PrecioModelo): number {
    const larga = !!precio.umbralLargo && !!precio.largo && tokensPrompt(uso) > precio.umbralLargo;
    const t = larga ? precio.largo! : precio;
    return (
        (uso.entrada * t.entrada +
            uso.salida * t.salida +
            uso.cacheEscritura5m * t.cacheEscritura5m +
            uso.cacheEscritura1h * t.cacheEscritura1h +
            uso.cacheLectura * t.cacheLectura) /
        1e6
    );
}
