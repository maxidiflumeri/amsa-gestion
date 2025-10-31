import * as validator from 'validator';

export type EmailPreview = {
    valido: boolean;
    normalizado?: string;
    motivoInvalido?: string;
};

/**
 * 🧹 Limpia y normaliza el email (minúsculas, sin espacios)
 */
export function normalizarEmail(input: string): string {
    return input.trim().toLowerCase();
}

/**
 * ✅ Valida sintácticamente un correo electrónico según RFC
 * (No hace validación MX, eso queda para el backend)
 */
export function validarEmailFront(email: string): EmailPreview {
    if (!email) {
        return { valido: false, motivoInvalido: 'Vacío' };
    }

    const normalizado = normalizarEmail(email);
    const valido = validator.isEmail(normalizado);

    return valido
        ? { valido, normalizado }
        : { valido, normalizado, motivoInvalido: 'Formato inválido' };
}

/**
 * 🧠 Helper para mostrar mensajes visuales de ayuda (en inputs)
 */
export function getHelperTextEmail(preview: EmailPreview | null): string | undefined {
    if (!preview) return undefined;
    if (preview.valido) return `Se guardará como: ${preview.normalizado}`;
    return preview.motivoInvalido ? `Correo inválido: ${preview.motivoInvalido}` : 'Correo inválido';
}