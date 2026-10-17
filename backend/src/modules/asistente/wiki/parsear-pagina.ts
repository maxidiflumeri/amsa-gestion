/**
 * Parser de una página de la wiki de ayuda. Mismo formato que `frontend/src/pages/ayuda/contenido.ts`: un comentario
 * HTML al principio con metadatos `clave: valor`, el título es el primer `# ` y las secciones son los `## `.
 */
export interface PaginaWiki {
    /** `seccion/pagina`, sin los prefijos numéricos de carpeta y archivo. */
    slug: string;
    titulo: string;
    seccion: string;
    orden: number;
    ordenSeccion: number;
    resumen: string;
    rutas: string[];
    rutasPrincipales: string[];
    /** Los títulos `## ` (no los `###`). */
    secciones: string[];
    /** El markdown sin el comentario de metadatos. */
    cuerpo: string;
    /** ¿Traía el comentario de metadatos? Sin él la página se indexa igual, con aviso. */
    tieneMeta: boolean;
}

const RE_META = /^\s*<!--([\s\S]*?)-->/;

/** `03-importacion` → `{ orden: 3, slug: 'importacion' }`. El prefijo ordena y no se muestra. */
export function partirPrefijo(nombre: string): { orden: number; slug: string } {
    const m = /^(\d+)-(.+)$/.exec(nombre);
    return m ? { orden: parseInt(m[1], 10), slug: m[2] } : { orden: 999, slug: nombre };
}

function partirLista(valor?: string): string[] {
    return (valor ?? '')
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean);
}

function sinBloquesDeCodigo(md: string): string {
    return md.replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, '');
}

export function parsearPagina(crudo: string, carpeta: string, archivo: string): PaginaWiki {
    const m = RE_META.exec(crudo);
    const meta: Record<string, string> = {};
    let cuerpo = crudo;
    if (m) {
        for (const linea of m[1].split('\n')) {
            const i = linea.indexOf(':');
            if (i < 0) continue;
            const k = linea.slice(0, i).trim();
            const v = linea.slice(i + 1).trim();
            if (k) meta[k] = v;
        }
        cuerpo = crudo.slice(m[0].length).trimStart();
    }

    const c = partirPrefijo(carpeta);
    const p = partirPrefijo(archivo.replace(/\.md$/, ''));
    const visible = sinBloquesDeCodigo(cuerpo);
    const tituloMd = /^#\s+(.+)$/m.exec(visible);

    return {
        slug: `${c.slug}/${p.slug}`,
        titulo: tituloMd ? tituloMd[1].trim() : p.slug,
        seccion: meta.seccion || c.slug,
        orden: p.orden,
        ordenSeccion: c.orden,
        resumen: meta.resumen ?? '',
        rutas: partirLista(meta.rutas),
        rutasPrincipales: partirLista(meta.rutaPrincipal),
        secciones: [...visible.matchAll(/^##\s+(.+)$/gm)].map((x) => x[1].trim()),
        cuerpo,
        tieneMeta: !!m,
    };
}
