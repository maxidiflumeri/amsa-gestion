import { Logger, BadRequestException } from '@nestjs/common';
import { PathAST, PathSegment, Selector } from '../parser/path-ast';
import { Aggregator } from './aggregator';

export class PathResolver {
  private readonly logger = new Logger(PathResolver.name);
  private aggregator = new Aggregator();

  /**
   * Resuelve un path completo sobre una fila de datos.
   * Soporta: relaciones, agregadores, filtros, indexadores, acceso JSON.
   */
  resolve(fila: any, path: PathAST, cardinalidad?: 'expandir' | 'concatenar' | 'primero' | 'ultimo'): any {
    let current = fila;

    for (let i = 0; i < path.segments.length; i++) {
      const segment = path.segments[i];
      const isLastSegment = i === path.segments.length - 1;

      if (current === null || current === undefined) {
        return null;
      }

      // Acceso al campo/relación
      current = current[segment.name];

      // Si no existe el campo, retornar null
      if (current === undefined) {
        return null;
      }

      // Aplicar modificadores
      if (segment.modifiers.length > 0) {
        current = this.applyModifiers(current, segment.modifiers, isLastSegment, path.raw);
      }
    }

    return current;
  }

  private applyModifiers(value: any, modifiers: Selector[], isLastSegment: boolean, pathRaw: string): any {
    let result = value;

    for (let i = 0; i < modifiers.length; i++) {
      const modifier = modifiers[i];
      const isLastModifier = i === modifiers.length - 1;

      if (modifier.type === 'filter') {
        // Filtrar la relación
        if (!Array.isArray(result)) {
          this.logger.warn(`Path ${pathRaw}: filtro aplicado sobre no-array, se ignora`);
          continue;
        }

        result = this.applyFilter(result, modifier.filters);
      } else if (modifier.type === 'aggregator') {
        // Aplicar agregador
        result = this.applyAggregator(result, modifier.aggregator, isLastSegment, isLastModifier, pathRaw);
      } else if (modifier.type === 'indexer') {
        // Indexar array
        if (Array.isArray(result) && result.length > modifier.index) {
          result = result[modifier.index];
        } else {
          return null;
        }
      }
    }

    return result;
  }

  private applyFilter(items: any[], filters: Array<{ field: string; value: string }>): any[] {
    let filtered = items;

    for (const filter of filters) {
      filtered = filtered.filter(item => {
        const fieldValue = this.getNestedField(item, filter.field);

        // Comparación flexible: strings, números, booleans
        if (fieldValue === null || fieldValue === undefined) {
          return false;
        }

        // Normalizar a string para comparar
        return String(fieldValue).toLowerCase() === String(filter.value).toLowerCase();
      });
    }

    return filtered;
  }

  private applyAggregator(
    value: any,
    aggregator: string,
    isLastSegment: boolean,
    isLastModifier: boolean,
    pathRaw: string,
  ): any {
    if (!Array.isArray(value)) {
      this.logger.warn(`Path ${pathRaw}: agregador [${aggregator}] aplicado sobre no-array`);
      return null;
    }

    switch (aggregator) {
      case 'sum':
      case 'avg':
      case 'min':
      case 'max':
        // Estos agregadores necesitan un campo escalar después
        // Si es el último modifier y último segment, error
        if (isLastSegment && isLastModifier) {
          throw new BadRequestException(
            `Path ${pathRaw}: agregador [${aggregator}] requiere campo escalar después (ej: pagos[sum].importe)`,
          );
        }
        // Si no es el último modifier, no aplicar aún (se aplicará después con el campo)
        // Por ahora retornamos el array filtrado para que el siguiente segmento acceda al campo
        return value;

      case 'count':
        return this.aggregator.count(value);

      case 'first':
        return this.aggregator.first(value);

      case 'last':
        return this.aggregator.last(value);

      case 'concat':
        // concat necesita campo después, pero lo manejaremos en el nivel superior
        // Si es último modifier, error
        if (isLastSegment && isLastModifier) {
          throw new BadRequestException(
            `Path ${pathRaw}: agregador [concat] requiere campo escalar después`,
          );
        }
        return value;

      default:
        this.logger.warn(`Agregador desconocido: ${aggregator}`);
        return null;
    }
  }

  /**
   * Resuelve un path que incluye agregadores numéricos (sum, avg, min, max).
   * Este método se llama cuando detectamos que un path tiene un agregador numérico.
   */
  resolveWithNumericAggregator(fila: any, path: PathAST): any {
    // Buscar el segmento con agregador numérico
    for (let i = 0; i < path.segments.length; i++) {
      const segment = path.segments[i];

      for (const modifier of segment.modifiers) {
        if (modifier.type === 'aggregator' && ['sum', 'avg', 'min', 'max', 'concat'].includes(modifier.aggregator)) {
          // Resolver hasta este segmento para obtener el array
          const partialPath: PathAST = {
            segments: path.segments.slice(0, i + 1).map((seg, idx) => {
              if (idx === i) {
                // Remover el agregador numérico de los modifiers
                return {
                  ...seg,
                  modifiers: seg.modifiers.filter(m => m !== modifier),
                };
              }
              return seg;
            }),
            raw: path.raw,
          };

          const arrayValue = this.resolve(fila, partialPath);

          if (!Array.isArray(arrayValue)) {
            return null;
          }

          // El campo escalar viene en el siguiente segmento
          if (i + 1 >= path.segments.length) {
            throw new BadRequestException(
              `Path ${path.raw}: agregador [${modifier.aggregator}] requiere campo escalar después`,
            );
          }

          const campoSegment = path.segments[i + 1];
          const campo = campoSegment.name;

          // Aplicar agregador
          switch (modifier.aggregator) {
            case 'sum':
              return this.aggregator.sum(arrayValue, campo);
            case 'avg':
              return this.aggregator.avg(arrayValue, campo);
            case 'min':
              return this.aggregator.min(arrayValue, campo);
            case 'max':
              return this.aggregator.max(arrayValue, campo);
            case 'concat':
              // Buscar separador si está definido en la columna
              return this.aggregator.concat(arrayValue, campo, ', ');
          }
        }
      }
    }

    // Si no encontramos agregador numérico, resolver normal
    return this.resolve(fila, path);
  }

  /**
   * Detecta si un path tiene un agregador numérico
   */
  hasNumericAggregator(path: PathAST): boolean {
    for (const segment of path.segments) {
      for (const modifier of segment.modifiers) {
        if (modifier.type === 'aggregator' && ['sum', 'avg', 'min', 'max', 'concat'].includes(modifier.aggregator)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Resuelve múltiples columnas sobre una fila y retorna un objeto plano.
   */
  resolveToFlat(
    fila: any,
    columnas: Array<{ path: PathAST; label: string; cardinalidad?: string; separadorConcat?: string }>,
  ): Record<string, any> {
    const flat: Record<string, any> = {};

    for (const col of columnas) {
      let valor: any;

      if (this.hasNumericAggregator(col.path)) {
        valor = this.resolveWithNumericAggregator(fila, col.path);
      } else {
        valor = this.resolve(fila, col.path, col.cardinalidad as any);
      }

      flat[col.label] = valor;
    }

    return flat;
  }

  private getNestedField(obj: any, path: string): any {
    if (!obj || !path) {
      return null;
    }

    const parts = path.split('.');
    let current = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return null;
      }
      current = current[part];
    }

    return current;
  }
}

