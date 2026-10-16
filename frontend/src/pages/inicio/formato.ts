// Textos y cuentas chicas de Inicio. Todo puro: la hora y el "ahora" entran por parámetro para poder probarlo.

const capitalizar = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

/** 'YYYY-MM-DD' → Date local a las 12:00 (sin saltos por zona horaria). null si no es una fecha. */
function fechaDeYmd(ymd: string): Date | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
}

/** 'YYYY-MM-DD' del día local de un instante. */
export function ymdLocal(d: Date = new Date()): string {
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Buen día hasta las 12, buenas tardes hasta las 20 y buenas noches después. */
export function saludo(hora: number): string {
    if (hora < 12) return 'Buen día';
    if (hora < 20) return 'Buenas tardes';
    return 'Buenas noches';
}

/** '2026-10-16' → 'Viernes 16 de octubre'. */
export function fechaLarga(ymd: string): string {
    const f = fechaDeYmd(ymd);
    if (!f) return '';
    const dia = new Intl.DateTimeFormat('es-AR', { weekday: 'long' }).format(f);
    const mes = new Intl.DateTimeFormat('es-AR', { month: 'long' }).format(f);
    return `${capitalizar(dia)} ${f.getDate()} de ${mes}`;
}

/** '2026-10-03' → '3/10' (el eje del gráfico). */
export function diaCorto(ymd: string): string {
    const f = fechaDeYmd(ymd);
    return f ? `${f.getDate()}/${f.getMonth() + 1}` : '';
}

/** '2026-10-19' → 'Lunes 19' (el chip de los días que vienen). */
export function diaConNombre(ymd: string): string {
    const f = fechaDeYmd(ymd);
    if (!f) return '';
    return `${capitalizar(new Intl.DateTimeFormat('es-AR', { weekday: 'long' }).format(f))} ${f.getDate()}`;
}

/** Sábado o domingo. */
export function esFinDeSemana(ymd: string): boolean {
    const f = fechaDeYmd(ymd);
    return f ? f.getDay() === 0 || f.getDay() === 6 : false;
}

/** 'hace un momento', 'hace 5 min', 'hace 3 h', 'hace 2 d'. Un instante en el futuro (reloj corrido) es "hace un momento". */
export function haceCuanto(iso: string, ahora: number = Date.now()): string {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return '';
    const seg = Math.floor((ahora - t) / 1000);
    if (seg < 60) return 'hace un momento';
    const min = Math.floor(seg / 60);
    if (min < 60) return `hace ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `hace ${h} h`;
    return `hace ${Math.floor(h / 24)} d`;
}

/** '14:35' de un instante. */
export function horaCorta(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

export type Variacion =
    | { tipo: 'sin-base' }                       // no hay con qué comparar: no se muestra ningún porcentaje
    | { tipo: 'base-cero' }                      // el promedio es 0: un porcentaje daría infinito
    | { tipo: 'sube' | 'baja' | 'igual'; porcentaje: number };

/**
 * Compara `actual` contra `base`. Sube con ▲ a partir de +5 %, baja con ▼ a partir de −5 %, "=" en el medio.
 * Nunca devuelve NaN ni Infinity: sin base o con base 0 devuelve un tipo aparte que la pantalla escribe con palabras.
 */
export function variacion(actual: number, base: number | null | undefined): Variacion {
    if (base === null || base === undefined || !Number.isFinite(base) || !Number.isFinite(actual)) return { tipo: 'sin-base' };
    if (base <= 0) return { tipo: 'base-cero' };
    const porcentaje = Math.round(((actual - base) / base) * 100);
    if (porcentaje >= 5) return { tipo: 'sube', porcentaje };
    if (porcentaje <= -5) return { tipo: 'baja', porcentaje: Math.abs(porcentaje) };
    return { tipo: 'igual', porcentaje: Math.abs(porcentaje) };
}

/** 'N gestión' / 'N gestiones'. */
export const plural = (n: number, uno: string, varios: string) => `${n.toLocaleString('es-AR')} ${n === 1 ? uno : varios}`;

/** Las iniciales para el avatar de una fila: dos letras del nombre. */
export function iniciales(nombre: string): string {
    const partes = nombre.trim().split(/\s+/).filter(Boolean);
    if (partes.length === 0) return '?';
    return (partes[0].charAt(0) + (partes[1]?.charAt(0) ?? '')).toUpperCase();
}
