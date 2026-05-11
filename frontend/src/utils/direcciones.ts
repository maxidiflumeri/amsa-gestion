export type DireccionPreview = {
    valido: boolean;
    normalizada?: string;
    provincia?: string;
    localidad?: string;
    motivoInvalido?: string;
    sugerencia?: { localidad?: string; provincia?: string; normalizada?: string };
};

export type DireccionFiltros = {
    provincia?: string;
    localidad?: string;
};

/**
 * Limpia el input de abreviaturas comunes que marean a Georef
 */
function limpiarDireccionFront(input: string): string {
    let clean = input;
    clean = clean.replace(/\b(B°|b°|B\.|b\.|Barrio|barrio)\b\s*/g, '');
    clean = clean.replace(/\b(Av\.|av\.|Avda\.|avda\.|Avenida|avenida)\b\s*/g, 'Av ');
    clean = clean.replace(/[/]/g, ' ');
    return clean.replace(/\s+/g, ' ').trim();
}

function normalizarParaComparar(s: string | undefined | null): string {
    return (s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

const ALIAS_CABA = ['capital federal', 'caba', 'ciudad autonoma de buenos aires', 'ciudad de buenos aires'];
const esCaba = (s: string | undefined | null) => ALIAS_CABA.includes(normalizarParaComparar(s));

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
 * Consulta cruda a Georef Frontend
 */
async function callGeorefFront(direccionStr: string, filtros?: DireccionFiltros): Promise<DireccionPreview | null> {
    try {
        const params = new URLSearchParams({ direccion: direccionStr, max: '1' });
        if (filtros?.provincia) params.set('provincia', filtros.provincia);
        if (filtros?.localidad) params.set('localidad', filtros.localidad);
        const url = `https://apis.datos.gob.ar/georef/api/direcciones?${params.toString()}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);

        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!res.ok) return null;

        const data = await res.json();
        if (!data.direcciones?.length) {
            return null;
        }

        const dir = data.direcciones[0];
        return {
            valido: true,
            normalizada: dir.nomenclatura,
            provincia: dir.provincia?.nombre,
            localidad: dir.localidad_censal?.nombre || dir.departamento?.nombre,
        };
    } catch (error) {
        return null;
    }
}

async function intentarConFiltros(direccion: string, filtros?: DireccionFiltros): Promise<DireccionPreview | null> {
    const direccionInicial = direccion.trim();
    let res = await callGeorefFront(direccionInicial, filtros);
    if (res?.valido) return res;

    const partesComa = direccionInicial.split(/,|-/);
    if (partesComa.length > 1) {
        const supuestaCalle = partesComa[0].trim();
        if (supuestaCalle.length >= 3) {
            res = await callGeorefFront(supuestaCalle, filtros);
            if (res?.valido) return res;
        }
    }

    const direccionLimpia = limpiarDireccionFront(direccionInicial);
    if (direccionLimpia !== direccionInicial && direccionLimpia.length >= 3) {
        res = await callGeorefFront(direccionLimpia, filtros);
        if (res?.valido) return res;

        const limpiaPartes = direccionLimpia.split(/,|-/);
        if (limpiaPartes.length > 1) {
            const limpiaCalle = limpiaPartes[0].trim();
            if (limpiaCalle.length >= 3) {
                res = await callGeorefFront(limpiaCalle, filtros);
                if (res?.valido) return res;
            }
        }
    }
    return null;
}

/**
 * 🔍 Valida y normaliza una dirección argentina usando Georef.
 * Si se pasan filtros (localidad/provincia), exige que el match coincida.
 * Si encuentra la calle pero en otra localidad, devuelve sugerencia (no valido).
 */
export async function validarDireccionArgentinaFront(
    input: string,
    filtros?: DireccionFiltros,
): Promise<DireccionPreview> {
    if (!input || input.trim().length < 3) {
        return { valido: false, motivoInvalido: 'La dirección es demasiado corta' };
    }

    // 1. Búsqueda restringida por localidad + provincia
    if (filtros?.localidad || filtros?.provincia) {
        const conFiltros = await intentarConFiltros(input, filtros);
        if (conFiltros?.valido && coincideLocalidad(filtros.localidad, conFiltros.localidad)) {
            return conFiltros;
        }

        // 2. Si no aparece en esa localidad, intentar solo con provincia (puede ser typo de localidad)
        if (filtros?.provincia) {
            const soloProv = await intentarConFiltros(input, { provincia: filtros.provincia });
            if (soloProv?.valido) {
                return {
                    valido: false,
                    motivoInvalido: `No se encontró en "${filtros.localidad ?? ''}".`,
                    sugerencia: {
                        localidad: soloProv.localidad,
                        provincia: soloProv.provincia,
                        normalizada: soloProv.normalizada,
                    },
                };
            }
        }

        return {
            valido: false,
            motivoInvalido: `Georef no encontró esta dirección en ${filtros.localidad || filtros.provincia}`,
        };
    }

    // 3. Sin filtros: intento abierto (compatibilidad con usos antiguos)
    const res = await intentarConFiltros(input);
    if (res?.valido) return res;

    return { valido: false, motivoInvalido: 'Georef no pudo encontrar la calle indicada' };
}

/**
 * 🧠 Helper visual para mostrar mensaje contextual
 */
export function getHelperTextDireccion(preview: DireccionPreview | null): string | undefined {
    if (!preview) return undefined;
    if (preview.valido)
        return `Se guardará como: ${preview.normalizada} (${preview.localidad || ''}, ${preview.provincia || ''})`;
    return `Dirección inválida${preview.motivoInvalido ? `: ${preview.motivoInvalido}` : ''}`;
}  