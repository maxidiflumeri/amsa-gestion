// utils/hash-archivos.ts
//
// La ÚNICA implementación del hash de una remesa (`remesa.archivoHash`). La usan el alta (`createRemesa`) y la
// vista de cortes (`previewDivision`): si cada una calculara el suyo, la guarda de "este corte ya está cargado"
// (docs/imports-progreso-realtime-spec.md §10.5.6) no encontraría nunca nada, y lo haría en silencio.
//
// La fórmula es la que ya está guardada en las remesas de hoy y NO se puede cambiar sin dejar de reconocerlas:
//   - un archivo:   SHA-256 de sus bytes (lo que calcula `FileStorageService.saveBuffer`);
//   - varios:       SHA-256 de los hashes individuales ordenados y unidos con `|` (no depende del orden en que
//                   el operador los arrastró).
// La rama MULTIARCHIVO arma su hash con el rol de cada archivo y no pasa por acá: no admite división.
import * as crypto from 'crypto';

/** SHA-256 hexadecimal de los bytes de un archivo. */
export function hashDeBuffer(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** Hash de un conjunto de archivos a partir del hash de cada uno. Con uno solo, ese mismo hash. */
export function combinarHashes(hashes: string[]): string {
    if (hashes.length === 1) return hashes[0];
    return crypto.createHash('sha256').update([...hashes].sort().join('|')).digest('hex');
}

/** Hash de lo que sube el operador, a partir de los bytes de cada archivo. */
export function hashDeArchivos(buffers: Buffer[]): string {
    return combinarHashes(buffers.map(hashDeBuffer));
}
