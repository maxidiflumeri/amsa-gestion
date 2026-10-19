import * as path from 'path';
import { BUSQUEDA_AUTOMATICA, BUSQUEDA_HERRAMIENTA } from '../turno/turno-runner';
import { BuscadorWiki, normalizar, partirEnSecciones, raiz, rotuloCoincidencia, terminos } from './buscador';
import { parsearPagina } from './parsear-pagina';
import { WikiIndice } from './wiki-indice';

const pagina = (carpeta: string, archivo: string, md: string) => parsearPagina(md, carpeta, archivo);

const PLANTILLA = pagina(
    '03-importacion',
    '04-crear-plantilla.md',
    [
        '<!--',
        'seccion: Importación',
        'resumen: Armar la plantilla.',
        '-->',
        '# Crear una plantilla de importación',
        '',
        'Una plantilla le dice al sistema cómo leer el archivo.',
        '',
        '## Paso 5 — Mapear las columnas',
        '',
        'Cada columna del archivo va a un campo.',
        '',
        '### Bloques repetitivos',
        '',
        'Cuando una fila trae varios datos del mismo tipo se declaran como bloques, que el editor llama **iteraciones**.',
        '',
        '```',
        '# esto no es un título',
        'Factura 1 | Vto 1',
        '```',
        '',
        '## Qué puede salir mal',
        '',
        '### Los importes quedaron mil veces más chicos',
        '',
        'El cedente usa el punto como separador de miles. Es _muy_ común.',
        '',
        '### La fila salió con error',
        '',
        'El motivo `CLAVE_NO_CARGADA` dice que la clave no está cargada. La variable es {{importe_cupon}}.',
    ].join('\n'),
);
const INICIO = pagina(
    '01-primeros-pasos',
    '03-inicio.md',
    ['# Inicio', '', '## Los bloques, y quién los ve', '', 'Cada bloque depende de tus permisos.', '', '## Para qué sirve', '', 'Muestra tu día.'].join(
        '\n',
    ),
);

describe('buscador de la wiki', () => {
    describe('normalizar, raiz y terminos', () => {
        it('saca acentos y signos sin cambiar las posiciones (un emoji son dos espacios)', () => {
            expect(normalizar('¿Qué es la Ñ?')).toBe(' que es la n ');
            expect(normalizar('a😀b')).toHaveLength('a😀b'.length);
        });

        it('el plural y el singular dan la misma raíz, también en las que terminan en -e (auditoría)', () => {
            for (const [plural, singular] of [
                ['bloques', 'bloque'], ['iteraciones', 'iteracion'], ['errores', 'error'], ['importes', 'importe'],
                ['nombres', 'nombre'], ['variables', 'variable'], ['meses', 'mes'], ['roles', 'rol'], ['cierres', 'cierre'],
            ]) {
                expect(raiz(plural)).toBe(raiz(singular));
            }
            expect(raiz('mes')).toBe('mes');
        });

        it('descarta las palabras vacías, también las de pregunta ("para qué sirve")', () => {
            expect(terminos('¿Para qué sirve removeDashes?')).toEqual([raiz('removedashes')]);
            expect(terminos('¿Qué son los bloques repetitivos?')).toEqual([raiz('bloques'), raiz('repetitivos')]);
        });
    });

    describe('partirEnSecciones', () => {
        it('corta por ##, ### y ####, con el camino de títulos; un # dentro de un bloque de código no es título', () => {
            const s = partirEnSecciones(PLANTILLA);
            expect(s.map((x) => x.camino.join(' › '))).toEqual([
                '',
                'Paso 5 — Mapear las columnas',
                'Paso 5 — Mapear las columnas › Bloques repetitivos',
                'Qué puede salir mal',
                'Qué puede salir mal › Los importes quedaron mil veces más chicos',
                'Qué puede salir mal › La fila salió con error',
            ]);
            const bloques = s[2];
            expect(bloques.plano).toContain('esto no es un título');
            expect(bloques.plano).toContain('el editor llama iteraciones');
            expect(bloques.plano).not.toContain('**');
        });
    });

    describe('buscar', () => {
        const b = new BuscadorWiki([INICIO, PLANTILLA]);

        it('encuentra un ### que el índice no nombra, primero que los "bloques" de Inicio (el 👎 del 18/10)', () => {
            const r = b.buscar('¿Qué son los bloques repetitivos?');
            expect(r[0]).toMatchObject({ slug: 'importacion/crear-plantilla', camino: ['Paso 5 — Mapear las columnas', 'Bloques repetitivos'] });
            expect(r[0].fragmento).toContain('bloques');
            expect(rotuloCoincidencia(r[0])).toBe(
                '[importacion/crear-plantilla] Crear una plantilla de importación › Paso 5 — Mapear las columnas › Bloques repetitivos',
            );
        });

        it('encuentra una palabra que está solo en el texto ("iteraciones")', () => {
            expect(b.buscar('iteraciones')[0]?.camino.at(-1)).toBe('Bloques repetitivos');
        });

        it('sin palabras que cuenten, o con palabras que no están en ninguna página, no devuelve nada', () => {
            expect(b.buscar('¿y eso?')).toEqual([]);
            expect(b.buscar('xyzzy')).toEqual([]);
        });

        it('una palabra que no existe en la wiki no baja la cobertura ("planillas" por "plantillas")', () => {
            const r = b.buscar('planillas bloques repetitivos', { minCobertura: 1 });
            expect(r[0]?.camino.at(-1)).toBe('Bloques repetitivos');
        });

        it('soloDistintivas: las palabras comunes no cuentan para la cobertura, y sin ninguna distintiva no hay nada', () => {
            const varias = Array.from({ length: 12 }, (_, i) =>
                pagina('09-otras', `0${i}-p${i}.md`, `# Página ${i}\n\n## Una\n\nEl archivo y la carga.\n\n## Otra\n\nEl archivo de nuevo.`),
            );
            const conRuido = new BuscadorWiki([...varias, PLANTILLA]);
            expect(conRuido.buscar('archivo carga', { soloDistintivas: true })).toEqual([]);
            const r = conRuido.buscar('en la carga del archivo hay bloques repetitivos', { soloDistintivas: true, minCobertura: 1 });
            expect(r[0]?.camino.at(-1)).toBe('Bloques repetitivos');
        });

        it('un identificador va tal cual: CLAVE_NO_CARGADA la encuentra aunque "clave" y "cargada" sean comunes (auditoría)', () => {
            const r = b.buscar('¿Qué significa CLAVE_NO_CARGADA?', { soloDistintivas: true, minCobertura: 0.5 });
            expect(r[0]?.camino.at(-1)).toBe('La fila salió con error');
            // El fragmento muestra los nombres reales, con el guion bajo; la cursiva _muy_ sí se limpia.
            expect(b.buscar('importe_cupon')[0].fragmento).toContain('{{importe_cupon}}');
            expect(partirEnSecciones(PLANTILLA)[4].plano).toContain('Es muy común.');
        });

        it('"WhatsApp" no cuenta como identificador', () => {
            const conWhatsApp = pagina('08-tel', '01-a.md', '# A\n\n## Canales\n\nWhatsApp y mail.');
            const bb = new BuscadorWiki([conWhatsApp, PLANTILLA]);
            expect(bb.buscar('WhatsApp')[0].puntaje).toBeLessThan(15);
        });

        it('limita las coincidencias por página y en total', () => {
            const r = b.buscar('bloques importes columnas cedente', { limite: 3, porPagina: 1 });
            expect(r.filter((c) => c.slug === 'importacion/crear-plantilla')).toHaveLength(1);
            expect(r.length).toBeLessThanOrEqual(3);
        });

        it('minRelativo corta lo que queda muy por debajo de la primera', () => {
            const todas = b.buscar('bloques repetitivos');
            const filtradas = b.buscar('bloques repetitivos', { minRelativo: 0.9 });
            expect(filtradas.length).toBeLessThan(todas.length);
            expect(filtradas[0]).toEqual(todas[0]);
        });
    });

    describe('sobre la wiki real', () => {
        const wiki = WikiIndice.desdeDirectorio(path.join(__dirname, '..', '..', '..', '..', '..', 'docs', 'ayuda'));
        const automatica = BUSQUEDA_AUTOMATICA;

        // Las preguntas que el índice solo no resolvía (set de evaluación, categoría G). Si alguna deja de encontrar su
        // página, la búsqueda automática del turno ya no la pone delante del modelo.
        it.each([
            ['¿Qué son los bloques repetitivos?', 'importacion/crear-plantilla'],
            ['En la carga de planillas para implementación de archivos, hay una sección de bloques repetitivos', 'importacion/crear-plantilla'],
            ['¿Qué son las iteraciones?', 'importacion/crear-plantilla'],
            ['¿Para qué sirve removeDashes?', 'importacion/importar-un-archivo'],
            ['El comentario de la acción masiva salió con {{col2}} literal, ¿por qué?', 'importacion/acciones-masivas'],
            ['Importé un archivo y los importes quedaron mil veces más chicos, ¿qué pasó?', 'importacion/crear-plantilla'],
            ['¿Qué significa CLAVE_NO_CARGADA?', 'importacion/historial-y-problemas'],
            ['¿Qué variable puedo usar en un mail?', 'telefonia-y-email/enviar-un-email'],
        ])('«%s» → %s', (pregunta, slug) => {
            expect(wiki.buscar(pregunta, automatica).map((c) => c.slug)).toContain(slug);
        });

        it('la herramienta pone primero la sección de cada identificador de la wiki (34 de 34, auditoría)', () => {
            const secciones = wiki.paginas.flatMap((p) => partirEnSecciones(p));
            const ids = new Set<string>();
            for (const p of wiki.paginas) for (const m of p.cuerpo.matchAll(/\b[A-Za-z0-9]+_[A-Za-z0-9_]+\b/g)) ids.add(m[0]);
            const fallan: string[] = [];
            for (const id of ids) {
                const objetivo = secciones.filter((s) => s.plano.toLowerCase().includes(id.toLowerCase()));
                if (objetivo.length === 0) continue;
                const r = wiki.buscar(`¿Qué significa ${id}?`, BUSQUEDA_HERRAMIENTA)[0];
                if (!r || !objetivo.some((s) => s.slug === r.slug && s.camino.join('›') === r.camino.join('›'))) fallan.push(id);
            }
            expect(ids.size).toBeGreaterThan(20);
            expect(fallan).toEqual([]);
        });

        it('una pregunta fuera de tema sin palabras distintivas no trae nada', () => {
            expect(wiki.buscar('¿y eso cómo es?', automatica)).toEqual([]);
        });

        it('se arma rápido y busca en milisegundos', () => {
            const t0 = Date.now();
            const w = WikiIndice.desdeDirectorio(path.join(__dirname, '..', '..', '..', '..', '..', 'docs', 'ayuda'));
            const t1 = Date.now();
            w.buscar('¿Qué son los bloques repetitivos?');
            expect(t1 - t0).toBeLessThan(2000);
            expect(Date.now() - t1).toBeLessThan(100);
        });
    });
});
