/**
 * Carga el contenido de la ayuda desde `docs/ayuda/`.
 *
 * El markdown vive en el repo, al lado de los specs técnicos, y no en la base. El motivo es uno y
 * es determinante: **la documentación se pudre si no cambia en el mismo commit que el código**. Si
 * está en el repo, tocar un flujo y no actualizar su página se ve en el diff.
 *
 * Vite resuelve el glob en build time y mete el markdown en el bundle, así que no hay endpoint ni
 * fetch: la ayuda funciona aunque el backend esté caído.
 *
 * ── Convención de los archivos ──────────────────────────────────────────────
 *
 *   docs/ayuda/<NN>-<seccion>/<NN>-<slug>.md   →   /ayuda/<seccion>/<slug>
 *
 * Cada archivo arranca con un bloque de metadatos en un comentario HTML y después el `# Título`:
 *
 *   <!--
 *   seccion: Importación de datos
 *   resumen: Cómo se le enseña al sistema a leer el archivo de un cedente.
 *   revisado: 2026-08-20
 *   rutas: /plantillas, /plantillas/nueva
 *   -->
 *   # Crear una plantilla de importación
 *
 * `rutas` es la lista de pantallas del sistema a las que esta página responde. Es lo que alimenta
 * la ayuda contextual: el botón "?" de una pantalla abre la página que la declara.
 */

export interface PaginaAyuda {
    /** `importacion/crear-plantilla` */
    slug: string;
    titulo: string;
    seccion: string;
    /** Para ordenar dentro de la sección; sale del prefijo numérico del archivo. */
    orden: number;
    ordenSeccion: number;
    resumen?: string;
    revisado?: string;
    /** Rutas de la app que esta página documenta, para la ayuda contextual. */
    rutas: string[];
    /** El markdown ya sin el bloque de metadatos. */
    cuerpo: string;
    /** Todo el texto en minúsculas, para buscar sin recalcular en cada tecla. */
    textoBusqueda: string;
}

const CRUDOS = import.meta.glob('../../../../docs/ayuda/**/*.md', {
    query: '?raw',
    import: 'default',
    eager: true,
}) as Record<string, string>;

const RE_META = /^\s*<!--([\s\S]*?)-->/;

function parsearMeta(md: string): { meta: Record<string, string>; cuerpo: string } {
    const m = RE_META.exec(md);
    if (!m) return { meta: {}, cuerpo: md };
    const meta: Record<string, string> = {};
    for (const linea of m[1].split('\n')) {
        const i = linea.indexOf(':');
        if (i < 0) continue;
        const k = linea.slice(0, i).trim();
        const v = linea.slice(i + 1).trim();
        if (k) meta[k] = v;
    }
    return { meta, cuerpo: md.slice(m[0].length).trimStart() };
}

/** `03-importacion` → `{ orden: 3, slug: 'importacion' }`. El prefijo ordena y no se muestra. */
function partirPrefijo(nombre: string): { orden: number; slug: string } {
    const m = /^(\d+)-(.+)$/.exec(nombre);
    return m ? { orden: parseInt(m[1], 10), slug: m[2] } : { orden: 999, slug: nombre };
}

function construir(): PaginaAyuda[] {
    const paginas: PaginaAyuda[] = [];

    for (const [ruta, crudo] of Object.entries(CRUDOS)) {
        const partes = ruta.split('/');
        const archivo = partes[partes.length - 1].replace(/\.md$/, '');
        const carpeta = partes[partes.length - 2];

        const p = partirPrefijo(archivo);
        const c = partirPrefijo(carpeta);
        const { meta, cuerpo } = parsearMeta(crudo);

        const tituloMd = /^#\s+(.+)$/m.exec(cuerpo);
        const titulo = tituloMd ? tituloMd[1].trim() : p.slug;

        paginas.push({
            slug: `${c.slug}/${p.slug}`,
            titulo,
            seccion: meta.seccion || c.slug,
            orden: p.orden,
            ordenSeccion: c.orden,
            resumen: meta.resumen,
            revisado: meta.revisado,
            rutas: (meta.rutas || '').split(',').map((r) => r.trim()).filter(Boolean),
            cuerpo,
            textoBusqueda: `${titulo}\n${meta.resumen ?? ''}\n${cuerpo}`.toLowerCase(),
        });
    }

    return paginas.sort((a, b) => a.ordenSeccion - b.ordenSeccion || a.orden - b.orden);
}

export const PAGINAS: PaginaAyuda[] = construir();

export interface SeccionAyuda {
    nombre: string;
    orden: number;
    paginas: PaginaAyuda[];
}

export const SECCIONES: SeccionAyuda[] = (() => {
    const mapa = new Map<string, SeccionAyuda>();
    for (const p of PAGINAS) {
        if (!mapa.has(p.seccion)) mapa.set(p.seccion, { nombre: p.seccion, orden: p.ordenSeccion, paginas: [] });
        mapa.get(p.seccion)!.paginas.push(p);
    }
    return [...mapa.values()].sort((a, b) => a.orden - b.orden);
})();

export function buscarPagina(slug: string): PaginaAyuda | undefined {
    return PAGINAS.find((p) => p.slug === slug);
}

/** La página que documenta una ruta de la app. Alimenta el botón de ayuda contextual. */
export function paginaParaRuta(ruta: string): PaginaAyuda | undefined {
    return PAGINAS.find((p) => p.rutas.includes(ruta));
}

export interface Resultado {
    pagina: PaginaAyuda;
    /** Fragmento del texto alrededor de la coincidencia, para mostrar en la lista. */
    contexto: string;
}

/**
 * Búsqueda por subcadena sobre el corpus completo, en el navegador. Con ~40 páginas no hace falta
 * un índice invertido: alcanza y se mantiene solo.
 */
export function buscar(termino: string, limite = 20): Resultado[] {
    const q = termino.trim().toLowerCase();
    if (q.length < 2) return [];

    const out: Resultado[] = [];
    for (const pagina of PAGINAS) {
        const i = pagina.textoBusqueda.indexOf(q);
        if (i < 0) continue;

        const desde = Math.max(0, i - 60);
        const contexto = (desde > 0 ? '…' : '') +
            pagina.cuerpo.slice(desde, i + q.length + 90).replace(/\s+/g, ' ').trim() + '…';

        // Un título que coincide vale más que una mención perdida en el cuerpo.
        const enTitulo = pagina.titulo.toLowerCase().includes(q);
        out.push({ pagina, contexto });
        if (enTitulo) out.unshift(out.pop()!);
        if (out.length >= limite) break;
    }
    return out;
}
