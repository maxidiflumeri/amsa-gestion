import { BadRequestException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { validarDefinicion } from './definicion-validator';
import { FiltroDto } from '../dto/plantilla.dto';

const def = (extra: any = {}, columnas?: any[]) => ({
  columnas: columnas ?? [{ id: 'c1', path: 'documento', label: 'DNI' }],
  ...extra,
});

const mensaje = (fn: () => void): string => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return (e as BadRequestException).message;
  }
  throw new Error('no lanzó');
};

describe('validarDefinicion', () => {
  describe('operadores (falla 1)', () => {
    it('un operador desconocido da 400 con el nombre del filtro y el operador', () => {
      const m = mensaje(() =>
        validarDefinicion(def({ filtros: [{ id: 'f', path: 'documento', operador: 'rangoClaves', valor: 'x', labelVariable: 'Rango de claves' }] }) as any),
      );
      expect(m).toContain('El filtro «Rango de claves» usa un operador que el motor no soporta: rangoClaves');
    });

    it('sin labelVariable nombra el path', () => {
      const m = mensaje(() => validarDefinicion(def({ filtros: [{ id: 'f', path: 'documento', operador: 'like' }] }) as any));
      expect(m).toContain('El filtro «documento» usa un operador que el motor no soporta: like');
    });

    it('el DTO ya no valida el operador: el mensaje llegaba con el prefijo técnico del ValidationPipe', async () => {
      const filtro = plainToInstance(FiltroDto, { id: 'f', path: 'documento', operador: 'rangoClaves', labelVariable: 'Claves' });
      expect(await validate(filtro)).toHaveLength(0);
    });

    it('el DTO sigue aceptando los operadores que el motor implementa', async () => {
      for (const operador of ['eq', 'neq', 'in', 'notIn', 'contains', 'startsWith', 'endsWith', 'gt', 'gte', 'lt', 'lte', 'between', 'notBetween', 'isNull', 'isNotNull']) {
        const filtro = plainToInstance(FiltroDto, { id: 'f', path: 'documento', operador });
        expect(await validate(filtro)).toHaveLength(0);
      }
    });

    it('un between fijo sin dos valores da 400', () => {
      const m = mensaje(() => validarDefinicion(def({ filtros: [{ id: 'f', path: 'saldo', operador: 'between', valor: [5] }] }) as any));
      expect(m).toContain('necesita dos valores');
    });
  });

  describe('fechas (falla 3)', () => {
    it('un valor fijo de fecha mal escrito da 400', () => {
      const m = mensaje(() => validarDefinicion(def({ filtros: [{ id: 'f', path: 'fechaVencimiento', operador: 'gte', valor: 'ayer', labelVariable: 'Vence desde' }] }) as any));
      expect(m).toBe('Fecha inválida en el filtro «Vence desde». Usá el formato AAAA-MM-DD');
    });

    it('una fecha válida pasa', () => {
      expect(() => validarDefinicion(def({ filtros: [{ id: 'f', path: 'fechaVencimiento', operador: 'between', valor: ['2026-01-01', '2026-01-31T03:00:00.000Z'] }] }) as any)).not.toThrow();
    });
  });

  describe('campos que no existen (falla 4)', () => {
    it('una columna con un campo inexistente da 400', () => {
      const m = mensaje(() => validarDefinicion(def({}, [{ id: 'c', path: 'documentoo', label: 'DNI' }]) as any));
      expect(m).toBe('El campo «documentoo» no existe');
    });

    it('un campo inexistente adentro de una relación también', () => {
      const m = mensaje(() => validarDefinicion(def({}, [{ id: 'c', path: 'empresa.nombrecito', label: 'E' }]) as any));
      expect(m).toBe('El campo «empresa.nombrecito» no existe');
    });

    it('un escalar no tiene nada adentro', () => {
      const m = mensaje(() => validarDefinicion(def({}, [{ id: 'c', path: 'nombre.largo', label: 'E' }]) as any));
      expect(m).toBe('El campo «nombre.largo» no existe');
    });

    it('se valida en filtros, ordenamientos, agrupaciones y totales', () => {
      expect(mensaje(() => validarDefinicion(def({ filtros: [{ id: 'f', path: 'nombrex', operador: 'eq', valor: 'a' }] }) as any))).toBe('El campo «nombrex» no existe');
      expect(mensaje(() => validarDefinicion(def({ ordenamientos: [{ path: 'apellidox', direccion: 'asc' }] }) as any))).toBe('El campo «apellidox» no existe');
      expect(mensaje(() => validarDefinicion(def({ agrupaciones: [{ path: 'empresa.xx' }] }) as any))).toBe('El campo «empresa.xx» no existe');
      expect(mensaje(() => validarDefinicion(def({ totales: [{ path: 'saldox', funcion: 'sum' }] }) as any))).toBe('El campo «saldox» no existe');
    });

    it('el campo del [campo=valor] tiene que existir en la relación', () => {
      const m = mensaje(() => validarDefinicion(def({}, [{ id: 'c', path: 'contactos[tpo=telefono].valor', label: 'T' }]) as any));
      expect(m).toBe('El campo «contactos.tpo» no existe');
    });

    it('las columnas fijas (path vacío) son válidas', () => {
      expect(() => validarDefinicion(def({}, [{ id: 'a', path: '', label: 'tel2', valorFijo: '' }, { id: 'b', path: 'documento', label: 'DNI' }]) as any)).not.toThrow();
    });

    it('los datos adicionales aceptan cualquier clave, pero el prefijo tiene que ser el real', () => {
      expect(() => validarDefinicion(def({ filtros: [{ id: 'f', path: 'camposAdicionales.cuota_vencida', operador: 'eq', valor: '1' }] }, [{ id: 'c', path: 'camposAdicionales.plan.cuotas', label: 'Cuotas' }]) as any)).not.toThrow();
      expect(mensaje(() => validarDefinicion(def({}, [{ id: 'c', path: 'camposAdicionale.cuota', label: 'C' }]) as any))).toBe('El campo «camposAdicionale.cuota» no existe');
    });

    it('filtrar por todo el bloque de datos adicionales, sin clave, da 400', () => {
      const m = mensaje(() => validarDefinicion(def({ filtros: [{ id: 'f', path: 'camposAdicionales', operador: 'eq', valor: 'x', labelVariable: 'Adicional' }] }) as any));
      expect(m).toContain('El filtro «Adicional» tiene que apuntar a una clave de los datos adicionales');
    });

    it('agregadores e índices sobre relaciones válidas pasan', () => {
      const columnas = [
        { id: '1', path: 'pagos[count]', label: 'a' },
        { id: '2', path: 'pagos[sum].importe', label: 'b' },
        { id: '3', path: 'contactos[tipo=telefono][0].valor', label: 'c' },
        { id: '4', path: 'convenios.cuotas[count]', label: 'd' },
      ];
      expect(() => validarDefinicion(def({}, columnas) as any)).not.toThrow();
    });
  });

  describe('columnas con el mismo nombre (falla 5)', () => {
    it('da 400 con el nombre repetido', () => {
      const m = mensaje(() => validarDefinicion(def({}, [
        { id: '1', path: 'nombre', label: 'Dato' },
        { id: '2', path: 'apellido', label: 'Dato' },
      ]) as any));
      expect(m).toBe('Hay dos columnas con el nombre «Dato»');
    });

    it('las fijas también cuentan', () => {
      const m = mensaje(() => validarDefinicion(def({}, [
        { id: '1', path: '', label: 'tel' },
        { id: '2', path: '', label: 'tel' },
      ]) as any));
      expect(m).toBe('Hay dos columnas con el nombre «tel»');
    });
  });

  it('sin columnas da 400', () => {
    expect(mensaje(() => validarDefinicion({ columnas: [] } as any))).toBe('La definición debe tener al menos una columna');
  });
});
