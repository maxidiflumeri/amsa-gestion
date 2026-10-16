// /gestion?deudor=ID (docs/inicio-spec.md §6.5): el id del enlace gana sobre el último caso, se persiste y se borra de la URL.
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLocation } from 'react-router-dom';
import DeudoresPage from '@fe/pages/DeudoresPage';
import { esperar, montar, pasar, type Montado } from '../lib/montar';

// Un doble de TabsPanel: imprime el caso que la página le pasa.
vi.mock('@fe/components/deudores/TabsPanel', () => ({
    default: (props: { selectedDeudorId: number | null }) => <div data-testid="caso">{String(props.selectedDeudorId)}</div>,
}));

function Ubicacion() {
    const { pathname, search } = useLocation();
    return <span data-testid="url">{pathname + search}</span>;
}
const caso = () => document.querySelector('[data-testid="caso"]')?.textContent;
const url = () => document.querySelector('[data-testid="url"]')?.textContent;

let v: Montado | null = null;
afterEach(async () => { if (v) await v.desmontar(); v = null; });

async function abrir(ruta: string) {
    v = await montar(<><DeudoresPage /><Ubicacion /></>, { ruta, patron: '/gestion' });
    await esperar(() => caso() !== undefined, { que: 'la página de Gestión' });
    await pasar(100);
}

describe('/gestion?deudor=ID', () => {
    it('con last_deudor_id = 7 y ?deudor=12 abre el 12, lo persiste y deja la URL sin el parámetro', async () => {
        localStorage.setItem('last_deudor_id', '7');
        await abrir('/gestion?deudor=12');
        expect(caso()).toBe('12');
        expect(localStorage.getItem('last_deudor_id')).toBe('12');
        expect(url()).toBe('/gestion');
    });

    it('con ?deudor=abc se comporta como antes: abre el último caso (7) y no toca el último caso guardado', async () => {
        localStorage.setItem('last_deudor_id', '7');
        await abrir('/gestion?deudor=abc');
        expect(caso()).toBe('7');
        expect(localStorage.getItem('last_deudor_id')).toBe('7');
    });

    it('con ?deudor=0 y ?deudor=-3 tampoco hace caso', async () => {
        localStorage.setItem('last_deudor_id', '7');
        await abrir('/gestion?deudor=0');
        expect(caso()).toBe('7');
        await v!.desmontar();
        v = null;
        await abrir('/gestion?deudor=-3');
        expect(caso()).toBe('7');
    });

    it('sin parámetro abre el último caso, como siempre', async () => {
        localStorage.setItem('last_deudor_id', '7');
        await abrir('/gestion');
        expect(caso()).toBe('7');
        expect(url()).toBe('/gestion');
    });

    it('conserva los otros parámetros de la URL al consumir el del caso', async () => {
        await abrir('/gestion?deudor=5&tab=2');
        expect(caso()).toBe('5');
        expect(url()).toBe('/gestion?tab=2');
    });
});
