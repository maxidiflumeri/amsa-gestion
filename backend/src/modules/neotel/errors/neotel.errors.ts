/**
 * Errores tipados para la integración con Neotel ASMX.
 * Todos extienden Error para que sean instanceof-comprobables.
 */

export class NeotelApiError extends Error {
    constructor(
        public readonly endpoint: string,
        public readonly httpStatus: number,
        public readonly body: string,
    ) {
        super(`Neotel API error ${httpStatus} en ${endpoint}: ${body.slice(0, 200)}`);
        this.name = 'NeotelApiError';
    }
}

export class NeotelTimeoutError extends Error {
    constructor(public readonly endpoint: string) {
        super(`Neotel timeout en ${endpoint}`);
        this.name = 'NeotelTimeoutError';
    }
}

export class NeotelAuthError extends Error {
    constructor(
        public readonly endpoint: string,
        message = 'Credenciales Neotel inválidas o sesión expirada',
    ) {
        super(message);
        this.name = 'NeotelAuthError';
    }
}

export class NeotelInvalidResponseError extends Error {
    constructor(public readonly raw: string) {
        super(`Respuesta Neotel inesperada: ${raw.slice(0, 200)}`);
        this.name = 'NeotelInvalidResponseError';
    }
}
