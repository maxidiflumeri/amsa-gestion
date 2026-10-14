// ImportDetail montado en su ruta, con el hook real, socket.io real y HTTP falso.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ImportDetail from '@fe/pages/ImportDetail';
import { BASURA, MOTIVO_CON_SALTO, MOTIVO_INTERRUPCION, T0, TXT, dtoFaseA, dtoFaseB, iso, terminal } from '../lib/fabricas';
import { enElSpec } from '../lib/spec';
import { ServidorFalso } from '../lib/servidor-falso';
import { alertas, esperar, iniciarSesion, limpio, montar, pasar, type Montado } from '../lib/montar';

let srv: ServidorFalso; let v: Montado | null = null; let actual: any; let remesaExtra: Record<string, unknown> = {};
beforeEach(async () => {
    remesaExtra = {};
    srv = await new ServidorFalso().levantar();
    srv.en('GET', /^\/import\/remesas\/141\/progreso$/, () => ({ body: actual }));
    srv.en('GET', /^\/import\/remesas\/141$/, () => ({ body: {
        id: 141, numeroRemesa: '00141', nombre: 'Telecom septiembre', categoria: actual.tipo, estadoProceso: actual.estadoProceso,
        totalFilas: 14466, okFilas: actual.ok, errFilas: actual.err, fechaVencimiento: null, createdAt: iso(T0 - 200_000), updatedAt: iso(T0),
        empresa: { id: 10, nombre: 'Telecom' }, plantilla: { id: 7, nombre: 'Telecom deudores', categoria: 'DEUDORES' },
        usuarioCreador: { id: 3, nombre: 'Maxi', email: 'm@x' }, politica: null, tasaExitoPct: null, carga: actual, ...remesaExtra,
    } }));
    srv.en('GET', /^\/import\/errores\/141$/, () => ({ body: { data: [] } }));
    iniciarSesion();
});
afterEach(async () => { if (v) await v.desmontar(); v = null; await srv.bajar(); });

const LINEA = /Casos nuevos|Casos actualizados|Descartadas( por el filtro de la plantilla)?: |De otros cortes/;
// Las cuatro tarjetas (el primer h4 de la página es el título).
const tarjetas = () => Array.from(document.querySelectorAll('.MuiCard-root .MuiTypography-h4')).map((e) => limpio(e.textContent ?? ''));
const lineaDeAbajo = () => Array.from(document.querySelectorAll('.MuiTypography-body2')).map((e) => limpio(e.textContent ?? '')).filter((t) => LINEA.test(t));
const capciones = () => Array.from(document.querySelectorAll('.MuiTypography-caption')).map((e) => limpio(e.textContent ?? ''));

async function detalle(dto: any) {
    actual = dto;
    v = await montar(<ImportDetail />, { conSocket: true, ruta: '/historial-importaciones/141', patron: '/historial-importaciones/:id' });
    await esperar(() => srv.sockets.size === 1 && /Información general/.test(v!.texto()) && srv.cuantos('GET', /progreso/) >= 1, { que: 'el detalle dibujado' });
    await pasar(400);
    const alerta = document.querySelector('.MuiAlert-root') as HTMLElement | null;
    const r = { texto: v.texto(), linea: lineaDeAbajo(), alertas: alertas(), capciones: capciones(), tarjetas: tarjetas(), donut: Array.from(document.querySelectorAll('svg text')).map((t) => t.textContent), alertaCruda: alerta?.textContent ?? '', alertaWhiteSpace: alerta ? getComputedStyle(alerta).whiteSpace : '' };
    await v.desmontar(); v = null;
    await esperar(() => srv.sockets.size === 0, { que: 'socket cerrado' });
    srv.pedidos.length = 0;
    return r;
}

describe('la línea debajo de las tarjetas (§9.8.5)', () => {
    enElSpec('"Casos nuevos: N · Casos actualizados: M · Descartadas por el filtro de la plantilla: D · De otros cortes de la división: F (no se cargan en esta remesa)"');

    it('carga en curso, con todo: los cuatro datos, con separador de miles', async () => {
        const r = await detalle(dtoFaseB({ descartadas: 14_300, fueraDeCorte: 14_000, nuevos: 1200, actualizados: 1790, velocidad: 33.3, etaSegundos: 344 }));
        expect(r.linea).toEqual(['Casos nuevos: 1.200 · Casos actualizados: 1.790 · Descartadas por el filtro de la plantilla: 300 · De otros cortes de la división: 14.000 (no se cargan en esta remesa)']);
        expect(r.capciones).toContain('Procesando · 20% completado');
        expect(r.tarjetas).toEqual(['14.466', '2.990', '10', '100%']);
        expect(r.capciones).toContain('≈ 33,3 filas/s · faltan ~6 min para terminar las filas');
        expect(r.texto).not.toMatch(BASURA);
    });

    it('solo lo que corresponde: cada combinación', async () => {
        const visto: Record<string, string[]> = {};
        const casos: Array<[string, any]> = [
            ['en curso, sin corte ni filtro, categoría que informa casos', dtoFaseB({ nuevos: 10, actualizados: 0 })],
            ['en curso, PAGOS (no informa casos), con filtro', dtoFaseB({ tipo: 'PAGOS', descartadas: 25 })],
            ['en curso, nada que mostrar', dtoFaseB()],
            ['en cola', dtoFaseB({ fase: 'EN_COLA', startedAt: null, heartbeatAt: null, procesadas: 0, ok: 0, err: 0, progreso: 0, enColaDelante: 2 })],
            ['terminada OK con corte', terminal('OK', { procesadas: 14_466, ok: 14_466, err: 0, descartadas: 9300, fueraDeCorte: 9000, nuevos: 14_000, actualizados: 466 })],
            ['terminada, solo otros cortes', terminal('OK', { descartadas: 9000, fueraDeCorte: 9000 })],
            ['heredada sin fila de progreso (rev 0)', terminal('OK', { rev: 0, descartadas: 0, startedAt: null, heartbeatAt: null, finishedAt: null, duracionMs: null, encoladaAt: null })],
            ['Fase A terminada (sin campos nuevos), descartadas 450', terminal('OK', { descartadas: 450 }, dtoFaseA)],
            ['con corte y sin filas de otros cortes (fueraDeCorte 0)', terminal('OK', { descartadas: 50, fueraDeCorte: 0 })],
            ['sin corte (fueraDeCorte null), filtro de la plantilla', terminal('OK', { descartadas: 1250, fueraDeCorte: null })],
            ['Fase A en curso', dtoFaseA({ descartadas: 450 })],
            ['borrador', dtoFaseB({ fase: 'BORRADOR', enCurso: false, estadoProceso: 'VALIDANDO', rev: 1, descartadas: 700, nuevos: 3 })],
        ];
        for (const [nombre, dto] of casos) {
            const r = await detalle(dto);
            visto[nombre] = r.linea;
            expect(r.texto, nombre).not.toMatch(BASURA);
        }
        expect(visto['en curso, sin corte ni filtro, categoría que informa casos']).toEqual(['Casos nuevos: 10 · Casos actualizados: 0']);
        expect(visto['en curso, PAGOS (no informa casos), con filtro']).toEqual(['Descartadas: 25']);
        expect(visto['con corte y sin filas de otros cortes (fueraDeCorte 0)']).toEqual(['Descartadas por el filtro de la plantilla: 50']);
        expect(visto['sin corte (fueraDeCorte null), filtro de la plantilla']).toEqual(['Descartadas: 1.250']);
        expect(visto['en curso, nada que mostrar']).toEqual([]);
        expect(visto['en cola']).toEqual([]);
        expect(visto['terminada OK con corte']).toEqual(['Casos nuevos: 14.000 · Casos actualizados: 466 · Descartadas por el filtro de la plantilla: 300 · De otros cortes de la división: 9.000 (no se cargan en esta remesa)']);
        expect(visto['terminada, solo otros cortes']).toEqual(['De otros cortes de la división: 9.000 (no se cargan en esta remesa)']);
        expect(visto['heredada sin fila de progreso (rev 0)']).toEqual([]);
        expect(visto['Fase A terminada (sin campos nuevos), descartadas 450']).toEqual(['Descartadas: 450']);
        expect(visto['Fase A en curso']).toEqual(['Descartadas: 450']);
        expect(visto['borrador']).toEqual([]);
    });
});

describe('bloque de la carga en curso', () => {
    it('posición en la cola, leyendo y subfase; la línea de ritmo solo en curso', async () => {
        const cola = await detalle(dtoFaseB({ fase: 'EN_COLA', startedAt: null, heartbeatAt: null, procesadas: 0, ok: 0, err: 0, progreso: 0, enColaDelante: 1 }));
        expect(cola.capciones).toEqual(expect.arrayContaining(['En cola', 'Hay 1 importación antes que esta.']));
        const leyendo = await detalle(dtoFaseB({ fase: 'LEYENDO', procesadas: 0, ok: 0, err: 0, progreso: 0 }));
        expect(leyendo.capciones).toEqual(expect.arrayContaining(['Leyendo el archivo', 'Todavía no se procesó ninguna fila.']));
        const post = await detalle(dtoFaseB({ fase: 'POST_PROCESO', subfase: 'Consolidando la remesa de origen: 1.500 de 8.875', progreso: 99 }));
        expect(post.capciones).toEqual(expect.arrayContaining(['Post-proceso', 'Consolidando la remesa de origen: 1.500 de 8.875']));
        expect(post.texto).not.toMatch(/filas\/s|99%/);
        // Terminada: aunque el DTO trajera velocidad, no hay bloque ni ritmo.
        const fin = await detalle(terminal('OK', { velocidad: 33.3, etaSegundos: 10 }));
        expect(fin.texto).not.toMatch(/filas\/s|faltan/);
    });

    it('una carga colgada hace 6 min abre avisando «sin señal» (también en post-proceso)', async () => {
        const r = await detalle(dtoFaseB({ fase: 'POST_PROCESO', subfase: 'Desasignando ausentes: 500 de 342.792', heartbeatAt: iso(T0 - 6 * 60_000) }));
        expect(r.alertas.map((a) => a.texto)).toEqual([TXT.sinSenal(6)]);
    });
});

describe('resultado', () => {
    it('FALLIDA por interrupción con un motivo de 600 caracteres: se lee entero', async () => {
        const motivo = (MOTIVO_INTERRUPCION + ' ' + 'Detalle adicional del corte. '.repeat(12)).slice(0, 600);
        const r = await detalle(terminal('FALLIDA', { procesadas: 1800, ok: 1790, err: 10, error: motivo, nuevos: 1700, actualizados: 90, descartadas: 50 }));
        expect(r.alertas).toHaveLength(1);
        expect(r.alertas[0].severidad).toBe('error');
        expect(r.alertas[0].texto.startsWith('La importación falló' + MOTIVO_INTERRUPCION)).toBe(true);
        expect(r.alertas[0].texto.endsWith(' ' + TXT.antesDelCorte('1.790', '10'))).toBe(true);
        expect(r.linea).toEqual(['Casos nuevos: 1.700 · Casos actualizados: 90 · Descartadas: 50']);
    });

    it('motivo con \\n\\n: título + tres párrafos, y la alerta respeta los saltos (pre-line)', async () => {
        const r = await detalle(terminal('FALLIDA', { procesadas: 14_466, ok: 14_400, err: 66, error: MOTIVO_CON_SALTO }));
        const sinTitulo = r.alertaCruda.replace(/^La importación falló/, '');
        expect(sinTitulo.split('\n\n')).toEqual([
            'La importación se interrumpió: el servidor se reinició o dejó de responder mientras la procesaba.',
            'Lo procesado hasta el corte quedó cargado en esta remesa. Eliminá esta importación desde el Historial (se puede mientras sus casos no tengan gestión) y volvé a cargar el archivo.',
            TXT.antesDelCorte('14.400', '66'),
        ]);
        expect(r.alertaWhiteSpace).toBe('pre-line');
        expect(r.tarjetas.slice(0, 3)).toEqual(['14.466', '14.400', '66']);
    });

    it('heredada en PROCESANDO (rev 0): el detalle no promete el cierre automático', async () => {
        const heredada = dtoFaseB({ rev: 0, startedAt: null, heartbeatAt: null, encoladaAt: null, procesadas: 0, ok: 0, err: 0, progreso: 0, totalEsperado: 912 });
        actual = heredada;
        v = await montar(<ImportDetail />, { conSocket: true, ruta: '/historial-importaciones/141', patron: '/historial-importaciones/:id' });
        await esperar(() => /Información general/.test(v!.texto()), { que: 'el detalle' });
        await pasar(500);
        expect(alertas()).toEqual([]); // recién abierta: nada (la cuenta arranca al abrir)
        expect(v.texto()).not.toMatch(BASURA);
    });

    it('SIN_FILAS de una remesa de una división: ya no dice que el filtro descartó media cartera (fila B de §8.13)', async () => {
        const r = await detalle(terminal('SIN_FILAS', { procesadas: 0, ok: 0, err: 0, descartadas: 9300, fueraDeCorte: 9000 }));
        expect(r.alertas.map((a) => a.texto)).toEqual(['El archivo no tenía filas para procesarEl filtro de la plantilla descartó las 300 filas. 9.000 filas son de otros cortes de la división.']);
        expect(r.linea).toEqual(['Descartadas por el filtro de la plantilla: 300 · De otros cortes de la división: 9.000 (no se cargan en esta remesa)']);
    });
});
