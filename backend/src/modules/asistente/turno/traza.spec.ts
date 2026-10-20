import { Logger } from '@nestjs/common';
import { PRECIOS_DEFAULT, USO_VACIO } from '../modelo/precios';
import { CierreLlamada } from './detalle';
import { RelojFalso } from './doble-stream-con-tiempos';
import { RECURSO_HERRAMIENTA, TRAZA_NULA, TrazaTurno } from './traza';

const PRECIO = PRECIOS_DEFAULT['us.anthropic.claude-sonnet-5-5'];
const cierre = (o: Partial<CierreLlamada> = {}): CierreLlamada => ({
    uso: { ...USO_VACIO, entrada: 100, salida: 50 },
    costo: 0.001,
    stopReason: 'end_turn',
    abortada: false,
    clase: null,
    usoEstimado: false,
    largos: [],
    ...o,
});

function nueva(reloj = new RelojFalso()) {
    return { reloj, traza: new TrazaTurno({ funcion: 'ayuda', modelo: 'm', precio: PRECIO, reloj: reloj.ahora, mensajeId: 9 }) };
}

describe('TrazaTurno', () => {
    let warn: jest.SpyInstance;
    beforeEach(() => {
        warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());

    it('las partes del servicio, la llamada y la herramienta salen en el orden real y con los instantes del reloj', () => {
        const { reloj, traza } = nueva();
        let fin = traza.parte('topes');
        reloj.avanzar(10);
        fin();
        fin = traza.parte('historial');
        reloj.avanzar(30);
        fin();
        traza.parte('contexto');
        reloj.avanzar(60);
        const l = traza.llamada(0);
        l.stream();
        l.evento({ tipo: 'conexion' });
        reloj.avanzar(200);
        l.evento({ tipo: 'inicio_mensaje' });
        l.evento({ tipo: 'inicio_bloque', indice: 0, bloque: 'tool_use', herramienta: 'leer_pagina' });
        reloj.avanzar(50);
        l.evento({ tipo: 'fin_bloque', indice: 0 });
        l.finStream();
        l.cerrar(cierre({ stopReason: 'tool_use', largos: [{ indice: 0, tipo: 'tool_use', caracteres: 20 }] }));
        const th = traza.herramienta('leer_pagina');
        reloj.avanzar(7);
        th.describir({ texto: 'Leí «Inicio»', estado: 'ok' });
        th.cerrar({ esError: false, caracteresResultado: 300 });
        const g = traza.parte('guardar');
        reloj.avanzar(20);
        g();

        const d = traza.armar({ estado: 'ok' });
        expect(d.nodos.map((n) => [n.tipo, n.desdeMs, n.ms])).toEqual([
            ['preparacion', 0, 100],
            ['llamada', 100, 250],
            ['herramienta', 350, 7],
            ['guardar', 357, 20],
        ]);
        expect(d.nodos[0].hijos!.map((h) => h.tipo)).toEqual(['topes', 'historial', 'contexto']);
        expect(d.nodos[2]).toMatchObject({ nombre: 'leer_pagina', recurso: 'wiki', descripcion: 'Leí «Inicio»', tokensResultado: 100 });
        expect(d.totalMs).toBe(377);
        expect(d.incompleto).toBe(false);
        expect(warn).not.toHaveBeenCalled();
    });

    it('un nombre fuera de la lista cerrada se guarda como «otra», en la herramienta y en el pedido', () => {
        const { reloj, traza } = nueva();
        const l = traza.llamada(0);
        l.evento({ tipo: 'inicio_bloque', indice: 0, bloque: 'tool_use', herramienta: 'x'.repeat(50) });
        reloj.avanzar(10);
        l.evento({ tipo: 'fin_bloque', indice: 0 });
        l.cerrar(cierre({ largos: [{ indice: 0, tipo: 'tool_use', caracteres: 5 }] }));
        const th = traza.herramienta('inventada');
        th.cerrar({ esError: true, caracteresResultado: 0 });
        const d = traza.armar({ estado: 'ok' });
        expect(d.nodos.find((n) => n.tipo === 'herramienta')).toMatchObject({ nombre: 'otra', estado: 'error', descripcion: 'Le devolvió un error al modelo' });
        expect(d.nodos.find((n) => n.tipo === 'llamada')!.hijos!.find((h) => h.tipo === 'pedido')!.nombre).toBe('otra');
        expect(JSON.stringify(d)).not.toContain('xxxxx');
    });

    it('la lista cerrada se puede pasar por función (cartera suma las suyas)', () => {
        const traza = new TrazaTurno({ funcion: 'cartera', modelo: 'm', herramientas: ['ver_cartera'] });
        traza.herramienta('ver_cartera').cerrar({ esError: false, caracteresResultado: 3 });
        traza.herramienta('leer_pagina').cerrar({ esError: false, caracteresResultado: 3 });
        const nombres = traza.armar({ estado: 'ok' }).nodos.filter((n) => n.tipo === 'herramienta').map((n) => n.nombre);
        expect(nombres).toEqual(['ver_cartera', 'otra']);
    });

    it('el recurso sale de RECURSO_HERRAMIENTA o del argumento', () => {
        const { traza } = nueva();
        traza.herramienta('probar_plantilla').cerrar({ esError: false, caracteresResultado: 0 });
        traza.herramienta('ver_otra_hoja', 'base').cerrar({ esError: false, caracteresResultado: 0 });
        const hs = traza.armar({ estado: 'ok' }).nodos.filter((n) => n.tipo === 'herramienta');
        expect(hs.map((h) => h.recurso)).toEqual([RECURSO_HERRAMIENTA.probar_plantilla, 'base']);
    });

    it('primerTextoMs: la primera vez; las siguientes no cambian nada', () => {
        const { reloj, traza } = nueva();
        reloj.avanzar(120);
        traza.marcarPrimerTexto();
        reloj.avanzar(500);
        traza.marcarPrimerTexto();
        expect(traza.armar({ estado: 'ok' }).primerTextoMs).toBe(120);
    });

    it('el motivo: gana el último', () => {
        const { traza } = nueva();
        traza.motivo('tope_turno');
        traza.motivo('interno');
        expect(traza.armar({ estado: 'error' })).toMatchObject({ estado: 'error', motivo: 'interno' });
    });

    describe('nunca lanza', () => {
        it('métodos fuera de orden: cerrar dos veces, un evento después de cerrar, una herramienta sin cerrar', () => {
            const { reloj, traza } = nueva();
            const l = traza.llamada(0);
            l.evento({ tipo: 'inicio_bloque', indice: 0, bloque: 'text' });
            reloj.avanzar(100);
            l.evento({ tipo: 'fin_bloque', indice: 0 });
            l.evento({ tipo: 'fin_bloque', indice: 7 });
            l.cerrar(cierre());
            reloj.avanzar(500);
            l.cerrar(cierre({ costo: 99 }));
            l.evento({ tipo: 'inicio_bloque', indice: 1, bloque: 'tool_use', herramienta: 'leer_pagina' });
            l.finStream();
            traza.herramienta('buscar_en_wiki'); // nunca se cierra
            reloj.avanzar(40);
            const d = traza.armar({ estado: 'cortado' });
            const llamada = d.nodos.find((n) => n.tipo === 'llamada')!;
            expect(llamada.ms).toBe(100);
            expect(llamada.costoUsd).toBe(0.001);
            expect(llamada.hijos!.some((h) => h.tipo === 'pedido')).toBe(false);
            const h = d.nodos.find((n) => n.tipo === 'herramienta')!;
            expect(h).toMatchObject({ cortado: true, ms: 40 });
            expect(warn).not.toHaveBeenCalled();
        });

        it('sin llamadas y sin partes', () => {
            const { reloj, traza } = nueva();
            reloj.avanzar(50);
            const d = traza.armar({ estado: 'error' });
            expect(d).toMatchObject({ llamadas: 0, costoUsd: 0, totalMs: 50, incompleto: false });
        });

        it('un reloj que lanza: incompleto y UN solo warn', () => {
            const reloj = { ahora: () => { throw new Error('reloj roto'); } };
            const traza = new TrazaTurno({ funcion: 'ayuda', modelo: 'm', reloj: reloj.ahora, mensajeId: 5 });
            const fin = traza.parte('topes');
            fin();
            const l = traza.llamada(0);
            l.stream();
            l.evento({ tipo: 'conexion' });
            l.cerrar(cierre());
            traza.herramienta('leer_pagina').cerrar({ esError: false, caracteresResultado: 1 });
            traza.marcarPrimerTexto();
            const d = traza.armar({ estado: 'ok' });
            expect(d.incompleto).toBe(true);
            expect(d.nodos).toEqual([]);
            expect(warn).toHaveBeenCalledTimes(1);
            expect(warn.mock.calls[0][0]).toContain('No se pudo medir el turno 5: reloj roto');
        });

        it('un callback de descripción con algo raro tampoco rompe', () => {
            const { traza } = nueva();
            const th = traza.herramienta('leer_pagina');
            th.describir({ texto: undefined as unknown as string, estado: 'ok' });
            th.cerrar({ esError: false, caracteresResultado: Number.NaN });
            const d = traza.armar({ estado: 'ok' });
            expect(d.nodos.find((n) => n.tipo === 'herramienta')!.tokensResultado).toBe(0);
        });
    });

    it('la descripción se recorta a 160 caracteres por code points', () => {
        const { traza } = nueva();
        const th = traza.herramienta('leer_pagina');
        th.describir({ texto: '😀'.repeat(200), estado: 'ok' });
        th.cerrar({ esError: false, caracteresResultado: 1 });
        const desc = traza.armar({ estado: 'ok' }).nodos.find((n) => n.tipo === 'herramienta')!.descripcion!;
        expect(Array.from(desc)).toHaveLength(160);
    });
});

describe('TRAZA_NULA', () => {
    it('no hace nada y no lanza', () => {
        const l = TRAZA_NULA.llamada(0);
        l.stream();
        l.evento({ tipo: 'conexion' });
        l.finStream();
        l.cerrar(cierre());
        l.cortadaPorTope('TOPE_TURNO');
        const th = TRAZA_NULA.herramienta('leer_pagina');
        th.parte('muestra')();
        th.describir({ texto: 'x', estado: 'ok' });
        th.cerrar({ esError: false, caracteresResultado: 1 });
        TRAZA_NULA.motivo('detenida');
        expect(TRAZA_NULA.llamada(1)).toBe(l);
    });
});
