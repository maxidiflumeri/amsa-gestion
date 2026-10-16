/** El enlace que abre un caso en Gestión. Lo usan Inicio y el detalle de los tableros. */
export function linkCaso(deudorId: number): string {
    return `/gestion?deudor=${deudorId}`;
}

/**
 * El caso que pide la URL (`?deudor=12`). Solo enteros positivos: cualquier otra cosa (`abc`, `0`, `-3`, `1.5`, vacío)
 * da null y Gestión se comporta como siempre (abre el último caso).
 */
export function leerDeudorDeUrl(search: string): number | null {
    const valor = new URLSearchParams(search).get('deudor');
    if (valor === null || !/^\d+$/.test(valor)) return null;
    const n = Number(valor);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
}
