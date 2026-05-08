import { PaletteMode, Shadows } from '@mui/material';

function buildShadows(mode: PaletteMode): Shadows {
    const alpha = mode === 'dark' ? 0.4 : 1;

    // Stripe-style: low offset, high blur, low alpha
    const s = (yOffset: number, blur: number, spread: number, a: number) => {
        const base = mode === 'dark'
            ? `rgba(0, 0, 0, ${(a * alpha).toFixed(2)})`
            : `rgba(15, 23, 42, ${(a * alpha).toFixed(2)})`;
        return `0 ${yOffset}px ${blur}px ${spread}px ${base}`;
    };

    return [
        'none',                                           // 0
        s(1, 2, 0, 0.05),                                // 1
        s(1, 4, 0, 0.07),                                // 2
        s(2, 6, 0, 0.08),                                // 3
        s(2, 8, 0, 0.09),                                // 4
        s(3, 10, 0, 0.09),                               // 5
        s(3, 12, -1, 0.10),                              // 6
        s(4, 14, -1, 0.10),                              // 7
        s(4, 16, -2, 0.11),                              // 8
        s(5, 18, -2, 0.11),                              // 9
        s(5, 20, -3, 0.12),                              // 10
        s(6, 22, -3, 0.12),                              // 11
        s(6, 24, -4, 0.13),                              // 12
        s(7, 26, -4, 0.13),                              // 13
        s(7, 28, -5, 0.14),                              // 14
        s(8, 30, -5, 0.14),                              // 15
        s(8, 32, -6, 0.15),                              // 16
        s(9, 34, -6, 0.15),                              // 17
        s(9, 36, -7, 0.16),                              // 18
        s(10, 38, -7, 0.16),                             // 19
        s(10, 40, -8, 0.17),                             // 20
        s(11, 42, -8, 0.17),                             // 21
        s(11, 44, -9, 0.18),                             // 22
        s(12, 46, -9, 0.18),                             // 23
        s(12, 48, -10, 0.19),                            // 24
    ] as Shadows;
}

export { buildShadows };
