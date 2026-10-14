import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Carpeta `frontend/` del repo, calculada desde este archivo (ninguna ruta absoluta). */
export const RAIZ_FE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** Raíz del repositorio. */
export const RAIZ_REPO = path.resolve(RAIZ_FE, '..');
