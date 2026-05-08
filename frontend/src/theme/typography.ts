export const typography = {
    fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    h1: {
        fontSize: 'clamp(1.75rem, 1.4rem + 1.5vw, 2.5rem)',
        fontWeight: 700,
        lineHeight: 1.2,
        letterSpacing: '-0.02em',
    },
    h2: {
        fontSize: 'clamp(1.5rem, 1.25rem + 1vw, 2rem)',
        fontWeight: 700,
        lineHeight: 1.25,
        letterSpacing: '-0.015em',
    },
    h3: {
        fontSize: '1.5rem',
        fontWeight: 600,
        lineHeight: 1.3,
    },
    h4: {
        fontSize: '1.25rem',
        fontWeight: 600,
        lineHeight: 1.35,
    },
    h5: {
        fontSize: '1.125rem',
        fontWeight: 600,
    },
    h6: {
        fontSize: '1rem',
        fontWeight: 600,
    },
    subtitle1: {
        fontSize: '1rem',
        fontWeight: 500,
    },
    subtitle2: {
        fontSize: '0.875rem',
        fontWeight: 500,
    },
    body1: {
        fontSize: '0.9375rem',
        lineHeight: 1.6,
    },
    body2: {
        fontSize: '0.875rem',
        lineHeight: 1.55,
    },
    button: {
        fontSize: '0.875rem',
        fontWeight: 600,
        textTransform: 'none' as const,
    },
    caption: {
        fontSize: '0.75rem',
        lineHeight: 1.4,
    },
    overline: {
        fontSize: '0.6875rem',
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase' as const,
    },
};
