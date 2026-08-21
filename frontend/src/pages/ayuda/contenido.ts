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
 * `rutas` es la lista de pantallas del sistema a las que esta página responde, y `rutaPrincipal` la
 * pantalla de la que esta página es **la respuesta por defecto**. Las dos alimentan la ayuda
 * contextual: el botón "?" abre la principal de esa pantalla y ofrece las hermanas al lado.
 *
 * Una pantalla puede tener varias páginas (Gestión y Reportes tienen seis cada una), así que
 * `rutas` no alcanza para decidir cuál abrir: por eso la principal se declara explícita en vez de
 * salir del orden de los archivos.
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
    /** Rutas de las que esta página es la respuesta por defecto del botón "?". */
    rutasPrincipales: string[];
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

function partirLista(valor?: string): string[] {
    return (valor || '').split(',').map((r) => r.trim()).filter(Boolean)
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
            rutas: partirLista(meta.rutas),
            rutasPrincipales: partirLista(meta.rutaPrincipal),
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

/**
 * Todas las páginas que responden a una pantalla, con la principal primero.
 *
 * El match es por **prefijo más largo**, así que `/reportes/ejecuciones` prefiere sus propias
 * páginas antes que las de `/reportes`, y una ruta con parámetros (`/gestion/1234`) igual encuentra
 * la ayuda de `/gestion`.
 */
export function paginasParaRuta(ruta: string): PaginaAyuda[] {
    const declaradas = new Set<string>()
    for (const p of PAGINAS) for (const r of p.rutas) declaradas.add(r)

    // De todas las rutas declaradas que son prefijo de la actual, gana la más específica.
    let mejor = ''
    for (const r of declaradas) {
        if (r === '/' ? ruta === '/' : ruta === r || ruta.startsWith(`${r}/`)) {
            if (r.length > mejor.length) mejor = r
        }
    }
    if (!mejor) return []

    const paginas = PAGINAS.filter((p) => p.rutas.includes(mejor))
    const principales = paginas.filter((p) => p.rutasPrincipales.includes(mejor))
    const resto = paginas.filter((p) => !p.rutasPrincipales.includes(mejor))
    return [...principales, ...resto]
}

/** La página que abre el botón "?" de una pantalla. */
export function paginaPrincipalParaRuta(ruta: string): PaginaAyuda | undefined {
    return paginasParaRuta(ruta)[0]
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
