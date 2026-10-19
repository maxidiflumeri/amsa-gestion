import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { QueryPlanner, FiltroEnMemoria } from '../planner/query-planner';
import { PathParser } from '../parser/path-parser';
import { PathResolver } from '../executor/path-resolver';
import { Formatter } from '../executor/formatter';
import { CardinalityResolver } from '../executor/cardinality';
import {
  GroupingService,
  FilaConSubtotales,
} from '../executor/grouping.service';
import { DefinicionPlantillaDto } from '../dto/plantilla.dto';
import { evaluarCondicion } from '../executor/evaluar-condicion';
import { contarRama, terminaEnCount } from '../executor/contar-rama';
import { validarDefinicion } from '../validador/definicion-validator';
import {
  cargarFormatosTelefono,
  columnasAExpandir,
  prepararColumnas,
} from '../executor/columnas-preparadas';

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

    this.logger.debug(`executeStreaming raiz=${raiz} chunkSize=${chunkSize} hardLimit=${hardLimit}`);

    if (raiz !== 'deudor') {
      throw new BadRequestException(`Raíz ${raiz} no soportada`);
    }

    this.validateDefinicion(definicion, raiz);

    const plan = this.queryPlanner.planQuery(definicion, filtrosVars);

    const formatoTelefonoMap = await cargarFormatosTelefono(this.prisma, definicion);
    const parsedColumns = prepararColumnas(definicion, this.parser, formatoTelefonoMap);
    const columnasExpandir = columnasAExpandir(definicion);

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

    this.validateDefinicion(definicion, raiz);

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
    filters: FiltroEnMemoria[],
  ): any[] {
    let filtered = data;

    for (const filter of filters) {
      const path = this.parser.parse(filter.path);

      filtered = filtered.filter((fila) => {
        // `[count]` cuenta todos los elementos de la última rama, no solo los del primero.
        const valor = terminaEnCount(path) ? contarRama(fila, path) : this.resolver.resolve(fila, path);
        return evaluarCondicion(valor, filter.operador, filter.valor, filter.tipoFecha);
      });
    }

    return filtered;
  }

  private validateDefinicion(definicion: DefinicionPlantillaDto, raiz: string): void {
    // Al ejecutar, el planner valida el valor efectivo de cada filtro (el que mandó quien ejecuta o el
    // por defecto): un valor por defecto viejo e inválido no frena a quien cargó otro.
    validarDefinicion(definicion, raiz, { valores: false });
  }
}
