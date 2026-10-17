import * as fs from 'fs';
import * as path from 'path';
import { TODAS_LAS_KEYS } from '../../../auth/permisos-catalogo';
import {
    RUTAS_CATALOGO,
    RUTAS_EXCLUIDAS,
    etiquetasDePermisos,
    mapaDePantallas,
    rutaCanonica,
    rutasAbribles,
    validarIrA,
} from './rutas-catalogo';

const FRONT = path.resolve(__dirname, '../../../../../frontend/src');
const APP_ROUTES = path.join(FRONT, 'routes', 'AppRoutes.tsx');
const NAV_CONFIG = path.join(FRONT, 'components', 'layout', 'AppShell', 'navConfig.ts');
const hayFrontend = fs.existsSync(APP_ROUTES) && fs.existsSync(NAV_CONFIG);
const describeSiHayFront = hayFrontend ? describe : describe.skip;

// Los 13 permisos del rol OPERADOR en prod.
const OPERADOR = [
    'deudores.ver', 'comentarios.ver', 'comentarios.crear', 'comentarios.eliminar', 'convenios.ver', 'empresas.ver',
    'importacion.ver_historial', 'plantillas_import.ver', 'parametros.ver', 'politicas.ver', 'reportes.ver',
    'reportes.ejecutar', 'telefonia.usar',
];

/** Rutas absolutas de `<Route path="…">`: las anidadas bajo "/" son relativas. `ayuda/*` documenta `/ayuda`. */
function rutasDelFrontend(): Set<string> {
    const src = fs.readFileSync(APP_ROUTES, 'utf8');
    const rutas = new Set<string>(['/']);
    for (const m of src.matchAll(/<Route\s+path="([^"]+)"/g)) {
        let r = m[1].replace(/\/\*$/, '');
        if (!r.startsWith('/')) r = `/${r}`;
        rutas.add(r);
    }
    return rutas;
}

describe('rutas-catalogo', () => {
    it('cada permiso del catálogo existe en el catálogo de permisos', () => {
        const claves = new Set(TODAS_LAS_KEYS);
        const inexistentes = RUTAS_CATALOGO.flatMap((r) => r.permisos).filter((p) => !claves.has(p));
        expect(inexistentes).toEqual([]);
    });

    it('no repite rutas', () => {
        const rutas = RUTAS_CATALOGO.map((r) => r.ruta);
        expect(new Set(rutas).size).toBe(rutas.length);
    });

    describe('validarIrA', () => {
        it('OPERADOR: /reportes sí, /reportes/nuevo no (le falta Crear reportes)', () => {
            expect(validarIrA('/reportes', OPERADOR).ok).toBe(true);
            const r = validarIrA('/reportes/nuevo', OPERADOR);
            expect(r).toMatchObject({ ok: false, motivo: 'SIN_PERMISO', faltan: ['reportes.crear'] });
        });

        it('una pantalla sin permisos la abre cualquiera; una que no existe no', () => {
            expect(validarIrA('/', []).ok).toBe(true);
            expect(validarIrA('/ayuda', []).ok).toBe(true);
            expect(validarIrA('/no-existe', OPERADOR)).toMatchObject({ ok: false, motivo: 'NO_EXISTE' });
            expect(validarIrA('/admin/neotel-test', OPERADOR)).toMatchObject({ ok: false, motivo: 'NO_EXISTE' });
        });

        it('alcanza con cualquiera de los permisos de la pantalla', () => {
            expect(validarIrA('/gestion', ['deudores.ver']).ok).toBe(true);
            expect(validarIrA('/gestion', ['comentarios.ver']).ok).toBe(false);
        });
    });

    describe('rutaCanonica', () => {
        it.each([
            ['/gestion?q=perez', '/gestion'],
            ['/gestion#ficha', '/gestion'],
            ['/gestion/', '/gestion'],
            ['/plantillas/12/editar', '/plantillas'],
            ['/plantillas/nueva', '/plantillas/nueva'],
            ['/reportes/ejecuciones', '/reportes/ejecuciones'],
            ['/reportes/7/ejecutar', '/reportes'],
            ['/historial-importaciones/55', '/historial-importaciones'],
            ['/', '/'],
            ['/xyz', '/xyz'],
        ])('%s → %s', (entrada, esperada) => {
            expect(rutaCanonica(entrada)).toBe(esperada);
        });
    });

    it('rutasAbribles y etiquetasDePermisos siguen el orden del catálogo', () => {
        expect(rutasAbribles(OPERADOR)).toEqual([
            '/', '/gestion', '/historial-importaciones', '/plantillas', '/reportes', '/reportes/ejecuciones',
            '/ajustes/empresas', '/ajustes/parametros', '/ajustes/politicas', '/ayuda',
        ]);
        expect(etiquetasDePermisos(['reportes.crear', 'deudores.ver', 'no.existe'])).toEqual(
            expect.arrayContaining(['Ver deudores', 'Crear reportes']),
        );
        expect(etiquetasDePermisos(['no.existe'])).toEqual([]);
    });

    it('el mapa de pantallas muestra la etiqueta del permiso, no la clave, y es estable', () => {
        const mapa = mapaDePantallas();
        expect(mapa).toContain('/reportes/nuevo | Nueva plantilla de reportes | Crear reportes');
        expect(mapa).toContain('/ayuda | Documentación | ninguno');
        expect(mapa).not.toMatch(/\w+\.\w+ *$/m);
        expect(mapaDePantallas()).toBe(mapa);
    });

    describeSiHayFront('alineado con el frontend', () => {
        // Hasta que el paquete FE agregue la ruta /asistente/consumo, ESTE test falla solo por esa ruta: es lo esperado.
        it('cada ruta del catálogo existe en AppRoutes.tsx', () => {
            const front = rutasDelFrontend();
            const faltan = RUTAS_CATALOGO.map((r) => r.ruta).filter((r) => !front.has(r));
            expect(faltan).toEqual([]);
        });

        it('cada path de navConfig.ts está en el catálogo o en la lista de excluidas', () => {
            const src = fs.readFileSync(NAV_CONFIG, 'utf8');
            const paths = [...src.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]);
            expect(paths.length).toBeGreaterThan(5);
            const catalogo = new Set(RUTAS_CATALOGO.map((r) => r.ruta));
            const sinCubrir = paths.filter((p) => !catalogo.has(p) && !RUTAS_EXCLUIDAS.includes(p));
            expect(sinCubrir).toEqual([]);
        });
    });
});
