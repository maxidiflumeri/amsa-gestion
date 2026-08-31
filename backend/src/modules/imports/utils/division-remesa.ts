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
// Y un mismo CA puede traer nóminas de **prebaja** y de **posbaja**, que son carteras de empresas
// distintas (Telecom / Telecom Personal). Por eso el operador elige, en la pantalla de carga, qué
// cortes entran en esta corrida: sube el archivo dos veces, una por empresa, y en cada una tilda
// las nóminas que le corresponden.
//
// La implementación es deliberadamente chica: **dividir es crear N remesas sobre el mismo archivo,
// cada una con un filtro de filas extra**. No hay un motor nuevo, se reusa `filtro-filas.ts`, que
// ya sabe quedarse con un subconjunto del archivo sin contar las descartadas como errores.

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
     * Clave de las columnas de **corte** (todas menos la del prefijo). Los cortes que la comparten
     * son el mismo número base: es lo que hace que las tres gestiones de una nómina salgan
     * `10100`, `20100`, `30100` y no `10100`, `20101`, `30102`.
     */
    claveCorte: string;
    /**
     * **Dígito** de la columna de prefijo (la gestión): lo que aporta al número de remesa y lo que
     * agrupa el corte —`3G` y `3GH` caen juntas—. `null` cuando no hay columna de prefijo.
     */
    prefijo: string | null;
    /**
     * Variantes crudas de la gestión que cayeron en este corte (`['3GH', '3G']`). Son las que arman
     * el filtro: un corte que agrupó dos variantes no se aísla con un `IGUAL`.
     */
    valoresPrefijo: string[];
}

/** La división, con las dos formas de declararla resueltas a una sola. */
export interface DivisionNormalizada {
    /** Columnas que cortan y que reciben su propio número base (nómina, prebaja/posbaja, producto). */
    cortes: ColumnaDivision[];
    /** Columna cuyo primer dígito prefija el número base (gestión). Como mucho una. */
    prefijo?: ColumnaDivision;
}

/**
 * Resuelve la config a una sola forma.
 *
 * `porNomina`/`porGestion` es la forma con la que nació la función y se sigue leyendo: son un corte
 * y un prefijo. La forma nueva (`cortes[]` + `prefijo`) existe porque un CA puede necesitar cortarse
 * también por prebaja/posbaja, que es lo que separa las dos empresas.
 */
export function normalizarDivision(cfg: DivisionRemesaConfig | undefined): DivisionNormalizada {
    if (!cfg) return { cortes: [] };

    const cortes = [
        ...(cfg.porNomina ? [cfg.porNomina] : []),
        ...(cfg.cortes ?? []),
    ];
    const prefijo = cfg.prefijo ?? cfg.porGestion;

    return { cortes, prefijo };
}

/** Columnas declaradas, en el orden en que se muestran: los cortes primero, el prefijo al final. */
export function columnasDeDivision(cfg: DivisionRemesaConfig | undefined): ColumnaDivision[] {
    const { cortes, prefijo } = normalizarDivision(cfg);
    return prefijo ? [...cortes, prefijo] : cortes;
}

/** La plantilla pide dividir. */
export function divide(cfg: DivisionRemesaConfig | undefined): boolean {
    return columnasDeDivision(cfg).length > 0;
}

/**
 * Número de remesa derivado de la gestión. La convención de la operación, sobre la remesa `0608`:
 *
 * | Gestión | Número | Por qué |
 * |---|---|---|
 * | `1G` | `0608` | La **primera** gestión es la carga original: conserva el número, sin prefijo |
 * | `2G` | `20608` | La segunda antepone su dígito |
 * | `3G` / `3GH` | `30608` | Ídem, y las dos son la misma gestión |
 *
 * El prefijo **reemplaza el relleno** del correlativo en vez de estirar el número: sobre `00608` la
 * gestión 2 es `20608` y no `200608`. Los ceros a la izquierda son el formato del número de remesa
 * de la empresa, no parte del número.
 *
 * Una gestión sin ningún dígito (o una base que no es numérica) devuelve el número base tal cual:
 * es preferible que el operador vea el número sin prefijo y lo corrija a mano, a inventar uno.
 */
export function numeroConGestion(base: string, gestion: string | null | undefined): string {
    const limpio = (base ?? '').trim();
    if (!limpio || !/^\d+$/.test(limpio)) return limpio;

    const digito = digitoDeGestion(gestion);
    if (!digito || digito === '1') return limpio;

    const nucleo = limpio.replace(/^0+/, '') || '0';
    return `${digito}${nucleo.padStart(4, '0')}`;
}

/**
 * El dígito de la gestión: lo que prefija el número **y lo que la identifica**.
 *
 * Para la operación `3G` y `3GH` son la **misma gestión** —el sufijo es una variante del cedente,
 * no otra asignación—, así que sus filas van a la misma remesa. Por eso el corte agrupa por este
 * dígito y no por el valor crudo de la columna.
 *
 * Una gestión sin ningún dígito devuelve `null` y entonces manda el valor crudo: es preferible
 * dejar dos cortes separados a juntar cosas que no se sabe si van juntas.
 */
export function digitoDeGestion(gestion: string | null | undefined): string | null {
    return String(gestion ?? '').match(/\d/)?.[0] ?? null;
}

/** `00100` + 2 → `00102`, conservando el ancho del correlativo. */
export function correlativoDesde(base: string, offset: number): string {
    if (!/^\d+$/.test(base)) return base;
    return String(parseInt(base, 10) + offset).padStart(base.length, '0');
}

/**
 * Número de remesa sugerido para cada corte.
 *
 * La regla, que es la de la operación y no una invención del sistema:
 *
 *  - El número base **avanza por cada combinación distinta de las columnas de corte** (la nómina, y
 *    lo que se haya agregado). Dos nóminas son dos números: `100` y `101`.
 *  - La columna de prefijo (la gestión) **no avanza nada**: solo le antepone su dígito al base de su
 *    corte. Una nómina con tres gestiones da `100`, `20100` y `30100` — el mismo `100` tres veces:
 *    pelado en la primera gestión, con prefijo en las otras. Ver {@link numeroConGestion}.
 *  - Sin columnas de corte (se divide solo por gestión), todos comparten el base y lo único que los
 *    separa es el dígito.
 */
export function numerosSugeridos(cortes: CorteRemesa[], base: string): string[] {
    const baseDe = new Map<string, string>();

    for (const corte of cortes) {
        if (!baseDe.has(corte.claveCorte)) {
            baseDe.set(corte.claveCorte, correlativoDesde(base, baseDe.size));
        }
    }

    return cortes.map((c) => numeroConGestion(baseDe.get(c.claveCorte) ?? base, c.prefijo));
}

/**
 * Acumulador de cortes: se le pasan las filas crudas del archivo y devuelve los cortes con su
 * conteo. Cuenta en una sola pasada porque los archivos grandes se leen por stream.
 */
export class AcumuladorCortes {
    private readonly division: DivisionNormalizada;
    private readonly columnas: ColumnaDivision[];
    private readonly vistos = new Map<string, CorteRemesa>();

    constructor(cfg: DivisionRemesaConfig) {
        this.division = normalizarDivision(cfg);
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

        const colPrefijo = this.division.prefijo;
        const crudo = colPrefijo ? valores[colPrefijo.etiqueta] : null;
        // Lo que agrupa es el DÍGITO de la gestión, no su valor crudo: `3G` y `3GH` son la misma
        // gestión para la operación y tienen que terminar en la misma remesa.
        const digito = crudo != null ? digitoDeGestion(crudo) ?? crudo : null;

        const claveCorte = this.division.cortes.map((c) => valores[c.etiqueta]).join('\u0000');
        const clave = colPrefijo ? `${claveCorte}\u0000${digito}` : claveCorte;

        const ya = this.vistos.get(clave);
        if (ya) {
            ya.filas++;
            if (crudo != null && !ya.valoresPrefijo.includes(crudo)) {
                // Variante nueva de la misma gestión: cambia lo que se muestra y el filtro.
                ya.valoresPrefijo.push(crudo);
                ya.valores[colPrefijo!.etiqueta] = ya.valoresPrefijo.join(' / ');
                ya.filtros = this.filtrosDe(ya.valores, ya.valoresPrefijo);
            }
            return;
        }

        const valoresPrefijo = crudo != null ? [crudo] : [];
        this.vistos.set(clave, {
            valores,
            filtros: this.filtrosDe(valores, valoresPrefijo),
            filas: 1,
            claveCorte,
            prefijo: digito,
            valoresPrefijo,
        });
    }

    /**
     * Las condiciones que dejan pasar exactamente las filas del corte: `IGUAL` por cada columna de
     * corte y, para la gestión, `EN` con sus variantes —`IGUAL` mientras haya una sola—.
     */
    private filtrosDe(valores: Record<string, string>, valoresPrefijo: string[]): FiltroFila[] {
        const filtros: FiltroFila[] = this.division.cortes.map((c) => ({
            fromIndex: c.fromIndex,
            operador: 'IGUAL' as const,
            valor: valores[c.etiqueta],
        }));

        const colPrefijo = this.division.prefijo;
        if (colPrefijo) {
            filtros.push(
                valoresPrefijo.length > 1
                    ? { fromIndex: colPrefijo.fromIndex, operador: 'EN', valores: [...valoresPrefijo] }
                    : { fromIndex: colPrefijo.fromIndex, operador: 'IGUAL', valor: valoresPrefijo[0] ?? '' },
            );
        }

        return filtros;
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
