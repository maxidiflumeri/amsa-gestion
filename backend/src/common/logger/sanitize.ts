/**
 * El match acá es **exacto** (no substring), así que las variantes hay que enumerarlas: `password`
 * no cubría `sipPassword`, ni `clave` cubría `claveNeotel`.
 */
const DEFAULT_SENSITIVE_KEYS = new Set([
    'password',
    'sippassword',
    'clave',
    'claveneotel',
    'clavesip',
    'token',
    'apikey',
    'idtoken',
    'credential',
    'authorization',
    'data',
    'xml_update',
]);

export function sanitizeParams(
    obj: Record<string, any>,
    sensitiveKeys?: string[],
): Record<string, any> {
    const keys = sensitiveKeys
        ? new Set([...DEFAULT_SENSITIVE_KEYS, ...sensitiveKeys.map((k) => k.toLowerCase())])
        : DEFAULT_SENSITIVE_KEYS;

    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
        result[k] = keys.has(k.toLowerCase()) ? '[REDACTED]' : v;
    }
    return result;
}

export function obfuscateDocumento(doc: string): string {
    if (!doc) return doc;
    const clean = doc.replace(/\D/g, '');
    if (clean.length < 3) return 'XX.XXX.***';
    const last3 = clean.slice(-3);
    return `XX.XXX.${last3}`;
}

export function obfuscateEmail(email: string): string {
    if (!email || !email.includes('@')) return email;
    const [local, domain] = email.split('@');
    const visible = local.charAt(0);
    return `${visible}***@${domain}`;
}
