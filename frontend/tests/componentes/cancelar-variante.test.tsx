// C2a: BotonCancelarCarga en su variante de ícono y el diálogo que lee la división en vivo (FC-2 a FC-5).
// Lo portado de C1 está en cancelar.test.tsx y cancelar-division.test.tsx (FC-1: verde antes y después del cambio).
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { BotonCancelarCarga } from '@fe/components/import/ImportProgress';
import type { EstadoCargaDto } from '@fe/types/importProgreso';
import { alertas, boton, clic, dialogo, esperar, iniciarSesion, limpio, montar, pasar, type Montado } from '../lib/montar';
import { armarDetalle, type BancoDetalle } from '../lib/banco-detalle';
import { dtoC1, enColaC1, iso, terminalC1 } from '../lib/fabricas';
import { ServidorFalso } from '../lib/servidor-falso';

const g = { grupoId: 'g-7', grupoTotal: 4 };
const T = (id: number, orden: number, over: Record<string, unknown> = {}) => terminalC1('OK', { remesaId: id, numeroRemesa: String(2940 + id), ...g, grupoOrden: orden, ...over });
const Q = (id: number, orden: number, over: Record<string, unknown> = {}) => enColaC1({ remesaId: id, numeroRemesa: String(2940 + id), ...g, grupoOrden: orden, enColaDelante: orden - 2, ...over });
const P = (id: number, orden: number, over: Record<string, unknown> = {}) => dtoC1({ remesaId: id, numeroRemesa: String(2940 + id), ...g, grupoOrden: orden, ...over });
const dlg = () => dialogo(/^Cancelar (importación|todo lo que falta)$/);
const cuerpo = () => limpio(dlg()?.querySelector('.MuiDialogContent-root')?.textContent ?? '');
const GRUPO = /^\/import\/grupos\/g-7$/;

describe('FC-3 — la lista del diálogo se mantiene al día con el diálogo abierto', () => {
    let b: BancoDetalle | null = null;
    afterEach(async () => { if (b) { await b.v.desmontar(); await b.srv.bajar(); } b = null; });

    it('llega «iniciada» de una hermana y el texto pasa de «las 2 que no empezaron» a nombrarla como la que está en curso, antes de cualquier clic', async () => {
        b = await armarDetalle(Q(143, 4), { otras: [T(140, 1), P(141, 2), Q(142, 3)] });
        await clic(boton('Cancelar importación', b.v.contenedor), 'Cancelar importación');
        await esperar(() => !!dlg() && !/Buscando/.test(cuerpo()) && alertas(dlg()!).length > 0, { que: 'el diálogo con la división leída' });
        expect(alertas(dlg()!)[0].texto).toBe('Esta remesa es parte de una carga dividida. «Cancelar todo lo que falta» cancela la remesa en curso (3081) y las 2 que no empezaron (3082 y 3083).');
        b.pub('import:finalizada', T(141, 2, { rev: 30 }));
        b.pub('import:iniciada', P(142, 3, { rev: 5, procesadas: 100, ok: 100, err: 0, progreso: 1, startedAt: iso(Date.now()), heartbeatAt: iso(Date.now()) }));
        await esperar(() => /la remesa en curso \(3082\)/.test(alertas(dlg()!)[0]?.texto ?? ''), { que: 'el cartel actualizado' });
        expect(alertas(dlg()!)[0].texto).toBe('Esta remesa es parte de una carga dividida. «Cancelar todo lo que falta» cancela la remesa en curso (3082) y la que no empezó (3083).');
        expect(b.srv.cuantos('POST', /cancelar/)).toBe(0);
    });
});

describe('FC-2, FC-4 y FC-5 — el botón suelto contra el servidor falso', () => {
    let srv: ServidorFalso | null = null;
    let v: Montado | null = null;
    afterEach(async () => { if (v) await v.desmontar(); if (srv) await srv.bajar(); v = null; srv = null; });

    async function armar(botones: (carga: EstadoCargaDto) => React.ReactNode, carga: EstadoCargaDto, grupo: (() => { status?: number; body?: unknown }) | null = null, estricto = true) {
        srv = new ServidorFalso();
        await srv.levantar();
        iniciarSesion(['importacion.ver_historial', 'importacion.ejecutar'], 3);
        if (grupo) srv.en('GET', GRUPO, grupo);
        v = await montar(<>{botones(carga)}</>, { conSocket: true, estricto });
        await esperar(() => srv!.sockets.size === 1, { que: 'el socket' });
    }

    it('FC-2 — variante de ícono: un IconButton con tooltip; si no se puede cancelar, deshabilitado y con el motivo en el tooltip', async () => {
        await armar((c) => <BotonCancelarCarga carga={c} variante="icono" />, dtoC1());
        const icono = v!.contenedor.querySelector('button[aria-label="Cancelar importación"]') as HTMLButtonElement;
        expect(icono).not.toBeNull();
        expect(icono.disabled).toBe(false);
        expect(icono.textContent).toBe('');
        expect(v!.contenedor.querySelectorAll('.MuiTypography-caption')).toHaveLength(0);
        await v!.desmontar();
        v = await montar(<BotonCancelarCarga carga={dtoC1({ fase: 'POST_PROCESO' })} variante="icono" />, { conSocket: true });
        const motivo = 'La importación ya procesó todas las filas y está cerrando: en este paso no se puede cancelar.';
        const bloqueado = v.contenedor.querySelector('button[aria-label="Cancelar importación"]') as HTMLButtonElement;
        expect(bloqueado.disabled).toBe(true);
        expect(v.contenedor.querySelector(`[aria-label="${motivo}"]`)).not.toBeNull();
        expect(boton(/Cancelar/, v.contenedor)).toBeNull();
    });

    it('FC-2 — la variante de botón (default) sigue escribiendo el motivo debajo', async () => {
        await armar((c) => <BotonCancelarCarga carga={c} />, dtoC1({ fase: 'POST_PROCESO' }));
        expect(limpio(v!.contenedor.textContent ?? '')).toContain('La importación ya procesó todas las filas y está cerrando');
        expect(boton('Cancelar importación', v!.contenedor)!.disabled).toBe(true);
    });

    it('FC-4 — la lectura de la división falla y la propiedad `grupo` es []: avisa que no se pudieron leer las demás y solo ofrece cancelar esta', async () => {
        await armar((c) => <BotonCancelarCarga carga={c} grupo={[]} variante="icono" />, P(141, 2), () => ({ status: 500, body: { message: 'x' } }));
        await clic(v!.contenedor.querySelector('button[aria-label="Cancelar importación"]'), 'el ícono');
        await esperar(() => !!dlg() && alertas(dlg()!).some((a) => /no se pudieron leer las demás/.test(a.texto)), { que: 'el aviso' });
        expect(alertas(dlg()!)[0].texto).toBe('Es una carga dividida en 4 remesas y no se pudieron leer las demás: esto cancela solo esta remesa; las otras siguen.');
        const botones = Array.from(dlg()!.querySelectorAll('button')).map((x) => limpio(x.textContent ?? ''));
        expect(botones).toEqual(['Volver', 'Cancelar importación']);
    });

    it('FC-4 — con la propiedad `grupo` leída por quien lo usa, el aviso no sale aunque la lectura en vivo falle', async () => {
        const hermana = Q(142, 3);
        await armar((c) => <BotonCancelarCarga carga={c} grupo={[c, hermana]} variante="icono" />, P(141, 2), () => ({ status: 500, body: { message: 'x' } }));
        await clic(v!.contenedor.querySelector('button[aria-label="Cancelar importación"]'), 'el ícono');
        await esperar(() => !!dlg() && /Cancelar todo lo que falta/.test(dlg()!.textContent ?? ''), { que: 'las opciones' });
        expect(alertas(dlg()!).some((a) => /no se pudieron leer/.test(a.texto))).toBe(false);
    });

    it('FC-5 — veinticinco botones montados y ningún diálogo abierto: ningún pedido al grupo; al abrir uno, un pedido', async () => {
        await armar((c) => <>{Array.from({ length: 25 }, (_, i) => <BotonCancelarCarga key={i} carga={{ ...c, remesaId: 200 + i }} variante="icono" />)}</>, P(141, 2), () => ({
            body: { grupoId: 'g-7', total: 4, remesas: [P(141, 2), Q(142, 3)] },
        }), false); // sin modo estricto: el doble efecto de desarrollo duplicaría el pedido y taparía lo que se mide
        await pasar(500);
        expect(v!.contenedor.querySelectorAll('button[aria-label="Cancelar importación"]')).toHaveLength(25);
        expect(srv!.cuantos('GET', GRUPO)).toBe(0);
        await clic(v!.contenedor.querySelectorAll('button[aria-label="Cancelar importación"]')[3], 'el ícono');
        await esperar(() => !!dlg(), { que: 'el diálogo' });
        await pasar(300);
        expect(srv!.cuantos('GET', GRUPO)).toBe(1);
    });
});
