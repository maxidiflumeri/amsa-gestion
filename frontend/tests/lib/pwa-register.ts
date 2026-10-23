// Reemplazo de `virtual:pwa-register` en los tests (el módulo lo genera vite-plugin-pwa al compilar; vitest no lo
// tiene). Guarda las opciones para que un test dispare "hay una versión nueva" y cuenta las actualizaciones pedidas.
type Opciones = { onNeedRefresh?: () => void; onRegisteredSW?: (url: string, r: ServiceWorkerRegistration | undefined) => void };

export const registro: { opciones: Opciones | null; actualizaciones: boolean[] } = { opciones: null, actualizaciones: [] };

export function registerSW(opciones: Opciones = {}) {
    registro.opciones = opciones;
    return async (recargar?: boolean) => {
        registro.actualizaciones.push(!!recargar);
    };
}
