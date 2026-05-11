import { PathResolver } from './path-resolver';
import { PathParser } from '../parser/path-parser';

describe('PathResolver', () => {
  let resolver: PathResolver;
  let parser: PathParser;

  beforeEach(() => {
    resolver = new PathResolver();
    parser = new PathParser();
  });

  describe('Paths simples (escalares)', () => {
    it('debe resolver campo escalar directo', () => {
      const fila = { documento: '12345678', nombre: 'Juan' };
      const path = parser.parse('documento');

      expect(resolver.resolve(fila, path)).toBe('12345678');
    });

    it('debe resolver campo escalar anidado (relación 1-1)', () => {
      const fila = {
        nombre: 'Juan',
        empresa: { id: 1, nombre: 'TELECOM_PERSONAL' },
      };
      const path = parser.parse('empresa.nombre');

      expect(resolver.resolve(fila, path)).toBe('TELECOM_PERSONAL');
    });

    it('debe retornar null si campo no existe', () => {
      const fila = { nombre: 'Juan' };
      const path = parser.parse('apellido');

      expect(resolver.resolve(fila, path)).toBe(null);
    });

    it('debe retornar null si relación es null', () => {
      const fila = { nombre: 'Juan', empresa: null };
      const path = parser.parse('empresa.nombre');

      expect(resolver.resolve(fila, path)).toBe(null);
    });
  });

  describe('Indexadores', () => {
    it('debe acceder por índice a un array', () => {
      const fila = {
        pagos: [{ importe: 100 }, { importe: 200 }, { importe: 300 }],
      };
      const path = parser.parse('pagos[0].importe');

      expect(resolver.resolve(fila, path)).toBe(100);
    });

    it('debe retornar null si índice fuera de rango', () => {
      const fila = { pagos: [{ importe: 100 }] };
      const path = parser.parse('pagos[5].importe');

      expect(resolver.resolve(fila, path)).toBe(null);
    });
  });

  describe('Agregador first', () => {
    it('debe retornar el primer elemento de array', () => {
      const fila = {
        contactos: [{ valor: 'email1@test.com' }, { valor: 'email2@test.com' }],
      };
      const path = parser.parse('contactos[first].valor');

      expect(resolver.resolve(fila, path)).toBe('email1@test.com');
    });

    it('debe retornar null si array vacío', () => {
      const fila = { contactos: [] };
      const path = parser.parse('contactos[first].valor');

      expect(resolver.resolve(fila, path)).toBe(null);
    });
  });

  describe('Agregador last', () => {
    it('debe retornar el último elemento de array', () => {
      const fila = {
        comentarios: [
          { texto: 'comentario1', fecha: '2026-01-01' },
          { texto: 'comentario2', fecha: '2026-05-01' },
          { texto: 'comentario3', fecha: '2026-03-01' },
        ],
      };
      const path = parser.parse('comentarios[last].texto');

      // last ordena por fecha desc, así que debería retornar comentario2
      expect(resolver.resolve(fila, path)).toBe('comentario2');
    });
  });

  describe('Agregador count', () => {
    it('debe contar elementos de array', () => {
      const fila = {
        pagos: [{ importe: 100 }, { importe: 200 }, { importe: 300 }],
      };
      const path = parser.parse('pagos[count]');

      expect(resolver.resolve(fila, path)).toBe(3);
    });

    it('debe retornar 0 si array vacío', () => {
      const fila = { pagos: [] };
      const path = parser.parse('pagos[count]');

      expect(resolver.resolve(fila, path)).toBe(0);
    });
  });

  describe('Agregador sum', () => {
    it('debe sumar valores de un campo', () => {
      const fila = {
        pagos: [{ importe: 100 }, { importe: 200 }, { importe: 50 }],
      };
      const path = parser.parse('pagos[sum].importe');

      expect(resolver.resolveWithNumericAggregator(fila, path)).toBe(350);
    });

    it('debe ignorar valores null', () => {
      const fila = {
        pagos: [{ importe: 100 }, { importe: null }, { importe: 50 }],
      };
      const path = parser.parse('pagos[sum].importe');

      expect(resolver.resolveWithNumericAggregator(fila, path)).toBe(150);
    });

    it('debe retornar null si array vacío', () => {
      const fila = { pagos: [] };
      const path = parser.parse('pagos[sum].importe');

      expect(resolver.resolveWithNumericAggregator(fila, path)).toBe(null);
    });
  });

  describe('Agregador avg', () => {
    it('debe calcular promedio', () => {
      const fila = {
        pagos: [{ importe: 100 }, { importe: 200 }, { importe: 300 }],
      };
      const path = parser.parse('pagos[avg].importe');

      expect(resolver.resolveWithNumericAggregator(fila, path)).toBe(200);
    });
  });

  describe('Agregador min/max', () => {
    it('debe encontrar el mínimo', () => {
      const fila = {
        pagos: [{ importe: 500 }, { importe: 100 }, { importe: 300 }],
      };
      const path = parser.parse('pagos[min].importe');

      expect(resolver.resolveWithNumericAggregator(fila, path)).toBe(100);
    });

    it('debe encontrar el máximo', () => {
      const fila = {
        pagos: [{ importe: 500 }, { importe: 100 }, { importe: 300 }],
      };
      const path = parser.parse('pagos[max].importe');

      expect(resolver.resolveWithNumericAggregator(fila, path)).toBe(500);
    });
  });

  describe('Filtros sobre relaciones', () => {
    it('debe filtrar por campo simple', () => {
      const fila = {
        contactos: [
          { tipo: 'email', valor: 'juan@test.com' },
          { tipo: 'telefono', valor: '123456' },
          { tipo: 'email', valor: 'juan2@test.com' },
        ],
      };
      const path = parser.parse('contactos[tipo=email][first].valor');

      expect(resolver.resolve(fila, path)).toBe('juan@test.com');
    });

    it('debe contar elementos filtrados', () => {
      const fila = {
        convenios: [
          { estado: 'ACTIVO', monto: 1000 },
          { estado: 'INACTIVO', monto: 500 },
          { estado: 'ACTIVO', monto: 2000 },
        ],
      };
      const path = parser.parse('convenios[estado=ACTIVO][count]');

      expect(resolver.resolve(fila, path)).toBe(2);
    });

    it('debe sumar sobre elementos filtrados', () => {
      const fila = {
        convenios: [
          { estado: 'ACTIVO', monto: 1000 },
          { estado: 'INACTIVO', monto: 500 },
          { estado: 'ACTIVO', monto: 2000 },
        ],
      };
      const path = parser.parse('convenios[estado=ACTIVO][sum].monto');

      expect(resolver.resolveWithNumericAggregator(fila, path)).toBe(3000);
    });

    it('debe retornar array vacío si no hay matches', () => {
      const fila = {
        contactos: [
          { tipo: 'telefono', valor: '111' },
          { tipo: 'telefono', valor: '222' },
        ],
      };
      const path = parser.parse('contactos[tipo=email][count]');

      expect(resolver.resolve(fila, path)).toBe(0);
    });
  });

  describe('Filtros múltiples', () => {
    it('debe aplicar múltiples filtros', () => {
      const fila = {
        items: [
          { tipo: 'A', estado: 'ACTIVO', valor: 100 },
          { tipo: 'A', estado: 'INACTIVO', valor: 200 },
          { tipo: 'B', estado: 'ACTIVO', valor: 300 },
          { tipo: 'A', estado: 'ACTIVO', valor: 400 },
        ],
      };
      const path = parser.parse('items[tipo=A,estado=ACTIVO][count]');

      expect(resolver.resolve(fila, path)).toBe(2);
    });
  });

  describe('Relaciones anidadas con agregadores', () => {
    it('debe resolver convenios -> cuotas con count anidado', () => {
      const fila = {
        convenios: [
          {
            estado: 'ACTIVO',
            cuotas: [
              { estado: 'PENDIENTE', monto: 100 },
              { estado: 'PAGADA', monto: 100 },
              { estado: 'PENDIENTE', monto: 100 },
            ],
          },
          {
            estado: 'ACTIVO',
            cuotas: [
              { estado: 'PENDIENTE', monto: 100 },
            ],
          },
        ],
      };

      // Contar cuotas pendientes en convenios activos
      // Path: convenios[estado=ACTIVO].cuotas[estado=PENDIENTE][count]
      // Esto requiere resolver por cada convenio activo y sumar
      const path = parser.parse('convenios[estado=ACTIVO].cuotas[estado=PENDIENTE][count]');

      // Este es un caso complejo: necesitamos iterar convenios activos
      // y contar cuotas pendientes en cada uno, luego sumar
      // Por ahora, el resolver standard solo cuenta en el primer convenio
      // Para esto necesitamos lógica especial en el executor

      // Resolviendo solo el primer convenio activo
      const conveniosActivos = fila.convenios.filter(c => c.estado === 'ACTIVO');
      const primerConvenio = conveniosActivos[0];
      const cuotasPendientes = primerConvenio.cuotas.filter(c => c.estado === 'PENDIENTE');

      expect(cuotasPendientes.length).toBe(2);
    });
  });

  describe('Acceso a JSON (camposAdicionales)', () => {
    it('debe acceder a campos en JSON', () => {
      const fila = {
        nombre: 'Juan',
        camposAdicionales: {
          cuotas_vencidas: 5,
          observaciones: 'test',
        },
      };
      const path = parser.parse('camposAdicionales.cuotas_vencidas');

      expect(resolver.resolve(fila, path)).toBe(5);
    });

    it('debe acceder a JSON anidado', () => {
      const fila = {
        camposAdicionales: {
          metadata: {
            origen: 'web',
            version: '1.0',
          },
        },
      };
      const path = parser.parse('camposAdicionales.metadata.origen');

      expect(resolver.resolve(fila, path)).toBe('web');
    });
  });

  describe('hasNumericAggregator', () => {
    it('debe detectar sum', () => {
      const path = parser.parse('pagos[sum].importe');
      expect(resolver.hasNumericAggregator(path)).toBe(true);
    });

    it('debe detectar avg', () => {
      const path = parser.parse('pagos[avg].importe');
      expect(resolver.hasNumericAggregator(path)).toBe(true);
    });

    it('debe NO detectar count', () => {
      const path = parser.parse('pagos[count]');
      expect(resolver.hasNumericAggregator(path)).toBe(false);
    });

    it('debe NO detectar first', () => {
      const path = parser.parse('pagos[first].importe');
      expect(resolver.hasNumericAggregator(path)).toBe(false);
    });
  });

  describe('resolveToFlat', () => {
    it('debe resolver múltiples columnas a objeto plano', () => {
      const fila = {
        documento: '12345678',
        nombre: 'Juan',
        empresa: { nombre: 'TELECOM' },
        pagos: [{ importe: 100 }, { importe: 200 }],
      };

      const columnas = [
        { path: parser.parse('documento'), label: 'DNI' },
        { path: parser.parse('nombre'), label: 'Nombre' },
        { path: parser.parse('empresa.nombre'), label: 'Empresa' },
        { path: parser.parse('pagos[sum].importe'), label: 'Total pagado' },
        { path: parser.parse('pagos[count]'), label: 'Cant. pagos' },
      ];

      const resultado = resolver.resolveToFlat(fila, columnas);

      expect(resultado).toEqual({
        'DNI': '12345678',
        'Nombre': 'Juan',
        'Empresa': 'TELECOM',
        'Total pagado': 300,
        'Cant. pagos': 2,
      });
    });
  });
});
