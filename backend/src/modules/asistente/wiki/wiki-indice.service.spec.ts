import * as path from 'path';
import { Logger } from '@nestjs/common';
import { WikiIndice, resolverDirectorioWiki } from './wiki-indice';
import { WikiIndiceService } from './wiki-indice.service';

const FIXTURES = path.join(__dirname, '..', '__fixtures__', 'ayuda');
const WIKI_REAL = path.resolve(__dirname, '../../../../../docs/ayuda');

describe('WikiIndice / WikiIndiceService', () => {
    beforeEach(() => {
        jest.spyOn(Logger.prototype, 'log').mockImplementation();
        jest.spyOn(Logger.prototype, 'warn').mockImplementation();
        jest.spyOn(Logger.prototype, 'error').mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());

    it('ordena por prefijo de carpeta y de archivo', () => {
        const w = WikiIndice.desdeDirectorio(FIXTURES);
        expect(w.slugs).toEqual([
            'primeros-pasos/inicio',
            'gestion/buscar-un-caso',
            'reportes/armar-un-reporte',
            'reportes/ejecutar-y-descargar',
            'reportes/sin-metadatos',
        ]);
    });

    it('el texto del índice sale byte a byte igual en dos cargas (la caché depende de eso)', () => {
        const a = WikiIndice.desdeDirectorio(FIXTURES);
        const b = WikiIndice.desdeDirectorio(FIXTURES);
        expect(Buffer.from(a.indice).equals(Buffer.from(b.indice))).toBe(true);
        expect(a.version).toBe(b.version);
        expect(a.version).toMatch(/^[0-9a-f]{8}$/);
    });

    it('arma el índice con sección, resumen, pantallas y secciones', () => {
        const w = WikiIndice.desdeDirectorio(FIXTURES);
        expect(w.indice).toContain('## Reportes');
        expect(w.indice).toContain('- [reportes/armar-un-reporte] Armar un reporte — El constructor paso a paso.');
        expect(w.indice).toContain('  pantallas: /reportes, /reportes/nuevo (principal de /reportes/nuevo)');
        expect(w.indice).toContain('  secciones: Para qué sirve · Preguntas frecuentes');
    });

    it('una página sin metadatos se indexa igual y se avisa', () => {
        const svc = new WikiIndiceService();
        svc.cargar(FIXTURES);
        expect(svc.disponible).toBe(true);
        expect(svc.slugs).toContain('reportes/sin-metadatos');
        expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('reportes/sin-metadatos'));
    });

    it('paginaPrincipalParaRuta sobre fixtures: prefijo más largo y principal primero', () => {
        const w = WikiIndice.desdeDirectorio(FIXTURES);
        expect(w.paginaPrincipalParaRuta('/')?.slug).toBe('primeros-pasos/inicio');
        expect(w.paginaPrincipalParaRuta('/gestion/1234')?.slug).toBe('gestion/buscar-un-caso');
        expect(w.paginaPrincipalParaRuta('/reportes/ejecuciones')?.slug).toBe('reportes/ejecutar-y-descargar');
        expect(w.paginaPrincipalParaRuta('/reportes/nuevo')?.slug).toBe('reportes/armar-un-reporte');
        expect(w.paginaPrincipalParaRuta('/xyz')).toBeUndefined();
    });

    it('directorio inexistente: queda sin wiki (pausa SIN_WIKI) y loguea error', () => {
        const svc = new WikiIndiceService();
        svc.cargar(path.join(FIXTURES, 'no-existe'));
        expect(svc.disponible).toBe(false);
        expect(svc.slugs).toEqual([]);
        expect(svc.pagina('gestion/buscar-un-caso')).toBeUndefined();
        expect(Logger.prototype.error).toHaveBeenCalled();
    });

    it('sin directorio configurado ni encontrado: SIN_WIKI', () => {
        const svc = new WikiIndiceService();
        svc.cargar(null);
        expect(svc.disponible).toBe(false);
    });

    it('resolverDirectorioWiki: ASISTENTE_WIKI_DIR gana; sin él busca docs/ayuda en cwd y en ../', () => {
        expect(resolverDirectorioWiki({ ASISTENTE_WIKI_DIR: FIXTURES }, '/nada')).toBe(FIXTURES);
        expect(resolverDirectorioWiki({ ASISTENTE_WIKI_DIR: '/no/existe' }, '/nada')).toBeNull();
        expect(resolverDirectorioWiki({}, path.resolve(__dirname, '../../../..'))).toBe(WIKI_REAL);
    });

    describe('sobre la wiki real', () => {
        const real = WikiIndice.desdeDirectorio(WIKI_REAL);

        it('tiene al menos 39 páginas y los slugs son únicos', () => {
            expect(real.paginas.length).toBeGreaterThanOrEqual(39);
            expect(new Set(real.slugs).size).toBe(real.slugs.length);
        });

        it.each([
            ['/gestion', 'gestion/buscar-un-caso'],
            ['/reportes/ejecuciones', 'reportes/ejecutar-y-descargar'],
            ['/plantillas/12/editar', 'importacion/crear-plantilla'],
            ['/', 'primeros-pasos/inicio'],
        ])('paginaPrincipalParaRuta(%s) → %s', (ruta, slug) => {
            expect(real.paginaPrincipalParaRuta(ruta)?.slug).toBe(slug);
        });

        it('una ruta que ninguna página declara no tiene página principal', () => {
            expect(real.paginaPrincipalParaRuta('/xyz')).toBeUndefined();
        });
    });
});
