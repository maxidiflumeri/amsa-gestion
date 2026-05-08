export interface NavItem {
    label: string;
    icon: string; // nombre del icono MUI
    path?: string;
    children?: NavItem[];
}

export const navConfig: NavItem[] = [
    {
        label: 'Gestión',
        icon: 'Assignment',
        path: '/gestion',
    },
    {
        label: 'Importación de Datos',
        icon: 'UploadFile',
        children: [
            { label: 'Nueva Importación', icon: 'UploadFile', path: '/carga' },
            { label: 'Historial', icon: 'History', path: '/historial-importaciones' },
            { label: 'Plantillas', icon: 'Description', path: '/plantillas' },
        ],
    },
    {
        label: 'Reportes',
        icon: 'TableChart',
        children: [
            { label: 'Mis Plantillas (v1)', icon: 'TableChart', path: '/reportes' },
            { label: 'Reportes v2 (Beta)', icon: 'AutoGraph', path: '/reportes/v2' },
            { label: 'Mis ejecuciones (v2)', icon: 'History', path: '/reportes/v2/ejecuciones' },
            { label: 'Estadísticas', icon: 'BarChart', path: '/reportes/estadisticas' },
        ],
    },
    {
        label: 'Ajustes',
        icon: 'Settings',
        children: [
            { label: 'Empresas', icon: 'Business', path: '/ajustes/empresas' },
            { label: 'Parámetros', icon: 'SettingsInputComponent', path: '/ajustes/parametros' },
            { label: 'Políticas', icon: 'Policy', path: '/ajustes/politicas' },
        ],
    },
];
