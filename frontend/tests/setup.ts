import { afterEach, beforeAll } from 'vitest';
import { instalarMatchMedia, restaurarAncho } from './lib/ancho';

// React: los tests envuelven en act() lo que provoca renders.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
instalarMatchMedia();

// jsdom no trae ResizeObserver (recharts lo usa en el detalle).
class RO { observe() {} unobserve() {} disconnect() {} }
if (!('ResizeObserver' in globalThis)) Object.assign(globalThis, { ResizeObserver: RO });
if (typeof window.scrollTo !== 'function') window.scrollTo = () => {};

beforeAll(() => {
    // Seguro: el arnés jamás le pega a un backend que no sea el falso.
    const url = String(import.meta.env.VITE_API_URL);
    if (!/^http:\/\/127\.0\.0\.1:47831\/api$/.test(url)) {
        throw new Error(`VITE_API_URL inesperada (${url}): el arnés solo habla con el backend falso`);
    }
});

afterEach(() => {
    restaurarAncho();
    document.body.innerHTML = '';
    localStorage.clear();
});
