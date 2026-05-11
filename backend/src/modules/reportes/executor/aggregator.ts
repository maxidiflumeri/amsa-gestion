import { Logger } from '@nestjs/common';

export class Aggregator {
  private readonly logger = new Logger(Aggregator.name);

  sum(items: any[], campo: string): number | null {
    if (!Array.isArray(items) || items.length === 0) {
      return null;
    }

    let total = 0;
    let hasValues = false;

    for (const item of items) {
      const valor = this.getFieldValue(item, campo);
      if (valor !== null && valor !== undefined && typeof valor === 'number') {
        total += valor;
        hasValues = true;
      }
    }

    return hasValues ? total : null;
  }

  avg(items: any[], campo: string): number | null {
    if (!Array.isArray(items) || items.length === 0) {
      return null;
    }

    let total = 0;
    let count = 0;

    for (const item of items) {
      const valor = this.getFieldValue(item, campo);
      if (valor !== null && valor !== undefined && typeof valor === 'number') {
        total += valor;
        count++;
      }
    }

    return count > 0 ? total / count : null;
  }

  count(items: any[]): number {
    return Array.isArray(items) ? items.length : 0;
  }

  min(items: any[], campo: string): number | null {
    if (!Array.isArray(items) || items.length === 0) {
      return null;
    }

    let minVal: number | null = null;

    for (const item of items) {
      const valor = this.getFieldValue(item, campo);
      if (valor !== null && valor !== undefined && typeof valor === 'number') {
        if (minVal === null || valor < minVal) {
          minVal = valor;
        }
      }
    }

    return minVal;
  }

  max(items: any[], campo: string): number | null {
    if (!Array.isArray(items) || items.length === 0) {
      return null;
    }

    let maxVal: number | null = null;

    for (const item of items) {
      const valor = this.getFieldValue(item, campo);
      if (valor !== null && valor !== undefined && typeof valor === 'number') {
        if (maxVal === null || valor > maxVal) {
          maxVal = valor;
        }
      }
    }

    return maxVal;
  }

  first(items: any[]): any | null {
    if (!Array.isArray(items) || items.length === 0) {
      return null;
    }
    return items[0];
  }

  last(items: any[]): any | null {
    if (!Array.isArray(items) || items.length === 0) {
      return null;
    }

    // Si los items tienen campo 'fecha' o 'createdAt', ordenar por fecha desc
    const hasDateField = items.some(item => item?.fecha || item?.createdAt);

    if (hasDateField) {
      const sorted = [...items].sort((a, b) => {
        const dateA = a?.fecha || a?.createdAt;
        const dateB = b?.fecha || b?.createdAt;

        if (!dateA && !dateB) return 0;
        if (!dateA) return 1;
        if (!dateB) return -1;

        const timestampA = new Date(dateA).getTime();
        const timestampB = new Date(dateB).getTime();

        return timestampB - timestampA; // desc
      });

      return sorted[0];
    }

    return items[items.length - 1];
  }

  concat(items: any[], campo: string, separador: string = ', '): string | null {
    if (!Array.isArray(items) || items.length === 0) {
      return null;
    }

    const valores: string[] = [];

    for (const item of items) {
      const valor = this.getFieldValue(item, campo);
      if (valor !== null && valor !== undefined) {
        valores.push(String(valor));
      }
    }

    return valores.length > 0 ? valores.join(separador) : null;
  }

  private getFieldValue(item: any, campo: string): any {
    if (!item || !campo) {
      return null;
    }

    // Soporte para campos anidados (ej: 'usuario.nombre')
    const parts = campo.split('.');
    let current = item;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return null;
      }
      current = current[part];
    }

    return current;
  }
}
