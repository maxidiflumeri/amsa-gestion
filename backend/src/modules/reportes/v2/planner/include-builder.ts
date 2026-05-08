import { PathAST, PathSegment } from '../parser/path-ast';
import { Logger } from '@nestjs/common';

// Lista de campos conocidos que NO son relaciones (campos JSON, escalares)
const SCALAR_FIELDS_KNOWN = ['camposAdicionales'];

export class IncludeBuilder {
  private readonly logger = new Logger(IncludeBuilder.name);

  buildInclude(paths: PathAST[]): any {
    const includeMap = new Map<string, any>();

    for (const path of paths) {
      this.processPath(path, includeMap);
    }

    return this.mapToNestedObject(includeMap);
  }

  private processPath(path: PathAST, includeMap: Map<string, any>): void {
    let currentKey = '';

    // Incluir todas las relaciones del path, no solo hasta el penúltimo segmento
    // Porque ahora necesitamos incluir también las relaciones finales cuando hay agregadores
    for (let i = 0; i < path.segments.length; i++) {
      const segment = path.segments[i];
      const isLastSegment = i === path.segments.length - 1;

      // Si el segmento tiene modificadores (agregadores, filtros), es una relación
      const hasModifiers = segment.modifiers && segment.modifiers.length > 0;

      // Detectar si es un campo escalar conocido (JSON, etc.)
      const isScalarField = SCALAR_FIELDS_KNOWN.includes(segment.name);

      // Incluir si:
      // 1. No es el último segmento (siempre incluir intermedios)
      // 2. Es el último pero tiene modificadores (es una relación con agregador)
      // 3. NO es un campo escalar conocido
      if (!isScalarField && (!isLastSegment || hasModifiers)) {
        const prevKey = currentKey;
        currentKey = currentKey ? `${currentKey}.${segment.name}` : segment.name;

        if (!includeMap.has(currentKey)) {
          includeMap.set(currentKey, { path: currentKey, parent: prevKey || null, children: new Map() });
        }
      } else if (isScalarField && i < path.segments.length - 1) {
        // Si es un campo JSON y hay más segmentos, actualizar el currentKey
        // para que los segmentos hijos (ej: camposAdicionales.cuotas_vencidas)
        // no se intenten incluir como relaciones
        currentKey = currentKey ? `${currentKey}.${segment.name}` : segment.name;
      }
    }
  }

  private mapToNestedObject(includeMap: Map<string, any>): any {
    const result: any = {};
    const roots: string[] = [];

    for (const [key, value] of includeMap.entries()) {
      if (!value.parent) {
        roots.push(key);
      }
    }

    for (const root of roots) {
      const parts = root.split('.');
      const rootName = parts[0];
      result[rootName] = this.buildNested(root, includeMap);
    }

    return result;
  }

  private buildNested(currentPath: string, includeMap: Map<string, any>): any {
    const children: string[] = [];

    for (const [key, value] of includeMap.entries()) {
      if (value.parent === currentPath) {
        children.push(key);
      }
    }

    if (children.length === 0) {
      return true;
    }

    const nested: any = { include: {} };

    for (const child of children) {
      const childName = child.split('.').pop();
      if (childName) {
        nested.include[childName] = this.buildNested(child, includeMap);
      }
    }

    return nested;
  }
}
