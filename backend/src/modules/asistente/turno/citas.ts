import { FuenteAyuda } from '../dto/asistente.tipos';

export interface PuertoCitas {
    pagina(slug: string): { titulo: string } | undefined;
}

/**
 * Las páginas de ayuda citadas en el texto (`/ayuda/<slug>`), validadas contra el índice. Las que no existen se
 * descartan y se devuelven aparte para loguearlas: el modelo no puede inventar una fuente.
 */
export function extraerCitas(texto: string, wiki: PuertoCitas): { fuentes: FuenteAyuda[]; invalidas: string[] } {
    const fuentes: FuenteAyuda[] = [];
    const invalidas: string[] = [];
    const vistas = new Set<string>();
    for (const m of texto.matchAll(/\/ayuda\/([A-Za-z0-9][A-Za-z0-9\-_/]*)/g)) {
        const slug = m[1].replace(/\/+$/, '');
        if (vistas.has(slug)) continue;
        vistas.add(slug);
        const pagina = wiki.pagina(slug);
        if (pagina) fuentes.push({ slug, titulo: pagina.titulo });
        else invalidas.push(slug);
    }
    return { fuentes, invalidas };
}
