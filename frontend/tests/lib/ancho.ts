// `matchMedia` controlable. jsdom no lo trae: sin esto `useMediaQuery` siempre da falso y toda prueba correría en la
// rama de celular sin que nadie lo note. El ancho por defecto es el de un escritorio (1280 px).
type Oyente = () => void;

const ANCHO_ESCRITORIO = 1280;
let ancho = ANCHO_ESCRITORIO;
const oyentes = new Set<Oyente>();

/** Evalúa las condiciones `min-width` / `max-width` de una consulta con el ancho actual; el resto da falso. */
function evaluar(consulta: string): boolean {
    const limpia = consulta.replace(/^@media\s*/i, '').trim();
    return limpia.split(',').some((alternativa) =>
        alternativa.split(/\band\b/i).every((condicion) => {
            const c = condicion.trim();
            const min = /^\(\s*min-width\s*:\s*([\d.]+)px\s*\)$/i.exec(c);
            if (min) return ancho >= Number(min[1]);
            const max = /^\(\s*max-width\s*:\s*([\d.]+)px\s*\)$/i.exec(c);
            if (max) return ancho <= Number(max[1]);
            return false;
        }),
    );
}

export function instalarMatchMedia(): void {
    window.matchMedia = (consulta: string): MediaQueryList => {
        const lista = new Set<EventListenerOrEventListenerObject>();
        const aviso: Oyente = () => {
            const evento = { matches: evaluar(consulta), media: consulta } as MediaQueryListEvent;
            lista.forEach((l) => (typeof l === 'function' ? l(evento) : l.handleEvent(evento)));
        };
        const mql = {
            get matches() { return evaluar(consulta); },
            media: consulta,
            onchange: null,
            addEventListener: (_t: string, l: EventListenerOrEventListenerObject) => { lista.add(l); oyentes.add(aviso); },
            removeEventListener: (_t: string, l: EventListenerOrEventListenerObject) => { lista.delete(l); if (lista.size === 0) oyentes.delete(aviso); },
            addListener: (l: EventListenerOrEventListenerObject) => { lista.add(l); oyentes.add(aviso); },
            removeListener: (l: EventListenerOrEventListenerObject) => { lista.delete(l); if (lista.size === 0) oyentes.delete(aviso); },
            dispatchEvent: () => true,
        };
        return mql as unknown as MediaQueryList;
    };
}

/** Cambia el ancho de la ventana simulada (360 = celular, 1280 = escritorio) y avisa a quien escucha. */
export function fijarAncho(px: number): void {
    ancho = px;
    oyentes.forEach((o) => o());
}

export function restaurarAncho(): void {
    ancho = ANCHO_ESCRITORIO;
}
