import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PathParser } from '../parser/path-parser';
import { IncludeBuilder } from './include-builder';
import { PathAST } from '../parser/path-ast';
import { DefinicionPlantillaDto } from '../dto/plantilla-v2.dto';

export interface QueryPlan {
  where: any;
  include: any;
  orderBy?: any;
  take?: number;
  requiresPostProcessing: boolean;
  postProcessingFilters: Array<{ path: string; operador: string; valor: any }>;
}

@Injectable()
export class QueryPlanner {
  private readonly logger = new Logger(QueryPlanner.name);
  private parser = new PathParser();
  private includeBuilder = new IncludeBuilder();

  planQuery(
    definicion: DefinicionPlantillaDto,
    filtrosVars?: Record<string, any>,
    preview: boolean = false,
  ): QueryPlan {
    this.logger.log('Planificando query para F2');

    const paths: PathAST[] = [];
    let requiresPostProcessing = false;

    // Parsear todos los paths de columnas
    for (const columna of definicion.columnas) {
      const ast = this.parser.parse(columna.path);
      paths.push(ast);

      // Detectar si requiere post-procesamiento
      for (const segment of ast.segments) {
        for (const modifier of segment.modifiers) {
          if (modifier.type === 'aggregator' && !['first', 'count'].includes(modifier.aggregator)) {
            requiresPostProcessing = true;
          }
          if (modifier.type === 'filter') {
            requiresPostProcessing = true;
          }
          if (modifier.type === 'indexer') {
            requiresPostProcessing = true;
          }
        }
      }
    }

    // Parsear paths de filtros para construir includes
    if (definicion.filtros) {
      for (const filtro of definicion.filtros) {
        const ast = this.parser.parse(filtro.path);
        paths.push(ast);
      }
    }

    const include = this.includeBuilder.buildInclude(paths);

    const { where, postProcessingFilters } = this.buildWhere(definicion, filtrosVars, preview);

    if (postProcessingFilters.length > 0) {
      requiresPostProcessing = true;
    }

    this.applyListFiltersToInclude(include, definicion, filtrosVars, preview);

    const plan: QueryPlan = {
      where,
      include,
      requiresPostProcessing,
      postProcessingFilters,
    };

    if (definicion.ordenamientos && definicion.ordenamientos.length > 0) {
      plan.orderBy = this.buildOrderBy(definicion.ordenamientos);
    }

    if (definicion.limiteFilas) {
      plan.take = definicion.limiteFilas;
    }

    return plan;
  }

  private buildWhere(
    definicion: DefinicionPlantillaDto,
    filtrosVars?: Record<string, any>,
    preview: boolean = false,
  ): { where: any; postProcessingFilters: Array<{ path: string; operador: string; valor: any }> } {
    if (!definicion.filtros || definicion.filtros.length === 0) {
      return { where: {}, postProcessingFilters: [] };
    }

    const conditions: any[] = [];
    const postProcessingFilters: Array<{ path: string; operador: string; valor: any }> = [];

    for (const filtro of definicion.filtros) {
      let valor = filtro.valor;
      const sinValor =
        filtro.operador !== 'isNull' && filtro.operador !== 'isNotNull';

      // Resolver variables
      if (filtro.variable) {
        if (filtrosVars && (filtrosVars[filtro.id] !== undefined || filtrosVars[filtro.path] !== undefined)) {
          valor = filtrosVars[filtro.id] ?? filtrosVars[filtro.path];
        } else if (filtro.valorPorDefecto !== undefined) {
          valor = filtro.valorPorDefecto;
        } else if (preview) {
          continue;
        } else if (filtro.obligatorio) {
          throw new BadRequestException(
            `Filtro variable "${filtro.labelVariable || filtro.id}" es requerido pero no se proporcionó valor`,
          );
        } else {
          continue;
        }
      }

      // Saltar filtro si el valor está vacío
      if (sinValor && this.esValorVacio(valor)) {
        if (filtro.variable && filtro.obligatorio && !preview) {
          throw new BadRequestException(
            `Filtro variable "${filtro.labelVariable || filtro.id}" es requerido pero no se proporcionó valor`,
          );
        }
        continue;
      }

      const condition = this.buildCondition(filtro.path, filtro.operador, valor, postProcessingFilters);
      if (condition) {
        conditions.push(condition);
      }
    }

    if (conditions.length === 0) {
      return { where: {}, postProcessingFilters };
    }

    return { where: { AND: conditions }, postProcessingFilters };
  }

  private buildCondition(
    path: string,
    operador: string,
    valor: any,
    postProcessingFilters: Array<{ path: string; operador: string; valor: any }>,
  ): any {
    // Detectar si el path contiene agregadores o filtros
    const ast = this.parser.parse(path);
    const hasAggregator = ast.segments.some(seg =>
      seg.modifiers.some(mod => mod.type === 'aggregator'),
    );
    const hasFilter = ast.segments.some(seg =>
      seg.modifiers.some(mod => mod.type === 'filter'),
    );

    // Si tiene agregadores o filtros sobre relaciones, debe ser post-procesado
    if (hasAggregator || hasFilter) {
      // Casos especiales optimizables con Prisma
      if (hasAggregator && ast.segments.length >= 1) {
        // Buscar el modificador count en el path
        const segmentWithCount = ast.segments.find(seg =>
          seg.modifiers.some(mod => mod.type === 'aggregator' && mod.aggregator === 'count'),
        );

        if (segmentWithCount) {
          const relacion = segmentWithCount.name;

          // pagos[count] > 0 → { pagos: { some: {} } }
          if (operador === 'gt' && valor === 0) {
            this.logger.log(`Optimizando filtro ${path} > 0 con Prisma "some"`);
            return { [relacion]: { some: {} } };
          }

          // pagos[count] = 0 → { pagos: { none: {} } }
          if (operador === 'eq' && valor === 0) {
            this.logger.log(`Optimizando filtro ${path} = 0 con Prisma "none"`);
            return { [relacion]: { none: {} } };
          }
        }
      }

      // No se puede optimizar, debe ir a post-procesamiento
      this.logger.warn(
        `Filtro sobre path con agregador/filtro "${path}" requiere post-procesamiento (no se puede expresar en Prisma where)`,
      );
      postProcessingFilters.push({ path, operador, valor });
      return null;
    }

    // Path simple o relacional (sin agregadores)
    const parts = path.split('.');

    if (parts.length === 1) {
      // Campo escalar directo
      return this.buildPrismaCondition('deudor', parts[0], operador, valor);
    } else {
      // Path relacional: empresa.nombre, estadoSituacion.clave, contactos.tipo
      return this.buildNestedCondition(parts, operador, valor, 'deudor');
    }
  }

  private buildNestedCondition(
    parts: string[],
    operador: string,
    valor: any,
    modeloActual: string,
  ): any {
    const [first, ...rest] = parts;

    const field = this.getRelationField(modeloActual, first);
    const isList = field?.isList === true;
    const tipoModelo = field?.type;

    const inner =
      rest.length === 1
        ? this.buildPrismaCondition(tipoModelo || modeloActual, rest[0], operador, valor)
        : tipoModelo
          ? this.buildNestedCondition(rest, operador, valor, tipoModelo)
          : null;

    if (inner === null) {
      return null;
    }

    if (isList) {
      return { [first]: { some: inner } };
    }

    return { [first]: inner };
  }

  private applyListFiltersToInclude(
    include: any,
    definicion: DefinicionPlantillaDto,
    filtrosVars?: Record<string, any>,
    preview: boolean = false,
  ): void {
    if (!include || !definicion.filtros || definicion.filtros.length === 0) return;

    for (const filtro of definicion.filtros) {
      const parts = filtro.path.split('.');
      if (parts.length < 2) continue;

      const ast = this.parser.parse(filtro.path);
      const hasModifiers = ast.segments.some(seg => seg.modifiers.length > 0);
      if (hasModifiers) continue;

      let valor = filtro.valor;
      if (filtro.variable) {
        if (filtrosVars && (filtrosVars[filtro.id] !== undefined || filtrosVars[filtro.path] !== undefined)) {
          valor = filtrosVars[filtro.id] ?? filtrosVars[filtro.path];
        } else if (filtro.valorPorDefecto !== undefined) {
          valor = filtro.valorPorDefecto;
        } else {
          continue;
        }
      }
      if (this.esValorVacio(valor)) continue;

      this.injectListFilter(include, parts, 'deudor', filtro.operador, valor);
    }
  }

  private injectListFilter(
    includeNode: any,
    parts: string[],
    modeloActual: string,
    operador: string,
    valor: any,
  ): void {
    if (!includeNode || parts.length === 0) return;
    const [first, ...rest] = parts;

    const field = this.getRelationField(modeloActual, first);
    if (!field || field.kind !== 'object') return;

    const child = includeNode[first];
    if (child === undefined) return;

    let childObj: any;
    if (child === true) {
      childObj = {};
      includeNode[first] = childObj;
    } else if (typeof child === 'object') {
      childObj = child;
    } else {
      return;
    }

    if (rest.length === 1) {
      // Prisma sólo acepta `where` dentro de include para relaciones 1-N
      if (!field.isList) return;
      const cond = this.buildPrismaCondition(field.type, rest[0], operador, valor);
      if (!cond) return;
      childObj.where = childObj.where
        ? { AND: [childObj.where, cond] }
        : cond;
      return;
    }

    if (childObj.include) {
      this.injectListFilter(childObj.include, rest, field.type, operador, valor);
    }
  }

  private esValorVacio(valor: any): boolean {
    if (valor === undefined || valor === null || valor === '') return true;
    if (Array.isArray(valor)) {
      if (valor.length === 0) return true;
      return valor.every(v => v === undefined || v === null || v === '');
    }
    return false;
  }

  private getRelationField(modelName: string, fieldName: string): any | null {
    const modelo = (Prisma.dmmf.datamodel.models as any[]).find(
      m => m.name.toLowerCase() === modelName.toLowerCase(),
    );
    if (!modelo) return null;
    return modelo.fields.find((f: any) => f.name === fieldName) || null;
  }

  private coerceValor(modeloActual: string, fieldName: string, valor: any): any {
    const field = this.getRelationField(modeloActual, fieldName);
    if (!field || field.kind !== 'scalar') return valor;

    const coerce = (v: any): any => {
      if (v == null || v === '') return v;
      if (field.type === 'Int' || field.type === 'BigInt') {
        const n = typeof v === 'number' ? v : parseInt(String(v), 10);
        return Number.isNaN(n) ? v : n;
      }
      if (field.type === 'Float' || field.type === 'Decimal') {
        const n = typeof v === 'number' ? v : parseFloat(String(v));
        return Number.isNaN(n) ? v : n;
      }
      if (field.type === 'DateTime') {
        if (v instanceof Date) return v;
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? v : d;
      }
      if (field.type === 'Boolean') {
        if (typeof v === 'boolean') return v;
        if (v === 'true') return true;
        if (v === 'false') return false;
        return v;
      }
      return v;
    };

    if (Array.isArray(valor)) return valor.map(coerce);
    return coerce(valor);
  }

  private buildPrismaCondition(modeloActual: string, field: string, operador: string, valorOriginal: any): any {
    const valor = this.coerceValor(modeloActual, field, valorOriginal);
    switch (operador) {
      case 'eq':
        return { [field]: { equals: valor } };

      case 'neq':
        return { [field]: { not: valor } };

      case 'in':
        return { [field]: { in: Array.isArray(valor) ? valor : [valor] } };

      case 'notIn':
        return { [field]: { notIn: Array.isArray(valor) ? valor : [valor] } };

      case 'contains':
        return { [field]: { contains: valor } };

      case 'startsWith':
        return { [field]: { startsWith: valor } };

      case 'endsWith':
        return { [field]: { endsWith: valor } };

      case 'gt':
        return { [field]: { gt: valor } };

      case 'gte':
        return { [field]: { gte: valor } };

      case 'lt':
        return { [field]: { lt: valor } };

      case 'lte':
        return { [field]: { lte: valor } };

      case 'between':
        if (Array.isArray(valor) && valor.length === 2) {
          return { [field]: { gte: valor[0], lte: valor[1] } };
        }
        this.logger.warn(`Operador "between" requiere array de 2 elementos, recibido: ${valor}`);
        return null;

      case 'notBetween':
        if (Array.isArray(valor) && valor.length === 2) {
          return { [field]: { not: { gte: valor[0], lte: valor[1] } } };
        }
        this.logger.warn(`Operador "notBetween" requiere array de 2 elementos, recibido: ${valor}`);
        return null;

      case 'isNull':
        return { [field]: null };

      case 'isNotNull':
        return { [field]: { not: null } };

      case 'rangoClaves':
        // Operador especial para rangos alfabéticos (como en v1)
        // Requiere: { desde, hasta, excluir[] }
        this.logger.warn('Operador "rangoClaves" requiere lógica custom, se deja para post-procesamiento');
        return null;

      default:
        this.logger.warn(`Operador "${operador}" no soportado`);
        return null;
    }
  }

  private buildOrderBy(ordenamientos: any[]): any {
    return ordenamientos.map(ord => {
      const parts = ord.path.split('.');

      if (parts.length === 1) {
        return { [parts[0]]: ord.direccion };
      }

      // Ordenamiento por relación (limitado en Prisma)
      this.logger.warn(
        `Ordenamiento por path relacionado "${ord.path}" puede tener limitaciones en Prisma`,
      );

      // Construir nested orderBy
      let nested: any = { [parts[parts.length - 1]]: ord.direccion };

      for (let i = parts.length - 2; i >= 0; i--) {
        nested = { [parts[i]]: nested };
      }

      return nested;
    });
  }
}

