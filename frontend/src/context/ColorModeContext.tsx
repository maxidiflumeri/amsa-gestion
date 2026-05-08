import React, { createContext, useContext, useState, useMemo, useEffect } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { PaletteMode } from '@mui/material';
import { buildTheme } from '../theme/index';

interface ColorModeContextType {
    toggleColorMode: () => void;
    mode: PaletteMode;
}

export const ColorModeContext = createContext<ColorModeContextType>({
    toggleColorMode: () => {},
    mode: 'light',
});

export const useColorMode = () => useContext(ColorModeContext);

export const ColorModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [mode, setMode] = useState<PaletteMode>(() => {
        const saved = localStorage.getItem('app_theme_mode');
        return saved === 'dark' || saved === 'light' ? saved : 'light';
    });

    useEffect(() => {
        localStorage.setItem('app_theme_mode', mode);
    }, [mode]);

    const colorMode = useMemo(
        () => ({
            toggleColorMode: () => {
                setMode((prev) => (prev === 'light' ? 'dark' : 'light'));
            },
            mode,
        }),
        [mode],
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
