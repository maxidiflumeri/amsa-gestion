import type { Theme } from '@mui/material';

export const fmtMoney = (n: number | null | undefined): string => {
    if (n == null) return '—';
    return new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS',
        maximumFractionDigits: 0,
    }).format(n);
};

export const fmtMoneyShort = (n: number | null | undefined): string => {
    if (n == null) return '—';
    const abs = Math.abs(n);
    if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
    if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
    return `$${n.toFixed(0)}`;
};

export const fmtNumber = (n: number | null | undefined): string => {
    if (n == null) return '—';
    return new Intl.NumberFormat('es-AR').format(n);
};

export const fmtPercent = (n: number | null | undefined, digits = 1): string => {
    if (n == null || Number.isNaN(n)) return '—';
    return `${n.toFixed(digits)}%`;
};

export const fmtDays = (n: number | null | undefined): string => {
    if (n == null) return '—';
    return `${Math.round(n)} días`;
};

export const todayIso = (): string => {
    const d = new Date();
    return d.toISOString().slice(0, 10);
};

export const daysAgoIso = (days: number): string => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
};

export const getChartPalette = (theme: Theme): string[] => [
    theme.palette.primary.main,
    theme.palette.success.main,
    theme.palette.warning.main,
    theme.palette.error.main,
    theme.palette.info.main,
    theme.palette.secondary.main,
    theme.palette.primary.light,
    theme.palette.success.dark,
];
