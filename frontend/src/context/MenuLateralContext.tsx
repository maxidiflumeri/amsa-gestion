import { createContext, useContext } from 'react';

/** Si el menú lateral va achicado (solo íconos). El estado vive en `AppShell`; «Mi perfil» lo cambia desde acá. */
export interface MenuLateral {
    colapsado: boolean;
    setColapsado: (colapsado: boolean) => void;
}

export const MenuLateralContext = createContext<MenuLateral | null>(null);

/** `null` fuera de `AppShell` (la Toolbar de Neotel no tiene menú). */
export const useMenuLateral = () => useContext(MenuLateralContext);
