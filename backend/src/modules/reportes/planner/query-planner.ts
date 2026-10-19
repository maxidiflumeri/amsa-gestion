import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { esSoloFecha } from '../../../common/utils/dia-local';
import { PathParser } from '../parser/path-parser';
import { IncludeBuilder } from './include-builder';
import { PathAST } from '../parser/path-ast';
import { DefinicionPlantillaDto } from '../dto/plantilla.dto';
import { FechaInvalidaError, mensajeFechaInvalida, parsearFechaFiltro, validarFechasFiltro } from '../validador/fecha-filtro';
import { esOperadorDeRango, esOperadorSoportado, esValorVacio, extremosDeRango, OPERADORES_SOPORTADOS } from '../validador/operadores';
import { clasificarFecha, TipoFecha, ventanaDelDia } from '../validador/fechas-negocio';
import { campoFinal, modeloPorNombre } from '../validador/definicion-validator';
import { terminaEnCount } from '../executor/contar-rama';
import { esColumnaFija } from '../columna-fija';

export interface FiltroEnMemoria {
  path: string;
  operador: string;
  valor: any;
  /** Solo si el path termina en una fecha: cómo se guarda, para comparar por día igual que Prisma. */
  tipoFecha?: TipoFecha;
}

export interface QueryPlan {
  where: any;
  include: any;
  orderBy?: any;
  take?: number;
  requiresPostProcessing: boolean;
  postProcessingFilters: FiltroEnMemoria[];
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
      if (esColumnaFija(columna)) continue;   // no toca los datos: no aporta include ni post-proceso
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
      const orderBy = this.buildOrderBy(definicion.ordenamientos);
      if (orderBy.length > 0) plan.orderBy = orderBy;
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
  ): { where: any; postProcessingFilters: FiltroEnMemoria[] } {
    if (!definicion.filtros || definicion.filtros.length === 0) {
      return { where: {}, postProcessingFilters: [] };
    }

    const conditions: any[] = [];
    const postProcessingFilters: FiltroEnMemoria[] = [];

    for (const filtro of definicion.filtros) {
      const etiqueta = filtro.labelVariable || filtro.path;

      // Un operador que el motor no implementa tiene que frenar el reporte: si el filtro se
      // descartara, saldría la cartera entera sin ningún error.
      if (!esOperadorSoportado(filtro.operador)) {
        this.logger.warn(`Filtro «${etiqueta}» con operador no soportado: ${filtro.operador}`);
        throw new BadRequestException(
          `El filtro «${etiqueta}» usa un operador que el motor no soporta: ${filtro.operador} ` +
          `(los válidos son ${OPERADORES_SOPORTADOS.join(', ')})`,
        );
      }

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
      if (sinValor && esValorVacio(valor)) {
        if (filtro.variable && filtro.obligatorio && !preview) {
          throw new BadRequestException(
            `Filtro variable "${filtro.labelVariable || filtro.id}" es requerido pero no se proporcionó valor`,
          );
        }
        // Un filtro fijo sin valor no puede ignorarse: sería traer la cartera entera sin avisar.
        if (!filtro.variable) {
          this.logger.warn(`Filtro «${etiqueta}» fijo sin valor`);
          throw new BadRequestException(`El filtro «${etiqueta}» no tiene valor`);
        }
        continue;
      }

      if (esOperadorDeRango(filtro.operador) && extremosDeRango(valor) === null) {
        this.logger.warn(`Filtro «${etiqueta}»: ${filtro.operador} sin dos valores`);
        throw new BadRequestException(`El filtro «${etiqueta}» necesita dos valores (desde y hasta)`);
      }

      let condition: any;
      try {
        condition = this.buildCondition(filtro.path, filtro.operador, valor, postProcessingFilters);
      } catch (error) {
        if (error instanceof FechaInvalidaError) {
          this.logger.warn(`Fecha inválida en el filtro «${etiqueta}»`);
          throw new BadRequestException(mensajeFechaInvalida(etiqueta));
        }
        throw error;
      }
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
    postProcessingFilters: FiltroEnMemoria[],
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
      const esCantidad = terminaEnCount(ast);

      if (esCantidad) {
        valor = this.cantidadComoNumero(path, operador, valor);

        // `rama[count] > 0` / `= 0` se expresan en Prisma con some / none. Los `[campo=valor]` de cada
        // segmento van adentro: `contactos[tipo=telefono][count] = 0` son los casos SIN teléfono, no
        // los casos sin ningún contacto. Y `convenios.cuotas[count] = 0` es "ningún convenio tiene
        // cuotas", que incluye a los casos sin convenios.
        if ((operador === 'gt' || operador === 'eq') && valor === 0) {
          const condicion = this.condicionCantidadCero(ast, operador);
          if (condicion !== null) {
            this.logger.log(`Optimizando filtro ${path} ${operador === 'gt' ? '> 0' : '= 0'} con Prisma`);
            return condicion;
          }
        }
      }

      // No se puede optimizar, debe ir a post-procesamiento
      this.logger.warn(
        `Filtro sobre path con agregador/filtro "${path}" requiere post-procesamiento (no se puede expresar en Prisma where)`,
      );
      postProcessingFilters.push({ path, operador, valor, tipoFecha: this.tipoFechaDelPath(ast, valor) });
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

  /** La cantidad se compara como número: `"0"` que llega por API es 0, y un texto es un error. */
  private cantidadComoNumero(path: string, operador: string, valor: any): any {
    if (operador === 'isNull' || operador === 'isNotNull') return valor;
    const comoNumero = (v: any) => {
      if (typeof v === 'number') return v;
      if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
      throw new BadRequestException(`La cantidad de «${path}» tiene que ser un número`);
    };
    // En «Entre» / «Fuera de», una punta vacía es un rango abierto (como en el resto de los filtros): queda null.
    const extremo = (v: any) => (v == null || (typeof v === 'string' && v.trim() === '') ? null : comoNumero(v));
    return Array.isArray(valor) ? valor.map(extremo) : comoNumero(valor);
  }

  /**
   * Si el path termina en una fecha, valida el valor (400 si está mal escrita) y devuelve cómo se
   * guarda, para que el post-procesado compare por día igual que Prisma. Un path sin fecha: `undefined`.
   */
  private tipoFechaDelPath(ast: PathAST, valor: any): TipoFecha | undefined {
    const final = campoFinal('deudor', ast);
    if (final.claveJson || final.campo?.type !== 'DateTime') return undefined;
    validarFechasFiltro(valor);
    return clasificarFecha(final.modelo ?? '', final.campo.name) ?? 'instante';
  }

  /**
   * La condición de Prisma que equivale a los `[campo=valor]` de un segmento (`{}` si no tiene).
   * Devuelve `null` si alguno no se puede expresar —campo anidado, no escalar o de fecha—: en ese
   * caso el filtro se resuelve en memoria, que aplica los mismos `[campo=valor]` sobre las filas.
   */
  private condicionDeFiltrosDeRama(
    segmento: PathAST['segments'][number],
    modeloRelacion: string,
  ): Record<string, any> | null {
    const tiposNumericos = ['Int', 'BigInt', 'Float', 'Decimal'];
    const condicion: Record<string, any> = {};
    for (const modificador of segmento.modifiers) {
      if (modificador.type !== 'filter') {
        if (modificador.type === 'aggregator' && modificador.aggregator === 'count') continue;
        return null;
      }
      for (const { field, value } of modificador.filters) {
        const campo = this.getRelationField(modeloRelacion, field);
        const simple = campo && (
          campo.kind === 'enum' ||
          (campo.kind === 'scalar' && ['String', 'Boolean', ...tiposNumericos].includes(campo.type))
        );
        if (!simple) return null;

        const coercionado = this.coerceValor(modeloRelacion, field, value);
        // Un valor que no se pudo convertir (`whatsapp=quizas`) no se compara por igualdad.
        if (campo.type === 'Boolean' && typeof coercionado !== 'boolean') return null;
        if (tiposNumericos.includes(campo.type) && typeof coercionado !== 'number') return null;
        if (field in condicion && condicion[field] !== coercionado) return null;
        condicion[field] = coercionado;
      }
    }
    return condicion;
  }

  /**
   * `rama[count] = 0` / `> 0` para un path de una o más ramas que termina en `[count]`.
   *
   * La cantidad es el **total** de la última rama sumando todas las de las ramas del medio:
   * - `> 0`: existe algún elemento. `{convenios: {some: {cuotas: {some: {}}}}}`
   * - `= 0`: no existe ninguno, incluidos los casos sin ramas del medio.
   *   `{convenios: {none: {cuotas: {some: {}}}}}`
   *
   * Devuelve `null` si algún tramo no se puede expresar en Prisma; el filtro se cuenta entonces en
   * memoria sobre todos los elementos (`contarRama`).
   */
  private condicionCantidadCero(ast: PathAST, operador: 'gt' | 'eq'): any | null {
    const tramos: Array<{ nombre: string; esLista: boolean; filtro: Record<string, any> }> = [];
    let modelo = 'deudor';
    for (const segmento of ast.segments) {
      const campo = this.getRelationField(modelo, segmento.name);
      if (!campo || campo.kind !== 'object') return null;
      const filtro = this.condicionDeFiltrosDeRama(segmento, campo.type);
      if (filtro === null) return null;
      tramos.push({ nombre: segmento.name, esLista: campo.isList === true, filtro });
      modelo = campo.type;
    }
    if (!tramos[tramos.length - 1].esLista) return null;

    // De adentro hacia afuera: `interior` es lo que va dentro del `some` del tramo.
    let existe: Record<string, any> = {};
    let interiorDelPrimero: Record<string, any> = {};
    for (let i = tramos.length - 1; i >= 0; i--) {
      const tramo = tramos[i];
      const siguiente = i === tramos.length - 1 ? {} : existe;
      if (Object.keys(tramo.filtro).some((k) => k in siguiente)) return null;
      const interior = { ...tramo.filtro, ...siguiente };
      if (i === 0) interiorDelPrimero = interior;
      existe = { [tramo.nombre]: tramo.esLista ? { some: interior } : interior };
    }

    if (operador === 'gt') return existe;
    if (tramos[0].esLista) return { [tramos[0].nombre]: { none: interiorDelPrimero } };
    return { NOT: existe };
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

    // `camposAdicionales.cuota` no es una relación: es una clave adentro de una columna JSON, y
    // Prisma la filtra con `{ path, equals }`. Sin esto se armaba `{ camposAdicionales: { cuota:
    // { equals: 'x' } } }`, que Prisma rechaza con un PrismaClientValidationError — o sea, el
    // selector ofrecía filtrar por dato adicional y la ejecución reventaba.
    if (field?.kind === 'scalar' && field?.type === 'Json') {
      return this.buildJsonCondition(first, rest, operador, valor);
    }

    const inner =
      rest.length === 1
        ? this.buildPrismaCondition(tipoModelo || modeloActual, rest[0], operador, valor)
        : tipoModelo
          ? this.buildNestedCondition(rest, operador, valor, tipoModelo)
          : null;

    if (inner === null) {
      throw new BadRequestException(`El campo «${parts.join('.')}» no existe`);
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
      if (esValorVacio(valor)) continue;

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

  /**
   * Filtro sobre una clave de una columna JSON (`camposAdicionales`, los "datos adicionales").
   *
   * En MySQL, Prisma pide `{ campo: { path: '$.clave', equals: valor } }`. Los operadores de texto
   * tienen nombre propio (`string_contains`) y no todos existen: lo que no se puede expresar cae al
   * post-procesado, que ya filtra en memoria después de traer las filas.
   *
   * Los valores de `camposAdicionales` los escribe la importación **siempre como texto**, así que la
   * comparación es de strings: `gt` sobre un número guardado como "9" no ordena como número.
   */
  private buildJsonCondition(campo: string, rest: string[], operador: string, valor: any): any {
    if (rest.length === 0) {
      throw new BadRequestException(`El campo «${campo}» necesita una clave de los datos adicionales`);
    }
    const path = `$.${rest.join('.')}`;
    // Los datos adicionales se guardan **como texto**: el import escribe cada valor como string. Un
    // `[2, 4]` numérico no coincide con ningún "2" guardado (devolvía 0 filas, y `['2','4']` 5.322).
    const texto = (v: any) => (v === undefined || v === null ? v : String(v));

    switch (operador) {
      case 'eq':
        return { [campo]: { path, equals: texto(valor) } };
      case 'neq':
        return { NOT: { [campo]: { path, equals: texto(valor) } } };
      case 'contains':
        return { [campo]: { path, string_contains: String(valor) } };
      case 'startsWith':
        return { [campo]: { path, string_starts_with: String(valor) } };
      case 'endsWith':
        return { [campo]: { path, string_ends_with: String(valor) } };
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte':
        return { [campo]: { path, [operador]: texto(valor) } };
      case 'isNull':
        return { [campo]: { path, equals: Prisma.DbNull } };
      case 'isNotNull':
        return { NOT: { [campo]: { path, equals: Prisma.DbNull } } };
      case 'in':
        return { OR: this.listaDeValores(valor).map((v) => ({ [campo]: { path, equals: texto(v) } })) };
      case 'notIn':
        return { NOT: { OR: this.listaDeValores(valor).map((v) => ({ [campo]: { path, equals: texto(v) } })) } };
      case 'between':
      case 'notBetween': {
        const extremos = extremosDeRango(valor);
        if (!extremos) throw new BadRequestException(`El campo «${campo}.${rest.join('.')}» necesita dos valores (desde y hasta)`);
        // Un solo extremo es un rango abierto.
        const partes: any[] = [];
        if (extremos.desde !== undefined) partes.push({ [campo]: { path, gte: texto(extremos.desde) } });
        if (extremos.hasta !== undefined) partes.push({ [campo]: { path, lte: texto(extremos.hasta) } });
        const dentro = partes.length === 1 ? partes[0] : { AND: partes };
        return operador === 'between' ? dentro : { NOT: dentro };
      }
      default:
        throw new BadRequestException(
          `El operador "${operador}" no se puede usar sobre un dato adicional (${campo}.${rest.join('.')})`,
        );
    }
  }

  private listaDeValores(valor: any): any[] {
    return Array.isArray(valor) ? valor : [valor];
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
        // Solo `YYYY-MM-DD`, ISO completo o Date. Antes `new Date('hoy-90')` daba 1990 sin avisar.
        const fecha = parsearFechaFiltro(v);
        return typeof fecha === 'string' ? new Date(fecha) : fecha;
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

  /**
   * Un filtro de fecha sobre una columna `DateTime`, con el valor en `YYYY-MM-DD`, tiene que abarcar
   * el **día completo**, y "el día" depende de cómo se guarda esa columna (ver `fechas-negocio.ts`):
   * una fecha calendario es de D 00:00Z a D 23:59:59.999Z; un instante, el día local.
   *
   * `new Date('2026-07-31')` es medianoche **UTC**: en Argentina, las 21:00 del 30. Así, `lte` perdía
   * todo el último día del rango y `gte` metía tres horas del día anterior. Es el mismo error que ya
   * se había corregido en los filtros del tablero (ver `common/utils/dia-local.ts`).
   *
   * Un rango con un solo extremo es un rango abierto.
   */
  private buildCondicionFecha(field: string, operador: string, valorOriginal: any, tipo: TipoFecha): any | null {
    const dia = (v: string) => ventanaDelDia(v, tipo);

    if (operador === 'between' || operador === 'notBetween') {
      const extremos = extremosDeRango(valorOriginal);
      if (!extremos) return null;
      const dados = [extremos.desde, extremos.hasta].filter((v) => v !== undefined);
      if (dados.length === 0 || !dados.every((v) => esSoloFecha(v))) return null;
      const rango: any = {};
      if (extremos.desde !== undefined) rango.gte = dia(extremos.desde).desde;
      if (extremos.hasta !== undefined) rango.lte = dia(extremos.hasta).hasta;
      return operador === 'between' ? { [field]: rango } : { NOT: { [field]: rango } };
    }

    if (!['gt', 'gte', 'lt', 'lte', 'eq', 'neq'].includes(operador)) return null;
    if (!esSoloFecha(valorOriginal)) return null;
    const { desde, hasta } = dia(valorOriginal);

    switch (operador) {
      // `gt` / `lt` son "después / antes de ese día": quedan afuera las horas del propio día.
      case 'gt':
        return { [field]: { gt: hasta } };
      case 'gte':
        return { [field]: { gte: desde } };
      case 'lt':
        return { [field]: { lt: desde } };
      case 'lte':
        return { [field]: { lte: hasta } };
      // "Igual a un día" es el día entero, no un instante: sin esto no matcheaba nunca.
      case 'eq':
        return { [field]: { gte: desde, lte: hasta } };
      default:
        return { NOT: { [field]: { gte: desde, lte: hasta } } };
    }
  }

  private buildPrismaCondition(modeloActual: string, field: string, operador: string, valorOriginal: any): any {
    const tipo = this.getRelationField(modeloActual, field)?.type;
    if (tipo === 'DateTime') {
      // `2026-02-31` pasa el formato pero JS lo corre a marzo: se valida el calendario antes.
      if (operador !== 'isNull' && operador !== 'isNotNull') validarFechasFiltro(valorOriginal);
      const nombreModelo = modeloPorNombre(modeloActual)?.name ?? modeloActual;
      const tipoFecha = clasificarFecha(nombreModelo, field) ?? 'instante';
      const porDia = this.buildCondicionFecha(field, operador, valorOriginal, tipoFecha);
      if (porDia) return porDia;
    }

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
      case 'notBetween': {
        const extremos = extremosDeRango(valor);
        if (!extremos) {
          throw new BadRequestException(`El campo «${field}» con «${operador === 'between' ? 'entre' : 'fuera de'}» necesita dos valores (desde y hasta)`);
        }
        // Un solo extremo es un rango abierto: antes un `null` llegaba a Prisma y reventaba.
        const rango: any = {};
        if (extremos.desde !== undefined) rango.gte = extremos.desde;
        if (extremos.hasta !== undefined) rango.lte = extremos.hasta;
        return operador === 'between' ? { [field]: rango } : { [field]: { not: rango } };
      }

      case 'isNull':
        return { [field]: null };

      case 'isNotNull':
        return { [field]: { not: null } };

      default:
        // No debería llegar: buildWhere frena antes los operadores que el motor no soporta.
        throw new BadRequestException(`El motor no soporta el operador: ${operador}`);
    }
  }

  private buildOrderBy(ordenamientos: any[]): any {
    // Una columna fija no sale de los datos: no hay nada que ordenar.
    return ordenamientos.filter(ord => !esColumnaFija(ord)).map(ord => {
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

