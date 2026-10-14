// Configuración de los tests del frontend. Va aparte de vite.config.ts: `vite build` no la lee.
import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
/** El servidor falso (HTTP + socket.io) escucha siempre acá. Nunca la API real. */
export const PUERTO = 47831;

export default defineConfig({
    resolve: { alias: [{ find: /^@fe\//, replacement: `${AQUI}/src/` }] },
    esbuild: { jsx: 'automatic' },
    test: {
        environment: 'jsdom',
        environmentOptions: { jsdom: { url: `http://127.0.0.1:${PUERTO}/` } },
        setupFiles: ['./tests/setup.ts'],
        include: ['tests/**/*.test.{ts,tsx}'],
        testTimeout: 120_000,
        hookTimeout: 60_000,
        fileParallelism: false,
        css: false,
        // Ruido conocido: eventos de red que llegan entre dos act() y avisos de versión del router.
        onConsoleLog(log) {
            if (/not wrapped in act\(|React Router Future Flag|not configured to support act|out-of-range value `1` for the select/.test(log)) return false;
        },
        env: { VITE_API_URL: `http://127.0.0.1:${PUERTO}/api`, VITE_GOOGLE_CLIENT_ID: 'x' },
    },
});
