import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PaginaWiki, parsearPagina } from './parsear-pagina';

/** Lo que el turno necesita de la wiki (el servicio de Nest y el script de evaluación lo implementan igual). */
export interface PuertoWiki {
    readonly indice: string;
    readonly slugs: string[];
    readonly version: string;
    pagina(slug: string): PaginaWiki | undefined;
    paginaPrincipalParaRuta(ruta: string): PaginaWiki | undefined;
}

/** Índice de la wiki en memoria: se arma una vez (la wiki cambia solo con un deploy). */
export class WikiIndice implements PuertoWiki {
    readonly paginas: PaginaWiki[];
    readonly indice: string;
    readonly slugs: string[];
    /** sha1[0:8] del texto del índice. */
    readonly version: string;
    /** Slugs de páginas sin comentario de metadatos (el servicio avisa). */
    readonly sinMeta: string[];
    private readonly porSlug = new Map<string, PaginaWiki>();

    constructor(paginas: PaginaWiki[]) {
        this.paginas = [...paginas].sort((a, b) => a.ordenSeccion - b.ordenSeccion || a.orden - b.orden);
        for (const p of this.paginas) this.porSlug.set(p.slug, p);
        this.slugs = this.paginas.map((p) => p.slug);
        this.sinMeta = this.paginas.filter((p) => !p.tieneMeta).map((p) => p.slug);
        this.indice = WikiIndice.armarTexto(this.paginas);
        this.version = crypto.createHash('sha1').update(this.indice).digest('hex').slice(0, 8);
    }

    /** Lee `<dir>/<NN>-<seccion>/<NN>-<pagina>.md`. Lanza si el directorio no existe. */
    static desdeDirectorio(dir: string): WikiIndice {
        const paginas: PaginaWiki[] = [];
        for (const carpeta of fs.readdirSync(dir).sort()) {
            const d = path.join(dir, carpeta);
            if (!fs.statSync(d).isDirectory()) continue;
            for (const archivo of fs.readdirSync(d).filter((f) => f.endsWith('.md')).sort()) {
                paginas.push(parsearPagina(fs.readFileSync(path.join(d, archivo), 'utf8'), carpeta, archivo));
            }
        }
        return new WikiIndice(paginas);
    }

    /**
     * Formato de docs/asistente-spec.md §10.1. Determinista: mismo directorio, mismos bytes (el `system` cacheado
     * depende de eso).
     */
    static armarTexto(paginas: PaginaWiki[]): string {
        const lineas: string[] = [];
        let seccion = '';
        for (const p of paginas) {
            if (p.seccion !== seccion) {
                seccion = p.seccion;
                lineas.push(`\n## ${seccion}`);
            }
            lineas.push(`- [${p.slug}] ${p.titulo}${p.resumen ? ` — ${p.resumen}` : ''}`);
            if (p.rutas.length) {
                const principal = p.rutasPrincipales.length ? ` (principal de ${p.rutasPrincipales.join(', ')})` : '';
                lineas.push(`  pantallas: ${p.rutas.join(', ')}${principal}`);
            }
            if (p.secciones.length) lineas.push(`  secciones: ${p.secciones.join(' · ')}`);
        }
        return lineas.join('\n').trim();
    }

    pagina(slug: string): PaginaWiki | undefined {
        return this.porSlug.get(slug);
    }

    /**
     * La página que abre el botón "?" de una pantalla. Mismo algoritmo que `paginasParaRuta` del frontend: de las
     * rutas declaradas que son prefijo de la actual gana la más larga, y la principal va primero.
     */
    paginaPrincipalParaRuta(ruta: string): PaginaWiki | undefined {
        const declaradas = new Set<string>();
        for (const p of this.paginas) for (const r of p.rutas) declaradas.add(r);

        let mejor = '';
        for (const r of declaradas) {
            const coincide = r === '/' ? ruta === '/' : ruta === r || ruta.startsWith(`${r}/`);
            if (coincide && r.length > mejor.length) mejor = r;
        }
        if (!mejor) return undefined;

        const paginas = this.paginas.filter((p) => p.rutas.includes(mejor));
        return paginas.find((p) => p.rutasPrincipales.includes(mejor)) ?? paginas[0];
    }
}

/** El directorio de la wiki: `ASISTENTE_WIKI_DIR` o el primero que exista (imagen: /app/docs/ayuda; local: ../docs/ayuda). */
export function resolverDirectorioWiki(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string | null {
    const explicito = (env.ASISTENTE_WIKI_DIR ?? '').trim();
    const candidatos = explicito
        ? [explicito]
        : [path.join(cwd, 'docs', 'ayuda'), path.join(cwd, '..', 'docs', 'ayuda')];
    return candidatos.find((c) => fs.existsSync(c) && fs.statSync(c).isDirectory()) ?? null;
}
