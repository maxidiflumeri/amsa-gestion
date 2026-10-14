import fs from 'node:fs';
import path from 'node:path';
import { RAIZ_REPO } from './raiz';
const RUTA = path.join(RAIZ_REPO, 'docs/imports-progreso-realtime-spec.md');
const completo = fs.readFileSync(RUTA, 'utf8');
const desde = completo.indexOf('## 9. Diseño de la Fase B');
const hasta = completo.indexOf('## PLAN PARA IMPLEMENTER', desde);
/** §9 del spec, con los saltos de línea del markdown aplanados a un espacio (una oración puede partir en dos renglones). */
export const SPEC9 = completo.slice(desde, hasta).replace(/\s*\n\s*/g, ' ');
/** Afirma que `texto` figura TAL CUAL en §9: garantiza que lo que el test espera es lo que dice el diseño y no un tipeo mío. */
export function enElSpec(texto: string): string {
    if (!SPEC9.includes(texto)) throw new Error(`El texto esperado no figura tal cual en §9 del spec: «${texto}»`);
    return texto;
}

const desde10 = completo.indexOf('## 10. Diseño de la Fase C');
const hasta10 = completo.indexOf('## PLAN PARA IMPLEMENTER', desde10);
/** §10 del spec, aplanado. */
export const SPEC10 = completo.slice(desde10, hasta10).replace(/\s*\n\s*/g, ' ').replace(/\*\*/g, '');
/** Afirma que `texto` figura TAL CUAL en §10 (sin las negritas del markdown). */
export function enElSpec10(texto: string): string {
    if (!SPEC10.includes(texto)) throw new Error(`El texto esperado no figura tal cual en §10 del spec: «${texto}»`);
    return texto;
}
export const estaEnSpec10 = (texto: string) => SPEC10.includes(texto);
