// utils/division-remesa.ts
//
// Un archivo, varias asignaciones adentro: cómo se parte en una remesa por corte.
//
// El caso que lo motiva: Telecom y Telecom Personal se bajan del sistema Deimos filtrando **solo
// por día**. Si ese día el cedente asignó cuatro nóminas, el CA (deudores) y el MA (facturas)
// llegan con las cuatro adentro, en un archivo solo. En gestión cada asignación es su propia
// remesa —tiene su número, su política y su corte de rendición—, así que cargarlas juntas mezcla
// carteras que después no se pueden separar.
//
// El archivo del 27/05 que motivó esto trae 19.538 filas con 5 nóminas (3082, 3083, 3084, 3085,
// 3086) y 4 gestiones (1G, 2G, 3G, 3GH).
//
// La implementación es deliberadamente chica: **dividir es crear N remesas sobre el mismo archivo,
// cada una con un filtro de filas extra**. No hay un motor nuevo, se reusa `filtro-filas.ts`, que
// ya sabe quedarse con un subconjunto del archivo sin contar las descartadas como errores. El
// archivo se guarda una sola vez y las N remesas lo comparten.

import { ColumnaDivision, DivisionRemesaConfig, FiltroFila } from '../mapping-types';

/** Un corte del archivo: qué valores lo definen, qué filtro lo aísla y cuántas filas tiene. */
export interface CorteRemesa {
    /** Valores del corte por etiqueta: `{ "Nómina": "3082", "Gestión": "3GH" }`. */
    valores: Record<string, string>;
    /** Condiciones que dejan pasar exactamente las filas de este corte. */
    filtros: FiltroFila[];
    /** Filas del archivo que caen acá (ya descontando el filtro propio de la plantilla). */
    filas: number;
    /**
     * Valor de la columna de gestión, si la división la usa. Es lo que deriva el número de remesa.
     * `null` cuando la plantilla solo divide por nómina.
     */
    gestion: string | null;
    /** Valor de la columna de nómina, si la división la usa. */
    nomina: string | null;
}

/** Columnas declaradas en la división, en el orden en que se muestran. */
export function columnasDeDivision(cfg: DivisionRemesaConfig | undefined): ColumnaDivision[] {
    if (!cfg) return [];
    return [cfg.porNomina, cfg.porGestion].filter((c): c is ColumnaDivision => !!c);
}

/** La plantilla pide dividir. */
export function divide(cfg: DivisionRemesaConfig | undefined): boolean {
    return columnasDeDivision(cfg).length > 0;
}

/**
 * Número de remesa derivado de la gestión: se le antepone su **primer dígito** al número base,
 * paddeado a 4. Es la convención de la operación: sobre la remesa `100`, la gestión `1GH` es la
 * `10100`, la `2GH` la `20100` y la `3GH` la `30100`.
 *
 * Una gestión sin ningún dígito (o una base que no es numérica) devuelve el número base tal cual:
 * es preferible que el operador vea el número sin prefijo y lo corrija a mano, a inventar uno.
 */
export function numeroConGestion(base: string, gestion: string | null | undefined): string {
    const limpio = (base ?? '').trim();
    if (!limpio || !/^\d+$/.test(limpio)) return limpio;

    const digito = String(gestion ?? '').match(/\d/)?.[0];
    if (!digito) return limpio;

    return `${digito}${limpio.padStart(4, '0')}`;
}

/**
 * Acumulador de cortes: se le pasan las filas crudas del archivo y devuelve los cortes con su
 * conteo. Cuenta en una sola pasada porque los archivos grandes se leen por stream.
 */
export class AcumuladorCortes {
    private readonly columnas: ColumnaDivision[];
    private readonly vistos = new Map<string, CorteRemesa>();

    constructor(private readonly cfg: DivisionRemesaConfig) {
        this.columnas = columnasDeDivision(cfg);
    }

    /** Hay algo que dividir. */
    get activo(): boolean {
        return this.columnas.length > 0;
    }

    agregar(fila: any[]): void {
        if (!this.activo) return;

        const valores: Record<string, string> = {};
        for (const col of this.columnas) {
            valores[col.etiqueta] = String(fila?.[col.fromIndex] ?? '').trim();
        }

        const clave = this.columnas.map((c) => valores[c.etiqueta]).join('');
        const ya = this.vistos.get(clave);
        if (ya) {
            ya.filas++;
            return;
        }

        this.vistos.set(clave, {
            valores,
            filtros: this.columnas.map((c) => ({
                fromIndex: c.fromIndex,
                operador: 'IGUAL' as const,
                valor: valores[c.etiqueta],
            })),
            filas: 1,
            gestion: this.cfg.porGestion ? valores[this.cfg.porGestion.etiqueta] : null,
            nomina: this.cfg.porNomina ? valores[this.cfg.porNomina.etiqueta] : null,
        });
    }

    /**
     * Cortes encontrados, del más grande al más chico.
     *
     * El orden por volumen y no alfabético es a propósito: lo primero que mira el operador es si el
     * corte principal tiene la cantidad de casos que le informó el cedente por mail.
     */
    cortes(): CorteRemesa[] {
        return [...this.vistos.values()].sort((a, b) => b.filas - a.filas);
    }
}
