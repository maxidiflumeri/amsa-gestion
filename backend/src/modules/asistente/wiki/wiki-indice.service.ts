import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Coincidencia, OpcionesBusqueda } from './buscador';
import { PaginaWiki } from './parsear-pagina';
import { PuertoWiki, WikiIndice, resolverDirectorioWiki } from './wiki-indice';

/**
 * Carga la wiki de ayuda al arrancar (docs/asistente-spec.md §10.3). Sin directorio o sin páginas, el asistente
 * queda en pausa `SIN_WIKI` en vez de contestar sin fuente.
 */
@Injectable()
export class WikiIndiceService implements OnModuleInit, PuertoWiki {
    private readonly logger = new Logger(WikiIndiceService.name);
    private wiki: WikiIndice | null = null;

    onModuleInit(): void {
        this.cargar();
    }

    /** Público para los tests. */
    cargar(dir: string | null = resolverDirectorioWiki()): void {
        this.wiki = null;
        if (!dir) {
            this.logger.error(
                'No se encontró la wiki de ayuda (docs/ayuda): el asistente queda en pausa SIN_WIKI. ' +
                    'Revisar ASISTENTE_WIKI_DIR y que la imagen copie docs/ayuda.',
            );
            return;
        }
        try {
            const wiki = WikiIndice.desdeDirectorio(dir);
            if (wiki.paginas.length === 0) {
                this.logger.error(`La wiki de ayuda (${dir}) no tiene páginas: el asistente queda en pausa SIN_WIKI`);
                return;
            }
            for (const slug of wiki.sinMeta) {
                this.logger.warn(`La página de ayuda ${slug} no tiene metadatos: se indexa sin resumen ni pantallas`);
            }
            this.wiki = wiki;
            this.logger.log(
                `Índice de la wiki cargado: ${wiki.paginas.length} páginas, ${wiki.indice.length} caracteres, version=${wiki.version}`,
            );
        } catch (e: any) {
            this.logger.error(`No se pudo cargar la wiki de ayuda (${dir}): ${e?.message}`, e?.stack);
        }
    }

    get disponible(): boolean {
        return this.wiki !== null;
    }

    get paginas(): PaginaWiki[] {
        return this.wiki?.paginas ?? [];
    }

    get indice(): string {
        return this.wiki?.indice ?? '';
    }

    get slugs(): string[] {
        return this.wiki?.slugs ?? [];
    }

    get version(): string {
        return this.wiki?.version ?? '';
    }

    pagina(slug: string): PaginaWiki | undefined {
        return this.wiki?.pagina(slug);
    }

    paginaPrincipalParaRuta(ruta: string): PaginaWiki | undefined {
        return this.wiki?.paginaPrincipalParaRuta(ruta);
    }

    buscar(texto: string, opciones?: OpcionesBusqueda): Coincidencia[] {
        return this.wiki?.buscar(texto, opciones) ?? [];
    }
}
