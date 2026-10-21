// Asistente de IA, Fase A: la pantalla de consumo y su lugar en el menú (docs/asistente-spec.md §12.3 y §16.2).
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { alertas, boton, clic, esperar, limpio, pasar, toasts } from '../lib/montar';
import {
    DETALLE_MENSAJE, PATCH_CONFIG, PATCH_FUNCION, PERMISOS_ADMIN_DETALLE_IA, PERMISOS_ADMIN_IA, TIEMPOS_CONSUMO, armarIA, bajarIA, configIA,
    consumoIA, rutaActual, tiemposIA, type BancoIA,
} from '../lib/banco-ia';

let b: BancoIA | null = null;
afterEach(async () => { await bajarIA(b); b = null; });

const menu = () => limpio(document.querySelector('nav, .MuiDrawer-docked')?.textContent ?? '');
const pagina = () => limpio(document.querySelector('main')?.textContent ?? '');
/** El control de un campo, a partir del texto de su etiqueta. */
function campo(etiqueta: RegExp): HTMLInputElement {
    const l = Array.from(document.querySelectorAll('label')).find((x) => etiqueta.test(x.textContent ?? ''));
    const el = l ? document.getElementById(l.getAttribute('for') ?? '') : null;
    if (!el) throw new Error(`No hay un campo «${etiqueta}»`);
    return el as HTMLInputElement;
}
async function escribirCampo(el: HTMLInputElement, valor: string) {
    await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(el, valor);
        el.dispatchEvent(new Event('input', { bubbles: true }));
    });
}
const cargada = (que = '/Gasto del mes/') => esperar(() => /Gasto del mes/.test(pagina()), { que: `la pantalla (${que})` });
const barra = () => document.querySelector('[role="progressbar"][aria-label="Gasto del mes sobre el tope"]');

describe('El menú', () => {
    it('«Consumo de amaIA» está en Administración solo con asistente.administrar', async () => {
        b = await armarIA({ permisos: [...PERMISOS_ADMIN_IA, 'auditoria.ver'] });
        await clic(boton(/^Administración$/) ?? Array.from(document.querySelectorAll('[role="button"], button')).find((x) => limpio(x.textContent ?? '') === 'Administración') ?? null, 'Administración');
        await esperar(() => /Consumo de amaIA/.test(menu()), { que: 'el ítem del menú' });
        await bajarIA(b);

        b = await armarIA({ permisos: ['asistente.usar', 'auditoria.ver'] });
        await clic(Array.from(document.querySelectorAll('[role="button"], button')).find((x) => limpio(x.textContent ?? '') === 'Administración') ?? null, 'Administración');
        await esperar(() => /Auditoría/.test(menu()), { que: 'Administración abierto' });
        expect(menu()).not.toContain('Consumo de amaIA');
    });

    it('con solo asistente.administrar el grupo Administración aparece (antes quedaba escondido) y el ítem lleva a la pantalla', async () => {
        b = await armarIA({ permisos: ['asistente.administrar'] });
        await clic(Array.from(document.querySelectorAll('[role="button"], button')).find((x) => limpio(x.textContent ?? '') === 'Administración') ?? null, 'Administración');
        const item = await esperar(() => Array.from(document.querySelectorAll('[role="button"], button')).find((x) => limpio(x.textContent ?? '') === 'Consumo de amaIA'), { que: 'el ítem' });
        await clic(item, 'Consumo de amaIA');
        await esperar(() => rutaActual() === '/asistente/consumo', { que: 'la ruta' });
        await cargada();
    });

    it('sin el permiso, entrar a la ruta a mano muestra que no hay permiso y no le pide nada al servidor', async () => {
        b = await armarIA({ permisos: ['asistente.usar'], ruta: '/asistente/consumo' });
        await esperar(() => /No tenés permiso para ver el consumo de amaIA/.test(pagina()), { que: 'el aviso' });
        expect(b.srv.cuantos('GET', /^\/asistente\/(consumo|config)/)).toBe(0);
    });
});

describe('Indicadores y tablas', () => {
    it('muestran los números del servidor', async () => {
        b = await armarIA({ permisos: PERMISOS_ADMIN_IA, ruta: '/asistente/consumo' });
        await cargada();
        const t = pagina();
        expect(t).toContain('US$ 42,00 de US$ 100,00');
        expect(t).toContain('42 % del tope');
        expect(t).toContain('US$ 91,50');                 // proyección
        expect(t).toContain('1.234');                      // preguntas
        expect(t).toContain('12 personas · 1.900 llamadas al modelo');
        expect(t).toContain('US$ 0,0034');                 // costo por pregunta
        expect(t).toContain('75 %');                       // 30 de 40 votos a favor
        expect(t).toContain('30 a favor · 10 en contra · 1.194 sin calificar');
        expect(t).toContain('87 %');                       // tasa de caché
        expect(t).toContain('Maxi Di Flumeri');
        expect(t).toContain('Ana Pérez');
        expect(t).toContain('Ayuda y navegación');
        expect(barra()!.getAttribute('aria-valuenow')).toBe('42');
        expect(b.srv.cuantos('GET', /^\/asistente\/consumo$/)).toBe(1);
        // Cada cosa se pide una sola vez: un pedido repetido sin parar (efecto con una dependencia inestable) pisaría lo que se está editando.
        await pasar(400);
        expect(b.srv.cuantos('GET', /^\/asistente\/config$/)).toBe(1);
        expect(b.srv.cuantos('GET', /^\/asistente\/consumo$/)).toBe(1);
    });

    it('la barra del gasto se pone amarilla desde el porcentaje de aviso y roja al llegar al tope', async () => {
        b = await armarIA({ permisos: PERMISOS_ADMIN_IA, ruta: '/asistente/consumo', consumo: consumoIA({ gastoUsd: 85 }) });
        await cargada();
        expect(barra()!.className).toContain('MuiLinearProgress-colorWarning');
        await bajarIA(b);
        b = await armarIA({ permisos: PERMISOS_ADMIN_IA, ruta: '/asistente/consumo', consumo: consumoIA({ gastoUsd: 100 }) });
        await cargada();
        expect(barra()!.className).toContain('MuiLinearProgress-colorError');
        await bajarIA(b);
        b = await armarIA({ permisos: PERMISOS_ADMIN_IA, ruta: '/asistente/consumo', consumo: consumoIA({ gastoUsd: 10 }) });
        await cargada();
        expect(barra()!.className).toContain('MuiLinearProgress-colorPrimary');
    });

    it('la lista de 👎 muestra pregunta, respuesta, comentario y fuentes, y el contador de lo que no está en la documentación', async () => {
        b = await armarIA({ permisos: PERMISOS_ADMIN_IA, ruta: '/asistente/consumo' });
        await cargada();
        const t = pagina();
        expect(t).toContain('Respuestas con 👎');
        expect(t).toContain('¿Cómo anulo un cupón?');
        expect(t).toContain('Eso no está en la documentación.');
        expect(t).toContain('Qué faltó: Falta explicar cómo se anula');
        expect(t).toContain('Cupones de pago');
        expect(t).toContain('No está en la documentación: 7');
    });

    it('un mes sin movimiento no rompe nada', async () => {
        b = await armarIA({
            permisos: PERMISOS_ADMIN_IA, ruta: '/asistente/consumo',
            consumo: consumoIA({ gastoUsd: 0, proyeccionUsd: 0, totales: { preguntas: 0, llamadas: 0, usuarios: 0, costoPorPregunta: 0, tasaCache: 0 }, porUsuario: [], porDia: [], negativasRecientes: [], calidad: { positivas: 0, negativas: 0, sinCalificar: 0, sinDocumentar: 0 } }),
        });
        await cargada();
        expect(pagina()).toContain('Sin votos');
        expect(pagina()).toContain('Todavía no hay preguntas este mes.');
        expect(pagina()).toContain('Nadie usó amaIA este mes.');
        expect(pagina()).toContain('Ninguna respuesta con 👎 en octubre de 2026.');
    });

    it('cambiar el mes vuelve a pedir el consumo de ese mes', async () => {
        b = await armarIA({ permisos: PERMISOS_ADMIN_IA, ruta: '/asistente/consumo' });
        await cargada();
        await escribirCampo(campo(/^Mes$/), '2026-09');
        await esperar(() => b!.srv.de('GET', /^\/asistente\/consumo/).some((p) => p.ruta.includes('mes=2026-09')), { que: 'el pedido del otro mes' });
    });

    it('un error al pedir el consumo se ve y se puede reintentar', async () => {
        b = await armarIA({ permisos: PERMISOS_ADMIN_IA, ruta: '/asistente/consumo' });
        await cargada();
        b.srv.en('GET', /^\/asistente\/consumo$/, () => ({ status: 400, body: { message: 'Mes inválido' } }));
        await escribirCampo(campo(/^Mes$/), '2026-08');
        await esperar(() => alertas().some((a) => a.texto.includes('Mes inválido')), { que: 'el error' });
        expect(boton('Reintentar')).not.toBeNull();
    });
});

describe('Respuestas con 👎 y errores', () => {
    it('la respuesta se dibuja como markdown, sin los asteriscos crudos', async () => {
        b = await armarIA({
            permisos: PERMISOS_ADMIN_IA, ruta: '/asistente/consumo',
            consumo: consumoIA({ negativasRecientes: [{ mensajeId: 56, fecha: '2026-10-15T15:00:00.000Z', usuario: 'Ana Pérez', pregunta: '¿Cómo?', respuesta: 'Entrá a **Gestión** y:\n\n- tocá uno\n- tocá dos', comentario: null, fuentes: [] }] }),
        });
        await cargada();
        const caja = await esperar(() => document.querySelector('[data-testid="respuesta-negativa"]'), { que: 'la respuesta' });
        expect(caja.querySelector('strong')?.textContent).toBe('Gestión');
        expect(caja.querySelectorAll('li').length).toBe(2);
        expect(caja.textContent).not.toContain('**');
    });

    it('el aviso de «ninguna respuesta con 👎» dice el mes elegido', async () => {
        b = await armarIA({ permisos: PERMISOS_ADMIN_IA, ruta: '/asistente/consumo' });
        await cargada();
        b.consumo = consumoIA({ mes: '2026-08', negativasRecientes: [] });
        await escribirCampo(campo(/^Mes$/), '2026-08');
        await esperar(() => pagina().includes('Ninguna respuesta con 👎 en agosto de 2026.'), { que: 'el aviso del mes' });
    });

    it('un 500 no muestra «Internal server error»: texto en castellano; con mensaje del backend, ese', async () => {
        b = await armarIA({ permisos: PERMISOS_ADMIN_IA, ruta: '/asistente/consumo' });
        await cargada();
        b.srv.en('GET', /^\/asistente\/consumo$/, () => ({ status: 500, body: { statusCode: 500, message: 'Internal server error' } }));
        await escribirCampo(campo(/^Mes$/), '2026-08');
        await esperar(() => alertas().some((a) => a.severidad === 'error' && a.texto.includes('No se pudo cargar el consumo de amaIA. Probá de nuevo en un rato.')), { que: 'el error en castellano' });
        expect(alertas().some((a) => /Internal server error/i.test(a.texto))).toBe(false);

        b.srv.en('GET', /^\/asistente\/consumo$/, () => ({ status: 500, body: { statusCode: 500, mensaje: 'La base no responde.' } }));
        await clic(boton('Reintentar'), 'Reintentar');
        await esperar(() => alertas().some((a) => a.texto.includes('La base no responde.')), { que: 'el mensaje del backend' });
    });
});

describe('Alertas', () => {
    it('una pausa del servidor y «nadie tiene el permiso» se avisan', async () => {
        b = await armarIA({
            permisos: PERMISOS_ADMIN_IA, ruta: '/asistente/consumo',
            consumo: consumoIA({ pausa: { codigo: 'TOPE_MENSUAL', mensaje: 'amaIA llegó al tope de gasto de este mes y se pausó para todos.' } }),
            config: configIA({ sinAdministradores: true }),
        });
        await cargada();
        await esperar(() => alertas().length === 2, { que: 'las dos alertas' });
        const textos = alertas().map((a) => a.texto);
        expect(textos).toContain('amaIA llegó al tope de gasto de este mes y se pausó para todos.');
        expect(textos).toContain('Nadie tiene el permiso Administrar amaIA: los avisos de consumo no le llegan a nadie.');
        expect(alertas().every((a) => a.severidad === 'warning')).toBe(true);
    });

    it('sin pausa ni problema de permisos no hay alertas', async () => {
        b = await armarIA({ permisos: PERMISOS_ADMIN_IA, ruta: '/asistente/consumo' });
        await cargada();
        await pasar(200);
        expect(alertas()).toEqual([]);
    });
});

describe('Configuración', () => {
    it('Guardar manda solo lo que cambió, con un aviso de éxito, y vuelve a pedir el consumo', async () => {
        b = await armarIA({ permisos: PERMISOS_ADMIN_IA, ruta: '/asistente/consumo' });
        await cargada();
        await esperar(() => Array.from(document.querySelectorAll('label')).some((l) => /Tope mensual$/.test(limpio(l.textContent ?? ''))), { que: 'el formulario' });
        const guardar = () => boton('Guardar');
        expect(guardar()!.disabled).toBe(true);
        await escribirCampo(campo(/^Tope mensual$/), '150');
        expect(guardar()!.disabled).toBe(false);
        const antes = b.srv.cuantos('GET', /^\/asistente\/consumo$/);
        await clic(guardar(), 'Guardar');
        await esperar(() => b!.srv.cuantos('PATCH', PATCH_CONFIG) === 1, { que: 'el PATCH' });
        expect(b.cuerpos('PATCH', PATCH_CONFIG)[0]).toEqual({ topeMensualUsd: 150 });
        await esperar(() => toasts().some((x) => x.variante === 'success' && /Configuración de amaIA guardada/.test(x.texto)), { que: 'el aviso de éxito' });
        await esperar(() => b!.srv.cuantos('GET', /^\/asistente\/consumo$/) > antes, { que: 'el consumo actualizado' });
        expect(guardar()!.disabled).toBe(true);
    });

    it('el interruptor general y el resto de los campos viajan juntos', async () => {
        b = await armarIA({ permisos: PERMISOS_ADMIN_IA, ruta: '/asistente/consumo' });
        await cargada();
        await esperar(() => document.querySelector('input[type="checkbox"][class*="MuiSwitch"]'), { que: 'los interruptores' });
        const general = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find((i) => /activa para todos/.test(limpio(i.closest('label')?.textContent ?? '')));
        expect(general).toBeTruthy();
        await clic(general!, 'el interruptor general');
        await escribirCampo(campo(/Avisar al llegar a/), '90');
        await escribirCampo(campo(/Preguntas por persona por día/), '50');
        await escribirCampo(campo(/Tope por pregunta/), '0,1');
        await clic(boton('Guardar'), 'Guardar');
        await esperar(() => b!.srv.cuantos('PATCH', PATCH_CONFIG) === 1, { que: 'el PATCH' });
        expect(b.cuerpos('PATCH', PATCH_CONFIG)[0]).toEqual({ habilitado: false, avisoPorcentaje: 90, limiteDiarioUsuario: 50, topeTurnoUsd: 0.1 });
    });

    it('un valor fuera de rango se marca y no deja guardar', async () => {
        b = await armarIA({ permisos: PERMISOS_ADMIN_IA, ruta: '/asistente/consumo' });
        await cargada();
        await esperar(() => Array.from(document.querySelectorAll('label')).some((l) => /Tope mensual$/.test(limpio(l.textContent ?? ''))), { que: 'el formulario' });
        await escribirCampo(campo(/Avisar al llegar a/), '100');
        expect(pagina()).toContain('Un entero entre 10 y 99');
        expect(boton('Guardar')!.disabled).toBe(true);
        await escribirCampo(campo(/Avisar al llegar a/), '80');
        await escribirCampo(campo(/^Tope mensual$/), '');
        expect(boton('Guardar')!.disabled).toBe(true);
        expect(b.srv.cuantos('PATCH', PATCH_CONFIG)).toBe(0);
    });

    it('el tope mensual admite 2 decimales y el tope por pregunta 4: con más, Guardar queda deshabilitado y el campo lo explica', async () => {
        b = await armarIA({ permisos: PERMISOS_ADMIN_IA, ruta: '/asistente/consumo' });
        await cargada();
        await esperar(() => Array.from(document.querySelectorAll('label')).some((l) => /Tope mensual$/.test(limpio(l.textContent ?? ''))), { que: 'el formulario' });
        await escribirCampo(campo(/^Tope mensual$/), '100,555');
        expect(boton('Guardar')!.disabled).toBe(true);
        expect(pagina()).toContain('Hasta 2 decimales');
        await escribirCampo(campo(/^Tope mensual$/), '100,55');
        expect(boton('Guardar')!.disabled).toBe(false);
        expect(pagina()).not.toContain('Hasta 2 decimales');
        await escribirCampo(campo(/^Tope por pregunta$/), '0,05555');
        expect(boton('Guardar')!.disabled).toBe(true);
        expect(pagina()).toContain('Hasta 4 decimales');
        await escribirCampo(campo(/^Tope por pregunta$/), '0,0555');
        expect(boton('Guardar')!.disabled).toBe(false);
        expect(b.srv.cuantos('PATCH', PATCH_CONFIG)).toBe(0);
    });

    it('los precios del modelo en uso se editan y se mandan completos dentro de «precios»', async () => {
        b = await armarIA({ permisos: PERMISOS_ADMIN_IA, ruta: '/asistente/consumo' });
        await cargada();
        const entrada = await esperar(() => document.querySelector<HTMLInputElement>('input[aria-label="Normal: Entrada"]'), { que: 'la tabla de precios' });
        expect(entrada.value).toBe('0.11');
        expect(pagina()).toContain('us.anthropic.claude-haiku-5-5');
        await escribirCampo(entrada, '0,12');
        await clic(boton('Guardar'), 'Guardar');
        await esperar(() => b!.srv.cuantos('PATCH', PATCH_CONFIG) === 1, { que: 'el PATCH' });
        const enviado = b.cuerpos('PATCH', PATCH_CONFIG)[0] as { precios: Record<string, { entrada: number; umbralLargo: number; largo: { salida: number } }> };
        expect(Object.keys(enviado)).toEqual(['precios']);
        expect(enviado.precios['us.anthropic.claude-haiku-5-5'].entrada).toBe(0.12);
        expect(enviado.precios['us.anthropic.claude-haiku-5-5'].umbralLargo).toBe(100000);
        expect(enviado.precios['us.anthropic.claude-haiku-5-5'].largo.salida).toBe(2.75);
    });

    it('si el servidor rechaza el guardado, avisa y deja el botón para volver a intentar', async () => {
        b = await armarIA({ permisos: PERMISOS_ADMIN_IA, ruta: '/asistente/consumo' });
        await cargada();
        await esperar(() => Array.from(document.querySelectorAll('label')).some((l) => /Tope mensual$/.test(limpio(l.textContent ?? ''))), { que: 'el formulario' });
        b.srv.en('PATCH', PATCH_CONFIG, () => ({ status: 400, body: { message: 'topeMensualUsd debe ser menor o igual a 10000' } }));
        await escribirCampo(campo(/^Tope mensual$/), '5000');
        await clic(boton('Guardar'), 'Guardar');
        await esperar(() => toasts().some((x) => x.variante === 'error' && /10000/.test(x.texto)), { que: 'el aviso de error' });
        await esperar(() => boton('Guardar') && !boton('Guardar')!.disabled, { que: 'Guardar habilitado otra vez' });
    });
});

describe('Por función', () => {
    it('el interruptor y el tope de cada función se guardan por separado', async () => {
        b = await armarIA({ permisos: PERMISOS_ADMIN_IA, ruta: '/asistente/consumo' });
        await cargada();
        const sw = await esperar(() => { const i = document.querySelector<HTMLInputElement>('input[aria-label="Activar «Ayuda y navegación»"]'); return i && !i.disabled ? i : null; }, { que: 'el interruptor de la función' });
        await clic(sw, 'el interruptor');
        await esperar(() => b!.srv.cuantos('PATCH', PATCH_FUNCION) === 1, { que: 'el PATCH de la función' });
        expect(b.srv.de('PATCH', PATCH_FUNCION)[0].ruta).toBe('/asistente/funciones/ayuda');
        expect(b.cuerpos('PATCH', PATCH_FUNCION)[0]).toEqual({ habilitada: false });

        const tope = document.querySelector<HTMLInputElement>('input[aria-label="Tope mensual de «Ayuda y navegación» en USD"]')!;
        const guardarTope = () => document.querySelector<HTMLButtonElement>('button[aria-label="Guardar el tope de «Ayuda y navegación»"]')!;
        expect(guardarTope().disabled).toBe(true);
        await escribirCampo(tope, '20');
        await clic(guardarTope(), 'guardar el tope');
        await esperar(() => b!.srv.cuantos('PATCH', PATCH_FUNCION) === 2, { que: 'el tope' });
        expect(b.cuerpos('PATCH', PATCH_FUNCION)[1]).toEqual({ topeMensualUsd: 20 });
        // Vaciarlo es «sin tope propio».
        await esperar(() => document.querySelector<HTMLInputElement>('input[aria-label="Tope mensual de «Ayuda y navegación» en USD"]')!.value === '20', { que: 'el tope guardado' });
        await escribirCampo(document.querySelector<HTMLInputElement>('input[aria-label="Tope mensual de «Ayuda y navegación» en USD"]')!, '');
        await clic(guardarTope(), 'guardar sin tope');
        await esperar(() => b!.srv.cuantos('PATCH', PATCH_FUNCION) === 3, { que: 'sin tope' });
        expect(b.cuerpos('PATCH', PATCH_FUNCION)[2]).toEqual({ topeMensualUsd: null });
    });

    const FUNCIONES = [
        { clave: 'ayuda', nombre: 'Ayuda y navegación', habilitada: true, topeMensualUsd: null, modelo: 'us.anthropic.claude-haiku-5-5', topeTurnoUsd: null, limiteDiarioUsuario: null },
        { clave: 'reportes', nombre: 'Constructor de reportes', habilitada: true, topeMensualUsd: 30, modelo: 'us.anthropic.claude-sonnet-5-5', topeTurnoUsd: 0.3, limiteDiarioUsuario: 40 },
    ];
    const conReportes = () => ({
        config: configIA({ funciones: FUNCIONES }),
        consumo: consumoIA({
            porFuncion: [
                { funcion: 'ayuda', nombre: 'Ayuda y navegación', gastoUsd: 12, preguntas: 1200, topeUsd: null },
                { funcion: 'reportes', nombre: 'Constructor de reportes', gastoUsd: 6.4, preguntas: 48, topeUsd: 30, plantillas: { mostradas: 40, abiertas: 30, guardadas: 20, guardadasSinCambios: 15, costoPorGuardada: 0.32 } },
            ],
        }),
    });

    it('cada función muestra su modelo y su tope por pregunta y su límite diario por persona, editables por separado', async () => {
        b = await armarIA({ permisos: PERMISOS_ADMIN_IA, ruta: '/asistente/consumo', ...conReportes() });
        await cargada();
        const fila = await esperar(() => Array.from(document.querySelectorAll('tr')).find((r) => /Constructor de reportes/.test(r.textContent ?? '') && r.querySelector('input')), { que: 'la fila de reportes' });
        expect(limpio(fila.textContent ?? '')).toContain('us.anthropic.claude-sonnet-5-5');
        const turno = () => document.querySelector<HTMLInputElement>('input[aria-label="Tope por pregunta de «Constructor de reportes» en USD"]')!;
        const dia = () => document.querySelector<HTMLInputElement>('input[aria-label="Límite diario por persona de «Constructor de reportes»"]')!;
        const guardarTurno = () => document.querySelector<HTMLButtonElement>('button[aria-label="Guardar el tope por pregunta de «Constructor de reportes»"]')!;
        const guardarDia = () => document.querySelector<HTMLButtonElement>('button[aria-label="Guardar el límite diario de «Constructor de reportes»"]')!;
        expect(turno().value).toBe('0.3');
        expect(dia().value).toBe('40');
        expect(guardarTurno().disabled).toBe(true);
        expect(guardarDia().disabled).toBe(true);

        await escribirCampo(turno(), '0,25');
        await clic(guardarTurno(), 'guardar el tope por pregunta');
        await esperar(() => b!.srv.cuantos('PATCH', PATCH_FUNCION) === 1, { que: 'el PATCH del tope por pregunta' });
        expect(b.srv.de('PATCH', PATCH_FUNCION)[0].ruta).toBe('/asistente/funciones/reportes');
        expect(b.cuerpos('PATCH', PATCH_FUNCION)[0]).toEqual({ topeTurnoUsd: 0.25 });

        await esperar(() => dia().value === '40' && guardarDia().disabled, { que: 'el campo del límite quieto' });
        await escribirCampo(dia(), '60');
        await clic(guardarDia(), 'guardar el límite diario');
        await esperar(() => b!.srv.cuantos('PATCH', PATCH_FUNCION) === 2, { que: 'el PATCH del límite' });
        expect(b.cuerpos('PATCH', PATCH_FUNCION)[1]).toEqual({ limiteDiarioUsuario: 60 });
    });

    it('un límite diario que no es entero, o negativo, no se puede guardar; vaciarlo es «sin límite propio»', async () => {
        b = await armarIA({ permisos: PERMISOS_ADMIN_IA, ruta: '/asistente/consumo', ...conReportes() });
        await cargada();
        const dia = await esperar(() => document.querySelector<HTMLInputElement>('input[aria-label="Límite diario por persona de «Constructor de reportes»"]'), { que: 'el campo' });
        const guardar = () => document.querySelector<HTMLButtonElement>('button[aria-label="Guardar el límite diario de «Constructor de reportes»"]')!;
        await escribirCampo(dia, '2,5');
        expect(guardar().disabled).toBe(true);
        await escribirCampo(dia, '-3');
        expect(guardar().disabled).toBe(true);
        await escribirCampo(dia, '');
        expect(guardar().disabled).toBe(false);
        await clic(guardar(), 'guardar sin límite');
        await esperar(() => b!.srv.cuantos('PATCH', PATCH_FUNCION) === 1, { que: 'el PATCH' });
        expect(b.cuerpos('PATCH', PATCH_FUNCION)[0]).toEqual({ limiteDiarioUsuario: null });
    });

    it('muestra las métricas de las plantillas: mostradas, abiertas, guardadas, % sin cambios y costo por guardada', async () => {
        b = await armarIA({ permisos: PERMISOS_ADMIN_IA, ruta: '/asistente/consumo', ...conReportes() });
        await cargada();
        const tabla = await esperar(() => document.querySelector('table[aria-label="Plantillas armadas con amaIA"]'), { que: 'la tabla de plantillas' });
        const fila = limpio(tabla.querySelector('tbody tr')!.textContent ?? '');
        expect(fila).toContain('Constructor de reportes');
        expect(fila).toContain('40');             // mostradas
        expect(fila).toContain('30 (75 %)');      // abiertas
        expect(fila).toContain('20 (50 %)');      // guardadas
        expect(fila).toContain('75 %');           // 15 de 20 guardadas sin cambios
        expect(fila).toContain('US$ 0,3200');
    });

    it('sin plantillas guardadas, el % y el costo por guardada son un guion; sin métricas de plantillas no hay tabla', async () => {
        const base = conReportes();
        base.consumo.porFuncion[1].plantillas = { mostradas: 3, abiertas: 1, guardadas: 0, guardadasSinCambios: 0, costoPorGuardada: null };
        b = await armarIA({ permisos: PERMISOS_ADMIN_IA, ruta: '/asistente/consumo', ...base });
        await cargada();
        const tabla = await esperar(() => document.querySelector('table[aria-label="Plantillas armadas con amaIA"]'), { que: 'la tabla' });
        const celdas = Array.from(tabla.querySelectorAll('tbody tr td')).map((c) => limpio(c.textContent ?? ''));
        expect(celdas.slice(-2)).toEqual(['—', '—']);
        await bajarIA(b);
        b = await armarIA({ permisos: PERMISOS_ADMIN_IA, ruta: '/asistente/consumo' });
        await cargada();
        expect(document.querySelector('table[aria-label="Plantillas armadas con amaIA"]')).toBeNull();
    });
});


describe('Tiempos por paso (docs/asistente-detalle-spec.md §12.4)', () => {
    const tarjetaDeTiempos = () => Array.from(document.querySelectorAll('.MuiCard-root')).find((c) => /Tiempos por paso/.test(c.textContent ?? ''));
    const tiempos = () => limpio(tarjetaDeTiempos()?.textContent ?? '');
    /** Las filas de las tablas, con las celdas separadas por un espacio. */
    const filasDeTiempos = () => Array.from(tarjetaDeTiempos()?.querySelectorAll('tbody tr') ?? []).map((tr) => limpio(Array.from(tr.querySelectorAll('td')).map((td) => td.textContent ?? '').join(' ')));

    it('muestra una tabla por función con la mediana y el p95 de cada paso, y el mes que se pidió', async () => {
        b = await armarIA({ permisos: PERMISOS_ADMIN_IA, ruta: '/asistente/consumo' });
        await cargada();
        await esperar(() => /Total en el servidor/.test(tiempos()), { que: 'la tabla de tiempos' });
        const t = tiempos();
        expect(t).toContain('Mediana y p95 de cada paso, por función. Salen del detalle de las respuestas, que se borra a los 90 días con su conversación.');
        expect(t).toContain('Ayuda y navegación');
        expect(t).toContain('Armar reportes');
        expect(filasDeTiempos()).toEqual([
            'Total en el servidor 200 4,1 s 9,8 s',
            'Total en el navegador (de todos) 190 4,3 s 10,2 s',
            'Espera del primer token 260 0,9 s 2,4 s',
            'Herramienta leer_pagina 120 < 0,1 s 0,1 s',
            'Guardar 200 0,1 s 0,3 s',
            'Total en el servidor 40 18,3 s 61,0 s',
            'Herramienta probar_plantilla 55 4,8 s 15,1 s',
        ]);
        for (const tabla of Array.from(document.querySelectorAll('table[aria-label^="Tiempos por paso de"]'))) {
            expect(tabla.closest('.MuiTableContainer-root')).not.toBeNull();
            expect(Array.from(tabla.querySelectorAll('th')).map((h) => limpio(h.textContent ?? ''))).toEqual(['Paso', 'Veces', 'Mediana', 'p95']);
        }
        expect(b.srv.de('GET', TIEMPOS_CONSUMO).map((p) => p.ruta)).toEqual(['/asistente/consumo/tiempos?mes=2026-10']);
        // No se vuelve a pedir solo ni cuando cambia otra cosa de la pantalla.
        await pasar(400);
        expect(b.srv.cuantos('GET', TIEMPOS_CONSUMO)).toBe(1);
    });

    it('al cambiar de mes pide los tiempos de ese mes', async () => {
        b = await armarIA({ permisos: PERMISOS_ADMIN_IA, ruta: '/asistente/consumo' });
        await cargada();
        await esperar(() => /Total en el servidor/.test(tiempos()), { que: 'la tabla de tiempos' });
        b.consumo = consumoIA({ mes: '2026-09' });
        await escribirCampo(campo(/^Mes$/), '2026-09');
        await esperar(() => b!.srv.de('GET', TIEMPOS_CONSUMO).some((p) => p.ruta.endsWith('mes=2026-09')), { que: 'los tiempos de septiembre' });
    });

    it('si falla no rompe el resto de la pantalla: queda un aviso con «Reintentar» dentro de la tarjeta', async () => {
        b = await armarIA({ permisos: PERMISOS_ADMIN_IA, ruta: '/asistente/consumo', antes: (x) => { x.tiemposConsumo = () => ({ status: 500, body: { message: 'Internal server error' } }); } });
        await cargada();
        const tarjeta = () => tarjetaDeTiempos()!;
        await esperar(() => tarjeta().querySelector('.MuiAlert-root'), { que: 'el aviso de error' });
        expect(limpio(tarjeta().querySelector('.MuiAlert-message')!.textContent ?? '')).toBe('No se pudieron cargar los tiempos de amaIA. Probá de nuevo en un rato.');
        expect(pagina()).toContain('Gasto del mes');
        expect(pagina()).toContain('Por función');
        expect(alertas().filter((a) => a.severidad === 'error')).toHaveLength(1);

        b.tiemposConsumo = () => ({ body: tiemposIA() });
        await clic(boton('Reintentar', tarjeta()), 'Reintentar');
        await esperar(() => /Total en el servidor/.test(tiempos()), { que: 'la tabla después de reintentar' });
        expect(tarjeta().querySelector('.MuiAlert-root')).toBeNull();
    });

    it('sin respuestas medidas dice el mes; con más de 5.000 avisa que son las últimas', async () => {
        b = await armarIA({ permisos: PERMISOS_ADMIN_IA, ruta: '/asistente/consumo', antes: (x) => { x.tiemposConsumo = () => ({ body: tiemposIA({ respuestas: 0, porFuncion: [] }) }); } });
        await cargada();
        await esperar(() => /Todavía no hay respuestas medidas/.test(tiempos()), { que: 'el texto de vacío' });
        expect(tiempos()).toContain('Todavía no hay respuestas medidas en octubre de 2026.');
        await bajarIA(b);

        b = await armarIA({ permisos: PERMISOS_ADMIN_IA, ruta: '/asistente/consumo', antes: (x) => { x.tiemposConsumo = () => ({ body: tiemposIA({ recortado: true }) }); } });
        await cargada();
        await esperar(() => /Sobre las últimas 5\.000 respuestas del mes\./.test(tiempos()), { que: 'el aviso de recorte' });
    });
});

describe('Ver detalle en las respuestas con 👎 (D-2)', () => {
    const botonVerDetalle = () => boton(/^Ver detalle$/);

    it('con los dos permisos pide «GET mensajes/55/detalle» y muestra el detalle abierto, aunque el interruptor del panel esté apagado', async () => {
        localStorage.setItem('amsa_asistente_detalle', '0');
        b = await armarIA({ permisos: PERMISOS_ADMIN_DETALLE_IA, ruta: '/asistente/consumo' });
        await cargada();
        expect(b.srv.cuantos('GET', DETALLE_MENSAJE)).toBe(0);
        await clic(botonVerDetalle(), 'Ver detalle');
        await esperar(() => /Total 18,3 s · USD 0,027 · Sonnet 5\.5 · terminó bien/.test(pagina()), { que: 'el detalle abierto' });
        expect(b.srv.de('GET', DETALLE_MENSAJE).map((p) => p.ruta)).toEqual(['/asistente/mensajes/55/detalle']);
        expect(document.querySelectorAll('[data-testid="detalle-respuesta"] li').length).toBeGreaterThan(5);
        // Se puede volver a ocultar.
        await clic(boton(/^Ocultar detalle$/), 'Ocultar detalle');
        await esperar(() => !document.querySelector('[data-testid="detalle-respuesta"]'), { que: 'el detalle oculto' });
    });

    it('sin «asistente.ver_detalle» no hay botón ni se pide nada', async () => {
        b = await armarIA({ permisos: PERMISOS_ADMIN_IA, ruta: '/asistente/consumo' });
        await cargada();
        expect(botonVerDetalle()).toBeNull();
        expect(boton('Ver completa')).not.toBeNull();
        expect(b.srv.cuantos('GET', DETALLE_MENSAJE)).toBe(0);
    });

    it('un 403 (le falta un permiso) se avisa con el texto del servidor y no abre nada', async () => {
        b = await armarIA({ permisos: PERMISOS_ADMIN_DETALLE_IA, ruta: '/asistente/consumo' });
        b.detalleDeMensaje = () => ({ status: 403, body: { codigo: 'SIN_PERMISO_DETALLE', mensaje: 'Para ver el detalle hace falta el permiso «Ver el detalle de las respuestas de amaIA».' } });
        await cargada();
        await clic(botonVerDetalle(), 'Ver detalle');
        await esperar(() => toasts().some((x) => x.variante === 'error' && /Para ver el detalle hace falta el permiso/.test(x.texto)), { que: 'el aviso' });
        expect(document.querySelector('[data-testid="detalle-respuesta"]')).toBeNull();
        expect(botonVerDetalle()).not.toBeNull();
    });

    it('un 500 también avisa, en castellano', async () => {
        b = await armarIA({ permisos: PERMISOS_ADMIN_DETALLE_IA, ruta: '/asistente/consumo' });
        b.detalleDeMensaje = () => ({ status: 500, body: { message: 'Internal server error' } });
        await cargada();
        await clic(botonVerDetalle(), 'Ver detalle');
        await esperar(() => toasts().some((x) => x.variante === 'error' && /No se pudo cargar el detalle de la respuesta/.test(x.texto)), { que: 'el aviso' });
    });
});
