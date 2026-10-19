process.env.TZ = 'America/Argentina/Buenos_Aires';

import { BadRequestException } from '@nestjs/common';
import { GroupingService } from './grouping.service';
import { Formatter } from './formatter';
import { resolverTotales } from './totales';
import { prepararColumnas } from './columnas-preparadas';
import { PathParser } from '../parser/path-parser';
import { validarDefinicion, validarOpcionesFormato } from '../validador/definicion-validator';

const grouping = new GroupingService();
const formatter = new Formatter();
const parser = new PathParser();

const COLUMNAS: any[] = [
  { id: 'c1', path: 'fechaVencimiento', label: 'Vencimiento', tipo: 'fecha' },
  { id: 'c2', path: 'fechaVencimiento', label: 'Días de mora', tipo: 'dias' },
];

describe('Totales atados a una columna (no al path)', () => {
  const hoy = new Date();
  const venc = new Date(Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 60, 3));

  const calcular = (totales: any[]) => {
    const cols = prepararColumnas({ columnas: COLUMNAS } as any, parser, new Map());
    const filas = [1, 2].map(() => formatter.formatFila({ Vencimiento: venc, 'Días de mora': venc }, cols));
    const pathToLabel: Record<string, string> = {};
    for (const c of COLUMNAS) pathToLabel[c.path] = c.label;
    const r = grouping.aplicarAgrupacionYTotales(filas, [], resolverTotales(COLUMNAS, totales), COLUMNAS.map((c) => c.label), pathToLabel);
    return r[r.length - 1].datos;
  };

  it('con columnaId, el promedio sale de los días (60) y no de la fecha formateada', () => {
    const datos = calcular([{ path: 'fechaVencimiento', columnaId: 'c2', funcion: 'avg', label: 'Prom. mora' }]);
    expect(datos['Prom. mora']).toBe(60);
  });

  it('la suma de la columna de días también', () => {
    expect(calcular([{ path: 'fechaVencimiento', columnaId: 'c2', funcion: 'sum', label: 'Total' }])['Total']).toBe(120);
  });

  it('solo con path y dos columnas con ese campo: 400 ambiguo', () => {
    expect(() => resolverTotales(COLUMNAS, [{ path: 'fechaVencimiento', funcion: 'avg' }])).toThrow(BadRequestException);
    expect(() => resolverTotales(COLUMNAS, [{ path: 'fechaVencimiento', funcion: 'avg' }])).toThrow(
      'El total sobre «fechaVencimiento» es ambiguo: hay dos columnas con ese campo',
    );
  });

  it('el validador general también lo frena, al guardar y al ejecutar', () => {
    const def = { columnas: COLUMNAS, totales: [{ path: 'fechaVencimiento', funcion: 'avg' }] } as any;
    expect(() => validarDefinicion(def)).toThrow('es ambiguo');
    expect(() => validarDefinicion(def, 'deudor', { valores: false })).toThrow('es ambiguo');
  });

  it('columnaId que no existe: 400', () => {
    expect(() => resolverTotales(COLUMNAS, [{ path: 'fechaVencimiento', columnaId: 'zzz', funcion: 'sum' }])).toThrow(BadRequestException);
  });

  it('compatibilidad: un total con solo path y UNA columna con ese campo anda igual que antes', () => {
    const cols = [{ id: 'a', path: 'saldo', label: 'Saldo', tipo: 'numero' }] as any[];
    const filas = [{ Saldo: 10 }, { Saldo: 5 }];
    const r = grouping.aplicarAgrupacionYTotales(filas, [], resolverTotales(cols, [{ path: 'saldo', funcion: 'sum' }]), ['Saldo'], { saldo: 'Saldo' });
    expect(r[2].datos['Saldo']).toBe(15);
  });
});

describe('Totales sobre números crudos (E3)', () => {
  const columnas: any[] = [{ id: 'a', path: 'saldo', label: 'Saldo', tipo: 'numero', decimales: 0, separadorMiles: '.' }];
  const cols = prepararColumnas({ columnas } as any, parser, new Map());
  const total = (filas: any[], funcion: any = 'sum') =>
    grouping.aplicarAgrupacionYTotales(filas, [], resolverTotales(columnas, [{ path: 'saldo', funcion }]), ['Saldo'], { saldo: 'Saldo' }).pop()!.datos['Saldo'];

  it('"1.234" + "5.678" suma 6912 y no 6,912', () => {
    const filas = [1234, 5678].map((n) => formatter.formatFila({ Saldo: n }, cols));
    expect(filas.map((f) => f['Saldo'])).toEqual(['1.234', '5.678']);
    expect(total(filas)).toBe('6.912'); // sale con el formato de la columna; se sumó 1234 + 5678, no 1,234 + 5,678
  });

  it('con miles "," y decimales también, y en subtotales por grupo', () => {
    const c2: any[] = [{ id: 'a', path: 'saldo', label: 'Saldo', tipo: 'numero', decimales: 1, separadorDecimal: '.', separadorMiles: ',' }];
    const p = prepararColumnas({ columnas: c2 } as any, parser, new Map());
    const filas = [1234.5, 1000.25].map((n) => formatter.formatFila({ Saldo: n, g: 'x' }, p));
    expect(grouping.aplicarAgrupacionYTotales(filas, [], resolverTotales(c2, [{ path: 'saldo', funcion: 'sum' }]), ['Saldo'], { saldo: 'Saldo' }).pop()!.datos['Saldo']).toBe('2,234.8');
  });

  it('el valor crudo no se ve: ni enumerable ni en JSON, y la salida visible es la de siempre', () => {
    const fila = formatter.formatFila({ Saldo: 1234 }, cols);
    expect(Object.keys(fila)).toEqual(['Saldo']);
    expect(JSON.stringify(fila)).toBe('{"Saldo":"1.234"}');
  });

  it('una columna sin E3 no lleva valores crudos: sus totales se calculan como siempre', () => {
    const c: any[] = [{ id: 'a', path: 'saldo', label: 'Saldo', tipo: 'numero', formato: '0,0' }];
    const p = prepararColumnas({ columnas: c } as any, parser, new Map());
    const fila = formatter.formatFila({ Saldo: 1234.5 }, p);
    expect(Object.getOwnPropertySymbols(fila)).toHaveLength(0);
    expect(fila['Saldo']).toBe('1.234,5');
  });
});

describe('Los totales respetan E3 (decimales y separadores de la columna)', () => {
  const columnas: any[] = [
    { id: 'a', path: 'saldo', label: 'Saldo', tipo: 'numero', decimales: 0, separadorMiles: '.' },
    { id: 'g', path: 'g', label: 'g' },
  ];
  const cols = prepararColumnas({ columnas } as any, parser, new Map());
  const filas = () => [1234567.891, 2000].map((n, i) => formatter.formatFila({ Saldo: n, g: i ? 'b' : 'a' }, cols));

  it('el total sale con 0 decimales y punto de miles, no 1236567.891', () => {
    const r = grouping.aplicarAgrupacionYTotales(filas(), [], resolverTotales(columnas, [{ path: 'saldo', funcion: 'sum' }]), ['Saldo'], { saldo: 'Saldo' });
    expect(r[r.length - 1].datos['Saldo']).toBe('1.236.568');
  });

  it('los subtotales también, y el promedio', () => {
    const r = grouping.aplicarAgrupacionYTotales(
      filas(), [{ path: 'g', mostrarSubtotales: true }],
      resolverTotales(columnas, [{ path: 'saldo', funcion: 'avg' }]), ['Saldo'], { saldo: 'Saldo', g: 'g' },
    );
    expect(r.filter((x) => x.tipo === 'subtotal').map((x) => x.datos['Saldo'])).toEqual(['1.234.568', '2.000']);
    expect(r[r.length - 1].datos['Saldo']).toBe('618.284');
  });

  it('count sigue siendo una cantidad, y una columna sin E3 sigue dando el número', () => {
    const r = grouping.aplicarAgrupacionYTotales(filas(), [], resolverTotales(columnas, [{ path: 'saldo', funcion: 'count' }]), ['Saldo'], { saldo: 'Saldo' });
    expect(r[r.length - 1].datos['Saldo']).toBe(2);
    const sin: any[] = [{ id: 'a', path: 'saldo', label: 'Saldo', tipo: 'numero' }];
    const r2 = grouping.aplicarAgrupacionYTotales([{ Saldo: 1.5 }, { Saldo: 2 }], [], resolverTotales(sin, [{ path: 'saldo', funcion: 'sum' }]), ['Saldo'], { saldo: 'Saldo' });
    expect(r2[2].datos['Saldo']).toBe(3.5);
  });
});

describe('E4: largos del ancho fijo (validador)', () => {
  const cols = [{ label: 'A' }, { label: 'B' }, { label: 'C' }];
  it('anchoFijo, alineacion y relleno con otra cantidad que las columnas: 400', () => {
    expect(() => validarOpcionesFormato(cols, { txt: { anchoFijo: [5, 5] } })).toThrow('El ancho fijo tiene 2 valores y la plantilla 3 columnas');
    expect(() => validarOpcionesFormato(cols, { txt: { anchoFijo: [5, 5, 5], alineacion: ['derecha'] } })).toThrow('La alineación tiene 1');
    expect(() => validarOpcionesFormato(cols, { txt: { anchoFijo: [5, 5, 5], relleno: [' ', ' '] } })).toThrow('El relleno tiene 2');
  });
  it('coinciden: pasa. Con otro formato de salida o sin anchoFijo no se revisa', () => {
    expect(() => validarOpcionesFormato(cols, { txt: { anchoFijo: [5, 5, 5], alineacion: ['derecha', 'izquierda', 'izquierda'] } }, 'txt')).not.toThrow();
    expect(() => validarOpcionesFormato(cols, { txt: { anchoFijo: [5] } }, 'xlsx')).not.toThrow();
    expect(() => validarOpcionesFormato(cols, { txt: { separador: ';' } }, 'txt')).not.toThrow();
  });
});

describe('E4: relleno con ceros exige alineación a la derecha (validador)', () => {
  const cols = [{ label: 'DNI' }, { label: 'Saldo' }];
  it('relleno 0 con izquierda o sin alineación: 400', () => {
    expect(() => validarOpcionesFormato(cols, { txt: { anchoFijo: [10, 10], relleno: ['0', ' '] } })).toThrow(
      'En «DNI» el relleno con ceros solo se puede usar con alineación a la derecha',
    );
    expect(() => validarOpcionesFormato(cols, { txt: { anchoFijo: [10, 10], relleno: [' ', '0'], alineacion: ['derecha', 'izquierda'] } })).toThrow('«Saldo»');
  });
  it('con derecha explícita pasa, y sin relleno no se toca', () => {
    expect(() => validarOpcionesFormato(cols, { txt: { relleno: ['0', '0'], alineacion: ['derecha', 'derecha'] } })).not.toThrow();
    expect(() => validarOpcionesFormato(cols, { txt: { anchoFijo: [10, 10] } })).not.toThrow();
    expect(() => validarOpcionesFormato(cols, undefined)).not.toThrow();
    expect(() => validarOpcionesFormato(cols, { csv: {} })).not.toThrow();
  });
});
