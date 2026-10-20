// components/asistente/formatoDetalle.ts: los formatos y las etiquetas del detalle de la respuesta (docs/asistente-detalle-spec.md §12.3).
import { describe, expect, it } from 'vitest';
import {
    anchoBarra, colorDeBarra, enParalelo, etiquetaNodo, etiquetaPaso, formatearMs, formatearUsd, lineaNavegador, nombreModelo, seSolapan,
    textoMotivo, tiempoParaLector,
} from '@fe/components/asistente/formatoDetalle';
import type { MotivoFin, NodoDetalle } from '@fe/types/asistente';

const nodo = (tipo: string, extra: Partial<NodoDetalle> = {}): NodoDetalle => ({ tipo, desdeMs: 0, ms: 100, ...extra });

describe('formatearMs', () => {
    it('menos de 50 ms es «< 0,1 s»; después, un decimal con coma; desde 100 s, sin decimales', () => {
        expect(formatearMs(0)).toBe('< 0,1 s');
        expect(formatearMs(49)).toBe('< 0,1 s');
        expect(formatearMs(50)).toBe('0,1 s');
        expect(formatearMs(6100)).toBe('6,1 s');
        expect(formatearMs(18_300)).toBe('18,3 s');
        expect(formatearMs(99_940)).toBe('99,9 s');
        expect(formatearMs(99_960)).toBe('100 s');
        expect(formatearMs(125_000)).toBe('125 s');
    });
    it('un valor que no es un número no rompe', () => {
        expect(formatearMs(Number.NaN)).toBe('< 0,1 s');
    });
});

describe('formatearUsd', () => {
    it('desde 0,01 con 3 decimales; desde 0,0001 con 4; por debajo, «< USD 0,0001»', () => {
        expect(formatearUsd(0.0169)).toBe('USD 0,017');
        expect(formatearUsd(0.02651)).toBe('USD 0,027');
        expect(formatearUsd(0.0028)).toBe('USD 0,0028');
        expect(formatearUsd(0.00198)).toBe('USD 0,0020');
        expect(formatearUsd(0.0001)).toBe('USD 0,0001');
        expect(formatearUsd(0.00004)).toBe('< USD 0,0001');
    });
    it('sin costo no hay nada que mostrar', () => {
        expect(formatearUsd(0)).toBe('');
        expect(formatearUsd(undefined)).toBe('');
        expect(formatearUsd(null)).toBe('');
        expect(formatearUsd(Number.NaN)).toBe('');
    });
});

describe('nombreModelo', () => {
    it('toma la familia y la versión del id', () => {
        expect(nombreModelo('us.anthropic.claude-sonnet-5-5')).toBe('Sonnet 5.5');
        expect(nombreModelo('us.anthropic.claude-haiku-5-5')).toBe('Haiku 5.5');
        expect(nombreModelo('us.anthropic.claude-opus-4-1-20250805-v1:0')).toBe('Opus 4.1');
    });
    it('si no tiene esa forma, el id tal cual', () => {
        expect(nombreModelo('modelo-raro')).toBe('modelo-raro');
    });
});

describe('seSolapan / enParalelo', () => {
    const a = nodo('muestra', { desdeMs: 6440, ms: 3100 });
    const b = nodo('conteo', { desdeMs: 6440, ms: 4720 });
    it('dos intervalos que se pisan más de 0 ms están en paralelo', () => {
        expect(seSolapan(a, b)).toBe(true);
        expect(seSolapan(b, a)).toBe(true);
    });
    it('uno a continuación del otro, o separados, no', () => {
        expect(seSolapan(nodo('validacion', { desdeMs: 100, ms: 20 }), nodo('espera_base', { desdeMs: 120, ms: 20 }))).toBe(false);
        expect(seSolapan(nodo('x', { desdeMs: 0, ms: 10 }), nodo('y', { desdeMs: 50, ms: 10 }))).toBe(false);
    });
    it('enParalelo marca a los hermanos que se solapan con alguno', () => {
        const hermanos = [nodo('validacion', { desdeMs: 6400, ms: 20 }), nodo('espera_base', { desdeMs: 6420, ms: 20 }), a, b];
        expect(enParalelo(hermanos)).toEqual([false, false, true, true]);
        expect(enParalelo([])).toEqual([]);
    });
});

describe('anchoBarra', () => {
    it('es proporcional al total y nunca se sale de la pista', () => {
        expect(anchoBarra({ desdeMs: 300, ms: 6100 }, 18_300)).toEqual({ izquierda: expect.closeTo(1.64, 2), ancho: expect.closeTo(33.33, 2) });
        expect(anchoBarra({ desdeMs: 18_000, ms: 900 }, 18_300).izquierda + anchoBarra({ desdeMs: 18_000, ms: 900 }, 18_300).ancho).toBeCloseTo(100, 5);
        expect(anchoBarra({ desdeMs: -5, ms: 10 }, 100).izquierda).toBe(0);
    });
    it('sin total no hay barra', () => {
        expect(anchoBarra({ desdeMs: 10, ms: 10 }, 0)).toEqual({ izquierda: 0, ancho: 0 });
        expect(anchoBarra({ desdeMs: 10, ms: 10 }, Number.NaN)).toEqual({ izquierda: 0, ancho: 0 });
    });
});

describe('etiquetaNodo', () => {
    it('una etiqueta para cada tipo', () => {
        expect(etiquetaNodo(nodo('preparacion'))).toBe('Preparación');
        expect(etiquetaNodo(nodo('topes'))).toBe('Topes y límite del día');
        expect(etiquetaNodo(nodo('historial'))).toBe('Conversación e historial');
        expect(etiquetaNodo(nodo('contexto'))).toBe('Armado del pedido');
        expect(etiquetaNodo(nodo('llamada', { numero: 1 }))).toBe('Llamada 1');
        expect(etiquetaNodo(nodo('espera'))).toBe('Espera del primer token');
        expect(etiquetaNodo(nodo('espera', { incluyeRazonamiento: true }))).toBe('Espera del primer token (incluye el razonamiento)');
        expect(etiquetaNodo(nodo('razonamiento', { tokens: 412 }))).toBe('Razonamiento (412 tokens)');
        expect(etiquetaNodo(nodo('razonamiento', { tokens: 1500, estimado: true }))).toBe('Razonamiento (≈ 1.500 tokens)');
        expect(etiquetaNodo(nodo('razonamiento'))).toBe('Razonamiento');
        expect(etiquetaNodo(nodo('respuesta', { tokens: 380 }))).toBe('Respuesta (380 tokens)');
        expect(etiquetaNodo(nodo('pedido', { nombre: 'probar_plantilla', tokens: 180 }))).toBe('Pide «probar_plantilla» (180 tokens)');
        expect(etiquetaNodo(nodo('herramienta', { nombre: 'probar_plantilla', recurso: 'base' }))).toBe('Herramienta probar_plantilla (base)');
        expect(etiquetaNodo(nodo('herramienta', { nombre: 'leer_pagina', recurso: 'wiki' }))).toBe('Herramienta leer_pagina (documentación)');
        expect(etiquetaNodo(nodo('herramienta', { nombre: 'ofrecer_ir_a', recurso: 'memoria' }))).toBe('Herramienta ofrecer_ir_a (memoria)');
        expect(etiquetaNodo(nodo('herramienta', { nombre: 'otra' }))).toBe('Herramienta otra');
        expect(etiquetaNodo(nodo('validacion'))).toBe('Validación');
        expect(etiquetaNodo(nodo('espera_base'))).toBe('Espera de lugar en la base');
        expect(etiquetaNodo(nodo('muestra'))).toBe('Muestra (100 casos)');
        expect(etiquetaNodo(nodo('conteo'))).toBe('Conteo de casos');
        expect(etiquetaNodo(nodo('guardar'))).toBe('Guardar');
        expect(etiquetaNodo(nodo('otros'))).toBe('Otros (sin medir)');
        expect(etiquetaNodo(nodo('sin_detalle'))).toBe('Herramientas y otros (sin detalle)');
    });
    it('la llamada dice cómo terminó cuando no fue normal', () => {
        expect(etiquetaNodo(nodo('llamada', { numero: 3, fin: 'tope_turno' }))).toBe('Llamada 3: no se hizo (tope de gasto de la respuesta)');
        expect(etiquetaNodo(nodo('llamada', { numero: 3, fin: 'tope_mensual' }))).toBe('Llamada 3: no se hizo (tope de gasto del mes)');
        expect(etiquetaNodo(nodo('llamada', { numero: 3, fin: 'tope_funcion' }))).toBe('Llamada 3: no se hizo (tope de gasto de la función)');
        expect(etiquetaNodo(nodo('llamada', { numero: 2, fin: 'abortada' }))).toBe('Llamada 2 · detenida');
        expect(etiquetaNodo(nodo('llamada', { numero: 2, fin: 'timeout', error: 'APIConnectionTimeoutError' }))).toBe('Llamada 2 · no respondió a tiempo');
        expect(etiquetaNodo(nodo('llamada', { numero: 2, fin: 'error', error: 'RateLimitError' }))).toBe('Llamada 2 · falló (RateLimitError)');
        expect(etiquetaNodo(nodo('llamada', { numero: 2, fin: 'end_turn' }))).toBe('Llamada 2');
    });
    it('un tipo que no conoce se muestra tal cual', () => {
        expect(etiquetaNodo(nodo('consulta_cartera'))).toBe('consulta_cartera');
    });
});

describe('textoMotivo', () => {
    const todos: MotivoFin[] = [
        'tarjeta', 'respuesta_vacia', 'detenida', 'tope_turno', 'max_tokens', 'iteraciones', 'otro_corte', 'rechazo', 'tope_mensual', 'tope_funcion',
        'modelo_no_disponible', 'timeout', 'prompt_demasiado_grande', 'interno', 'sin_terminar',
    ];
    it('cada motivo tiene su línea y ninguna queda vacía ni repetida', () => {
        const textos = todos.map((m) => textoMotivo('cortado', m, 6200));
        for (const t of textos) expect(t.trim()).not.toBe('');
        expect(new Set(textos).size).toBe(todos.length);
    });
    it('los que el spec nombra', () => {
        expect(textoMotivo('cortado', 'detenida', 6200)).toBe('La detuviste a los 6,2 s');
        expect(textoMotivo('cortado', 'detenida')).toBe('La detuviste');
        expect(textoMotivo('cortado', 'tope_turno')).toBe('Cortada por el tope de gasto de la respuesta');
    });
    it('sin motivo, lo dice el estado', () => {
        expect(textoMotivo('ok', null)).toBe('terminó bien');
        expect(textoMotivo('cortado', null)).toBe('cortada');
        expect(textoMotivo('rechazado', null)).toBe('rechazada');
        expect(textoMotivo('error', null)).toBe('terminó con error');
    });
    it('un motivo que no conoce se muestra tal cual', () => {
        expect(textoMotivo('error', 'algo_nuevo')).toBe('algo_nuevo');
    });
});

describe('lo demás', () => {
    it('colorDeBarra: solo claves de la paleta', () => {
        expect(colorDeBarra('llamada')).toBe('primary.main');
        expect(colorDeBarra('espera')).toBe('primary.main');
        expect(colorDeBarra('razonamiento')).toBe('secondary.main');
        expect(colorDeBarra('herramienta')).toBe('info.main');
        expect(colorDeBarra('conteo')).toBe('info.main');
        expect(colorDeBarra('guardar')).toBe('text.disabled');
        expect(colorDeBarra('tipo_nuevo')).toBe('text.disabled');
    });
    it('tiempoParaLector dice «segundos»', () => {
        expect(tiempoParaLector(6100)).toBe('6,1 segundos');
        expect(tiempoParaLector(10)).toBe('menos de 0,1 segundos');
    });
    it('lineaNavegador', () => {
        expect(lineaNavegador(null)).toBeNull();
        expect(lineaNavegador({ primeraSenalMs: 900, primerTextoMs: 18_500, totalMs: 18_600 })).toBe('En tu navegador: primer texto a los 18,5 s · completa a los 18,6 s');
        expect(lineaNavegador({ primeraSenalMs: 900, primerTextoMs: null, totalMs: 4000 })).toBe('En tu navegador: primera señal a los 0,9 s · completa a los 4,0 s');
        expect(lineaNavegador({ primeraSenalMs: null, primerTextoMs: null, totalMs: 4000 })).toBe('En tu navegador: completa a los 4,0 s');
    });
    it('etiquetaPaso: la de cada fila de la tabla de Consumo', () => {
        expect(etiquetaPaso('total', null)).toBe('Total en el servidor');
        expect(etiquetaPaso('navegador_total', null)).toBe('Total en el navegador (de todos)');
        expect(etiquetaPaso('navegador_primer_texto', null)).toBe('Primer texto en el navegador (de todos)');
        expect(etiquetaPaso('herramienta', 'leer_pagina')).toBe('Herramienta leer_pagina');
        expect(etiquetaPaso('espera', null)).toBe('Espera del primer token');
        expect(etiquetaPaso('paso_nuevo', null)).toBe('paso_nuevo');
    });
});

describe('arreglos de la auditoría', () => {
    it('una llamada que quedó sin cierre dice «quedó abierta»; una detenida, «detenida»', () => {
        // Una excepción interna la dejó abierta: el backend la manda con `cortado`.
        expect(etiquetaNodo(nodo('llamada', { numero: 2, fin: 'abortada', cortado: true }))).toBe('Llamada 2 · quedó abierta');
        // Detener la cierra como abortada, sin `cortado`, aunque después falle algo interno y el motivo sea `interno`.
        expect(etiquetaNodo(nodo('llamada', { numero: 2, fin: 'abortada' }))).toBe('Llamada 2 · detenida');
    });
    it('un tope que llega con la respuesta completa no es un corte', () => {
        expect(textoMotivo('ok', 'tope_turno')).toBe('terminó bien; la última llamada no se hizo por el tope de gasto de la respuesta');
        expect(textoMotivo('ok', 'tope_mensual')).toBe('terminó bien; la última llamada no se hizo por el tope de gasto del mes');
        expect(textoMotivo('ok', 'tope_funcion')).toBe('terminó bien; la última llamada no se hizo por el tope de gasto de la función');
        expect(textoMotivo('cortado', 'tope_turno')).toBe('Cortada por el tope de gasto de la respuesta');
    });
    it('el nodo «otros» que resume lo recortado muestra su texto', () => {
        expect(etiquetaNodo(nodo('otros', { descripcion: '12 pasos más sin mostrar' }))).toBe('12 pasos más sin mostrar');
        expect(etiquetaNodo(nodo('otros', { descripcion: '  ' }))).toBe('Otros (sin medir)');
    });
});
