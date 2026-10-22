// El menú de la cuenta y «Mi perfil» (CHANGELOG 2026-10-22): quién sos, el tema con Sistema, los datos propios de
// `GET /auth/perfil` (legajo, DNI, fecha de alta), lo que el rol deja hacer, la sesión y el menú achicado.
import { afterEach, describe, expect, it } from 'vitest';
import { clic, esperar, limpio, pasar } from '../lib/montar';
import { armarIA, bajarIA, rutaActual, type BancoIA } from '../lib/banco-ia';
import { permisosAgrupados, textoDelCambio } from '@fe/pages/perfil/MiPerfil';
import { cuandoRelativo, tiemposDeSesion } from '@fe/utils/sesion';
import { TODOS_LOS_PERMISOS } from '@fe/utils/permisosCatalogo';

const TOTAL = TODOS_LOS_PERMISOS.reduce((n, sec) => n + sec.permisos.length, 0);

let b: BancoIA | null = null;
const matchMediaOriginal = window.matchMedia;
afterEach(async () => {
    await bajarIA(b);
    b = null;
    window.matchMedia = matchMediaOriginal;
    localStorage.removeItem('app_theme_mode');
    localStorage.removeItem('app_sidebar_collapsed');
});

const PERMISOS = ['deudores.ver', 'comentarios.ver', 'comentarios.crear', 'reportes.ver'];
const perfilDto = (over: Record<string, unknown> = {}) => ({
    id: 3,
    nombre: 'Maxi Servidor',
    email: 'm@x',
    avatarUrl: null,
    rol: 'ADMIN',
    permisos: PERMISOS,
    legajo: 'L-102',
    dni: '27336733',
    fechaAlta: '2026-03-04T12:00:00Z',
    ...over,
});
const conPerfil = (over: Record<string, unknown> = {}) => (bb: BancoIA) => {
    bb.srv.en('GET', /^\/auth\/perfil$/, () => ({ body: perfilDto(over) }));
};

/** Un token con forma de JWT (sin firma válida: el frontend solo lo lee para mostrar la sesión). */
function tokenFalso(iat: Date, exp: Date) {
    const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 3, iat: Math.floor(iat.getTime() / 1000), exp: Math.floor(exp.getTime() / 1000) })}.firma`;
}

/** `matchMedia` que contesta el modo del sistema; el resto de las consultas, como siempre. */
function sistemaEn(oscuro: { valor: boolean }) {
    const oyentes = new Set<() => void>();
    window.matchMedia = ((consulta: string) => {
        if (!consulta.includes('prefers-color-scheme')) return matchMediaOriginal(consulta);
        return {
            get matches() { return oscuro.valor; },
            media: consulta,
            onchange: null,
            addEventListener: (_t: string, l: () => void) => oyentes.add(l),
            removeEventListener: (_t: string, l: () => void) => oyentes.delete(l),
            addListener: (l: () => void) => oyentes.add(l),
            removeListener: (l: () => void) => oyentes.delete(l),
            dispatchEvent: () => true,
        } as unknown as MediaQueryList;
    }) as typeof window.matchMedia;
    return () => oyentes.forEach((l) => l());
}

const botonCuenta = () => document.querySelector<HTMLElement>('.MuiAppBar-root button[aria-label="Tu cuenta"]');
const panelCuenta = () => document.querySelector<HTMLElement>('[role="dialog"][aria-label="Tu cuenta"]');
const opcionTema = (etiqueta: string, raiz: ParentNode = document) =>
    Array.from(raiz.querySelectorAll<HTMLElement>('[aria-label="Tema"] button')).find((x) => limpio(x.textContent ?? '') === etiqueta) ?? null;
const fondoDeLaBarra = () => getComputedStyle(document.querySelector('.MuiAppBar-root')!).backgroundColor;
const MARCO_CLARO = 'rgb(237, 241, 245)';
const MARCO_OSCURO = 'rgb(7, 11, 20)';
const main = () => limpio(document.querySelector('main')?.textContent ?? '');

describe('El menú de la cuenta', () => {
    it('muestra nombre, email y rol, y «Mi perfil» lleva a la página y cierra el panel', async () => {
        b = await armarIA({ permisos: PERMISOS, ruta: '/gestion', antes: conPerfil() });
        expect(botonCuenta()?.getAttribute('aria-haspopup')).toBe('dialog');
        await clic(botonCuenta(), 'la cuenta');
        const panel = await esperar(panelCuenta, { que: 'el panel de la cuenta' });
        expect(botonCuenta()?.getAttribute('aria-expanded')).toBe('true');
        const texto = limpio(panel.textContent ?? '');
        expect(texto).toContain('Maxi');
        expect(texto).toContain('m@x');
        expect(texto).toContain('ADMIN');
        const miPerfil = Array.from(panel.querySelectorAll<HTMLElement>('a')).find((a) => limpio(a.textContent ?? '') === 'Mi perfil')!;
        expect(miPerfil.getAttribute('href')).toBe('/perfil');
        await clic(miPerfil, 'Mi perfil');
        await esperar(() => rutaActual() === '/perfil', { que: 'la ruta' });
        await esperar(() => !panelCuenta(), { que: 'que se cierre el panel' });
    });

    it('el tema: Oscuro y Claro se aplican y se guardan; Sistema sigue al equipo y cambia cuando él cambia', async () => {
        const oscuro = { valor: true };
        const avisar = sistemaEn(oscuro);
        b = await armarIA({ permisos: PERMISOS, ruta: '/gestion' });
        expect(fondoDeLaBarra()).toBe(MARCO_CLARO);
        await clic(botonCuenta(), 'la cuenta');
        await esperar(panelCuenta, { que: 'el panel' });

        await clic(opcionTema('Oscuro'), 'Oscuro');
        await esperar(() => fondoDeLaBarra() === MARCO_OSCURO, { que: 'el modo oscuro' });
        expect(localStorage.getItem('app_theme_mode')).toBe('dark');
        expect(opcionTema('Oscuro')?.getAttribute('aria-pressed')).toBe('true');

        await clic(opcionTema('Claro'), 'Claro');
        await esperar(() => fondoDeLaBarra() === MARCO_CLARO, { que: 'el modo claro' });

        await clic(opcionTema('Sistema'), 'Sistema');
        await esperar(() => fondoDeLaBarra() === MARCO_OSCURO, { que: 'el oscuro del sistema' });
        expect(localStorage.getItem('app_theme_mode')).toBe('system');
        oscuro.valor = false;
        avisar();
        await esperar(() => fondoDeLaBarra() === MARCO_CLARO, { que: 'que siga al sistema' });
    });

    it('Cerrar sesión borra la sesión y lleva al login', async () => {
        b = await armarIA({ permisos: PERMISOS, ruta: '/gestion' });
        await clic(botonCuenta(), 'la cuenta');
        const panel = await esperar(panelCuenta, { que: 'el panel' });
        await clic(Array.from(panel.querySelectorAll<HTMLElement>('[role="button"], button')).find((x) => limpio(x.textContent ?? '') === 'Cerrar sesión') ?? null, 'Cerrar sesión');
        await esperar(() => rutaActual() === '/login', { que: 'el login' });
        expect(localStorage.getItem('amsa_token')).toBeNull();
    });
});

describe('Mi perfil', () => {
    it('legajo, DNI y fecha de alta del servidor, y solo los permisos que el rol tiene, agrupados', async () => {
        b = await armarIA({ permisos: PERMISOS, ruta: '/perfil', antes: conPerfil() });
        await esperar(() => main().includes('L-102'), { que: 'el legajo' });
        expect(main()).toContain('27336733');
        expect(main()).toContain('4 de marzo de 2026');
        expect(main()).toContain('Maxi Servidor');
        expect(main()).toContain(`4 de ${TOTAL}`);
        expect(main()).toContain('Tu rol ADMIN te da 4 permisos');
        expect(main()).not.toContain('Tu rol cambió');
        const secciones = Array.from(document.querySelectorAll('main section[aria-label]')).map((s) => s.getAttribute('aria-label'));
        expect(secciones).toEqual(['Deudores', 'Comentarios', 'Reportes']);
        const items = Array.from(document.querySelectorAll('main section[aria-label] li')).map((li) => limpio(li.textContent ?? ''));
        expect(items).toEqual(['Ver deudores', 'Ver comentarios', 'Crear comentarios', 'Ver reportes']);
        // Solo lo que puede: ni un permiso de más.
        expect(main()).not.toContain('Ver auditoría');
        expect(b.srv.cuantos('GET', /^\/auth\/perfil/)).toBe(1);
    });

    it('rol y permisos son los de la sesión (con los que el sistema decide); si la base cambió, lo avisa', async () => {
        // En la base el rol ya es otro: se le sumó "Ver tableros" y se le quitó "Ver reportes".
        const ahora = ['deudores.ver', 'comentarios.ver', 'comentarios.crear', 'dashboards.ver'];
        b = await armarIA({ permisos: PERMISOS, ruta: '/perfil', antes: conPerfil({ rol: 'SUPERVISOR', permisos: ahora }) });
        await esperar(() => main().includes('Tu rol cambió'), { que: 'el aviso' });
        expect(main()).toContain('Tu rol cambió desde que entraste (ahora es SUPERVISOR): se sumó 1 permiso y se quitó 1.');
        expect(main()).toContain('cerrá sesión y volvé a entrar');
        // La lista y el contador siguen siendo los de la sesión, que es lo que el menú y el sistema usan.
        expect(main()).toContain('Tu rol ADMIN te da 4 permisos');
        expect(main()).toContain(`4 de ${TOTAL}`);
        const items = Array.from(document.querySelectorAll('main section[aria-label] li')).map((li) => limpio(li.textContent ?? ''));
        expect(items).toContain('Ver reportes');
        expect(items).not.toContain('Ver tableros');
        await clic(Array.from(document.querySelectorAll<HTMLElement>('main .MuiAlert-root button')).find((x) => limpio(x.textContent ?? '') === 'Cerrar sesión') ?? null, 'Cerrar sesión del aviso');
        await esperar(() => rutaActual() === '/login', { que: 'el login' });
    });

    it('sin legajo ni DNI cargados dice «Sin cargar»', async () => {
        b = await armarIA({ permisos: PERMISOS, ruta: '/perfil', antes: conPerfil({ legajo: null, dni: null }) });
        await esperar(() => main().includes('4 de marzo de 2026'), { que: 'la fecha de alta' });
        expect(main().match(/Sin cargar/g)).toHaveLength(2);
    });

    it('si el servidor falla, muestra lo de la sesión y avisa con Reintentar', async () => {
        let falla = true;
        b = await armarIA({ permisos: PERMISOS, ruta: '/perfil', antes: (bb) => {
            bb.srv.en('GET', /^\/auth\/perfil$/, () => (falla ? { status: 500, body: { message: 'boom' } } : { body: perfilDto() }));
        } });
        await esperar(() => main().includes('No se pudieron traer el legajo, el DNI y la fecha de alta.'), { que: 'el aviso' });
        expect(main()).toContain('Maxi');
        expect(main()).toContain('Tu rol ADMIN te da 4 permisos');
        falla = false;
        await clic(Array.from(document.querySelectorAll<HTMLElement>('main button')).find((x) => limpio(x.textContent ?? '') === 'Reintentar') ?? null, 'Reintentar');
        await esperar(() => main().includes('L-102'), { que: 'el legajo después de reintentar' });
        expect(main()).not.toContain('No se pudieron traer');
    });

    it('la sesión: cuándo entraste y cuándo vence, leído del token', async () => {
        const ahora = new Date();
        const desde = new Date(ahora.getTime() - 60_000);
        const vence = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + 1, 10, 30);
        b = await armarIA({ permisos: PERMISOS, ruta: '/perfil', antes: (bb) => {
            conPerfil()(bb);
            localStorage.setItem('amsa_token', tokenFalso(desde, vence));
        } });
        await esperar(() => main().includes('La sesión vence'), { que: 'la sesión' });
        expect(main()).toContain(`Entraste ${cuandoRelativo(desde)}.`);
        expect(main()).toContain('La sesión vence mañana a las 10:30');
    });

    it('con un token que no se puede leer no inventa horarios', async () => {
        b = await armarIA({ permisos: PERMISOS, ruta: '/perfil', antes: conPerfil() });
        await esperar(() => main().includes('Cuando la sesión vence, hay que volver a entrar con Google.'), { que: 'la sesión' });
        expect(main()).not.toContain('Entraste');
    });

    it('el interruptor del menú achica el menú lateral y lo recuerda; en la tablet no se puede usar', async () => {
        b = await armarIA({ permisos: PERMISOS, ruta: '/perfil', antes: conPerfil() });
        const interruptor = await esperar(() => Array.from(document.querySelectorAll<HTMLInputElement>('main input[type="checkbox"]'))[0], { que: 'el interruptor' });
        expect(interruptor.checked).toBe(false);
        expect(document.querySelector('[id^="menu-seccion-"]')).not.toBeNull();
        await clic(interruptor, 'el interruptor');
        await esperar(() => !document.querySelector('[id^="menu-seccion-"]'), { que: 'el menú achicado' });
        expect(localStorage.getItem('app_sidebar_collapsed')).toBe('1');
        await bajarIA(b);

        b = await armarIA({ permisos: PERMISOS, ruta: '/perfil', ancho: 768, antes: conPerfil() });
        const enTablet = await esperar(() => Array.from(document.querySelectorAll<HTMLInputElement>('main input[type="checkbox"]'))[0], { que: 'el interruptor' });
        expect(enTablet.disabled).toBe(true);
        expect(main()).toContain('En el celular y la tablet el menú se abre con el botón de la barra.');
    });

    it('los atajos: sin Ver deudores el buscador solo busca pantallas, y en el celular no se muestran', async () => {
        b = await armarIA({ permisos: ['reportes.ver'], ruta: '/perfil', antes: conPerfil({ permisos: ['reportes.ver'] }) });
        await esperar(() => main().includes('Atajos de teclado'), { que: 'los atajos' });
        expect(main()).toContain('Buscar una pantalla, desde cualquier pantalla');
        expect(main()).not.toContain('Buscar un caso o una pantalla');
        await bajarIA(b);

        b = await armarIA({ permisos: PERMISOS, ruta: '/perfil', ancho: 360, antes: conPerfil() });
        await esperar(() => main().includes('L-102'), { que: 'el perfil en el celular' });
        expect(main()).not.toContain('Atajos de teclado');
    });

    it('no pide ningún permiso: sin permisos se ve igual y lo dice', async () => {
        b = await armarIA({ permisos: [], ruta: '/perfil', antes: conPerfil({ permisos: [] }) });
        await esperar(() => main().includes('L-102'), { que: 'el perfil' });
        expect(main()).toContain('todavía no tiene permisos');
        await pasar(50);
        expect(main()).toContain(`0 de ${TOTAL}`);
    });
});

describe('Las piezas', () => {
    it('arma la frase del cambio de rol', () => {
        expect(textoDelCambio({ sumados: 2, quitados: 1, rolNuevo: 'SUPERVISOR' })).toBe('Tu rol cambió desde que entraste (ahora es SUPERVISOR): se sumaron 2 permisos y se quitó 1.');
        expect(textoDelCambio({ sumados: 0, quitados: 3, rolNuevo: null })).toBe('Tu rol cambió desde que entraste: se quitaron 3 permisos.');
        expect(textoDelCambio({ sumados: 1, quitados: 0, rolNuevo: null })).toBe('Tu rol cambió desde que entraste: se sumó 1 permiso.');
        expect(textoDelCambio({ sumados: 0, quitados: 0, rolNuevo: 'OPERADOR' })).toBe('Tu rol cambió desde que entraste (ahora es OPERADOR).');
    });

    it('agrupa como el catálogo, y una clave desconocida va en «Otros»', () => {
        expect(permisosAgrupados(['reportes.ver', 'deudores.ver', 'algo.nuevo'])).toEqual([
            { seccion: 'Deudores', items: ['Ver deudores'] },
            { seccion: 'Reportes', items: ['Ver reportes'] },
            { seccion: 'Otros', items: ['algo.nuevo'] },
        ]);
        expect(permisosAgrupados([])).toEqual([]);
    });

    it('lee iat y exp del token; cualquier otra cosa da null', () => {
        const desde = new Date('2026-10-22T09:14:00Z');
        const vence = new Date('2026-10-23T09:14:00Z');
        expect(tiemposDeSesion(tokenFalso(desde, vence))).toEqual({ desde, vence });
        expect(tiemposDeSesion('token-de-prueba')).toEqual({ desde: null, vence: null });
        expect(tiemposDeSesion('a.b.c')).toEqual({ desde: null, vence: null });
        expect(tiemposDeSesion(null)).toEqual({ desde: null, vence: null });
    });

    it('dice hoy, mañana, ayer o la fecha', () => {
        const ahora = new Date(2026, 9, 22, 12, 0);
        expect(cuandoRelativo(new Date(2026, 9, 22, 9, 5), ahora)).toBe('hoy a las 09:05');
        expect(cuandoRelativo(new Date(2026, 9, 23, 9, 5), ahora)).toBe('mañana a las 09:05');
        expect(cuandoRelativo(new Date(2026, 9, 21, 18, 2), ahora)).toBe('ayer a las 18:02');
        expect(cuandoRelativo(new Date(2026, 9, 1, 8, 0), ahora)).toBe('el 01/10 a las 08:00');
    });
});
