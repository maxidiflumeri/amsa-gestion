// Gestión como app instalada: el aviso "Instalá Gestión" del Inicio (solo en el celular) y el de versión nueva.
import React, { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { boton, clic, esperar, montar, pasar, type Montado } from '../lib/montar';
import { fijarAncho } from '../lib/ancho';
import { registro } from '../lib/pwa-register';
import { PwaProvider } from '@fe/pwa/PwaContext';
import AvisoInstalar from '@fe/pwa/AvisoInstalar';
import AvisoVersionNueva from '@fe/pwa/AvisoVersionNueva';

let m: Montado | null = null;
const uaOriginal = navigator.userAgent;

afterEach(async () => {
    await m?.desmontar();
    m = null;
    Object.defineProperty(navigator, 'userAgent', { value: uaOriginal, configurable: true });
    Object.defineProperty(navigator, 'standalone', { value: undefined, configurable: true });
    registro.opciones = null;
    registro.actualizaciones = [];
});

/** El evento que dispara Chrome cuando la app se puede instalar. */
function eventoInstalar(outcome: 'accepted' | 'dismissed' = 'accepted') {
    const e = new Event('beforeinstallprompt', { cancelable: true });
    let prompts = 0;
    Object.assign(e, { prompt: async () => { prompts += 1; }, userChoice: Promise.resolve({ outcome }) });
    return { e, prompts: () => prompts };
}

async function disparar(e: Event) {
    await act(async () => { window.dispatchEvent(e); });
}

const aviso = () => document.querySelector('[data-testid="aviso-instalar"]');
const montarAviso = async () => { m = await montar(<PwaProvider><AvisoInstalar /></PwaProvider>); };

describe('Instalá Gestión (Inicio, celular)', () => {
    it('en el celular, cuando Chrome ofrece instalar, aparece el aviso; Instalar abre la instalación', async () => {
        fijarAncho(360);
        await montarAviso();
        expect(aviso()).toBeNull();
        const { e, prompts } = eventoInstalar();
        await disparar(e);
        expect(e.defaultPrevented).toBe(true);
        await esperar(() => aviso(), { que: 'el aviso de instalar' });
        expect(m!.texto()).toContain('Instalá Gestión en este celular');
        await clic(boton('Instalar'), 'Instalar');
        await esperar(() => !aviso(), { que: 'que el aviso se vaya después de instalar' });
        expect(prompts()).toBe(1);
    });

    it('"Ahora no" lo esconde y no vuelve por 14 días, aunque Chrome lo vuelva a ofrecer', async () => {
        fijarAncho(360);
        await montarAviso();
        await disparar(eventoInstalar().e);
        await esperar(() => aviso(), { que: 'el aviso' });
        await clic(boton('Ahora no'), 'Ahora no');
        await esperar(() => !aviso(), { que: 'que se vaya' });
        const hasta = Number(localStorage.getItem('pwaInstalarDescartadoHasta'));
        expect(hasta - Date.now()).toBeGreaterThan(13 * 24 * 60 * 60 * 1000);
        await m!.desmontar();
        await montarAviso();
        await disparar(eventoInstalar().e);
        await pasar(50);
        expect(aviso()).toBeNull();
    });

    it('en la computadora no aparece', async () => {
        await montarAviso();
        await disparar(eventoInstalar().e);
        await pasar(50);
        expect(aviso()).toBeNull();
    });

    it('en el iPhone explica cómo agregarla (no hay botón Instalar); abierta como app, nada', async () => {
        fijarAncho(390);
        Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', configurable: true });
        await montarAviso();
        await esperar(() => aviso(), { que: 'las instrucciones de iOS' });
        expect(m!.texto()).toContain('Compartir');
        expect(boton('Instalar')).toBeNull();
        await m!.desmontar();
        Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
        await montarAviso();
        await pasar(50);
        expect(aviso()).toBeNull();
    });
});

describe('Versión nueva', () => {
    it('cuando el service worker avisa, aparece el aviso; Actualizar activa la versión nueva', async () => {
        m = await montar(<PwaProvider><AvisoVersionNueva /></PwaProvider>);
        expect(registro.opciones?.onNeedRefresh).toBeTypeOf('function');
        expect(m.texto()).not.toContain('Hay una versión nueva');
        await act(async () => { registro.opciones!.onNeedRefresh!(); });
        await esperar(() => m!.texto().includes('Hay una versión nueva de Gestión'), { que: 'el aviso de versión nueva' });
        await clic(boton('Actualizar'), 'Actualizar');
        expect(registro.actualizaciones).toEqual([true]);
    });
});
