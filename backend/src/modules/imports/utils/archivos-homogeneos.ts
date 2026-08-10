// utils/archivos-homogeneos.ts
//
// Validación de un lote de archivos que se suben juntos a una **misma categoría** y se procesan como
// si fueran uno solo (AYSA parte la cartera en 31 TXT, uno por sucursal).
//
// A diferencia de `roles-multiarchivo.ts` —que resuelve qué archivo cumple qué rol dentro de un
// paquete de archivos distintos— acá todos los archivos son el mismo formato y ninguno tiene un
// papel especial. Lo único que hay que verificar es justamente eso: que sean el mismo formato.
//
// Falla fuerte ante la duda, por el mismo motivo que el resolvedor de roles: un archivo colado de
// otra cartera se importa sin dar error y deja cientos de casos con los campos corridos. Es más
// barato que el operador vuelva a subir.

/** Un archivo tal como lo entrega multer (`memoryStorage`). */
interface ArchivoSubido {
    originalname?: string;
    buffer: Buffer;
}

/** Bytes que se leen de cada archivo para comparar el encabezado. */
const BYTES_HEADER = 64 * 1024;

const esExcel = (nombre: string): boolean => /\.(xls|xlsx)$/i.test(nombre);

/** Primera línea no vacía del archivo, decodificada como Latin-1 (no se pierde ningún byte). */
function primeraLinea(f: ArchivoSubido): string {
    const texto = f.buffer.subarray(0, BYTES_HEADER).toString('latin1');
    for (const l of texto.split(/\r?\n/)) {
        if (l.trim()) return l;
    }
    return '';
}

/**
 * Verifica que los archivos de un lote sean todos del mismo formato.
 *
 * @param archivos Los archivos subidos, tal como los entrega multer.
 * @param opts.tieneHeader Si la plantilla declara encabezado. Solo entonces se comparan los
 *   encabezados entre sí: sin él, la primera línea es un dato y difiere legítimamente.
 */
export function validarArchivosHomogeneos(
    archivos: ArchivoSubido[],
    opts: { tieneHeader?: boolean } = {},
): void {
    if (archivos.length < 2) return;

    const nombre = (f: ArchivoSubido, i: number) => f.originalname || `archivo ${i + 1}`;

    // 1. El mismo archivo subido dos veces duplicaría todas sus filas.
    const vistos = new Map<string, number>();
    for (const [i, f] of archivos.entries()) {
        const n = nombre(f, i);
        vistos.set(n, (vistos.get(n) ?? 0) + 1);
    }
    const repetidos = [...vistos.entries()].filter(([, n]) => n > 1).map(([n]) => n);
    if (repetidos.length > 0) {
        throw new Error(
            `Hay archivos repetidos en la selección: ${repetidos.join(', ')}. ` +
            'Sus filas se importarían dos veces — quitá los duplicados y volvé a subir.',
        );
    }

    // 2. Un Excel y un TXT no se leen igual; mezclarlos es siempre un error de selección.
    const conExcel = archivos.filter((f, i) => esExcel(nombre(f, i)));
    if (conExcel.length > 0 && conExcel.length < archivos.length) {
        throw new Error(
            'La selección mezcla planillas de Excel con archivos de texto. ' +
            'Todos los archivos de una misma carga tienen que ser del mismo tipo.',
        );
    }
    // El contenido de un Excel no se puede comparar sin abrir el workbook; alcanza con lo anterior.
    if (conExcel.length > 0) return;

    // 3. Encabezados distintos = archivos de layouts distintos. Es el caso que de verdad pasa:
    //    colar un archivo de partidas entre los de cuentas.
    if (opts.tieneHeader === false) return;

    const [primero, ...resto] = archivos;
    const headerBase = primeraLinea(primero);
    for (const [i, f] of resto.entries()) {
        const h = primeraLinea(f);
        if (h !== headerBase) {
            throw new Error(
                `El archivo "${nombre(f, i + 1)}" tiene un encabezado distinto al de ` +
                `"${nombre(primero, 0)}": no son del mismo formato y no se pueden cargar juntos.`,
            );
        }
    }
}
