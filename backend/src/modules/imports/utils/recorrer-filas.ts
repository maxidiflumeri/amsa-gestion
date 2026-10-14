// utils/recorrer-filas.ts
//
// Recorrido de los archivos de una remesa, fila por fila, para las categorías de "una fila = un
// registro" (todas menos MULTIRREGISTRO y MULTIARCHIVO, que cruzan archivos y traen su propio parser).
//
// Resuelve dos cosas que antes estaban resueltas tres veces, con tres copias del mismo bucle
// (`validateRemesa`, `previewAccionesImpacto` y `processImportJob`):
//
//   1. **Varios archivos del mismo formato**, que se recorren como si fueran uno solo. Es lo que
//      necesita AYSA, que parte la cartera en 31 TXT (uno por sucursal) en vez de mandar uno grande.
//   2. **Los tres formatos**: delimitado (fast-csv), Excel (xlsx) y ancho fijo (`ancho-fijo.ts`).
//
// La fila siempre sale como `any[]` por índice, que es lo que consume `mapRow()`. Un archivo Excel y
// un TXT de ancho fijo llegan al mapeo indistinguibles.

import * as fs from 'fs';
import * as path from 'path';
import * as fastcsv from 'fast-csv';
import * as xlsx from 'xlsx';
import { AnchoFijoConfig } from '../mapping-types';
import { crearStreamAnchoFijo } from './ancho-fijo';

/**
 * El archivo no se pudo leer: está mal formado, no es el formato que declara la plantilla, o el
 * separador no es el que tiene configurado.
 *
 * Existe como clase propia para que el servicio la distinga de una falla del sistema y la devuelva
 * como 400 con el mensaje puesto, en vez del 500 opaco que veía el operador.
 */
export class ErrorDeParseo extends Error {
    constructor(mensaje: string, readonly archivo: string) {
        super(mensaje);
        this.name = 'ErrorDeParseo';
    }
}

export interface FilaLeida {
    /** Valores de la fila por índice, igual que `fast-csv` con `headers:false`. */
    valores: any[];
    /** Índice global 0-based, **acumulado entre archivos**. Es el contador que el runner usa de `rowNumber` del
     *  `importerror` (cuenta las filas que pasan los filtros, no las del archivo). */
    indice: number;
    /**
     * La fila en SU archivo, como la ve el operador (C3a): en Excel, el número de fila de la hoja; en un archivo de
     * texto, el número de registro contando el encabezado (coincide con la línea física salvo un campo entrecomillado
     * con saltos de línea). Con varios archivos reinicia en cada uno, a diferencia de `indice`.
     */
    linea: number | null;
    /**
     * `archivo.txt:1234` — de qué archivo salió la fila y en qué posición dentro de él (1-based,
     * sin contar el encabezado: a diferencia de `linea`).
     *
     * Es `null` cuando la remesa tiene un solo archivo: ahí el dato no aporta nada y agregarlo
     * cambiaría los mensajes de error de todas las cargas que ya funcionan.
     */
    origen: string | null;
}

export interface OpcionesRecorrido {
    /** Archivos a recorrer, en orden. Uno solo es el caso clásico. */
    paths: string[];
    /**
     * Nombre con el que el operador subió cada archivo, en el mismo orden que `paths`. Es lo que se
     * usa en `origen`: en el disco los archivos quedan como `<timestamp>_<hash>.txt`, que no le sirve
     * a nadie para encontrar el registro. Si falta, se cae al nombre del archivo guardado.
     */
    nombres?: string[];
    tieneHeader: boolean;
    /** Delimitador ya resuelto (ver `resolveDelimiter`). Se ignora si hay layout de ancho fijo. */
    separador: string;
    /** Layout de ancho fijo. Si viene, manda sobre el separador para los archivos de texto. */
    anchoFijo?: AnchoFijoConfig;
    /** Hoja del Excel, si la remesa la declaró. */
    hoja?: string;
}

/** Callback por fila. Si devuelve una promesa, el stream se pausa hasta que resuelva. */
export type OnFila = (fila: FilaLeida) => void | Promise<void>;

export const esExcel = (p: string): boolean => /\.(xls|xlsx)$/i.test(p);

const esPromesa = (x: unknown): x is Promise<unknown> =>
    !!x && typeof (x as Promise<unknown>).then === 'function';

/**
 * Recorre todos los archivos y llama a `onFila` por cada fila de datos. Devuelve el total leído.
 *
 * Los archivos de texto se leen por **stream**: el TXT de partidas más grande de AYSA son 64 MB y el
 * conjunto 250 MB. Los Excel no tienen streaming en `xlsx`, pero tampoco llegan a ese tamaño.
 */
export async function recorrerFilas(opts: OpcionesRecorrido, onFila: OnFila): Promise<number> {
    let indice = 0;
    const varios = opts.paths.length > 1;

    for (const [i, p] of opts.paths.entries()) {
        const nombre = opts.nombres?.[i] || path.basename(p);
        // Fila de datos dentro de SU archivo, 1-based y sin contar el encabezado — no el offset
        // global. Con 31 archivos, el número global no le sirve a nadie para encontrar el registro.
        let fila = 0;

        const emitir = (valores: any[], lineaExcel: number | null = null): void | Promise<void> => {
            fila++;
            return onFila({
                valores,
                indice: indice++,
                // Texto: el registro `fila` más el encabezado, que también es un registro del archivo.
                linea: lineaExcel ?? fila + (opts.tieneHeader ? 1 : 0),
                origen: varios ? `${nombre}:${fila}` : null,
            });
        };

        if (esExcel(p)) {
            const wb = xlsx.readFile(p, { cellDates: true, dateNF: 'yyyy-mm-dd' });
            const sheet = opts.hoja && wb.SheetNames.includes(opts.hoja) ? opts.hoja : wb.SheetNames[0];
            const filas: any[][] = xlsx.utils.sheet_to_json(wb.Sheets[sheet], {
                header: 1,
                defval: '',
                raw: false,
            });
            // `sheet_to_json` empieza en la primera fila del rango de la hoja (`!ref`), no en la 1: una hoja con
            // filas vacías arriba trae `!ref` desde la primera con datos. La fila de Excel de `filas[i]` es
            // `filaInicial + i + 1` (medido con una hoja de dos filas vacías arriba y vacías en el medio).
            const ref = wb.Sheets[sheet]['!ref'];
            const filaInicial = ref ? xlsx.utils.decode_range(ref).s.r : 0;
            for (let i = opts.tieneHeader ? 1 : 0; i < filas.length; i++) {
                if (filas[i]?.length) await emitir(filas[i], filaInicial + i + 1);
            }
            continue;
        }

        await new Promise<void>((resolve, reject) => {
            const parser = opts.anchoFijo
                ? crearStreamAnchoFijo(opts.anchoFijo, { tieneHeader: opts.tieneHeader, conLinea: true })
                // El pipeline mapea **por índice** (`fromIndex`), nunca por nombre de columna: pedirle
                // a fast-csv que interprete el encabezado no aporta nada y agrega un modo de falla
                // propio. Con `headers: true` un archivo con dos columnas que se llaman igual tira
                // `Duplicate headers found` y revienta la importación entera — es lo que pasaba con
                // el archivo de pagos de Personal, que manda `PAYMENT_METHOD_DES` dos veces.
                // `skipRows` descarta el encabezado como lo que es para nosotros: una fila que no
                // se procesa. (`skipRows` y no `skipLines` porque cuenta filas ya parseadas, así
                // que un encabezado con un salto de línea entrecomillado también sale bien.)
                : fastcsv.parse({
                    headers: false,
                    skipRows: opts.tieneHeader ? 1 : 0,
                    delimiter: opts.separador,
                    trim: false,
                });

            // Callback de la última fila, si todavía no terminó. `pause()` frena la lectura pero no
            // impide que `end` se emita cuando el archivo ya se agotó: sin esperar esto acá, el
            // recorrido termina con la última fila a medio procesar.
            let enVuelo: Promise<void> | null = null;

            parser
                .on('error', (e: any) => reject(new ErrorDeParseo(
                    `No se pudo leer "${nombre}": ${e?.message ?? 'error de formato'}. ` +
                    'Revisá que el separador y el formato de la plantilla sean los del archivo.',
                    nombre,
                )))
                .on('data', (row: any) => {
                    // fast-csv emite siempre un array (`headers:false`) y la línea se deduce contando registros;
                    // el stream de ancho fijo trae la línea física del archivo (cuenta las vacías).
                    const r = opts.anchoFijo ? emitir(row.valores, row.linea) : emitir(row);
                    if (esPromesa(r)) {
                        parser.pause();
                        enVuelo = r.then(() => {
                            enVuelo = null;
                            parser.resume();
                        });
                        enVuelo.catch(reject);
                    }
                })
                .on('end', () => {
                    ((enVuelo as Promise<void> | null) ?? Promise.resolve()).then(() => resolve(), reject);
                });

            fs.createReadStream(p).pipe(parser);
        });
    }

    return indice;
}

/**
 * Prefija el mensaje de error con el archivo y la línea de los que salió la fila.
 *
 * Con 31 archivos en una remesa, "falta el nro de cliente en la fila 24.891" no le sirve a nadie:
 * hay que poder abrir el TXT correcto en la línea correcta.
 */
export function conOrigen(mensaje: string, origen: string | null): string {
    return origen ? `[${origen}] ${mensaje}` : mensaje;
}
