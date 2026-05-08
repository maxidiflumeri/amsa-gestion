import { PaletteMode, Theme } from '@mui/material';

export function buildComponents(mode: PaletteMode): Theme['components'] {
    return {
        MuiCssBaseline: {
            styleOverrides: {
                // Scrollbar custom
                '*': {
                    scrollbarWidth: 'thin' as const,
                    scrollbarColor: mode === 'dark'
                        ? 'rgba(255,255,255,0.18) transparent'
                        : 'rgba(15,23,42,0.2) transparent',
                },
                '*::-webkit-scrollbar': {
                    width: 8,
                    height: 8,
                },
                '*::-webkit-scrollbar-track': {
                    background: 'transparent',
                },
                '*::-webkit-scrollbar-thumb': {
                    backgroundColor: mode === 'dark'
                        ? 'rgba(255,255,255,0.18)'
                        : 'rgba(15,23,42,0.2)',
                    borderRadius: 8,
                    border: '2px solid transparent',
                    backgroundClip: 'padding-box',
                },
                '*::-webkit-scrollbar-thumb:hover': {
                    backgroundColor: mode === 'dark'
                        ? 'rgba(255,255,255,0.32)'
                        : 'rgba(15,23,42,0.35)',
                },
                '*::-webkit-scrollbar-corner': {
                    background: 'transparent',
                },
                // Prefers-reduced-motion
                '@media (prefers-reduced-motion: reduce)': {
                    '*, *::before, *::after': {
                        transitionDuration: '0.001ms !important',
                        animationDuration: '0.001ms !important',
                    },
                },
            },
        },

        MuiCard: {
            styleOverrides: {
                root: {
                    backgroundImage: 'none',
                },
            },
        },

        MuiPaper: {
            styleOverrides: {
                root: {
                    backgroundImage: 'none',
                },
            },
        },

        MuiButton: {
            defaultProps: {
                disableElevation: true,
            },
            styleOverrides: {
                root: {
                    textTransform: 'none',
                    fontWeight: 600,
                    borderRadius: 8,
                },
            },
        },

        MuiAppBar: {
            styleOverrides: {
                root: {
                    backgroundImage: 'none',
                    color: mode === 'light' ? 'inherit' : undefined,
                    backgroundColor: mode === 'light' ? '#FFFFFF' : '#111827',
                },
            },
        },

        MuiDrawer: {
            styleOverrides: {
                paper: {
                    backgroundImage: 'none',
                    borderRight: 'none',
                },
            },
        },

        MuiListItemButton: {
            styleOverrides: {
                root: {
                    borderRadius: 8,
                    margin: '1px 8px',
                    width: 'calc(100% - 16px)',
                },
            },
        },

        MuiChip: {
            styleOverrides: {
                root: {
                    fontWeight: 500,
                    fontSize: '0.75rem',
                },
            },
        },

        MuiTooltip: {
            defaultProps: {
                arrow: true,
            },
            styleOverrides: {
                tooltip: {
                    fontSize: '0.75rem',
                },
            },
        },

        MuiTableHead: {
            styleOverrides: {
                root: {
                    '& .MuiTableCell-head': {
                        fontWeight: 600,
                        fontSize: '0.75rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        color: mode === 'light' ? '#475569' : '#94A3B8',
                    },
                },
            },
        },

        MuiTableCell: {
            styleOverrides: {
                root: {
                    borderBottomColor: mode === 'light'
                        ? 'rgba(15, 23, 42, 0.06)'
                        : 'rgba(255, 255, 255, 0.06)',
                },
            },
        },

        MuiInputBase: {
            styleOverrides: {
                root: {
                    fontSize: '0.9375rem',
                },
            },
        },

        MuiOutlinedInput: {
            styleOverrides: {
                root: {
                    borderRadius: 8,
                },
            },
        },

        MuiFocusVisible: {
            // Ensure focus visible is accessible
        },

        MuiLink: {
            defaultProps: {
                underline: 'hover',
            },
        },
    };
}
