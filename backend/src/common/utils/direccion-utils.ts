import axios from 'axios';
import { Logger } from '@nestjs/common';

const georefLogger = new Logger('GeorefUtil');

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

export type DireccionFiltros = { provincia?: string; localidad?: string };

const ALIAS_CABA = ['capital federal', 'caba', 'ciudad autonoma de buenos aires', 'ciudad de buenos aires'];
function normalizarParaComparar(s: string | undefined | null): string {
    return (s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}
function esCaba(s: string | undefined | null) {
    return ALIAS_CABA.includes(normalizarParaComparar(s));
}
function coincideLocalidad(esperado: string | undefined, devuelto: string | undefined): boolean {
    if (!esperado) return true;
    if (!devuelto) return false;
    const e = normalizarParaComparar(esperado);
    const d = normalizarParaComparar(devuelto);
    if (e === d) return true;
    if (esCaba(esperado) && esCaba(devuelto)) return true;
    return d.includes(e) || e.includes(d);
}

/**
 * Llamada base a la API de Georef
 */
async function callGeoref(direccionStr: string, filtros?: DireccionFiltros): Promise<DireccionNormalizada | null> {
    try {
        const params = new URLSearchParams({ direccion: direccionStr, max: '1' });
        if (filtros?.provincia) params.set('provincia', filtros.provincia);
        if (filtros?.localidad) params.set('localidad', filtros.localidad);
        const url = `https://apis.datos.gob.ar/georef/api/direcciones?${params.toString()}`;
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
        georefLogger.error(`API Georef falló en callGeoref: ${err.message}`, err.stack);
        return null; // Asumimos error de conexión como un "No encontrado" silencioso en el ciclo de intentos
    }
}

/**
 * 🔎 Normaliza una dirección usando la API pública Georef Argentina
 * Incluye lógica de reintentos e inteligencia sobre comas.
 */
async function intentarVariantes(direccion: string, filtros?: DireccionFiltros): Promise<DireccionNormalizada | null> {
    const direccionInicial = direccion.trim();

    let res = await callGeoref(direccionInicial, filtros);
    if (res && res.valido) return res;

    const partesComa = direccionInicial.split(/,|-/);
    if (partesComa.length > 1) {
        const supuestaCalle = partesComa[0].trim();
        if (supuestaCalle.length >= 3) {
            res = await callGeoref(supuestaCalle, filtros);
            if (res && res.valido) return res;
        }
    }

    const direccionLimpia = limpiarDireccion(direccionInicial);
    if (direccionLimpia !== direccionInicial && direccionLimpia.length >= 3) {
        res = await callGeoref(direccionLimpia, filtros);
        if (res && res.valido) return res;

        const limpiaPartes = direccionLimpia.split(/,|-/);
        if (limpiaPartes.length > 1) {
            const limpiaCalle = limpiaPartes[0].trim();
            if (limpiaCalle.length >= 3) {
                res = await callGeoref(limpiaCalle, filtros);
                if (res && res.valido) return res;
            }
        }
    }
    return null;
}

export async function normalizarDireccionArgentina(
    input: string,
    filtros?: DireccionFiltros,
): Promise<DireccionNormalizada> {
    if (!input || typeof input !== 'string' || input.trim().length < 3) {
        return { valido: false, motivoInvalido: 'Entrada vacía o muy corta', input };
    }

    const direccionInicial = input.trim();

    if (filtros?.localidad || filtros?.provincia) {
        const conFiltros = await intentarVariantes(direccionInicial, filtros);
        if (conFiltros && coincideLocalidad(filtros.localidad, conFiltros.localidad)) {
            return { ...conFiltros, input: direccionInicial };
        }
        return {
            valido: false,
            motivoInvalido: `Georef no encontró esta dirección en ${filtros.localidad || filtros.provincia}`,
            input: direccionInicial,
        };
    }

    const res = await intentarVariantes(direccionInicial);
    if (res) return { ...res, input: direccionInicial };

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