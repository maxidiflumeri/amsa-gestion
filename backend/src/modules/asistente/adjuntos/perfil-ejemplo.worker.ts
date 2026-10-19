import { parentPort, workerData } from 'worker_threads';
import { ErrorPerfil, MapaReconocibles, perfilarArchivo } from './perfil-ejemplo';

/**
 * Entrada del `worker_thread` (docs/asistente-reportes-spec.md §9.4). Lee el archivo con SheetJS dentro de un hilo con
 * límites de memoria y de tiempo: la prototype pollution de SheetJS queda en el realm de este hilo, que se descarta, y un
 * ReDoS no traba el event loop del backend.
 */
const { buffer, nombre, reconocibles } = workerData as { buffer: Uint8Array; nombre: string; reconocibles: MapaReconocibles };

try {
    const perfil = perfilarArchivo(Buffer.from(buffer), nombre, reconocibles);
    parentPort!.postMessage({ ok: true, perfil });
} catch (e) {
    if (e instanceof ErrorPerfil) parentPort!.postMessage({ ok: false, codigo: e.codigo, mensaje: e.message });
    else parentPort!.postMessage({ ok: false, codigo: 'ILEGIBLE', mensaje: 'No pude leer el archivo: parece dañado.' });
}
