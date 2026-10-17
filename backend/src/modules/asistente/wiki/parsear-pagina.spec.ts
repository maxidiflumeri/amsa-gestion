import { parsearPagina, partirPrefijo } from './parsear-pagina';

const COMPLETA = `<!--
seccion: Reportes
resumen: El constructor paso a paso.
rutas: /reportes, /reportes/nuevo
rutaPrincipal: /reportes/nuevo
revisado: 2026-10-01
-->

# Armar un reporte

Texto.

## Paso a paso

### Un detalle

## Preguntas frecuentes
`;

describe('parsearPagina', () => {
    it('lee el comentario de metadatos completo y saca el prefijo numérico de la carpeta y del archivo', () => {
        const p = parsearPagina(COMPLETA, '04-reportes', '02-armar-un-reporte.md');
        expect(p).toMatchObject({
            slug: 'reportes/armar-un-reporte',
            titulo: 'Armar un reporte',
            seccion: 'Reportes',
            resumen: 'El constructor paso a paso.',
            rutas: ['/reportes', '/reportes/nuevo'],
            rutasPrincipales: ['/reportes/nuevo'],
            orden: 2,
            ordenSeccion: 4,
            tieneMeta: true,
        });
        expect(p.cuerpo.startsWith('# Armar un reporte')).toBe(true);
        expect(p.cuerpo).not.toContain('<!--');
    });

    it('sin metadatos: se indexa igual, con la sección de la carpeta y sin resumen ni pantallas', () => {
        const p = parsearPagina('# Título solo\n\n## Una sección\n', '05-ajustes', '01-empresas.md');
        expect(p).toMatchObject({ slug: 'ajustes/empresas', seccion: 'ajustes', resumen: '', rutas: [], tieneMeta: false });
    });

    it('rutaPrincipal múltiple', () => {
        const p = parsearPagina('<!--\nrutas: /a, /b\nrutaPrincipal: /a, /b\n-->\n# T\n', '01-x', '01-y.md');
        expect(p.rutasPrincipales).toEqual(['/a', '/b']);
    });

    it('sin título "# ": usa el nombre del archivo', () => {
        const p = parsearPagina('<!-- seccion: X -->\n\nSolo texto', '01-x', '07-sin-titulo.md');
        expect(p.titulo).toBe('sin-titulo');
    });

    it('las secciones son los "## " y no los "###"', () => {
        const p = parsearPagina(COMPLETA, '04-reportes', '02-armar-un-reporte.md');
        expect(p.secciones).toEqual(['Paso a paso', 'Preguntas frecuentes']);
    });

    it('ignora los "## " dentro de bloques de código', () => {
        const md = '# T\n\n```\n## no es sección\n```\n\n## Sí es sección\n';
        expect(parsearPagina(md, '01-x', '01-y.md').secciones).toEqual(['Sí es sección']);
    });

    it('partirPrefijo: sin prefijo numérico ordena al final', () => {
        expect(partirPrefijo('03-importacion')).toEqual({ orden: 3, slug: 'importacion' });
        expect(partirPrefijo('suelto')).toEqual({ orden: 999, slug: 'suelto' });
    });
});
