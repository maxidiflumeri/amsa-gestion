import { PaletteMode } from '@mui/material';

export const getDesignTokens = (mode: PaletteMode) => ({
  palette: {
    mode,
    ...(mode === 'light'
      ? {
          // Paleta Clara Premium (Manteniendo lo existente)
          primary: {
            main: '#1976d2',
          },
          background: {
            default: '#f4f6f8',
            paper: '#ffffff',
          },
          text: {
            primary: '#111827',
            secondary: '#4b5563',
          },
        }
      : {
          // Paleta Oscura Premium estilo iOS/Mac
          primary: {
            main: '#60a5fa', // Azul más claro para balancear sobre fondos oscuros
          },
          background: {
            default: '#121212', // Gris muy oscuro, no negro puro
            paper: '#1e1e1e', // Ligeramente más claro para las tarjetas
          },
          text: {
            primary: '#f9fafb',
            secondary: '#9ca3af',
          },
          divider: 'rgba(255, 255, 255, 0.12)',
        }),
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
  },
  components: {
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: 'none', // Quita el gradiente blanco/f8 sobre tarjetas oscuras si lo hubiere por defecto
        }
      }
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        }
      }
    }
  }
});
