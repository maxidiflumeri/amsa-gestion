import React, { createContext, useContext, useState, useMemo, useEffect } from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { PaletteMode } from '@mui/material';
import { getDesignTokens } from '../theme';

interface ThemeContextType {
    toggleColorMode: () => void;
    mode: PaletteMode;
}

const ThemeContext = createContext<ThemeContextType>({
    toggleColorMode: () => {},
    mode: 'light',
});

export const useColorMode = () => useContext(ThemeContext);

export const ThemeContextProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    // 1. Initialize state from localStorage or default to 'light'
    const [mode, setMode] = useState<PaletteMode>(() => {
        const savedMode = localStorage.getItem('app_theme_mode');
        return (savedMode === 'dark' || savedMode === 'light') ? savedMode : 'light';
    });

    // 2. Update localStorage whenever mode changes
    useEffect(() => {
        localStorage.setItem('app_theme_mode', mode);
    }, [mode]);

    // 3. Memoize the toggle function
    const colorMode = useMemo(
        () => ({
            toggleColorMode: () => {
                setMode((prevMode) => (prevMode === 'light' ? 'dark' : 'light'));
            },
            mode,
        }),
        [mode],
    );

    // 4. Update the theme only if the mode changes
    const theme = useMemo(() => createTheme(getDesignTokens(mode)), [mode]);

    return (
        <ThemeContext.Provider value={colorMode}>
            <ThemeProvider theme={theme}>
                {children}
            </ThemeProvider>
        </ThemeContext.Provider>
    );
};
