/**
 * Cuándo empezó y cuándo vence la sesión, leído del token (`iat` y `exp`). No lo verifica: es solo para mostrarlo
 * en «Mi perfil»; quien decide si vale es el backend. Un token que no se puede leer da los dos en null.
 */
export function tiemposDeSesion(token: string | null | undefined): { desde: Date | null; vence: Date | null } {
    const nada = { desde: null, vence: null };
    const partes = (token ?? '').split('.');
    if (partes.length !== 3) return nada;
    try {
        const base64 = partes[1].replace(/-/g, '+').replace(/_/g, '/');
        const datos = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')));
        const aFecha = (s: unknown) => (typeof s === 'number' && Number.isFinite(s) ? new Date(s * 1000) : null);
        return { desde: aFecha(datos?.iat), vence: aFecha(datos?.exp) };
    } catch {
        return nada;
    }
}

const mismoDia = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const dos = (n: number) => String(n).padStart(2, '0');

/**
 * "hoy a las 09:14", "mañana a las 09:14", "ayer a las 18:02" o "el 22/10 a las 09:14". Armado a mano: el formato
 * corto de `es-AR` da "1/10" en un navegador y "01/10" en otro.
 */
export function cuandoRelativo(fecha: Date, ahora: Date = new Date()): string {
    const hora = `${dos(fecha.getHours())}:${dos(fecha.getMinutes())}`;
    const manana = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + 1);
    const ayer = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() - 1);
    if (mismoDia(fecha, ahora)) return `hoy a las ${hora}`;
    if (mismoDia(fecha, manana)) return `mañana a las ${hora}`;
    if (mismoDia(fecha, ayer)) return `ayer a las ${hora}`;
    return `el ${dos(fecha.getDate())}/${dos(fecha.getMonth() + 1)} a las ${hora}`;
}
