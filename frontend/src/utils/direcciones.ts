export type DireccionPreview = {
    valido: boolean;
    normalizada?: string;
    provincia?: string;
    localidad?: string;
    motivoInvalido?: string;
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

/**
 * Consulta cruda a Georef Frontend
 */
async function callGeorefFront(direccionStr: string): Promise<DireccionPreview | null> {
    try {
        const url = `https://apis.datos.gob.ar/georef/api/direcciones?direccion=${encodeURIComponent(direccionStr)}&max=1`;
        // Timeout nativo de Fetch usando AbortController (3.5 segundos)
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

/**
 * 🔍 Valida y normaliza una dirección argentina
 * usando la API pública de Georef Argentina (Con Reintentos Inteligentes)
 */
export async function validarDireccionArgentinaFront(
    input: string
): Promise<DireccionPreview> {
    if (!input || input.trim().length < 3) {
        return { valido: false, motivoInvalido: 'La dirección es demasiado corta' };
    }

    const direccionInicial = input.trim();

    // 1. Original
    let res = await callGeorefFront(direccionInicial);
    if (res && res.valido) return res;

    // 2. Cortar coma/guion
    const partesComa = direccionInicial.split(/,|-/);
    if (partesComa.length > 1) {
        const supuestaCalle = partesComa[0].trim();
        if (supuestaCalle.length >= 3) {
            res = await callGeorefFront(supuestaCalle);
            if (res && res.valido) return res;
        }
    }

    // 3. Limpieza Intensiva
    const direccionLimpia = limpiarDireccionFront(direccionInicial);
    if (direccionLimpia !== direccionInicial && direccionLimpia.length >= 3) {
        res = await callGeorefFront(direccionLimpia);
        if (res && res.valido) return res;
        
        // 4. Limpieza + Cortar Coma
        const limpiaPartes = direccionLimpia.split(/,|-/);
        if (limpiaPartes.length > 1) {
            const limpiaCalle = limpiaPartes[0].trim();
            if (limpiaCalle.length >= 3) {
                res = await callGeorefFront(limpiaCalle);
                if (res && res.valido) return res;
            }
        }
    }

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