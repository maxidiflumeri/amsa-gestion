/**
 * ¿La app está corriendo dentro de un iframe?
 *
 * Es el caso de la Toolbar de Neotel (ver `docs/neotel-toolbar-spec.md`). Cambia dos cosas: el
 * layout —no van menú ni barra superior— y el login, que no puede hacerse acá adentro.
 *
 * El acceso a `window.top` puede tirar una excepción de seguridad cuando el contenedor es de otro
 * origen; que falle ya significa que estamos embebidos.
 */
export function estaEmbebido(): boolean {
    try {
        return window.self !== window.top;
    } catch {
        return true;
    }
}
