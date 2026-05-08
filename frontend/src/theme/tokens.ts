import { PaletteMode } from '@mui/material';

export const lightPalette = {
    primary: {
        main: '#2563EB',
        light: '#60A5FA',
        dark: '#1D4ED8',
        contrastText: '#FFFFFF',
    },
    secondary: {
        main: '#7C3AED',
    },
    success: { main: '#16A34A' },
    warning: { main: '#D97706' },
    error: { main: '#DC2626' },
    info: { main: '#0284C7' },
    background: {
        default: '#F8FAFC',
        paper: '#FFFFFF',
    },
    text: {
        primary: '#0F172A',
        secondary: '#475569',
        disabled: '#94A3B8',
    },
    divider: 'rgba(15, 23, 42, 0.08)',
    action: {
        hover: 'rgba(15, 23, 42, 0.04)',
        selected: 'rgba(37, 99, 235, 0.08)',
    },
};

export const darkPalette = {
    primary: {
        main: '#60A5FA',
        light: '#93C5FD',
        dark: '#3B82F6',
        contrastText: '#0F172A',
    },
    secondary: {
        main: '#A78BFA',
    },
    success: { main: '#22C55E' },
    warning: { main: '#F59E0B' },
    error: { main: '#F87171' },
    info: { main: '#38BDF8' },
    background: {
        default: '#0B1020',
        paper: '#111827',
    },
    text: {
        primary: '#F1F5F9',
        secondary: '#94A3B8',
        disabled: '#64748B',
    },
    divider: 'rgba(255, 255, 255, 0.08)',
    action: {
        hover: 'rgba(255, 255, 255, 0.06)',
        selected: 'rgba(96, 165, 250, 0.12)',
    },
};

export function getPalette(mode: PaletteMode) {
    return mode === 'light' ? lightPalette : darkPalette;
}
