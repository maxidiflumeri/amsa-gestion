import { QueryPlanner } from './query-planner';
import { DefinicionPlantillaDto } from '../dto/plantilla.dto';

describe('QueryPlanner', () => {
  let planner: QueryPlanner;

  beforeEach(() => {
    planner = new QueryPlanner();
  });

  describe('Filtros básicos', () => {
    it('debe construir where para filtro eq simple', () => {
      const definicion: DefinicionPlantillaDto = {
        columnas: [{ id: 'c1', path: 'documento', label: 'DNI' }],
        filtros: [{ id: 'f1', path: 'documento', operador: 'eq', valor: '12345678' }],
      };

      const plan = planner.planQuery(definicion);

      expect(plan.where).toEqual({
        AND: [{ documento: { equals: '12345678' } }],
      });
    });

    it('debe construir where para filtro in', () => {
      const definicion: DefinicionPlantillaDto = {
        columnas: [{ id: 'c1', path: 'documento', label: 'DNI' }],
        filtros: [{ id: 'f1', path: 'documento', operador: 'in', valor: ['111', '222', '333'] }],
      };

      const plan = planner.planQuery(definicion);

      expect(plan.where).toEqual({
        AND: [{ documento: { in: ['111', '222', '333'] } }],
      });
    });

    it('debe construir where para filtro contains', () => {
      const definicion: DefinicionPlantillaDto = {
        columnas: [{ id: 'c1', path: 'nombre', label: 'Nombre' }],
        filtros: [{ id: 'f1', path: 'nombre', operador: 'contains', valor: 'juan' }],
      };

      const plan = planner.planQuery(definicion);

      expect(plan.where).toEqual({
        AND: [{ nombre: { contains: 'juan' } }],
      });
    });

    it('debe construir where para filtros numéricos', () => {
      const definicion: DefinicionPlantillaDto = {
        columnas: [{ id: 'c1', path: 'montoTotal', label: 'Monto' }],
        filtros: [
          { id: 'f1', path: 'montoTotal', operador: 'gt', valor: 1000 },
          { id: 'f2', path: 'montoTotal', operador: 'lte', valor: 5000 },
        ],
      };

      const plan = planner.planQuery(definicion);

      expect(plan.where).toEqual({
        AND: [
          { montoTotal: { gt: 1000 } },
          { montoTotal: { lte: 5000 } },
        ],
      });
    });

    it('debe construir where para filtro between', () => {
      const definicion: DefinicionPlantillaDto = {
        columnas: [{ id: 'c1', path: 'montoTotal', label: 'Monto' }],
        filtros: [{ id: 'f1', path: 'montoTotal', operador: 'between', valor: [1000, 5000] }],
      };

      const plan = planner.planQuery(definicion);

      expect(plan.where).toEqual({
        AND: [{ montoTotal: { gte: 1000, lte: 5000 } }],
      });
    });

    it('debe construir where para filtros isNull/isNotNull', () => {
      const definicion: DefinicionPlantillaDto = {
        columnas: [{ id: 'c1', path: 'observaciones', label: 'Obs' }],
        filtros: [
          { id: 'f1', path: 'telefono', operador: 'isNotNull', valor: null },
          { id: 'f2', path: 'email', operador: 'isNull', valor: null },
        ],
      };

      const plan = planner.planQuery(definicion);

      expect(plan.where).toEqual({
        AND: [
          { telefono: { not: null } },
          { email: null },
        ],
      });
    });
  });

  describe('Filtros sobre relaciones', () => {
    it('debe construir where anidado para relación 1-1', () => {
      const definicion: DefinicionPlantillaDto = {
        columnas: [{ id: 'c1', path: 'empresa.nombre', label: 'Empresa' }],
        filtros: [{ id: 'f1', path: 'empresa.nombre', operador: 'eq', valor: 'TELECOM_PERSONAL' }],
      };

      const plan = planner.planQuery(definicion);

      expect(plan.where).toEqual({
        AND: [{ empresa: { nombre: { equals: 'TELECOM_PERSONAL' } } }],
      });
    });

    it('debe construir where anidado para múltiples niveles', () => {
      const definicion: DefinicionPlantillaDto = {
        columnas: [{ id: 'c1', path: 'estadoSituacion.clave', label: 'Situación' }],
        filtros: [{ id: 'f1', path: 'estadoSituacion.clave', operador: 'in', valor: ['SIT-PAGANDO', 'SIT-CONVENIO'] }],
      };

      const plan = planner.planQuery(definicion);

      expect(plan.where).toEqual({
        AND: [{ estadoSituacion: { clave: { in: ['SIT-PAGANDO', 'SIT-CONVENIO'] } } }],
      });
    });
  });

  describe('Filtros con agregadores (optimizados)', () => {
    it('debe optimizar pagos[count] > 0 con "some"', () => {
      const definicion: DefinicionPlantillaDto = {
        columnas: [{ id: 'c1', path: 'documento', label: 'DNI' }],
        filtros: [{ id: 'f1', path: 'pagos[count]', operador: 'gt', valor: 0 }],
      };

      const plan = planner.planQuery(definicion);

      expect(plan.where).toEqual({
        AND: [{ pagos: { some: {} } }],
      });
    });

    it('debe optimizar pagos[count] = 0 con "none"', () => {
      const definicion: DefinicionPlantillaDto = {
        columnas: [{ id: 'c1', path: 'documento', label: 'DNI' }],
        filtros: [{ id: 'f1', path: 'pagos[count]', operador: 'eq', valor: 0 }],
      };

      const plan = planner.planQuery(definicion);

      expect(plan.where).toEqual({
        AND: [{ pagos: { none: {} } }],
      });
    });

    it('debe enviar a post-procesamiento filtros con count no optimizables', () => {
      const definicion: DefinicionPlantillaDto = {
        columnas: [{ id: 'c1', path: 'documento', label: 'DNI' }],
        filtros: [{ id: 'f1', path: 'pagos[count]', operador: 'gte', valor: 3 }],
      };

      const plan = planner.planQuery(definicion);

      expect(plan.where).toEqual({});
      expect(plan.postProcessingFilters).toEqual([
        { path: 'pagos[count]', operador: 'gte', valor: 3 },
      ]);
      expect(plan.requiresPostProcessing).toBe(true);
    });

    it('debe enviar a post-procesamiento filtros con sum', () => {
      const definicion: DefinicionPlantillaDto = {
        columnas: [{ id: 'c1', path: 'documento', label: 'DNI' }],
        filtros: [{ id: 'f1', path: 'pagos[sum].importe', operador: 'gt', valor: 1000 }],
      };

      const plan = planner.planQuery(definicion);

      expect(plan.where).toEqual({});
      expect(plan.postProcessingFilters).toEqual([
        { path: 'pagos[sum].importe', operador: 'gt', valor: 1000 },
      ]);
    });
  });

  describe('Variables', () => {
    it('debe resolver variable con valor proporcionado', () => {
      const definicion: DefinicionPlantillaDto = {
        columnas: [{ id: 'c1', path: 'documento', label: 'DNI' }],
        filtros: [
          { id: 'f1', path: 'empresa.nombre', operador: 'eq', variable: true, labelVariable: 'Empresa' },
        ],
      };

      const plan = planner.planQuery(definicion, { f1: 'TELECOM_PERSONAL' });

      expect(plan.where).toEqual({
        AND: [{ empresa: { nombre: { equals: 'TELECOM_PERSONAL' } } }],
      });
    });

    it('debe usar valorPorDefecto si no se proporciona variable', () => {
      const definicion: DefinicionPlantillaDto = {
        columnas: [{ id: 'c1', path: 'documento', label: 'DNI' }],
        filtros: [
          {
            id: 'f1',
            path: 'montoTotal',
            operador: 'gt',
            variable: true,
            valorPorDefecto: 100,
            labelVariable: 'Monto mínimo',
          },
        ],
      };

      const plan = planner.planQuery(definicion, {});

      expect(plan.where).toEqual({
        AND: [{ montoTotal: { gt: 100 } }],
      });
    });

    it('debe lanzar error si variable OBLIGATORIA sin valor ni default', () => {
      const definicion: DefinicionPlantillaDto = {
        columnas: [{ id: 'c1', path: 'documento', label: 'DNI' }],
        filtros: [
          { id: 'f1', path: 'montoTotal', operador: 'gt', variable: true, obligatorio: true, labelVariable: 'Monto mínimo' },
        ],
      };

      expect(() => planner.planQuery(definicion, {})).toThrow(
        'Filtro variable "Monto mínimo" es requerido pero no se proporcionó valor',
      );
    });

    // Este test venía asumiendo que toda variable sin valor era un error. Desde que existe
    // `obligatorio`, una variable opcional sin valor simplemente **no filtra**: es lo que permite
    // ofrecer un filtro que el usuario puede dejar vacío para traer todo.
    it('debe ignorar una variable NO obligatoria sin valor ni default', () => {
      const definicion: DefinicionPlantillaDto = {
        columnas: [{ id: 'c1', path: 'documento', label: 'DNI' }],
        filtros: [
          { id: 'f1', path: 'montoTotal', operador: 'gt', variable: true, labelVariable: 'Monto mínimo' },
        ],
      };

      const plan = planner.planQuery(definicion, {});
      expect(plan.where).toEqual({});
    });

    it('una variable obligatoria con el valor vacío también es un error', () => {
      const definicion: DefinicionPlantillaDto = {
        columnas: [{ id: 'c1', path: 'documento', label: 'DNI' }],
        filtros: [
          { id: 'f1', path: 'montoTotal', operador: 'gt', variable: true, obligatorio: true, labelVariable: 'Monto mínimo' },
        ],
      };

      expect(() => planner.planQuery(definicion, { f1: '' })).toThrow(
        'Filtro variable "Monto mínimo" es requerido pero no se proporcionó valor',
      );
    });
  });

  describe('Filtros de fecha por día completo', () => {
    // `new Date('2026-07-31')` es medianoche UTC: en Argentina, las 21:00 del 30. Sin normalizar,
    // `lte` perdía todo el último día del rango y `gte` metía tres horas del día anterior.
    const conFiltro = (operador: string, valor: any) =>
      planner.planQuery(
        {
          columnas: [{ id: 'c1', path: 'documento', label: 'DNI' }],
          filtros: [{ id: 'f1', path: 'fechaVencimiento', operador, valor }],
        } as DefinicionPlantillaDto,
        {},
      ).where.AND[0].fechaVencimiento;

    const local = (a: number, m: number, d: number, ...resto: number[]) => new Date(a, m - 1, d, ...(resto as [number, number, number, number]));

    it('gte arranca al principio del día local', () => {
      expect(conFiltro('gte', '2026-07-01').gte).toEqual(local(2026, 7, 1, 0, 0, 0, 0));
    });

    it('lte llega hasta el final del día local, no a su medianoche', () => {
      expect(conFiltro('lte', '2026-07-31').lte).toEqual(local(2026, 7, 31, 23, 59, 59, 999));
    });

    it('eq sobre una fecha es el día entero', () => {
      const cond = conFiltro('eq', '2026-07-15');
      expect(cond.gte).toEqual(local(2026, 7, 15, 0, 0, 0, 0));
      expect(cond.lte).toEqual(local(2026, 7, 15, 23, 59, 59, 999));
    });

    it('between toma el día completo en las dos puntas', () => {
      const cond = conFiltro('between', ['2026-07-01', '2026-07-31']);
      expect(cond.gte).toEqual(local(2026, 7, 1, 0, 0, 0, 0));
      expect(cond.lte).toEqual(local(2026, 7, 31, 23, 59, 59, 999));
    });

    it('un valor con hora se respeta tal cual: el llamador ya eligió el instante', () => {
      expect(conFiltro('gte', '2026-07-01T10:30:00Z').gte).toEqual(new Date('2026-07-01T10:30:00Z'));
    });

    it('el último día del rango entra: un registro de ese día a las 00:00 locales queda adentro', () => {
      const lte = conFiltro('lte', '2026-07-31').lte as Date;
      expect(local(2026, 7, 31, 0, 0, 0, 0) <= lte).toBe(true);
    });
  });

  describe('Datos adicionales (columna JSON)', () => {
    // `camposAdicionales.x` no es una relación sino una clave dentro de una columna JSON. Se armaba
    // como `{ camposAdicionales: { x: { equals } } }`, que Prisma rechaza: el selector ofrecía el
    // filtro y la ejecución reventaba con PrismaClientValidationError.
    const conFiltro = (operador: string, valor?: any) =>
      planner.planQuery(
        {
          columnas: [{ id: 'c1', path: 'documento', label: 'DNI' }],
          filtros: [{ id: 'f1', path: 'camposAdicionales.cuotas_vencidas', operador, valor }],
        } as DefinicionPlantillaDto,
        {},
      ).where;

    it('usa la forma { path, equals } que espera Prisma, no un objeto anidado', () => {
      expect(conFiltro('eq', '3')).toEqual({
        AND: [{ camposAdicionales: { path: '$.cuotas_vencidas', equals: '3' } }],
      });
    });

    it('los operadores de texto usan los nombres de Prisma', () => {
      expect(conFiltro('contains', 'ven')).toEqual({
        AND: [{ camposAdicionales: { path: '$.cuotas_vencidas', string_contains: 'ven' } }],
      });
    });

    it('la negación envuelve en NOT, porque el filtro JSON no admite `not` adentro', () => {
      expect(conFiltro('neq', '3')).toEqual({
        AND: [{ NOT: { camposAdicionales: { path: '$.cuotas_vencidas', equals: '3' } } }],
      });
    });

    it('soporta claves anidadas', () => {
      const where = planner.planQuery(
        {
          columnas: [{ id: 'c1', path: 'documento', label: 'DNI' }],
          filtros: [{ id: 'f1', path: 'camposAdicionales.plan.cuotas', operador: 'eq', valor: '6' }],
        } as DefinicionPlantillaDto,
        {},
      ).where;
      expect(where).toEqual({ AND: [{ camposAdicionales: { path: '$.plan.cuotas', equals: '6' } }] });
    });

    it('un operador que no se puede expresar no rompe: cae al post-procesado', () => {
      expect(conFiltro('between', ['1', '5'])).toEqual({});
    });
  });

  describe('Include builder integration', () => {
    it('debe construir include para columnas con relaciones', () => {
      const definicion: DefinicionPlantillaDto = {
        columnas: [
          { id: 'c1', path: 'documento', label: 'DNI' },
          { id: 'c2', path: 'empresa.nombre', label: 'Empresa' },
          { id: 'c3', path: 'pagos[sum].importe', label: 'Total pagado' },
        ],
      };

      const plan = planner.planQuery(definicion);

      expect(plan.include).toEqual({
        empresa: true,
        pagos: true,
      });
    });

    it('debe marcar requiresPostProcessing si hay agregadores', () => {
      const definicion: DefinicionPlantillaDto = {
        columnas: [
          { id: 'c1', path: 'pagos[sum].importe', label: 'Total' },
          { id: 'c2', path: 'convenios[count]', label: 'Convenios' },
        ],
      };

      const plan = planner.planQuery(definicion);

      expect(plan.requiresPostProcessing).toBe(true);
    });
  });

  describe('Ordenamiento y límites', () => {
    it('debe construir orderBy simple', () => {
      const definicion: DefinicionPlantillaDto = {
        columnas: [{ id: 'c1', path: 'montoTotal', label: 'Monto' }],
        ordenamientos: [{ path: 'montoTotal', direccion: 'desc' }],
      };

      const plan = planner.planQuery(definicion);

      expect(plan.orderBy).toEqual([{ montoTotal: 'desc' }]);
    });

    it('debe aplicar límite de filas', () => {
      const definicion: DefinicionPlantillaDto = {
        columnas: [{ id: 'c1', path: 'documento', label: 'DNI' }],
        limiteFilas: 1000,
      };

      const plan = planner.planQuery(definicion);

      expect(plan.take).toBe(1000);
    });
  });
});
