import { PaletteMode } from '@mui/material';
import { createTheme, ThemeOptions } from '@mui/material/styles';
import { getPalette } from './tokens';
import { typography } from './typography';
import { buildShadows } from './shadows';
import { buildComponents } from './components';

export function getDesignTokens(mode: PaletteMode): ThemeOptions {
    return {
        palette: {
            mode,
            ...getPalette(mode),
        },
        typography,
        shape: {
            borderRadius: 10,
        },
        spacing: 8,
        shadows: buildShadows(mode),
        components: buildComponents(mode),
        breakpoints: {
            values: {
                xs: 0,
                sm: 600,
                md: 900,
                lg: 1200,
                xl: 1536,
            },
        },
    };
}

export function buildTheme(mode: PaletteMode) {
    return createTheme(getDesignTokens(mode));
}

export { getPalette } from './tokens';
export { typography } from './typography';
