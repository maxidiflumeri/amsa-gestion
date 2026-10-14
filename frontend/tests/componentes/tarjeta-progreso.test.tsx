// C2b: TarjetaProgreso, la tarjeta única de progreso (TP-1 a TP-9, docs/imports-progreso-c2-spec.md §16.3). Sin servidor: es presentacional.
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import TarjetaProgreso, { type TarjetaProgresoProps, type UltimosErrores } from '@fe/components/import/progreso/TarjetaProgreso';
import { fijarAncho } from '../lib/ancho';
import { BASURA, canceladaC1, dtoC1, enColaC1, errorDeCarga, terminalC1 } from '../lib/fabricas';
import { chips, montar, type Montado } from '../lib/montar';

let v: Montado | null = null;
afterEach(async () => { if (v) await v.desmontar(); v = null; });

const mostrar = async (props: Partial<TarjetaProgresoProps> & Pick<TarjetaProgresoProps, 'variante'>, o: { modo?: 'light' | 'dark' } = {}) => {
    v = await montar(<TarjetaProgreso carga={dtoC1({ progreso: 43 })} conectado {...props} />, o);
    return v;
};
const barras = (raiz: ParentNode) => Array.from(raiz.querySelectorAll('.MuiLinearProgress-root')) as HTMLElement[];

describe('TP-1 — variante completa con PROCESANDO', () => {
    it('porcentaje grande, chips con los textos de hoy, ritmo y fase', async () => {
        await mostrar({ variante: 'completa', carga: dtoC1({ progreso: 43, totalEsperado: 14466, procesadas: 6000, ok: 5990, err: 10, velocidad: 34, etaSegundos: 240, descartadas: 5, nuevos: 5000, actualizados: 990 }) });
        const h4 = v!.contenedor.querySelector('h4');
        expect(h4?.textContent).toBe('43%');
        expect(chips(v!.contenedor)).toEqual(['Total: 14.466', 'Procesadas: 6.000', 'OK: 5.990', 'Errores: 10', 'Descartadas: 5', 'Nuevos: 5.000', 'Actualizados: 990']);
        expect(v!.texto()).toContain('≈ 34 filas/s · faltan ~4 min para terminar las filas');
        expect(v!.texto()).toContain('Procesando');
        expect(v!.texto()).not.toMatch(BASURA);
    });
});

describe('TP-2 — variante detalle', () => {
    it('sin porcentaje grande ni chips de contadores; la fase dice «Procesando · 43% completado»', async () => {
        await mostrar({ variante: 'detalle' });
        expect(v!.contenedor.querySelector('h4')).toBeNull();
        expect(chips(v!.contenedor)).toEqual([]);
        expect(v!.texto()).toContain('Procesando · 43% completado');
    });
});

describe('TP-3 — variante compacta', () => {
    it('encabezado, «Err: 3», sin pasos ni últimos errores aunque se pasen', async () => {
        const ultimos: UltimosErrores = { items: [errorDeCarga()], totales: { filas: 3, avisos: 0 }, fallo: false };
        await mostrar({ variante: 'compacta', carga: dtoC1({ progreso: 43, err: 3, grupoId: 'g', grupoOrden: 2, grupoTotal: 3 }), ultimos });
        expect(v!.texto()).toContain('DEUDORES · Remesa 00141 · 2 de 3');
        expect(v!.texto()).toContain('Maxi');
        expect(chips(v!.contenedor)).toEqual(['Procesadas: 3.000', 'OK: 2.990', 'Err: 3', 'Total: 14.466']);
        expect(v!.contenedor.querySelector('.MuiStepper-root')).toBeNull();
        expect(v!.texto()).not.toMatch(/Paso \d|Últimos errores/);
        expect(v!.texto()).toContain('Procesando · 43%');
    });
    it('con la cancelación pedida dice «Cancelando…»', async () => {
        await mostrar({ variante: 'compacta', carga: dtoC1({ cancelacionPedidaAt: new Date().toISOString() }) });
        expect(v!.texto()).toContain('Cancelando…');
        expect(v!.texto()).not.toContain('Procesando');
    });
});

describe('TP-4 — sin estado todavía', () => {
    it('«Enviando a la cola…» y barra indeterminada', async () => {
        await mostrar({ variante: 'completa', carga: null });
        expect(v!.texto()).toContain('Enviando a la cola…');
        expect(barras(v!.contenedor).every((b) => /indeterminate/.test(b.className))).toBe(true);
        expect(v!.contenedor.querySelector('h4')).toBeNull();
        expect(chips(v!.contenedor)).toEqual([]);
    });
});

describe('TP-5 — el celular', () => {
    it('a 360 px: cada contador en una celda de 2 columnas y los pasos en una línea', async () => {
        fijarAncho(360);
        await mostrar({ variante: 'completa', carga: dtoC1({ progreso: 43, err: 10, descartadas: 5 }) });
        const celdas = Array.from(v!.contenedor.querySelectorAll('.MuiGrid-grid-xs-6'));
        expect(celdas.length).toBe(5);
        for (const c of celdas) expect(c.querySelector('.MuiChip-root')).not.toBeNull();
        expect(v!.contenedor.querySelector('.MuiStepper-root')).toBeNull();
        expect(v!.texto()).toContain('Paso 2 de 4 · Procesando');
        expect(v!.texto()).not.toContain('43 %');
    });
    it('a 1280 px: un Stepper de 4 pasos', async () => {
        fijarAncho(1280);
        await mostrar({ variante: 'completa' });
        expect(v!.contenedor.querySelectorAll('.MuiStepper-root .MuiStep-root')).toHaveLength(4);
        expect(v!.texto()).not.toMatch(/Paso 2 de 4/);
    });
});

describe('TP-6 — una división', () => {
    const grupo = () => [
        terminalC1('OK', { remesaId: 141, numeroRemesa: '3081', grupoId: 'g', grupoOrden: 1, grupoTotal: 3 }),
        dtoC1({ remesaId: 142, numeroRemesa: '3082', grupoId: 'g', grupoOrden: 2, grupoTotal: 3, progreso: 43 }),
        enColaC1({ remesaId: 143, numeroRemesa: '3083', grupoId: 'g', grupoOrden: 3, grupoTotal: 3 }),
    ];
    const CORTE_LARGO = 'Nómina: ' + 'ABCDEFGHIJ'.repeat(12);

    it('completa: «Remesas terminadas: 1 de 3», la barra del grupo y una por remesa, con la etiqueta única y el corte largo que se parte', async () => {
        const g = grupo();
        await mostrar({ variante: 'completa', carga: g[1], grupo: g, totalGrupo: 3, cortes: { 141: '3081', 142: CORTE_LARGO, 143: '3083' } });
        expect(v!.texto()).toContain('Remesas terminadas: 1 de 3');
        const delGrupo = v!.contenedor.querySelector('[aria-label="Remesas terminadas"]') as HTMLElement;
        expect(delGrupo.getAttribute('aria-valuenow')).toBe('33');
        const porRemesa = ['3081', '3082', '3083'].map((n) => v!.contenedor.querySelector(`[aria-label="Remesa ${n}"]`) as HTMLElement);
        expect(porRemesa.map((b) => b.getAttribute('aria-valuenow'))).toEqual(['100', '43', '0']);
        expect(chips(v!.contenedor)).toEqual(expect.arrayContaining(['Finalizada', 'Procesando 43 %', 'En cola']));
        const corte = Array.from(v!.contenedor.querySelectorAll('p')).find((p) => p.textContent === CORTE_LARGO) as HTMLElement;
        expect(corte.className).toBeTruthy();
        expect(getComputedStyle(corte).overflowWrap).toBe('anywhere');
        expect(getComputedStyle(corte.parentElement as HTMLElement).flexWrap).toBe('wrap');
    });

    it('detalle: solo la barra del grupo, sin filas por remesa', async () => {
        const g = grupo();
        await mostrar({ variante: 'detalle', carga: g[1], grupo: g, totalGrupo: 3 });
        expect(v!.texto()).toContain('Remesas terminadas: 1 de 3');
        expect(v!.contenedor.querySelector('[aria-label="Remesas terminadas"]')).not.toBeNull();
        expect(v!.contenedor.querySelector('[aria-label="Remesa 3081"]')).toBeNull();
        expect(chips(v!.contenedor)).toEqual([]);
    });

    it('con una sola remesa en el grupo no se dibuja el bloque', async () => {
        const g = grupo().slice(0, 1);
        await mostrar({ variante: 'completa', carga: g[0], grupo: g });
        expect(v!.texto()).not.toContain('Remesas terminadas');
    });

    it('con eliminadas, el total es el de la división', async () => {
        const g = grupo().slice(0, 2);
        await mostrar({ variante: 'completa', carga: g[1], grupo: g, totalGrupo: 3 });
        expect(v!.texto()).toContain('Remesas terminadas: 1 de 3');
    });
});

describe('TP-7 — últimos errores y avisos', () => {
    const cinco: UltimosErrores = {
        items: [
            errorDeCarga({ id: 5, tipo: 'FILA', fila: 1234, errorMsg: 'DNI inválido' }),
            errorDeCarga({ id: 4, tipo: 'FILA', fila: 1200, errorMsg: 'Saldo negativo' }),
            errorDeCarga({ id: 3, tipo: 'FILA', fila: 99, errorMsg: 'Falta el nombre' }),
            errorDeCarga({ id: 2, tipo: 'AVISO', fila: null, errorMsg: '[aviso] Columna sin mapear' }),
            errorDeCarga({ id: 1, tipo: 'FILA', fila: 1, errorMsg: 'Fecha inválida' }),
        ],
        totales: { filas: 1204, avisos: 1 },
        fallo: false,
    };
    const conErr = dtoC1({ progreso: 43, err: 1204, advertencias: 1 });

    it('cinco líneas «Fila 1.234 · …» / «Aviso · …» y la línea de totales con singular', async () => {
        await mostrar({ variante: 'completa', carga: conErr, ultimos: cinco });
        const t = v!.texto();
        expect(t).toContain('Últimos errores y avisos');
        expect(t).toContain('En total: 1.204 errores de fila y 1 aviso');
        for (const linea of ['Fila 1.234 · DNI inválido', 'Fila 1.200 · Saldo negativo', 'Fila 99 · Falta el nombre', 'Aviso · [aviso] Columna sin mapear', 'Fila 1 · Fecha inválida']) expect(t).toContain(linea);
    });
    it('los totales omiten la parte que vale 0', async () => {
        await mostrar({ variante: 'detalle', carga: conErr, ultimos: { ...cinco, totales: { filas: 0, avisos: 3 } } });
        expect(v!.texto()).toContain('En total: 3 avisos');
        expect(v!.texto()).not.toContain('errores de fila');
    });
    it('sin totales (un backend viejo) no hay línea de totales', async () => {
        await mostrar({ variante: 'completa', carga: conErr, ultimos: { ...cinco, totales: null } });
        expect(v!.texto()).not.toContain('En total');
        expect(v!.texto()).toContain('Fila 1.234 · DNI inválido');
    });
    it('`fallo` sin items: el caption', async () => {
        await mostrar({ variante: 'completa', carga: conErr, ultimos: { items: [], totales: null, fallo: true } });
        expect(v!.texto()).toContain('No se pudieron leer los últimos errores.');
    });
    it('`fallo` con items: se conservan las líneas y no hay caption', async () => {
        await mostrar({ variante: 'completa', carga: conErr, ultimos: { ...cinco, fallo: true } });
        expect(v!.texto()).toContain('Fila 1.234 · DNI inválido');
        expect(v!.texto()).not.toContain('No se pudieron leer');
    });
    it('`ultimos` undefined o null: no hay sección', async () => {
        await mostrar({ variante: 'completa', carga: conErr });
        expect(v!.texto()).not.toContain('Últimos errores');
        await v!.desmontar();
        await mostrar({ variante: 'completa', carga: conErr, ultimos: null });
        expect(v!.texto()).not.toContain('Últimos errores');
    });
    it('sin errores ni avisos en la carga no hay sección aunque se pase', async () => {
        await mostrar({ variante: 'completa', carga: dtoC1({ err: 0, advertencias: 0 }), ultimos: cinco });
        expect(v!.texto()).not.toContain('Últimos errores');
    });
});

describe('TP-8 — las acciones', () => {
    for (const variante of ['completa', 'detalle', 'compacta'] as const) {
        it(`se dibujan en la variante ${variante}`, async () => {
            await mostrar({ variante, acciones: <button type="button">Acción de prueba</button> });
            expect(v!.contenedor.textContent).toContain('Acción de prueba');
        });
    }
});

describe('TP-9 — modo oscuro', () => {
    it('monta las tres variantes sin errores', async () => {
        for (const variante of ['completa', 'detalle', 'compacta'] as const) {
            await mostrar({ variante, carga: dtoC1({ err: 2 }), ultimos: { items: [errorDeCarga()], totales: { filas: 2, avisos: 0 }, fallo: false } }, { modo: 'dark' });
            expect(v!.texto()).not.toMatch(BASURA);
            await v!.desmontar(); v = null;
        }
    });
    it('una cancelada en la variante completa muestra «Cancelada» en el paso final', async () => {
        await mostrar({ variante: 'completa', carga: canceladaC1() });
        expect(v!.texto()).toContain('Cancelada');
    });
});

describe('TP-10 — nada se dice dos veces en la variante completa (auditoría de C2b)', () => {
    const veces = (texto: string, buscado: string) => texto.split(buscado).length - 1;
    for (const ancho of [360, 1280]) {
        it(`a ${ancho} px: «Enviando a la cola…», la posición en la cola y el porcentaje, una vez cada uno`, async () => {
            fijarAncho(ancho);
            await mostrar({ variante: 'completa', carga: null });
            expect(veces(v!.texto(), 'Enviando a la cola…')).toBe(1);
            await v!.desmontar();
            v = null;
            await mostrar({ variante: 'completa', carga: enColaC1({ enColaDelante: 1 }) });
            expect(veces(v!.texto(), 'antes que esta.')).toBe(1);
            await v!.desmontar();
            v = null;
            await mostrar({ variante: 'completa', carga: dtoC1({ progreso: 43 }) });
            expect(veces(v!.texto().replace(/\s/g, ''), '43%')).toBe(1);
        });
    }
});

