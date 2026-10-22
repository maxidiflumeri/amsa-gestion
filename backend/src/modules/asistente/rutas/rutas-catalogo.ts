import { TODOS_LOS_PERMISOS } from '../../../auth/permisos-catalogo';

/**
 * Pantallas a las que el asistente puede ofrecer llevar a la persona (docs/asistente-spec.md §8.4).
 * Fuente: `frontend/src/routes/AppRoutes.tsx` y `navConfig.ts`. Solo rutas sin parámetros. Fuera a propósito:
 * `/admin/neotel-test` (prueba), `/telefonia*` (iframe sin barra), `/login` y las rutas con `:id`.
 * `rutas-catalogo.spec.ts` lo compara con el frontend.
 */
export interface RutaCatalogo {
    ruta: string;
    nombre: string;
    /** La persona puede abrirla si tiene cualquiera de estos permisos. Vacío = cualquiera con sesión. */
    permisos: string[];
}

export const RUTAS_CATALOGO: RutaCatalogo[] = [
    { ruta: '/', nombre: 'Inicio', permisos: [] },
    { ruta: '/gestion', nombre: 'Gestión', permisos: ['deudores.ver'] },
    { ruta: '/dashboards', nombre: 'Tableros', permisos: ['dashboards.ver'] },
    { ruta: '/carga', nombre: 'Nueva importación', permisos: ['importacion.ejecutar'] },
    { ruta: '/historial-importaciones', nombre: 'Historial de importaciones', permisos: ['importacion.ver_historial'] },
    { ruta: '/plantillas', nombre: 'Plantillas de importación', permisos: ['plantillas_import.ver'] },
    { ruta: '/plantillas/nueva', nombre: 'Nueva plantilla de importación', permisos: ['plantillas_import.crear'] },
    { ruta: '/reportes', nombre: 'Reportes: mis plantillas', permisos: ['reportes.ver'] },
    { ruta: '/reportes/nuevo', nombre: 'Nueva plantilla de reportes', permisos: ['reportes.crear'] },
    { ruta: '/reportes/ejecuciones', nombre: 'Reportes: mis ejecuciones', permisos: ['reportes.ver'] },
    { ruta: '/ajustes/empresas', nombre: 'Empresas', permisos: ['empresas.ver'] },
    { ruta: '/ajustes/parametros', nombre: 'Parámetros', permisos: ['parametros.ver'] },
    { ruta: '/ajustes/politicas', nombre: 'Políticas', permisos: ['politicas.ver'] },
    { ruta: '/ajustes/mora', nombre: 'Recargo por mora', permisos: ['mora.ver'] },
    { ruta: '/ayuda', nombre: 'Documentación', permisos: [] },
    { ruta: '/perfil', nombre: 'Mi perfil', permisos: [] },
    { ruta: '/admin/roles', nombre: 'Roles', permisos: ['admin.gestionar_roles'] },
    { ruta: '/admin/usuarios', nombre: 'Usuarios', permisos: ['admin.gestionar_usuarios'] },
    { ruta: '/auditoria', nombre: 'Auditoría', permisos: ['auditoria.ver'] },
    { ruta: '/asistente/consumo', nombre: 'Consumo de amaIA', permisos: ['asistente.administrar'] },
];

/** Pantallas del frontend que están a propósito fuera del catálogo (las usa el test de alineación). */
export const RUTAS_EXCLUIDAS = ['/admin/neotel-test'];

const ETIQUETAS: Map<string, string> = new Map(
    TODOS_LOS_PERMISOS.flatMap((s) => s.permisos.map((p) => [p.key, p.label] as const)),
);

/** El nombre legible de un permiso (el que se ve en Roles). Si no está en el catálogo, la clave. */
export function etiquetaPermiso(clave: string): string {
    return ETIQUETAS.get(clave) ?? clave;
}

/** Las etiquetas de los permisos de una persona, en el orden del catálogo (determinista). Ignora claves que no existen. */
export function etiquetasDePermisos(permisos: string[]): string[] {
    const tiene = new Set(permisos);
    return [...ETIQUETAS.entries()].filter(([clave]) => tiene.has(clave)).map(([, etiqueta]) => etiqueta);
}

export function limpiarRuta(ruta: string): string {
    let r = String(ruta ?? '').split('#')[0].split('?')[0].trim();
    if (!r.startsWith('/')) r = `/${r}`;
    if (r.length > 1) r = r.replace(/\/+$/, '');
    return r || '/';
}

/**
 * La entrada del catálogo que corresponde a una ruta del navegador: por **prefijo más largo** (mismo criterio que
 * `paginasParaRuta` del frontend). `/plantillas/12/editar` → `/plantillas`. Sin coincidencia, `entrada` es null y
 * `canonica` es la ruta limpia.
 */
export function resolverRuta(ruta: string): { canonica: string; entrada: RutaCatalogo | null } {
    const r = limpiarRuta(ruta);
    let mejor: RutaCatalogo | null = null;
    for (const e of RUTAS_CATALOGO) {
        const coincide = e.ruta === '/' ? r === '/' : r === e.ruta || r.startsWith(`${e.ruta}/`);
        if (coincide && (!mejor || e.ruta.length > mejor.ruta.length)) mejor = e;
    }
    return mejor ? { canonica: mejor.ruta, entrada: mejor } : { canonica: r, entrada: null };
}

export function rutaCanonica(ruta: string): string {
    return resolverRuta(ruta).canonica;
}

export function puedeAbrir(entrada: RutaCatalogo, permisos: string[]): boolean {
    return entrada.permisos.length === 0 || entrada.permisos.some((p) => permisos.includes(p));
}

export type ResultadoIrA =
    | { ok: true; entrada: RutaCatalogo }
    | { ok: false; motivo: 'NO_EXISTE' }
    | { ok: false; motivo: 'SIN_PERMISO'; entrada: RutaCatalogo; faltan: string[] };

/** ¿Puede esta persona abrir esta pantalla? Coincidencia exacta con el catálogo (la herramienta tiene un enum). */
export function validarIrA(ruta: string, permisos: string[]): ResultadoIrA {
    const entrada = RUTAS_CATALOGO.find((e) => e.ruta === ruta);
    if (!entrada) return { ok: false, motivo: 'NO_EXISTE' };
    if (!puedeAbrir(entrada, permisos)) return { ok: false, motivo: 'SIN_PERMISO', entrada, faltan: entrada.permisos };
    return { ok: true, entrada };
}

/** Rutas que la persona puede abrir, en el orden del catálogo. */
export function rutasAbribles(permisos: string[]): string[] {
    return RUTAS_CATALOGO.filter((e) => puedeAbrir(e, permisos)).map((e) => e.ruta);
}

/** El mapa de pantallas del prompt: muestra la etiqueta del permiso, no la clave. Estable byte a byte. */
export function mapaDePantallas(): string {
    const filas = RUTAS_CATALOGO.map((e) => {
        const pide = e.permisos.length ? e.permisos.map(etiquetaPermiso).join(' o ') : 'ninguno';
        return `${e.ruta} | ${e.nombre} | ${pide}`;
    });
    return ['ruta | pantalla | permiso que pide', ...filas].join('\n');
}
