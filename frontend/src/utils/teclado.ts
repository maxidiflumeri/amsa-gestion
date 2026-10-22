/** En una Mac los atajos se muestran con ⌘ (funcionan con Ctrl y con ⌘ en cualquier sistema). */
export const esMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');

/** La tecla modificadora como se dibuja en pantalla. */
export const TECLA_MOD = esMac ? '⌘' : 'Ctrl';
