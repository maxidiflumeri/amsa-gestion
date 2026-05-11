import { Injectable, Logger } from '@nestjs/common';
import { AgrupacionDto, TotalDto } from '../dto/plantilla.dto';

export interface FilaConSubtotales {
  tipo: 'dato' | 'subtotal' | 'total' | 'cabecera';
  nivel?: number;
  grupoLabel?: string;
  datos: Record<string, any>;
}

@Injectable()
export class GroupingService {
  private readonly logger = new Logger(GroupingService.name);

  aplicarAgrupacionYTotales(
    filas: Record<string, any>[],
    agrupaciones: AgrupacionDto[],
    totales: TotalDto[],
    columnas: string[],
    pathToLabel: Record<string, string> = {},
  ): FilaConSubtotales[] {
    const keyOf = (path: string): string => pathToLabel[path] || path.split('.').pop() || path;
    if (!agrupaciones || agrupaciones.length === 0) {
      if (totales && totales.length > 0) {
        return this.aplicarSoloTotales(filas, totales, columnas, keyOf);
      }
      return filas.map(f => ({ tipo: 'dato', datos: f }));
    }

    this.logger.log(`Aplicando ${agrupaciones.length} agrupaciones y ${totales?.length || 0} totales`);

    const resultado: FilaConSubtotales[] = [];
    const grupos = this.agruparRecursivo(filas, agrupaciones, 0, keyOf);

    const procesarGrupo = (grupo: any, nivel: number) => {
      if (nivel === agrupaciones.length) {
        (grupo as any[]).forEach(fila => resultado.push({ tipo: 'dato', datos: fila }));
        return;
      }

      for (const [key, items] of Object.entries(grupo)) {
        const agrupacionActual = agrupaciones[nivel];
        const labelGrupo = keyOf(agrupacionActual.path);

        const filasDelGrupo = this.aplanarFilas(items);

        resultado.push({
          tipo: 'cabecera',
          nivel,
          grupoLabel: `${labelGrupo}: ${key} (${filasDelGrupo.length})`,
          datos: this.filaVacia(columnas),
        });

        if (nivel < agrupaciones.length - 1) {
          procesarGrupo(items, nivel + 1);
        } else {
          (items as any[]).forEach(fila => resultado.push({ tipo: 'dato', datos: fila }));
        }

        if (agrupacionActual.mostrarSubtotales) {
          const subtotalRow = totales && totales.length > 0
            ? this.calcularSubtotal(items as any[], totales, columnas, keyOf)
            : this.filaVacia(columnas);
          resultado.push({
            tipo: 'subtotal',
            nivel,
            grupoLabel: `Subtotal ${labelGrupo}: ${key} (${filasDelGrupo.length} filas)`,
            datos: subtotalRow,
          });
        }
      }
    };

    procesarGrupo(grupos, 0);

    if (totales && totales.length > 0) {
      const totalRow = this.calcularSubtotal(filas, totales, columnas, keyOf);
      resultado.push({
        tipo: 'total',
        grupoLabel: 'TOTAL GENERAL',
        datos: totalRow,
      });
    }

    return resultado;
  }

  private agruparRecursivo(
    filas: Record<string, any>[],
    agrupaciones: AgrupacionDto[],
    nivel: number,
    keyOf: (path: string) => string,
  ): any {
    if (nivel >= agrupaciones.length) {
      return filas;
    }

    const agrupacionActual = agrupaciones[nivel];
    const flatKey = keyOf(agrupacionActual.path);

    const grouped = filas.reduce((acc, fila) => {
      const value = fila[flatKey];
      const key = (value === null || value === undefined || value === '') ? '(vacío)' : String(value);
      if (!acc[key]) acc[key] = [];
      acc[key].push(fila);
      return acc;
    }, {} as Record<string, any[]>);

    if (nivel < agrupaciones.length - 1) {
      for (const key in grouped) {
        grouped[key] = this.agruparRecursivo(grouped[key], agrupaciones, nivel + 1, keyOf);
      }
    }

    return grouped;
  }

  private aplicarSoloTotales(
    filas: Record<string, any>[],
    totales: TotalDto[],
    columnas: string[],
    keyOf: (path: string) => string,
  ): FilaConSubtotales[] {
    const resultado: FilaConSubtotales[] = filas.map(f => ({ tipo: 'dato' as const, datos: f }));
    const totalRow = this.calcularSubtotal(filas, totales, columnas, keyOf);
    resultado.push({
      tipo: 'total' as const,
      grupoLabel: 'TOTAL GENERAL',
      datos: totalRow,
    });
    return resultado;
  }

  private calcularSubtotal(
    filas: any[] | Record<string, any[]>,
    totales: TotalDto[],
    columnas: string[],
    keyOf: (path: string) => string,
  ): Record<string, any> {
    const row: Record<string, any> = {};

    let filasPlanas: any[];
    if (Array.isArray(filas)) {
      filasPlanas = filas;
    } else {
      filasPlanas = [];
      const aplanar = (obj: any) => {
        if (Array.isArray(obj)) {
          filasPlanas.push(...obj);
        } else {
          for (const val of Object.values(obj)) {
            aplanar(val);
          }
        }
      };
      aplanar(filas);
    }

    for (const total of totales) {
      const flatKey = keyOf(total.path);
      const labelFinal = total.label || flatKey;

      const valores = filasPlanas
        .map(f => this.parseNumeric(f[flatKey]))
        .filter((v): v is number => v !== null);

      let resultado: number | null = null;

      switch (total.funcion) {
        case 'sum':
          resultado = valores.reduce((acc, val) => acc + val, 0);
          break;
        case 'avg':
          resultado = valores.length > 0 ? valores.reduce((acc, val) => acc + val, 0) / valores.length : null;
          break;
        case 'count':
          resultado = valores.length;
          break;
        case 'min':
          resultado = valores.length > 0 ? Math.min(...valores) : null;
          break;
        case 'max':
          resultado = valores.length > 0 ? Math.max(...valores) : null;
          break;
      }

      row[labelFinal] = resultado;
    }

    for (const col of columnas) {
      if (!(col in row)) {
        row[col] = '';
      }
    }

    return row;
  }

  private parseNumeric(v: any): number | null {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return isNaN(v) ? null : v;
    if (typeof v !== 'string') return null;
    let s = v.replace(/[^\d,.\-]/g, '');
    if (s.includes(',') && s.includes('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (s.includes(',')) {
      s = s.replace(',', '.');
    }
    const n = Number(s);
    return isNaN(n) ? null : n;
  }

  private aplanarFilas(items: any): any[] {
    if (Array.isArray(items)) return items;
    const out: any[] = [];
    const walk = (o: any) => {
      if (Array.isArray(o)) out.push(...o);
      else if (o && typeof o === 'object') Object.values(o).forEach(walk);
    };
    walk(items);
    return out;
  }

  private filaVacia(columnas: string[]): Record<string, any> {
    const r: Record<string, any> = {};
    for (const c of columnas) r[c] = '';
    return r;
  }

  private getValueByPath(obj: any, pathParts: string[]): any {
    let current = obj;
    for (const part of pathParts) {
      if (current == null) return null;
      current = current[part];
    }
    return current;
  }
}
