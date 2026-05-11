import React from 'react';
import { useAuth } from '../../context/AuthContext';

interface PermisoGuardProps {
    /** Un solo permiso requerido. */
    permiso?: string;
    /** Al menos uno de estos permisos debe estar presente (OR). */
    alguno?: string[];
    /** Todos estos permisos deben estar presentes (AND). */
    todos?: string[];
    children: React.ReactNode;
    /** Elemento a mostrar si no cumple el requisito. Por defecto null. */
    fallback?: React.ReactNode;
}

/**
 * Guard de permisos inline para el frontend.
 *
 * Uso:
 *   <PermisoGuard permiso="empresas.crear">...</PermisoGuard>
 *   <PermisoGuard alguno={['admin.gestionar_roles', 'admin.gestionar_usuarios']}>...</PermisoGuard>
 *   <PermisoGuard todos={['reportes.ver', 'reportes.crear']}>...</PermisoGuard>
 */
const PermisoGuard: React.FC<PermisoGuardProps> = ({
    permiso,
    alguno,
    todos,
    children,
    fallback = null,
}) => {
    const { tienePermiso, tieneAlguno } = useAuth();

    let permitido = true;

    if (permiso) {
        permitido = tienePermiso(permiso);
    } else if (alguno && alguno.length > 0) {
        permitido = tieneAlguno(...alguno);
    } else if (todos && todos.length > 0) {
        permitido = todos.every((k) => tienePermiso(k));
    }

    return permitido ? <>{children}</> : <>{fallback}</>;
};

export default PermisoGuard;
