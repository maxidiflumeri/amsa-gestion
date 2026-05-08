import { Injectable, Logger, BadRequestException } from '@nestjs/common';
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

  planQuery(definicion: DefinicionPlantillaDto, filtrosVars?: Record<string, any>): QueryPlan {
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

    const { where, postProcessingFilters } = this.buildWhere(definicion, filtrosVars);

    if (postProcessingFilters.length > 0) {
      requiresPostProcessing = true;
    }

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
  ): { where: any; postProcessingFilters: Array<{ path: string; operador: string; valor: any }> } {
    if (!definicion.filtros || definicion.filtros.length === 0) {
      return { where: {}, postProcessingFilters: [] };
    }

    const conditions: any[] = [];
    const postProcessingFilters: Array<{ path: string; operador: string; valor: any }> = [];

    for (const filtro of definicion.filtros) {
      let valor = filtro.valor;

      // Resolver variables
      if (filtro.variable) {
        if (filtrosVars && (filtrosVars[filtro.id] !== undefined || filtrosVars[filtro.path] !== undefined)) {
          valor = filtrosVars[filtro.id] ?? filtrosVars[filtro.path];
        } else if (filtro.valorPorDefecto !== undefined) {
          valor = filtro.valorPorDefecto;
        } else {
          // Variable requerida sin valor
          throw new BadRequestException(
            `Filtro variable "${filtro.labelVariable || filtro.id}" es requerido pero no se proporcionó valor`,
          );
        }
      }

      if (filtro.variable && valor === undefined) {
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
      return this.buildPrismaCondition(parts[0], operador, valor);
    } else {
      // Path relacional: empresa.nombre, estadoSituacion.clave
      return this.buildNestedCondition(parts, operador, valor);
    }
  }

  private buildNestedCondition(parts: string[], operador: string, valor: any): any {
    const [first, ...rest] = parts;

    if (rest.length === 1) {
      // Relación simple: empresa.nombre
      return {
        [first]: this.buildPrismaCondition(rest[0], operador, valor),
      };
    } else {
      // Relación anidada: empresa.pais.nombre
      return {
        [first]: this.buildNestedCondition(rest, operador, valor),
      };
    }
  }

  private buildPrismaCondition(field: string, operador: string, valor: any): any {
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
        return { [field]: { contains: valor, mode: 'insensitive' } };

      case 'startsWith':
        return { [field]: { startsWith: valor, mode: 'insensitive' } };

      case 'endsWith':
        return { [field]: { endsWith: valor, mode: 'insensitive' } };

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

