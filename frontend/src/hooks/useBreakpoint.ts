import { useTheme, useMediaQuery } from '@mui/material';

export function useBreakpoint() {
    const theme = useTheme();

    const isXs = useMediaQuery(theme.breakpoints.only('xs'));
    const isSm = useMediaQuery(theme.breakpoints.only('sm'));
    const isMd = useMediaQuery(theme.breakpoints.only('md'));
    const isLg = useMediaQuery(theme.breakpoints.only('lg'));
    const isXl = useMediaQuery(theme.breakpoints.only('xl'));
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const isTablet = useMediaQuery(theme.breakpoints.between('sm', 'lg'));
    const isDesktop = useMediaQuery(theme.breakpoints.up('md'));

    return {
        isXs,
        isSm,
        isMd,
        isLg,
        isXl,
        isMobile,
        isTablet,
        isDesktop,
    };
}
