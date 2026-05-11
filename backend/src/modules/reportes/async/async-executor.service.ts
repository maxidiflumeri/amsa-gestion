import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { QueryPlanner } from '../planner/query-planner';
import { PathParser } from '../parser/path-parser';
import { PathResolver } from '../executor/path-resolver';
import { Formatter } from '../executor/formatter';
import { CardinalityResolver } from '../executor/cardinality';
import {
  GroupingService,
  FilaConSubtotales,
} from '../executor/grouping.service';
import { DefinicionPlantillaDto } from '../dto/plantilla.dto';

export interface AsyncExecutionResult {
  filas: Record<string, any>[] | FilaConSubtotales[];
  totalFilas: number;
  columnas: string[];
}

export interface AsyncExecutionOptions {
  raiz: string;
  filtrosVars?: Record<string, any>;
  chunkSize?: number;
  hardLimit?: number;
  onChunk?: (info: {
    chunkIndex: number;
    rowsInChunk: number;
    totalProcessed: number;
  }) => Promise<void> | void;
  isCancelled?: () => Promise<boolean> | boolean;
}

const DEFAULT_CHUNK_SIZE = 1000;
const DEFAULT_HARD_LIMIT = 200000;

export class ExecucionCanceladaError extends Error {
  constructor() {
    super('Ejecución cancelada por el usuario');
    this.name = 'ExecucionCanceladaError';
  }
}

@Injectable()
export class AsyncExecutorService {
  private readonly logger = new Logger(AsyncExecutorService.name);
  private parser = new PathParser();
  private resolver = new PathResolver();
  private formatter = new Formatter();
  private cardinalityResolver = new CardinalityResolver();
  private groupingService = new GroupingService();

  constructor(
    private prisma: PrismaService,
    private queryPlanner: QueryPlanner,
  ) {}

  async executeStreaming(
    definicion: DefinicionPlantillaDto,
    options: AsyncExecutionOptions,
  ): Promise<AsyncExecutionResult> {
    const {
      raiz,
      filtrosVars,
      chunkSize = DEFAULT_CHUNK_SIZE,
      hardLimit = DEFAULT_HARD_LIMIT,
      onChunk,
      isCancelled,
    } = options;

    if (raiz !== 'deudor') {
      throw new BadRequestException(`Raíz ${raiz} no soportada`);
    }

    this.validateDefinicion(definicion);

    const plan = this.queryPlanner.planQuery(definicion, filtrosVars);

    const parsedColumns = definicion.columnas.map((col) => ({
      path: this.parser.parse(col.path),
      label: col.label,
      tipo: col.tipo,
      formato: col.formato,
      cardinalidad: col.cardinalidad,
      separadorConcat: col.separadorConcat,
    }));

    const columnasExpandir = definicion.columnas
      .filter((col) => {
        const cardinalidad =
          col.cardinalidad || definicion.cardinalidadDefault || 'primero';
        return cardinalidad === 'expandir';
      })
      .map((col) => ({ label: col.label, path: col.path }));

    const filasFlat: Record<string, any>[] = [];
    let lastId: number | null = null;
    let chunkIndex = 0;
    let totalProcessed = 0;

    while (true) {
      if (isCancelled && (await isCancelled())) {
        throw new ExecucionCanceladaError();
      }

      const queryOptions: any = {
        where: plan.where,
        include: plan.include,
        take: chunkSize,
        orderBy: { id: 'asc' },
      };

      if (lastId !== null) {
        queryOptions.cursor = { id: lastId };
        queryOptions.skip = 1;
      }

      const rawChunk: any[] = await this.prisma.deudor.findMany(queryOptions);

      if (rawChunk.length === 0) {
        break;
      }

      let postFiltered = rawChunk;
      if (plan.postProcessingFilters.length > 0) {
        postFiltered = this.applyPostProcessingFilters(
          rawChunk,
          plan.postProcessingFilters,
        );
      }

      let flatChunk = postFiltered.map((fila) =>
        this.resolver.resolveToFlat(fila, parsedColumns),
      );

      if (columnasExpandir.length > 0) {
        flatChunk = this.cardinalityResolver.expandRows(
          flatChunk,
          columnasExpandir,
        );
      }

      const formattedChunk = flatChunk.map((fila) =>
        this.formatter.formatFila(fila, parsedColumns),
      );

      filasFlat.push(...formattedChunk);
      totalProcessed += formattedChunk.length;

      if (filasFlat.length > hardLimit) {
        throw new BadRequestException(
          `El reporte excede el límite máximo de ${hardLimit} filas. Refiná los filtros para reducir el resultado.`,
        );
      }

      lastId = rawChunk[rawChunk.length - 1].id as number;
      chunkIndex++;

      if (onChunk) {
        await onChunk({
          chunkIndex,
          rowsInChunk: formattedChunk.length,
          totalProcessed,
        });
      }

      if (rawChunk.length < chunkSize) {
        break;
      }

      if (plan.take && totalProcessed >= plan.take) {
        break;
      }
    }

    let resultado: Record<string, any>[] | FilaConSubtotales[] = filasFlat;

    const tieneAgrupaciones =
      definicion.agrupaciones && definicion.agrupaciones.length > 0;
    const tieneTotales = definicion.totales && definicion.totales.length > 0;

    if (tieneAgrupaciones || tieneTotales) {
      const pathToLabel: Record<string, string> = {};
      for (const c of definicion.columnas) pathToLabel[c.path] = c.label;
      resultado = this.groupingService.aplicarAgrupacionYTotales(
        filasFlat,
        definicion.agrupaciones || [],
        definicion.totales || [],
        definicion.columnas.map((c) => c.label),
        pathToLabel,
      );
    }

    return {
      filas: resultado,
      totalFilas: Array.isArray(resultado) ? resultado.length : 0,
      columnas: definicion.columnas.map((c) => c.label),
    };
  }

  async estimarFilas(
    definicion: DefinicionPlantillaDto,
    raiz: string,
    filtrosVars?: Record<string, any>,
  ): Promise<number> {
    if (raiz !== 'deudor') {
      throw new BadRequestException(`Raíz ${raiz} no soportada`);
    }

    this.validateDefinicion(definicion);

    const plan = this.queryPlanner.planQuery(definicion, filtrosVars);

    const total = await this.prisma.deudor.count({ where: plan.where });

    if (plan.requiresPostProcessing) {
      this.logger.warn(
        'Estimación basada en count() puede ser imprecisa por post-procesamiento posterior',
      );
    }

    return total;
  }

  private applyPostProcessingFilters(
    data: any[],
    filters: Array<{ path: string; operador: string; valor: any }>,
  ): any[] {
    let filtered = data;

    for (const filter of filters) {
      const path = this.parser.parse(filter.path);

      filtered = filtered.filter((fila) => {
        const valor = this.resolver.resolve(fila, path);
        return this.evaluateCondition(valor, filter.operador, filter.valor);
      });
    }

    return filtered;
  }

  private evaluateCondition(
    valor: any,
    operador: string,
    valorEsperado: any,
  ): boolean {
    switch (operador) {
      case 'eq':
        return valor === valorEsperado;
      case 'neq':
        return valor !== valorEsperado;
      case 'gt':
        return valor > valorEsperado;
      case 'gte':
        return valor >= valorEsperado;
      case 'lt':
        return valor < valorEsperado;
      case 'lte':
        return valor <= valorEsperado;
      case 'in':
        return Array.isArray(valorEsperado) && valorEsperado.includes(valor);
      case 'notIn':
        return Array.isArray(valorEsperado) && !valorEsperado.includes(valor);
      case 'contains':
        return String(valor)
          .toLowerCase()
          .includes(String(valorEsperado).toLowerCase());
      case 'startsWith':
        return String(valor)
          .toLowerCase()
          .startsWith(String(valorEsperado).toLowerCase());
      case 'endsWith':
        return String(valor)
          .toLowerCase()
          .endsWith(String(valorEsperado).toLowerCase());
      case 'between':
        if (Array.isArray(valorEsperado) && valorEsperado.length === 2) {
          return valor >= valorEsperado[0] && valor <= valorEsperado[1];
        }
        return false;
      case 'isNull':
        return valor === null || valor === undefined;
      case 'isNotNull':
        return valor !== null && valor !== undefined;
      default:
        return true;
    }
  }

  private validateDefinicion(definicion: DefinicionPlantillaDto): void {
    if (!definicion.columnas || definicion.columnas.length === 0) {
      throw new BadRequestException('La definición debe tener al menos una columna');
    }

    for (const col of definicion.columnas) {
      this.parser.validate(col.path);
    }

    if (definicion.filtros) {
      for (const filtro of definicion.filtros) {
        this.parser.validate(filtro.path);
      }
    }
  }
}
