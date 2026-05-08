import { Logger } from '@nestjs/common';
import { Aggregator } from './aggregator';

export type CardinalidadTipo = 'expandir' | 'concatenar' | 'primero' | 'ultimo';

export interface CardinalidadConfig {
  tipo: CardinalidadTipo;
  separador?: string;
}

export class CardinalityResolver {
  private readonly logger = new Logger(CardinalityResolver.name);
  private aggregator = new Aggregator();

  /**
   * Resuelve la cardinalidad de una relación 1-N.
   *
   * @param items Array de items relacionados (ej: contactos)
   * @param campo Campo a extraer de cada item (ej: 'valor')
   * @param config Configuración de cardinalidad
   */
  resolve(items: any[], campo: string | null, config: CardinalidadConfig): any {
    if (!Array.isArray(items) || items.length === 0) {
      return null;
    }

    switch (config.tipo) {
      case 'primero':
        return this.resolvePrimero(items, campo);

      case 'ultimo':
        return this.resolveUltimo(items, campo);

      case 'concatenar':
        return this.resolveConcatenar(items, campo, config.separador || ', ');

      case 'expandir':
        // Expandir se maneja a nivel de filas, no aquí
        // Este método se usa cuando una columna tiene cardinalidad explícita
        // y queremos extraer valores para concatenar o tomar primero/último
        this.logger.warn('Cardinalidad "expandir" debe manejarse a nivel de filas, no en resolve individual');
        return this.resolvePrimero(items, campo);

      default:
        this.logger.warn(`Cardinalidad desconocida: ${config.tipo}, usando primero`);
        return this.resolvePrimero(items, campo);
    }
  }

  /**
   * Expande filas cuando hay columnas con cardinalidad 'expandir'.
   * Si hay múltiples columnas con expandir, hace producto cartesiano y emite warning.
   */
  expandRows(
    filas: any[],
    columnasExpandir: Array<{ label: string; path: string }>,
  ): any[] {
    if (!columnasExpandir || columnasExpandir.length === 0) {
      return filas;
    }

    if (columnasExpandir.length > 1) {
      this.logger.warn(
        `Múltiples columnas con cardinalidad "expandir" detectadas (${columnasExpandir.length}). ` +
        `Esto puede generar producto cartesiano y multiplicar filas exponencialmente.`,
      );
    }

    const expandidas: any[] = [];

    for (const fila of filas) {
      const filaExpandida = this.expandSingleRow(fila, columnasExpandir);
      expandidas.push(...filaExpandida);
    }

    const factorExpansion = filas.length > 0 ? expandidas.length / filas.length : 1;
    if (factorExpansion > 10) {
      this.logger.warn(
        `Expansión generó ${factorExpansion.toFixed(1)}x filas (${filas.length} → ${expandidas.length}). ` +
        `Considerar cambiar cardinalidad a "concatenar" o "primero".`,
      );
    }

    return expandidas;
  }

  private expandSingleRow(fila: any, columnasExpandir: Array<{ label: string; path: string }>): any[] {
    // Para cada columna con expandir, necesitamos el array de valores
    // Si una columna tiene múltiples valores, duplicamos la fila
    // Si múltiples columnas tienen expandir, producto cartesiano

    const columnaArrays: Array<{ label: string; valores: any[] }> = [];

    for (const columna of columnasExpandir) {
      const valor = fila[columna.label];

      // Si el valor ya es array (porque el resolver devolvió el array completo), usarlo
      // Si está vacío, usar [null] para que genere una fila con valor null
      // Si no, envolver en array
      let valores: any[];

      if (Array.isArray(valor)) {
        valores = valor.length > 0 ? valor : [null];
      } else if (valor !== null && valor !== undefined) {
        valores = [valor];
      } else {
        valores = [null];
      }

      columnaArrays.push({ label: columna.label, valores });
    }

    // Generar producto cartesiano
    const resultado = this.cartesianProduct(columnaArrays);

    // Crear filas expandidas
    const filasExpandidas: any[] = [];

    for (const combinacion of resultado) {
      const nuevaFila = { ...fila };

      for (const { label, valor } of combinacion) {
        nuevaFila[label] = valor;
      }

      filasExpandidas.push(nuevaFila);
    }

    return filasExpandidas.length > 0 ? filasExpandidas : [fila];
  }

  private cartesianProduct(
    arrays: Array<{ label: string; valores: any[] }>,
  ): Array<Array<{ label: string; valor: any }>> {
    if (arrays.length === 0) {
      return [[]];
    }

    const [first, ...rest] = arrays;
    const restProduct = this.cartesianProduct(rest);

    const result: Array<Array<{ label: string; valor: any }>> = [];

    for (const valor of first.valores) {
      for (const restCombination of restProduct) {
        result.push([{ label: first.label, valor }, ...restCombination]);
      }
    }

    return result;
  }

  private resolvePrimero(items: any[], campo: string | null): any {
    const primero = this.aggregator.first(items);

    if (!primero) {
      return null;
    }

    if (!campo) {
      return primero;
    }

    return this.extractField(primero, campo);
  }

  private resolveUltimo(items: any[], campo: string | null): any {
    const ultimo = this.aggregator.last(items);

    if (!ultimo) {
      return null;
    }

    if (!campo) {
      return ultimo;
    }

    return this.extractField(ultimo, campo);
  }

  private resolveConcatenar(items: any[], campo: string | null, separador: string): string | null {
    if (!campo) {
      // Si no hay campo, concatenar los objetos completos (toString)
      const valores = items.filter(i => i !== null && i !== undefined).map(i => String(i));
      return valores.length > 0 ? valores.join(separador) : null;
    }

    return this.aggregator.concat(items, campo, separador);
  }

  private extractField(item: any, campo: string): any {
    if (!item || !campo) {
      return null;
    }

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
