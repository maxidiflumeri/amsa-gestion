import { BadRequestException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { esColumnaFija } from '../columna-fija';
import { PathParser } from '../parser/path-parser';
import { PathAST } from '../parser/path-ast';
import { DefinicionPlantillaDto, FiltroDto } from '../dto/plantilla.dto';
import { FechaInvalidaError, mensajeFechaInvalida, validarFechasFiltro } from './fecha-filtro';
import {
  esOperadorDeRango,
  esOperadorSinValor,
  esOperadorSoportado,
  esValorVacio,
  OPERADORES_SOPORTADOS,
} from './operadores';
import { campoPermitido, modeloPermitido } from './campos-sensibles';
import { terminaEnCount } from '../executor/contar-rama';

/**
 * Validación de una definición de reporte contra el modelo de datos, para que lo que está mal salga
 * como un 400 claro **antes** de armar la consulta y no como un reporte que sale mal sin avisar:
 * columnas con el mismo nombre, campos que no existen que salen como columna vacía, operadores que
 * el motor no implementa que descartan el filtro, filtros sin valor que traen la cartera entera.
 *
 * Se llama al **guardar** (crear/actualizar plantilla), en el **preview** y al **ejecutar** (sync,
 * async y estimación): una plantilla vieja que ya no cumple falla al ejecutar con el mismo mensaje.
 *
 * Los campos se validan contra el modelo de Prisma (DMMF), que es de donde sale el catálogo, y no
 * contra el catálogo ya podado: éste oculta ramas (por ejemplo `empresa.remesa`, todas las
 * remesas de la empresa) que el resolver sí sabe recorrer y que plantillas existentes usan.
 * Encima va la lista de bloqueo de `campos-sensibles.ts`: credenciales, sesiones y datos personales
 * de `usuario` no se pueden pedir aunque existan en el modelo.
 * Los datos adicionales (`camposAdicionales.<clave>`) son claves de una columna JSON: se valida el
 * prefijo, la clave es libre porque depende de lo que mandó cada cedente.
 */

const logger = new Logger('ValidadorDefinicion');
const parser = new PathParser();

export type ModeloDmmf = { name: string; fields: CampoDmmf[] };
export type CampoDmmf = { name: string; kind: string; type: string; isList: boolean };

export function modeloPorNombre(nombre: string): ModeloDmmf | undefined {
  const modelos = Prisma.dmmf.datamodel.models as unknown as ModeloDmmf[];
  return modelos.find((m) => m.name.toLowerCase() === nombre.toLowerCase());
}

function fallar(mensaje: string): never {
  logger.warn(mensaje);
  throw new BadRequestException(mensaje);
}

export interface ResultadoCampo {
  existe: boolean;
  /** El camino pasa por un campo o modelo de la lista de bloqueo. */
  bloqueado: boolean;
  /** Último campo del path, si el path no se metió dentro de un JSON. */
  campo?: CampoDmmf;
  /** Modelo al que pertenece `campo`. */
  modelo?: string;
  /** El path entra a una clave de una columna JSON (`camposAdicionales.cuota`). */
  claveJson: boolean;
  /** El path termina en la columna JSON misma, sin clave. */
  jsonSinClave: boolean;
}

const NO_EXISTE: ResultadoCampo = { existe: false, bloqueado: false, claveJson: false, jsonSinClave: false };
const BLOQUEADO: ResultadoCampo = { existe: false, bloqueado: true, claveJson: false, jsonSinClave: false };

/** Recorre `nombres` desde `modelo`. Un JSON admite cualquier clave después. */
export function recorrer(modelo: ModeloDmmf, nombres: string[]): ResultadoCampo {
  let actual: ModeloDmmf = modelo;
  for (let i = 0; i < nombres.length; i++) {
    const campo = actual.fields.find((f) => f.name === nombres[i]);
    if (!campo) return NO_EXISTE;
    if (!campoPermitido(actual.name, campo.name)) return BLOQUEADO;
    const ultimo = i === nombres.length - 1;

    if (campo.kind === 'object') {
      if (!modeloPermitido(campo.type)) return BLOQUEADO;
      if (ultimo) return { existe: true, bloqueado: false, campo, modelo: actual.name, claveJson: false, jsonSinClave: false };
      const siguiente = modeloPorNombre(campo.type);
      if (!siguiente) return NO_EXISTE;
      actual = siguiente;
      continue;
    }

    if (campo.kind === 'scalar' && campo.type === 'Json') {
      return ultimo
        ? { existe: true, bloqueado: false, campo, modelo: actual.name, claveJson: false, jsonSinClave: true }
        : { existe: true, bloqueado: false, claveJson: true, jsonSinClave: false };
    }

    // Escalar o enum: no tiene nada adentro.
    if (ultimo) return { existe: true, bloqueado: false, campo, modelo: actual.name, claveJson: false, jsonSinClave: false };
    return NO_EXISTE;
  }
  return NO_EXISTE;
}

/** El campo al que apunta un path ya parseado (sin validar), para quien necesita su tipo. */
export function campoFinal(raizNombre: string, ast: PathAST): ResultadoCampo {
  const raiz = modeloPorNombre(raizNombre);
  return raiz ? recorrer(raiz, ast.segments.map((s) => s.name)) : NO_EXISTE;
}

function validarCount(ast: PathAST): void {
  const hayCount = ast.segments.some((s) => s.modifiers.some((m) => m.type === 'aggregator' && m.aggregator === 'count'));
  if (!hayCount) return;

  if (!terminaEnCount(ast)) {
    fallar(`En «${ast.raw}» el [count] tiene que ir al final del camino`);
  }
  const ultimo = ast.segments[ast.segments.length - 1];
  const ordenDentroDelUltimo = ultimo.modifiers.map((m) => m.type);
  const posCount = ultimo.modifiers.findIndex((m) => m.type === 'aggregator' && m.aggregator === 'count');
  const otrosSelectores = ast.segments.some((s, i) =>
    s.modifiers.some((m, j) => m.type !== 'filter' && !(i === ast.segments.length - 1 && j === posCount)),
  );
  if (otrosSelectores || posCount !== ordenDentroDelUltimo.length - 1) {
    fallar(`En «${ast.raw}» el [count] solo se puede combinar con filtros [campo=valor]`);
  }
}

/**
 * Valida que cada segmento del path exista y esté permitido, y que los `[campo=valor]` apunten a
 * campos de la relación que filtran. Devuelve el resultado del recorrido completo.
 */
function validarPath(raiz: ModeloDmmf, ast: PathAST): ResultadoCampo {
  const nombres = ast.segments.map((s) => s.name);
  const resultado = recorrer(raiz, nombres);
  if (resultado.bloqueado) {
    fallar(`El campo «${nombres.join('.')}» no se puede usar en un reporte`);
  }
  if (!resultado.existe) {
    fallar(`El campo «${nombres.join('.')}» no existe`);
  }
  validarCount(ast);
  // `camposAdicionales.codeudores[count]`: una lista dentro del JSON de datos adicionales (multiarchivo) también se cuenta.
  if (terminaEnCount(ast) && !resultado.claveJson && !(resultado.campo?.kind === 'object' && resultado.campo.isList)) {
    fallar(`En «${ast.raw}» el [count] solo se puede usar sobre una relación con varios elementos`);
  }

  // Los filtros `[campo=valor]` se evalúan contra los elementos de esa relación.
  let actual: ModeloDmmf = raiz;
  const recorridos: string[] = [];
  for (const segmento of ast.segments) {
    recorridos.push(segmento.name);
    const campo = actual.fields.find((f) => f.name === segmento.name);
    if (!campo) break;
    const relacionado = campo.kind === 'object' ? modeloPorNombre(campo.type) : undefined;

    for (const modificador of segmento.modifiers) {
      if (modificador.type !== 'filter') continue;
      if (!relacionado) {
        fallar(`El campo «${recorridos.join('.')}» no tiene elementos para filtrar con [${modificador.filters.map((f) => f.field).join(',')}]`);
      }
      for (const { field } of modificador.filters) {
        const interno = recorrer(relacionado, field.split('.'));
        if (interno.bloqueado) fallar(`El campo «${recorridos.join('.')}.${field}» no se puede usar en un reporte`);
        if (!interno.existe) fallar(`El campo «${recorridos.join('.')}.${field}» no existe`);
      }
    }
    if (!relacionado) break;
    actual = relacionado;
  }

  return resultado;
}

function etiquetaDeFiltro(filtro: FiltroDto): string {
  return filtro.labelVariable || filtro.path;
}

function validarFiltro(raiz: ModeloDmmf, filtro: FiltroDto, valores: boolean): void {
  const etiqueta = etiquetaDeFiltro(filtro);

  if (!esOperadorSoportado(filtro.operador)) {
    fallar(
      `El filtro «${etiqueta}» usa un operador que el motor no soporta: ${filtro.operador} ` +
      `(los válidos son ${OPERADORES_SOPORTADOS.join(', ')})`,
    );
  }

  let ast: PathAST;
  try {
    ast = parser.parse(filtro.path);
  } catch (error) {
    return fallar(`Path inválido en filtro "${etiqueta}": ${(error as Error).message}`);
  }

  const resultado = validarPath(raiz, ast);

  if (resultado.jsonSinClave && !esOperadorSinValor(filtro.operador)) {
    fallar(`El filtro «${etiqueta}» tiene que apuntar a una clave de los datos adicionales, no a todo el bloque`);
  }

  // Los valores que ya están en la plantilla. Al ejecutar no se miran acá: el planner revisa el
  // valor **efectivo** (el que mandó quien ejecuta, o el por defecto si no mandó ninguno), y un
  // valor por defecto viejo e inválido no tiene que frenar a quien cargó otro.
  if (!valores || esOperadorSinValor(filtro.operador)) return;

  if (!filtro.variable && esValorVacio(filtro.valor)) {
    fallar(`El filtro «${etiqueta}» no tiene valor`);
  }

  const aRevisar: unknown[] = [];
  if (!filtro.variable) aRevisar.push(filtro.valor);
  if (filtro.valorPorDefecto !== undefined) aRevisar.push(filtro.valorPorDefecto);

  for (const valor of aRevisar) {
    if (esValorVacio(valor)) continue;

    if (esOperadorDeRango(filtro.operador) && (!Array.isArray(valor) || valor.length !== 2)) {
      fallar(`El filtro «${etiqueta}» necesita dos valores (desde y hasta)`);
    }

    const sinModificadores = ast.segments.every((s) => s.modifiers.length === 0);
    if (sinModificadores && !resultado.claveJson && resultado.campo?.type === 'DateTime') {
      try {
        validarFechasFiltro(valor);
      } catch (error) {
        if (error instanceof FechaInvalidaError) {
          logger.warn(`Fecha inválida en el filtro «${etiqueta}»`);
          throw new BadRequestException(mensajeFechaInvalida(etiqueta));
        }
        throw error;
      }
    }
  }
}

function validarCampoSimple(raiz: ModeloDmmf, path: string, donde: string): void {
  if (!path || !path.trim()) {
    fallar(`El campo «» no existe (${donde} sin campo)`);
  }
  let ast: PathAST;
  try {
    ast = parser.parse(path);
  } catch (error) {
    return fallar(`Path inválido en ${donde} "${path}": ${(error as Error).message}`);
  }
  validarPath(raiz, ast);
}

export interface OpcionesValidacion {
  /**
   * Revisar los valores guardados en la plantilla (fijos y por defecto). `true` al guardar; al
   * ejecutar va en `false` porque el planner valida el valor efectivo.
   */
  valores?: boolean;
}

/**
 * @param raizNombre modelo desde el que se recorren los paths (`deudor`).
 * @throws BadRequestException con el motivo, en castellano, listo para mostrarle a la persona.
 */
export function validarDefinicion(
  definicion: DefinicionPlantillaDto,
  raizNombre: string = 'deudor',
  opciones: OpcionesValidacion = {},
): void {
  const valores = opciones.valores ?? true;
  const raiz = modeloPorNombre(raizNombre);
  if (!raiz) {
    fallar(`Raíz ${raizNombre} no soportada`);
  }

  if (!definicion?.columnas || definicion.columnas.length === 0) {
    fallar('La definición debe tener al menos una columna');
  }

  // Las filas del reporte se arman por label: con dos columnas iguales, la primera pierde su dato y
  // repite el de la segunda.
  const vistos = new Set<string>();
  const repetidos = new Set<string>();
  for (const columna of definicion.columnas) {
    if (vistos.has(columna.label)) repetidos.add(columna.label);
    vistos.add(columna.label);
  }
  if (repetidos.size > 0) {
    const [primero] = repetidos;
    fallar(
      repetidos.size === 1
        ? `Hay dos columnas con el nombre «${primero}»`
        : `Hay columnas con el mismo nombre: ${[...repetidos].map((l) => `«${l}»`).join(', ')}`,
    );
  }

  for (const columna of definicion.columnas) {
    if (esColumnaFija(columna)) continue;   // sin path: imprime su valorFijo
    let ast: PathAST;
    try {
      ast = parser.parse(columna.path);
    } catch (error) {
      return fallar(`Path inválido en columna "${columna.label}": ${(error as Error).message}`);
    }
    validarPath(raiz, ast);
  }

  for (const filtro of definicion.filtros ?? []) {
    validarFiltro(raiz, filtro, valores);
  }

  for (const ordenamiento of definicion.ordenamientos ?? []) {
    // Una columna fija no sale de los datos, no hay por qué ordenar. Plantillas guardadas con ese
    // orden siguen funcionando: el planner lo descarta.
    if (esColumnaFija(ordenamiento)) {
      logger.warn('Ordenamiento por una columna fija: se ignora');
      continue;
    }
    validarCampoSimple(raiz, ordenamiento.path, 'ordenamiento');
  }
  for (const agrupacion of definicion.agrupaciones ?? []) {
    validarCampoSimple(raiz, agrupacion.path, 'agrupación');
  }
  for (const total of definicion.totales ?? []) {
    validarCampoSimple(raiz, total.path, 'total');
  }
}
