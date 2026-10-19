import { BadRequestException } from '@nestjs/common';
import { evaluarCondicion } from './evaluar-condicion';

describe('evaluarCondicion (post-procesado)', () => {
  it('un operador desconocido lanza en vez de devolver true (el filtro no filtraba)', () => {
    expect(() => evaluarCondicion(5, 'rangoClaves', ['a', 'b'])).toThrow(BadRequestException);
    expect(() => evaluarCondicion(5, 'xyz', 1)).toThrow(/no soporta el operador: xyz/);
  });

  it('notBetween existía en el editor pero no acá: caía en el default y no filtraba', () => {
    expect(evaluarCondicion(5, 'notBetween', [1, 10])).toBe(false);
    expect(evaluarCondicion(50, 'notBetween', [1, 10])).toBe(true);
  });

  it('between exige dos valores', () => {
    expect(evaluarCondicion(5, 'between', [1, 10])).toBe(true);
    expect(() => evaluarCondicion(5, 'between', [1])).toThrow(BadRequestException);
    expect(() => evaluarCondicion(5, 'notBetween', 3)).toThrow(BadRequestException);
  });

  it('los operadores de siempre siguen igual', () => {
    expect(evaluarCondicion('abc', 'contains', 'B')).toBe(true);
    expect(evaluarCondicion(3, 'in', [1, 3])).toBe(true);
    expect(evaluarCondicion(null, 'isNull', undefined)).toBe(true);
    expect(evaluarCondicion(0, 'eq', 0)).toBe(true);
  });
});
