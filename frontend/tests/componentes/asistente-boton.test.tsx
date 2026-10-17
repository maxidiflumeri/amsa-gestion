// Asistente de IA, Fase A: el botón de la barra (docs/asistente-spec.md §12.1 y §16.2).
import { afterEach, describe, expect, it } from 'vitest';
import { clic, esperar, limpio, pasar } from '../lib/montar';
import { armarIA, abrirPanel, bajarIA, botonAsistente, panel, panelAbierto, PERMISOS_IA, type BancoIA } from '../lib/banco-ia';

let b: BancoIA | null = null;
afterEach(async () => { await bajarIA(b); b = null; });

describe('El botón «Asistente» de la barra', () => {
    it('sin asistente.usar no hay botón, ni panel, ni se le pide nada al servidor', async () => {
        b = await armarIA({ permisos: PERMISOS_IA.filter((p) => p !== 'asistente.usar') });
        expect(botonAsistente()).toBeNull();
        expect(panel()).toBeNull();
        expect(b.srv.cuantos('GET', /^\/asistente\//)).toBe(0);
    });

    it('con el permiso aparece, con su texto en un escritorio, y al hacer clic abre el panel y le pide el estado al servidor', async () => {
        b = await armarIA();
        const btn = botonAsistente();
        expect(btn).not.toBeNull();
        expect(limpio(btn!.textContent ?? '')).toBe('Asistente');
        expect(panelAbierto()).toBe(false);
        await abrirPanel();
        expect(panelAbierto()).toBe(true);
        expect(b.srv.cuantos('GET', /^\/asistente\/estado$/)).toBeGreaterThanOrEqual(1);
        expect(limpio(panel()!.textContent ?? '')).toContain('Estás en: Gestión');
    });

    it('en un celular es un botón de solo ícono, con el nombre accesible «Asistente»', async () => {
        b = await armarIA({ ancho: 360 });
        const btn = botonAsistente();
        expect(btn).not.toBeNull();
        expect(btn!.getAttribute('aria-label')).toBe('Asistente');
        expect(limpio(btn!.textContent ?? '')).toBe('');
        await abrirPanel();
        expect(panelAbierto()).toBe(true);
    });

    it('hacer clic de nuevo lo cierra, y Esc también', async () => {
        b = await armarIA();
        await abrirPanel();
        await clic(botonAsistente(), 'el botón');
        await esperar(() => !panelAbierto(), { que: 'el panel cerrado' });
        await abrirPanel();
        panel()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        await esperar(() => !panelAbierto(), { que: 'el panel cerrado con Esc' });
        await pasar(50);
    });
});
