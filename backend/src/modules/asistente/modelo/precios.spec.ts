import { PRECIOS_DEFAULT, calcularCosto, resolverPrecio, tokensPrompt, usoDeUsage } from './precios';

const HAIKU_US = PRECIOS_DEFAULT['us.anthropic.claude-haiku-5-5'];

describe('precios', () => {
    it('usage real de la prueba del 16/10 (caché fría, thinking y 2 iteraciones): costo esperado', () => {
        // Iteración 0: se escribe la caché del system (11.166 tokens). Iteración 1: lee 11.166 y escribe 5.399.
        const it0 = usoDeUsage({
            input_tokens: 123,
            output_tokens: 298,
            cache_creation_input_tokens: 11166,
            cache_read_input_tokens: 0,
            cache_creation: { ephemeral_5m_input_tokens: 11166, ephemeral_1h_input_tokens: 0 },
            output_tokens_details: { thinking_tokens: 238 },
        });
        expect(it0).toMatchObject({ entrada: 123, salida: 298, thinking: 238, cacheEscritura5m: 11166, cacheLectura: 0 });
        // (123·0,11 + 298·0,55 + 11166·0,1375) / 1e6
        expect(calcularCosto(it0, HAIKU_US)).toBeCloseTo((123 * 0.11 + 298 * 0.55 + 11166 * 0.1375) / 1e6, 10);

        const it1 = usoDeUsage({
            input_tokens: 40,
            output_tokens: 150,
            cache_read_input_tokens: 11166,
            cache_creation_input_tokens: 5399,
            cache_creation: { ephemeral_5m_input_tokens: 5399, ephemeral_1h_input_tokens: 0 },
        });
        expect(calcularCosto(it1, HAIKU_US)).toBeCloseTo((40 * 0.11 + 150 * 0.55 + 11166 * 0.011 + 5399 * 0.1375) / 1e6, 10);
    });

    it('thinking ya está dentro de salida: no se cobra dos veces', () => {
        const uso = usoDeUsage({ input_tokens: 0, output_tokens: 1000, output_tokens_details: { thinking_tokens: 900 } });
        expect(calcularCosto(uso, HAIKU_US)).toBeCloseTo((1000 * 0.55) / 1e6, 12);
    });

    it('pasados los 100.000 tokens de prompt cobra la tarifa larga (×5)', () => {
        const corto = usoDeUsage({ input_tokens: 100000, output_tokens: 1000 });
        const largo = usoDeUsage({ input_tokens: 100001, output_tokens: 1000 });
        expect(tokensPrompt(corto)).toBe(100000);
        expect(calcularCosto(corto, HAIKU_US)).toBeCloseTo((100000 * 0.11 + 1000 * 0.55) / 1e6, 10);
        expect(calcularCosto(largo, HAIKU_US)).toBeCloseTo((100001 * 0.55 + 1000 * 2.75) / 1e6, 10);
    });

    it('el umbral cuenta el prompt completo: entrada + lectura + escrituras de caché', () => {
        const uso = usoDeUsage({ input_tokens: 10, cache_read_input_tokens: 60000, cache_creation_input_tokens: 40000 });
        expect(tokensPrompt(uso)).toBe(100010);
        expect(calcularCosto(uso, HAIKU_US)).toBeCloseTo((10 * 0.55 + 40000 * 0.6875 + 60000 * 0.055) / 1e6, 10);
    });

    it('cache_creation sin desglose: todo el total como caché de 5 minutos', () => {
        expect(usoDeUsage({ cache_creation_input_tokens: 500 })).toMatchObject({ cacheEscritura5m: 500, cacheEscritura1h: 0 });
        expect(usoDeUsage({ cache_creation_input_tokens: 500, cache_creation: null })).toMatchObject({ cacheEscritura5m: 500 });
        expect(
            usoDeUsage({ cache_creation_input_tokens: 500, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 } }),
        ).toMatchObject({ cacheEscritura5m: 500 });
    });

    it('con desglose, la caché de 1 hora se cobra a su tarifa', () => {
        const uso = usoDeUsage({
            cache_creation_input_tokens: 1000,
            cache_creation: { ephemeral_5m_input_tokens: 400, ephemeral_1h_input_tokens: 600 },
        });
        expect(calcularCosto(uso, HAIKU_US)).toBeCloseTo((400 * 0.1375 + 600 * 0.22) / 1e6, 12);
    });

    it('un usage vacío, nulo o con valores raros cuesta cero', () => {
        expect(calcularCosto(usoDeUsage(null), HAIKU_US)).toBe(0);
        expect(calcularCosto(usoDeUsage({ input_tokens: -5, output_tokens: NaN as unknown as number }), HAIKU_US)).toBe(0);
    });

    describe('resolverPrecio', () => {
        it('usa el configurado y, si no, el de código', () => {
            const custom = { ...HAIKU_US, entrada: 9 };
            expect(resolverPrecio('us.anthropic.claude-haiku-5-5', { 'us.anthropic.claude-haiku-5-5': custom })?.entrada).toBe(9);
            expect(resolverPrecio('us.anthropic.claude-haiku-5-5', null)).toBe(HAIKU_US);
            expect(resolverPrecio('us.anthropic.claude-haiku-5-5', {})).toBe(HAIKU_US);
        });

        it('un modelo sin precio devuelve null: el asistente no llama (nunca se cuenta un costo en cero)', () => {
            expect(resolverPrecio('un.modelo.nuevo', {})).toBeNull();
        });
    });

    it('el perfil regional cuesta el global × 1,10', () => {
        const g = PRECIOS_DEFAULT['global.anthropic.claude-haiku-5-5'];
        for (const k of ['entrada', 'salida', 'cacheEscritura5m', 'cacheEscritura1h', 'cacheLectura'] as const) {
            expect(HAIKU_US[k]).toBeCloseTo(g[k] * 1.1, 10);
        }
    });
});
