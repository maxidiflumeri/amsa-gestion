// ImportEnCursoItem (la fila de la campanita) con DTOs de la Fase A, de la B y de C1. Portado del arnés de C1 (04 y 18) para C2b.
// Sin servidor: el componente es presentacional.
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import ImportEnCursoItem from '@fe/components/layout/AppShell/ImportEnCursoItem';
import type { EstadoCargaDto } from '@fe/types/importProgreso';
import { BASURA, T0, dtoC1, dtoFaseA, dtoFaseB, enColaC1, iso, type Sobre } from '../lib/fabricas';
import { chips, limpio, montar, type Montado } from '../lib/montar';

let v: Montado | null = null;
afterEach(async () => { if (v) await v.desmontar(); v = null; });

const SUBFASE_160 = ('Consolidando la remesa de origen con un nombre de paso exageradamente largo para ver si la pantalla lo corta o lo desborda en un celular angosto: ' + '1.234.567 de 9.876.543').padEnd(160, '.').slice(0, 160);

describe('ImportEnCursoItem — campanita', () => {
    async function item(dto: Sobre | EstadoCargaDto) {
        v = await montar(<ImportEnCursoItem carga={dto as EstadoCargaDto} />);
        const r = { texto: v.texto(), chips: chips() };
        await v.desmontar(); v = null;
        return r;
    }

    it('«Procesando · 43% · faltan ~4 min»; sin ETA, como en la Fase A', async () => {
        const conEta = await item(dtoFaseB({ progreso: 43, velocidad: 34, etaSegundos: 240 }));
        expect(conEta.texto).toContain('Procesando · 43% · faltan ~4 min');
        for (const dto of [dtoFaseA({ progreso: 43 }), dtoFaseB({ progreso: 43 }), dtoFaseB({ progreso: 43, velocidad: 34, etaSegundos: null })]) {
            const r = await item(dto);
            expect(r.texto).toContain('Procesando · 43%');
            expect(r.texto).not.toMatch(/faltan|filas\/s/);
            expect(r.texto).not.toMatch(BASURA);
        }
        // La espera solo en PROCESANDO, aunque el DTO traiga una ETA colgada en otra fase.
        const post = await item(dtoFaseB({ fase: 'POST_PROCESO', etaSegundos: 240, velocidad: 34 }));
        expect(post.texto).not.toMatch(/faltan/);
        console.log('campanita:', conEta.texto, '|', JSON.stringify(conEta.chips));
        expect(conEta.chips).toEqual(['Procesadas: 3.000', 'OK: 2.990', 'Err: 10', 'Total: 14.466']);
    });

    it('posición en la cola y subfase aparecen solas; no muestra los contadores nuevos ni avisos', async () => {
        const cola = await item(dtoFaseB({ fase: 'EN_COLA', startedAt: null, heartbeatAt: null, procesadas: 0, ok: 0, err: 0, progreso: 0, enColaDelante: 3, encoladaAt: iso(T0 - 3_600_000) }));
        expect(cola.texto).toContain('Hay 3 importaciones antes que esta.');
        const post = await item(dtoFaseB({ fase: 'POST_PROCESO', subfase: SUBFASE_160, nuevos: 5, actualizados: 6, descartadas: 7 }));
        expect(post.texto).toContain(SUBFASE_160);
        expect(post.chips.some((c) => /Nuevos|Actualizados|Descartadas/.test(c))).toBe(false);
        const colgada = await item(dtoFaseB({ heartbeatAt: iso(T0 - 3_600_000) }));
        expect(colgada.texto).not.toMatch(/señales|soporte/);
        const leyendo = await item(dtoFaseB({ fase: 'LEYENDO', procesadas: 0, ok: 0, err: 0 }));
        expect(leyendo.texto).toContain('Leyendo el archivo');
        expect(leyendo.texto).toContain('Todavía no se procesó ninguna fila.');
        expect(leyendo.texto).not.toMatch(/\d+%/);
    });
});

describe('campanita con un DTO sin `procesadas` u `ok`: qué número muestra', () => {
    it('ya no tira: muestra 0 en el contador que falta y el resto igual', async () => {
        const sinProcesadas: Record<string, unknown> = { ...dtoFaseB({ progreso: 43 }) }; delete sinProcesadas.procesadas;
        const a = await montar(<ImportEnCursoItem carga={sinProcesadas as unknown as EstadoCargaDto} />);
        const chipsA = chips(); await a.desmontar();
        const b2 = await montar(<ImportEnCursoItem carga={{ ...dtoFaseB({ progreso: 43 }), ok: null, err: undefined, totalEsperado: undefined } as unknown as EstadoCargaDto} />);
        const chipsB = chips(); const textoB = b2.texto(); await b2.desmontar();
        console.log('campanita sin `procesadas`:', JSON.stringify(chipsA), '| con ok null y sin err ni total:', JSON.stringify(chipsB));
        expect(chipsA).toEqual(['Procesadas: 0', 'OK: 2.990', 'Err: 10', 'Total: 14.466']);
        expect(chipsB).toEqual(['Procesadas: 3.000', 'OK: 0']);
        expect(textoB).not.toMatch(BASURA);
    });
});


describe('campanita (ImportEnCursoItem)', () => {
    let v: Montado | null = null;
    afterEach(async () => { if (v) await v.desmontar(); v = null; });
    it('grupo, «Cancelando…» y DTO de la Fase B', async () => {
        const casos: Array<[string, EstadoCargaDto]> = [
            ['grupo 2 de 3 procesando', dtoC1({ grupoId: 'g', grupoOrden: 2, grupoTotal: 3, progreso: 43, etaSegundos: 240 })],
            ['grupo 3 de 3 en cola', enColaC1({ grupoId: 'g', grupoOrden: 3, grupoTotal: 3, enColaDelante: 1 })],
            ['cancelación pedida, procesando con ETA', dtoC1({ cancelacionPedidaAt: iso(Date.now()), progreso: 43, etaSegundos: 240 })],
            ['cancelación pedida, en cola', enColaC1({ cancelacionPedidaAt: iso(Date.now()) })],
            ['grupo sin orden (grupoOrden null)', dtoC1({ grupoId: 'g', grupoOrden: null, grupoTotal: 3 })],
            ['Fase B', dtoFaseB({ progreso: 43 })],
            ['Fase A', dtoFaseA({ progreso: 43 })],
        ];
        const visto: Record<string, string> = {};
        for (const [nombre, dto] of casos) {
            v = await montar(<ImportEnCursoItem carga={dto as EstadoCargaDto} />);
            visto[nombre] = limpio(v.contenedor.textContent ?? '');
            expect(visto[nombre], nombre).not.toMatch(BASURA);
            expect(v.contenedor.querySelectorAll('button').length, `${nombre}: sin botones (C2)`).toBe(0);
            await v.desmontar(); v = null;
        }
        console.log('campanita:\n' + Object.entries(visto).map(([k, x]) => `  ${k}: ${x}`).join('\n'));
        expect(visto['grupo 2 de 3 procesando']).toContain('Remesa 00141 · 2 de 3');
        expect(visto['cancelación pedida, procesando con ETA']).toContain('Cancelando…');
        expect(visto['cancelación pedida, procesando con ETA']).not.toContain('Procesando');
        expect(visto['Fase B']).not.toMatch(/ de |Cancelando/);
        expect(visto['Fase A']).not.toMatch(/ de |Cancelando/);
    });
});
