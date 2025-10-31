export type DireccionPreview = {
    valido: boolean;
    normalizada?: string;
    provincia?: string;
    localidad?: string;
    motivoInvalido?: string;
};

/**
 * 🔍 Valida y normaliza una dirección argentina
 * usando la API pública de Georef Argentina
 */
export async function validarDireccionArgentinaFront(
    input: string
): Promise<DireccionPreview> {
    if (!input || input.trim().length < 3) {
        return { valido: false, motivoInvalido: 'La dirección es demasiado corta' };
    }

    try {
        const url = `https://apis.datos.gob.ar/georef/api/direcciones?direccion=${encodeURIComponent(
            input.trim()
        )}&max=1`;
        const res = await fetch(url);
        const data = await res.json();

        if (!data.direcciones?.length) {
            return { valido: false, motivoInvalido: 'No se encontró una dirección válida' };
        }

        const dir = data.direcciones[0];

        return {
            valido: true,
            normalizada: dir.nomenclatura,
            provincia: dir.provincia?.nombre,
            localidad: dir.localidad_censal?.nombre || dir.departamento?.nombre,
        };
    } catch (error) {
        return { valido: false, motivoInvalido: 'Error al consultar Georef Argentina' };
    }
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