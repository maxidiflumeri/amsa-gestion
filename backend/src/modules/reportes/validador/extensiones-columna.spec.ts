import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { validarDefinicion } from './definicion-validator';
import { ColumnaDto, CreatePlantillaDto } from '../dto/plantilla.dto';
import { prepararColumnas } from '../executor/columnas-preparadas';
import { PathParser } from '../parser/path-parser';
import { Formatter } from '../executor/formatter';
import { PathResolver } from '../executor/path-resolver';

const def = (columnas: any[]) => ({ columnas }) as any;
const mensaje = (fn: () => void): string => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return (e as BadRequestException).message;
  }
  throw new Error('no lanzó');
};

describe('E2 — validar tipo dias', () => {
  it('sobre una fecha del modelo pasa (calendario e instante, y en una rama)', () => {
    for (const path of ['fechaVencimiento', 'createdAt', 'pagos[last].fecha', 'facturas[0].vencimiento']) {
      expect(() => validarDefinicion(def([{ id: 'c', path, label: 'Días', tipo: 'dias' }]))).not.toThrow();
    }
  });

  it('sobre algo que no es una fecha da 400', () => {
    for (const path of ['saldo', 'documento', 'camposAdicionales.vencimiento', 'pagos[count]']) {
      expect(mensaje(() => validarDefinicion(def([{ id: 'c', path, label: 'Días de mora', tipo: 'dias' }])))).toBe(
        'Columna «Días de mora»: el tipo dias necesita un campo de fecha.',
      );
    }
  });

  it('una columna fija (sin path) no se revisa: no tiene fecha que mirar', () => {
    expect(() => validarDefinicion(def([{ id: 'c', path: '', label: 'x', tipo: 'dias' }]))).not.toThrow();
  });
});

describe('E3 — validar separadores', () => {
  it('el mismo separador para decimal y miles da 400', () => {
    expect(
      mensaje(() => validarDefinicion(def([{ id: 'c', path: 'saldo', label: 'Saldo', tipo: 'numero', separadorDecimal: ',', separadorMiles: ',' }]))),
    ).toContain('no pueden ser el mismo');
  });

  it('combinaciones válidas', () => {
    const ok = (extra: any) => validarDefinicion(def([{ id: 'c', path: 'saldo', label: 'Saldo', tipo: 'numero', ...extra }]));
    expect(() => ok({ decimales: 2, separadorDecimal: ',', separadorMiles: '.' })).not.toThrow();
    expect(() => ok({ decimales: 0, separadorDecimal: '.', separadorMiles: '' })).not.toThrow();
    expect(() => ok({ separadorDecimal: ',', separadorMiles: '' })).not.toThrow();
  });
});

describe('E2/E3/E4 — el DTO', () => {
  const columna = (extra: any) => plainToInstance(ColumnaDto, { id: 'c', path: 'saldo', label: 'Saldo', tipo: 'numero', ...extra });

  it('acepta los valores válidos', async () => {
    expect(await validate(columna({ decimales: 0 }))).toHaveLength(0);
    expect(await validate(columna({ decimales: 4, separadorDecimal: '.', separadorMiles: ',' }))).toHaveLength(0);
    expect(await validate(columna({ separadorMiles: '' }))).toHaveLength(0);
    expect(await validate(columna({ tipo: 'dias', path: 'fechaVencimiento' }))).toHaveLength(0);
  });

  it.each([
    [{ decimales: 5 }, 'decimales'],
    [{ decimales: -1 }, 'decimales'],
    [{ decimales: 1.5 }, 'decimales'],
    [{ separadorDecimal: ';' }, 'separadorDecimal'],
    [{ separadorDecimal: '' }, 'separadorDecimal'],
    [{ separadorMiles: ' ' }, 'separadorMiles'],
  ])('rechaza %j', async (extra, propiedad) => {
    const errores = await validate(columna(extra));
    expect(errores.map((e) => e.property)).toEqual([propiedad]);
  });

  it('CreatePlantillaDto acepta asistentePropuestaId entero y lo rechaza si no lo es', async () => {
    const base = {
      nombre: 'x',
      raiz: 'deudor',
      formatoSalida: 'xlsx',
      definicion: { columnas: [{ id: 'c', path: 'documento', label: 'DNI' }] },
    };
    expect(await validate(plainToInstance(CreatePlantillaDto, { ...base, asistentePropuestaId: 12 }))).toHaveLength(0);
    expect(await validate(plainToInstance(CreatePlantillaDto, base))).toHaveLength(0);
    const mal = await validate(plainToInstance(CreatePlantillaDto, { ...base, asistentePropuestaId: 'abc' }));
    expect(mal.map((e) => e.property)).toEqual(['asistentePropuestaId']);
  });
});

describe('E2/E3 — prepararColumnas y la cadena completa (resolver + formatter)', () => {
  const parser = new PathParser();
  const resolver = new PathResolver();
  const formatter = new Formatter();
  const preparar = (columnas: any[]) => prepararColumnas({ columnas } as any, parser, new Map());

  it('clasifica la fecha del path de una columna dias: calendario o instante', () => {
    const [venc, alta, rama] = preparar([
      { id: '1', path: 'fechaVencimiento', label: 'A', tipo: 'dias' },
      { id: '2', path: 'createdAt', label: 'B', tipo: 'dias' },
      { id: '3', path: 'pagos[last].fecha', label: 'C', tipo: 'dias' },
    ]);
    expect(venc.tipoFecha).toBe('calendario');
    expect(alta.tipoFecha).toBe('instante');
    expect(rama.tipoFecha).toBe('calendario');
  });

  it('una columna común queda exactamente como estaba: sin claves nuevas', () => {
    const [col] = preparar([{ id: '1', path: 'saldo', label: 'Saldo', tipo: 'numero', formato: '0.00' }]);
    expect(Object.keys(col).sort()).toEqual(['cardinalidad', 'formato', 'label', 'path', 'separadorConcat', 'tipo', 'valorFijo']);
  });

  it('pasa decimales y separadores a la columna preparada', () => {
    const [col] = preparar([{ id: '1', path: 'saldo', label: 'Saldo', tipo: 'numero', decimales: 2, separadorDecimal: ',', separadorMiles: '.' }]);
    expect(col).toMatchObject({ decimales: 2, separadorDecimal: ',', separadorMiles: '.' });
  });

  it('de la fila al resultado: días de mora (calendario a las 03:00Z) y saldo con 2 decimales', () => {
    const columnas = preparar([
      { id: '1', path: 'fechaVencimiento', label: 'Días de mora', tipo: 'dias' },
      { id: '2', path: 'saldo', label: 'Saldo', tipo: 'numero', decimales: 2 },
    ]);
    const hoy = new Date();
    const hace90 = new Date(Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 90, 3));
    const plano = resolver.resolveToFlat({ fechaVencimiento: hace90, saldo: 248300 }, columnas);
    const out = formatter.formatFila(plano, columnas);
    expect(out['Días de mora']).toBe(90);
    expect(out['Saldo']).toBe('248.300,00');
  });
});
