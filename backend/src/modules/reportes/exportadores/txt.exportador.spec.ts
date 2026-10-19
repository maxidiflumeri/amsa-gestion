import { BadRequestException } from '@nestjs/common';
import { TxtExportador } from './txt.exportador';

const exportador = new TxtExportador();
const texto = (filas: any[], columnas: string[], opciones?: any) =>
  exportador.generar(filas, columnas, { lineEnding: '\n', ...opciones }).toString('utf8');

const COLS = ['DNI', 'Nombre', 'Saldo'];
const FILAS = [
  { DNI: '123', Nombre: 'Ana', Saldo: '1500' },
  { DNI: '45678', Nombre: 'Beatriz', Saldo: '20' },
];

describe('TxtExportador — separador (sin cambios)', () => {
  it('tabulación por defecto, con encabezado', () => {
    expect(texto(FILAS, COLS)).toBe('DNI\tNombre\tSaldo\n123\tAna\t1500\n45678\tBeatriz\t20');
  });

  it('separador propio y sin encabezado', () => {
    expect(texto(FILAS, COLS, { separador: ';', incluirHeader: false })).toBe('123;Ana;1500\n45678;Beatriz;20');
  });
});

// Cada campo se arma por partes (ancho 6, 8 y 6) para que se vea cuánto ocupa cada uno.
const linea = (...campos: string[]) => campos.join('');

describe('TxtExportador — ancho fijo', () => {
  const anchoFijo = [6, 8, 6];

  it('sin alineacion ni relleno: idéntico a antes (padEnd con espacios y corte por la derecha)', () => {
    expect(texto(FILAS, COLS, { anchoFijo })).toBe(
      [
        linea('DNI   ', 'Nombre  ', 'Saldo '),
        linea('123   ', 'Ana     ', '1500  '),
        linea('45678 ', 'Beatriz ', '20    '),
      ].join('\n'),
    );
  });

  it('recorta por la derecha lo que no entra, como siempre', () => {
    expect(texto([{ DNI: '1234567890', Nombre: 'x', Saldo: '' }], COLS, { anchoFijo, incluirHeader: false })).toBe(
      linea('123456', 'x       ', '      '),
    );
  });

  it('largos distintos de la cantidad de columnas: 400 (antes un ancho faltante valía 10 y los datos salían corridos)', () => {
    const generar = (opciones: any) => () => texto(FILAS, COLS, { incluirHeader: false, ...opciones });
    expect(generar({ anchoFijo: [6, 8] })).toThrow('El ancho fijo tiene 2 valores y la plantilla 3 columnas');
    expect(generar({ anchoFijo: [6, 8, 6, 9] })).toThrow('El ancho fijo tiene 4 valores y la plantilla 3 columnas');
    expect(generar({ anchoFijo: [6, 8, 6], alineacion: ['derecha'] })).toThrow('La alineación tiene 1 valores y la plantilla 3 columnas');
    expect(generar({ anchoFijo: [6, 8, 6], relleno: [' '] })).toThrow('El relleno tiene 1 valores y la plantilla 3 columnas');
    expect(generar({ anchoFijo: [6, 8, 6] })).not.toThrow();
  });

  describe('E4: alineación', () => {
    it('derecha alinea al final, con espacios', () => {
      expect(texto(FILAS, COLS, { anchoFijo, alineacion: ['izquierda', 'izquierda', 'derecha'], incluirHeader: false })).toBe(
        [linea('123   ', 'Ana     ', '  1500'), linea('45678 ', 'Beatriz ', '    20')].join('\n'),
      );
    });

    it('"izquierda" explícito es lo mismo que no decir nada', () => {
      expect(texto(FILAS, COLS, { anchoFijo, alineacion: ['izquierda', 'izquierda', 'izquierda'] })).toBe(texto(FILAS, COLS, { anchoFijo }));
    });

    it('el encabezado usa la misma alineación', () => {
      expect(texto(FILAS, COLS, { anchoFijo, alineacion: ['izquierda', 'izquierda', 'derecha'] }).split('\n')[0]).toBe(
        linea('DNI   ', 'Nombre  ', ' Saldo'),
      );
    });
  });

  describe('E4: relleno', () => {
    it('ceros a la izquierda para un importe alineado a la derecha', () => {
      expect(
        texto(FILAS, COLS, {
          anchoFijo,
          alineacion: ['derecha', 'izquierda', 'derecha'],
          relleno: ['0', ' ', '0'],
          incluirHeader: false,
        }),
      ).toBe([linea('000123', 'Ana     ', '001500'), linea('045678', 'Beatriz ', '000020')].join('\n'));
    });

    it('el encabezado no se rellena con ceros: se alinea pero con espacios', () => {
      const encabezado = texto(FILAS, COLS, { anchoFijo, alineacion: ['derecha', 'izquierda', 'derecha'], relleno: ['0', ' ', '0'] }).split('\n')[0];
      expect(encabezado).toBe(linea('   DNI', 'Nombre  ', ' Saldo'));
    });

    it('relleno " " sin alineacion: igual que no decir nada', () => {
      expect(texto([{ DNI: '1', Nombre: 'a', Saldo: '2' }], COLS, { anchoFijo: [3, 3, 3], relleno: [' ', ' ', ' '], incluirHeader: false })).toBe('1  a  2  ');
    });

    it('relleno "0" con alineación izquierda (o sin alineación) es un dato equivocado: 400', () => {
      const generar = (alineacion?: any) => () =>
        texto([{ DNI: '12345', Nombre: 'a', Saldo: '2' }], COLS, { anchoFijo: [10, 3, 3], relleno: ['0', ' ', ' '], alineacion, incluirHeader: false });
      expect(generar()).toThrow(BadRequestException);
      expect(generar(['izquierda', 'izquierda', 'izquierda'])).toThrow('En «DNI» el relleno con ceros solo se puede usar con alineación a la derecha');
      expect(generar(['derecha', 'izquierda', 'izquierda'])).not.toThrow();
    });
  });

  describe('E4: negativos con ceros', () => {
    const una = (saldo: string, ancho = 8) =>
      texto([{ DNI: '', Nombre: '', Saldo: saldo }], COLS, {
        anchoFijo: [0 + 1, 1, ancho],
        alineacion: ['izquierda', 'izquierda', 'derecha'],
        relleno: [' ', ' ', '0'],
        incluirHeader: false,
      }).slice(2);

    it('el signo va adelante: -0001234, no 000-1234', () => {
      expect(una('-1234')).toBe('-0001234');
      expect(una('+1234')).toBe('+0001234');
      expect(una('1234')).toBe('00001234');
    });

    it('con espacios no cambia nada', () => {
      const t = texto([{ DNI: '', Nombre: '', Saldo: '-12' }], COLS, { anchoFijo: [1, 1, 6], alineacion: ['izquierda', 'izquierda', 'derecha'], incluirHeader: false });
      expect(t.slice(2)).toBe('   -12');
    });

    it('un negativo que justo entra o no entra', () => {
      expect(una('-12345678', 9)).toBe('-12345678');
      expect(una('-12345678', 8)).toBe('12345678');
    });
  });

  describe('E4: recorte', () => {
    it('a la izquierda corta por la derecha', () => {
      expect(texto([{ DNI: '123456789', Nombre: '', Saldo: '' }], COLS, { anchoFijo: [4, 1, 1], alineacion: ['izquierda', 'izquierda', 'izquierda'], incluirHeader: false })).toBe('1234  ');
    });

    it('a la derecha conserva los últimos caracteres: un número pierde los dígitos más significativos', () => {
      expect(texto([{ DNI: '123456789', Nombre: '', Saldo: '' }], COLS, { anchoFijo: [4, 1, 1], alineacion: ['derecha', 'izquierda', 'izquierda'], incluirHeader: false })).toBe('6789  ');
    });

    it('un valor que entra justo no se toca en ninguno de los dos lados', () => {
      const fila = [{ DNI: '1234', Nombre: '', Saldo: '' }];
      expect(texto(fila, COLS, { anchoFijo: [4, 1, 1], alineacion: ['derecha', 'izquierda', 'izquierda'], incluirHeader: false })).toBe('1234  ');
      expect(texto(fila, COLS, { anchoFijo: [4, 1, 1], alineacion: ['izquierda', 'izquierda', 'izquierda'], incluirHeader: false })).toBe('1234  ');
    });
  });

  it('valores vacíos o ausentes se rellenan del ancho', () => {
    expect(
      texto([{ DNI: null, Nombre: undefined }], COLS, {
        anchoFijo: [3, 3, 3],
        alineacion: ['derecha', 'derecha', 'derecha'],
        relleno: ['0', '0', '0'],
        incluirHeader: false,
      }),
    ).toBe('000000000');
  });

  it('con subtotales: la cabecera y los totales usan la alineación de cada columna', () => {
    const filas: any[] = [
      { tipo: 'cabecera', grupoLabel: 'G', datos: {} },
      { tipo: 'dato', datos: { DNI: '1', Nombre: 'a', Saldo: '5' } },
      { tipo: 'total', grupoLabel: 'Total', datos: { Saldo: 5 } },
    ];
    expect(
      texto(filas, COLS, { anchoFijo: [5, 3, 4], alineacion: ['izquierda', 'izquierda', 'derecha'], relleno: [' ', ' ', '0'], incluirHeader: false }),
    ).toBe([linea('G    ', '   ', '0000'), linea('1    ', 'a  ', '0005'), linea('Total', '   ', '0005')].join('\n'));
  });
});
