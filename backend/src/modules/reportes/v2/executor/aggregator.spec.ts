import { Aggregator } from './aggregator';

describe('Aggregator', () => {
  let aggregator: Aggregator;

  beforeEach(() => {
    aggregator = new Aggregator();
  });

  describe('sum', () => {
    it('debe sumar valores numéricos correctamente', () => {
      const items = [{ importe: 100 }, { importe: 200 }, { importe: 50 }];
      expect(aggregator.sum(items, 'importe')).toBe(350);
    });

    it('debe ignorar valores null y undefined', () => {
      const items = [{ importe: 100 }, { importe: null }, { importe: undefined }, { importe: 50 }];
      expect(aggregator.sum(items, 'importe')).toBe(150);
    });

    it('debe retornar null para array vacío', () => {
      expect(aggregator.sum([], 'importe')).toBe(null);
    });

    it('debe retornar null si no hay valores numéricos', () => {
      const items = [{ importe: null }, { importe: undefined }];
      expect(aggregator.sum(items, 'importe')).toBe(null);
    });

    it('debe sumar campos anidados', () => {
      const items = [{ pago: { monto: 10 } }, { pago: { monto: 20 } }];
      expect(aggregator.sum(items, 'pago.monto')).toBe(30);
    });
  });

  describe('avg', () => {
    it('debe calcular promedio correctamente', () => {
      const items = [{ importe: 100 }, { importe: 200 }, { importe: 300 }];
      expect(aggregator.avg(items, 'importe')).toBe(200);
    });

    it('debe ignorar valores null', () => {
      const items = [{ importe: 100 }, { importe: null }, { importe: 200 }];
      expect(aggregator.avg(items, 'importe')).toBe(150);
    });

    it('debe retornar null para array vacío', () => {
      expect(aggregator.avg([], 'importe')).toBe(null);
    });

    it('debe retornar null si no hay valores válidos', () => {
      const items = [{ importe: null }, { importe: undefined }];
      expect(aggregator.avg(items, 'importe')).toBe(null);
    });
  });

  describe('count', () => {
    it('debe contar elementos del array', () => {
      const items = [{ a: 1 }, { b: 2 }, { c: 3 }];
      expect(aggregator.count(items)).toBe(3);
    });

    it('debe retornar 0 para array vacío', () => {
      expect(aggregator.count([])).toBe(0);
    });

    it('debe retornar 0 si no es array', () => {
      expect(aggregator.count(null as any)).toBe(0);
      expect(aggregator.count(undefined as any)).toBe(0);
    });
  });

  describe('min', () => {
    it('debe encontrar el mínimo', () => {
      const items = [{ monto: 500 }, { monto: 100 }, { monto: 300 }];
      expect(aggregator.min(items, 'monto')).toBe(100);
    });

    it('debe ignorar nulls', () => {
      const items = [{ monto: 500 }, { monto: null }, { monto: 100 }];
      expect(aggregator.min(items, 'monto')).toBe(100);
    });

    it('debe retornar null para array vacío', () => {
      expect(aggregator.min([], 'monto')).toBe(null);
    });
  });

  describe('max', () => {
    it('debe encontrar el máximo', () => {
      const items = [{ monto: 100 }, { monto: 500 }, { monto: 300 }];
      expect(aggregator.max(items, 'monto')).toBe(500);
    });

    it('debe ignorar nulls', () => {
      const items = [{ monto: 100 }, { monto: null }, { monto: 500 }];
      expect(aggregator.max(items, 'monto')).toBe(500);
    });

    it('debe retornar null para array vacío', () => {
      expect(aggregator.max([], 'monto')).toBe(null);
    });
  });

  describe('first', () => {
    it('debe retornar primer elemento', () => {
      const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
      expect(aggregator.first(items)).toEqual({ id: 1 });
    });

    it('debe retornar null para array vacío', () => {
      expect(aggregator.first([])).toBe(null);
    });
  });

  describe('last', () => {
    it('debe retornar último elemento si no hay campo fecha', () => {
      const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
      expect(aggregator.last(items)).toEqual({ id: 3 });
    });

    it('debe retornar el más reciente por fecha', () => {
      const items = [
        { id: 1, fecha: '2026-01-01' },
        { id: 2, fecha: '2026-05-01' },
        { id: 3, fecha: '2026-03-01' },
      ];
      expect(aggregator.last(items)).toEqual({ id: 2, fecha: '2026-05-01' });
    });

    it('debe retornar el más reciente por createdAt', () => {
      const items = [
        { id: 1, createdAt: new Date('2026-01-01') },
        { id: 2, createdAt: new Date('2026-05-01') },
        { id: 3, createdAt: new Date('2026-03-01') },
      ];
      expect(aggregator.last(items)).toEqual({ id: 2, createdAt: new Date('2026-05-01') });
    });

    it('debe retornar null para array vacío', () => {
      expect(aggregator.last([])).toBe(null);
    });
  });

  describe('concat', () => {
    it('debe concatenar valores con separador default', () => {
      const items = [{ email: 'a@test.com' }, { email: 'b@test.com' }, { email: 'c@test.com' }];
      expect(aggregator.concat(items, 'email')).toBe('a@test.com, b@test.com, c@test.com');
    });

    it('debe concatenar con separador custom', () => {
      const items = [{ tel: '111' }, { tel: '222' }, { tel: '333' }];
      expect(aggregator.concat(items, 'tel', ' | ')).toBe('111 | 222 | 333');
    });

    it('debe ignorar valores null', () => {
      const items = [{ email: 'a@test.com' }, { email: null }, { email: 'b@test.com' }];
      expect(aggregator.concat(items, 'email')).toBe('a@test.com, b@test.com');
    });

    it('debe retornar null para array vacío', () => {
      expect(aggregator.concat([], 'email')).toBe(null);
    });

    it('debe retornar null si todos los valores son null', () => {
      const items = [{ email: null }, { email: undefined }];
      expect(aggregator.concat(items, 'email')).toBe(null);
    });
  });
});
