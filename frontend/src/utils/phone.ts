// src/utils/phone.ts
import { parsePhoneNumberFromString } from 'libphonenumber-js';

export type PreviewTelefono = {
    valido: boolean;
    e164?: string;
    internacional?: string;
    nacional?: string;
    tipo?: string;
};

// ---------- Helpers de teléfono (inline para copiar/pegar) ----------
const limpiarBasico = (input: string) => input.replace(/[^\d+]/g, '');

const prefijarARSiFalta = (num: string) => {
    if (num.startsWith('+')) return num;
    if (num.startsWith('00')) return `+${num.slice(2)}`;
    if (num.startsWith('54')) return `+${num}`;
    return `+54${num}`;
};

export const validarTelefonoArgentinoFront = (input: string): PreviewTelefono => {
    const limpio = limpiarBasico(input);
    if (!limpio) return { valido: false };
    const pref = prefijarARSiFalta(limpio);
    try {
        const phone = parsePhoneNumberFromString(pref, 'AR');
        if (!phone || !phone.isValid()) return { valido: false };
        return {
            valido: true,
            e164: phone.number, // "+549..." o "+5411..."
            internacional: phone.formatInternational(),
            nacional: phone.formatNational(),
            tipo: phone.getType?.(),
        };
    } catch {
        return { valido: false };
    }
};

export const formatearTelefonoParaUI = (valorE164: string) => {
    try {
        const p = parsePhoneNumberFromString(valorE164);
        return p?.isValid() ? p.formatNational() : valorE164;
    } catch {
        return valorE164;
    }
};