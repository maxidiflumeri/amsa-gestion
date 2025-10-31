import validator from 'validator';
import dns from 'dns/promises';

export type EmailValidado = {
    valido: boolean;
    motivoInvalido?: string;
    normalizado?: string;
    dominio?: string;
    tieneMX?: boolean;
};

/**
 * 🔍 Limpia y normaliza email (minusculas, sin espacios)
 */
export function normalizarEmail(input: string): string {
    return input.trim().toLowerCase();
}

/**
 * ✅ Valida formato RFC y existencia de dominio (MX)
 */
export async function validarEmail(email: string): Promise<EmailValidado> {
    if (!email || typeof email !== 'string') {
        return { valido: false, motivoInvalido: 'Vacío o no es string' };
    }

    const normalizado = normalizarEmail(email);

    // 1️⃣ Validación de formato sintáctico
    if (!validator.isEmail(normalizado)) {
        return { valido: false, motivoInvalido: 'Formato inválido', normalizado };
    }

    // 2️⃣ Validación de dominio (registros MX)
    const dominio = normalizado.split('@')[1];
    try {
        const mx = await dns.resolveMx(dominio);
        const tieneMX = mx.length > 0;
        return { valido: tieneMX, motivoInvalido: tieneMX ? undefined : 'Dominio sin MX', normalizado, dominio, tieneMX };
    } catch {
        return { valido: false, motivoInvalido: 'Dominio inexistente', normalizado, dominio, tieneMX: false };
    }
}

/**
 * 🚫 Lanza excepción si el email no es válido
 */
export async function assertEmailValido(email: string) {
    const res = await validarEmail(email);
    if (!res.valido) {
        const msg = `Email inválido${res.motivoInvalido ? `: ${res.motivoInvalido}` : ''}`;
        const err: any = new Error(msg);
        err.code = 'EMAIL_INVALIDO';
        throw err;
    }
    return res.normalizado!;
}