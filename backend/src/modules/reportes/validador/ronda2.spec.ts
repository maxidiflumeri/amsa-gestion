import { BadRequestException } from '@nestjs/common';
import { validarDefinicion } from './definicion-validator';
import { QueryPlanner } from '../planner/query-planner';

const base = { columnas: [{ id: 'c', path: 'documento', label: 'DNI' }] };
const mensaje = (fn: () => void): string => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return (e as BadRequestException).message;
  }
  throw new Error('no lanzó');
};

describe('validarDefinicion: filtros sin valor', () => {
  it('un filtro fijo sin valor da 400 al guardar', () => {
    for (const valor of [undefined, '', [], [null, '']]) {
      expect(mensaje(() => validarDefinicion({ ...base, filtros: [{ id: 'f', path: 'saldo', operador: 'gt', valor, labelVariable: 'Saldo' }] } as any))).toBe('El filtro «Saldo» no tiene valor');
    }
  });

  it('isNull / isNotNull y los variables no necesitan valor', () => {
    expect(() => validarDefinicion({ ...base, filtros: [{ id: 'f', path: 'saldo', operador: 'isNull' }] } as any)).not.toThrow();
    expect(() => validarDefinicion({ ...base, filtros: [{ id: 'f', path: 'saldo', operador: 'gt', variable: true }] } as any)).not.toThrow();
  });
});

describe('validarDefinicion: [count]', () => {
  it('tiene que ir al final y solo se combina con filtros [campo=valor]', () => {
    expect(mensaje(() => validarDefinicion({ columnas: [{ id: 'c', path: 'pagos[count].importe', label: 'X' }] } as any))).toContain('tiene que ir al final');
    expect(mensaje(() => validarDefinicion({ columnas: [{ id: 'c', path: 'pagos[first][count]', label: 'X' }] } as any))).toContain('solo se puede combinar con filtros');
    expect(mensaje(() => validarDefinicion({ columnas: [{ id: 'c', path: 'convenios[0].cuotas[count]', label: 'X' }] } as any))).toContain('solo se puede combinar con filtros');
  });

  it('solo sobre una relación con varios elementos', () => {
    expect(mensaje(() => validarDefinicion({ columnas: [{ id: 'c', path: 'empresa[count]', label: 'X' }] } as any))).toContain('relación con varios elementos');
    expect(() => validarDefinicion({ columnas: [{ id: 'c', path: 'convenios[estado=ACTIVO].cuotas[count]', label: 'X' }] } as any)).not.toThrow();
  });
});

describe('validarDefinicion: ordenamiento por columna fija', () => {
  it('se ignora en vez de dar «El campo «» no existe»', () => {
    expect(() => validarDefinicion({ ...base, ordenamientos: [{ path: '', direccion: 'asc' }] } as any)).not.toThrow();
  });
});

describe('valor por defecto de fecha inválido, guardado antes', () => {
  const filtro = { id: 'v', path: 'fechaVencimiento', operador: 'gte', variable: true, labelVariable: 'Vence desde', valorPorDefecto: 'hoy-90' };
  const definicion = { ...base, filtros: [filtro] } as any;

  it('al guardar se rechaza', () => {
    expect(mensaje(() => validarDefinicion(definicion))).toContain('Fecha inválida en el filtro «Vence desde»');
  });

  it('al ejecutar no frena a quien cargó otra fecha', () => {
    expect(() => validarDefinicion(definicion, 'deudor', { valores: false })).not.toThrow();
    expect(() => new QueryPlanner().planQuery(definicion, { v: '2026-01-01' })).not.toThrow();
  });

  it('y si no cargó ninguna, se usa el por defecto y ahí sí da 400', () => {
    expect(mensaje(() => new QueryPlanner().planQuery(definicion, {}))).toContain('Fecha inválida en el filtro «Vence desde»');
  });
});

describe('ronda 3 de la auditoría', () => {
  it('la fecha de inicio del convenio es una fecha calendario (se carga con un <input type="date">)', () => {
    const { clasificarFecha } = require('./fechas-negocio');
    expect(clasificarFecha('convenio', 'fechaInicio')).toBe('calendario');
    expect(clasificarFecha('convenio', 'createdAt')).toBe('instante');
  });

  it('una lista dentro de los datos adicionales se puede contar (camposAdicionales.codeudores[count])', () => {
    const { validarDefinicion } = require('./definicion-validator');
    expect(() =>
      validarDefinicion(
        { columnas: [{ id: 'c', path: 'camposAdicionales.codeudores[count]', label: 'Codeudores' }], filtros: [] },
        'deudor',
      ),
    ).not.toThrow();
  });
});
