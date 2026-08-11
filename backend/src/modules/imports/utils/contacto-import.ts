import { normalizarTelefonoArgentino } from '../../../common/utils/phone-utils';
import { esPosibleEmail, validarEmail } from '../../../common/utils/email-utils';
import { normalizarDireccionArgentina } from '../../../common/utils/direccion-utils';

export interface ContactoPreparado {
    tipo: string;
    valor: string;
    validado: boolean;
}

/**
 * Datos del resto de la fila que ayudan a normalizar un contacto.
 *
 * Hoy lo usa la deducción del código de área de los teléfonos que el cedente manda en formato local
 * (ver `normalizarTelefonoArgentino`). Lo arma `procesarBloquesDeudor` una vez por fila.
 */
export interface ContextoCaso {
    /** Todos los teléfonos de la fila, crudos, incluido el que se está preparando. */
    telefonos?: string[];
    /** Código postal del domicilio del caso. */
    codigoPostal?: string;
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
export async function prepararContactoImport(
    data: ContactoImportInput,
    validarDomicilios = false,
    contexto?: ContextoCaso,
): Promise<ContactoPreparado | null> {
    const tipo = clean(data.tipo || 'telefono').toLowerCase();

    if (tipo === 'telefono' || tipo === 'whatsapp' || tipo === 'celular') {
        const raw = clean(data.valor);
        if (!raw) return null;
        // Se le pasan los otros teléfonos del caso y el CP del domicilio: muchos cedentes mandan el
        // número en formato local (`42996640`, `1564435038`) y sin la característica no se puede
        // marcar. Ver la cascada en `normalizarTelefonoArgentino`.
        const res = normalizarTelefonoArgentino(raw, {
            otrosTelefonos: contexto?.telefonos?.filter((t) => clean(t) !== raw),
            codigoPostal: contexto?.codigoPostal,
        });
        if (res.valido && res.e164) return { tipo: 'telefono', valor: res.e164, validado: true };
        // No se pudo normalizar ni deducir el área: se descarta. Guardarlo "en rojo" solo ensucia
        // la ficha — un número sin característica no se puede marcar.
        return null;
    }

    if (tipo === 'email') {
        const raw = clean(data.valor).toLowerCase();
        if (!raw) return null;
        // Basura evidente (`sin@mail`, dominios sin punto) o rellenos conocidos (`sin@mail.com`):
        // no se guardan. En AYSA era la mitad de los emails de la cartera.
        if (!esPosibleEmail(raw)) return null;
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

        // Si la importación no pidió validar domicilios, cargamos el texto con formato
        // acomodado pero SIN llamar a Georef (mucho más rápido). Queda como no verificado,
        // igual que el caso "dirección no encontrada" de más abajo.
        if (!validarDomicilios) {
            return { tipo: 'direccion', valor: textoCrudo, validado: false };
        }

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
