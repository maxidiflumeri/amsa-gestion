import { DetalleRespuesta, NodoDetalle } from '../dto/asistente.tipos';
import { PRECIOS_DEFAULT, USO_VACIO, UsoTokens, calcularCosto } from '../modelo/precios';
import {
    CierreLlamada,
    FilaLlamadaGuardada,
    MuestraTiempo,
    RegistroLlamada,
    armarDetalle,
    completarHuecos,
    detalleDesdeLlamadas,
    muestrasDeDetalle,
    nodosDeLlamada,
    percentil,
    recortarDetalle,
    resumenParaLog,
    tablaDeTiempos,
} from './detalle';
import { MODELO_DORADO, PRECIO_DORADO, guionDorado } from './doble-stream-caso-dorado';
import { ClienteConTiempos, RelojFalso, medicionConPrecio, topesConTiempo } from './doble-stream-con-tiempos';
import { llamarModelo } from './llamada-modelo';
import { TrazaTurno } from './traza';

const SONNET = PRECIO_DORADO;
const HAIKU = PRECIOS_DEFAULT['us.anthropic.claude-haiku-5-5'];

/** Corre el caso dorado de docs/asistente-detalle-spec.md §14.1 con el reloj y el cliente falsos. */
async function correrCasoDorado(): Promise<{ detalle: DetalleRespuesta; registradas: ReturnType<typeof medicionConPrecio>['registradas'] }> {
    const reloj = new RelojFalso();
    const traza = new TrazaTurno({ funcion: 'reportes', modelo: MODELO_DORADO, precio: SONNET, reloj: reloj.ahora });
    const cliente = new ClienteConTiempos(reloj, guionDorado());
    const medicion = medicionConPrecio(SONNET);
    const topes = topesConTiempo(reloj, (n) => (n === 0 ? 2 : 0));
    const deps = { cliente, topes, medicion };
    const base = { funcion: 'reportes', modelo: MODELO_DORADO, ids: { usuarioId: 1, conversacionId: 2, mensajeId: 3 }, params: { model: 'm', max_tokens: 1, messages: [] }, signal: new AbortController().signal, costoTurno: 0 };

    // Partes del servicio: topes 0→20, historial 20→120, contexto 120→300.
    let fin = traza.parte('topes');
    reloj.avanzar(20);
    fin();
    fin = traza.parte('historial');
    reloj.avanzar(100);
    fin();
    traza.parte('contexto');
    reloj.avanzar(180);

    // Llamada 1.
    await llamarModelo(deps, { ...base, iteracion: 0, traza: traza.llamada(0) });

    // Herramienta: 6.400 → 11.200.
    const th = traza.herramienta('probar_plantilla');
    const validacion = th.parte('validacion');
    validacion();
    const espera = th.parte('espera_base');
    espera();
    const muestra = th.parte('muestra');
    const conteo = th.parte('conteo');
    reloj.avanzar(3100);
    muestra();
    reloj.avanzar(1620);
    conteo();
    reloj.avanzar(80);
    th.describir({ texto: 'Probé la plantilla: 8.412 casos, sin errores', estado: 'ok' });
    th.cerrar({ esError: false, caracteresResultado: 930 });

    // Llamada 2.
    await llamarModelo(deps, { ...base, iteracion: 1, traza: traza.llamada(1) });

    const guardar = traza.parte('guardar');
    reloj.avanzar(100);
    guardar();
    return { detalle: traza.armar({ estado: 'ok' }), registradas: medicion.registradas };
}

const hijo = (n: NodoDetalle, tipo: string): NodoDetalle => n.hijos!.find((h) => h.tipo === tipo)!;

describe('el caso dorado (docs/asistente-detalle-spec.md §18.3)', () => {
    it('da exactamente los ms, tokens, costos y posiciones del guion', async () => {
        const { detalle: d } = await correrCasoDorado();
        expect(d.nodos.map((n) => n.tipo)).toEqual(['preparacion', 'llamada', 'herramienta', 'llamada', 'guardar']);
        const [prep, l1, herr, l2, guardar] = d.nodos;

        expect(prep).toMatchObject({ desdeMs: 0, ms: 300 });
        expect(prep.hijos!.map((h) => [h.tipo, h.desdeMs, h.ms])).toEqual([
            ['topes', 0, 20],
            ['historial', 20, 100],
            ['contexto', 120, 180],
        ]);

        expect(l1).toMatchObject({ numero: 1, desdeMs: 300, ms: 6100, fin: 'tool_use' });
        expect(l1.costoUsd).toBeCloseTo(0.016951, 6);
        expect(l1.hijos!.map((h) => h.tipo)).toEqual(['espera', 'razonamiento', 'pedido']);
        const e1 = hijo(l1, 'espera');
        expect(e1).toMatchObject({ desdeMs: 300, ms: 1200, msConexion: 400, msPrimerEvento: 1100, msTopes: 2 });
        expect(e1.costoUsd).toBeCloseTo(0.010439, 6);
        expect(e1.tokens).toBe(1180 + 11300 + 2400);
        const r1 = hijo(l1, 'razonamiento');
        expect(r1).toMatchObject({ desdeMs: 1500, ms: 3400, tokens: 412 });
        expect(r1.costoUsd).toBeCloseTo(0.004532, 6);
        expect(r1.estimado).toBeUndefined();
        const p1 = hijo(l1, 'pedido');
        expect(p1).toMatchObject({ desdeMs: 4900, ms: 1500, tokens: 180, nombre: 'probar_plantilla' });
        expect(p1.costoUsd).toBeCloseTo(0.00198, 6);

        expect(herr).toMatchObject({ nombre: 'probar_plantilla', recurso: 'base', desdeMs: 6400, ms: 4800, tokensResultado: 310, descripcion: 'Probé la plantilla: 8.412 casos, sin errores' });
        expect(herr.hijos!.map((h) => [h.tipo, h.desdeMs, h.ms])).toEqual([
            ['validacion', 6400, 0],
            ['espera_base', 6400, 0],
            ['muestra', 6400, 3100],
            ['conteo', 6400, 4720],
        ]);
        expect(herr.hijos!.some((h) => h.tipo === 'otros')).toBe(false);

        expect(l2).toMatchObject({ numero: 2, desdeMs: 11200, ms: 7000, fin: 'end_turn' });
        expect(l2.costoUsd).toBeCloseTo(0.009559, 6);
        const e2 = hijo(l2, 'espera');
        expect(e2).toMatchObject({ ms: 900, msConexion: 300, msPrimerEvento: 800, msTopes: 0 });
        expect(e2.costoUsd).toBeCloseTo(0.002849, 6);
        expect(hijo(l2, 'razonamiento')).toMatchObject({ desdeMs: 12100, ms: 3200, tokens: 230 });
        expect(hijo(l2, 'razonamiento').costoUsd).toBeCloseTo(0.00253, 6);
        expect(hijo(l2, 'respuesta')).toMatchObject({ desdeMs: 15300, ms: 2900, tokens: 380 });
        expect(hijo(l2, 'respuesta').costoUsd).toBeCloseTo(0.00418, 6);

        expect(guardar).toMatchObject({ desdeMs: 18200, ms: 100 });
        expect(d.totalMs).toBe(18300);
        expect(d.costoUsd).toBeCloseTo(0.02651, 6);
        expect(d.llamadas).toBe(2);
        expect(d).toMatchObject({ version: 1, estado: 'ok', motivo: null, parcial: false, incompleto: false, recortado: false, navegador: null });
    });

    it('contigüidad y costos: los hijos de cada llamada suman la llamada, y la suma da lo registrado', async () => {
        const { detalle: d, registradas } = await correrCasoDorado();
        for (const l of d.nodos.filter((n) => n.tipo === 'llamada')) {
            expect(l.hijos!.reduce((a, h) => a + h.ms, 0)).toBe(l.ms);
            let cursor = l.desdeMs;
            for (const h of l.hijos!) {
                expect(h.desdeMs).toBeGreaterThanOrEqual(cursor);
                cursor = h.desdeMs + h.ms;
            }
            expect(l.hijos!.reduce((a, h) => a + (h.costoUsd ?? 0), 0)).toBeCloseTo(l.costoUsd!, 6);
        }
        // Σ del detalle = Σ de lo que se registró en asistente_llamada.
        const registrado = registradas.reduce((a, r) => a + Number(calcularCosto(r.uso, SONNET).toFixed(6)), 0);
        expect(d.costoUsd).toBeCloseTo(registrado, 6);
    });

    it('el resumen del log lleva solo tiempos', async () => {
        const { detalle: d } = await correrCasoDorado();
        expect(resumenParaLog(d)).toBe('(prep 300 · modelo 13100 · herramientas 4800 · guardar 100)');
    });
});

// ---------------------------------------------------------------- una llamada, directo

const uso = (o: Partial<UsoTokens>): UsoTokens => ({ ...USO_VACIO, ...o });

function reg(o: {
    bloques?: { indice: number; tipo: 'thinking' | 'redacted_thinking' | 'text' | 'tool_use' | 'otro'; inicio: number; fin: number | null; herramienta?: string }[];
    uso?: Partial<UsoTokens>;
    costo?: number;
    largos?: CierreLlamada['largos'];
    hasta?: number;
    cierre?: Partial<CierreLlamada> | null;
    desde?: number;
}): RegistroLlamada {
    const u = uso(o.uso ?? {});
    return {
        orden: 0,
        numero: 1,
        desde: o.desde ?? 0,
        tStream: 0,
        tConexion: 10,
        tPrimerEvento: 20,
        bloques: o.bloques ?? [],
        hasta: o.hasta ?? 1000,
        tope: null,
        cierre:
            o.cierre === null
                ? null
                : { uso: u, costo: o.costo ?? Number(calcularCosto(u, SONNET).toFixed(6)), stopReason: 'end_turn', abortada: false, clase: null, usoEstimado: false, largos: o.largos ?? [], ...o.cierre },
    };
}

describe('nodosDeLlamada', () => {
    it('tarifa larga de Haiku con el prompt de más de 100.000 tokens', () => {
        const u = uso({ entrada: 1000, cacheLectura: 120000, salida: 200, thinking: 0 });
        const costo = Number(calcularCosto(u, HAIKU).toFixed(6));
        const n = nodosDeLlamada(
            reg({ uso: u, costo, bloques: [{ indice: 0, tipo: 'text', inicio: 400, fin: 900 }], largos: [{ indice: 0, tipo: 'text', caracteres: 600 }] }),
            HAIKU,
        );
        // 200 tokens a la tarifa larga (2,75 USD/M), no a la normal (0,55).
        expect(hijo(n, 'respuesta').costoUsd).toBeCloseTo((200 * 2.75) / 1e6, 6);
        expect(n.hijos!.reduce((a, h) => a + (h.costoUsd ?? 0), 0)).toBeCloseTo(costo, 6);
    });

    it('sin precio los hijos van sin costo y la llamada con el suyo', () => {
        const n = nodosDeLlamada(reg({ uso: { salida: 100 }, costo: 0.5, bloques: [{ indice: 0, tipo: 'text', inicio: 400, fin: 900 }], largos: [{ indice: 0, tipo: 'text', caracteres: 5 }] }), null);
        expect(n.costoUsd).toBe(0.5);
        expect(n.hijos!.every((h) => h.costoUsd === undefined)).toBe(true);
    });

    it('dos tramos de razonamiento: los tokens se reparten por duración y son estimados', () => {
        const n = nodosDeLlamada(
            reg({
                uso: { salida: 400, thinking: 300 },
                bloques: [
                    { indice: 0, tipo: 'thinking', inicio: 100, fin: 400 },
                    { indice: 1, tipo: 'tool_use', inicio: 400, fin: 500, herramienta: 'leer_pagina' },
                    { indice: 2, tipo: 'thinking', inicio: 500, fin: 1000 },
                ],
                largos: [
                    { indice: 1, tipo: 'tool_use', caracteres: 30 },
                ],
            }),
            SONNET,
        );
        const razon = n.hijos!.filter((h) => h.tipo === 'razonamiento');
        expect(razon.map((r) => r.ms)).toEqual([300, 500]);
        expect(razon.map((r) => r.tokens)).toEqual([113, 187]);
        expect(razon.every((r) => r.estimado)).toBe(true);
        expect(razon.reduce((a, r) => a + r.tokens!, 0)).toBe(300);
    });

    it('texto + tool_use: la salida visible se reparte por caracteres y es estimada; un solo tramo es exacto', () => {
        const dos = nodosDeLlamada(
            reg({
                uso: { salida: 100 },
                bloques: [
                    { indice: 0, tipo: 'text', inicio: 100, fin: 500 },
                    { indice: 1, tipo: 'tool_use', inicio: 500, fin: 900, herramienta: 'leer_pagina' },
                ],
                largos: [
                    { indice: 0, tipo: 'text', caracteres: 300 },
                    { indice: 1, tipo: 'tool_use', caracteres: 100 },
                ],
            }),
            SONNET,
        );
        expect(hijo(dos, 'respuesta')).toMatchObject({ tokens: 75, estimado: true });
        expect(hijo(dos, 'pedido')).toMatchObject({ tokens: 25, estimado: true, nombre: 'leer_pagina' });

        const uno = nodosDeLlamada(reg({ uso: { salida: 100 }, bloques: [{ indice: 0, tipo: 'text', inicio: 100, fin: 900 }], largos: [{ indice: 0, tipo: 'text', caracteres: 10 }] }), SONNET);
        expect(hijo(uno, 'respuesta')).toMatchObject({ tokens: 100 });
        expect(hijo(uno, 'respuesta').estimado).toBeUndefined();

        // Si los caracteres suman 0, en partes iguales y estimado.
        const ceros = nodosDeLlamada(
            reg({
                uso: { salida: 10 },
                bloques: [
                    { indice: 0, tipo: 'text', inicio: 100, fin: 500 },
                    { indice: 1, tipo: 'tool_use', inicio: 500, fin: 900 },
                ],
                largos: [],
            }),
            SONNET,
        );
        expect(hijo(ceros, 'respuesta')).toMatchObject({ tokens: 5, estimado: true });
    });

    it('fusión: thinking de 300 tokens con un bloque de 0 ms, o sin bloque de razonamiento, queda dentro de la espera', () => {
        const conBloque = nodosDeLlamada(
            reg({
                uso: { salida: 400, thinking: 300 },
                bloques: [
                    { indice: 0, tipo: 'thinking', inicio: 600, fin: 600 },
                    { indice: 1, tipo: 'text', inicio: 600, fin: 900 },
                ],
                largos: [{ indice: 1, tipo: 'text', caracteres: 40 }],
            }),
            SONNET,
        );
        const sinBloque = nodosDeLlamada(
            reg({ uso: { salida: 400, thinking: 300 }, bloques: [{ indice: 0, tipo: 'text', inicio: 600, fin: 900 }], largos: [{ indice: 0, tipo: 'text', caracteres: 40 }] }),
            SONNET,
        );
        for (const n of [conBloque, sinBloque]) {
            const e = hijo(n, 'espera');
            expect(e).toMatchObject({ ms: 600, incluyeRazonamiento: true });
            expect(hijo(n, 'razonamiento')).toMatchObject({ sinTiempoPropio: true, ms: 0, tokens: 300, desdeMs: 600 });
            expect(n.hijos!.reduce((a, h) => a + h.ms, 0)).toBe(n.ms);
            expect(n.hijos!.reduce((a, h) => a + (h.costoUsd ?? 0), 0)).toBeCloseTo(n.costoUsd!, 6);
        }
    });

    it('con 30 tokens de razonamiento no fusiona', () => {
        const n = nodosDeLlamada(
            reg({
                uso: { salida: 130, thinking: 30 },
                bloques: [
                    { indice: 0, tipo: 'thinking', inicio: 300, fin: 310 },
                    { indice: 1, tipo: 'text', inicio: 310, fin: 900 },
                ],
                largos: [{ indice: 1, tipo: 'text', caracteres: 40 }],
            }),
            SONNET,
        );
        expect(hijo(n, 'espera').incluyeRazonamiento).toBeUndefined();
        expect(hijo(n, 'razonamiento').sinTiempoPropio).toBeUndefined();
        expect(hijo(n, 'razonamiento').ms).toBe(10);
    });

    it('abortada con el bloque abierto: el tramo queda cortado y los tokens son estimados', () => {
        const n = nodosDeLlamada(
            reg({
                hasta: 700,
                uso: { salida: 10 },
                bloques: [{ indice: 0, tipo: 'text', inicio: 300, fin: null }],
                cierre: { abortada: true, usoEstimado: true, stopReason: null },
                largos: [{ indice: 0, tipo: 'text', caracteres: 30 }],
            }),
            SONNET,
        );
        expect(n).toMatchObject({ fin: 'abortada', estimado: true });
        expect(hijo(n, 'respuesta')).toMatchObject({ cortado: true, estimado: true, tokens: 10, ms: 400 });
    });

    it('timeout y error: la clase del SDK queda en el nodo', () => {
        expect(nodosDeLlamada(reg({ cierre: { clase: 'APIConnectionTimeoutError', stopReason: null } }), SONNET)).toMatchObject({ fin: 'timeout', error: 'APIConnectionTimeoutError' });
        expect(nodosDeLlamada(reg({ cierre: { clase: 'RateLimitError', stopReason: null } }), SONNET)).toMatchObject({ fin: 'error', error: 'RateLimitError' });
    });

    it('sin eventos de bloque pero con salida: sinDesglose y un solo hijo, la espera', () => {
        const n = nodosDeLlamada(reg({ uso: { salida: 50, thinking: 60 } }), SONNET);
        expect(n.sinDesglose).toBe(true);
        expect(n.hijos).toHaveLength(1);
        expect(n.hijos![0]).toMatchObject({ tipo: 'espera', ms: 1000 });
    });

    it('una llamada sin cierre (quedó abierta) se arma cortada y sin costo', () => {
        const n = nodosDeLlamada(reg({ cierre: null, hasta: 800 }), SONNET);
        expect(n).toMatchObject({ fin: 'abortada', cortado: true, ms: 800 });
        expect(n.costoUsd).toBeUndefined();
    });
});

describe('completarHuecos', () => {
    const n = (desdeMs: number, ms: number): NodoDetalle => ({ tipo: 'herramienta', desdeMs, ms });
    it('un hueco de 120 ms es un nodo «otros»; uno de 90 ms no es nada', () => {
        expect(completarHuecos([n(0, 100), n(220, 80)], 0, 300).map((x) => [x.tipo, x.desdeMs, x.ms])).toEqual([
            ['herramienta', 0, 100],
            ['otros', 100, 120],
            ['herramienta', 220, 80],
        ]);
        expect(completarHuecos([n(0, 100), n(190, 110)], 0, 300).some((x) => x.tipo === 'otros')).toBe(false);
    });
    it('los nodos solapados cuentan una sola vez, y los bordes también se completan', () => {
        const r = completarHuecos([n(100, 300), n(150, 100)], 0, 700);
        expect(r.filter((x) => x.tipo === 'otros').map((x) => [x.desdeMs, x.ms])).toEqual([
            [0, 100],
            [400, 300],
        ]);
    });
});

describe('recortarDetalle', () => {
    const base = (nodos: NodoDetalle[]): DetalleRespuesta => ({
        version: 1, funcion: 'ayuda', modelo: 'm', estado: 'ok', motivo: null, totalMs: 1000, primerTextoMs: null, costoUsd: 0, llamadas: 0, nodos, parcial: false, incompleto: false, recortado: false, navegador: null,
    });
    const contar = (ns: NodoDetalle[]): number => ns.reduce((a, x) => a + 1 + contar(x.hijos ?? []), 0);

    it('250 nodos quedan en 200, el resto se cuenta en un nodo «otros» y va recortado', () => {
        const nodos = Array.from({ length: 250 }, (_, i) => ({ tipo: 'herramienta', desdeMs: i, ms: 1 }) as NodoDetalle);
        const r = recortarDetalle(base(nodos));
        expect(r.recortado).toBe(true);
        expect(contar(r.nodos)).toBe(200);
        const otros = r.nodos[r.nodos.length - 1];
        expect(otros.tipo).toBe('otros');
        expect(otros.descripcion).toBe('51 pasos más sin mostrar');
        expect(r.nodos[0]).toEqual(nodos[0]);
    });
    it('un detalle chico no se toca', () => {
        const d = base([{ tipo: 'guardar', desdeMs: 0, ms: 5 }]);
        expect(recortarDetalle(d)).toBe(d);
    });
    it('si pasa los 48 KB con pocos nodos, también se recorta', () => {
        const nodos = Array.from({ length: 190 }, (_, i) => ({ tipo: 'herramienta', desdeMs: i, ms: 1, nombre: 'n'.repeat(80), descripcion: 'x'.repeat(160) }) as NodoDetalle);
        const r = recortarDetalle(base(nodos));
        expect(r.recortado).toBe(true);
        expect(JSON.stringify(r).length).toBeLessThanOrEqual(48 * 1024);
    });
});

describe('detalleDesdeLlamadas (respuestas de antes de la medición)', () => {
    const fila = (iteracion: number, finMs: number, ms: number, extra: Partial<FilaLlamadaGuardada> = {}): FilaLlamadaGuardada => ({
        iteracion, ms, createdAt: new Date(1_700_000_000_000 + finMs), costoUsd: '0.010000', stopReason: 'tool_use', error: null,
        tokensEntrada: 100, tokensSalida: 50, tokensThinking: 0, cacheLectura: 0, cacheEscritura5m: 0, cacheEscritura1h: 0, ...extra,
    });
    const ctx = { funcion: 'ayuda', modelo: 'us.anthropic.claude-sonnet-5-5', precio: SONNET, mensajeMs: 9000, estado: 'ok' as const, textoVacio: false };

    it('dos llamadas: posiciones por createdAt, «sin_detalle» en el hueco, parcial y la suma de costos', () => {
        const d = detalleDesdeLlamadas([fila(0, 2000, 2000, { tokensThinking: 40, tokensSalida: 80 }), fila(1, 8000, 3000, { stopReason: 'end_turn', costoUsd: 0.005 })], ctx)!;
        expect(d.parcial).toBe(true);
        expect(d.nodos.map((n) => [n.tipo, n.desdeMs, n.ms])).toEqual([
            ['llamada', 0, 2000],
            ['sin_detalle', 2000, 3000],
            ['llamada', 5000, 3000],
        ]);
        expect(d.nodos[0]).toMatchObject({ numero: 1, fin: 'tool_use' });
        expect(d.nodos[0].hijos![0]).toMatchObject({ tipo: 'razonamiento', sinTiempoPropio: true, tokens: 40 });
        expect(d.costoUsd).toBeCloseTo(0.015, 6);
        expect(d.llamadas).toBe(2);
        expect(d.totalMs).toBe(9000);
        expect(d.motivo).toBeNull();
    });
    it('un error sin texto es «sin_terminar»; sin llamadas no hay detalle', () => {
        expect(detalleDesdeLlamadas([fila(0, 1000, 1000)], { ...ctx, estado: 'error', textoVacio: true })!.motivo).toBe('sin_terminar');
        expect(detalleDesdeLlamadas([], ctx)).toBeNull();
    });
    it('una llamada abortada y una fallida dicen por qué', () => {
        const d = detalleDesdeLlamadas([fila(0, 1000, 1000, { error: 'abortado', stopReason: null }), fila(1, 1300, 300, { error: 'RateLimitError', stopReason: null })], ctx)!;
        expect(d.nodos.map((n) => n.fin)).toEqual(['abortada', 'error']);
        expect(d.nodos[1].error).toBe('RateLimitError');
    });
});

describe('percentiles, muestras y tabla de tiempos', () => {
    it('percentil por rango más cercano: [1..20] → mediana 10, p95 19; n = 1', () => {
        const v = Array.from({ length: 20 }, (_, i) => i + 1);
        expect(percentil(v, 0.5)).toBe(10);
        expect(percentil(v, 0.95)).toBe(19);
        expect(percentil([7], 0.5)).toBe(7);
        expect(percentil([7], 0.95)).toBe(7);
        expect(percentil([], 0.5)).toBe(0);
    });

    const llamadaN = (n: Partial<NodoDetalle>): NodoDetalle => ({ tipo: 'llamada', desdeMs: 0, ms: 1000, fin: 'end_turn', hijos: [{ tipo: 'espera', desdeMs: 0, ms: 400 }, { tipo: 'respuesta', desdeMs: 400, ms: 600 }], ...n });
    const detalle = (o: Partial<DetalleRespuesta>): DetalleRespuesta => ({
        version: 1, funcion: 'ayuda', modelo: 'm', estado: 'ok', motivo: null, totalMs: 2000, primerTextoMs: null, costoUsd: 0, llamadas: 1, parcial: false, incompleto: false, recortado: false, navegador: null,
        nodos: [{ tipo: 'preparacion', desdeMs: 0, ms: 100 }, llamadaN({}), { tipo: 'herramienta', nombre: 'leer_pagina', desdeMs: 1000, ms: 50 }, { tipo: 'guardar', desdeMs: 1050, ms: 20 }],
        ...o,
    });
    const pasos = (ms: MuestraTiempo[]) => ms.map((m) => `${m.paso}${m.herramienta ? ':' + m.herramienta : ''}=${m.ms}`);

    it('una respuesta ok cuenta todo; el navegador se suma si está', () => {
        expect(pasos(muestrasDeDetalle(detalle({ navegador: { primeraSenalMs: 900, primerTextoMs: 1500, totalMs: 2100 } })))).toEqual([
            'total=2000', 'navegador_total=2100', 'navegador_primer_texto=1500', 'preparacion=100', 'llamada=1000', 'espera=400', 'respuesta=600', 'herramienta:leer_pagina=50', 'guardar=20',
        ]);
    });
    it('lo detenido y lo cortado no baja la mediana', () => {
        const d = detalle({
            estado: 'cortado',
            nodos: [
                llamadaN({ fin: 'abortada' }),
                llamadaN({ fin: 'tope_turno' }),
                llamadaN({ cortado: true }),
                { tipo: 'herramienta', nombre: 'leer_pagina', desdeMs: 0, ms: 9, cortado: true },
                llamadaN({ hijos: [{ tipo: 'razonamiento', desdeMs: 0, ms: 0, sinTiempoPropio: true }, { tipo: 'respuesta', desdeMs: 0, ms: 5, cortado: true }] }),
            ],
        });
        // Solo queda la llamada que terminó (y su tramo sin cortar: ninguno).
        expect(pasos(muestrasDeDetalle(d))).toEqual(['llamada=1000']);
    });
    describe('qué cuenta para la tabla: la respuesta y la llamada que no terminaron bien no suman', () => {
        const nav = { primeraSenalMs: 100, primerTextoMs: 200, totalMs: 4000 };
        const sinTerminar = (fin: string) =>
            detalle({
                nodos: [
                    { tipo: 'preparacion', desdeMs: 0, ms: 100 },
                    llamadaN({ fin }),
                    { tipo: 'herramienta', nombre: 'leer_pagina', desdeMs: 1100, ms: 50 },
                    { tipo: 'guardar', desdeMs: 1150, ms: 20 },
                ],
            });

        it('el caso de la auditoría: 2 respuestas bien y 1 con timeout dan el mismo p95 en el servidor y en el navegador', () => {
            const bien = (total: number) => detalle({ totalMs: total, navegador: { ...nav, totalMs: total + 100 } });
            const timeout = detalle({ estado: 'error', motivo: 'timeout', totalMs: 180_000, navegador: { ...nav, totalMs: 180_100 }, nodos: [llamadaN({ fin: 'timeout', ms: 180_000 })] });
            const muestras = [bien(2000), bien(4000), timeout].flatMap(muestrasDeDetalle);
            const t = tablaDeTiempos(muestras)[0].filas;
            const fila = (p: string) => t.find((f) => f.paso === p)!;
            expect(fila('total')).toMatchObject({ muestras: 2, p95Ms: 4000 });
            expect(fila('navegador_total')).toMatchObject({ muestras: 2, p95Ms: 4100 });
            expect(fila('navegador_primer_texto').muestras).toBe(2);
            // La llamada que venció por timeout no entra: ni en «llamada» ni en sus pasos.
            expect(fila('llamada').muestras).toBe(2);
            expect(fila('espera').muestras).toBe(2);
        });

        it.each(['abortada', 'timeout', 'error', 'tope_turno', 'tope_mensual', 'tope_funcion'])('una llamada con fin «%s» no suma en «llamada» ni en sus pasos', (fin) => {
            const pasos = muestrasDeDetalle(sinTerminar(fin)).map((m) => m.paso);
            expect(pasos).not.toContain('llamada');
            expect(pasos).not.toContain('espera');
            expect(pasos).not.toContain('respuesta');
        });

        it.each(['end_turn', 'tool_use', 'stop_sequence', 'max_tokens', 'refusal', 'pause_turn'])('una llamada que terminó con stop_reason «%s» sí suma', (fin) => {
            expect(muestrasDeDetalle(sinTerminar(fin)).map((m) => m.paso)).toContain('llamada');
        });

        it.each(['cortado', 'rechazado', 'error'] as const)('una respuesta «%s» no suma en ningún total, pero sus pasos que terminaron sí', (estado) => {
            const pasos = muestrasDeDetalle({ ...sinTerminar('end_turn'), estado, navegador: nav }).map((m) => m.paso);
            expect(pasos).not.toContain('total');
            expect(pasos).not.toContain('navegador_total');
            expect(pasos).not.toContain('navegador_primer_texto');
            expect(pasos).toEqual(expect.arrayContaining(['preparacion', 'llamada', 'herramienta', 'guardar']));
        });
    });

    it('la tabla: filas en orden fijo, mediana y p95, y las sin muestras no van', () => {
        const muestras: MuestraTiempo[] = [];
        for (let i = 1; i <= 20; i++) {
            muestras.push({ funcion: 'ayuda', paso: 'total', herramienta: null, ms: i * 10 });
            muestras.push({ funcion: 'ayuda', paso: 'herramienta', herramienta: 'leer_pagina', ms: i });
        }
        muestras.push({ funcion: 'ayuda', paso: 'guardar', herramienta: null, ms: 5 }, { funcion: 'ayuda', paso: 'herramienta', herramienta: 'buscar_en_wiki', ms: 3 }, { funcion: 'reportes', paso: 'total', herramienta: null, ms: 7 });
        const t = tablaDeTiempos(muestras);
        expect(t.map((x) => x.funcion)).toEqual(['ayuda', 'reportes']);
        expect(t[0].filas.map((f) => [f.paso, f.herramienta, f.muestras, f.medianaMs, f.p95Ms])).toEqual([
            ['total', null, 20, 100, 190],
            ['herramienta', 'buscar_en_wiki', 1, 3, 3],
            ['herramienta', 'leer_pagina', 20, 10, 19],
            ['guardar', null, 1, 5, 5],
        ]);
    });
});

describe('rendimiento', () => {
    it('armar 200 nodos lleva menos de 20 ms', () => {
        const herramientas = Array.from({ length: 200 }, (_, i) => ({
            orden: i, nombre: 'leer_pagina', desde: i * 5, hasta: i * 5 + 4, cierre: { esError: false, caracteres: 90 }, partes: [],
        }));
        const t0 = performance.now();
        const d = armarDetalle({
            funcion: 'ayuda', modelo: 'm', precio: SONNET, ahora: 1100, estado: 'ok', motivo: null, primerTextoMs: null, incompleto: false,
            partes: [], llamadas: [], herramientas,
        });
        expect(performance.now() - t0).toBeLessThan(20);
        expect(d.nodos.filter((n) => n.tipo === 'herramienta')).toHaveLength(200);
    });
});
