// utils/ancho-fijo.ts
//
// Lectura de archivos de **ancho fijo** (fixed-width): cada campo ocupa siempre las mismas
// posiciones de la línea y no hay separador. Es el formato en el que exporta SAP y el que manda
// AYSA (31 archivos de cuentas + 31 de partidas por bajada).
//
// La salida de `parseLineaAnchoFijo` es un **array de valores por índice**, exactamente la misma
// forma que produce `fast-csv` con `headers:false`. Por eso el resto del pipeline —`mapRow()`, los
// transforms, los bloques repetitivos y todos los processors— funciona sin enterarse: para la
// plantilla, la columna 3 de un ancho fijo es igual a la columna 3 de un CSV.
//
// El recorrido va por **stream** (`crearStreamAnchoFijo`) y no leyendo el archivo entero como hacen
// `multirregistro-parser` y `multiarchivo-parser`: el TXT de partidas más grande de AYSA son 64 MB y
// el conjunto 250 MB, que cargados a memoria como string JS se duplican (UTF-16).

import { Transform } from 'stream';
import { StringDecoder } from 'string_decoder';
import { AnchoFijoConfig, ColumnaAnchoFijo } from '../mapping-types';

/** Líneas de muestra que mira el inferidor. Suficiente para que los campos vacíos se delaten. */
const LINEAS_MUESTRA = 500;

/**
 * Valida el layout declarado en la plantilla y falla con un mensaje que dice **qué columna** está
 * mal. Un layout roto no se puede detectar mirando el resultado: produce filas con los campos
 * corridos, que se importan sin error y quedan con datos de otra columna.
 *
 * No se valida que las columnas sean contiguas ni que no se solapen: declarar dos veces el mismo
 * tramo (por ejemplo, un campo entero y una parte de él) es legítimo.
 */
export function validarColumnasAnchoFijo(columnas: ColumnaAnchoFijo[] | undefined): void {
    if (!columnas?.length) {
        throw new Error('El layout de ancho fijo no declara ninguna columna.');
    }
    columnas.forEach((c, i) => {
        const ref = c?.nombre?.trim() ? `"${c.nombre}"` : `#${i + 1}`;
        if (!c?.nombre?.trim()) {
            throw new Error(`La columna ${ref} del layout de ancho fijo no tiene nombre.`);
        }
        if (!Number.isInteger(c.inicio) || c.inicio < 0) {
            throw new Error(`La columna ${ref} tiene un inicio inválido (${c.inicio}): debe ser un entero ≥ 0.`);
        }
        if (!Number.isInteger(c.largo) || c.largo < 1) {
            throw new Error(`La columna ${ref} tiene un largo inválido (${c.largo}): debe ser un entero ≥ 1.`);
        }
    });
}

/**
 * Corta una línea según el layout.
 *
 * Los valores se trimean: en ancho fijo el relleno son espacios y nunca es dato. Los ceros a la
 * izquierda **se conservan** (`000003662688`), que es lo que hace de la cuenta contrato una clave
 * usable — si se quieren sin ceros, es un transform de la plantilla.
 *
 * Una línea más corta que el layout no es un error: las últimas columnas quedan en `''`. Los
 * exports de SAP recortan la cola cuando los campos finales vienen vacíos.
 */
export function parseLineaAnchoFijo(linea: string, columnas: ColumnaAnchoFijo[]): string[] {
    return columnas.map((c) => linea.slice(c.inicio, c.inicio + c.largo).trim());
}

/** Ancho total que espera el layout (la posición final más lejana). */
export function anchoTotal(columnas: ColumnaAnchoFijo[]): number {
    return columnas.reduce((max, c) => Math.max(max, c.inicio + c.largo), 0);
}

/**
 * Stream que convierte un archivo de ancho fijo en filas ya cortadas.
 *
 * Se enchufa donde el pipeline usa `fastcsv.parse()` y emite lo mismo que éste con `headers:false`:
 * un `string[]` por fila. Las líneas en blanco se descartan (los TXT de los cedentes suelen cerrar
 * con un salto de línea final).
 */
export function crearStreamAnchoFijo(
    cfg: AnchoFijoConfig,
    opts: { tieneHeader?: boolean } = {},
): Transform {
    validarColumnasAnchoFijo(cfg.columnas);

    const decoder = new StringDecoder(cfg.encoding === 'utf8' ? 'utf8' : 'latin1');
    const columnas = cfg.columnas;
    let resto = '';
    let quedaHeader = opts.tieneHeader !== false;

    const emitir = (self: Transform, linea: string): void => {
        if (!linea.trim()) return;
        if (quedaHeader) {
            quedaHeader = false;
            return;
        }
        self.push(parseLineaAnchoFijo(linea, columnas));
    };

    return new Transform({
        readableObjectMode: true,
        transform(chunk, _enc, cb) {
            // El decoder retiene los bytes de un carácter multibyte partido entre dos chunks.
            resto += decoder.write(chunk as Buffer);
            const lineas = resto.split(/\r?\n/);
            // La última puede estar cortada al medio: vuelve al buffer hasta el próximo chunk.
            resto = lineas.pop() ?? '';
            for (const l of lineas) emitir(this, l);
            cb();
        },
        flush(cb) {
            resto += decoder.end();
            for (const l of resto.split(/\r?\n/)) emitir(this, l);
            cb();
        },
    });
}

/**
 * Infiere un layout mirando el archivo. Es el punto de partida del editor de plantillas, **no** una
 * detección confiable: el resultado se muestra cortado en pantalla para que el operador lo corrija.
 *
 * Criterio: una posición separa columnas si es espacio **tanto en el encabezado como en todas las
 * filas de muestra**. Mirar solo los datos parte campos por el medio (una cuenta `133` seguida de
 * relleno se leería como dos columnas); mirar solo el encabezado tampoco alcanza, porque los
 * nombres vienen pegados (`Of. Cobro` + `División` ocupan `Of. CobroDivisión`).
 *
 * Lo que este criterio **no** puede resolver son los campos pegados en ambos lados: `F. Desde` y
 * `F. Hasta` en el archivo de AYSA quedan fusionados porque ni el encabezado ni ninguna fila tienen
 * un espacio entre las dos fechas. Esos cortes los agrega el operador a mano, una vez por cartera.
 */
export function inferirColumnasAnchoFijo(
    contenido: Buffer | string,
    opts: { encoding?: 'latin1' | 'utf8'; tieneHeader?: boolean } = {},
): ColumnaAnchoFijo[] {
    const texto = Buffer.isBuffer(contenido)
        ? contenido.toString(opts.encoding === 'utf8' ? 'utf8' : 'latin1')
        : contenido;

    const lineas = texto.split(/\r?\n/).filter((l) => l.trim());
    if (lineas.length === 0) return [];

    const conHeader = opts.tieneHeader !== false;
    const header = conHeader ? lineas[0] : '';
    const datos = (conHeader ? lineas.slice(1) : lineas).slice(0, LINEAS_MUESTRA);
    if (datos.length === 0) return [];

    const ancho = Math.max(header.length, ...datos.map((l) => l.length));

    // Posiciones que son espacio (o no existen) en el encabezado y en todas las filas de muestra.
    const esSeparador = (i: number): boolean =>
        (header[i] ?? ' ') === ' ' && datos.every((l) => (l[i] ?? ' ') === ' ');

    // Arranques de cada bloque de contenido.
    const arranques: number[] = [];
    for (let i = 0; i < ancho; i++) {
        if (!esSeparador(i) && (i === 0 || esSeparador(i - 1))) arranques.push(i);
    }
    if (arranques.length === 0) return [];

    // Cada columna llega hasta el arranque de la siguiente, así el relleno queda dentro del campo y
    // el layout cubre la línea entera sin huecos.
    const usados = new Set<string>();
    return arranques.map((inicio, i) => {
        const fin = i + 1 < arranques.length ? arranques[i + 1] : ancho;
        const base = header.slice(inicio, fin).trim() || `columna_${i + 1}`;
        // El encabezado de AYSA repite "Nombre de calle", "Localidad" y demás para las dos
        // direcciones. Sin desambiguar, la plantilla no podría referirse a la segunda.
        let nombre = base;
        for (let n = 2; usados.has(nombre); n++) nombre = `${base} (${n})`;
        usados.add(nombre);
        return { nombre, inicio, largo: fin - inicio };
    });
}
