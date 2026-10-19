import { BadRequestException } from '@nestjs/common';
import { QueryPlanner } from './query-planner';
import { DefinicionPlantillaDto } from '../dto/plantilla.dto';

const planner = new QueryPlanner();

const plan = (filtros: any[], vars: Record<string, any> = {}, preview = false) =>
  planner.planQuery(
    { columnas: [{ id: 'c1', path: 'documento', label: 'DNI' }], filtros } as DefinicionPlantillaDto,
    vars,
    preview,
  );

const mensaje = (fn: () => void): string => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return (e as BadRequestException).message;
  }
  throw new Error('no lanzó');
};

describe('QueryPlanner: operadores (falla 1)', () => {
  it('un operador desconocido da 400 y no descarta el filtro', () => {
    const m = mensaje(() => plan([{ id: 'f', path: 'documento', operador: 'rangoClaves', valor: ['a', 'b'], labelVariable: 'Claves' }]));
    expect(m).toContain('El filtro «Claves» usa un operador que el motor no soporta: rangoClaves');
  });

  it('falla aunque sea un filtro variable que no se completó (no se puede ignorar en silencio)', () => {
    const m = mensaje(() => plan([{ id: 'f', path: 'documento', operador: 'matches', variable: true, obligatorio: false }], {}, true));
    expect(m).toContain('operador que el motor no soporta: matches');
  });

  it('between / notBetween sin un array de 2 dan 400 en vez de desaparecer', () => {
    expect(mensaje(() => plan([{ id: 'f', path: 'saldo', operador: 'between', valor: 5, labelVariable: 'Saldo' }]))).toBe('El filtro «Saldo» necesita dos valores (desde y hasta)');
    expect(mensaje(() => plan([{ id: 'f', path: 'remesa.numeroRemesa', operador: 'notBetween', valor: ['1'] }]))).toContain('necesita dos valores');
  });

  it('between con dos valores sigue armando el rango', () => {
    expect(plan([{ id: 'f', path: 'saldo', operador: 'between', valor: [1, 9] }]).where).toEqual({ AND: [{ saldo: { gte: 1, lte: 9 } }] });
  });
});

describe('QueryPlanner: [campo=valor][count] (falla 2)', () => {
  const conteo = (path: string, operador: string, valor: number) => plan([{ id: 'f', path, operador, valor }]);

  it('contactos[tipo=telefono][count] = 0 son los casos sin TELÉFONO, no los sin ningún contacto', () => {
    expect(conteo('contactos[tipo=telefono][count]', 'eq', 0).where).toEqual({
      AND: [{ contactos: { none: { tipo: 'telefono' } } }],
    });
  });

  it('> 0 pide al menos un teléfono', () => {
    expect(conteo('contactos[tipo=telefono][count]', 'gt', 0).where).toEqual({
      AND: [{ contactos: { some: { tipo: 'telefono' } } }],
    });
  });

  it('varios filtros en el segmento, con booleanos convertidos', () => {
    expect(conteo('contactos[tipo=telefono,whatsapp=true][count]', 'eq', 0).where).toEqual({
      AND: [{ contactos: { none: { tipo: 'telefono', whatsapp: true } } }],
    });
  });

  it('los números se convierten al tipo del campo', () => {
    expect(conteo('contactos[prioridad=1][count]', 'gt', 0).where).toEqual({
      AND: [{ contactos: { some: { prioridad: 1 } } }],
    });
  });

  it('sin filtro en el segmento queda como estaba', () => {
    expect(conteo('pagos[count]', 'eq', 0).where).toEqual({ AND: [{ pagos: { none: {} } }] });
    expect(conteo('pagos[count]', 'gt', 0).where).toEqual({ AND: [{ pagos: { some: {} } }] });
  });

  it('lo que no se puede expresar va a post-procesado (no se descarta ni se simplifica de más)', () => {
    const p = conteo('contactos[tipo=telefono][count]', 'gte', 2);
    expect(p.where).toEqual({});
    expect(p.postProcessingFilters).toHaveLength(1);

    // Filtro por un campo que no es escalar simple (una fecha): tampoco se aproxima a `none: {}`.
    const q = conteo('contactos[createdAt=2026][count]', 'eq', 0);
    expect(q.where).toEqual({});
    expect(q.postProcessingFilters).toHaveLength(1);
  });

  it('un count de una relación anidada cuenta el TOTAL de la última rama (convenios.cuotas)', () => {
    // = 0: ningún convenio tiene cuotas, e incluye a los casos sin convenios.
    expect(conteo('convenios.cuotas[count]', 'eq', 0).where).toEqual({
      AND: [{ convenios: { none: { cuotas: { some: {} } } } }],
    });
    // > 0: algún convenio tiene alguna cuota.
    expect(conteo('convenios.cuotas[count]', 'gt', 0).where).toEqual({
      AND: [{ convenios: { some: { cuotas: { some: {} } } } }],
    });
  });

  it('el filtro [campo=valor] de cada tramo va adentro', () => {
    expect(conteo('convenios[estado=ACTIVO].cuotas[estado=PAGADA][count]', 'eq', 0).where).toEqual({
      AND: [{ convenios: { none: { estado: 'ACTIVO', cuotas: { some: { estado: 'PAGADA' } } } } }],
    });
  });

  it('con otros operadores se cuenta en memoria sobre todos los elementos, no sobre el primero', () => {
    const p = conteo('convenios.cuotas[count]', 'gte', 2);
    expect(p.where).toEqual({});
    expect(p.postProcessingFilters).toEqual([
      { path: 'convenios.cuotas[count]', operador: 'gte', valor: 2, tipoFecha: undefined },
    ]);
  });

  it('la cantidad llega como número aunque venga como texto, y un texto que no es número da 400', () => {
    expect(conteo('pagos[count]', 'eq', '0' as any).where).toEqual({ AND: [{ pagos: { none: {} } }] });
    expect(mensaje(() => conteo('pagos[count]', 'gt', 'muchos' as any))).toContain('tiene que ser un número');
  });
});
