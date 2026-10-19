import { PathAST } from '../parser/path-ast';

/** ¿El path termina en `[count]`? Es la cantidad de elementos de la última rama. */
export function terminaEnCount(ast: PathAST): boolean {
  const ultimo = ast.segments[ast.segments.length - 1];
  return ultimo.modifiers.some((m) => m.type === 'aggregator' && m.aggregator === 'count');
}

function coincideFiltro(item: any, campo: string, valor: string): boolean {
  let actual: any = item;
  for (const parte of campo.split('.')) {
    if (actual === null || actual === undefined) return false;
    actual = actual[parte];
  }
  if (actual === null || actual === undefined) return false;
  return String(actual).toLowerCase() === String(valor).toLowerCase();
}

/**
 * La cantidad **total** de elementos de la última rama de un path que termina en `[count]`, sumando
 * los de todos los elementos de las ramas del medio. `convenios.cuotas[count]` son las cuotas de
 * todos los convenios; sin convenios, 0.
 *
 * Antes se resolvía como cualquier otro path, con cardinalidad "primero": miraba solo el primer
 * convenio y, si no había ninguno, daba `null` y el caso desaparecía tanto de `= 0` como de `> 0`.
 * Los `[campo=valor]` de cada segmento se aplican igual que en el resolver (sin distinguir
 * mayúsculas).
 */
export function contarRama(fila: any, ast: PathAST): number {
  let actuales: any[] = [fila];

  ast.segments.forEach((segmento) => {
    const siguientes: any[] = [];
    for (const actual of actuales) {
      const valor = actual?.[segmento.name];
      if (valor === null || valor === undefined) continue;
      const items: any[] = Array.isArray(valor) ? [...valor] : [valor];
      for (const filtro of segmento.modifiers) {
        if (filtro.type !== 'filter') continue;
        for (const { field, value } of filtro.filters) {
          for (let k = items.length - 1; k >= 0; k--) {
            if (!coincideFiltro(items[k], field, value)) items.splice(k, 1);
          }
        }
      }
      siguientes.push(...items);
    }
    actuales = siguientes;
  });

  return actuales.length;
}
