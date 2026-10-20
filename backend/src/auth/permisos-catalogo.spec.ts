/**
 * El catálogo de permisos está DUPLICADO: existe acá y otra vez en
 * `frontend/src/utils/permisosCatalogo.ts`, que es el que lee la pantalla de Roles. El front NO pide
 * el catálogo al backend, aunque el endpoint `GET /roles/permisos-catalogo` exista.
 *
 * Cuando las dos copias se desincronizan pasa algo silencioso y molesto de diagnosticar: el permiso
 * existe y el guard lo exige, pero **no se puede otorgar desde la UI**, así que la funcionalidad
 * queda invisible sin ningún error a la vista. Pasó al agregar el módulo de mora (ago-2026).
 *
 * Este test compara las dos listas. Si falla, agregá el permiso que falta en la copia del front.
 *
 * Se saltea solo si no encuentra el archivo del front: en la imagen de Docker se copia únicamente
 * `backend/`, así que ahí el archivo no está y no tiene sentido fallar.
 */
import * as fs from 'fs';
import * as path from 'path';
import { TODAS_LAS_KEYS, TODOS_LOS_PERMISOS } from './permisos-catalogo';

const RUTA_FRONT = path.resolve(__dirname, '../../../frontend/src/utils/permisosCatalogo.ts');

/** Saca las keys del archivo del front sin importarlo (es TS de otro paquete, fuera del tsconfig). */
function keysDelFrontend(): string[] {
    const src = fs.readFileSync(RUTA_FRONT, 'utf8');
    return [...src.matchAll(/key:\s*['"]([a-z_]+\.[a-z_]+)['"]/g)].map((m) => m[1]);
}

const hayFrontend = fs.existsSync(RUTA_FRONT);
const describeSiHayFront = hayFrontend ? describe : describe.skip;

describeSiHayFront('catálogo de permisos: backend y frontend en sincronía', () => {
    it('todo permiso del backend se puede otorgar desde la pantalla de Roles', () => {
        const front = new Set(keysDelFrontend());
        const faltantes = TODAS_LAS_KEYS.filter((k) => !front.has(k));

        // Sin excepciones: todo permiso que el backend valida se tiene que poder otorgar desde la
        // pantalla de Roles. Los 4 de telefonía eran deuda preexistente y ya están.
        expect(faltantes).toEqual([]);
    });

    it('el frontend no ofrece permisos que el backend no conoce', () => {
        const backend = new Set(TODAS_LAS_KEYS);
        const sobrantes = keysDelFrontend().filter((k) => !backend.has(k));
        expect(sobrantes).toEqual([]);
    });
});

/** Etiqueta y descripción de cada permiso `asistente.*` del front, leídas del texto sin importar el archivo. */
function asistenteDelFrontend(): Map<string, { label: string; descripcion: string }> {
    const src = fs.readFileSync(RUTA_FRONT, 'utf8');
    const re = /key:\s*'(asistente\.[a-z_]+)'\s*,\s*label:\s*'([^']*)'\s*,\s*descripcion:\s*'([^']*)'/g;
    return new Map([...src.matchAll(re)].map((m) => [m[1], { label: m[2], descripcion: m[3] }]));
}

describeSiHayFront('catálogo de permisos: el texto del asistente es el mismo en las dos copias', () => {
    it('etiqueta y descripción de cada permiso de la sección Asistente (Roles muestra la del front)', () => {
        const seccion = TODOS_LOS_PERMISOS.find((s) => s.seccion === 'Asistente')!;
        const front = asistenteDelFrontend();
        expect(front.size).toBe(seccion.permisos.length);
        for (const p of seccion.permisos) {
            expect({ key: p.key, ...front.get(p.key) }).toEqual({ key: p.key, label: p.label, descripcion: p.descripcion });
        }
    });

    it('ninguna descripción del asistente dice «Próximamente»', () => {
        for (const [, v] of asistenteDelFrontend()) expect(v.descripcion).not.toMatch(/Próximamente/);
    });
});

describe('catálogo de permisos: asistente', () => {
    it('declara los cuatro permisos del asistente (sin esto no aparecen en Roles y nadie los puede asignar)', () => {
        expect(TODAS_LAS_KEYS).toEqual(
            expect.arrayContaining(['asistente.usar', 'asistente.reportes', 'asistente.administrar', 'asistente.ver_detalle']),
        );
    });

    it('ver_detalle va en la sección Asistente, después de Administrar', () => {
        const claves = TODOS_LOS_PERMISOS.find((s) => s.seccion === 'Asistente')!.permisos.map((p) => p.key);
        expect(claves.indexOf('asistente.ver_detalle')).toBe(claves.indexOf('asistente.administrar') + 1);
    });

    it('no repite claves', () => {
        expect(new Set(TODAS_LAS_KEYS).size).toBe(TODAS_LAS_KEYS.length);
    });
});
