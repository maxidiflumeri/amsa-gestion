/** El texto de un Blob (jsdom no trae `Blob.text()`). */
export function leerBlob(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const lector = new FileReader();
        lector.onload = () => resolve(String(lector.result ?? ''));
        lector.onerror = () => reject(lector.error ?? new Error('No se pudo leer el Blob'));
        lector.readAsText(blob);
    });
}
