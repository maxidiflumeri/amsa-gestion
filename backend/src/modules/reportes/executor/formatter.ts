import dayjs from 'dayjs';
import { clasificarPorEnacom, codigoAreaDe, normalizarTelefonoArgentino } from '../../../common/utils/phone-utils';

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

  /**
   * Aplica el patrón del formato de teléfono sobre las partes del número.
   *
   * **Placeholders disponibles:**
   *
   * | | | Ejemplo sobre `+5491163525026` |
   * |---|---|---|
   * | `{numero}` | número nacional: área + abonado, 10 dígitos | `1163525026` |
   * | `{area}` | solo la característica (2 a 4 dígitos según la zona) | `11` |
   * | `{abonado}` | solo el abonado, sin la característica | `63525026` |
   * | `{15}` | el `15` local **si la línea es móvil**; vacío si es fija | `15` |
   *
   * Con eso se arman los cuatro formatos del catálogo —`549{numero}`, `0{numero}`, `{numero}`,
   * `+549{numero}`— y también los que necesitan meter algo en el medio, como el discado local de
   * celular que pide Neotel para las tramas de IPLAN: `0{area}{15}{abonado}` → `0111563525026`.
   *
   * Todo se calcula sobre el **número nacional significativo**: sin el `+54` del país y **sin el
   * `9` que marca móvil**. Ese `9` es lo que hacía fallar todos los patrones: los contactos se
   * guardan en E.164 (`+5491163525026`) y antes se le sacaba solo el `54`, así que `{numero}`
   * quedaba `91163525026` con el `9` pegado y `549{numero}` devolvía `54991163525026` —dos nueves,
   * 14 dígitos, imposible de marcar—. Los fijos salían bien porque no tienen ese `9`, así que el
   * problema se comía justo los celulares, que son casi toda la base de un predictivo.
   *
   * Salvo `{15}`, el patrón se aplica tal cual está declarado, sin mirar si la línea es fija o
   * móvil: un `549{numero}` sobre un fijo devuelve un número con el 9 de móvil. Es responsabilidad
   * de quien arma la plantilla elegir el patrón que corresponde a su base.
   */
  formatTelefono(valor: any, patron?: string): string {
    if (valor === null || valor === undefined || valor === '') return '';
    const partes = this.partesTelefono(valor);
    if (!partes.numero) return '';
    if (!patron) return partes.numero;

    return patron.replace(/\{(numero|area|abonado|15)\}/g, (_, clave: string) => {
      if (clave === 'numero') return partes.numero;
      if (clave === 'area') return partes.area;
      if (clave === 'abonado') return partes.abonado;
      return partes.movil ? '15' : '';
    });
  }

  /**
   * Parte el teléfono en lo que necesitan los patrones.
   *
   * Cuando no se puede determinar la característica —un número que no valida, un formato que la
   * tabla de ENACOM no reconoce— `area` queda vacía y `abonado` se lleva el número entero, así que
   * un patrón como `0{area}{15}{abonado}` degrada a `0{numero}`: un número marcable, aunque no en
   * el formato pedido. Es preferible a dejar la celda vacía o a inventar una característica.
   */
  private partesTelefono(valor: any): { numero: string; area: string; abonado: string; movil: boolean } {
    const { numero, marcaMovil } = this.numeroNacional(valor);
    if (!numero) return { numero: '', area: '', abonado: '', movil: false };

    const area = codigoAreaDe(numero) || '';
    return {
      numero,
      area,
      abonado: area ? numero.slice(area.length) : numero,
      // Dos señales, porque ninguna alcanza sola: el `9` del E.164 lo declara explícitamente, pero
      // hay celulares guardados sin él (`+541155775452`) que solo delatan los rangos de ENACOM, y
      // hay números válidos que ENACOM no tiene en ningún rango pero traen el `9`. Sin ninguna de
      // las dos, fija: meterle un `15` a un fijo lo vuelve inmarcable.
      movil: area ? marcaMovil || clasificarPorEnacom(numero) === 'MOBILE' : false,
    };
  }

  /**
   * Número nacional significativo (10 dígitos) de un teléfono argentino, y si el número traía la
   * marca de móvil (el `9` delante del área, que no es parte del número).
   *
   * Camino rápido para lo que ya está normalizado en E.164 —que es como los deja el importador y
   * cómo está el 99% de la base—, sin pagar el parseo de libphonenumber en cada fila de un reporte
   * de cientos de miles. Lo que no entra por ahí (teléfonos viejos sin normalizar, formatos
   * locales) va al normalizador de verdad, y recién si tampoco valida se cae al comportamiento
   * histórico: dígitos sueltos sin el `54`. Nunca devuelve vacío por no poder interpretar un
   * número: en un reporte, un teléfono raro impreso como vino es mejor que una celda vacía.
   */
  private numeroNacional(valor: any): { numero: string; marcaMovil: boolean } {
    const bruto = String(valor).trim();

    const e164 = /^\+54(\d{10,11})$/.exec(bruto);
    if (e164) return this.sinNueveDeMovil(e164[1]);

    const norm = normalizarTelefonoArgentino(bruto);
    if (norm.valido && norm.e164) {
      return this.sinNueveDeMovil(norm.e164.replace(/^\+54/, ''));
    }

    const digitos = bruto.replace(/\D/g, '');
    return { numero: digitos.startsWith('54') ? digitos.slice(2) : digitos, marcaMovil: false };
  }

  /**
   * Separa el `9` que marca móvil en el formato internacional. Ninguna característica argentina
   * empieza con 9 (todas arrancan en 1, 2 o 3), así que un nacional de 11 dígitos que empieza con
   * 9 es siempre un móvil.
   */
  private sinNueveDeMovil(nacional: string): { numero: string; marcaMovil: boolean } {
    const esMovil = nacional.length === 11 && nacional.startsWith('9');
    return { numero: esMovil ? nacional.slice(1) : nacional, marcaMovil: esMovil };
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
