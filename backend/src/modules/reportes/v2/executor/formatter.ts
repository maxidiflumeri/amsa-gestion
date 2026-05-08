import dayjs from 'dayjs';

export class Formatter {
  formatValue(value: any, tipo?: string, formato?: string): any {
    if (value === null || value === undefined) {
      return '';
    }

    if (tipo === 'fecha' && value instanceof Date) {
      return this.formatFecha(value, formato);
    }

    if (tipo === 'numero' || typeof value === 'number') {
      return this.formatNumero(value, formato);
    }

    if (tipo === 'moneda') {
      return this.formatMoneda(value);
    }

    if (tipo === 'boolean' || typeof value === 'boolean') {
      return value ? 'Sí' : 'No';
    }

    if (tipo === 'telefono') {
      return this.formatTelefono(value, formato);
    }

    return value;
  }

  formatTelefono(valor: any, patron?: string): string {
    if (valor === null || valor === undefined || valor === '') return '';
    const limpio = String(valor).replace(/\D/g, '');
    if (!limpio) return '';
    const sinPrefijo = limpio.startsWith('54') ? limpio.slice(2) : limpio;
    if (!patron) return sinPrefijo;
    return patron.replace('{numero}', sinPrefijo);
  }

  private formatFecha(fecha: Date, formato?: string): string {
    const fmt = formato || 'DD/MM/YYYY';
    return dayjs(fecha).format(fmt);
  }

  private formatNumero(numero: number, formato?: string): string {
    if (formato) {
      return numero.toLocaleString('es-AR');
    }
    return numero.toString();
  }

  private formatMoneda(valor: number): string {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 2,
    }).format(valor);
  }

  formatFila(fila: Record<string, any>, columnas: Array<{ label: string; tipo?: string; formato?: string }>): Record<string, any> {
    const formatted: Record<string, any> = {};

    for (const col of columnas) {
      const valor = fila[col.label];
      formatted[col.label] = this.formatValue(valor, col.tipo, col.formato);
    }

    return formatted;
  }
}
