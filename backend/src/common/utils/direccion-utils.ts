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
 * 🔎 Normaliza una dirección usando la API pública Georef Argentina
 */
export async function normalizarDireccionArgentina(input: string): Promise<DireccionNormalizada> {
    if (!input || typeof input !== 'string' || input.trim().length < 3) {
        return { valido: false, motivoInvalido: 'Entrada vacía o muy corta', input };
    }

    const direccion = input.trim();

    try {
        const url = `https://apis.datos.gob.ar/georef/api/direcciones?direccion=${encodeURIComponent(direccion)}&max=1`;
        const { data } = await axios.get(url);

        if (!data.direcciones?.length) {
            return { valido: false, motivoInvalido: 'No se encontró dirección válida', input };
        }

        const dir = data.direcciones[0];

        return {
            valido: true,
            input,
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
        return { valido: false, motivoInvalido: 'Error de conexión con Georef', input };
    }
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