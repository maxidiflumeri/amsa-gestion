export interface NavItem {
    label: string;
    icon: string; // nombre del icono MUI
    path?: string;
    children?: NavItem[];
    requiredPermissions?: string[]; // cualquiera de estos permisos habilita el item
}

export const navConfig: NavItem[] = [
    {
        label: 'Gestión',
        icon: 'Assignment',
        path: '/gestion',
        requiredPermissions: ['deudores.ver'],
    },
    {
        label: 'Tableros',
        icon: 'Dashboard',
        path: '/dashboards',
        requiredPermissions: ['dashboards.ver'],
    },
    {
        label: 'Importación de Datos',
        icon: 'UploadFile',
        requiredPermissions: ['importacion.ver_historial', 'importacion.ejecutar', 'plantillas_import.ver'],
        children: [
            { label: 'Nueva Importación', icon: 'UploadFile', path: '/carga', requiredPermissions: ['importacion.ejecutar'] },
            { label: 'Historial', icon: 'History', path: '/historial-importaciones', requiredPermissions: ['importacion.ver_historial'] },
            { label: 'Plantillas', icon: 'Description', path: '/plantillas', requiredPermissions: ['plantillas_import.ver'] },
        ],
    },
    {
        label: 'Reportes',
        icon: 'TableChart',
        requiredPermissions: ['reportes.ver'],
        children: [
            { label: 'Mis plantillas', icon: 'AutoGraph', path: '/reportes', requiredPermissions: ['reportes.ver'] },
            { label: 'Mis ejecuciones', icon: 'History', path: '/reportes/ejecuciones', requiredPermissions: ['reportes.ver'] },
        ],
    },
    {
        label: 'Ajustes',
        icon: 'Tune',
        requiredPermissions: ['empresas.ver', 'parametros.ver', 'politicas.ver'],
        children: [
            { label: 'Empresas', icon: 'Business', path: '/ajustes/empresas', requiredPermissions: ['empresas.ver'] },
            { label: 'Parámetros', icon: 'SettingsInputComponent', path: '/ajustes/parametros', requiredPermissions: ['parametros.ver'] },
            { label: 'Políticas', icon: 'Policy', path: '/ajustes/politicas', requiredPermissions: ['politicas.ver'] },
        ],
    },
    {
        label: 'Administración',
        icon: 'AdminPanelSettings',
        requiredPermissions: ['admin.gestionar_roles', 'admin.gestionar_usuarios', 'auditoria.ver'],
        children: [
            { label: 'Roles', icon: 'Shield', path: '/admin/roles', requiredPermissions: ['admin.gestionar_roles'] },
            { label: 'Usuarios', icon: 'People', path: '/admin/usuarios', requiredPermissions: ['admin.gestionar_usuarios'] },
            { label: 'Auditoría', icon: 'FactCheck', path: '/auditoria', requiredPermissions: ['auditoria.ver'] },
            { label: 'Neotel (test)', icon: 'Phone', path: '/admin/neotel-test', requiredPermissions: ['telefonia.usar'] },
        ],
    },
];
