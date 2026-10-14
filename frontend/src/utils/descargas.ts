import { isAxiosError } from 'axios';

/** Entrega un archivo al navegador: crea la URL, dispara la descarga y la libera. */
export function descargarBlob(blob: Blob, nombre: string): void {
    const url = URL.createObjectURL(blob);
    try {
        const a = document.createElement('a');
        a.href = url;
        a.download = nombre;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
    } finally {
        // Se libera en la tarea siguiente: algunos navegadores empiezan a leer la URL después del click.
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }
}

/** El texto de un Blob. `Blob.text()` no existe en todos los navegadores viejos ni en jsdom: se usa FileReader. */
function leerComoTexto(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const lector = new FileReader();
        lector.onload = () => resolve(String(lector.result ?? ''));
        lector.onerror = () => reject(lector.error ?? new Error('No se pudo leer el cuerpo del error'));
        lector.readAsText(blob);
    });
}

/**
 * Con `responseType: 'blob'` el cuerpo de un error también llega como Blob: sin leerlo, el mensaje sería el genérico
 * de axios ("Request failed with status code 404"). Devuelve el mensaje del backend, o uno propio si no hay.
 */
export async function mensajeDeErrorDeBlob(err: unknown): Promise<string> {
    if (isAxiosError(err)) {
        const data: unknown = err.response?.data;
        if (typeof Blob !== 'undefined' && data instanceof Blob) {
            try {
                const parsed: unknown = JSON.parse(await leerComoTexto(data));
                const mensaje = (parsed as { message?: unknown } | null)?.message;
                if (typeof mensaje === 'string' && mensaje.trim() !== '') return mensaje;
                if (Array.isArray(mensaje) && mensaje.length > 0) return mensaje.map(String).join(' ');
            } catch {
                // el cuerpo no era JSON: se cae al mensaje genérico de abajo
            }
        } else if (data && typeof data === 'object') {
            const mensaje = (data as { message?: unknown }).message;
            if (typeof mensaje === 'string' && mensaje.trim() !== '') return mensaje;
        }
        if (!err.response) return 'No se pudo descargar el archivo: no hay conexión con el servidor.';
    }
    return 'No se pudo descargar el archivo.';
}
