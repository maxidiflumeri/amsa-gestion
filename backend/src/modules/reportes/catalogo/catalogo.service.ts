import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { NodoCatalogo } from '../dto/catalogo.dto';
import { LABELS_CUSTOM, CAMPOS_OCULTOS, MODELOS_OCULTOS, AGREGADORES_POR_TIPO, OPERADORES_POR_TIPO } from './metadata';

interface CacheEntry {
  data: NodoCatalogo[];
  timestamp: number;
}

interface KeysCacheEntry {
  data: string[];
  timestamp: number;
}

const CAMPOS_ADICIONALES_SAMPLE_SIZE = 1000;

@Injectable()
export class CatalogoService {
  private readonly logger = new Logger(CatalogoService.name);
  private cache = new Map<string, CacheEntry>();
  private keysCache = new Map<string, KeysCacheEntry>();
  private readonly CACHE_TTL = 3600000; // 1 hora en ms

  constructor(private prisma: PrismaService) {}

  async getCatalogo(raiz: string = 'deudor', depth: number = 3): Promise<NodoCatalogo[]> {
    const cacheKey = `${raiz}-${depth}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      this.logger.log(`Cache hit para catálogo ${cacheKey}`);
      return cached.data;
    }

    this.logger.log(`Construyendo catálogo para raíz=${raiz}, depth=${depth}`);
    const modelo = Prisma.dmmf.datamodel.models.find(
      (m: any) => m.name.toLowerCase() === raiz.toLowerCase(),
    );

    if (!modelo) {
      this.logger.warn(`Modelo ${raiz} no encontrado en DMMF`);
      return [];
    }

    const nodos = this.construirNodos(modelo, '', 0, depth, new Set([modelo.name.toLowerCase()]));

    this.cache.set(cacheKey, { data: nodos, timestamp: Date.now() });
    return nodos;
  }

  invalidateCache(): void {
    this.logger.log('Invalidando cache de catálogo');
    this.cache.clear();
    this.keysCache.clear();
  }

  async getCamposAdicionalesKeys(empresaId?: number): Promise<string[]> {
    const cacheKey = `campos-adicionales-${empresaId ?? 'all'}`;
    const cached = this.keysCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      this.logger.log(`Cache hit para ${cacheKey}`);
      return cached.data;
    }

    this.logger.log(
      `Descubriendo keys de camposAdicionales (empresaId=${empresaId ?? 'all'})`,
    );

    const where: any = {};
    if (empresaId) {
      where.empresaId = empresaId;
    }

    const muestra = await this.prisma.deudor.findMany({
      where,
      select: { camposAdicionales: true },
      take: CAMPOS_ADICIONALES_SAMPLE_SIZE,
      orderBy: { id: 'desc' },
    });

    const keysSet = new Set<string>();
    for (const fila of muestra) {
      const obj = fila.camposAdicionales as any;
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        for (const k of Object.keys(obj)) {
          keysSet.add(k);
        }
      }
    }

    const keys = Array.from(keysSet).sort((a, b) =>
      a.localeCompare(b, 'es', { sensitivity: 'base' }),
    );

    this.keysCache.set(cacheKey, { data: keys, timestamp: Date.now() });
    return keys;
  }

  private construirNodos(
    modelo: any,
    pathPrefix: string,
    currentDepth: number,
    maxDepth: number,
    visitedModels: Set<string>,
  ): NodoCatalogo[] {
    if (currentDepth >= maxDepth) {
      return [];
    }

    const nodos: NodoCatalogo[] = [];

    for (const field of modelo.fields) {
      const path = pathPrefix ? `${pathPrefix}.${field.name}` : field.name;

      // `id` queda oculto en sub-relaciones (ruido) pero visible en la raíz
      // donde es el identificador principal de la entidad.
      const esRaiz = !pathPrefix;
      if (CAMPOS_OCULTOS.has(field.name) && !(esRaiz && field.name === 'id')) {
        continue;
      }

      const nodo = this.construirNodo(field, path, currentDepth, maxDepth, visitedModels);
      if (nodo) {
        nodos.push(nodo);
      }
    }

    return nodos;
  }

  private construirNodo(
    field: any,
    path: string,
    currentDepth: number,
    maxDepth: number,
    visitedModels: Set<string>,
  ): NodoCatalogo | null {
    const label = LABELS_CUSTOM[path] || this.humanize(field.name);

    if (field.kind === 'scalar') {
      if (field.type === 'Json') {
        return this.construirNodoJson(field, path, label);
      }
      return this.construirNodoEscalar(field, path, label);
    }

    if (field.kind === 'object') {
      return this.construirNodoRelacion(field, path, label, currentDepth, maxDepth, visitedModels);
    }

    if (field.kind === 'enum') {
      return this.construirNodoEnum(field, path, label);
    }

    return null;
  }

  private construirNodoEscalar(field: any, path: string, label: string): NodoCatalogo {
    const tipo = this.mapearTipoEscalar(field.type);
    return {
      path,
      nombre: field.name,
      label,
      tipo: 'escalar',
      tipoEscalar: tipo,
      filtrosPermitidos: OPERADORES_POR_TIPO[field.type] || OPERADORES_POR_TIPO['String'],
    };
  }

  private construirNodoJson(field: any, path: string, label: string): NodoCatalogo {
    return {
      path,
      nombre: field.name,
      label,
      tipo: 'json',
      hijos: [],
    };
  }

  private construirNodoEnum(field: any, path: string, label: string): NodoCatalogo {
    return {
      path,
      nombre: field.name,
      label,
      tipo: 'escalar',
      tipoEscalar: 'enum',
      filtrosPermitidos: ['eq', 'in', 'notIn', 'isNull', 'isNotNull'],
    };
  }

  private construirNodoRelacion(
    field: any,
    path: string,
    label: string,
    currentDepth: number,
    maxDepth: number,
    visitedModels: Set<string>,
  ): NodoCatalogo | null {
    const tipoModelo = field.type.toLowerCase();

    // Cortar relaciones a modelos administrativos / técnicos
    if (MODELOS_OCULTOS.has(tipoModelo)) {
      return null;
    }

    // Cortar back-references: si el modelo destino ya está en la cadena, no recursar
    if (visitedModels.has(tipoModelo)) {
      return null;
    }

    const modeloRelacionado = Prisma.dmmf.datamodel.models.find(
      (m: any) => m.name === field.type,
    );

    if (!modeloRelacionado) {
      return null;
    }

    const esLista = field.isList;
    const esOpcional = !field.isRequired;

    let cardinalidad: '1-1' | '1-N' | 'opcional';
    let tipo: 'relacion-1-1' | 'relacion-1-n';

    if (esLista) {
      cardinalidad = '1-N';
      tipo = 'relacion-1-n';
    } else if (esOpcional) {
      cardinalidad = 'opcional';
      tipo = 'relacion-1-1';
    } else {
      cardinalidad = '1-1';
      tipo = 'relacion-1-1';
    }

    const nextVisited = new Set(visitedModels);
    nextVisited.add(tipoModelo);

    const hijos = this.construirNodos(modeloRelacionado, path, currentDepth + 1, maxDepth, nextVisited);

    // Si la relación no tiene hijos visibles, no la mostramos (rama vacía = ruido)
    if (hijos.length === 0) {
      return null;
    }

    const nodo: NodoCatalogo = {
      path,
      nombre: field.name,
      label,
      tipo,
      cardinalidad,
      hijos,
    };

    if (esLista) {
      nodo.agregadoresPermitidos = ['count', 'first', 'last'];
    }

    return nodo;
  }

  private mapearTipoEscalar(tipo: string): 'texto' | 'numero' | 'fecha' | 'boolean' {
    switch (tipo) {
      case 'Int':
      case 'Float':
      case 'Decimal':
        return 'numero';
      case 'DateTime':
        return 'fecha';
      case 'Boolean':
        return 'boolean';
      case 'String':
      default:
        return 'texto';
    }
  }

  private humanize(str: string): string {
    return str
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (s) => s.toUpperCase())
      .trim();
  }
}
