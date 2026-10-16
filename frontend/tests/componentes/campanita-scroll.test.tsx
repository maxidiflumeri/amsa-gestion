// La campanita con muchas importaciones en curso (una carga dividida en 5): la lista de notificaciones tiene que seguir
// visible y scrolleable. Antes, las tarjetas en curso ocupaban todo el alto y la lista quedaba en 0 px (16/10/2026).
// jsdom no mide alturas: se fija la estructura que lo evita (tope y scroll propio arriba, alto mínimo abajo).
import { afterEach, describe, expect, it } from 'vitest';
import { limpio } from '../lib/montar';
import { abrirCampanita, armarCampanita, corriendo, enCola, notificacion, type BancoCampanita } from '../lib/banco-campanita';

let b: BancoCampanita | null = null;
afterEach(async () => { if (b) { await b.v.desmontar(); await b.srv.bajar(); } b = null; });

const division = () => [
    corriendo(150, { grupoId: 'g1', grupoOrden: 1, grupoTotal: 5 }),
    enCola(151, 0, { grupoId: 'g1', grupoOrden: 2, grupoTotal: 5 }),
    enCola(152, 1, { grupoId: 'g1', grupoOrden: 3, grupoTotal: 5 }),
    enCola(153, 2, { grupoId: 'g1', grupoOrden: 4, grupoTotal: 5 }),
    enCola(154, 3, { grupoId: 'g1', grupoOrden: 5, grupoTotal: 5 }),
];
const notifs = () => [notificacion({ id: 1, titulo: 'Remesa A terminó' }), notificacion({ id: 2, titulo: 'Remesa B terminó' })];

describe('campanita con una carga dividida en curso', () => {
    it.each([1280, 360])('a %i px: las tarjetas en curso tienen tope y scroll propio, y la lista conserva lugar', async (ancho) => {
        b = await armarCampanita({ ancho, notificaciones: notifs(), enCurso: division() });
        await abrirCampanita();
        const enCurso = document.querySelector('[data-testid="campanita-en-curso"]') as HTMLElement | null;
        const lista = document.querySelector('[data-testid="campanita-lista"]') as HTMLElement | null;
        expect(enCurso).not.toBeNull();
        expect(lista).not.toBeNull();
        expect(enCurso!.querySelectorAll('a[href^="/historial-importaciones/"]').length).toBe(5);
        const sEnCurso = getComputedStyle(enCurso!);
        expect(sEnCurso.overflowY).toBe('auto');
        expect(sEnCurso.maxHeight).not.toBe('');
        expect(sEnCurso.maxHeight).not.toBe('none');
        expect(getComputedStyle(lista!).minHeight).toBe('160px');
        // Las notificaciones están dentro de la lista scrolleable, no debajo de las tarjetas.
        expect(limpio(lista!.textContent ?? '')).toContain('Remesa A terminó');
        expect(limpio(lista!.textContent ?? '')).toContain('Remesa B terminó');
    });
});
