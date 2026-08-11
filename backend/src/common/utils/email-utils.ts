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

/* ────────────────────────────────────────────────────────────────────────────
 * Filtro de basura: qué NO vale la pena guardar
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Forma mínima de un email: algo, arroba, dominio con al menos un punto y un TLD de 2+ letras.
 * Deliberadamente laxa — no reemplaza a `validarEmail`, solo descarta lo que no puede ser un email.
 */
const FORMA_EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[a-z]{2,}$/i;

/**
 * Parte local que delata un relleno, sin importar el dominio. Nadie real usa `sin@…`.
 *
 * Hace falta porque muchos de estos son **sintácticamente válidos y con dominio real**, así que
 * ningún filtro técnico los distingue de un email de verdad: `sin@mail.com` pasa la validación de
 * formato y `mail.com` tiene servidor de correo. En el archivo de AYSA aparece 17 veces.
 */
const LOCALES_PLACEHOLDER = new Set([
    'sin', 'sinmail', 'sinemail', 'sincorreo', 'nomail', 'noemail',
    'no', 'notiene', 'notienemail', 'noposee', 'nose', 'ninguno',
    'nn', 'na', 'xx', 'xxx', 'test', 'prueba', 'ejemplo',
]);

/**
 * ¿Vale la pena guardar este email?
 *
 * Es el equivalente de `esPosibleTelefono`: separa "no validó pero podría ser real" de "esto es
 * basura y no aporta nada". Sin este filtro, la mitad de los emails de AYSA que entraban a la base
 * eran el relleno `sin@mail` (5.910 de 11.702).
 *
 * NO decide si el email existe —de eso se ocupa `validarEmail` con su chequeo de MX—, solo si tiene
 * sentido guardarlo.
 */
export function esPosibleEmail(input: string): boolean {
    const e = normalizarEmail(String(input ?? ''));
    if (!e || !FORMA_EMAIL.test(e)) return false;

    const local = e.split('@')[0];
    // Se comparan también sin separadores: "sin_mail", "sin.mail" y "sinmail" son lo mismo.
    if (LOCALES_PLACEHOLDER.has(local) || LOCALES_PLACEHOLDER.has(local.replace(/[._-]/g, ''))) {
        return false;
    }
    return true;
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