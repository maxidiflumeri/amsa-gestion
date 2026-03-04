// src/import/transforms.ts
import dayjs from 'dayjs';

/* ------------------------------
 * Transformadores numéricos
 * ------------------------------ */
const toNumberEsAR = (input: any) => {
    if (input == null) return null;

    const s = String(input)
        .trim()
        .replace(/\./g, '')  // separador de miles
        .replace(/,/g, '.'); // decimal

    const n = Number(s);
    return Number.isFinite(n) ? n : null;
};

/* ------------------------------
 * Transformadores de fecha
 * ------------------------------ */
const toDateAuto = (input: any) => {
    if (!input) return null;
    const s = String(input).trim();

    const formats = [
        'YYYY-MM-DD',
        'DD/MM/YYYY',
        'YYYYMMDD',
        'DD-MM-YYYY',
        'MM/DD/YYYY'
    ];

    for (const f of formats) {
        const d = dayjs(s, f, true);
        if (d.isValid()) return d.toDate();
    }

    // fallback: Date nativo
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
};

/* ------------------------------
 * Transformadores básicos de texto
 * ------------------------------ */
const trim = (s: any) => (s == null ? null : String(s).trim());
const upper = (s: any) => (s == null ? null : String(s).toUpperCase());
const title = (s: any) =>
    s == null
        ? null
        : String(s)
            .toLowerCase()
            .replace(/\b\w/g, (c) => c.toUpperCase());

/* ------------------------------
 * NUEVO: splitComma
 * ------------------------------ */
const splitComma = (value: any, index: number) => {
    if (value == null) return null;
    const s = String(value);
    const parts = s.split(',');

    if (index < 0 || index >= parts.length) return null;

    return parts[index].trim();
};

/* ------------------------------
 * APLICACIÓN DE TRANSFORMACIONES
 * ------------------------------ */
export function applyTransforms(raw: any, tr?: string[]) {
    if (!tr || !tr.length) return raw;

    let v: any = raw;

    for (const t of tr) {
        if (t === 'trim') v = trim(v);
        else if (t === 'upper') v = upper(v);
        else if (t === 'title') v = title(v);

        // splitComma:0 / splitComma:1
        else if (t.startsWith('splitComma')) {
            const [, idxStr] = t.split(':');
            const idx = parseInt(idxStr, 10);
            v = splitComma(v, idx);
        }

        else if (t.startsWith('toNumber')) {
            v = toNumberEsAR(v);
        }

        else if (t.startsWith('toDate')) {
            v = toDateAuto(v);
        }
    }

    return v;
}