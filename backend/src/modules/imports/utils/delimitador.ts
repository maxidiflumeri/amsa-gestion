// utils/delimitador.ts
//
// Normaliza el separador guardado en la plantilla al carácter real que espera
// `fast-csv` (que exige un delimitador de UN solo carácter).
//
// El combo de la UI (PlantillaEditor) guardaba el tabulador como la cadena literal
// de 2 caracteres "\t" (barra + t) porque un atributo JSX `value="\t"` NO interpreta
// las secuencias de escape. Al llegar así a `fast-csv`, el delimitador nunca matchea
// y el archivo queda todo en una sola columna. Esta función mapea esas cadenas
// literales (y algunos nombres comunes) al carácter de control correspondiente, de
// forma que también se reparan las plantillas ya guardadas con el valor incorrecto.

const ESCAPES: Record<string, string> = {
    '\\t': '\t',   // "\t" literal (barra + t) guardado por la UI
    '\\n': '\n',
    '\\r': '\r',
    TAB: '\t',
    tab: '\t',
};

/**
 * Devuelve el carácter delimitador real a pasar a `fast-csv`.
 * - Convierte escapes escritos como texto ("\t", "tab", "TAB") a su carácter.
 * - Deja intactos los separadores normales (',', ';', '|', un tab real, etc.).
 */
export function resolveDelimiter(sep: string | null | undefined): string {
    if (sep == null || sep === '') return ',';
    return ESCAPES[sep] ?? sep;
}
