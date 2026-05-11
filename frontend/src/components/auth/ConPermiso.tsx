import React from 'react';
import { useAuth } from '../../context/AuthContext';

interface ConPermisoProps {
    permiso: string;
    children: React.ReactNode;
    fallback?: React.ReactNode;
}

/**
 * Renderiza `children` solo si el usuario tiene el permiso indicado.
 * Si no, renderiza `fallback` (por defecto nada).
 */
const ConPermiso: React.FC<ConPermisoProps> = ({ permiso, children, fallback = null }) => {
    const { tienePermiso } = useAuth();
    return tienePermiso(permiso) ? <>{children}</> : <>{fallback}</>;
};

export default ConPermiso;
