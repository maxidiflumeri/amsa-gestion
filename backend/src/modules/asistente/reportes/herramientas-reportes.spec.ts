import { CAPACIDADES_TODAS } from './tipos-reportes';
import { armarToolsReportes, recortarMostrar, sanearTexto } from './herramientas-reportes';

describe('recortarMostrar: escapes rotos', () => {
    const r = (sugerencias: unknown[], mensaje = 'ok') => recortarMostrar({ prueba: 'p1', mensaje, sugerencias });

    it('descarta las sugerencias rotas de los turnos reales y deja las sanas', () => {
        const rotas = ['Agreg\telefono alternativo', 'Sum\ná tambi\ntambién el mail', 'Us\\\\u00e1 el 2.º teléfono'.replace('Us\\\\u00e1', 'Us\\\\ná')];
        expect(r(rotas)).toMatchObject({ sugerencias: [] });
        expect(r(['Agregá el teléfono alternativo', 'Pasalo a CSV'])).toMatchObject({ sugerencias: ['Agregá el teléfono alternativo', 'Pasalo a CSV'] });
    });

    it('decodifica los \\uXXXX literales (también con barras de más)', () => {
        expect(r(['Us\\u00e1 el segundo tel\\u00e9fono']).sugerencias).toEqual(['Usá el segundo teléfono']);
        expect(r(['Us\\\\u00e1 el segundo']).sugerencias).toEqual(['Usá el segundo']);
    });

    it('descarta una que siga con barras después de decodificar', () => {
        expect(r(['Pasalo\\a CSV']).sugerencias).toEqual([]);
    });

    it('al mensaje le saca los controles y decodifica, pero conserva los saltos de línea', () => {
        expect(r([], 'Usé solo TOYOTA.\nTambi\\u00e9n hay otras.\u0007').mensaje).toBe('Usé solo TOYOTA.\nTambién hay otras.');
        expect(sanearTexto('a\tb\r\nc', true)).toBe('a b\nc');
    });

    it('hasta 3 sugerencias de 60 caracteres', () => {
        const largas = Array.from({ length: 5 }, (_, i) => `Sugerencia número ${i} ${'x'.repeat(80)}`);
        const s = r(largas).sugerencias;
        expect(s).toHaveLength(3);
        expect(s.every((x) => Array.from(x).length <= 60)).toBe(true);
    });
});

describe('herramientas', () => {
    it('orden fijo y probar_plantilla sin strict por defecto', () => {
        const t = armarToolsReportes(CAPACIDADES_TODAS, true) as unknown as { name: string; strict?: boolean }[];
        expect(t.map((x) => x.name)).toEqual(['valores_de_campo', 'datos_adicionales', 'ver_otra_hoja', 'probar_plantilla', 'mostrar_propuesta']);
        expect(t.find((x) => x.name === 'probar_plantilla')?.strict).toBeUndefined();
        expect((armarToolsReportes(CAPACIDADES_TODAS, true, true) as unknown as { name: string; strict?: boolean }[]).find((x) => x.name === 'probar_plantilla')?.strict).toBe(true);
    });
});
