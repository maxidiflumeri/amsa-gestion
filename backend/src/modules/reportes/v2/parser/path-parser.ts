import { BadRequestException } from '@nestjs/common';
import { PathAST, PathSegment, Selector, AggregatorType } from './path-ast';

export class PathParser {
  parse(path: string): PathAST {
    if (!path || typeof path !== 'string') {
      throw new BadRequestException('Path vacío o inválido');
    }

    const trimmed = path.trim();
    if (!trimmed) {
      throw new BadRequestException('Path vacío');
    }

    if (!/^[a-zA-Z_][a-zA-Z0-9_.\[\]=,]*$/.test(trimmed)) {
      throw new BadRequestException(`Path contiene caracteres inválidos: ${path}`);
    }

    const parts = trimmed.split('.');
    const segments: PathSegment[] = [];

    for (const part of parts) {
      if (!part) {
        throw new BadRequestException(`Segmento vacío en path: ${path}`);
      }
      segments.push(this.parseSegment(part));
    }

    return {
      segments,
      raw: path,
    };
  }

  private parseSegment(segment: string): PathSegment {
    const modifierRegex = /\[([^\]]+)\]/g;
    const matches = [...segment.matchAll(modifierRegex)];
    const name = segment.replace(modifierRegex, '').trim();

    if (!name || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      throw new BadRequestException(`Nombre de segmento inválido: ${segment}`);
    }

    const modifiers: Selector[] = [];
    for (const match of matches) {
      const content = match[1].trim();
      modifiers.push(this.parseModifier(content));
    }

    return { name, modifiers };
  }

  private parseModifier(content: string): Selector {
    const aggregators: AggregatorType[] = ['sum', 'avg', 'count', 'min', 'max', 'first', 'last', 'concat'];

    if (aggregators.includes(content as AggregatorType)) {
      return {
        type: 'aggregator',
        aggregator: content as AggregatorType,
      };
    }

    if (/^\d+$/.test(content)) {
      return {
        type: 'indexer',
        index: parseInt(content, 10),
      };
    }

    if (content.includes('=')) {
      const filterPairs = content.split(',').map(pair => {
        const [field, value] = pair.split('=').map(s => s.trim());
        if (!field || value === undefined) {
          throw new BadRequestException(`Filtro mal formado: ${content}`);
        }
        return { field, value };
      });

      return {
        type: 'filter',
        filters: filterPairs,
      };
    }

    throw new BadRequestException(`Modificador desconocido: [${content}]`);
  }

  validate(path: string): void {
    this.parse(path);
  }
}
