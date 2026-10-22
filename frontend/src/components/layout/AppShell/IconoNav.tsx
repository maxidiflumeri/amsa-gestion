import React from 'react';
import {
    BookOpen,
    ChartColumn,
    ClipboardList,
    House,
    LayoutDashboard,
    ShieldCheck,
    SlidersHorizontal,
    Upload,
    UserRound,
    type LucideIcon,
} from 'lucide-react';

/** Los íconos de Lucide que puede pedir `navConfig` (campo `icon`). Uno que falte cae en el de Gestión. */
const iconosNav: Record<string, LucideIcon> = {
    House,
    ClipboardList,
    LayoutDashboard,
    Upload,
    ChartColumn,
    SlidersHorizontal,
    ShieldCheck,
    BookOpen,
    UserRound,
};

const IconoNav: React.FC<{ nombre?: string; size?: number }> = ({ nombre, size = 20 }) => {
    const Componente = (nombre && iconosNav[nombre]) || ClipboardList;
    return <Componente size={size} strokeWidth={1.75} aria-hidden />;
};

export default IconoNav;
