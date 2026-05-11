import { PathParser } from './path-parser';

describe('PathParser', () => {
  let parser: PathParser;

  beforeEach(() => {
    parser = new PathParser();
  });

  describe('Paths válidos simples', () => {
    it('debería parsear path escalar simple', () => {
      const result = parser.parse('documento');
      expect(result.segments).toHaveLength(1);
      expect(result.segments[0].name).toBe('documento');
      expect(result.segments[0].modifiers).toHaveLength(0);
    });

    it('debería parsear path con relación 1-1', () => {
      const result = parser.parse('empresa.nombre');
      expect(result.segments).toHaveLength(2);
      expect(result.segments[0].name).toBe('empresa');
      expect(result.segments[1].name).toBe('nombre');
    });

    it('debería parsear path con relación anidada', () => {
      const result = parser.parse('estadoSituacion.descripcion');
      expect(result.segments).toHaveLength(2);
      expect(result.segments[0].name).toBe('estadoSituacion');
      expect(result.segments[1].name).toBe('descripcion');
    });

    it('debería parsear path con acceso JSON', () => {
      const result = parser.parse('camposAdicionales.cuotas_vencidas');
      expect(result.segments).toHaveLength(2);
      expect(result.segments[0].name).toBe('camposAdicionales');
      expect(result.segments[1].name).toBe('cuotas_vencidas');
    });
  });

  describe('Paths con agregadores', () => {
    it('debería parsear agregador sum', () => {
      const result = parser.parse('pagos[sum].importe');
      expect(result.segments).toHaveLength(2);
      expect(result.segments[0].name).toBe('pagos');
      expect(result.segments[0].modifiers).toHaveLength(1);
      expect(result.segments[0].modifiers[0]).toEqual({
        type: 'aggregator',
        aggregator: 'sum',
      });
      expect(result.segments[1].name).toBe('importe');
    });

    it('debería parsear agregador count sin campo escalar', () => {
      const result = parser.parse('convenios[count]');
      expect(result.segments).toHaveLength(1);
      expect(result.segments[0].name).toBe('convenios');
      expect(result.segments[0].modifiers[0]).toEqual({
        type: 'aggregator',
        aggregator: 'count',
      });
    });

    it('debería parsear agregador first', () => {
      const result = parser.parse('pagos[first].fecha');
      expect(result.segments[0].modifiers[0]).toEqual({
        type: 'aggregator',
        aggregator: 'first',
      });
    });

    it('debería parsear agregador last', () => {
      const result = parser.parse('comentarios[last].texto');
      expect(result.segments[0].modifiers[0]).toEqual({
        type: 'aggregator',
        aggregator: 'last',
      });
    });

    it('debería parsear agregador concat', () => {
      const result = parser.parse('contactos[concat].valor');
      expect(result.segments[0].modifiers[0]).toEqual({
        type: 'aggregator',
        aggregator: 'concat',
      });
    });

    it('debería parsear agregadores avg, min, max', () => {
      expect(parser.parse('pagos[avg].importe').segments[0].modifiers[0]).toEqual({
        type: 'aggregator',
        aggregator: 'avg',
      });
      expect(parser.parse('facturas[min].importe').segments[0].modifiers[0]).toEqual({
        type: 'aggregator',
        aggregator: 'min',
      });
      expect(parser.parse('facturas[max].importe').segments[0].modifiers[0]).toEqual({
        type: 'aggregator',
        aggregator: 'max',
      });
    });
  });

  describe('Paths con filtros', () => {
    it('debería parsear filtro simple', () => {
      const result = parser.parse('contactos[tipo=email].valor');
      expect(result.segments[0].modifiers).toHaveLength(1);
      expect(result.segments[0].modifiers[0]).toEqual({
        type: 'filter',
        filters: [{ field: 'tipo', value: 'email' }],
      });
    });

    it('debería parsear múltiples filtros', () => {
      const result = parser.parse('convenios[estado=ACTIVO,tipo=PAGO_FACIL]');
      expect(result.segments[0].modifiers[0]).toEqual({
        type: 'filter',
        filters: [
          { field: 'estado', value: 'ACTIVO' },
          { field: 'tipo', value: 'PAGO_FACIL' },
        ],
      });
    });

    it('debería parsear filtro seguido de agregador', () => {
      const result = parser.parse('convenios[estado=ACTIVO][count]');
      expect(result.segments[0].modifiers).toHaveLength(2);
      expect(result.segments[0].modifiers[0].type).toBe('filter');
      expect(result.segments[0].modifiers[1].type).toBe('aggregator');
    });
  });

  describe('Paths con indexadores', () => {
    it('debería parsear indexador numérico', () => {
      const result = parser.parse('contactos[0].valor');
      expect(result.segments[0].modifiers[0]).toEqual({
        type: 'indexer',
        index: 0,
      });
    });

    it('debería parsear indexador mayor que 0', () => {
      const result = parser.parse('pagos[2].importe');
      expect(result.segments[0].modifiers[0]).toEqual({
        type: 'indexer',
        index: 2,
      });
    });
  });

  describe('Paths inválidos', () => {
    it('debería rechazar path vacío', () => {
      expect(() => parser.parse('')).toThrow('Path vacío');
      expect(() => parser.parse('   ')).toThrow('Path vacío');
    });

    it('debería rechazar path con caracteres inválidos', () => {
      expect(() => parser.parse('campo con espacios')).toThrow('caracteres inválidos');
      expect(() => parser.parse('campo#hash')).toThrow('caracteres inválidos');
      expect(() => parser.parse('campo@arroba')).toThrow('caracteres inválidos');
    });

    it('debería rechazar segmento vacío', () => {
      expect(() => parser.parse('empresa..nombre')).toThrow('Segmento vacío');
      expect(() => parser.parse('.nombre')).toThrow('caracteres inválidos');
    });

    it('debería rechazar modificador desconocido', () => {
      expect(() => parser.parse('campo[invalido]')).toThrow('Modificador desconocido');
    });

    it('debería rechazar filtro mal formado', () => {
      expect(() => parser.parse('campo[tipo]')).toThrow('Modificador desconocido');
      expect(() => parser.parse('campo[=valor]')).toThrow('Filtro mal formado');
    });

    it('debería rechazar nombres de segmento inválidos', () => {
      expect(() => parser.parse('123campo')).toThrow('caracteres inválidos');
    });
  });

  describe('Edge cases', () => {
    it('debería manejar underscores en nombres', () => {
      const result = parser.parse('campos_adicionales.valor_total');
      expect(result.segments[0].name).toBe('campos_adicionales');
      expect(result.segments[1].name).toBe('valor_total');
    });

    it('debería manejar múltiples modificadores consecutivos', () => {
      const result = parser.parse('convenios[estado=ACTIVO][first].cuotas[count]');
      expect(result.segments[0].modifiers).toHaveLength(2);
      expect(result.segments[0].modifiers[0].type).toBe('filter');
      expect(result.segments[0].modifiers[1].type).toBe('aggregator');
      expect(result.segments[1].modifiers).toHaveLength(1);
      expect(result.segments[1].modifiers[0].type).toBe('aggregator');
    });

    it('debería preservar el path raw', () => {
      const path = 'pagos[sum].importe';
      const result = parser.parse(path);
      expect(result.raw).toBe(path);
    });
  });
});
