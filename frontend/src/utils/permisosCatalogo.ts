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
            { key: 'deudores.acciones_masivas', label: 'Acciones masivas', descripcion: 'Ejecutar y revertir importaciones de acciones masivas sobre la base' },
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
        seccion: 'Pagos',
        permisos: [
            { key: 'pagos.ver', label: 'Ver pagos' },
            { key: 'pagos.crear', label: 'Cargar pagos manuales' },
            { key: 'pagos.eliminar', label: 'Eliminar pagos manuales' },
        ],
    },
    {
        seccion: 'Promesas de Pago',
        permisos: [
            { key: 'promesas.ver', label: 'Ver promesas de pago' },
            { key: 'promesas.crear', label: 'Cargar promesas de pago' },
            { key: 'promesas.cancelar', label: 'Anular promesas de pago' },
            { key: 'promesas.procesar_vencidas', label: 'Procesar promesas vencidas (batch)' },
        ],
    },
    {
        seccion: 'Importación',
        permisos: [
            { key: 'importacion.ejecutar', label: 'Ejecutar importaciones' },
            { key: 'importacion.ver_historial', label: 'Ver historial de importaciones' },
            { key: 'importacion.ver_progreso_otros', label: 'Ver importaciones de otros usuarios' },
            { key: 'importacion.eliminar', label: 'Eliminar importaciones', descripcion: 'Permite eliminar remesas en estado PENDIENTE, FALLIDA o FINALIZADA' },
            { key: 'consolidacion.ejecutar', label: 'Ejecutar consolidación de situación', descripcion: 'Recalcula saldo y código de situación según pagos cargados' },
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
        seccion: 'Reportes',
        permisos: [
            { key: 'reportes.ver', label: 'Ver reportes' },
            { key: 'reportes.crear', label: 'Crear reportes' },
            { key: 'reportes.editar', label: 'Editar reportes' },
            { key: 'reportes.eliminar', label: 'Eliminar reportes' },
            { key: 'reportes.ejecutar', label: 'Ejecutar reportes' },
            { key: 'reportes.ver_ejecuciones', label: 'Ver todas las ejecuciones', descripcion: 'Puede ver ejecuciones de todos los usuarios' },
            { key: 'reportes.gestionar_formatos', label: 'Gestionar formatos de exportación' },
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
    {
        seccion: 'Tableros',
        permisos: [
            { key: 'dashboards.ver', label: 'Ver tableros' },
            { key: 'dashboards.ver_todas_empresas', label: 'Ver tableros de todas las empresas', descripcion: 'Sin esta key, solo ve la empresa propia' },
            { key: 'dashboards.exportar', label: 'Exportar tableros a PDF/XLS' },
        ],
    },
    {
        seccion: 'Auditoría',
        permisos: [
            { key: 'auditoria.ver', label: 'Ver auditoría', descripcion: 'Ve sus propias acciones registradas' },
            { key: 'auditoria.ver_todos', label: 'Ver auditoría de todos', descripcion: 'Ve registros de todos los usuarios' },
            { key: 'auditoria.exportar', label: 'Exportar auditoría' },
        ],
    },
    {
        seccion: 'Email',
        permisos: [
            { key: 'email.enviar', label: 'Enviar emails a deudores', descripcion: 'Habilita el envío manual de mails vía AMSA Sender' },
            { key: 'email.administrar', label: 'Administrar cuentas SMTP de empresas', descripcion: 'Asignar la cuenta SMTP de cada empresa' },
        ],
    },
];

export const TODAS_LAS_KEYS: string[] = TODOS_LOS_PERMISOS.flatMap((s) =>
    s.permisos.map((p) => p.key),
);
