// utils/roles-multiarchivo.ts
import { MultiarchivoConfig, RolArchivoMultiarchivo } from '../mapping-types';

/**
 * Resolución del **rol** de cada archivo de un paquete MULTIARCHIVO a partir de su nombre.
 *
 * El operador sube los 4 archivos sueltos, como se los manda el cedente, y el orden en que los
 * selecciona no es confiable. El rol sale del nombre, con los patrones que declara la plantilla
 * (`^Deudores`, `^DetalleDeuda`, …), para que un cedente que agregue un sufijo de fecha
 * (`Deudores_20260529.txt`) siga funcionando sin tocar código.
 *
 * Esto **falla fuerte y explícito** ante cualquier duda en vez de adivinar: cargar el archivo de
 * codeudores como si fuera el de deudores generaría 55 casos basura y le pisaría la deuda a la
 * cartera. Es más barato que el operador vuelva a subir.
 */

/** Roles obligatorios: sin estos dos no hay import posible. */
const ROLES_REQUERIDOS: RolArchivoMultiarchivo[] = ['deudores', 'detalle'];

/** Nombre legible de cada rol, para los mensajes de error que ve el operador. */
const ETIQUETAS: Record<RolArchivoMultiarchivo, string> = {
    deudores: 'deudores',
    detalle: 'detalle de deuda',
    bajas: 'bajas',
    codeudores: 'codeudores',
};

export interface ArchivoSubido {
    /** Nombre original del archivo tal como lo subió el operador. */
    originalname?: string;
}

/** Índices dentro del array de archivos subidos, por rol. */
export type RolesResueltos = Partial<Record<RolArchivoMultiarchivo, number>>;

/**
 * Asocia cada archivo subido con su rol.
 *
 * @throws Error con un mensaje accionable si falta un archivo obligatorio, si sobra uno que no
 *   matchea ningún patrón, si dos archivos compiten por el mismo rol, o si un archivo matchea
 *   varios patrones (patrones mal escritos en la plantilla).
 */
export function resolverRolesArchivos(
    archivos: ArchivoSubido[],
    cfg: MultiarchivoConfig,
): RolesResueltos {
    if (!archivos || archivos.length === 0) {
        throw new Error('No se subió ningún archivo. El paquete necesita al menos Deudores y DetalleDeuda.');
    }

    const patrones = Object.entries(cfg.archivos ?? {})
        .filter(([, patron]) => !!patron)
        .map(([rol, patron]) => ({
            rol: rol as RolArchivoMultiarchivo,
            regex: compilarPatron(rol, patron as string),
        }));

    if (patrones.length === 0) {
        throw new Error('La plantilla MULTIARCHIVO no declara los patrones de nombre de los archivos.');
    }

    const roles: RolesResueltos = {};
    const sinRol: string[] = [];

    archivos.forEach((archivo, i) => {
        const nombre = basename(archivo.originalname ?? '');
        const matchean = patrones.filter((p) => p.regex.test(nombre));

        if (matchean.length === 0) {
            sinRol.push(nombre || `archivo #${i + 1}`);
            return;
        }
        if (matchean.length > 1) {
            // Patrones mal escritos en la plantilla (p. ej. "Deudores" sin anclar, que también
            // matchea "CoDeudores"). Adivinar acá es cómo se cargan carteras al revés.
            throw new Error(
                `El archivo "${nombre}" matchea más de un rol (${matchean.map((m) => ETIQUETAS[m.rol]).join(', ')}). ` +
                'Corregí los patrones de nombre en la plantilla para que sean excluyentes.',
            );
        }

        const { rol } = matchean[0];
        if (roles[rol] != null) {
            const previo = basename(archivos[roles[rol]!].originalname ?? '');
            throw new Error(
                `Se subieron dos archivos para el rol "${ETIQUETAS[rol]}": "${previo}" y "${nombre}". ` +
                'Subí uno solo de cada tipo.',
            );
        }
        roles[rol] = i;
    });

    if (sinRol.length > 0) {
        throw new Error(
            `No se pudo determinar el tipo de ${sinRol.length === 1 ? 'este archivo' : 'estos archivos'}: ` +
            `${sinRol.map((n) => `"${n}"`).join(', ')}. ` +
            'Revisá que el nombre coincida con los patrones declarados en la plantilla.',
        );
    }

    const faltantes = ROLES_REQUERIDOS.filter((rol) => roles[rol] == null);
    if (faltantes.length > 0) {
        throw new Error(
            `Falta el archivo de ${faltantes.map((r) => ETIQUETAS[r]).join(' y de ')}. ` +
            'El paquete necesita como mínimo Deudores y DetalleDeuda.',
        );
    }

    return roles;
}

/** Compila el patrón de la plantilla, con un mensaje claro si está mal escrito. */
function compilarPatron(rol: string, patron: string): RegExp {
    try {
        return new RegExp(patron, 'i');
    } catch {
        throw new Error(`El patrón de nombre del archivo de "${rol}" no es una expresión regular válida: "${patron}".`);
    }
}

/** Último segmento de la ruta: algunos navegadores mandan el path completo en `originalname`. */
function basename(nombre: string): string {
    return nombre.split(/[\\/]/).pop() ?? '';
}
