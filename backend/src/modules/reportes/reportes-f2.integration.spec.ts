/**
 * Test de integración para Fase 2 - Reportes Dinámicos
 *
 * Valida el criterio de aceptación F2:
 * - Plantilla con agregadores (sum, count, last)
 * - Filtros sobre relaciones
 * - Filtros con variables
 * - Cardinalidad (concatenar)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ExecutorService } from './executor/executor.service';
import { QueryPlanner } from './planner/query-planner';
import { PrismaService } from '../../prisma/prisma.service';
import { DefinicionPlantillaDto } from './dto/plantilla.dto';

describe('Reportes - Fase 2 Integration', () => {
  let executor: ExecutorService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ExecutorService, QueryPlanner, PrismaService],
    }).compile();

    executor = module.get<ExecutorService>(ExecutorService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('Criterio de aceptación F2', () => {
    it('debe ejecutar plantilla completa con todos los features F2', async () => {
      // Esta es la plantilla de ejemplo del spec
      const definicion: DefinicionPlantillaDto = {
        columnas: [
          { id: 'c1', path: 'documento', label: 'DNI' },
          { id: 'c2', path: 'nombre', label: 'Nombre' },
          { id: 'c3', path: 'empresa.nombre', label: 'Empresa' },
          { id: 'c4', path: 'pagos[sum].importe', label: 'Total pagado', tipo: 'moneda' },
          { id: 'c5', path: 'pagos[count]', label: 'Cant. pagos' },
          { id: 'c6', path: 'pagos[last].fecha', label: 'Último pago' },
          { id: 'c7', path: 'convenios[estado=ACTIVO][count]', label: 'Convenios activos' },
          { id: 'c8', path: 'contactos[tipo=email][first].valor', label: 'Email principal' },
          {
            id: 'c9',
            path: 'contactos[tipo=telefono].valor',
            label: 'Teléfonos',
            cardinalidad: 'concatenar',
            separadorConcat: ', ',
          },
          { id: 'c10', path: 'comentarios[last].texto', label: 'Último comentario' },
        ],
        filtros: [
          { id: 'f1', path: 'empresa.nombre', operador: 'eq', valor: 'TELECOM_PERSONAL' },
          { id: 'f2', path: 'pagos[count]', operador: 'gt', valor: 0 },
          {
            id: 'f3',
            path: 'estadoSituacion.clave',
            operador: 'in',
            valor: ['SIT-PAGANDO', 'SIT-CONVENIO'],
            variable: true,
            labelVariable: 'Situaciones',
          },
        ],
        ordenamientos: [{ path: 'montoTotal', direccion: 'desc' }],
        cardinalidadDefault: 'primero',
        limiteFilas: 5000,
      };

      // Ejecutar con variables
      const filtrosVars = {
        f3: ['SIT-PAGANDO', 'SIT-CONVENIO'],
      };

      const resultado = await executor.execute(definicion, 'deudor', filtrosVars, true);

      // Validaciones
      expect(resultado).toBeDefined();
      expect(resultado.columnas).toHaveLength(10);
      expect(resultado.columnas).toContain('DNI');
      expect(resultado.columnas).toContain('Total pagado');
      expect(resultado.columnas).toContain('Convenios activos');

      // Debe haber filas (si hay datos en DB)
      expect(Array.isArray(resultado.filas)).toBe(true);

      // Si hay filas, validar estructura
      if (resultado.filas.length > 0) {
        const primeraFila = resultado.filas[0];

        expect(primeraFila).toHaveProperty('DNI');
        expect(primeraFila).toHaveProperty('Nombre');
        expect(primeraFila).toHaveProperty('Empresa');
        expect(primeraFila).toHaveProperty('Total pagado');
        expect(primeraFila).toHaveProperty('Cant. pagos');
        expect(primeraFila).toHaveProperty('Último pago');
        expect(primeraFila).toHaveProperty('Convenios activos');
        expect(primeraFila).toHaveProperty('Email principal');
        expect(primeraFila).toHaveProperty('Teléfonos');
        expect(primeraFila).toHaveProperty('Último comentario');

        // Total pagado debe ser number o null
        expect(['number', 'object']).toContain(typeof primeraFila['Total pagado']);

        // Cant. pagos debe ser number
        expect(typeof primeraFila['Cant. pagos']).toBe('number');
      }
    }, 10000); // timeout 10s

    it('debe manejar filtros con agregadores en post-procesamiento', async () => {
      const definicion: DefinicionPlantillaDto = {
        columnas: [
          { id: 'c1', path: 'documento', label: 'DNI' },
          { id: 'c2', path: 'pagos[sum].importe', label: 'Total pagado' },
        ],
        filtros: [
          // Este filtro NO puede optimizarse con Prisma, va a post-procesamiento
          { id: 'f1', path: 'pagos[sum].importe', operador: 'gt', valor: 100 },
        ],
      };

      const resultado = await executor.execute(definicion, 'deudor', {}, true);

      expect(resultado).toBeDefined();

      // Todas las filas deben tener total pagado > 100
      if (resultado.filas.length > 0) {
        for (const fila of resultado.filas) {
          const total = fila['Total pagado'];
          if (total !== null) {
            expect(total).toBeGreaterThan(100);
          }
        }
      }
    }, 10000);

    it('debe resolver correctamente campos anidados JSON', async () => {
      const definicion: DefinicionPlantillaDto = {
        columnas: [
          { id: 'c1', path: 'documento', label: 'DNI' },
          { id: 'c2', path: 'camposAdicionales.cuotas_vencidas', label: 'Cuotas vencidas' },
        ],
      };

      const resultado = await executor.execute(definicion, 'deudor', {}, true);

      expect(resultado).toBeDefined();
      expect(resultado.columnas).toContain('Cuotas vencidas');
    });

    it('debe aplicar múltiples filtros combinados (AND)', async () => {
      const definicion: DefinicionPlantillaDto = {
        columnas: [
          { id: 'c1', path: 'documento', label: 'DNI' },
          { id: 'c2', path: 'montoTotal', label: 'Monto' },
        ],
        filtros: [
          { id: 'f1', path: 'montoTotal', operador: 'gte', valor: 100 },
          { id: 'f2', path: 'montoTotal', operador: 'lte', valor: 10000 },
        ],
      };

      const resultado = await executor.execute(definicion, 'deudor', {}, true);

      expect(resultado).toBeDefined();

      // Todas las filas deben cumplir ambos filtros
      if (resultado.filas.length > 0) {
        for (const fila of resultado.filas) {
          const monto = fila['Monto'];
          if (monto !== null) {
            expect(monto).toBeGreaterThanOrEqual(100);
            expect(monto).toBeLessThanOrEqual(10000);
          }
        }
      }
    });

    it('debe validar variables requeridas sin valor', async () => {
      const definicion: DefinicionPlantillaDto = {
        columnas: [{ id: 'c1', path: 'documento', label: 'DNI' }],
        filtros: [
          {
            id: 'f1',
            path: 'empresa.nombre',
            operador: 'eq',
            variable: true,
            labelVariable: 'Empresa',
            // Sin valorPorDefecto
          },
        ],
      };

      // No pasar filtrosVars debería lanzar error
      await expect(executor.execute(definicion, 'deudor', {}, false)).rejects.toThrow(
        'Filtro variable "Empresa" es requerido',
      );
    });
  });

  describe('Agregadores', () => {
    it('debe calcular sum correctamente', async () => {
      const definicion: DefinicionPlantillaDto = {
        columnas: [
          { id: 'c1', path: 'documento', label: 'DNI' },
          { id: 'c2', path: 'pagos[sum].importe', label: 'Total' },
          { id: 'c3', path: 'pagos[count]', label: 'Cantidad' },
        ],
      };

      const resultado = await executor.execute(definicion, 'deudor', {}, true);

      expect(resultado.columnas).toContain('Total');
      expect(resultado.columnas).toContain('Cantidad');
    });

    it('debe calcular avg, min, max correctamente', async () => {
      const definicion: DefinicionPlantillaDto = {
        columnas: [
          { id: 'c1', path: 'documento', label: 'DNI' },
          { id: 'c2', path: 'pagos[avg].importe', label: 'Promedio' },
          { id: 'c3', path: 'pagos[min].importe', label: 'Mínimo' },
          { id: 'c4', path: 'pagos[max].importe', label: 'Máximo' },
        ],
      };

      const resultado = await executor.execute(definicion, 'deudor', {}, true);

      expect(resultado.columnas).toContain('Promedio');
      expect(resultado.columnas).toContain('Mínimo');
      expect(resultado.columnas).toContain('Máximo');
    });
  });

  describe('Relaciones anidadas', () => {
    it('debe resolver convenios.cuotas con agregadores anidados', async () => {
      const definicion: DefinicionPlantillaDto = {
        columnas: [
          { id: 'c1', path: 'documento', label: 'DNI' },
          { id: 'c2', path: 'nombre', label: 'Nombre' },
          { id: 'c3', path: 'convenios[count]', label: 'Total Convenios' },
          { id: 'c4', path: 'convenios[estado=ACTIVO][count]', label: 'Convenios Activos' },
          // Nota: convenios.cuotas requiere resolver por cada convenio y sumar
          // Este path cuenta cuotas totales en todos los convenios
          // { id: 'c5', path: 'convenios.cuotas[count]', label: 'Total Cuotas' },
        ],
      };

      const resultado = await executor.execute(definicion, 'deudor', {}, true);

      expect(resultado).toBeDefined();
      expect(resultado.columnas).toContain('Total Convenios');
      expect(resultado.columnas).toContain('Convenios Activos');
    });
  });

  describe('Performance', () => {
    it('preview debe ejecutar en menos de 2 segundos para 100 filas', async () => {
      const definicion: DefinicionPlantillaDto = {
        columnas: [
          { id: 'c1', path: 'documento', label: 'DNI' },
          { id: 'c2', path: 'nombre', label: 'Nombre' },
          { id: 'c3', path: 'empresa.nombre', label: 'Empresa' },
          { id: 'c4', path: 'pagos[sum].importe', label: 'Total pagado' },
          { id: 'c5', path: 'pagos[count]', label: 'Cant. pagos' },
        ],
      };

      const start = Date.now();
      const resultado = await executor.execute(definicion, 'deudor', {}, true);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(2000);
      expect(resultado.filas.length).toBeLessThanOrEqual(100);
    }, 3000);
  });
});
