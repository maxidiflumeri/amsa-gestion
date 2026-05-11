export function fechaRelativa(isoString: string): string {
    const ahora = Date.now();
    const fecha = new Date(isoString).getTime();
    const diffMs = ahora - fecha;

    if (isNaN(diffMs)) return isoString;

    const seg = Math.floor(diffMs / 1000);
    if (seg < 60) return 'hace un momento';

    const min = Math.floor(seg / 60);
    if (min < 60) return `hace ${min} min`;

    const hs = Math.floor(min / 60);
    if (hs < 24) return `hace ${hs} h`;

    const dias = Math.floor(hs / 24);
    if (dias < 30) return `hace ${dias} d`;

    return new Date(isoString).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
