// Montaje con React en modo estricto y los providers REALES del frontend.
import React, { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SnackbarProvider } from 'notistack';
import { ColorModeProvider } from '@fe/context/ColorModeContext';
import { AuthProvider } from '@fe/context/AuthContext';
import { SocketProvider } from '@fe/context/SocketContext';
import { NotificacionesProvider } from '@fe/context/NotificacionesContext';
import { PageMetaProvider } from '@fe/context/PageMetaContext';
import { ConfirmProvider } from '@fe/context/ConfirmContext';

/** Con IS_REACT_ACT_ENVIRONMENT en false (tests de flujo completo) React agenda solo, como en el navegador: no se usa act. */
const conAct = () => (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT === true;
async function enReact(fn: () => void | Promise<void>) {
    if (conAct()) { await act(async () => { await fn(); }); return; }
    await fn();
    await new Promise<void>((r) => setTimeout(r, 0));
    await new Promise<void>((r) => setTimeout(r, 0));
}

export interface Montado {
    contenedor: HTMLElement;
    rerender: (ui: React.ReactElement) => Promise<void>;
    desmontar: () => Promise<void>;
    texto: () => string;
}

interface Opciones {
    /** Con AuthProvider + SocketProvider reales (necesita el servidor falso levantado y `iniciarSesion()`). */
    conSocket?: boolean;
    /** Ruta inicial del MemoryRouter y patrón de la ruta donde se monta `ui`. */
    ruta?: string;
    patron?: string;
    estricto?: boolean;
    /** Con NotificacionesProvider (para pantallas que leen las importaciones en curso). Requiere `conSocket`. */
    conNotificaciones?: boolean;
    /** 'dark' para montar en oscuro. */
    modo?: 'light' | 'dark';
}

export function iniciarSesion(permisos: string[] = ['importacion.ver_historial', 'importacion.ejecutar'], id = 3) {
    localStorage.setItem('amsa_token', 'token-de-prueba');
    localStorage.setItem('amsa_usuario', JSON.stringify({ id, nombre: 'Maxi', email: 'm@x', rol: 'ADMIN', permisos }));
}

function envolver(ui: React.ReactElement, o: Opciones) {
    let arbol: React.ReactElement = o.patron ? (
        <Routes>
            <Route path={o.patron} element={ui} />
            <Route path="*" element={<div data-testid="otra-ruta">OTRA RUTA</div>} />
        </Routes>
    ) : ui;
    // AvisosCarga usa useAuth desde la segunda pasada de C1: sin `conSocket` se monta igual dentro de AuthProvider
    // (sin sesión salvo que el test llame a iniciarSesion()).
    arbol = o.conSocket
        ? <AuthProvider><SocketProvider>{o.conNotificaciones ? <NotificacionesProvider>{arbol}</NotificacionesProvider> : arbol}</SocketProvider></AuthProvider>
        : <AuthProvider>{arbol}</AuthProvider>;
    arbol = (
        <ColorModeProvider>
            <SnackbarProvider maxSnack={4}>
                <ConfirmProvider>
                    <PageMetaProvider>
                        <MemoryRouter initialEntries={[o.ruta ?? '/']}>{arbol}</MemoryRouter>
                    </PageMetaProvider>
                </ConfirmProvider>
            </SnackbarProvider>
        </ColorModeProvider>
    );
    return o.estricto === false ? arbol : <StrictMode>{arbol}</StrictMode>;
}

export async function montar(ui: React.ReactElement, o: Opciones = {}): Promise<Montado> {
    if (o.modo) localStorage.setItem('app_theme_mode', o.modo);
    const contenedor = document.createElement('div');
    document.body.appendChild(contenedor);
    let root: Root;
    await enReact(() => {
        root = createRoot(contenedor);
        root.render(envolver(ui, o));
    });
    return {
        contenedor,
        rerender: async (nuevo) => { await enReact(() => { root.render(envolver(nuevo, o)); }); },
        desmontar: async () => { await enReact(() => { root.unmount(); }); contenedor.remove(); },
        texto: () => limpio(document.body.textContent ?? ''),
    };
}

export const limpio = (t: string) => t.replace(/\s+/g, ' ').trim();
export const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Deja pasar tiempo real dentro de act (para que React aplique lo que llega por red/socket). */
export async function pasar(ms: number) {
    await enReact(() => dormir(ms));
}

/** Espera (tiempo real) hasta que `condicion` devuelva algo verdadero. */
export async function esperar<T>(condicion: () => T | false | null | undefined, { ms = 10_000, cada = 25, que = 'la condición' } = {}): Promise<T> {
    const fin = Date.now() + ms;
    for (;;) {
        let r: T | false | null | undefined;
        try { r = condicion(); } catch { r = false; }
        if (r) return r;
        if (Date.now() > fin) throw new Error(`No se cumplió en ${ms} ms: ${que}\nPantalla: ${limpio(document.body.textContent ?? '').slice(0, 1500)}`);
        await pasar(cada);
    }
}

/** Alertas de MUI visibles: severidad y texto. */
export function alertas(raiz: ParentNode = document.body): Array<{ severidad: string; texto: string }> {
    return Array.from(raiz.querySelectorAll('.MuiAlert-root')).map((el) => {
        const m = /MuiAlert-(?:standard|color)(Warning|Info|Error|Success)/.exec(el.className);
        return { severidad: (m?.[1] ?? '?').toLowerCase(), texto: limpio(el.textContent ?? '') };
    });
}

export function boton(etiqueta: string | RegExp, raiz: ParentNode = document.body): HTMLButtonElement | null {
    const todos = Array.from(raiz.querySelectorAll('button')) as HTMLButtonElement[];
    return todos.find((b) => (typeof etiqueta === 'string' ? limpio(b.textContent ?? '') === etiqueta : etiqueta.test(limpio(b.textContent ?? '')))) ?? null;
}

export async function clic(el: Element | null, que = 'elemento') {
    if (!el) throw new Error(`No está ${que}. Pantalla: ${limpio(document.body.textContent ?? '').slice(0, 800)}`);
    await enReact(() => {
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    });
}

export const chips = (raiz: ParentNode = document.body) => Array.from(raiz.querySelectorAll('.MuiChip-label')).map((c) => limpio(c.textContent ?? ''));

/** Elige archivos en un <input type=file> (jsdom no deja asignar `files`: se define la propiedad). */
export async function elegirArchivos(input: HTMLInputElement | null, archivos: File[]) {
    if (!input) throw new Error('No está el input de archivos');
    await enReact(() => {
        Object.defineProperty(input, 'files', { configurable: true, value: archivos });
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

/** Elige una opción de un Select de MUI por el texto de su etiqueta (labelId) y el de la opción. */
export async function elegirEnSelect(labelId: string, opcion: RegExp) {
    const combo = document.querySelector(`[aria-labelledby~="${labelId}"][role="combobox"], [aria-labelledby~="${labelId}"][role="button"]`);
    if (!combo) throw new Error(`No está el Select ${labelId}`);
    await enReact(() => { combo.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })); });
    const li = await esperar(() => Array.from(document.querySelectorAll('li[role="option"]')).find((o) => opcion.test(o.textContent ?? '')), { que: `la opción ${opcion}` });
    await clic(li, 'opción');
    await esperar(() => !document.querySelector('li[role="option"]') || true);
}

/** Toasts de notistack visibles: variante y texto. */
export function toasts(): Array<{ variante: string; texto: string }> {
    return Array.from(document.querySelectorAll('.notistack-MuiContent')).map((el) => {
        const m = /notistack-MuiContent-(success|error|warning|info|default)/.exec(el.className);
        return { variante: m?.[1] ?? '?', texto: limpio(el.textContent ?? '') };
    });
}

/** Diálogos de MUI abiertos (el último es el de arriba). */
export function dialogos(): HTMLElement[] {
    return Array.from(document.querySelectorAll('.MuiDialog-root')) as HTMLElement[];
}
export function dialogo(titulo?: RegExp): HTMLElement | null {
    const todos = dialogos();
    if (!titulo) return todos[todos.length - 1] ?? null;
    return todos.find((d) => titulo.test(limpio(d.querySelector('.MuiDialogTitle-root')?.textContent ?? ''))) ?? null;
}

/** Escribe en un <input> controlado por React. */
export async function escribir(input: HTMLInputElement | null, valor: string) {
    if (!input) throw new Error('No está el input');
    await enReact(() => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
        setter.call(input, valor);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

/**
 * Doble clic como el de una persona: dos `click` en tareas distintas del navegador (entre uno y otro React ya aplicó
 * lo que el primero cambió, que es lo que pasa con un mouse real). El segundo va sobre el MISMO nodo aunque ya esté
 * deshabilitado: un `click` despachado sobre un <button disabled> no llega al handler, igual que en el navegador.
 */
export async function dobleClic(el: Element | null, que = 'elemento') {
    if (!el) throw new Error(`No está ${que}`);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    await new Promise<void>((r) => setTimeout(r, 0));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    await new Promise<void>((r) => setTimeout(r, 0));
    await new Promise<void>((r) => setTimeout(r, 0));
}

/** Dos `click` en la MISMA tarea, sin dejar que React aplique nada entre los dos. No es un doble clic humano: mide si el handler se protege solo. */
export async function dosClicsEnLaMismaTarea(el: Element | null) {
    if (!el) throw new Error('No está el elemento');
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    await new Promise<void>((r) => setTimeout(r, 0));
    await new Promise<void>((r) => setTimeout(r, 0));
}
