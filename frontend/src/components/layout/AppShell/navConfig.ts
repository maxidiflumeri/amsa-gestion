export type SeccionNav = 'operacion' | 'datos' | 'configuracion' | 'pie';

export interface NavItem {
    label: string;
    /** Nombre del ícono de Lucide (ver `iconosNav` en SideNav). Solo los ítems de primer nivel lo muestran. */
    icon?: string;
    path?: string;
    children?: NavItem[];
    requiredPermissions?: string[]; // cualquiera de estos permisos habilita el item
    /** Bloque del menú donde va el ítem de primer nivel. `pie` queda abajo de todo, separado del resto. */
    seccion?: SeccionNav;
    /** Muestra un punto animado mientras hay importaciones en curso (las mismas que el chip de la barra). */
    indicador?: 'importaciones';
}

/** El título de cada bloque del menú. `pie` no lleva título. */
export const TITULOS_SECCION: Record<Exclude<SeccionNav, 'pie'>, string> = {
    operacion: 'Operación',
    datos: 'Datos',
    configuracion: 'Configuración',
};

export const navConfig: NavItem[] = [
    // Sin permiso: Inicio se arma con lo que cada uno puede ver (docs/inicio-spec.md).
    { label: 'Inicio', icon: 'House', path: '/', seccion: 'operacion' },
    {
        label: 'Gestión',
        icon: 'ClipboardList',
        path: '/gestion',
        seccion: 'operacion',
        requiredPermissions: ['deudores.ver'],
    },
    {
        label: 'Tableros',
        icon: 'LayoutDashboard',
        path: '/dashboards',
        seccion: 'operacion',
        requiredPermissions: ['dashboards.ver'],
    },
    {
        label: 'Importación',
        icon: 'Upload',
        seccion: 'datos',
        indicador: 'importaciones',
        requiredPermissions: ['importacion.ver_historial', 'importacion.ejecutar', 'plantillas_import.ver'],
        children: [
            { label: 'Nueva importación', path: '/carga', requiredPermissions: ['importacion.ejecutar'] },
            { label: 'Historial', path: '/historial-importaciones', requiredPermissions: ['importacion.ver_historial'] },
            { label: 'Plantillas', path: '/plantillas', requiredPermissions: ['plantillas_import.ver'] },
        ],
    },
    {
        label: 'Reportes',
        icon: 'ChartColumn',
        seccion: 'datos',
        requiredPermissions: ['reportes.ver'],
        children: [
            { label: 'Mis plantillas', path: '/reportes', requiredPermissions: ['reportes.ver'] },
            { label: 'Mis ejecuciones', path: '/reportes/ejecuciones', requiredPermissions: ['reportes.ver'] },
        ],
    },
    {
        label: 'Ajustes',
        icon: 'SlidersHorizontal',
        seccion: 'configuracion',
        requiredPermissions: ['empresas.ver', 'parametros.ver', 'politicas.ver', 'mora.ver'],
        children: [
            { label: 'Empresas', path: '/ajustes/empresas', requiredPermissions: ['empresas.ver'] },
            { label: 'Parámetros', path: '/ajustes/parametros', requiredPermissions: ['parametros.ver'] },
            { label: 'Políticas', path: '/ajustes/politicas', requiredPermissions: ['politicas.ver'] },
            { label: 'Recargo por mora', path: '/ajustes/mora', requiredPermissions: ['mora.ver'] },
        ],
    },
    {
        label: 'Administración',
        icon: 'ShieldCheck',
        seccion: 'configuracion',
        requiredPermissions: ['admin.gestionar_roles', 'admin.gestionar_usuarios', 'auditoria.ver', 'asistente.administrar', 'telefonia.admin'],
        children: [
            { label: 'Roles', path: '/admin/roles', requiredPermissions: ['admin.gestionar_roles'] },
            { label: 'Usuarios', path: '/admin/usuarios', requiredPermissions: ['admin.gestionar_usuarios'] },
            { label: 'Auditoría', path: '/auditoria', requiredPermissions: ['auditoria.ver'] },
            { label: 'Consumo de amaIA', path: '/asistente/consumo', requiredPermissions: ['asistente.administrar'] },
            { label: 'Neotel (test)', path: '/admin/neotel-test', requiredPermissions: ['telefonia.admin'] },
        ],
    },
    {
        label: 'Documentación',
        icon: 'BookOpen',
        path: '/ayuda',
        seccion: 'pie',
    },
];

/** Lo que la persona puede ver: los ítems sin permiso suficiente no aparecen, y un grupo sin hijos visibles tampoco. */
export function filtrarItemsPorPermisos(items: NavItem[], tienePermiso: (k: string) => boolean): NavItem[] {
    return items
        .filter((item) => {
            if (!item.requiredPermissions || item.requiredPermissions.length === 0) return true;
            return item.requiredPermissions.some((p) => tienePermiso(p));
        })
        .map((item) => ({
            ...item,
            children: item.children
                ? filtrarItemsPorPermisos(item.children, tienePermiso)
                : undefined,
        }))
        .filter((item) => !item.children || item.children.length > 0 || item.path);
}

/** Una pantalla del menú, con el grupo al que pertenece (si está dentro de uno). */
export interface PantallaNav {
    item: NavItem;
    grupo: NavItem | null;
}

/** Todas las pantallas a las que lleva el menú, en orden: los ítems sueltos y los hijos de cada grupo. */
export function pantallasDelMenu(items: NavItem[]): PantallaNav[] {
    return items.flatMap((item): PantallaNav[] =>
        item.children
            ? item.children.filter((c) => c.path).map((c) => ({ item: c, grupo: item }))
            : item.path ? [{ item, grupo: null }] : [],
    );
}

const partes = (pathname: string) => pathname.split('/').filter(Boolean);

/** Qué pantalla es: la primera parte de la ruta más la pantalla del menú (`/reportes` y `/reportes/ejecuciones` son dos). */
function claveDePantalla(pathname: string): string {
    return `${partes(pathname)[0] ?? ''}|${rutaActiva(pathname, navConfig) ?? ''}`;
}

/**
 * Si al pasar de una ruta a otra la pantalla tiene que arrancar desde arriba. Sí al cambiar de pantalla, y dentro de
 * una misma pantalla al ir de la lista a un detalle o al revés (`/plantillas` → `/plantillas/nueva`). No entre dos
 * subrutas: el armador de reportes pasa de `/reportes/7/editar` a `/reportes/nuevo` y vuelve sin desmontarse, y ahí hay
 * que conservar dónde estaba la persona.
 */
export function vuelveArriba(anterior: string, nueva: string): boolean {
    if (anterior === nueva) return false;
    if (claveDePantalla(anterior) !== claveDePantalla(nueva)) return true;
    return partes(anterior).length < 2 || partes(nueva).length < 2;
}

/**
 * La ruta del menú que corresponde a la pantalla abierta: la más larga que coincide entera o como prefijo
 * (`/historial-importaciones/12` → Historial, `/reportes/ejecuciones` → Mis ejecuciones y no Mis plantillas).
 * Inicio (`/`) solo coincide con `/`, si no ganaría siempre.
 */
export function rutaActiva(pathname: string, items: NavItem[]): string | null {
    let mejor: string | null = null;
    for (const { item } of pantallasDelMenu(items)) {
        const p = item.path!;
        const coincide = p === '/' ? pathname === '/' : pathname === p || pathname.startsWith(`${p}/`);
        if (coincide && (mejor === null || p.length > mejor.length)) mejor = p;
    }
    return mejor;
}
