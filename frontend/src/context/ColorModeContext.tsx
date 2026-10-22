import React, { createContext, useContext, useState, useMemo, useEffect } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { PaletteMode } from '@mui/material';
import { buildTheme } from '../theme/index';

/** Lo que elige la persona. `system` sigue la configuración de la computadora o el celular, y cambia si esa cambia. */
export type PreferenciaTema = PaletteMode | 'system';

interface ColorModeContextType {
    toggleColorMode: () => void;
    /** El modo que se ve (con `system`, el que resulta de la configuración del equipo). */
    mode: PaletteMode;
    preferencia: PreferenciaTema;
    setPreferencia: (p: PreferenciaTema) => void;
}

export const ColorModeContext = createContext<ColorModeContextType>({
    toggleColorMode: () => {},
    mode: 'light',
    preferencia: 'light',
    setPreferencia: () => {},
});

export const useColorMode = () => useContext(ColorModeContext);

const CLAVE = 'app_theme_mode';
const CONSULTA_OSCURO = '(prefers-color-scheme: dark)';

function leerPreferencia(): PreferenciaTema {
    try {
        const guardada = localStorage.getItem(CLAVE);
        return guardada === 'dark' || guardada === 'light' || guardada === 'system' ? guardada : 'light';
    } catch {
        return 'light';
    }
}

const sistemaOscuro = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(CONSULTA_OSCURO).matches;

export const ColorModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [preferencia, setPreferencia] = useState<PreferenciaTema>(leerPreferencia);
    const [oscuroDelSistema, setOscuroDelSistema] = useState<boolean>(sistemaOscuro);

    useEffect(() => {
        try {
            localStorage.setItem(CLAVE, preferencia);
        } catch {
            /* ventana privada o datos bloqueados: el tema vale mientras dure la pestaña */
        }
    }, [preferencia]);

    // Con `system`, seguir los cambios del equipo (el modo oscuro automático de la noche, por ejemplo).
    useEffect(() => {
        if (preferencia !== 'system' || typeof window.matchMedia !== 'function') return;
        const consulta = window.matchMedia(CONSULTA_OSCURO);
        const alCambiar = () => setOscuroDelSistema(consulta.matches);
        alCambiar();
        consulta.addEventListener?.('change', alCambiar);
        return () => consulta.removeEventListener?.('change', alCambiar);
    }, [preferencia]);

    const mode: PaletteMode = preferencia === 'system' ? (oscuroDelSistema ? 'dark' : 'light') : preferencia;

    const colorMode = useMemo(
        () => ({
            toggleColorMode: () => setPreferencia(mode === 'light' ? 'dark' : 'light'),
            mode,
            preferencia,
            setPreferencia,
        }),
        [mode, preferencia],
    );

    const theme = useMemo(() => buildTheme(mode), [mode]);

    return (
        <ColorModeContext.Provider value={colorMode}>
            <ThemeProvider theme={theme}>
                {children}
            </ThemeProvider>
        </ColorModeContext.Provider>
    );
};
