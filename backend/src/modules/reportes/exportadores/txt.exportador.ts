import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { FilaConSubtotales } from '../executor/grouping.service';

export interface OpcionesTxt {
  /**
   * Cualquier carácter, no una lista cerrada: cada sistema destino pide el suyo (coma, punto y
   * coma, pipe, tab, o algo más raro) y no hay razón para adivinar cuáles valen.
   */
  separador?: string;
  encoding?: 'utf8' | 'latin1';
  lineEnding?: '\r\n' | '\n';
  incluirHeader?: boolean;
  anchoFijo?: number[];
  /**
   * E4: por columna, cómo se acomoda el valor dentro de su ancho fijo. `izquierda` (default) es el
   * comportamiento de siempre; `derecha` alinea al final y, si el valor no entra, conserva los
   * **últimos** caracteres. Sin `anchoFijo` no se usa.
   */
  alineacion?: Array<'izquierda' | 'derecha'>;
  /** E4: con qué se completa cada campo hasta su ancho (`' '` por defecto; `'0'` para importes a la derecha). */
  relleno?: Array<' ' | '0'>;
}

@Injectable()
export class TxtExportador {
  private readonly logger = new Logger(TxtExportador.name);

  generar(
    filas: Record<string, any>[] | FilaConSubtotales[],
    columnas: string[],
    opciones?: OpcionesTxt,
  ): Buffer {
    this.logger.log(`Generando TXT con ${filas.length} filas`);

    const separador = opciones?.separador ?? '\t';
    const lineEnding = opciones?.lineEnding || '\r\n';
    const incluirHeader = opciones?.incluirHeader !== false;
    const encoding = opciones?.encoding || 'utf8';
    const anchoFijo = opciones?.anchoFijo;
    const alineacion = opciones?.alineacion;
    const relleno = opciones?.relleno;

    if (anchoFijo) this.validarAnchoFijo(columnas, anchoFijo, alineacion, relleno);

    const lines: string[] = [];

    if (incluirHeader) {
      if (anchoFijo) {
        lines.push(this.formatearFilaAnchoFijo(columnas, anchoFijo, alineacion));
      } else {
        lines.push(columnas.join(separador));
      }
    }

    const filasPlanas = this.aplanarFilas(filas, columnas);

    for (const fila of filasPlanas) {
      const valores = columnas.map(col => String(fila[col] ?? ''));
      if (anchoFijo) {
        lines.push(this.formatearFilaAnchoFijo(valores, anchoFijo, alineacion, relleno));
      } else {
        lines.push(valores.join(separador));
      }
    }

    return Buffer.from(lines.join(lineEnding), encoding);
  }

  /**
   * Red de última instancia (el validador de la plantilla corre al guardar; esto cubre lo guardado antes
   * y lo editado en la base): largos que no coinciden con las columnas, o ceros a la derecha de un número,
   * son un archivo con datos corridos o equivocados, no un formato.
   */
  private validarAnchoFijo(
    columnas: string[],
    anchoFijo: number[],
    alineacion?: Array<'izquierda' | 'derecha'>,
    relleno?: Array<' ' | '0'>,
  ): void {
    const m = columnas.length;
    const falla = (mensaje: string): never => {
      this.logger.warn(mensaje);
      throw new BadRequestException(mensaje);
    };
    if (anchoFijo.length !== m) falla(`El ancho fijo tiene ${anchoFijo.length} valores y la plantilla ${m} columnas`);
    if (alineacion && alineacion.length !== m) falla(`La alineación tiene ${alineacion.length} valores y la plantilla ${m} columnas`);
    if (relleno && relleno.length !== m) falla(`El relleno tiene ${relleno.length} valores y la plantilla ${m} columnas`);
    columnas.forEach((col, i) => {
      if (relleno?.[i] === '0' && alineacion?.[i] !== 'derecha') {
        falla(`En «${col}» el relleno con ceros solo se puede usar con alineación a la derecha`);
      }
    });
  }

  private aplanarFilas(
    filas: Record<string, any>[] | FilaConSubtotales[],
    columnas: string[],
  ): Record<string, any>[] {
    if (filas.length === 0) return [];

    if (this.esFilaConSubtotales(filas[0])) {
      return (filas as FilaConSubtotales[]).map(f => {
        if (f.tipo === 'dato') {
          return f.datos;
        } else if (f.tipo === 'cabecera') {
          const row: Record<string, any> = { [columnas[0]]: f.grupoLabel || '' };
          columnas.slice(1).forEach(col => { row[col] = ''; });
          return row;
        } else if (f.tipo === 'subtotal' || f.tipo === 'total') {
          const row: Record<string, any> = { [columnas[0]]: f.grupoLabel || 'Total' };
          columnas.slice(1).forEach(col => {
            row[col] = f.datos[col] ?? '';
          });
          return row;
        }
        return f.datos;
      });
    }

    return filas as Record<string, any>[];
  }

  /**
   * Un campo por columna. Sin `alineacion` ni `relleno` es exactamente lo de siempre
   * (`padEnd(ancho)` y corte por la derecha). El encabezado no recibe `relleno`: se alinea igual que
   * los datos pero siempre se completa con espacios, un «0000Saldo» no sirve de título.
   */
  private formatearFilaAnchoFijo(
    valores: string[],
    anchos: number[],
    alineacion?: Array<'izquierda' | 'derecha'>,
    relleno?: Array<' ' | '0'>,
  ): string {
    return valores
      .map((v, idx) => {
        const ancho = anchos[idx] || 10;
        const relleno1 = relleno?.[idx] || ' ';
        if (alineacion?.[idx] === 'derecha') {
          // Con ceros, el signo de un negativo va adelante: -0001234, no 000-1234.
          const signo = relleno1 === '0' && /^[-+]/.test(v) ? v[0] : '';
          const campo = signo + v.slice(signo.length).padStart(ancho - signo.length, relleno1);
          return campo.length > ancho ? campo.slice(campo.length - ancho) : campo;
        }
        return v.padEnd(ancho, relleno1).substring(0, ancho);
      })
      .join('');
  }

  private esFilaConSubtotales(fila: any): fila is FilaConSubtotales {
    return fila && typeof fila === 'object' && 'tipo' in fila && 'datos' in fila;
  }
}
