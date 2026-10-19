import { BadRequestException } from '@nestjs/common';
import { QueryPlanner } from './query-planner';
import { DefinicionPlantillaDto } from '../dto/plantilla.dto';
import { evaluarCondicion } from '../executor/evaluar-condicion';

const planner = new QueryPlanner();

const plan = (filtros: any[], vars: Record<string, any> = {}, preview = false) =>
  planner.planQuery(
    { columnas: [{ id: 'c1', path: 'documento', label: 'DNI' }], filtros } as DefinicionPlantillaDto,
    vars,
    preview,
  );
const where = (filtro: any, vars: Record<string, any> = {}) => plan([filtro], vars).where;

const mensaje = (fn: () => void): string => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return (e as BadRequestException).message;
  }
  throw new Error('no lanzó');
};

const utc = (iso: string) => new Date(iso);

describe('Entre / Fuera de con un extremo vacío (rango abierto)', () => {
  it.each([
    [[5, null], { gte: 5 }],
    [[5, ''], { gte: 5 }],
    [[null, 9], { lte: 9 }],
    [['', 9], { lte: 9 }],
    [[5, undefined], { gte: 5 }],
  ])('between %j', (valor, esperado) => {
    expect(where({ id: 'f', path: 'saldo', operador: 'between', valor })).toEqual({ AND: [{ saldo: esperado }] });
  });

  it('notBetween con un extremo es NOT gte / NOT lte', () => {
    expect(where({ id: 'f', path: 'saldo', operador: 'notBetween', valor: [5, null] })).toEqual({ AND: [{ saldo: { not: { gte: 5 } } }] });
    expect(where({ id: 'f', path: 'saldo', operador: 'notBetween', valor: ['', 9] })).toEqual({ AND: [{ saldo: { not: { lte: 9 } } }] });
  });

  it('la plantilla #1: "Remesa omite desde hasta" con solo "Desde" arma un rango abierto, no un 500', () => {
    const w = where({ id: 'f', path: 'remesa.numeroRemesa', operador: 'notBetween', variable: true, valor: undefined }, { f: ['15', null] });
    expect(w).toEqual({ AND: [{ remesa: { numeroRemesa: { not: { gte: '15' } } } }] });
  });

  it('con las dos puntas vacías un filtro variable opcional no aplica', () => {
    expect(plan([{ id: 'f', path: 'saldo', operador: 'between', variable: true }], { f: [null, ''] }).where).toEqual({});
  });

  it('con las dos puntas vacías, uno obligatorio da 400', () => {
    const m = mensaje(() => plan([{ id: 'f', path: 'saldo', operador: 'between', variable: true, obligatorio: true, labelVariable: 'Saldo' }], { f: ['', null] }));
    expect(m).toContain('es requerido pero no se proporcionó valor');
  });

  it('con las dos puntas vacías, uno fijo da 400', () => {
    expect(mensaje(() => plan([{ id: 'f', path: 'saldo', operador: 'between', valor: [null, null], labelVariable: 'Saldo' }]))).toBe('El filtro «Saldo» no tiene valor');
  });

  it('en datos adicionales también es un rango abierto, con los valores como texto', () => {
    expect(where({ id: 'f', path: 'camposAdicionales.cat', operador: 'between', valor: [2, null] })).toEqual({
      AND: [{ camposAdicionales: { path: '$.cat', gte: '2' } }],
    });
    expect(where({ id: 'f', path: 'camposAdicionales.cat', operador: 'notBetween', valor: [null, 4] })).toEqual({
      AND: [{ NOT: { camposAdicionales: { path: '$.cat', lte: '4' } } }],
    });
  });

  it('en fechas: una sola punta abarca el día entero hacia ese lado', () => {
    const w = where({ id: 'f', path: 'createdAt', operador: 'between', valor: ['2026-07-01', null] });
    expect(w.AND[0].createdAt).toEqual({ gte: new Date(2026, 6, 1, 0, 0, 0, 0) });
    const n = where({ id: 'f', path: 'createdAt', operador: 'notBetween', valor: ['', '2026-07-31'] });
    expect(n.AND[0]).toEqual({ NOT: { createdAt: { lte: new Date(2026, 6, 31, 23, 59, 59, 999) } } });
  });

  it('en memoria (post-procesado) también', () => {
    expect(evaluarCondicion(10, 'between', [5, null])).toBe(true);
    expect(evaluarCondicion(3, 'between', [5, '' as any])).toBe(false);
    expect(evaluarCondicion(10, 'between', [null, 9])).toBe(false);
    expect(evaluarCondicion(10, 'notBetween', [5, null])).toBe(false);
    expect(evaluarCondicion(3, 'notBetween', [5, null])).toBe(true);
  });
});

describe('Ventana del día: fecha calendario vs instante', () => {
  const f = (path: string, operador: string, valor: any) => where({ id: 'f', path, operador, valor }).AND[0];

  it('deudor.fechaVencimiento (calendario) usa el día UTC: toma lo guardado a las 00:00Z y a las 03:00Z', () => {
    const eq = f('fechaVencimiento', 'eq', '2026-03-15').fechaVencimiento;
    expect(eq).toEqual({ gte: utc('2026-03-15T00:00:00.000Z'), lte: utc('2026-03-15T23:59:59.999Z') });
    for (const guardado of ['2026-03-15T00:00:00.000Z', '2026-03-15T03:00:00.000Z', '2026-03-15T02:00:00.000Z']) {
      expect(utc(guardado) >= eq.gte && utc(guardado) <= eq.lte).toBe(true);
    }
    expect(utc('2026-03-14T03:00:00.000Z') >= eq.gte).toBe(false);
    expect(utc('2026-03-16T00:00:00.000Z') <= eq.lte).toBe(false);
  });

  it.each([
    ['gte', { gte: utc('2026-03-15T00:00:00.000Z') }],
    ['gt', { gt: utc('2026-03-15T23:59:59.999Z') }],
    ['lte', { lte: utc('2026-03-15T23:59:59.999Z') }],
    ['lt', { lt: utc('2026-03-15T00:00:00.000Z') }],
  ])('calendario, %s', (op, esperado) => {
    expect(f('fechaVencimiento', op, '2026-03-15').fechaVencimiento).toEqual(esperado);
  });

  it('calendario: neq, between y notBetween', () => {
    const dia = { gte: utc('2026-03-15T00:00:00.000Z'), lte: utc('2026-03-15T23:59:59.999Z') };
    expect(f('fechaVencimiento', 'neq', '2026-03-15')).toEqual({ NOT: { fechaVencimiento: dia } });
    expect(f('fechaVencimiento', 'between', ['2026-03-01', '2026-03-31']).fechaVencimiento).toEqual({
      gte: utc('2026-03-01T00:00:00.000Z'), lte: utc('2026-03-31T23:59:59.999Z'),
    });
    expect(f('fechaVencimiento', 'notBetween', ['2026-03-01', '2026-03-31'])).toEqual({
      NOT: { fechaVencimiento: { gte: utc('2026-03-01T00:00:00.000Z'), lte: utc('2026-03-31T23:59:59.999Z') } },
    });
  });

  it('también en las ramas: factura.vencimiento, pagos.fecha y cuotas del convenio son calendario', () => {
    expect(f('facturas.vencimiento', 'eq', '2026-03-15')).toEqual({
      facturas: { some: { vencimiento: { gte: utc('2026-03-15T00:00:00.000Z'), lte: utc('2026-03-15T23:59:59.999Z') } } },
    });
    expect(f('pagos.fecha', 'lte', '2026-03-15')).toEqual({ pagos: { some: { fecha: { lte: utc('2026-03-15T23:59:59.999Z') } } } });
    expect(f('convenios.cuotas.fechaVencimiento', 'gte', '2026-03-15')).toEqual({
      convenios: { some: { cuotas: { some: { fechaVencimiento: { gte: utc('2026-03-15T00:00:00.000Z') } } } } },
    });
  });

  it('un instante (createdAt, comentario.fecha) sigue usando el día local', () => {
    expect(f('createdAt', 'eq', '2026-03-15').createdAt).toEqual({
      gte: new Date(2026, 2, 15, 0, 0, 0, 0), lte: new Date(2026, 2, 15, 23, 59, 59, 999),
    });
    expect(f('comentarios.fecha', 'gte', '2026-03-15').comentarios.some.fecha).toEqual({ gte: new Date(2026, 2, 15, 0, 0, 0, 0) });
  });

  it('en memoria (post-procesado) compara por día con la misma clasificación', () => {
    // pagos[tipo=x].fecha: un pago guardado a las 00:00Z del 15 es "el 15" (calendario).
    const p = plan([{ id: 'f', path: 'pagos[origen=MANUAL].fecha', operador: 'eq', valor: '2026-03-15' }]);
    expect(p.postProcessingFilters[0].tipoFecha).toBe('calendario');
    expect(evaluarCondicion(utc('2026-03-15T00:00:00.000Z'), 'eq', '2026-03-15', 'calendario')).toBe(true);
    expect(evaluarCondicion(utc('2026-03-15T03:00:00.000Z'), 'eq', '2026-03-15', 'calendario')).toBe(true);
    expect(evaluarCondicion(utc('2026-03-14T03:00:00.000Z'), 'eq', '2026-03-15', 'calendario')).toBe(false);
    expect(evaluarCondicion(utc('2026-03-15T00:00:00.000Z'), 'gte', '2026-03-15', 'calendario')).toBe(true);
    expect(evaluarCondicion(utc('2026-03-15T20:00:00.000Z'), 'lte', '2026-03-15', 'calendario')).toBe(true);
    expect(evaluarCondicion(utc('2026-03-15T20:00:00.000Z'), 'gt', '2026-03-15', 'calendario')).toBe(false);
    expect(evaluarCondicion(utc('2026-03-15T20:00:00.000Z'), 'between', ['2026-03-01', '2026-03-15'], 'calendario')).toBe(true);
    expect(evaluarCondicion(utc('2026-03-15T20:00:00.000Z'), 'notBetween', ['2026-03-01', '2026-03-15'], 'calendario')).toBe(false);
    expect(evaluarCondicion(null, 'gte', '2026-03-15', 'calendario')).toBe(false);
    expect(evaluarCondicion(null, 'isNull', undefined, 'calendario')).toBe(true);
  });

  it('en memoria, un comentario (instante) se compara por el día local', () => {
    const p = plan([{ id: 'f', path: 'comentarios[origen=MANUAL].fecha', operador: 'eq', valor: '2026-03-15' }]);
    expect(p.postProcessingFilters[0].tipoFecha).toBe('instante');
    expect(evaluarCondicion(new Date(2026, 2, 15, 22, 0), 'eq', '2026-03-15', 'instante')).toBe(true);
    expect(evaluarCondicion(new Date(2026, 2, 16, 0, 1), 'eq', '2026-03-15', 'instante')).toBe(false);
  });
});

describe('Huecos por API', () => {
  it('un filtro fijo sin valor da 400 en vez de traer la cartera entera', () => {
    for (const valor of [undefined, '', null, [], [null, ''] as any]) {
      expect(mensaje(() => plan([{ id: 'f', path: 'saldo', operador: 'gt', valor, labelVariable: 'Saldo mínimo' }]))).toBe('El filtro «Saldo mínimo» no tiene valor');
    }
    expect(mensaje(() => plan([{ id: 'f', path: 'documento', operador: 'in', valor: [] }]))).toBe('El filtro «documento» no tiene valor');
  });

  it('isNull / isNotNull no llevan valor; false y 0 sí son valores', () => {
    expect(where({ id: 'f', path: 'saldo', operador: 'isNull' })).toEqual({ AND: [{ saldo: null }] });
    expect(where({ id: 'f', path: 'contactos.validado', operador: 'eq', valor: false }).AND[0].contactos.some.validado).toEqual({ equals: false });
    expect(where({ id: 'f', path: 'saldo', operador: 'eq', valor: 0 }).AND[0].saldo).toEqual({ equals: 0 });
  });

  it('un filtro variable obligatorio sin valor sigue dando 400 al ejecutar', () => {
    expect(mensaje(() => plan([{ id: 'v', path: 'saldo', operador: 'gt', variable: true, obligatorio: true, labelVariable: 'Saldo' }], {}))).toContain('es requerido');
  });

  it('los datos adicionales se comparan como texto: [2,4] y ["2","4"] dan lo mismo', () => {
    const textos = where({ id: 'f', path: 'camposAdicionales.categoria_aysa', operador: 'between', valor: ['2', '4'] });
    const numeros = where({ id: 'f', path: 'camposAdicionales.categoria_aysa', operador: 'between', valor: [2, 4] });
    expect(numeros).toEqual(textos);
    expect(where({ id: 'f', path: 'camposAdicionales.c', operador: 'eq', valor: 3 })).toEqual({ AND: [{ camposAdicionales: { path: '$.c', equals: '3' } }] });
    expect(where({ id: 'f', path: 'camposAdicionales.c', operador: 'neq', valor: 3 })).toEqual({ AND: [{ NOT: { camposAdicionales: { path: '$.c', equals: '3' } } }] });
    expect(where({ id: 'f', path: 'camposAdicionales.c', operador: 'in', valor: [1, 2] })).toEqual({
      AND: [{ OR: [{ camposAdicionales: { path: '$.c', equals: '1' } }, { camposAdicionales: { path: '$.c', equals: '2' } }] }],
    });
    expect(where({ id: 'f', path: 'camposAdicionales.c', operador: 'gte', valor: 5 })).toEqual({ AND: [{ camposAdicionales: { path: '$.c', gte: '5' } }] });
  });

  it('una fecha mal escrita en un filtro que se resuelve en memoria da 400 (antes comparaba false)', () => {
    expect(mensaje(() => plan([{ id: 'f', path: 'pagos[origen=MANUAL].fecha', operador: 'gte', valor: 'hoy-90', labelVariable: 'Pagó desde' }]))).toBe(
      'Fecha inválida en el filtro «Pagó desde». Usá el formato AAAA-MM-DD',
    );
  });

  it('el mensaje de fecha inválida no lleva el valor escrito', () => {
    const m = mensaje(() => plan([{ id: 'f', path: 'createdAt', operador: 'gte', valor: 'ayer-por-la-noche', labelVariable: 'Desde' }]));
    expect(m).not.toContain('ayer-por-la-noche');
  });
});

describe('Ordenamientos por columna fija', () => {
  it('se descartan en el plan en vez de armar un orderBy con una clave vacía', () => {
    const p = planner.planQuery({
      columnas: [{ id: 'c', path: 'documento', label: 'DNI' }],
      ordenamientos: [{ path: '', direccion: 'asc' }],
    } as any);
    expect(p.orderBy).toBeUndefined();
    const q = planner.planQuery({
      columnas: [{ id: 'c', path: 'documento', label: 'DNI' }],
      ordenamientos: [{ path: '', direccion: 'asc' }, { path: 'saldo', direccion: 'desc' }],
    } as any);
    expect(q.orderBy).toEqual([{ saldo: 'desc' }]);
  });
});

describe('ronda 3 de la auditoría', () => {
  it('«Cantidad» con «Entre» y un solo extremo es un rango abierto, no un 400', () => {
    const p = plan([{ id: 'f', path: 'contactos[count]', operador: 'between', valor: [1, null] }]);
    expect(p.postProcessingFilters).toEqual([expect.objectContaining({ path: 'contactos[count]', operador: 'between', valor: [1, null] })]);
    expect(evaluarCondicion(2, 'between', [1, null])).toBe(true);
    expect(evaluarCondicion(0, 'between', [1, null])).toBe(false);
    const fuera = plan([{ id: 'f', path: 'contactos[count]', operador: 'notBetween', variable: true }], { f: ['', 3] });
    expect(fuera.postProcessingFilters[0].valor).toEqual([null, 3]);
    // Un texto que no es número sigue siendo un error.
    expect(mensaje(() => plan([{ id: 'f', path: 'contactos[count]', operador: 'between', valor: ['uno', null] }]))).toContain('tiene que ser un número');
  });
});
