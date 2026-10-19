import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { QueryPlanner, FiltroEnMemoria } from '../planner/query-planner';
import { PathParser } from '../parser/path-parser';
import { PathResolver } from './path-resolver';
import { Formatter } from './formatter';
import { CardinalityResolver } from './cardinality';
import { GroupingService, FilaConSubtotales } from './grouping.service';
import { DefinicionPlantillaDto } from '../dto/plantilla.dto';
import { evaluarCondicion } from './evaluar-condicion';
import { contarRama, terminaEnCount } from './contar-rama';
import { validarDefinicion } from '../validador/definicion-validator';
import { cargarFormatosTelefono, columnasAExpandir, prepararColumnas } from './columnas-preparadas';

export interface ExecutionResult {
  filas: Record<string, any>[] | FilaConSubtotales[];
  totalFilas: number;
  columnas: string[];
}

@Injectable()
export class ExecutorService {
  private readonly logger = new Logger(ExecutorService.name);
  private parser = new PathParser();
  private resolver = new PathResolver();
  private formatter = new Formatter();
  private cardinalityResolver = new CardinalityResolver();
  private groupingService = new GroupingService();

  constructor(
    private prisma: PrismaService,
    private queryPlanner: QueryPlanner,
  ) {}

  async execute(
    definicion: DefinicionPlantillaDto,
    raiz: string = 'deudor',
    filtrosVars?: Record<string, any>,
    preview: boolean = false,
  ): Promise<ExecutionResult> {
    this.logger.log(`Ejecutando reporte F2, preview=${preview}`);

    this.validateDefinicion(definicion, raiz);

    const plan = this.queryPlanner.planQuery(definicion, filtrosVars, preview);

    const queryOptions: any = {
      where: plan.where,
      include: plan.include,
    };

    if (plan.orderBy) {
      queryOptions.orderBy = plan.orderBy;
    }

    if (preview) {
      queryOptions.take = 100;
    } else if (plan.take) {
      queryOptions.take = plan.take;
    }

    this.logger.log(`Query plan generado. Requires post-processing: ${plan.requiresPostProcessing}`);

    let rawData: any[];

    if (raiz === 'deudor') {
      rawData = await this.prisma.deudor.findMany(queryOptions);
    } else {
      throw new BadRequestException(`Raíz ${raiz} no soportada`);
    }

    this.logger.log(`Datos crudos obtenidos: ${rawData.length} filas`);

    // Aplicar post-procesamiento de filtros si es necesario
    if (plan.postProcessingFilters.length > 0) {
      rawData = this.applyPostProcessingFilters(rawData, plan.postProcessingFilters);
      this.logger.log(`Post-procesamiento de filtros aplicado. Filas resultantes: ${rawData.length}`);
    }

    const formatoTelefonoMap = await cargarFormatosTelefono(this.prisma, definicion);
    const parsedColumns = prepararColumnas(definicion, this.parser, formatoTelefonoMap);

    // Resolver paths a valores planos
    let filas = rawData.map(fila => {
      const flat = this.resolver.resolveToFlat(fila, parsedColumns);
      return flat;
    });

    // Aplicar cardinalidad "expandir" si hay columnas configuradas
    const columnasExpandir = columnasAExpandir(definicion);

    if (columnasExpandir.length > 0) {
      filas = this.cardinalityResolver.expandRows(filas, columnasExpandir);
      this.logger.log(`Cardinalidad "expandir" aplicada. Filas expandidas: ${filas.length}`);
    }

    // Aplicar formato a cada fila
    const filasFormateadas = filas.map(fila => this.formatter.formatFila(fila, parsedColumns));

    // Aplicar agrupaciones y totales si están definidas
    let resultado: Record<string, any>[] | FilaConSubtotales[] = filasFormateadas;

    if (definicion.agrupaciones && definicion.agrupaciones.length > 0 || definicion.totales && definicion.totales.length > 0) {
      const pathToLabel: Record<string, string> = {};
      for (const c of definicion.columnas) pathToLabel[c.path] = c.label;
      resultado = this.groupingService.aplicarAgrupacionYTotales(
        filasFormateadas,
        definicion.agrupaciones || [],
        definicion.totales || [],
        definicion.columnas.map(c => c.label),
        pathToLabel,
      );
      this.logger.log(`Agrupaciones/totales aplicadas. Filas con subtotales: ${resultado.length}`);
    }

    return {
      filas: resultado,
      totalFilas: resultado.length,
      columnas: definicion.columnas.map(c => c.label),
    };
  }

  private applyPostProcessingFilters(
    data: any[],
    filters: FiltroEnMemoria[],
  ): any[] {
    let filtered = data;

    for (const filter of filters) {
      const path = this.parser.parse(filter.path);

      filtered = filtered.filter(fila => {
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
