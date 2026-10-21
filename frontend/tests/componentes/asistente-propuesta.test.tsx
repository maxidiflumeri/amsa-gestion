// Asistente de IA, Fase B: los pasos del turno y la tarjeta de la propuesta (docs/asistente-reportes-spec.md §6.2, §12, §13, §16.2 y §20.2).
import { afterEach, describe, expect, it } from 'vitest';
import { boton, chips as chipsMui, clic, esperar, limpio, pasar } from '../lib/montar';
import {
    PERMISOS_REPORTES_IA, PREGUNTAR, abrirPanel, armarIA, bajarIA, botonDetener, botonEnviar, entrada, ev, mapeoIA, panel,
    panelAbierto, preguntarAlAsistente, respuestaSse, rutaActual, tarjeta, vistaPreviaIA, type BancoIA,
} from '../lib/banco-ia';
import type { Paso, TarjetaPropuesta } from '@fe/types/asistente';

let b: BancoIA | null = null;
/** Los pedidos de vista previa, con su query (`ruta` la incluye). */
const VISTA_PREVIA = /^\/asistente\/propuestas\/\d+\/vista-previa/;
afterEach(async () => { await bajarIA(b); b = null; });

const esperarTerminada = () => esperar(() => botonEnviar() && !botonDetener(), { que: 'la respuesta terminada' });
const pasos = () => Array.from(document.querySelectorAll<HTMLElement>('[data-testid="pasos-turno"] li[data-estado]')).map((li) => limpio(li.textContent ?? ''));
const tarjetaEnPantalla = () => document.querySelector<HTMLElement>('[data-testid="tarjeta-propuesta"]');
const textoTarjeta = () => limpio(tarjetaEnPantalla()?.textContent ?? '');
const filasMapeo = () => Array.from(document.querySelectorAll<HTMLElement>('[data-testid="tarjeta-propuesta"] [data-estado]')).filter((e) => e.tagName === 'TR' || e.tagName === 'LI');
const PASOS: Paso[] = [
    { tipo: 'ejemplo', estado: 'ok', texto: 'Leí el ejemplo «cartera.xlsx»: 9 columnas y 3 filas' },
    { tipo: 'valores', estado: 'ok', texto: 'Busqué los valores de Empresa' },
    { tipo: 'prueba', estado: 'ok', texto: 'Probé la plantilla: 8.412 casos, sin errores' },
];
const turnoConTarjeta = (t: TarjetaPropuesta = tarjeta(), pausa = 20) => respuestaSse([
    ev.inicio(),
    ev.paso(PASOS[0].tipo, PASOS[0].texto), ev.paso(PASOS[1].tipo, PASOS[1].texto), ev.paso(PASOS[2].tipo, PASOS[2].texto),
    ['propuesta', t],
    ev.paso('propuesta', 'Te muestro la propuesta'),
    ev.fin('', { pasos: [...PASOS, { tipo: 'propuesta', estado: 'ok', texto: 'Te muestro la propuesta' }], propuestas: [t] }),
], pausa);

async function armar(over: Parameters<typeof armarIA>[0] = {}) {
    b = await armarIA({ permisos: PERMISOS_REPORTES_IA, ancho: 1600, ...over });
    await abrirPanel();
    await clic(boton('Armar un reporte'), 'Armar un reporte');
    return b;
}
async function pedirReporte(texto = 'Igual a este, de Toyota') {
    await preguntarAlAsistente(texto);
    await esperarTerminada();
}

describe('Los pasos del turno', () => {
    it('aparecen de a uno, con su estado; mientras corre el último es una fila con spinner', async () => {
        await armar();
        b!.preguntar = () => turnoConTarjeta(tarjeta(), 300);
        await preguntarAlAsistente('Igual a este');
        await esperar(() => pasos().length === 1, { que: 'el primer paso', cada: 10 });
        expect(pasos()[0]).toContain('Leí el ejemplo «cartera.xlsx»: 9 columnas y 3 filas');
        expect(document.querySelector('[data-testid="pasos-turno"] [role="status"] .MuiCircularProgress-root')).not.toBeNull();
        expect(tarjetaEnPantalla()).toBeNull();
        await esperar(() => pasos().length === 2, { que: 'el segundo paso', cada: 10 });
        expect(tarjetaEnPantalla()).toBeNull();
        await esperarTerminada();
        expect(pasos()).toHaveLength(4);
        expect(pasos()[2]).toContain('Probé la plantilla: 8.412 casos, sin errores');
        // Terminó: ya no hay fila de espera.
        expect(document.querySelector('[data-testid="pasos-turno"] [role="status"]')).toBeNull();
        expect(tarjetaEnPantalla()).not.toBeNull();
    });

    it('un aviso y un error se distinguen por estado (y por texto para el lector de pantalla)', async () => {
        await armar();
        b!.preguntar = () => respuestaSse([
            ev.inicio(), ev.paso('ejemplo', 'Leí el ejemplo «x.csv»: 4 columnas, sin encabezado', 'aviso'), ev.paso('prueba', 'La prueba encontró 2 problemas: los corrijo', 'error'),
            ev.fin('Necesito que me digas de qué empresa.'),
        ], 20);
        await pedirReporte();
        const li = Array.from(document.querySelectorAll('[data-testid="pasos-turno"] li[data-estado]'));
        expect(li.map((x) => x.getAttribute('data-estado'))).toEqual(['aviso', 'error']);
        expect(pasos()[0]).toContain('Con aviso');
        expect(pasos()[1]).toContain('Con error');
        expect(document.querySelector('[data-testid="burbuja-asistente"]')!.textContent).toContain('Necesito que me digas de qué empresa.');
    });

    it('los eventos «paso» y «propuesta» no se descartan: sin ellos la tarjeta no aparecería ni habría un error', async () => {
        await armar();
        b!.preguntar = () => turnoConTarjeta();
        await pedirReporte();
        expect(tarjetaEnPantalla()).not.toBeNull();
        expect(pasos().length).toBe(4);
    });

    it('un turno cortado conserva los pasos y la tarjeta que alcanzó a mostrar', async () => {
        await armar();
        const t = tarjeta();
        b!.preguntar = () => respuestaSse([ev.inicio(), ev.paso('prueba', 'Probé la plantilla: 8.412 casos, sin errores'), ['propuesta', t], ev.fin('Me quedé sin margen.', { estado: 'cortado', pasos: [PASOS[2]], propuestas: [t] })], 20);
        await pedirReporte();
        expect(pasos()).toHaveLength(1);
        expect(tarjetaEnPantalla()).not.toBeNull();
        expect(document.querySelector('[data-testid="burbuja-asistente"]')!.textContent).toContain('Me quedé sin margen.');
    });
});

describe('La tarjeta', () => {
    it('muestra el mensaje del modelo, el mapeo con los cuatro estados, los filtros, el formato y los casos', async () => {
        await armar();
        b!.preguntar = () => turnoConTarjeta(tarjeta({ formato: 'csv', opciones: ['Separador ;', 'Sin BOM'] }));
        await pedirReporte();
        const t = textoTarjeta();
        expect(t).toContain('Cartera Toyota +90');
        expect(t).toContain('Armé la plantilla igual a tu ejemplo.');
        expect(filasMapeo().map((f) => f.getAttribute('data-estado'))).toEqual(['exacta', 'exacta', 'aproximada', 'sin_campo', 'agregada']);
        expect(t).toContain('Tu columna');
        expect(t).toContain('Sale de');
        expect(t).toContain('Documento');
        expect(t).toContain('2 decimales, coma');
        expect(t).toContain('Columna vacía');
        expect(t).toContain('Días de mora');
        expect(t).toContain('Días desde el vencimiento');
        expect(t).toContain('Filtros: Empresa: TOYOTA · Vencimiento: hasta hace 90 días (hoy, 21/07/2026)');
        expect(t).toContain('Formato: CSV · Separador ; · Sin BOM');
        expect(t).toContain('La consulta completa trae 8.412 casos');
        // Los iconos de estado se nombran para el lector de pantalla.
        const nombres = Array.from(document.querySelectorAll('[data-testid="tarjeta-propuesta"] svg title')).map((x) => x.textContent);
        expect(nombres).toEqual(expect.arrayContaining(['Encontrada', 'Aproximada', 'Sin campo', 'Agregada']));
    });

    it('«aproximada» muestra su nota; el total aproximado lo dice; sin filtros avisa que trae todas las carteras; sin conteo lo reconoce', async () => {
        await armar();
        b!.preguntar = () => turnoConTarjeta(tarjeta({ filtros: [], casosAproximado: true }));
        await pedirReporte();
        expect(textoTarjeta()).toContain('Sin filtros: trae todas las carteras');
        expect(textoTarjeta()).toContain('8.412 casos (aprox.)');
        await bajarIA(b);
        await armar();
        b!.preguntar = () => turnoConTarjeta(tarjeta({ casos: null }));
        b!.vistaPrevia = () => ({ body: vistaPreviaIA({ casos: null }) });
        await pedirReporte();
        expect(textoTarjeta()).toContain('No se pudo contar los casos a tiempo.');
    });

    it('con más de 6 columnas muestra 5 y «y N columnas más» las despliega', async () => {
        await armar();
        const mapeo = Array.from({ length: 9 }, (_, i) => mapeoIA({ columnaEjemplo: `Col ${i + 1}`, label: `Col ${i + 1}`, saleDe: `Campo ${i + 1}` }));
        b!.preguntar = () => turnoConTarjeta(tarjeta({ mapeo }));
        await pedirReporte();
        expect(filasMapeo()).toHaveLength(5);
        await clic(boton('y 4 columnas más'), 'y 4 columnas más');
        expect(filasMapeo()).toHaveLength(9);
        await clic(boton('Ver menos columnas'), 'Ver menos columnas');
        expect(filasMapeo()).toHaveLength(5);
    });

    it('con exactamente 6 columnas las muestra todas (no vale la pena esconder una)', async () => {
        await armar();
        const mapeo = Array.from({ length: 6 }, (_, i) => mapeoIA({ columnaEjemplo: `Col ${i + 1}`, label: `Col ${i + 1}` }));
        b!.preguntar = () => turnoConTarjeta(tarjeta({ mapeo }));
        await pedirReporte();
        expect(filasMapeo()).toHaveLength(6);
        expect(boton(/columnas más/)).toBeNull();
    });

    it('los avisos: hasta 3 y «Ver N más»', async () => {
        await armar();
        b!.preguntar = () => turnoConTarjeta(tarjeta({ avisos: ['Aviso 1', 'Aviso 2', 'Aviso 3', 'Aviso 4', 'Aviso 5'] }));
        await pedirReporte();
        const avisos = () => Array.from(document.querySelectorAll('[data-testid="tarjeta-propuesta"] .MuiAlert-message')).map((a) => limpio(a.textContent ?? ''));
        expect(avisos()).toEqual(['Aviso 1', 'Aviso 2', 'Aviso 3']);
        await clic(Array.from(document.querySelectorAll('button')).find((x) => /Ver 2 más/.test(x.textContent ?? '')) ?? null, 'Ver 2 más');
        expect(avisos()).toHaveLength(5);
    });
});

describe('La vista previa', () => {
    it('la tarjeta vigente de esta sesión la pide sola, con los datos enmascarados, y no hay botón', async () => {
        await armar();
        b!.preguntar = () => turnoConTarjeta();
        await pedirReporte();
        await esperar(() => document.querySelector('[data-testid="vista-previa-tabla"]'), { que: 'la vista previa' });
        const pedidos = b!.srv.de('GET', VISTA_PREVIA);
        expect(pedidos).toHaveLength(1);
        expect(pedidos[0].ruta).toBe('/asistente/propuestas/31/vista-previa?filas=5');
        expect(textoTarjeta()).toContain('··· 4521');
        expect(textoTarjeta()).toContain('M. L. G.');
        expect(boton('Ver vista previa')).toBeNull();
        // La tabla tiene su propio scroll horizontal: no ensancha el panel.
        const contenedor = document.querySelector<HTMLElement>('[data-testid="vista-previa-tabla"]')!;
        expect(getComputedStyle(contenedor).overflowX).toBe('auto');
    });

    it('al reabrir la conversación NO se pide sola: hay un botón «Ver vista previa» que la pide a demanda', async () => {
        const t = tarjeta();
        b = await armarIA({
            permisos: PERMISOS_REPORTES_IA, ancho: 1600,
            conversaciones: [{ id: 60, titulo: 'Cartera Toyota', turnos: 1, updatedAt: '2026-10-19T15:00:00.000Z', funcion: 'reportes' }],
            detalles: [{
                id: 60, titulo: 'Cartera Toyota', turnos: 1, updatedAt: '2026-10-19T15:00:00.000Z', funcion: 'reportes',
                mensajes: [
                    { id: 1, rol: 'usuario', texto: 'Igual a este', ruta: '/reportes', fuentes: [], acciones: [], estado: 'ok', calificacion: null, createdAt: '2026-10-19T15:00:00.000Z', pasos: [], propuestas: [], adjuntos: [{ id: 501, nombre: 'cartera.xlsx', tipo: 'xlsx', columnas: 9 }] },
                    { id: 2, rol: 'asistente', texto: '', ruta: null, fuentes: [], acciones: [], estado: 'ok', calificacion: null, createdAt: '2026-10-19T15:00:01.000Z', pasos: PASOS, propuestas: [t], adjuntos: [] },
                ],
            }],
        });
        await abrirPanel();
        await clic(boton('Armar un reporte'), 'Armar un reporte');
        await clic(document.querySelector('button[aria-label="Más opciones"]'), 'el menú');
        const item = await esperar(() => Array.from(document.querySelectorAll('li[role="menuitem"]')).find((x) => /Cartera Toyota/.test(x.textContent ?? '')), { que: 'la conversación' });
        await clic(item, 'la conversación');
        await esperar(() => tarjetaEnPantalla(), { que: 'la tarjeta reabierta' });
        await pasar(300);
        expect(b.srv.cuantos('GET', VISTA_PREVIA)).toBe(0);
        expect(pasos()).toHaveLength(3);
        expect(limpio(document.querySelector('[data-testid="adjuntos-enviados"]')!.textContent ?? '')).toContain('XLSX · cartera.xlsx · 9 columnas');
        await clic(boton('Ver vista previa'), 'Ver vista previa');
        await esperar(() => document.querySelector('[data-testid="vista-previa-tabla"]'), { que: 'la vista previa a demanda' });
        expect(b.srv.cuantos('GET', VISTA_PREVIA)).toBe(1);
    });

    it('si tarda demasiado o falla, lo dice y se puede volver a pedir', async () => {
        await armar();
        b!.preguntar = () => turnoConTarjeta();
        b!.vistaPrevia = () => ({ body: vistaPreviaIA({ columnas: [], filas: [], error: 'TIMEOUT' }) });
        await pedirReporte();
        await esperar(() => textoTarjeta().includes('La vista previa tardó demasiado.'), { que: 'el aviso' });
        b!.vistaPrevia = () => ({ body: vistaPreviaIA() });
        await clic(boton('Volver a pedirla'), 'Volver a pedirla');
        await esperar(() => document.querySelector('[data-testid="vista-previa-tabla"]'), { que: 'la vista previa' });

        await bajarIA(b);
        await armar();
        b!.preguntar = () => turnoConTarjeta();
        b!.vistaPrevia = () => ({ status: 500, body: { message: 'boom' } });
        await pedirReporte();
        await esperar(() => textoTarjeta().includes('No se pudo armar la vista previa.'), { que: 'el aviso de fallo' });
        expect(boton('Reintentar la vista previa')).not.toBeNull();
    });
});

describe('Abrir en el editor', () => {
    it('navega a /reportes/nuevo?propuesta=ID con el panel abierto y la tarjeta pasa a «abierta»', async () => {
        await armar({ ruta: '/reportes' });
        b!.preguntar = () => turnoConTarjeta();
        await pedirReporte();
        expect(limpio(document.querySelector('[data-testid="tarjeta-propuesta-accion"]')!.textContent ?? '')).toContain('¿La abro en el editor para que la revises y la guardes?');
        expect(textoTarjeta()).toContain('No guardo nada sin tu confirmación. En el editor podés cambiar lo que quieras.');
        await clic(boton('Abrir en el editor'), 'Abrir en el editor');
        await esperar(() => rutaActual() === '/reportes/nuevo', { que: 'la navegación' });
        expect(document.querySelector('[data-testid="ruta"]')!.getAttribute('data-search')).toBe('?propuesta=31');
        expect(panelAbierto()).toBe(true);
        // Todavía no: la tarjeta pasa a «abierta» cuando el editor cargó la plantilla (acá no hay editor, lo avisa el evento).
        expect(textoTarjeta()).not.toContain('La abriste en el editor');
        window.dispatchEvent(new CustomEvent('asistente:propuesta-abierta', { detail: { propuestaId: 31 } }));
        await esperar(() => textoTarjeta().includes('La abriste en el editor'), { que: 'el estado abierta' });
        expect(boton('Abrir de nuevo')).not.toBeNull();
        expect(boton('Abrir en el editor')).toBeNull();
    });

    it('en una pantalla mediana, donde el panel tapa el editor, se cierra para dejar verlo', async () => {
        await armar({ ancho: 1280 });
        b!.preguntar = () => turnoConTarjeta();
        await pedirReporte();
        await clic(boton('Abrir en el editor'), 'Abrir en el editor');
        await esperar(() => rutaActual() === '/reportes/nuevo', { que: 'la navegación' });
        await esperar(() => !panelAbierto(), { que: 'el panel cerrado' });
    });

    it('una guardada dice cómo quedó y lleva a la plantilla', async () => {
        await armar();
        b!.preguntar = () => turnoConTarjeta(tarjeta({ estado: 'guardada', plantillaId: 55 }));
        await pedirReporte();
        expect(textoTarjeta()).toContain('Guardada como «Cartera Toyota +90»');
        expect(boton('Abrir en el editor')).toBeNull();
        await clic(boton('Ver la plantilla'), 'Ver la plantilla');
        await esperar(() => rutaActual() === '/reportes/55/editar', { que: 'la plantilla' });
    });

    it('cuando el editor avisa que guardó, la tarjeta pasa a «Guardada» sin recargar', async () => {
        await armar();
        b!.preguntar = () => turnoConTarjeta();
        await pedirReporte();
        window.dispatchEvent(new CustomEvent('asistente:propuesta-guardada', { detail: { propuestaId: 31, plantillaId: 77, nombre: 'Toyota mora' } }));
        await esperar(() => textoTarjeta().includes('Guardada como «Toyota mora»'), { que: 'la tarjeta guardada con el nombre real' });
    });
});

describe('Ajustar y versiones', () => {
    it('«Ajustar algo antes» enfoca el compositor, cambia el placeholder y no llama al backend', async () => {
        await armar();
        b!.preguntar = () => turnoConTarjeta();
        await pedirReporte();
        const llamadas = b!.srv.pedidos.length;
        await clic(boton('Ajustar algo antes'), 'Ajustar algo antes');
        expect(document.activeElement).toBe(entrada());
        expect(entrada()!.getAttribute('placeholder')).toBe('¿Qué querés cambiar?');
        await pasar(100);
        expect(b!.srv.pedidos.length).toBe(llamadas);
        // Al mandar, el placeholder vuelve al de siempre.
        await preguntarAlAsistente('Que salga en CSV');
        await esperarTerminada();
        expect(entrada()!.getAttribute('placeholder')).toBe('Describí el reporte o adjuntá un ejemplo…');
    });

    it('un chip de sugerencia manda el texto directo', async () => {
        await armar();
        b!.preguntar = (_c, n) => (n === 1 ? turnoConTarjeta(tarjeta({ sugerencias: ['Agregá el teléfono alternativo', 'Que salga en CSV separado por ;'] })) : respuestaSse([ev.inicio(), ev.fin('Listo.')], 10));
        await pedirReporte();
        const sugerencias = Array.from(document.querySelectorAll('[data-testid="sugerencias-propuesta"] .MuiChip-label')).map((x) => limpio(x.textContent ?? ''));
        expect(sugerencias).toEqual(['Agregá el teléfono alternativo', 'Que salga en CSV separado por ;']);
        await clic(Array.from(document.querySelectorAll('[data-testid="sugerencias-propuesta"] .MuiChip-root')).find((x) => /teléfono alternativo/.test(x.textContent ?? '')) ?? null, 'la sugerencia');
        await esperar(() => b!.preguntas === 2, { que: 'el segundo pedido' });
        await esperarTerminada();
        expect(b!.cuerpos('POST', PREGUNTAR)[1]).toEqual({ conversacionId: 7, pregunta: 'Agregá el teléfono alternativo', ruta: '/gestion', funcion: 'reportes' });
    });

    it('una versión nueva deja la anterior colapsada («Versión 1 · … · Abrir esta versión») y la nueva dice «Versión 2»', async () => {
        await armar({ ruta: '/reportes' });
        const v1 = tarjeta();
        const v2 = tarjeta({ propuestaId: 32, version: 2, nombre: 'Cartera Toyota +90 con teléfono alternativo' });
        b!.preguntar = (_c, n) => (n === 1 ? turnoConTarjeta(v1) : turnoConTarjeta(v2));
        await pedirReporte();
        await pedirReporte('Agregá el teléfono alternativo');
        await esperar(() => document.querySelectorAll('[data-testid="tarjeta-propuesta"]').length === 1, { que: 'una sola tarjeta completa' });
        const vieja = document.querySelector('[data-testid="tarjeta-propuesta-vieja"]')!;
        expect(limpio(vieja.textContent ?? '')).toContain('Versión 1 · «Cartera Toyota +90»');
        expect(textoTarjeta()).toContain('Versión 2');
        expect(textoTarjeta()).toContain('Cartera Toyota +90 con teléfono alternativo');
        // Solo la vigente pide la vista previa.
        await esperar(() => b!.srv.cuantos('GET', VISTA_PREVIA) >= 2, { que: 'las vistas previas' });
        expect(b!.srv.de('GET', VISTA_PREVIA).map((p) => p.ruta.split('?')[0])).toEqual(['/asistente/propuestas/31/vista-previa', '/asistente/propuestas/32/vista-previa']);
        await clic(boton('Abrir esta versión'), 'Abrir esta versión');
        await esperar(() => rutaActual() === '/reportes/nuevo', { que: 'la navegación' });
        expect(document.querySelector('[data-testid="ruta"]')!.getAttribute('data-search')).toBe('?propuesta=31');
    });
});

describe('Errores del turno', () => {
    it('CONVERSACION_LLENA en reportes usa el texto del servidor y ofrece una conversación nueva', async () => {
        await armar();
        b!.preguntar = () => ({ status: 409, body: { codigo: 'CONVERSACION_LLENA', mensaje: 'Esta conversación ya es muy larga. Empezá una nueva: la última propuesta sigue disponible en su tarjeta.', message: 'x' } });
        await preguntarAlAsistente('otro ajuste');
        await esperar(() => /ya es muy larga/.test(limpio(panel()!.textContent ?? '')), { que: 'el aviso' });
        expect(boton('Nueva conversación')).not.toBeNull();
    });

    it('un tope del servidor pausa el modo y lo dice', async () => {
        await armar();
        b!.preguntar = () => respuestaSse([ev.inicio(), ev.error({ codigo: 'TOPE_FUNCION', mensaje: 'La función de reportes llegó al tope del mes.' })], 10);
        await preguntarAlAsistente('algo');
        await esperar(() => /llegó al tope del mes/.test(limpio(panel()!.textContent ?? '')), { que: 'el tope' });
        expect(chipsMui()).toBeDefined();
    });
});

describe('«Armar con amaIA» en Reportes', () => {
    it('se deshabilita mientras hay una respuesta escribiéndose (cambiar de modo la cortaría) y vuelve al terminar', async () => {
        b = await armarIA({ permisos: PERMISOS_REPORTES_IA, ancho: 1600, ruta: '/reportes-real' });
        b.srv.en('GET', /^\/reportes\/plantillas$/, () => ({ body: [] }));
        b.srv.en('GET', /^\/empresas$/, () => ({ body: [] }));
        b.preguntar = () => respuestaSse([ev.inicio(), ev.texto('Escribiendo…')], 30, { cerrar: false });
        const boton1 = () => Array.from(document.querySelectorAll('main button')).find((x) => /Armar con amaIA/.test(x.textContent ?? '')) as HTMLButtonElement | undefined;
        await esperar(() => boton1(), { que: 'el botón de Reportes' });
        expect(boton1()!.disabled).toBe(false);
        await abrirPanel();
        await preguntarAlAsistente('¿Cómo armo un reporte?');
        await esperar(() => botonDetener(), { que: 'Detener' });
        expect(boton1()!.disabled).toBe(true);
        await clic(botonDetener(), 'Detener');
        await esperarTerminada();
        expect(boton1()!.disabled).toBe(false);
    });
});
