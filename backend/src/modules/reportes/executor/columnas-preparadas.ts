import { PathAST } from '../parser/path-ast';
import { PathParser } from '../parser/path-parser';
import { DefinicionPlantillaDto } from '../dto/plantilla.dto';
import { esColumnaFija } from '../columna-fija';
import { campoFinal } from '../validador/definicion-validator';
import { clasificarFecha, TipoFecha } from '../validador/fechas-negocio';

/**
 * Una columna lista para resolver: el path ya parseado, la cardinalidad ya resuelta contra el
 * default de la plantilla y el patrón de teléfono ya buscado en el catálogo.
 *
 * `path` es `null` en las columnas fijas, que no tocan los datos (ver {@link esColumnaFija}).
 */
export interface ColumnaPreparada {
  path: PathAST | null;
  label: string;
  tipo?: string;
  formato?: string;
  cardinalidad: string;
  separadorConcat?: string;
  valorFijo?: string;
  /** E3 (tipo `numero`). */
  decimales?: number;
  separadorDecimal?: string;
  separadorMiles?: string;
  /** E2 (tipo `dias`): cómo se guarda la fecha del path, para elegir el día calendario o el local. */
  tipoFecha?: TipoFecha;
}

/** Cómo se guarda la fecha a la que apunta un path, o `undefined` si no apunta a una fecha del modelo. */
function tipoFechaDelPath(ast: PathAST): TipoFecha | undefined {
  const final = campoFinal('deudor', ast);
  if (final.claveJson || final.campo?.type !== 'DateTime') return undefined;
  return clasificarFecha(final.modelo ?? '', final.campo.name) ?? 'instante';
}

/**
 * Prepara las columnas de una plantilla. Vive acá y no adentro de cada executor porque son **dos**
 * —el sincrónico y el de streaming— y tienen que hacer exactamente lo mismo: cuando esto estaba
 * duplicado, el de streaming se quedó sin la resolución del `formatoTelefonoId`, así que cualquier
 * reporte grande —justo los que se van a async— ignoraba en silencio el formato de teléfono
 * elegido en la plantilla.
 */
export function prepararColumnas(
  definicion: DefinicionPlantillaDto,
  parser: PathParser,
  formatosTelefono: Map<number, string>,
): ColumnaPreparada[] {
  return definicion.columnas.map(col => {
    const ast = esColumnaFija(col) ? null : parser.parse(col.path);
    return {
      path: ast,
      label: col.label,
      tipo: col.tipo,
      formato:
        col.tipo === 'telefono' && col.formatoTelefonoId
          ? formatosTelefono.get(col.formatoTelefonoId) || col.formato
          : col.formato,
      cardinalidad: col.cardinalidad || definicion.cardinalidadDefault || 'primero',
      separadorConcat: col.separadorConcat,
      valorFijo: esColumnaFija(col) ? (col.valorFijo ?? '') : undefined,
      // Solo si la columna las trae: sin ellas el objeto queda como estaba (las claves sin definir no se agregan).
      ...(col.decimales !== undefined && { decimales: col.decimales }),
      ...(col.separadorDecimal !== undefined && { separadorDecimal: col.separadorDecimal }),
      ...(col.separadorMiles !== undefined && { separadorMiles: col.separadorMiles }),
      ...(col.tipo === 'dias' && ast && { tipoFecha: tipoFechaDelPath(ast) }),
    };
  });
}

/** Los patrones del catálogo que usa la plantilla, en una sola consulta. */
export async function cargarFormatosTelefono(
  prisma: { formato_telefono: { findMany: (args: any) => Promise<Array<{ id: number; patron: string }>> } },
  definicion: DefinicionPlantillaDto,
): Promise<Map<number, string>> {
  const ids = Array.from(
    new Set(
      definicion.columnas
        .map(c => c.formatoTelefonoId)
        .filter((v): v is number => typeof v === 'number'),
    ),
  );
  if (!ids.length) return new Map();

  const formatos = await prisma.formato_telefono.findMany({ where: { id: { in: ids } } });
  return new Map(formatos.map(f => [f.id, f.patron]));
}

/**
 * Columnas con cardinalidad `expandir`, que multiplican filas. Las fijas nunca entran: no salen de
 * una relación, así que no hay nada que expandir.
 */
export function columnasAExpandir(
  definicion: DefinicionPlantillaDto,
): Array<{ label: string; path: string }> {
  return definicion.columnas
    .filter(col => {
      if (esColumnaFija(col)) return false;
      const cardinalidad = col.cardinalidad || definicion.cardinalidadDefault || 'primero';
      return cardinalidad === 'expandir';
    })
    .map(col => ({ label: col.label, path: col.path }));
}
