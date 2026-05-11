import { CardinalityResolver } from './cardinality';

describe('CardinalityResolver', () => {
  let resolver: CardinalityResolver;

  beforeEach(() => {
    resolver = new CardinalityResolver();
  });

  describe('resolve - primero', () => {
    it('debe retornar el primer elemento', () => {
      const items = [{ valor: 'email1@test.com' }, { valor: 'email2@test.com' }];
      const resultado = resolver.resolve(items, 'valor', { tipo: 'primero' });
      expect(resultado).toBe('email1@test.com');
    });

    it('debe retornar null si array vacío', () => {
      const resultado = resolver.resolve([], 'valor', { tipo: 'primero' });
      expect(resultado).toBe(null);
    });

    it('debe retornar el objeto completo si no se especifica campo', () => {
      const items = [{ id: 1, valor: 'test' }];
      const resultado = resolver.resolve(items, null, { tipo: 'primero' });
      expect(resultado).toEqual({ id: 1, valor: 'test' });
    });
  });

  describe('resolve - ultimo', () => {
    it('debe retornar el último elemento', () => {
      const items = [{ valor: 'tel1' }, { valor: 'tel2' }, { valor: 'tel3' }];
      const resultado = resolver.resolve(items, 'valor', { tipo: 'ultimo' });
      expect(resultado).toBe('tel3');
    });

    it('debe retornar el más reciente por fecha', () => {
      const items = [
        { valor: 'comentario1', fecha: '2026-01-01' },
        { valor: 'comentario2', fecha: '2026-05-01' },
        { valor: 'comentario3', fecha: '2026-03-01' },
      ];
      const resultado = resolver.resolve(items, 'valor', { tipo: 'ultimo' });
      expect(resultado).toBe('comentario2');
    });

    it('debe retornar null si array vacío', () => {
      const resultado = resolver.resolve([], 'valor', { tipo: 'ultimo' });
      expect(resultado).toBe(null);
    });
  });

  describe('resolve - concatenar', () => {
    it('debe concatenar valores con separador default', () => {
      const items = [{ valor: 'a@test.com' }, { valor: 'b@test.com' }, { valor: 'c@test.com' }];
      const resultado = resolver.resolve(items, 'valor', { tipo: 'concatenar' });
      expect(resultado).toBe('a@test.com, b@test.com, c@test.com');
    });

    it('debe concatenar con separador custom', () => {
      const items = [{ valor: '111' }, { valor: '222' }];
      const resultado = resolver.resolve(items, 'valor', { tipo: 'concatenar', separador: ' | ' });
      expect(resultado).toBe('111 | 222');
    });

    it('debe ignorar valores null', () => {
      const items = [{ valor: 'a' }, { valor: null }, { valor: 'b' }];
      const resultado = resolver.resolve(items, 'valor', { tipo: 'concatenar' });
      expect(resultado).toBe('a, b');
    });

    it('debe retornar null si array vacío', () => {
      const resultado = resolver.resolve([], 'valor', { tipo: 'concatenar' });
      expect(resultado).toBe(null);
    });
  });

  describe('expandRows', () => {
    it('debe retornar filas sin cambios si no hay columnas expandir', () => {
      const filas = [{ nombre: 'Juan', email: 'juan@test.com' }];
      const resultado = resolver.expandRows(filas, []);
      expect(resultado).toEqual(filas);
    });

    it('debe expandir una columna con múltiples valores', () => {
      const filas = [
        {
          nombre: 'Juan',
          emails: ['juan1@test.com', 'juan2@test.com'],
        },
      ];

      // Simulamos que la columna 'emails' tiene cardinalidad expandir
      // El resolver ya debería haber puesto el array en la columna
      const resultado = resolver.expandRows(filas, [{ label: 'emails', path: 'contactos[tipo=email].valor' }]);

      expect(resultado).toHaveLength(2);
      expect(resultado[0]).toEqual({ nombre: 'Juan', emails: 'juan1@test.com' });
      expect(resultado[1]).toEqual({ nombre: 'Juan', emails: 'juan2@test.com' });
    });

    it('debe expandir múltiples columnas (producto cartesiano)', () => {
      const filas = [
        {
          nombre: 'Juan',
          emails: ['email1', 'email2'],
          telefonos: ['tel1', 'tel2'],
        },
      ];

      const resultado = resolver.expandRows(filas, [
        { label: 'emails', path: 'contactos[tipo=email].valor' },
        { label: 'telefonos', path: 'contactos[tipo=telefono].valor' },
      ]);

      // 2 emails x 2 telefonos = 4 filas
      expect(resultado).toHaveLength(4);
      expect(resultado[0]).toMatchObject({ emails: 'email1', telefonos: 'tel1' });
      expect(resultado[1]).toMatchObject({ emails: 'email1', telefonos: 'tel2' });
      expect(resultado[2]).toMatchObject({ emails: 'email2', telefonos: 'tel1' });
      expect(resultado[3]).toMatchObject({ emails: 'email2', telefonos: 'tel2' });
    });

    it('debe zippear (no cartesiano) columnas con el mismo prefijo de path', () => {
      const filas = [
        {
          nombre: 'Juan',
          tipo: ['email', 'email', 'telefono'],
          valor: ['a@x.com', 'b@x.com', '555'],
        },
      ];

      const resultado = resolver.expandRows(filas, [
        { label: 'tipo', path: 'contactos.tipo' },
        { label: 'valor', path: 'contactos.valor' },
      ]);

      expect(resultado).toHaveLength(3);
      expect(resultado[0]).toMatchObject({ tipo: 'email', valor: 'a@x.com' });
      expect(resultado[1]).toMatchObject({ tipo: 'email', valor: 'b@x.com' });
      expect(resultado[2]).toMatchObject({ tipo: 'telefono', valor: '555' });
    });

    it('debe manejar valores null en expansión', () => {
      const filas = [
        {
          nombre: 'Juan',
          emails: null,
        },
      ];

      const resultado = resolver.expandRows(filas, [{ label: 'emails', path: 'contactos.valor' }]);

      expect(resultado).toHaveLength(1);
      expect(resultado[0]).toEqual({ nombre: 'Juan', emails: null });
    });

    it('debe manejar valores vacíos en expansión', () => {
      const filas = [
        {
          nombre: 'Juan',
          emails: [],
        },
      ];

      const resultado = resolver.expandRows(filas, [{ label: 'emails', path: 'contactos.valor' }]);

      expect(resultado).toHaveLength(1);
      // Cuando el array está vacío, se genera una fila con null
      expect(resultado[0]).toEqual({ nombre: 'Juan', emails: null });
    });

    it('debe expandir múltiples filas', () => {
      const filas = [
        { nombre: 'Juan', emails: ['juan1', 'juan2'] },
        { nombre: 'Maria', emails: ['maria1'] },
      ];

      const resultado = resolver.expandRows(filas, [{ label: 'emails', path: 'contactos.valor' }]);

      expect(resultado).toHaveLength(3);
      expect(resultado[0]).toEqual({ nombre: 'Juan', emails: 'juan1' });
      expect(resultado[1]).toEqual({ nombre: 'Juan', emails: 'juan2' });
      expect(resultado[2]).toEqual({ nombre: 'Maria', emails: 'maria1' });
    });
  });
});
