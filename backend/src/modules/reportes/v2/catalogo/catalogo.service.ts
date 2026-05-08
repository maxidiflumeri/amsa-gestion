import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { NodoCatalogo } from '../dto/catalogo.dto';
import { LABELS_CUSTOM, CAMPOS_OCULTOS, AGREGADORES_POR_TIPO, OPERADORES_POR_TIPO } from './metadata';

interface CacheEntry {
  data: NodoCatalogo[];
  timestamp: number;
}

@Injectable()
export class CatalogoService {
  private readonly logger = new Logger(CatalogoService.name);
  private cache = new Map<string, CacheEntry>();
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
    const dmmf = (this.prisma as any)._baseDmmf || (this.prisma as any).dmmf;
    const modelo = dmmf.datamodel.models.find((m: any) => m.name.toLowerCase() === raiz.toLowerCase());

    if (!modelo) {
      this.logger.warn(`Modelo ${raiz} no encontrado en DMMF`);
      return [];
    }

    const nodos = this.construirNodos(modelo, '', 0, depth, new Set());

    this.cache.set(cacheKey, { data: nodos, timestamp: Date.now() });
    return nodos;
  }

  invalidateCache(): void {
    this.logger.log('Invalidando cache de catálogo');
    this.cache.clear();
  }

  private construirNodos(
    modelo: any,
    pathPrefix: string,
    currentDepth: number,
    maxDepth: number,
    visited: Set<string>,
  ): NodoCatalogo[] {
    if (currentDepth >= maxDepth) {
      return [];
    }

    const nodos: NodoCatalogo[] = [];
    const modelKey = `${pathPrefix}${modelo.name}`;

    if (visited.has(modelKey)) {
      return [];
    }
    visited.add(modelKey);

    for (const field of modelo.fields) {
      const path = pathPrefix ? `${pathPrefix}.${field.name}` : field.name;

      if (CAMPOS_OCULTOS.has(field.name)) {
        continue;
      }

      const nodo = this.construirNodo(field, path, currentDepth, maxDepth, visited);
      if (nodo) {
        nodos.push(nodo);
      }
    }

    visited.delete(modelKey);
    return nodos;
  }

  private construirNodo(
    field: any,
    path: string,
    currentDepth: number,
    maxDepth: number,
    visited: Set<string>,
  ): NodoCatalogo | null {
    const label = LABELS_CUSTOM[path] || this.humanize(field.name);

    if (field.kind === 'scalar') {
      return this.construirNodoEscalar(field, path, label);
    }

    if (field.kind === 'object') {
      return this.construirNodoRelacion(field, path, label, currentDepth, maxDepth, visited);
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
    visited: Set<string>,
  ): NodoCatalogo | null {
    const dmmf = (this.prisma as any)._baseDmmf || (this.prisma as any).dmmf;
    const modeloRelacionado = dmmf.datamodel.models.find((m: any) => m.name === field.type);

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

    const hijos = this.construirNodos(modeloRelacionado, path, currentDepth + 1, maxDepth, visited);

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
