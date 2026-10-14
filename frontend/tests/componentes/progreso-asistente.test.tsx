// Portado del arnés de C1 (04-componentes): el paso «Importando» y los contadores ausentes. Red de la tarjeta de C2b.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ImportProgress from '@fe/components/import/ImportProgress';
import type { EstadoCargaDto } from '@fe/types/importProgreso';
import ImportSummary from '@fe/components/import/ImportSummary';
import ImportEnCursoItem from '@fe/components/layout/AppShell/ImportEnCursoItem';
import { BASURA, MOTIVO_CON_SALTO, MOTIVO_INTERRUPCION, T0, TXT, dtoFaseA, dtoFaseB, iso, terminal } from '../lib/fabricas';
import { ServidorFalso } from '../lib/servidor-falso';
import { alertas, chips, esperar, iniciarSesion, limpio, montar, pasar, type Montado } from '../lib/montar';

let v: Montado | null = null;
afterEach(async () => { if (v) await v.desmontar(); v = null; });

const SUBFASE_160 = ('Consolidando la remesa de origen con un nombre de paso exageradamente largo para ver si la pantalla lo corta o lo desborda en un celular angosto: ' + '1.234.567 de 9.876.543').padEnd(160, '.').slice(0, 160);

describe('ImportProgress — paso «Importando»', () => {
    let srv: ServidorFalso; let actual: any; const completadas: any[] = [];
    beforeEach(async () => {
        completadas.length = 0;
        srv = await new ServidorFalso().levantar();
        srv.en('GET', /^\/import\/remesas\/141\/progreso$/, () => ({ body: actual }));
        iniciarSesion();
    });
    afterEach(async () => { if (v) await v.desmontar(); v = null; await srv.bajar(); });

    async function pantalla(dto: any) {
        actual = dto;
        v = await montar(<ImportProgress remesaId={141} onComplete={(e) => completadas.push(e)} />, { conSocket: true });
        await esperar(() => srv.sockets.size === 1 && chips().length > 0, { que: 'la carga dibujada' });
        await pasar(150);
        const r = { texto: v.texto(), chips: chips(), alertas: alertas() };
        await v.desmontar(); v = null;
        await esperar(() => srv.sockets.size === 0, { que: 'socket cerrado' });
        return r;
    }

    it('DTO con la forma de la Fase A en cada fase: sin NaN/undefined/null, sin contadores inventados, sin línea de ritmo', async () => {
        const visto: Record<string, unknown> = {};
        for (const fase of ['EN_COLA', 'LEYENDO', 'PROCESANDO', 'POST_PROCESO', 'FASE_NUEVA']) {
            const dto = dtoFaseA({ fase, descartadas: 9000 });
            if (fase !== 'POST_PROCESO') delete (dto as Partial<EstadoCargaDto>).subfase; // ni siquiera el campo
            const r = await pantalla(dto);
            visto[fase] = { chips: r.chips, texto: r.texto.replace('Ejecutando importación', '').trim() };
            expect(r.texto, fase).not.toMatch(BASURA);
            expect(r.chips.some((c) => /Nuevos|Actualizados/.test(c)), `${fase}: Nuevos/Actualizados con el dato ausente`).toBe(false);
            expect(r.texto, fase).not.toMatch(/filas\/s|faltan/);
            expect(r.chips).toContain('Descartadas: 9.000'); // respaldo de §9.4.5: el total
        }
    });

    it('campos nuevos en null: igual que ausentes', async () => {
        for (const fase of ['EN_COLA', 'LEYENDO', 'PROCESANDO', 'POST_PROCESO']) {
            const r = await pantalla(dtoFaseB({ fase, descartadas: 0 }));
            expect(r.texto, fase).not.toMatch(BASURA);
            expect(r.chips.some((c) => /Nuevos|Actualizados|Descartadas/.test(c)), fase).toBe(false);
            expect(r.texto, fase).not.toMatch(/filas\/s|faltan/);
        }
    });

    it('Fase B completa: chips con separador de miles, Descartadas = por filtro, Nuevos/Actualizados, ritmo, posición, subfase', async () => {
        const p = await pantalla(dtoFaseB({ procesadas: 3000, ok: 2990, err: 10, descartadas: 14_300, fueraDeCorte: 14_000, nuevos: 1200, actualizados: 0, velocidad: 33.3, etaSegundos: 344, progreso: 20 }));
        expect(p.chips).toEqual(['Total: 14.466', 'Procesadas: 3.000', 'OK: 2.990', 'Errores: 10', 'Descartadas: 300', 'Nuevos: 1.200', 'Actualizados: 0']);
        expect(p.texto).toContain('≈ 33,3 filas/s · faltan ~6 min para terminar las filas');
        expect(p.texto).toContain('20%');
        // C2b (§16.3): la línea de ritmo sigue debajo de los contadores y antes de la fase; después de la fase puede venir la sección de últimos errores.
        expect(p.texto).toMatch(/para terminar las filasProcesando/);

        const c0 = await pantalla(dtoFaseB({ fase: 'EN_COLA', startedAt: null, heartbeatAt: null, procesadas: 0, ok: 0, err: 0, progreso: 0, enColaDelante: 0 }));
        expect(c0.texto).toContain('En colaEs la próxima: empieza en instantes.');
        const c1 = await pantalla(dtoFaseB({ fase: 'EN_COLA', startedAt: null, heartbeatAt: null, procesadas: 0, ok: 0, err: 0, progreso: 0, enColaDelante: 1 }));
        expect(c1.texto).toContain('En colaHay 1 importación antes que esta.');
        const c4 = await pantalla(dtoFaseB({ fase: 'EN_COLA', startedAt: null, heartbeatAt: null, procesadas: 0, ok: 0, err: 0, progreso: 0, enColaDelante: 4 }));
        expect(c4.texto).toContain('En colaHay 4 importaciones antes que esta.');
        expect(c4.texto).not.toMatch(/\d+%/);

        const l = await pantalla(dtoFaseB({ fase: 'LEYENDO', procesadas: 0, ok: 0, err: 0, progreso: 0 }));
        expect(l.texto).toContain('Leyendo el archivoTodavía no se procesó ninguna fila.');
        expect(l.texto).not.toMatch(/\d+%/);

        const pp = await pantalla(dtoFaseB({ fase: 'POST_PROCESO', subfase: SUBFASE_160, progreso: 99, procesadas: 14_466, ok: 14_466, err: 0 }));
        expect(pp.texto).toContain('Post-proceso' + SUBFASE_160);
        expect(pp.texto).not.toMatch(/99%|filas\/s/);
    });

    it('la `carga` del POST siembra el estado aunque la consulta tarde (Fase A) y trae la posición', async () => {
        srv.en('GET', /^\/import\/remesas\/141\/progreso$/, () => ({ demoraMs: 1500, body: dtoFaseB({ fase: 'BORRADOR', enCurso: false, rev: 1 }) }));
        const sembrada = dtoFaseB({ fase: 'EN_COLA', rev: 2, startedAt: null, heartbeatAt: null, procesadas: 0, ok: 0, err: 0, progreso: 0, enColaDelante: 2 });
        v = await montar(<ImportProgress remesaId={141} onComplete={(e) => completadas.push(e)} estadoInicial={sembrada} />, { conSocket: true });
        await pasar(200);
        expect(v.texto()).toContain('En colaHay 2 importaciones antes que esta.');
        await pasar(1800); // llega la respuesta vieja (rev 1): no pisa
        expect(v.texto()).toContain('En colaHay 2 importaciones antes que esta.');
        srv.emitir('import:finalizada', terminal('OK', { rev: 30 }));
        await esperar(() => completadas.length === 1, { que: 'onComplete' });
        await pasar(300);
        expect(completadas.length).toBe(1);
    });
});

describe('formatearNumero en los lugares nuevos, con un contador obligatorio ausente (DTO que viola el contrato)', () => {
    // esEstadoCarga solo exige remesaId, rev, terminal y enCurso: un payload sin `procesadas` u `ok` llega a la pantalla.
    async function intentar(nombre: string, ui: React.ReactElement): Promise<string> {
        const errores: string[] = [];
        const original = console.error; console.error = () => {};
        const alError = (e: ErrorEvent) => { errores.push(String(e.error?.message ?? e.message)); e.preventDefault(); };
        window.addEventListener('error', alError);
        let salida = '';
        try {
            const m = await montar(ui);
            salida = m.texto() === '' ? `PANTALLA EN BLANCO${errores[0] ? ` (${errores[0]})` : ''}` : (BASURA.test(m.texto()) ? `basura en el texto: ${/(\S*(?:NaN|undefined|null)\S*)/.exec(m.texto())?.[1]}` : 'bien');
            await m.desmontar();
        } catch (e) {
            salida = `TIRA: ${String((e as Error).message).slice(0, 90)}`;
        } finally { console.error = original; window.removeEventListener('error', alError); }
        return `${nombre}: ${salida}`;
    }

    it('qué pasa en cada pantalla', async () => {
        const sin = (campo: string, base = dtoFaseB()) => { const d = { ...base }; delete (d as any)[campo]; return d; };
        const lineas = [
            await intentar('campanita sin `procesadas`', <ImportEnCursoItem carga={sin('procesadas')} />),
            await intentar('campanita con `ok: null`', <ImportEnCursoItem carga={{ ...dtoFaseB(), ok: null as unknown as number }} />),
            await intentar('campanita sin `err` ni `totalEsperado` (tienen guarda)', <ImportEnCursoItem carga={sin('totalEsperado', sin('err'))} />),
            await intentar('resumen sin `procesadas`', <ImportSummary resultados={[sin('procesadas', terminal('OK'))]} onNewImport={() => {}} />),
            await intentar('resumen sin `advertencias`', <ImportSummary resultados={[sin('advertencias', terminal('OK'))]} onNewImport={() => {}} />),
            await intentar('resumen FALLIDA sin `err`', <ImportSummary resultados={[sin('err', terminal('FALLIDA', { ok: 5, error: 'x' }))]} onNewImport={() => {}} />),
        ];
        expect(lineas.length).toBe(6);
        // Tercera pasada: ninguna pantalla tira ni queda en blanco con un contador ausente.
        expect(lineas.filter((l) => /TIRA|BLANCO/.test(l))).toEqual([]);
        expect(lineas.filter((l) => /basura/.test(l))).toEqual([]);
    });
});
