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
import { TODAS_LAS_KEYS } from './permisos-catalogo';

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

        expect(faltantes).toEqual(
            // Deuda preexistente: los 4 permisos de telefonía nunca se agregaron a la copia del
            // front, así que hoy no se pueden otorgar desde la UI. Se dejan anotados en vez de
            // ocultos, para que la lista no crezca en silencio.
            ['telefonia.usar', 'telefonia.click_to_call', 'telefonia.supervisar', 'telefonia.admin'],
        );
    });

    it('el frontend no ofrece permisos que el backend no conoce', () => {
        const backend = new Set(TODAS_LAS_KEYS);
        const sobrantes = keysDelFrontend().filter((k) => !backend.has(k));
        expect(sobrantes).toEqual([]);
    });
});
