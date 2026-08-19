import { opcionesDelFormato } from './opciones-formato';
import { TxtExportador } from './txt.exportador';
import { CsvExportador } from './csv.exportador';

describe('opcionesDelFormato', () => {
  const guardado = {
    txt: { separador: ';', incluirHeader: false },
    csv: { separador: '|' },
  };

  it('devuelve solo las opciones del formato pedido', () => {
    expect(opcionesDelFormato(guardado, 'txt')).toEqual({ separador: ';', incluirHeader: false });
    expect(opcionesDelFormato(guardado, 'csv')).toEqual({ separador: '|' });
  });

  it('devuelve undefined para un formato sin opciones guardadas', () => {
    expect(opcionesDelFormato(guardado, 'xlsx')).toBeUndefined();
    expect(opcionesDelFormato(null, 'txt')).toBeUndefined();
    expect(opcionesDelFormato(undefined, 'txt')).toBeUndefined();
  });
});

describe('exportadores — separador configurable', () => {
  const filas = [{ a: '1', b: 'x' }, { a: '2', b: 'y' }];
  const columnas = ['a', 'b'];

  describe('TXT', () => {
    const txt = new TxtExportador();

    it('usa el separador configurado', () => {
      expect(txt.generar(filas, columnas, { separador: ';' }).toString()).toBe('a;b\r\n1;x\r\n2;y');
      expect(txt.generar(filas, columnas, { separador: ',' }).toString()).toBe('a,b\r\n1,x\r\n2,y');
      expect(txt.generar(filas, columnas, { separador: '|' }).toString()).toBe('a|b\r\n1|x\r\n2|y');
    });

    it('sin opciones sigue saliendo con tabulación', () => {
      expect(txt.generar(filas, columnas).toString()).toBe('a\tb\r\n1\tx\r\n2\ty');
    });

    it('respeta un separador vacío en vez de caer al default', () => {
      expect(txt.generar(filas, columnas, { separador: '' }).toString()).toBe('ab\r\n1x\r\n2y');
    });

    it('puede sacar la fila de encabezado', () => {
      expect(txt.generar(filas, columnas, { separador: ';', incluirHeader: false }).toString()).toBe('1;x\r\n2;y');
    });

    // La regresión que motivó `opcionesDelFormato`: se le pasaba el envoltorio entero y el
    // exportador buscaba `separador` en la raíz, así que toda opción se ignoraba en silencio.
    it('el envoltorio por formato hay que desarmarlo antes de pasarlo', () => {
      const guardado = { txt: { separador: ';' } };
      expect(txt.generar(filas, columnas, guardado as any).toString()).toBe('a\tb\r\n1\tx\r\n2\ty');
      expect(txt.generar(filas, columnas, opcionesDelFormato(guardado, 'txt')).toString()).toBe('a;b\r\n1;x\r\n2;y');
    });
  });

  describe('CSV', () => {
    const csv = new CsvExportador();
    const sinBom = (b: Buffer) => b.toString().replace(/^﻿/, '');

    it('usa el separador configurado', () => {
      expect(sinBom(csv.generar(filas, columnas, { separador: ';', quoting: false }))).toBe('a;b\r\n1;x\r\n2;y');
    });

    it('sin opciones sigue saliendo con coma', () => {
      expect(sinBom(csv.generar(filas, columnas, { quoting: false }))).toBe('a,b\r\n1,x\r\n2,y');
    });
  });
});
