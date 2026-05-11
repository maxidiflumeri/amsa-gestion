export interface PermisoItem {
    key: string;
    label: string;
    descripcion?: string;
}

export interface PermisoSeccion {
    seccion: string;
    permisos: PermisoItem[];
}

export const TODOS_LOS_PERMISOS: PermisoSeccion[] = [
    {
        seccion: 'Deudores',
        permisos: [
            { key: 'deudores.ver', label: 'Ver deudores' },
            { key: 'deudores.editar_estado', label: 'Editar estado de deudores' },
            { key: 'deudores.exportar', label: 'Exportar deudores' },
        ],
    },
    {
        seccion: 'Comentarios',
        permisos: [
            { key: 'comentarios.ver', label: 'Ver comentarios' },
            { key: 'comentarios.crear', label: 'Crear comentarios' },
            { key: 'comentarios.eliminar', label: 'Eliminar comentarios propios', descripcion: 'Solo puede eliminar sus propios comentarios' },
        ],
    },
    {
        seccion: 'Convenios',
        permisos: [
            { key: 'convenios.ver', label: 'Ver convenios' },
            { key: 'convenios.crear', label: 'Crear convenios' },
            { key: 'convenios.cancelar', label: 'Cancelar convenios' },
            { key: 'convenios.registrar_pago', label: 'Registrar pagos de convenios' },
        ],
    },
    {
        seccion: 'Importación',
        permisos: [
            { key: 'importacion.ejecutar', label: 'Ejecutar importaciones' },
            { key: 'importacion.ver_historial', label: 'Ver historial de importaciones' },
        ],
    },
    {
        seccion: 'Plantillas de Importación',
        permisos: [
            { key: 'plantillas_import.ver', label: 'Ver plantillas de importación' },
            { key: 'plantillas_import.crear', label: 'Crear plantillas de importación' },
            { key: 'plantillas_import.editar', label: 'Editar plantillas de importación' },
            { key: 'plantillas_import.eliminar', label: 'Eliminar plantillas de importación' },
        ],
    },
    {
        seccion: 'Reportes v1',
        permisos: [
            { key: 'reportes.v1.ver', label: 'Ver reportes v1' },
            { key: 'reportes.v1.crear', label: 'Crear reportes v1' },
            { key: 'reportes.v1.editar', label: 'Editar reportes v1' },
            { key: 'reportes.v1.eliminar', label: 'Eliminar reportes v1' },
            { key: 'reportes.v1.ejecutar', label: 'Ejecutar reportes v1' },
        ],
    },
    {
        seccion: 'Reportes v2',
        permisos: [
            { key: 'reportes.v2.ver', label: 'Ver reportes v2' },
            { key: 'reportes.v2.crear', label: 'Crear reportes v2' },
            { key: 'reportes.v2.editar', label: 'Editar reportes v2' },
            { key: 'reportes.v2.eliminar', label: 'Eliminar reportes v2' },
            { key: 'reportes.v2.ejecutar', label: 'Ejecutar reportes v2' },
            { key: 'reportes.v2.ver_ejecuciones', label: 'Ver todas las ejecuciones', descripcion: 'Puede ver ejecuciones de todos los usuarios' },
            { key: 'reportes.v2.gestionar_formatos', label: 'Gestionar formatos de exportación' },
        ],
    },
    {
        seccion: 'Empresas',
        permisos: [
            { key: 'empresas.ver', label: 'Ver empresas' },
            { key: 'empresas.crear', label: 'Crear empresas' },
            { key: 'empresas.editar', label: 'Editar empresas' },
            { key: 'empresas.eliminar', label: 'Eliminar empresas' },
        ],
    },
    {
        seccion: 'Parámetros',
        permisos: [
            { key: 'parametros.ver', label: 'Ver parámetros' },
            { key: 'parametros.crear', label: 'Crear parámetros' },
            { key: 'parametros.editar', label: 'Editar parámetros' },
            { key: 'parametros.eliminar', label: 'Eliminar parámetros' },
        ],
    },
    {
        seccion: 'Políticas',
        permisos: [
            { key: 'politicas.ver', label: 'Ver políticas' },
            { key: 'politicas.crear', label: 'Crear políticas' },
            { key: 'politicas.editar', label: 'Editar políticas' },
            { key: 'politicas.eliminar', label: 'Eliminar políticas' },
        ],
    },
    {
        seccion: 'Administración',
        permisos: [
            { key: 'admin.gestionar_roles', label: 'Gestionar roles' },
            { key: 'admin.gestionar_usuarios', label: 'Gestionar usuarios' },
        ],
    },
];

export const TODAS_LAS_KEYS: string[] = TODOS_LOS_PERMISOS.flatMap((s) =>
    s.permisos.map((p) => p.key),
);
