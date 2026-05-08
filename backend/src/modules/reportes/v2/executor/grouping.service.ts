import { Injectable, Logger } from '@nestjs/common';
import { AgrupacionDto, TotalDto } from '../dto/plantilla-v2.dto';

export interface FilaConSubtotales {
  tipo: 'dato' | 'subtotal' | 'total';
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
  ): FilaConSubtotales[] {
    if (!agrupaciones || agrupaciones.length === 0) {
      if (totales && totales.length > 0) {
        return this.aplicarSoloTotales(filas, totales, columnas);
      }
      return filas.map(f => ({ tipo: 'dato', datos: f }));
    }

    this.logger.log(`Aplicando ${agrupaciones.length} agrupaciones y ${totales?.length || 0} totales`);

    const resultado: FilaConSubtotales[] = [];
    const grupos = this.agruparRecursivo(filas, agrupaciones, 0);

    const procesarGrupo = (grupo: any, nivel: number) => {
      if (nivel === agrupaciones.length) {
        grupo.forEach(fila => resultado.push({ tipo: 'dato', datos: fila }));
        return;
      }

      for (const [key, items] of Object.entries(grupo)) {
        const agrupacionActual = agrupaciones[nivel];
        const pathParts = agrupacionActual.path.split('.');
        const labelGrupo = pathParts[pathParts.length - 1];

        if (nivel < agrupaciones.length - 1) {
          procesarGrupo(items, nivel + 1);
        } else {
          (items as any[]).forEach(fila => resultado.push({ tipo: 'dato', datos: fila }));
        }

        if (agrupacionActual.mostrarSubtotales && totales && totales.length > 0) {
          const subtotalRow = this.calcularSubtotal(items as any[], totales, columnas);
          resultado.push({
            tipo: 'subtotal',
            nivel,
            grupoLabel: `Subtotal ${labelGrupo}: ${key}`,
            datos: subtotalRow,
          });
        }
      }
    };

    procesarGrupo(grupos, 0);

    if (totales && totales.length > 0) {
      const totalRow = this.calcularSubtotal(filas, totales, columnas);
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
  ): any {
    if (nivel >= agrupaciones.length) {
      return filas;
    }

    const agrupacionActual = agrupaciones[nivel];
    const pathParts = agrupacionActual.path.split('.');
    const campo = pathParts[pathParts.length - 1];

    const grouped = filas.reduce((acc, fila) => {
      const key = this.getValueByPath(fila, pathParts) ?? '(vacío)';
      if (!acc[key]) acc[key] = [];
      acc[key].push(fila);
      return acc;
    }, {} as Record<string, any[]>);

    if (nivel < agrupaciones.length - 1) {
      for (const key in grouped) {
        grouped[key] = this.agruparRecursivo(grouped[key], agrupaciones, nivel + 1);
      }
    }

    return grouped;
  }

  private aplicarSoloTotales(
    filas: Record<string, any>[],
    totales: TotalDto[],
    columnas: string[],
  ): FilaConSubtotales[] {
    const resultado: FilaConSubtotales[] = filas.map(f => ({ tipo: 'dato' as const, datos: f }));
    const totalRow = this.calcularSubtotal(filas, totales, columnas);
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
      const pathParts = total.path.split('.');
      const campo = pathParts[pathParts.length - 1];
      const labelFinal = total.label || campo;

      const valores = filasPlanas
        .map(f => this.getValueByPath(f, pathParts))
        .filter(v => v !== null && v !== undefined && !isNaN(Number(v)))
        .map(v => Number(v));

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

  private getValueByPath(obj: any, pathParts: string[]): any {
    let current = obj;
    for (const part of pathParts) {
      if (current == null) return null;
      current = current[part];
    }
    return current;
  }
}
