// Asistente de IA, Fase A: tema claro y oscuro, y 360 px (docs/asistente-spec.md §12.2, §16.2 y §20.15).
// jsdom no calcula layout: el desborde horizontal real queda para la prueba manual en un navegador. Acá se comprueba lo que sí se puede:
// que los colores salgan de la paleta de cada tema y que la estructura que evita el desborde (min-width 0, saltos de línea, scroll propio) esté.
import { afterEach, describe, expect, it } from 'vitest';
import { clic, esperar, limpio } from '../lib/montar';
import {
    PERMISOS_ADMIN_IA, PERMISOS_DETALLE_IA, abrirPanel, accionIrA, armarIA, bajarIA, burbujas, detalleIA, ev, fuente, panel, preguntarAlAsistente, respuestaSse,
    type BancoIA,
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


// El detalle de la respuesta (docs/asistente-detalle-spec.md §12.3): las barras de la cascada toman los colores de la paleta.
async function conDetalleAbierto(over: Parameters<typeof detalleIA>[0] = {}) {
    b!.preguntar = () => respuestaSse([ev.inicio(), ev.texto('Listo.'), ev.fin('Listo.', { detalle: detalleIA(over) })], 10);
    await abrirPanel();
    await preguntarAlAsistente('armame un reporte');
    const abrir = await esperar(() => document.querySelector<HTMLButtonElement>('[data-testid="detalle-respuesta"] > button'), { que: 'el botón Ver detalle' });
    await clic(abrir, 'Ver detalle');
    await esperar(() => document.querySelector('[data-testid="detalle-respuesta"] li'), { que: 'las filas' });
}
const filaDe = (prefijo: RegExp) => Array.from(document.querySelectorAll<HTMLElement>('[data-testid="detalle-respuesta"] li')).find((f) => prefijo.test(f.getAttribute('aria-label') ?? ''))!;
/** La barra de una fila: la que está dentro de la pista (`aria-hidden`). */
const barraDe = (prefijo: RegExp) => filaDe(prefijo).querySelector<HTMLElement>(':scope > div[aria-hidden="true"] > div')!;

describe('El detalle de la respuesta, en claro y en oscuro', () => {
    const paleta = {
        light: { primary: 'rgb(37, 99, 235)', secondary: 'rgb(124, 58, 237)', info: 'rgb(2, 132, 199)', apagado: 'rgb(148, 163, 184)', warning: 'rgb(217, 119, 6)' },
        dark: { primary: 'rgb(96, 165, 250)', secondary: 'rgb(167, 139, 250)', info: 'rgb(56, 189, 248)', apagado: 'rgb(100, 116, 139)', warning: 'rgb(245, 158, 11)' },
    } as const;
    for (const modo of ['light', 'dark'] as const) {
        it(`${modo}: llamada, espera, respuesta y pedido con primary; razonamiento con secondary; herramientas con info; el resto apagado`, async () => {
            b = await armarIA({ modo, permisos: PERMISOS_DETALLE_IA });
            await conDetalleAbierto();
            const p = paleta[modo];
            const color = (prefijo: RegExp) => getComputedStyle(barraDe(prefijo)).backgroundColor;
            expect(color(/^Llamada 1/)).toBe(p.primary);
            expect(color(/^Espera del primer token/)).toBe(p.primary);
            expect(color(/^Pide /)).toBe(p.primary);
            expect(color(/^Respuesta/)).toBe(p.primary);
            expect(color(/^Razonamiento/)).toBe(p.secondary);
            expect(color(/^Herramienta probar_plantilla/)).toBe(p.info);
            expect(color(/^Conteo de casos/)).toBe(p.info);
            expect(color(/^Guardar/)).toBe(p.apagado);
            expect(color(/^Preparación/)).toBe(p.apagado);
            expect(color(/^Preparación/)).not.toBe(color(/^Llamada 1/));
        });
    }

    it('lo que quedó cortado lleva el borde de advertencia de la paleta', async () => {
        b = await armarIA({ modo: 'light', permisos: PERMISOS_DETALLE_IA });
        const detalle = detalleIA({ estado: 'cortado', motivo: 'detenida' });
        detalle.nodos = [{ tipo: 'llamada', desdeMs: 0, ms: 6_200, numero: 1, fin: 'abortada', cortado: true, hijos: [{ tipo: 'espera', desdeMs: 0, ms: 6_200, cortado: true }] }];
        await conDetalleAbierto(detalle);
        expect(getComputedStyle(barraDe(/^Llamada 1/)).borderColor).toBe(paleta.light.warning);
        expect(limpio(document.querySelector('[data-testid="detalle-respuesta"]')!.textContent ?? '')).toContain('La detuviste a los 18,3 s');
    });
});

describe('El detalle de la respuesta a 360 px', () => {
    it('el panel y la burbuja contienen el detalle: cada fila puede achicarse, la etiqueta se parte y el tiempo y el costo no', async () => {
        b = await armarIA({ ancho: 360, permisos: PERMISOS_DETALLE_IA });
        const detalle = detalleIA();
        detalle.nodos[1].hijos![1] = { tipo: 'razonamiento', desdeMs: 1_500, ms: 3_400, tokens: 412, costoUsd: 0.004532, estimado: true };
        detalle.nodos[2].nombre = `probar_plantilla_${LARGA}`;
        await conDetalleAbierto(detalle);
        const burbuja = document.querySelector<HTMLElement>('[data-testid="burbuja-asistente"]')!;
        expect(getComputedStyle(burbuja.parentElement!).overflowX).toBe('hidden');
        expect(parseFloat(getComputedStyle(burbuja).minWidth)).toBe(0);
        const fila = filaDe(/^Herramienta probar_plantilla_/);
        expect(parseFloat(getComputedStyle(fila).minWidth)).toBe(0);
        // La grilla de la fila: la etiqueta cede (minmax(0, 1fr)), el tiempo y el costo no se parten.
        const grilla = fila.firstElementChild as HTMLElement;
        expect(getComputedStyle(grilla).display).toBe('grid');
        expect(getComputedStyle(grilla).gridTemplateColumns).toBe('minmax(0, 1fr) auto auto');
        const etiqueta = grilla.firstElementChild!.querySelector<HTMLElement>('span')!;
        expect(getComputedStyle(etiqueta).overflowWrap).toBe('anywhere');
        expect(getComputedStyle(grilla.children[1] as HTMLElement).whiteSpace).toBe('nowrap');
        expect(getComputedStyle(grilla.children[2] as HTMLElement).whiteSpace).toBe('nowrap');
        // Las líneas chicas también se parten donde haga falta.
        const caption = fila.querySelector<HTMLElement>('.MuiTypography-caption')!;
        expect(getComputedStyle(caption).overflowWrap).toBe('anywhere');
    });
});
