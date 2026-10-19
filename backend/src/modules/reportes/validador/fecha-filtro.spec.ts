import { FechaInvalidaError, parsearFechaFiltro, validarFechasFiltro } from './fecha-filtro';

describe('parsearFechaFiltro', () => {
  it('acepta YYYY-MM-DD y lo devuelve tal cual (el planner lo abre al día completo)', () => {
    expect(parsearFechaFiltro('2026-07-31')).toBe('2026-07-31');
    expect(parsearFechaFiltro(' 2026-07-31 ')).toBe('2026-07-31');
  });

  it('acepta un ISO completo y devuelve la fecha', () => {
    expect(parsearFechaFiltro('2026-07-31T03:00:00.000Z')).toEqual(new Date('2026-07-31T03:00:00.000Z'));
    expect(parsearFechaFiltro('2026-07-31T10:30')).toBeInstanceOf(Date);
  });

  it('acepta un Date válido', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    expect(parsearFechaFiltro(d)).toBe(d);
  });

  it.each(['hoy-90', 'hoy', '31/07/2026', '2026-7-1', 'ayer', '2026', '12345', '2026-07-31 10:00'])(
    'rechaza "%s": antes terminaba en otra fecha o en 1990',
    (valor) => {
      expect(() => parsearFechaFiltro(valor)).toThrow(FechaInvalidaError);
    },
  );

  it('rechaza días que no existen: JS los corría solo al mes siguiente', () => {
    expect(() => parsearFechaFiltro('2026-02-31')).toThrow(FechaInvalidaError);
    expect(() => parsearFechaFiltro('2026-13-01')).toThrow(FechaInvalidaError);
    expect(() => parsearFechaFiltro('2026-02-31T00:00:00Z')).toThrow(FechaInvalidaError);
    expect(parsearFechaFiltro('2028-02-29')).toBe('2028-02-29');
  });

  it('rechaza números, objetos y Date inválidos', () => {
    expect(() => parsearFechaFiltro(1700000000000)).toThrow(FechaInvalidaError);
    expect(() => parsearFechaFiltro({})).toThrow(FechaInvalidaError);
    expect(() => parsearFechaFiltro(new Date('nada'))).toThrow(FechaInvalidaError);
  });
});

describe('validarFechasFiltro', () => {
  it('revisa cada elemento de una lista y deja pasar los vacíos', () => {
    expect(() => validarFechasFiltro(['2026-01-01', '2026-01-31'])).not.toThrow();
    expect(() => validarFechasFiltro(['2026-01-01', 'hoy-90'])).toThrow(FechaInvalidaError);
    expect(() => validarFechasFiltro(['', null])).not.toThrow();
    expect(() => validarFechasFiltro(undefined)).not.toThrow();
  });
});
