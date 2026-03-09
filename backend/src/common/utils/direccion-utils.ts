import axios from 'axios';

export interface DireccionNormalizada {
    valido: boolean;
    motivoInvalido?: string;
    input?: string;
    calle?: string;
    altura?: number | null;
    localidad?: string;
    provincia?: string;
    codigoPostal?: string | null;
    nomenclatura?: string;
    lat?: number;
    lon?: number;
}

/**
 * Limpia el input de abreviaturas comunes que marean a Georef
 */
function limpiarDireccion(input: string): string {
    let clean = input;
    // Quitar "B°", "B.", "Barrio"
    clean = clean.replace(/\b(B°|b°|B\.|b\.|Barrio|barrio)\b\s*/g, '');
    // Quitar "Av.", "Avda", "Avenida" -> "Av" (A veces av estricto ayuda, pero georef lo entiende mejor sin punto)
    clean = clean.replace(/\b(Av\.|av\.|Avda\.|avda\.|Avenida|avenida)\b\s*/g, 'Av ');
    // Limpieza de dobles comas o barras extrañas, dejando espacio
    clean = clean.replace(/[/]/g, ' ');
    return clean.replace(/\s+/g, ' ').trim();
}

/**
 * Llamada base a la API de Georef
 */
async function callGeoref(direccionStr: string): Promise<DireccionNormalizada | null> {
    try {
        const url = `https://apis.datos.gob.ar/georef/api/direcciones?direccion=${encodeURIComponent(direccionStr)}&max=1`;
        const { data } = await axios.get(url, { timeout: 4000 }); // timeout razonable

        if (!data.direcciones?.length) {
            return null;
        }

        const dir = data.direcciones[0];
        return {
            valido: true,
            input: direccionStr,
            calle: dir.calle || undefined,
            altura: dir.altura || null,
            localidad: dir.localidad_censal?.nombre || dir.departamento?.nombre || undefined,
            provincia: dir.provincia?.nombre || undefined,
            codigoPostal: dir.codigo_postal || null,
            nomenclatura: dir.nomenclatura || undefined,
            lat: dir.ubicacion?.lat || undefined,
            lon: dir.ubicacion?.lon || undefined,
        };
    } catch (err) {
        console.error('API Georef falló en callGeoref:', err.message);
        return null; // Asumimos error de conexión como un "No encontrado" silencioso en el ciclo de intentos
    }
}

/**
 * 🔎 Normaliza una dirección usando la API pública Georef Argentina
 * Incluye lógica de reintentos e inteligencia sobre comas.
 */
export async function normalizarDireccionArgentina(input: string): Promise<DireccionNormalizada> {
    if (!input || typeof input !== 'string' || input.trim().length < 3) {
        return { valido: false, motivoInvalido: 'Entrada vacía o muy corta', input };
    }

    const direccionInicial = input.trim();

    // ---- INTENTO 1: Original ----
    let res = await callGeoref(direccionInicial);
    if (res && res.valido) return { ...res, input: direccionInicial };

    // ---- INTENTO 2: Cortar por coma (o guion) ----
    // Muchos usuarios escriben "San Martin 123, Rosario"
    // Georef solo quiere "San Martin 123" en su input de "direccion"
    const partesComa = direccionInicial.split(/,|-/);
    if (partesComa.length > 1) {
        const supuestaCalle = partesComa[0].trim();
        if (supuestaCalle.length >= 3) {
            res = await callGeoref(supuestaCalle);
            if (res && res.valido) return { ...res, input: direccionInicial };
        }
    }

    // ---- INTENTO 3: Limpieza intensiva sobre el string base ----
    const direccionLimpia = limpiarDireccion(direccionInicial);
    if (direccionLimpia !== direccionInicial && direccionLimpia.length >= 3) {
        res = await callGeoref(direccionLimpia);
        if (res && res.valido) return { ...res, input: direccionInicial };
        
        // ---- INTENTO 4: Limpieza intensiva + corte por coma ----
        const limpiaPartes = direccionLimpia.split(/,|-/);
        if (limpiaPartes.length > 1) {
            const limpiaCalle = limpiaPartes[0].trim();
            if (limpiaCalle.length >= 3) {
                res = await callGeoref(limpiaCalle);
                if (res && res.valido) return { ...res, input: direccionInicial };
            }
        }
    }

    return { valido: false, motivoInvalido: 'No se encontró una dirección válida en Georef', input };
}

/**
 * 🚫 Lanza excepción si la dirección no se puede normalizar
 */
export async function assertDireccionValida(input: string) {
    const res = await normalizarDireccionArgentina(input);
    if (!res.valido) {
        const err: any = new Error(`Dirección inválida: ${res.motivoInvalido}`);
        err.code = 'DIRECCION_INVALIDA';
        throw err;
    }
    return res;
}