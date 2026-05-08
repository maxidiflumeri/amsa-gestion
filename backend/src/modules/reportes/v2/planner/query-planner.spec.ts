import { QueryPlanner } from './query-planner';
import { DefinicionPlantillaDto } from '../dto/plantilla-v2.dto';

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

    it('debe construir where para filtro contains (case-insensitive)', () => {
      const definicion: DefinicionPlantillaDto = {
        columnas: [{ id: 'c1', path: 'nombre', label: 'Nombre' }],
        filtros: [{ id: 'f1', path: 'nombre', operador: 'contains', valor: 'juan' }],
      };

      const plan = planner.planQuery(definicion);

      expect(plan.where).toEqual({
        AND: [{ nombre: { contains: 'juan', mode: 'insensitive' } }],
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

    it('debe lanzar error si variable requerida sin valor ni default', () => {
      const definicion: DefinicionPlantillaDto = {
        columnas: [{ id: 'c1', path: 'documento', label: 'DNI' }],
        filtros: [
          { id: 'f1', path: 'montoTotal', operador: 'gt', variable: true, labelVariable: 'Monto mínimo' },
        ],
      };

      expect(() => planner.planQuery(definicion, {})).toThrow(
        'Filtro variable "Monto mínimo" es requerido pero no se proporcionó valor',
      );
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
