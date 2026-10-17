// Asistente de IA, Fase A: tema claro y oscuro, y 360 px (docs/asistente-spec.md §12.2, §16.2 y §20.15).
// jsdom no calcula layout: el desborde horizontal real queda para la prueba manual en un navegador. Acá se comprueba lo que sí se puede:
// que los colores salgan de la paleta de cada tema y que la estructura que evita el desborde (min-width 0, saltos de línea, scroll propio) esté.
import { afterEach, describe, expect, it } from 'vitest';
import { esperar, limpio } from '../lib/montar';
import {
    PERMISOS_ADMIN_IA, abrirPanel, accionIrA, armarIA, bajarIA, burbujas, ev, fuente, panel, preguntarAlAsistente, respuestaSse, type BancoIA,
} from '../lib/banco-ia';

let b: BancoIA | null = null;
afterEach(async () => { await bajarIA(b); b = null; });

const LARGA = 'x'.repeat(200);
const respuesta = () => {
    const texto = `Mirá esto ${LARGA}\n\n\`\`\`\n${LARGA}\n\`\`\`\n\n| a | b |\n|---|---|\n| ${LARGA} | 2 |\n`;
    return respuestaSse([ev.inicio(), ev.texto(texto), ev.accion(), ev.fin(texto, { acciones: [accionIrA()], fuentes: [fuente()] })], 10);
};
async function conversar() {
    b!.preguntar = respuesta;
    await abrirPanel();
    await preguntarAlAsistente(`Pregunta larga ${LARGA}`);
    await esperar(() => document.querySelector('[data-testid="tarjeta-ir-a"]'), { que: 'la respuesta con tarjeta' });
}

describe('Tema claro y oscuro', () => {
    for (const [modo, secundario, primario] of [['light', 'rgb(124, 58, 237)', 'rgb(37, 99, 235)'], ['dark', 'rgb(167, 139, 250)', 'rgb(96, 165, 250)']] as const) {
        it(`${modo}: la tarjeta y el botón del panel toman el color secundario del tema, sin colores propios`, async () => {
            b = await armarIA({ modo });
            await conversar();
            const tarjeta = document.querySelector<HTMLElement>('[data-testid="tarjeta-ir-a"]')!;
            expect(getComputedStyle(tarjeta).borderColor).toBe(secundario);
            const llevarme = Array.from(tarjeta.querySelectorAll('button')).find((x) => /Sí, llevarme/.test(x.textContent ?? ''))!;
            expect(llevarme.className).toContain('MuiButton-containedSecondary');
            expect(limpio(panel()!.textContent ?? '')).toContain('Asistente');
            expect(burbujas().length).toBe(1);
            expect(primario).not.toBe(secundario);
        });
    }

    it('el panel y la pantalla de consumo se dibujan en los dos temas sin romper', async () => {
        for (const modo of ['dark', 'light'] as const) {
            b = await armarIA({ modo, permisos: PERMISOS_ADMIN_IA, ruta: '/asistente/consumo' });
            await esperar(() => /Gasto del mes/.test(document.body.textContent ?? ''), { que: `consumo en ${modo}` });
            const barra = document.querySelector('[role="progressbar"][aria-label="Gasto del mes sobre el tope"]')!;
            expect(getComputedStyle(barra).backgroundColor).not.toBe('');
            await bajarIA(b);
            b = null;
        }
    });
});

describe('360 px: lo que evita el desborde horizontal', () => {
    it('el panel es de pantalla completa; el chat no scrollea de costado y las burbujas, el código y las tablas se contienen solos', async () => {
        b = await armarIA({ ancho: 360 });
        await conversar();
        const paper = panel()!.closest<HTMLElement>('.MuiDrawer-paper')!;
        expect(getComputedStyle(paper).width).toBe('100%');
        expect(getComputedStyle(paper).maxWidth).toBe('100%');

        const burbuja = document.querySelector<HTMLElement>('[data-testid="burbuja-asistente"]')!;
        const chat = burbuja.parentElement!;
        expect(getComputedStyle(chat).overflowX).toBe('hidden');
        expect(parseFloat(getComputedStyle(burbuja).minWidth)).toBe(0);
        expect(getComputedStyle(burbuja.firstElementChild as HTMLElement).overflowWrap).toBe('anywhere');
        const pregunta = burbuja.previousElementSibling as HTMLElement;
        expect(getComputedStyle(pregunta.firstElementChild as HTMLElement).overflowWrap).toBe('anywhere');

        const pre = burbuja.querySelector<HTMLElement>('pre')!;
        expect(getComputedStyle(pre).overflowX).toBe('auto');
        const tabla = burbuja.querySelector('table')!;
        expect(getComputedStyle(tabla.parentElement!).overflowX).toBe('auto');
    });

    it('la pantalla de consumo pone cada tabla en un contenedor con scroll propio y los indicadores en una grilla', async () => {
        b = await armarIA({ ancho: 360, permisos: PERMISOS_ADMIN_IA, ruta: '/asistente/consumo' });
        await esperar(() => /Gasto del mes/.test(document.body.textContent ?? ''), { que: 'la pantalla' });
        const tablas = Array.from(document.querySelectorAll('main table'));
        expect(tablas.length).toBeGreaterThanOrEqual(3);
        for (const t of tablas) expect(t.closest('.MuiTableContainer-root'), limpio(t.getAttribute('aria-label') ?? '')).not.toBeNull();
        const grilla = document.querySelector<HTMLElement>('main [class*="MuiBox-root"][class]:has(> .MuiCard-root)')!;
        // jsdom no evalúa las media queries: la cantidad de columnas por ancho (1 en xs) queda para la prueba manual.
        expect(getComputedStyle(grilla).display).toBe('grid');
    });
});
