import { BadRequestException } from '@nestjs/common';
import { ColumnaDto, TotalDto } from '../dto/plantilla.dto';
import { esColumnaFija } from '../columna-fija';
import { OpcionesColumnaFormato } from './formatter';

/** Un total ya atado a la columna concreta sobre la que se calcula. */
export interface TotalResuelto extends TotalDto {
  /** `label` de la columna de la que se leen los valores; `undefined` si el path no es de ninguna columna. */
  claveColumna?: string;
  /** E3 de la columna (tipo `numero`): el total se muestra con los mismos decimales y separadores. */
  formatoColumna?: OpcionesColumnaFormato;
}

/** Los decimales y separadores de la columna, si es `numero` y los trae. */
function formatoE3(columna: ColumnaDto): OpcionesColumnaFormato | undefined {
  if (columna.tipo !== 'numero') return undefined;
  if (columna.decimales === undefined && columna.separadorDecimal === undefined && columna.separadorMiles === undefined) return undefined;
  return { decimales: columna.decimales, separadorDecimal: columna.separadorDecimal, separadorMiles: columna.separadorMiles };
}

/**
 * Ata cada total a **una** columna. Antes el total se buscaba por `path` y, si dos columnas
 * compartían campo («Vencimiento» como fecha y «Días de mora» como `dias`, las dos sobre
 * `fechaVencimiento`), ganaba la última: el promedio salía de las fechas formateadas y daba
 * 19.082.026 en vez de 60.
 *
 * - Con `columnaId`: esa columna (400 si no existe).
 * - Solo con `path`: la única columna con ese path (compatibilidad con los totales guardados);
 *   con dos o más es ambiguo y da 400. Sin ninguna, queda sin atar y se busca por el path.
 */
export function resolverTotales(columnas: ColumnaDto[], totales: TotalDto[] | undefined): TotalResuelto[] {
  return (totales ?? []).map((total) => {
    if (total.columnaId !== undefined && total.columnaId !== null && total.columnaId !== '') {
      const columna = columnas.find((c) => c.id === total.columnaId);
      if (!columna) {
        throw new BadRequestException(`El total sobre «${total.label || total.path}» apunta a una columna que no existe`);
      }
      return { ...total, claveColumna: columna.label, formatoColumna: formatoE3(columna) };
    }
    const mismas = columnas.filter((c) => !esColumnaFija(c) && c.path === total.path);
    if (mismas.length > 1) {
      throw new BadRequestException(`El total sobre «${total.path}» es ambiguo: hay dos columnas con ese campo`);
    }
    return mismas.length === 1
      ? { ...total, claveColumna: mismas[0].label, formatoColumna: formatoE3(mismas[0]) }
      : { ...total };
  });
}
