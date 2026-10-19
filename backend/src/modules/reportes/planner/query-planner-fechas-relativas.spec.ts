process.env.TZ = 'America/Argentina/Buenos_Aires';

import { BadRequestException } from '@nestjs/common';
import { QueryPlanner } from './query-planner';
import { DefinicionPlantillaDto } from '../dto/plantilla.dto';
import { validarDefinicion } from '../validador/definicion-validator';
import { evaluarCondicion } from '../executor/evaluar-condicion';

const planner = new QueryPlanner();
const HOY = '2026-10-17';

const def = (filtros: any[]) =>
  ({ columnas: [{ id: 'c1', path: 'documento', label: 'DNI' }], filtros }) as DefinicionPlantillaDto;
const plan = (filtros: any[], vars: Record<string, any> = {}, preview = false, hoy = HOY) =>
  planner.planQuery(def(filtros), vars, preview, hoy);
const where = (filtro: any, vars: Record<string, any> = {}, hoy = HOY) => plan([filtro], vars, false, hoy).where;
const utc = (iso: string) => new Date(iso);

describe('E1 — fechas relativas en filtros', () => {
  describe('campo calendario (deudor.fechaVencimiento)', () => {
    it('"hoy-90" con lte es el día entero de hace 90 días (calendario: 00:00Z a 23:59:59.999Z)', () => {
      expect(where({ id: 'f', path: 'fechaVencimiento', operador: 'lte', valor: 'hoy-90' })).toEqual({
        AND: [{ fechaVencimiento: { lte: utc('2026-07-19T23:59:59.999Z') } }],
      });
    });

    it('da lo mismo que escribir la fecha fija ya resuelta', () => {
      for (const op of ['eq', 'neq', 'gt', 'gte', 'lt', 'lte']) {
        expect(where({ id: 'f', path: 'fechaVencimiento', operador: op, valor: 'hoy-90' })).toEqual(
          where({ id: 'f', path: 'fechaVencimiento', operador: op, valor: '2026-07-19' }),
        );
      }
    });

    it('"hoy" y "hoy+7"', () => {
      expect(where({ id: 'f', path: 'fechaVencimiento', operador: 'eq', valor: 'hoy' })).toEqual({
        AND: [{ fechaVencimiento: { gte: utc('2026-10-17T00:00:00.000Z'), lte: utc('2026-10-17T23:59:59.999Z') } }],
      });
      expect(where({ id: 'f', path: 'fechaVencimiento', operador: 'gte', valor: 'hoy+7' })).toEqual({
        AND: [{ fechaVencimiento: { gte: utc('2026-10-24T00:00:00.000Z') } }],
      });
    });

    it('between con las dos puntas relativas', () => {
      expect(where({ id: 'f', path: 'fechaVencimiento', operador: 'between', valor: ['hoy-7', 'hoy'] })).toEqual({
        AND: [{ fechaVencimiento: { gte: utc('2026-10-10T00:00:00.000Z'), lte: utc('2026-10-17T23:59:59.999Z') } }],
      });
    });

    it('between mezclando una fecha fija y una relativa', () => {
      expect(where({ id: 'f', path: 'fechaVencimiento', operador: 'between', valor: ['2026-01-01', 'hoy'] })).toEqual({
        AND: [{ fechaVencimiento: { gte: utc('2026-01-01T00:00:00.000Z'), lte: utc('2026-10-17T23:59:59.999Z') } }],
      });
    });

    it('rango abierto: una punta relativa y la otra vacía', () => {
      expect(where({ id: 'f', path: 'fechaVencimiento', operador: 'between', valor: ['hoy-30', ''] })).toEqual({
        AND: [{ fechaVencimiento: { gte: utc('2026-09-17T00:00:00.000Z') } }],
      });
      expect(where({ id: 'f', path: 'fechaVencimiento', operador: 'notBetween', valor: [null, 'hoy-30'] })).toEqual({
        AND: [{ NOT: { fechaVencimiento: { lte: utc('2026-09-17T23:59:59.999Z') } } }],
      });
    });
  });

  describe('campo instante (createdAt): el día es el día local', () => {
    it('"hoy" abarca de 00:00 a 23:59:59.999 locales', () => {
      expect(where({ id: 'f', path: 'createdAt', operador: 'eq', valor: 'hoy' })).toEqual({
        AND: [{ createdAt: { gte: new Date(2026, 9, 17, 0, 0, 0, 0), lte: new Date(2026, 9, 17, 23, 59, 59, 999) } }],
      });
    });
  });

  describe('variables y valores por defecto', () => {
    const variable = { id: 'f', path: 'fechaVencimiento', operador: 'lte', variable: true, valorPorDefecto: 'hoy-90' };

    it('valorPorDefecto relativo', () => {
      expect(where(variable)).toEqual({ AND: [{ fechaVencimiento: { lte: utc('2026-07-19T23:59:59.999Z') } }] });
    });

    it('el valor que manda quien ejecuta puede ser relativo', () => {
      expect(where(variable, { f: 'hoy-30' })).toEqual({ AND: [{ fechaVencimiento: { lte: utc('2026-09-17T23:59:59.999Z') } }] });
    });

    it('el valor que manda quien ejecuta puede ser una fecha fija', () => {
      expect(where(variable, { f: '2026-05-05' })).toEqual({ AND: [{ fechaVencimiento: { lte: utc('2026-05-05T23:59:59.999Z') } }] });
    });

    it('valorPorDefecto de un between relativo', () => {
      const f = { id: 'f', path: 'fechaVencimiento', operador: 'between', variable: true, valorPorDefecto: ['hoy-7', 'hoy'] };
      expect(where(f)).toEqual({
        AND: [{ fechaVencimiento: { gte: utc('2026-10-10T00:00:00.000Z'), lte: utc('2026-10-17T23:59:59.999Z') } }],
      });
    });

    it('también en el preview', () => {
      const p = plan([variable], {}, true);
      expect(p.where).toEqual({ AND: [{ fechaVencimiento: { lte: utc('2026-07-19T23:59:59.999Z') } }] });
    });
  });

  describe('el borde del día en Argentina', () => {
    // `hoy` lo calcula el llamador con ymdLocal(); acá se prueba que el planner usa el que le pasan.
    it('23:59 del 16 y 00:00 del 17 resuelven a días distintos', () => {
      const f = { id: 'f', path: 'fechaVencimiento', operador: 'eq', valor: 'hoy' };
      expect(where(f, {}, '2026-10-16')).not.toEqual(where(f, {}, '2026-10-17'));
    });

    it('sin pasar el día, usa el de hoy en hora local (ymdLocal)', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-17T02:59:00.000Z')); // 23:59 AR del 16/10
      try {
        const w = planner.planQuery(def([{ id: 'f', path: 'fechaVencimiento', operador: 'eq', valor: 'hoy' }]), {}).where;
        expect(w).toEqual({
          AND: [{ fechaVencimiento: { gte: utc('2026-10-16T00:00:00.000Z'), lte: utc('2026-10-16T23:59:59.999Z') } }],
        });
        jest.setSystemTime(new Date('2026-10-17T03:00:00.000Z')); // 00:00 AR del 17/10
        const w2 = planner.planQuery(def([{ id: 'f', path: 'fechaVencimiento', operador: 'eq', valor: 'hoy' }]), {}).where;
        expect(w2).toEqual({
          AND: [{ fechaVencimiento: { gte: utc('2026-10-17T00:00:00.000Z'), lte: utc('2026-10-17T23:59:59.999Z') } }],
        });
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('ramas y post-procesado', () => {
    it('una rama (pagos.fecha, calendario) resuelve igual', () => {
      expect(where({ id: 'f', path: 'pagos.fecha', operador: 'gte', valor: 'hoy-30' })).toEqual({
        AND: [{ pagos: { some: { fecha: { gte: utc('2026-09-17T00:00:00.000Z') } } } }],
      });
    });

    it('en el filtro del include de la rama también', () => {
      const p = plan([{ id: 'f', path: 'pagos.fecha', operador: 'gte', valor: 'hoy-30' }]);
      expect(p.include.pagos.where).toEqual({ fecha: { gte: utc('2026-09-17T00:00:00.000Z') } });
    });

    it('un path con modificadores va al post-procesado ya resuelto a YYYY-MM-DD', () => {
      const p = plan([{ id: 'f', path: 'pagos[origen=MANUAL].fecha', operador: 'gte', valor: 'hoy-30' }]);
      expect(p.postProcessingFilters).toHaveLength(1);
      expect(p.postProcessingFilters[0].valor).toBe('2026-09-17');
      expect(p.postProcessingFilters[0].tipoFecha).toBe('calendario');
      // y se compara por día igual que Prisma
      const f = p.postProcessingFilters[0];
      expect(evaluarCondicion(utc('2026-09-17T00:00:00.000Z'), f.operador, f.valor, f.tipoFecha)).toBe(true);
      expect(evaluarCondicion(utc('2026-09-16T00:00:00.000Z'), f.operador, f.valor, f.tipoFecha)).toBe(false);
    });

    it('between en el post-procesado resuelve cada punta', () => {
      const p = plan([{ id: 'f', path: 'comentarios[origen=MANUAL].fecha', operador: 'between', valor: ['hoy-7', 'hoy'] }]);
      expect(p.postProcessingFilters[0].valor).toEqual(['2026-10-10', '2026-10-17']);
      expect(p.postProcessingFilters[0].tipoFecha).toBe('instante');
    });
  });

  describe('lo que no se toca', () => {
    it('un campo que no es fecha con el valor "hoy" sigue siendo un texto', () => {
      expect(where({ id: 'f', path: 'nombre', operador: 'eq', valor: 'hoy' })).toEqual({ AND: [{ nombre: { equals: 'hoy' } }] });
    });

    it('un dato adicional con "hoy" sigue siendo un texto', () => {
      const w = where({ id: 'f', path: 'camposAdicionales.estado', operador: 'eq', valor: 'hoy' });
      expect(JSON.stringify(w)).toContain('"equals":"hoy"');
    });

    it('una fecha fija sigue igual', () => {
      expect(where({ id: 'f', path: 'fechaVencimiento', operador: 'eq', valor: '2026-03-15' })).toEqual({
        AND: [{ fechaVencimiento: { gte: utc('2026-03-15T00:00:00.000Z'), lte: utc('2026-03-15T23:59:59.999Z') } }],
      });
    });
  });

  describe('lo inválido sigue siendo 400', () => {
    const casos = ['hoy-0', 'hoy+0', 'hoy-3651', 'hoy-', 'hoy - 3', 'ayer', 'hoy-90 '.concat('x')];
    it.each(casos)('"%s" en un filtro fijo', (valor) => {
      const llamar = () => plan([{ id: 'f', path: 'fechaVencimiento', operador: 'lte', valor }]);
      expect(llamar).toThrow(BadRequestException);
      expect(llamar).toThrow(/Fecha inválida/);
    });

    it('en una punta de un between', () => {
      expect(() => plan([{ id: 'f', path: 'fechaVencimiento', operador: 'between', valor: ['hoy-0', 'hoy'] }])).toThrow(
        /Fecha inválida/,
      );
    });

    it('en el valor que manda quien ejecuta', () => {
      expect(() =>
        plan([{ id: 'f', path: 'fechaVencimiento', operador: 'lte', variable: true }], { f: 'hoy-4000' }),
      ).toThrow(/Fecha inválida/);
    });

    it('el mensaje no repite lo escrito', () => {
      try {
        plan([{ id: 'f', path: 'fechaVencimiento', operador: 'lte', valor: 'hoy-4000' }]);
        throw new Error('no lanzó');
      } catch (e) {
        expect((e as Error).message).not.toContain('4000');
      }
    });
  });
});

describe('E1 — el validador de la plantilla acepta las relativas', () => {
  const validar = (filtro: any) => () => validarDefinicion(def([filtro]));

  it.each(['hoy', 'hoy-90', 'hoy+7', 'hoy-3650', 'hoy+3650'])('valor "%s" en un filtro fijo', (valor) => {
    expect(validar({ id: 'f', path: 'fechaVencimiento', operador: 'lte', valor })).not.toThrow();
  });

  it('valorPorDefecto de una variable', () => {
    expect(validar({ id: 'f', path: 'fechaVencimiento', operador: 'lte', variable: true, valorPorDefecto: 'hoy-90' })).not.toThrow();
  });

  it('cada punta de un between, abierto o no', () => {
    expect(validar({ id: 'f', path: 'fechaVencimiento', operador: 'between', valor: ['hoy-7', 'hoy'] })).not.toThrow();
    expect(validar({ id: 'f', path: 'fechaVencimiento', operador: 'between', valor: ['hoy-7', ''] })).not.toThrow();
    expect(validar({ id: 'f', path: 'fechaVencimiento', operador: 'notBetween', valor: [null, 'hoy+1'] })).not.toThrow();
    expect(validar({ id: 'f', path: 'fechaVencimiento', operador: 'between', valor: ['2026-01-01', 'hoy'] })).not.toThrow();
  });

  it.each(['hoy-0', 'hoy-3651', 'ayer', 'hoy-90x'])('rechaza "%s"', (valor) => {
    expect(validar({ id: 'f', path: 'fechaVencimiento', operador: 'lte', valor })).toThrow(/Fecha inválida/);
  });

  it('rechaza una punta inválida de un between', () => {
    expect(validar({ id: 'f', path: 'fechaVencimiento', operador: 'between', valor: ['hoy-0', 'hoy'] })).toThrow(/Fecha inválida/);
  });
});
