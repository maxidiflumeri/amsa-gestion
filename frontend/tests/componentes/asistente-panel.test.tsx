// Asistente de IA, Fase A: el panel, el streaming y todo lo que puede contestar el servidor (docs/asistente-spec.md §6, §9, §12.2 y §16.2).
import { afterEach, describe, expect, it } from 'vitest';
import { alertas, boton, chips, clic, esperar, limpio, pasar } from '../lib/montar';
import {
    ACCION, CALIFICACION, PERMISOS_IA, PREGUNTAR, abrirPanel, accionIrA, alertasDelPanel, armarIA, bajarIA, botonDetener, botonEnviar,
    burbujas, entrada, escribirPregunta, estadoIA, ev, fuente, irA, panel, panelAbierto, preguntarAlAsistente, respuestaNormal, respuestaSse,
    rutaActual, teclaEnPregunta, ultimaBurbuja, type BancoIA,
} from '../lib/banco-ia';

let b: BancoIA | null = null;
afterEach(async () => { await bajarIA(b); b = null; });

const sugerencias = () => Array.from(document.querySelectorAll('[data-testid="sugerencias"] .MuiChip-label')).map((e) => limpio(e.textContent ?? ''));
const botonPorNombre = (nombre: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${nombre}"]`);
const esperarTerminada = () => esperar(() => botonEnviar() && !botonDetener(), { que: 'la respuesta terminada' });

describe('Sugerencias', () => {
    it('las de Gestión se filtran por permiso: sin promesas.crear ni convenios.generar_cupon queda solo la que cualquiera puede hacer', async () => {
        b = await armarIA({ permisos: ['asistente.usar', 'deudores.ver'] });
        await abrirPanel();
        expect(sugerencias()).toEqual(['¿Qué diferencia hay entre situación y gestión?']);
    });

    it('con los permisos, las tres; y un clic manda la pregunta tal cual', async () => {
        b = await armarIA();
        await abrirPanel();
        expect(sugerencias()).toEqual(['¿Cómo cargo una promesa de pago?', '¿Cómo genero un cupón?', '¿Qué diferencia hay entre situación y gestión?']);
        await clic(Array.from(document.querySelectorAll('[data-testid="sugerencias"] .MuiChip-root')).find((c) => /cupón/.test(c.textContent ?? '')) ?? null, 'la sugerencia');
        await esperar(() => b!.preguntas === 1, { que: 'la pregunta' });
        expect(b.cuerpos('POST', PREGUNTAR)[0]).toEqual({ pregunta: '¿Cómo genero un cupón?', ruta: '/gestion' });
        await esperarTerminada();
    });

    it('una pantalla sin sugerencias propias ofrece la genérica', async () => {
        b = await armarIA({ ruta: '/ajustes/empresas' });
        await abrirPanel();
        expect(sugerencias()).toEqual(['¿Qué puedo hacer en esta pantalla?']);
    });
});

describe('El texto llega de a trozos', () => {
    it('crece mientras se escribe, «Detener» reemplaza a «Enviar» y al terminar vuelve; la pregunta lleva token, ruta y, la segunda vez, la conversación', async () => {
        b = await armarIA();
        b.preguntar = (_c, n) => respuestaNormal(n === 1 ? ['Para cargar una promesa ', 'entrá a la ficha ', 'y tocá **Nueva promesa**.'] : ['Segunda.'], {}, 120);
        await abrirPanel();
        await preguntarAlAsistente('¿Cómo cargo una promesa?');
        await esperar(() => botonDetener(), { que: 'Detener' });
        expect(botonEnviar()).toBeNull();
        expect(burbujas().length).toBe(1);
        // Primero un pedazo...
        const parcial = await esperar(() => { const t = ultimaBurbuja(); return t.includes('Para cargar una promesa') && !t.includes('Nueva promesa') ? t : false; }, { que: 'el texto a medias', cada: 10 });
        expect(parcial).not.toContain('y tocá');
        // ...y después el resto.
        await esperarTerminada();
        expect(ultimaBurbuja()).toContain('Para cargar una promesa entrá a la ficha y tocá Nueva promesa.');
        expect(document.querySelector('[data-testid="burbuja-asistente"] strong')?.textContent).toBe('Nueva promesa');

        const [p1] = b.srv.de('POST', PREGUNTAR);
        expect(p1.autorizacion).toBe('Bearer token-de-prueba');
        expect(p1.tipo).toContain('application/json');
        expect(b.cuerpos('POST', PREGUNTAR)[0]).toEqual({ pregunta: '¿Cómo cargo una promesa?', ruta: '/gestion' });

        await preguntarAlAsistente('¿Y un cupón?');
        await esperarTerminada();
        expect(b.cuerpos('POST', PREGUNTAR)[1]).toEqual({ conversacionId: 7, pregunta: '¿Y un cupón?', ruta: '/gestion' });
        expect(burbujas().length).toBe(2);
    });

    it('«herramienta» muestra «Leyendo «…»…» y se va cuando empieza el texto', async () => {
        b = await armarIA();
        b.preguntar = () => respuestaSse([ev.inicio(), ev.herramienta('reportes/armar-un-reporte', 'Armar un reporte'), ev.texto('Listo, '), ev.fin('Listo, así se arma.')], 250);
        await abrirPanel();
        await preguntarAlAsistente('¿Cómo armo un reporte?');
        await esperar(() => ultimaBurbuja().includes('Leyendo «Armar un reporte»…'), { que: 'el aviso de lectura', cada: 10 });
        expect(ultimaBurbuja()).not.toContain('Pensando');
        await esperarTerminada();
        expect(ultimaBurbuja()).not.toContain('Leyendo');
        expect(ultimaBurbuja()).toContain('Listo, así se arma.');
    });

    it('«herramienta» de búsqueda muestra «Buscando en la documentación…» y después la lectura', async () => {
        b = await armarIA();
        b.preguntar = () => respuestaSse([ev.inicio(), ev.busqueda(), ev.herramienta('importacion/crear-plantilla', 'Crear una plantilla'), ev.texto('Son bloques.'), ev.fin('Son bloques.')], 250);
        await abrirPanel();
        await preguntarAlAsistente('¿Qué son los bloques repetitivos?');
        await esperar(() => ultimaBurbuja().includes('Buscando en la documentación…'), { que: 'el aviso de búsqueda', cada: 10 });
        await esperar(() => ultimaBurbuja().includes('Leyendo «Crear una plantilla»…'), { que: 'el aviso de lectura', cada: 10 });
        await esperarTerminada();
        expect(ultimaBurbuja()).not.toContain('Buscando');
        expect(ultimaBurbuja()).toContain('Son bloques.');
    });

    it('antes del primer texto dice «Pensando…»', async () => {
        b = await armarIA();
        b.preguntar = () => respuestaSse([ev.inicio(), ev.texto('Hola'), ev.fin('Hola')], 300);
        await abrirPanel();
        await preguntarAlAsistente('Hola');
        await esperar(() => ultimaBurbuja() === 'Pensando…', { que: 'Pensando', cada: 10 });
        await esperarTerminada();
    });

    it('«fin» reemplaza lo acumulado por el texto completo del servidor, con sus fuentes', async () => {
        b = await armarIA();
        b.preguntar = () => respuestaSse([ev.inicio(), ev.texto('Texto parcial que no vale'), ev.fin('Este es el texto final.', { fuentes: [fuente()] })], 40);
        await abrirPanel();
        await preguntarAlAsistente('algo');
        await esperarTerminada();
        expect(ultimaBurbuja()).toContain('Este es el texto final.');
        expect(ultimaBurbuja()).not.toContain('parcial');
        expect(chips()).toContain('Ayuda · Armar un reporte');
    });

    it('un evento partido a la mitad entre dos trozos de red se arma bien (el parser es incremental)', async () => {
        b = await armarIA();
        const completo = `event: inicio\ndata: ${JSON.stringify(ev.inicio()[1])}\n\n: ping\n\nevent: texto\ndata: {"delta":"Hola "}\n\nevent: texto\ndata: {"delta":"mundo"}\n\nevent: fin\ndata: ${JSON.stringify(ev.fin('Hola mundo')[1])}\n\n`;
        b.preguntar = () => ({ stream: { trozos: [completo.slice(0, 20), completo.slice(20, 75), completo.slice(75, 140), completo.slice(140)], pausaMs: 30 } });
        await abrirPanel();
        await preguntarAlAsistente('x');
        await esperarTerminada();
        expect(ultimaBurbuja()).toBe('Hola mundo');
    });

    it('Enter manda, Shift+Enter no; el contador aparece desde los 1800 caracteres y el cuadro no pasa de 2000', async () => {
        b = await armarIA();
        await abrirPanel();
        await escribirPregunta('una pregunta');
        await teclaEnPregunta('Enter', true);
        await pasar(100);
        expect(b.preguntas).toBe(0);
        await teclaEnPregunta('Enter');
        await esperar(() => b!.preguntas === 1, { que: 'el envío con Enter' });
        await esperarTerminada();

        expect(panel()!.textContent).not.toContain('/2000');
        await escribirPregunta('a'.repeat(1850));
        expect(limpio(panel()!.textContent ?? '')).toContain('1850/2000');
        await escribirPregunta('a'.repeat(2500));
        expect(entrada()!.value.length).toBe(2000);
    });

    it('el foco va al cuadro de la pregunta al abrir', async () => {
        b = await armarIA();
        await abrirPanel();
        await esperar(() => document.activeElement === entrada(), { que: 'el foco en el cuadro' });
    });

    it('el chat es una región viva fija (aria-live polite) y la burbuja no lleva la suya: el lector lee la respuesta al terminar', async () => {
        b = await armarIA();
        b.preguntar = () => respuestaSse([ev.inicio(), ev.texto('Hola'), ev.fin('Hola')], 300);
        await abrirPanel();
        const chat = () => document.querySelector('[data-testid="chat-asistente"]')!;
        expect(chat().getAttribute('aria-live')).toBe('polite');
        await preguntarAlAsistente('x');
        await esperar(() => document.querySelector('[data-testid="burbuja-asistente"][aria-busy="true"]'), { que: 'la burbuja escribiéndose' });
        expect(chat().getAttribute('aria-live')).toBe('polite');
        await esperarTerminada();
        expect(chat().getAttribute('aria-live')).toBe('polite');
        expect(chat().querySelector('[data-testid="burbuja-asistente"]')!.getAttribute('aria-live')).toBeNull();
        expect(chat().querySelector('[data-testid="burbuja-asistente"]')!.getAttribute('aria-busy')).toBe('false');
    });
});

describe('Tarjetas «Sí, llevarme» / «No, gracias»', () => {
    const conTarjeta = () => respuestaSse([ev.inicio(), ev.texto('Se arma en Reportes.'), ev.accion(), ev.fin('Se arma en Reportes.', { acciones: [accionIrA()], fuentes: [fuente()] })], 30);

    it('«Sí, llevarme» navega, avisa al servidor y el panel sigue abierto con la conversación', async () => {
        b = await armarIA({ ancho: 1600 });
        b.preguntar = conTarjeta;
        await abrirPanel();
        await preguntarAlAsistente('¿Dónde creo una plantilla de reportes?');
        await esperarTerminada();
        const tarjeta = document.querySelector('[data-testid="tarjeta-ir-a"]')!;
        expect(limpio(tarjeta.textContent ?? '')).toContain('¿Querés que te lleve a «Nueva plantilla de reportes»?');
        expect(limpio(tarjeta.textContent ?? '')).toContain('Se abre en esta pestaña; el asistente queda abierto.');
        expect(rutaActual()).toBe('/gestion');
        await clic(boton('Sí, llevarme'), 'Sí, llevarme');
        await esperar(() => rutaActual() === '/reportes/nuevo', { que: 'la navegación' });
        await esperar(() => b!.srv.cuantos('POST', ACCION) === 1, { que: 'el aviso al servidor' });
        expect(b.cuerpos('POST', ACCION)[0]).toEqual({ accionId: 'toolu_1', resultado: 'aceptada' });
        expect(b.srv.de('POST', ACCION)[0].ruta).toBe('/asistente/mensajes/102/accion');
        expect(panelAbierto()).toBe(true);
        expect(limpio(document.querySelector('[data-testid="tarjeta-ir-a"]')!.textContent ?? '')).toBe('Te llevé a «Nueva plantilla de reportes».');
        // La conversación sobrevivió al cambio de pantalla y la barra ya muestra la pantalla nueva.
        expect(ultimaBurbuja()).toContain('Se arma en Reportes.');
        await esperar(() => limpio(panel()!.textContent ?? '').includes('Estás en: Nueva plantilla de reportes'), { que: 'el chip de la pantalla nueva' });
    });

    it('«No, gracias» no navega, queda en «Listo.» y avisa «rechazada»', async () => {
        b = await armarIA();
        b.preguntar = conTarjeta;
        await abrirPanel();
        await preguntarAlAsistente('x');
        await esperarTerminada();
        await clic(boton('No, gracias'), 'No, gracias');
        await esperar(() => b!.srv.cuantos('POST', ACCION) === 1, { que: 'el aviso al servidor' });
        expect(b.cuerpos('POST', ACCION)[0]).toEqual({ accionId: 'toolu_1', resultado: 'rechazada' });
        expect(rutaActual()).toBe('/gestion');
        expect(limpio(document.querySelector('[data-testid="tarjeta-ir-a"]')!.textContent ?? '')).toBe('Listo.');
        expect(boton('Sí, llevarme')).toBeNull();
    });

    it('si ya estás en esa pantalla, la tarjeta no ofrece llevarte', async () => {
        b = await armarIA({ ruta: '/reportes/nuevo' });
        b.preguntar = conTarjeta;
        await abrirPanel();
        await preguntarAlAsistente('x');
        await esperarTerminada();
        expect(limpio(document.querySelector('[data-testid="tarjeta-ir-a"]')!.textContent ?? '')).toBe('Ya estás en «Nueva plantilla de reportes».');
        expect(boton('Sí, llevarme')).toBeNull();
    });

    it('la tarjeta no se puede tocar mientras la respuesta se está escribiendo: aparece recién al terminar', async () => {
        b = await armarIA();
        b.preguntar = () => respuestaSse([ev.inicio(), ev.texto('Se arma '), ev.accion(), ev.texto('en Reportes.'), ev.fin('Se arma en Reportes.', { acciones: [accionIrA()] })], 200);
        await abrirPanel();
        await preguntarAlAsistente('x');
        await esperar(() => ultimaBurbuja().includes('Se arma'), { que: 'texto', cada: 10 });
        expect(document.querySelector('[data-testid="tarjeta-ir-a"]')).toBeNull();
        await esperarTerminada();
        expect(document.querySelector('[data-testid="tarjeta-ir-a"]')).not.toBeNull();
    });

    it('en un celular el panel es de pantalla completa y «Sí, llevarme» lo cierra para que se vea la pantalla nueva', async () => {
        b = await armarIA({ ancho: 360 });
        b.preguntar = conTarjeta;
        await abrirPanel();
        expect(getComputedStyle(panel()!.closest('.MuiDrawer-paper')!).width).toBe('100%');
        await preguntarAlAsistente('x');
        await esperarTerminada();
        expect(limpio(document.querySelector('[data-testid="tarjeta-ir-a"]')!.textContent ?? '')).not.toContain('queda abierto');
        await clic(boton('Sí, llevarme'), 'Sí, llevarme');
        await esperar(() => rutaActual() === '/reportes/nuevo' && !panelAbierto(), { que: 'navegó y se cerró el panel' });
    });

    it('cambiar de pantalla por afuera (otro enlace) no pierde la conversación', async () => {
        b = await armarIA();
        await abrirPanel();
        await preguntarAlAsistente('Una pregunta');
        await esperarTerminada();
        await irA('/reportes');
        await esperar(() => limpio(panel()!.textContent ?? '').includes('Estás en: Reportes'), { que: 'el chip nuevo' });
        expect(burbujas().length).toBe(1);
        expect(panelAbierto()).toBe(true);
    });
});

describe('Enlaces de la respuesta: solo la Documentación que existe', () => {
    const texto = 'Mirá [Armar un reporte](/ayuda/reportes/armar-un-reporte), [una que no existe](/ayuda/no/existe), [un sitio](https://ejemplo.com/x) y ![pixel](https://ejemplo.com/p.png).';

    it('un enlace /ayuda/<slug> existente abre el visor dentro del panel, sin salir de la pantalla; «Volver al chat» vuelve', async () => {
        b = await armarIA();
        b.preguntar = () => respuestaNormal([texto]);
        await abrirPanel();
        await preguntarAlAsistente('x');
        await esperarTerminada();
        const enlace = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid="burbuja-asistente"] button')).find((x) => limpio(x.textContent ?? '') === 'Armar un reporte');
        await clic(enlace ?? null, 'el enlace a la ayuda');
        const visor = await esperar(() => document.querySelector('[data-testid="visor-ayuda"]'), { que: 'el visor' });
        expect(limpio(visor.textContent ?? '')).toContain('Armar un reporte');
        expect(limpio(visor.textContent ?? '')).toContain('Para qué sirve');
        expect(boton('Abrir en Documentación')).not.toBeNull();
        expect(rutaActual()).toBe('/gestion');
        await clic(boton('Volver al chat'), 'Volver al chat');
        await esperar(() => !document.querySelector('[data-testid="visor-ayuda"]'), { que: 'el visor cerrado' });
        expect(ultimaBurbuja()).toContain('Mirá Armar un reporte');
    });

    it('un slug desconocido, un sitio externo y una imagen quedan como texto plano: nada clicable, nada que cargue de afuera', async () => {
        b = await armarIA();
        b.preguntar = () => respuestaNormal([texto]);
        await abrirPanel();
        await preguntarAlAsistente('x');
        await esperarTerminada();
        const burbuja = document.querySelector('[data-testid="burbuja-asistente"]')!;
        expect(burbuja.querySelectorAll('a').length).toBe(0);
        expect(burbuja.querySelectorAll('img').length).toBe(0);
        const clicables = Array.from(burbuja.querySelectorAll('button')).map((x) => limpio(x.textContent ?? '')).filter((t) => t !== '');
        expect(clicables).toEqual(['Armar un reporte']);
        expect(limpio(burbuja.textContent ?? '')).toContain('una que no existe');
        expect(limpio(burbuja.textContent ?? '')).toContain('un sitio');
    });

    it('«Abrir en Documentación» navega a la página y, con el panel fijo, no lo cierra', async () => {
        b = await armarIA({ ancho: 1600 });
        b.preguntar = () => respuestaNormal(['x'], { fuentes: [fuente()] });
        await abrirPanel();
        await preguntarAlAsistente('x');
        await esperarTerminada();
        await clic(Array.from(document.querySelectorAll('.MuiChip-root')).find((c) => /Ayuda · Armar un reporte/.test(c.textContent ?? '')) ?? null, 'la fuente');
        await esperar(() => document.querySelector('[data-testid="visor-ayuda"]'), { que: 'el visor desde la fuente' });
        await clic(boton('Abrir en Documentación'), 'Abrir en Documentación');
        await esperar(() => rutaActual() === '/ayuda/reportes/armar-un-reporte', { que: 'la navegación' });
        expect(panelAbierto()).toBe(true);
    });
});

describe('Lo que contesta el servidor antes de abrir el stream', () => {
    it('503 TOPE_MENSUAL: alerta amarilla con el mensaje, compositor deshabilitado, y lo que escribió no se pierde', async () => {
        b = await armarIA();
        const mensaje = 'El asistente llegó al tope de gasto de este mes y se pausó para todos. Vuelve el 1.º o cuando un administrador suba el tope.';
        b.preguntar = () => ({ status: 503, body: { codigo: 'TOPE_MENSUAL', mensaje } });
        await abrirPanel();
        await preguntarAlAsistente('Mi pregunta');
        await esperar(() => alertasDelPanel().includes(mensaje), { que: 'la alerta del tope' });
        expect(alertas(panel()!)[0].severidad).toBe('warning');
        expect(entrada()!.disabled).toBe(true);
        expect(entrada()!.value).toBe('Mi pregunta');
        expect(botonEnviar()!.disabled).toBe(true);
        expect(burbujas()).toEqual([]);
        expect(b.preguntas).toBe(1);
    });

    it('si el estado ya trae una pausa, el panel nace bloqueado sin necesidad de preguntar', async () => {
        b = await armarIA({ estado: estadoIA({ habilitado: false, pausa: { codigo: 'PAUSADO', mensaje: 'El asistente está pausado por un administrador.' } }) });
        await abrirPanel();
        await esperar(() => alertasDelPanel().includes('El asistente está pausado por un administrador.'), { que: 'la alerta de pausa' });
        expect(entrada()!.disabled).toBe(true);
        expect(sugerencias().length).toBeGreaterThan(0);
        expect(Array.from(document.querySelectorAll('[data-testid="sugerencias"] .MuiChip-root')).every((c) => c.classList.contains('Mui-disabled'))).toBe(true);
        expect(b.preguntas).toBe(0);
    });

    it('429 LIMITE_DIARIO: alerta informativa con el límite y compositor deshabilitado', async () => {
        b = await armarIA();
        b.preguntar = () => ({ status: 429, body: { codigo: 'LIMITE_DIARIO', usadas: 100, limite: 100 } });
        await abrirPanel();
        await preguntarAlAsistente('Una más');
        await esperar(() => alertasDelPanel().includes('Llegaste al límite de 100 preguntas de hoy. Mañana se renueva.'), { que: 'la alerta del límite' });
        expect(alertas(panel()!)[0].severidad).toBe('info');
        expect(entrada()!.disabled).toBe(true);
    });

    it('si el estado dice que ya se usaron todas las del día, el panel nace bloqueado', async () => {
        b = await armarIA({ estado: estadoIA({ limiteDiario: { usadas: 100, limite: 100 } }) });
        await abrirPanel();
        await esperar(() => alertasDelPanel().length === 1, { que: 'la alerta' });
        expect(alertasDelPanel()[0]).toBe('Llegaste al límite de 100 preguntas de hoy. Mañana se renueva.');
        expect(entrada()!.disabled).toBe(true);
    });

    it('409 TURNO_EN_CURSO: avisa que hay una pregunta en otra pestaña y se puede volver a intentar', async () => {
        b = await armarIA();
        b.preguntar = (_c, n) => (n === 1 ? { status: 409, body: { codigo: 'TURNO_EN_CURSO' } } : respuestaNormal(['Ahora sí.']));
        await abrirPanel();
        await preguntarAlAsistente('x');
        await esperar(() => alertasDelPanel().includes('Ya tenés una pregunta en curso en otra pestaña.'), { que: 'el aviso' });
        expect(entrada()!.disabled).toBe(false);
        expect(entrada()!.value).toBe('x');
        await clic(botonEnviar(), 'Enviar');
        await esperarTerminada();
        expect(ultimaBurbuja()).toBe('Ahora sí.');
        expect(alertasDelPanel()).toEqual([]);
    });

    it('409 CONVERSACION_LLENA: ofrece empezar una conversación nueva', async () => {
        b = await armarIA();
        b.preguntar = (_c, n) => (n === 1 ? respuestaNormal(['Primera.']) : { status: 409, body: { codigo: 'CONVERSACION_LLENA' } });
        await abrirPanel();
        await preguntarAlAsistente('uno');
        await esperarTerminada();
        await preguntarAlAsistente('dos');
        await esperar(() => alertasDelPanel().some((a) => a.includes('máximo de preguntas')), { que: 'el aviso' });
        await clic(boton('Nueva conversación'), 'Nueva conversación');
        await esperar(() => burbujas().length === 0, { que: 'la conversación vacía' });
        expect(alertasDelPanel()).toEqual([]);
    });
});

describe('Cuando algo falla a mitad de la respuesta', () => {
    it('`error` en el stream: la burbuja conserva el texto parcial, muestra el motivo y «Reintentar» vuelve a mandar la misma pregunta', async () => {
        b = await armarIA();
        b.preguntar = (_c, n) => (n === 1
            ? respuestaSse([ev.inicio(), ev.texto('Primero se entra a '), ev.error()], 30)
            : respuestaNormal(['Ahora salió completa.']));
        await abrirPanel();
        await preguntarAlAsistente('¿Cómo hago algo?');
        await esperar(() => botonPorNombre('x') === null && boton('Reintentar'), { que: 'Reintentar' });
        expect(ultimaBurbuja()).toContain('Primero se entra a');
        expect(ultimaBurbuja()).toContain('El asistente no está disponible en este momento. Probá en un rato.');
        expect(botonEnviar()).not.toBeNull();
        await clic(boton('Reintentar'), 'Reintentar');
        await esperar(() => b!.preguntas === 2, { que: 'la segunda pregunta' });
        await esperarTerminada();
        expect(b.cuerpos('POST', PREGUNTAR)[1].pregunta).toBe('¿Cómo hago algo?');
        expect(burbujas()).toEqual(['Ahora salió completa.']);
        expect(boton('Reintentar')).toBeNull();
    });

    it('un `error` de tope no ofrece reintentar y deja el asistente pausado', async () => {
        b = await armarIA();
        const mensaje = 'El asistente llegó al tope de gasto de este mes y se pausó para todos.';
        b.preguntar = () => respuestaSse([ev.inicio(), ev.texto('Parte'), ev.error({ codigo: 'TOPE_MENSUAL', mensaje })], 30);
        await abrirPanel();
        await preguntarAlAsistente('x');
        await esperar(() => entrada()!.disabled, { que: 'el compositor deshabilitado' });
        expect(ultimaBurbuja()).toContain('Parte');
        expect(boton('Reintentar')).toBeNull();
        expect(alertasDelPanel().filter((a) => a === mensaje).length).toBeGreaterThanOrEqual(1);
    });

    it('la red se corta a la mitad: texto parcial, «Se cortó la conexión con el servidor» y Reintentar', async () => {
        b = await armarIA();
        b.preguntar = () => respuestaSse([ev.inicio(), ev.texto('Se corta acá')], 30, { destruir: true });
        await abrirPanel();
        await preguntarAlAsistente('x');
        await esperar(() => boton('Reintentar'), { que: 'Reintentar tras el corte' });
        expect(ultimaBurbuja()).toContain('Se corta acá');
        expect(ultimaBurbuja()).toContain('Se cortó la conexión con el servidor');
    });

    it('sin conexión con el servidor: «No hay conexión con el servidor» y Reintentar', async () => {
        b = await armarIA();
        b.preguntar = () => ({ cortar: true });
        await abrirPanel();
        await preguntarAlAsistente('x');
        await esperar(() => boton('Reintentar'), { que: 'Reintentar' });
        expect(ultimaBurbuja()).toContain('No hay conexión con el servidor');
    });

    it('un stream que se cierra sin `fin` ni `error` no deja la burbuja escribiendo para siempre', async () => {
        b = await armarIA();
        b.preguntar = () => respuestaSse([ev.inicio(), ev.texto('Medio')], 20);
        await abrirPanel();
        await preguntarAlAsistente('x');
        await esperar(() => boton('Reintentar'), { que: 'Reintentar' });
        expect(botonDetener()).toBeNull();
        expect(ultimaBurbuja()).toContain('Medio');
    });
});

describe('Detener', () => {
    it('corta el fetch (el servidor ve la conexión cerrada), deja el texto parcial y vuelve «Enviar»', async () => {
        b = await armarIA();
        b.preguntar = () => respuestaSse([ev.inicio(), ev.texto('Voy por la mitad')], 20, { cerrar: false });
        await abrirPanel();
        await preguntarAlAsistente('x');
        await esperar(() => ultimaBurbuja().includes('Voy por la mitad'), { que: 'el texto parcial' });
        await clic(botonDetener(), 'Detener');
        await esperar(() => b!.srv.streamsCortadosPorElCliente === 1, { que: 'el corte visto desde el servidor' });
        await esperar(() => botonEnviar(), { que: 'Enviar de nuevo' });
        expect(ultimaBurbuja()).toContain('Voy por la mitad');
        expect(ultimaBurbuja()).toContain('Detuviste la respuesta.');
        expect(boton('Reintentar')).toBeNull();
        expect(alertasDelPanel()).toEqual([]);
        // Se puede seguir preguntando.
        b.preguntar = () => respuestaNormal(['Otra.']);
        await preguntarAlAsistente('y');
        await esperarTerminada();
        expect(ultimaBurbuja()).toBe('Otra.');
    });

    it('detenerlo antes de que llegue algo deja «Detuviste la respuesta.»', async () => {
        b = await armarIA();
        b.preguntar = () => ({ ...respuestaSse([], 0, { cerrar: false }) });
        await abrirPanel();
        await preguntarAlAsistente('x');
        await esperar(() => botonDetener(), { que: 'Detener' });
        await clic(botonDetener(), 'Detener');
        await esperar(() => b!.srv.streamsCortadosPorElCliente === 1, { que: 'el corte' });
        await esperar(() => ultimaBurbuja() === 'Detuviste la respuesta.', { que: 'el texto' });
    });

    it('cerrar el panel NO corta la respuesta: sigue y está completa al volver a abrirlo', async () => {
        b = await armarIA();
        b.preguntar = () => respuestaNormal(['Una respuesta ', 'que sigue ', 'sin el panel.'], {}, 150);
        await abrirPanel();
        await preguntarAlAsistente('x');
        await esperar(() => botonDetener(), { que: 'Detener' });
        await clic(document.querySelector('button[aria-label="Cerrar el asistente"]'), 'cerrar');
        await esperar(() => !panelAbierto(), { que: 'el panel cerrado' });
        await pasar(900);
        expect(b.srv.streamsCortadosPorElCliente).toBe(0);
        await abrirPanel();
        expect(ultimaBurbuja()).toBe('Una respuesta que sigue sin el panel.');
    });
});

describe('👍 y 👎', () => {
    const terminar = async () => {
        b = await armarIA();
        b.preguntar = () => respuestaNormal(['Así se hace.']);
        await abrirPanel();
        await preguntarAlAsistente('x');
        await esperarTerminada();
    };

    it('no hay votos mientras se escribe; después, 👍 manda valor 1 y repetirlo lo quita (0)', async () => {
        b = await armarIA();
        b.preguntar = () => respuestaSse([ev.inicio(), ev.texto('a'), ev.fin('a')], 200);
        await abrirPanel();
        await preguntarAlAsistente('x');
        await esperar(() => ultimaBurbuja() === 'a', { que: 'texto', cada: 10 });
        expect(botonPorNombre('Me sirvió')).toBeNull();
        await esperarTerminada();
        await clic(botonPorNombre('Me sirvió'), '👍');
        await esperar(() => b!.srv.cuantos('POST', CALIFICACION) === 1, { que: 'el voto' });
        expect(b.srv.de('POST', CALIFICACION)[0].ruta).toBe('/asistente/mensajes/102/calificacion');
        expect(b.cuerpos('POST', CALIFICACION)[0]).toEqual({ valor: 1 });
        expect(botonPorNombre('Me sirvió')!.getAttribute('aria-pressed')).toBe('true');
        await clic(botonPorNombre('Me sirvió'), '👍');
        await esperar(() => b!.srv.cuantos('POST', CALIFICACION) === 2, { que: 'el voto quitado' });
        expect(b.cuerpos('POST', CALIFICACION)[1]).toEqual({ valor: 0 });
        expect(botonPorNombre('Me sirvió')!.getAttribute('aria-pressed')).toBe('false');
    });

    it('👎 manda valor -1 y abre «¿Qué faltó?»; «Enviar» manda el comentario; repetir el 👎 lo quita', async () => {
        await terminar();
        await clic(botonPorNombre('No me sirvió'), '👎');
        await esperar(() => b!.srv.cuantos('POST', CALIFICACION) === 1, { que: 'el voto' });
        expect(b!.cuerpos('POST', CALIFICACION)[0]).toEqual({ valor: -1 });
        const campo = await esperar(() => Array.from(document.querySelectorAll('label')).find((l) => /¿Qué faltó\?/.test(l.textContent ?? '')), { que: 'el campo' });
        const area = document.getElementById(campo.getAttribute('for')!) as HTMLTextAreaElement;
        await escribirEn(area, 'Faltaba el paso de guardar');
        await clic(boton('Enviar'), 'Enviar el comentario');
        await esperar(() => b!.srv.cuantos('POST', CALIFICACION) === 2, { que: 'el comentario' });
        expect(b!.cuerpos('POST', CALIFICACION)[1]).toEqual({ valor: -1, comentario: 'Faltaba el paso de guardar' });
        expect(ultimaBurbuja()).toContain('Gracias por avisar.');
        await clic(botonPorNombre('No me sirvió'), '👎');
        await esperar(() => b!.srv.cuantos('POST', CALIFICACION) === 3, { que: 'el voto quitado' });
        expect(b!.cuerpos('POST', CALIFICACION)[2]).toEqual({ valor: 0 });
    });

    it('si el servidor rechaza el voto, vuelve a como estaba', async () => {
        await terminar();
        b!.srv.en('POST', CALIFICACION, () => ({ status: 404, body: { message: 'No existe' } }));
        await clic(botonPorNombre('Me sirvió'), '👍');
        await esperar(() => b!.srv.cuantos('POST', CALIFICACION) === 1, { que: 'el voto' });
        await esperar(() => botonPorNombre('Me sirvió')!.getAttribute('aria-pressed') === 'false', { que: 'el voto deshecho' });
    });
});

describe('Conversaciones anteriores y nueva conversación', () => {
    it('el menú lista las últimas, abre una (con sus fuentes y su voto) y «Nueva conversación» vacía el panel', async () => {
        b = await armarIA({
            conversaciones: [{ id: 41, titulo: '¿Cómo genero un cupón?', turnos: 1, updatedAt: '2026-10-14T15:00:00.000Z' }],
            detalles: [{
                id: 41, titulo: '¿Cómo genero un cupón?', turnos: 1, updatedAt: '2026-10-14T15:00:00.000Z',
                mensajes: [
                    { id: 1, rol: 'usuario', texto: '¿Cómo genero un cupón?', ruta: '/gestion', fuentes: [], acciones: [], estado: 'ok', calificacion: null, createdAt: '2026-10-14T15:00:00.000Z' },
                    { id: 2, rol: 'asistente', texto: 'Desde la ficha.', ruta: null, fuentes: [fuente('gestion/cupones-de-pago', 'Cupones de pago')], acciones: [accionIrA({ resultado: 'rechazada' })], estado: 'ok', calificacion: -1, createdAt: '2026-10-14T15:00:01.000Z' },
                ],
            }],
        });
        await abrirPanel();
        await clic(document.querySelector('button[aria-label="Más opciones"]'), 'el menú');
        const item = await esperar(() => Array.from(document.querySelectorAll('li[role="menuitem"]')).find((x) => /cupón/.test(x.textContent ?? '')), { que: 'la conversación en el menú' });
        await clic(item, 'la conversación');
        await esperar(() => burbujas().length === 1, { que: 'la conversación abierta' });
        expect(ultimaBurbuja()).toContain('Desde la ficha.');
        expect(chips()).toContain('Ayuda · Cupones de pago');
        expect(botonPorNombre('No me sirvió')!.getAttribute('aria-pressed')).toBe('true');
        expect(limpio(document.querySelector('[data-testid="tarjeta-ir-a"]')!.textContent ?? '')).toBe('Listo.');
        // Seguir esa conversación manda su id.
        await preguntarAlAsistente('¿Y cancelarlo?');
        await esperarTerminada();
        expect(b.cuerpos('POST', PREGUNTAR)[0].conversacionId).toBe(41);

        await clic(document.querySelector('button[aria-label="Más opciones"]'), 'el menú');
        await clic(Array.from(document.querySelectorAll('li[role="menuitem"]')).find((x) => /Nueva conversación/.test(x.textContent ?? '')) ?? null, 'Nueva conversación');
        await esperar(() => burbujas().length === 0, { que: 'el panel vacío' });
        await preguntarAlAsistente('otra cosa');
        await esperarTerminada();
        expect(b.cuerpos('POST', PREGUNTAR)[1].conversacionId).toBeUndefined();
    });
});

describe('Pie y permisos', () => {
    it('el pie dice que responde con la documentación y no hace cambios sin confirmar', async () => {
        b = await armarIA({ permisos: PERMISOS_IA });
        await abrirPanel();
        expect(limpio(panel()!.textContent ?? '')).toContain('Responde con la documentación de la plataforma y nunca hace cambios sin que confirmes.');
    });
});

async function escribirEn(area: HTMLTextAreaElement, valor: string) {
    const { act } = await import('react');
    await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!.call(area, valor);
        area.dispatchEvent(new Event('input', { bubbles: true }));
    });
}
