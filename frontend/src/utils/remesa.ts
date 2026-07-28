/**
 * Etiqueta de una remesa para mostrar en los selectores.
 *
 * Se muestra el **número de remesa**, no el nombre: cuando el operador no escribe un nombre, el
 * wizard genera uno del estilo "Remesa 28/7/2026, 11:52:15", y en un combo con varias cargas del
 * mismo día eso no distingue nada. El número es el correlativo de la empresa (00001, 00002, …) y es
 * el que la gente usa para referirse a una carga.
 *
 * Dos casos heredados se resuelven acá para no mostrar basura:
 *  - **Números que son un timestamp** (12+ dígitos, `1784657478166`): los generaba el frontend viejo
 *    cuando el operador dejaba el campo vacío. En la base hay 31. Se muestra la fecha de creación,
 *    que es lo que ese número significa, en vez del chorizo de dígitos.
 *  - **Sin número**: se cae al nombre.
 */
export function etiquetaRemesa(r: {
    numeroRemesa?: string | null;
    nombre?: string | null;
    createdAt?: string | Date | null;
}): string {
    const numero = (r.numeroRemesa ?? '').trim();

    if (numero && !esTimestamp(numero)) return numero;

    if (numero && esTimestamp(numero)) {
        const fecha = fechaCorta(r.createdAt) ?? fechaCorta(Number(numero));
        return fecha ? `s/n · ${fecha}` : numero;
    }

    return (r.nombre ?? '').trim() || 'Sin número';
}

/** Los correlativos reales tienen pocos dígitos; 12+ es el `Date.now()` que dejó el wizard viejo. */
function esTimestamp(n: string): boolean {
    return /^\d{12,}$/.test(n);
}

function fechaCorta(valor: string | Date | number | null | undefined): string | null {
    if (valor == null) return null;
    const d = new Date(valor);
    return isNaN(d.getTime()) ? null : d.toLocaleDateString('es-AR');
}
