import { ColumnaPerfil, HojaPerfil, PerfilEjemplo, encabezadoSeguro, filasDeDatos, formatoExcelSinLiterales, limpiarTexto } from './perfil-ejemplo';

/** Techo del bloque `<ejemplo>` que lee el modelo (el objetivo del spec son 2 a 15 KB). */
export const MAX_CARACTERES_EJEMPLO = 15_000;

/**
 * El bloque `<ejemplo …>` que lee el modelo (docs/asistente-reportes-spec.md §8.3). Solo estructura: los valores van
 * como forma (9 = dígito, X/x = letra). Todo lo que viene del archivo (nombre, hojas, encabezados) se limpia de `<` y `>`
 * para que no pueda cerrar el bloque.
 */

const q = (s: string) => limpiarTexto(s, 120).replace(/"/g, "'");

function lineaColumna(c: ColumnaPerfil): string {
    // Un «encabezado» con forma de dato (de un perfil viejo o de una fila mal tomada) nunca sale literal: sale su forma.
    const nombre = c.encabezado ? `«${encabezadoSeguro(limpiarTexto(c.encabezado, 80))}»` : `«columna ${c.n}»`;
    const partes: string[] = [];
    partes.push(c.tipo);
    if (c.anchoFijo) partes.push(`posiciones ${c.anchoFijo.inicio}–${c.anchoFijo.inicio + c.anchoFijo.largo - 1}`);
    if (c.formato) partes.push(c.formato);
    if (c.formatoExcel) {
        // Un código de formato puede traer texto literal entre comillas o escapado ("GOMEZ 30111222 "0): no viaja.
        partes.push(`formato de Excel ${limpiarTexto(formatoExcelSinLiterales(c.formatoExcel), 40)}`);
    }
    if (c.largo && c.tipo === 'texto' && !c.formato) partes.push(c.largo.min === c.largo.max ? `largo ${c.largo.max}` : `largo ${c.largo.min}–${c.largo.max}`);
    partes.push(`vacías ${c.vacias}/${c.total}`);
    if (c.formas.length > 0) partes.push(`forma: ${c.formas.join(' · ')}`);
    if (c.reconocidos.length > 0) partes.push(`coincide con el sistema: ${c.reconocidos.map((r) => `«${limpiarTexto(r.valor, 60)}» (${r.campo})`).join(', ')}`);
    return `- ${c.n}. ${nombre}: ${partes.join('; ')}`;
}

function describirHojas(p: PerfilEjemplo, usada: number): string {
    if (p.hojas.length === 1 && p.hojas[0].nombre === null) return '';
    const hojas = p.hojas.map((h, i) => `«${encabezadoSeguro(limpiarTexto(h.nombre ?? '', 80))}» (${h.filasLeidas} ${h.filasLeidas === 1 ? 'fila' : 'filas'}${i === usada ? ', la usada' : ''})`);
    return `Hojas: ${hojas.join(', ')}`;
}

/** Nombre de la hoja que pidió `ver_otra_hoja`, o la usada. */
export function hojaPorNombre(p: PerfilEjemplo, nombre: string): number {
    const n = nombre.trim().toLowerCase();
    return p.hojas.findIndex((h) => (h.nombre ?? '').toLowerCase() === n);
}

export function perfilATexto(p: PerfilEjemplo, id: number, opciones: { hoja?: number; yaEnviado?: boolean } = {}): string {
    const usada = opciones.hoja ?? p.hojaUsada;
    const h: HojaPerfil = p.hojas[usada] ?? p.hojas[0];
    const cabecera = `<ejemplo id="${id}" archivo="${q(p.archivo)}" tipo="${p.tipo}">`;
    const lineas: string[] = [cabecera];

    const hojas = describirHojas(p, usada);
    if (hojas) lineas.push(hojas);
    if (p.texto) {
        const t = p.texto;
        const sep = t.anchoFijo ? 'ancho fijo (sin separador)' : t.separador ? `separador ${t.separador === 'TAB' ? 'tabulación' : `«${t.separador}»`}` : 'una sola columna';
        lineas.push(
            `Texto ${t.encoding}${t.bom ? ' con BOM' : ' sin BOM'}, fin de línea ${t.finDeLinea}, ${sep}${t.anchoFijo ? `, ${t.anchoFijo.anchoLinea} caracteres por línea` : ''}.`,
        );
    }
    const datos = filasDeDatos(h);
    lineas.push(
        `${datos} ${datos === 1 ? 'fila' : 'filas'} de datos${h.filasTotales !== null && h.filasTotales > h.filasLeidas ? ` (se leyeron las primeras ${h.filasLeidas} de ${h.filasTotales})` : ''}, ${h.columnas.length} ${h.columnas.length === 1 ? 'columna' : 'columnas'}, ${h.conEncabezado ? 'con encabezado' : 'sin encabezado'}.`,
    );
    if (h.columnas.length === 0) {
        lineas.push('La hoja está vacía.');
    } else {
        lineas.push('Columnas (los valores van solo como forma: 9 = dígito, X/x = letra):');
        // Con muchas columnas o tramos largos el bloque se acota: se recortan las últimas, con aviso.
        const fijas = lineas.join('\n').length + 1500 + (p.texto?.anchoFijo ? p.texto.anchoFijo.mapaClases.length : 0);
        let usado = fijas;
        const columnas = h.columnas.map(lineaColumna);
        const entran: string[] = [];
        for (const l of columnas) {
            if (usado + l.length + 1 > MAX_CARACTERES_EJEMPLO) break;
            entran.push(l);
            usado += l.length + 1;
        }
        lineas.push(...entran);
        if (entran.length < columnas.length) lineas.push(`(Se muestran las primeras ${entran.length} de ${columnas.length} columnas: el resto no se detalla porque el archivo es muy grande.)`);
    }
    if (p.texto?.anchoFijo) {
        lineas.push(`Qué hay en cada posición, en todas las filas: ${p.texto.anchoFijo.mapaClases.slice(0, 4000)}.`);
        lineas.push('Ojo: un tramo de dígitos puede juntar varios campos pegados; no hay forma de saber dónde se corta. Preguntale a la persona.');
    }
    lineas.push('</ejemplo>');
    return lineas.join('\n');
}
