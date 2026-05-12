import { normalizarTelefonoArgentino } from '../../../common/utils/phone-utils';
import { validarEmail } from '../../../common/utils/email-utils';
import { normalizarDireccionArgentina } from '../../../common/utils/direccion-utils';

export interface ContactoPreparado {
    tipo: string;
    valor: string;
    validado: boolean;
}

export interface ContactoImportInput {
    tipo?: any;
    valor?: any;
    direccion_calle?: any;
    direccion_numero?: any;
    direccion_cp?: any;
    direccion_localidad?: any;
    direccion_provincia?: any;
}

type CacheDireccion = { nomenclatura?: string; valido: boolean };
type CacheEmail = { normalizado?: string; valido: boolean };

const cacheDirecciones = new Map<string, CacheDireccion>();
const cacheEmails = new Map<string, CacheEmail>();

function clean(v: any): string {
    return String(v ?? '').trim();
}

/**
 * Normaliza un contacto de import a su forma canónica.
 * - telefono/whatsapp → E.164 si valida, original si no.
 * - email → minúsculas + validación MX (con caché).
 * - direccion → estructurada (calle/numero/cp/localidad/provincia) o monolítica (valor),
 *   normalizada vía Georef. Si valida, guarda la nomenclatura canónica.
 *
 * Devuelve null si no hay valor mínimo para guardar.
 */
export async function prepararContactoImport(data: ContactoImportInput): Promise<ContactoPreparado | null> {
    const tipo = clean(data.tipo || 'telefono').toLowerCase();

    if (tipo === 'telefono' || tipo === 'whatsapp' || tipo === 'celular') {
        const raw = clean(data.valor);
        if (!raw) return null;
        const res = normalizarTelefonoArgentino(raw);
        if (res.valido && res.e164) return { tipo: 'telefono', valor: res.e164, validado: true };
        return { tipo: 'telefono', valor: raw, validado: false };
    }

    if (tipo === 'email') {
        const raw = clean(data.valor).toLowerCase();
        if (!raw) return null;
        let cached = cacheEmails.get(raw);
        if (!cached) {
            const r = await validarEmail(raw);
            cached = { normalizado: r.normalizado, valido: r.valido };
            cacheEmails.set(raw, cached);
        }
        if (cached.valido) return { tipo: 'email', valor: cached.normalizado ?? raw, validado: true };
        return { tipo: 'email', valor: raw, validado: false };
    }

    if (tipo === 'direccion') {
        const calle = clean(data.direccion_calle);
        const numero = clean(data.direccion_numero);
        const cp = clean(data.direccion_cp);
        const localidad = clean(data.direccion_localidad);
        const provincia = clean(data.direccion_provincia);
        const tieneEstructurada = !!(calle || numero || localidad || provincia);

        let textoBusqueda: string;
        let filtros: { localidad?: string; provincia?: string } | undefined;
        let textoCrudo: string;

        if (tieneEstructurada) {
            textoBusqueda = `${calle} ${numero}`.trim();
            filtros = {
                localidad: localidad || undefined,
                provincia: provincia || undefined,
            };
            const partes = [`${calle} ${numero}`.trim(), localidad, provincia].filter(Boolean);
            textoCrudo = partes.join(', ') + (cp ? ` (CP ${cp})` : '');
        } else {
            textoBusqueda = clean(data.valor);
            textoCrudo = textoBusqueda;
        }

        if (!textoBusqueda) return null;

        const cacheKey = `${textoBusqueda.toLowerCase()}|${(filtros?.localidad ?? '').toLowerCase()}|${(filtros?.provincia ?? '').toLowerCase()}`;
        let cached = cacheDirecciones.get(cacheKey);
        if (!cached) {
            const r = await normalizarDireccionArgentina(textoBusqueda, filtros);
            cached = { nomenclatura: r.nomenclatura, valido: r.valido };
            cacheDirecciones.set(cacheKey, cached);
        }

        if (cached.valido && cached.nomenclatura) {
            const cpSuffix = cp ? ` (CP ${cp})` : '';
            return { tipo: 'direccion', valor: cached.nomenclatura + cpSuffix, validado: true };
        }
        return { tipo: 'direccion', valor: textoCrudo, validado: false };
    }

    // red_social u otros: pasthrough sin validación
    const raw = clean(data.valor);
    if (!raw) return null;
    return { tipo, valor: raw, validado: false };
}

/**
 * Limpia las cachés in-memory. Usar al finalizar un import grande para liberar memoria.
 */
export function clearContactoImportCaches() {
    cacheDirecciones.clear();
    cacheEmails.clear();
}
