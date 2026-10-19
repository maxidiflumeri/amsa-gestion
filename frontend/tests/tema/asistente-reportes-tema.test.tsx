// Asistente de IA, Fase B: la tarjeta de la propuesta en tema claro y oscuro, y a 360 px (docs/asistente-reportes-spec.md §16.2 y §20.2).
// jsdom no calcula layout: el desborde horizontal real queda para la prueba manual en un navegador. Acá se comprueba lo que sí se puede:
// que los colores salgan de la paleta de cada tema y que la estructura que evita el desborde (min-width 0, saltos de línea, scroll propio) esté.
import { afterEach, describe, expect, it } from 'vitest';
import { boton, clic, elegirArchivos, esperar, limpio } from '../lib/montar';
import {
    PERMISOS_REPORTES_IA, abrirPanel, adjuntoIA, armarIA, bajarIA, botonDetener, botonEnviar, ev, mapeoIA, panel, preguntarAlAsistente,
    respuestaSse, tarjeta, type BancoIA,
} from '../lib/banco-ia';

let b: BancoIA | null = null;
afterEach(async () => { await bajarIA(b); b = null; });

const LARGA = 'x'.repeat(200);
const tarjetaLarga = () => tarjeta({
    nombre: `Cartera ${LARGA}`,
    mapeo: [
        mapeoIA({ columnaEjemplo: `Columna ${LARGA}`, label: 'DNI', saleDe: `Documento ${LARGA}`, formato: LARGA }),
        mapeoIA({ columnaEjemplo: 'Teléfono', label: 'Teléfono', estado: 'aproximada', nota: `No es el principal ${LARGA}`, saleDe: 'Teléfono / email / dirección · 2.º teléfono' }),
        mapeoIA({ columnaEjemplo: 'Obs', label: 'Obs', estado: 'sin_campo', saleDe: 'Columna vacía' }),
        mapeoIA({ columnaEjemplo: null, label: 'Días de mora', estado: 'agregada', saleDe: 'Vencimiento', formato: 'Días desde el vencimiento' }),
    ],
    filtros: [`Vencimiento: ${LARGA}`], avisos: [`Aviso ${LARGA}`], sugerencias: [`Agregá ${LARGA}`],
});

async function conTarjeta(o: Parameters<typeof armarIA>[0]) {
    b = await armarIA({ permisos: PERMISOS_REPORTES_IA, ...o });
    b.preguntar = () => respuestaSse([ev.inicio(), ev.paso('prueba', `Probé la plantilla: 8.412 casos, sin errores ${LARGA}`), ['propuesta', tarjetaLarga()], ev.fin('', { pasos: [{ tipo: 'prueba', estado: 'ok', texto: `Probé la plantilla: 8.412 casos, sin errores ${LARGA}` }], propuestas: [tarjetaLarga()] })], 10);
    await abrirPanel();
    await clic(boton('Armar un reporte'), 'Armar un reporte');
    await preguntarAlAsistente('Igual a este');
    await esperar(() => botonEnviar() && !botonDetener() && document.querySelector('[data-testid="tarjeta-propuesta"]'), { que: 'la tarjeta' });
    await esperar(() => document.querySelector('[data-testid="vista-previa-tabla"]'), { que: 'la vista previa' });
}

describe('Tema claro y oscuro', () => {
    for (const [modo, secundario] of [['light', 'rgb(124, 58, 237)'], ['dark', 'rgb(167, 139, 250)']] as const) {
        it(`${modo}: el recuadro de la acción usa el color secundario del tema, el botón es «containedSecondary» y los iconos de estado salen de la paleta`, async () => {
            await conTarjeta({ modo, ancho: 1600 });
            const accion = document.querySelector<HTMLElement>('[data-testid="tarjeta-propuesta-accion"]')!;
            expect(getComputedStyle(accion).borderColor).toBe(secundario);
            const abrir = Array.from(accion.querySelectorAll('button')).find((x) => /Abrir en el editor/.test(x.textContent ?? ''))!;
            expect(abrir.className).toContain('MuiButton-containedSecondary');
            // Cada estado del mapeo tiene su color de paleta: no son todos el mismo ni quedan sin color.
            const color = (estado: string) => getComputedStyle(document.querySelector(`[data-testid="tarjeta-propuesta"] tr[data-estado="${estado}"] svg`)!).color;
            const colores = ['exacta', 'aproximada', 'sin_campo', 'agregada'].map(color);
            expect(new Set(colores).size).toBe(4);
            colores.forEach((c) => expect(c).toMatch(/^rgb/));
            // Los pasos también.
            expect(document.querySelector('[data-testid="pasos-turno"] svg')!.getAttribute('class')).toContain('MuiSvgIcon-colorSuccess');
        });
    }

    it('los dos temas dan colores distintos para el mismo estado (se leen del tema activo, no están escritos a mano)', async () => {
        await conTarjeta({ modo: 'light', ancho: 1600 });
        const claro = getComputedStyle(document.querySelector('[data-testid="tarjeta-propuesta"] tr[data-estado="exacta"] svg')!).color;
        await bajarIA(b);
        b = null;
        await conTarjeta({ modo: 'dark', ancho: 1600 });
        const oscuro = getComputedStyle(document.querySelector('[data-testid="tarjeta-propuesta"] tr[data-estado="exacta"] svg')!).color;
        expect(claro).not.toBe(oscuro);
    });
});

describe('360 px: lo que evita el desborde horizontal', () => {
    it('la tabla de mapeo pasa a lista; la vista previa tiene su scroll; los textos largos se parten y nada fija un ancho', async () => {
        await conTarjeta({ ancho: 360 });
        const paper = panel()!.closest<HTMLElement>('.MuiDrawer-paper')!;
        expect(getComputedStyle(paper).width).toBe('100%');
        expect(getComputedStyle(paper).maxWidth).toBe('100%');

        const burbuja = document.querySelector<HTMLElement>('[data-testid="burbuja-asistente"]')!;
        const chat = burbuja.parentElement!;
        expect(getComputedStyle(chat).overflowX).toBe('hidden');
        expect(parseFloat(getComputedStyle(burbuja).minWidth)).toBe(0);

        // En un celular el mapeo es una lista («DNI → Documento»), no una tabla de dos columnas.
        expect(document.querySelector('[data-testid="mapeo-tabla"]')).toBeNull();
        const lista = document.querySelector('[data-testid="mapeo-lista"]')!;
        expect(lista.querySelectorAll('li')).toHaveLength(4);
        expect(limpio(lista.querySelector('li')!.textContent ?? '')).toContain('→');
        // La nota de la aproximada no queda escondida en un tooltip que en el celular no existe.
        expect(limpio(lista.textContent ?? '')).toContain('No es el principal');

        // La vista previa scrollea sola.
        expect(getComputedStyle(document.querySelector<HTMLElement>('[data-testid="vista-previa-tabla"]')!).overflowX).toBe('auto');

        // Los textos largos se parten donde hace falta (jsdom no mide, pero sí lee el estilo).
        const partidos = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="tarjeta-propuesta"] p, [data-testid="tarjeta-propuesta"] h6, [data-testid="pasos-turno"] p'))
            .filter((e) => e.textContent!.includes(LARGA));
        expect(partidos.length).toBeGreaterThanOrEqual(4);
        for (const e of partidos) expect(getComputedStyle(e).overflowWrap, limpio(e.textContent ?? '').slice(0, 40)).toBe('anywhere');

        // La tarjeta y sus filas no imponen ancho.
        const tarjetaEl = document.querySelector<HTMLElement>('[data-testid="tarjeta-propuesta"]')!;
        expect(parseFloat(getComputedStyle(tarjetaEl).minWidth)).toBe(0);
        expect(getComputedStyle(tarjetaEl).width).not.toMatch(/px/);
    });

    it('en escritorio, en cambio, es la tabla de dos columnas con su encabezado', async () => {
        await conTarjeta({ ancho: 1600 });
        const tabla = document.querySelector('[data-testid="mapeo-tabla"]')!;
        const cabecera = limpio(tabla.querySelector('thead')!.textContent ?? '');
        expect(cabecera).toContain('Tu columna');
        expect(cabecera).toContain('Sale de');
        expect(document.querySelector('[data-testid="mapeo-lista"]')).toBeNull();
    });

    it('un ejemplo adjunto, con nombre largo y avisos, se parte y no ensancha el compositor', async () => {
        b = await armarIA({ permisos: PERMISOS_REPORTES_IA, ancho: 360 });
        b.subirAdjunto = () => ({ status: 201, body: adjuntoIA({ nombre: `${LARGA}.xlsx`, avisos: [`Aviso ${LARGA}`] }) });
        await abrirPanel();
        await clic(boton('Armar un reporte'), 'Armar un reporte');
        await esperar(() => document.querySelector('[data-testid="entrada-archivos"]'), { que: 'el selector' });
        await elegirArchivos(document.querySelector('[data-testid="entrada-archivos"]'), [new File(['x'], 'a.xlsx')]);
        const chip = await esperar(() => document.querySelector<HTMLElement>('[data-testid="adjunto-chip"][data-estado="listo"]'), { que: 'el chip' });
        const textos = Array.from(chip.querySelectorAll<HTMLElement>('span.MuiTypography-caption')).filter((e) => e.textContent!.includes(LARGA));
        expect(textos.length).toBeGreaterThanOrEqual(2);
        for (const e of textos) expect(getComputedStyle(e).overflowWrap).toBe('anywhere');
        expect(parseFloat(getComputedStyle(chip).minWidth)).toBe(0);
    });
});
