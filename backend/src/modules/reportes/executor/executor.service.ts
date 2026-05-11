import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { QueryPlanner } from '../planner/query-planner';
import { PathParser } from '../parser/path-parser';
import { PathResolver } from './path-resolver';
import { Formatter } from './formatter';
import { CardinalityResolver } from './cardinality';
import { GroupingService, FilaConSubtotales } from './grouping.service';
import { DefinicionPlantillaDto } from '../dto/plantilla.dto';

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

    this.validateDefinicion(definicion);

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

    const formatoTelefonoIds = Array.from(
      new Set(
        definicion.columnas
          .map(c => c.formatoTelefonoId)
          .filter((v): v is number => typeof v === 'number'),
      ),
    );
    const formatosTelefono = formatoTelefonoIds.length
      ? await this.prisma.formato_telefono.findMany({
          where: { id: { in: formatoTelefonoIds } },
        })
      : [];
    const formatoTelefonoMap = new Map<number, string>(
      formatosTelefono.map(f => [f.id, f.patron]),
    );

    const parsedColumns = definicion.columnas.map(col => ({
      path: this.parser.parse(col.path),
      label: col.label,
      tipo: col.tipo,
      formato:
        col.tipo === 'telefono' && col.formatoTelefonoId
          ? formatoTelefonoMap.get(col.formatoTelefonoId) || col.formato
          : col.formato,
      cardinalidad: col.cardinalidad || definicion.cardinalidadDefault || 'primero',
      separadorConcat: col.separadorConcat,
    }));

    // Resolver paths a valores planos
    let filas = rawData.map(fila => {
      const flat = this.resolver.resolveToFlat(fila, parsedColumns);
      return flat;
    });

    // Aplicar cardinalidad "expandir" si hay columnas configuradas
    const columnasExpandir = definicion.columnas
      .filter(col => {
        const cardinalidad = col.cardinalidad || definicion.cardinalidadDefault || 'primero';
        return cardinalidad === 'expandir';
      })
      .map(col => ({ label: col.label, path: col.path }));

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
    filters: Array<{ path: string; operador: string; valor: any }>,
  ): any[] {
    let filtered = data;

    for (const filter of filters) {
      const path = this.parser.parse(filter.path);

      filtered = filtered.filter(fila => {
        const valor = this.resolver.resolve(fila, path);

        return this.evaluateCondition(valor, filter.operador, filter.valor);
      });
    }

    return filtered;
  }

  private evaluateCondition(valor: any, operador: string, valorEsperado: any): boolean {
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
        return String(valor).toLowerCase().includes(String(valorEsperado).toLowerCase());

      case 'startsWith':
        return String(valor).toLowerCase().startsWith(String(valorEsperado).toLowerCase());

      case 'endsWith':
        return String(valor).toLowerCase().endsWith(String(valorEsperado).toLowerCase());

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
        this.logger.warn(`Operador de post-procesamiento no soportado: ${operador}`);
        return true;
    }
  }

  private validateDefinicion(definicion: DefinicionPlantillaDto): void {
    if (!definicion.columnas || definicion.columnas.length === 0) {
      throw new BadRequestException('La definición debe tener al menos una columna');
    }

    for (const col of definicion.columnas) {
      try {
        this.parser.validate(col.path);
      } catch (error) {
        throw new BadRequestException(`Path inválido en columna "${col.label}": ${error.message}`);
      }
    }

    if (definicion.filtros) {
      for (const filtro of definicion.filtros) {
        try {
          this.parser.validate(filtro.path);
        } catch (error) {
          throw new BadRequestException(`Path inválido en filtro "${filtro.id}": ${error.message}`);
        }
      }
    }
  }
}

