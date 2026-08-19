import { PathParser } from '../parser/path-parser';
import { PathResolver } from './path-resolver';
import { Formatter } from './formatter';
import { esColumnaFija } from '../columna-fija';
import { cargarFormatosTelefono, columnasAExpandir, prepararColumnas } from './columnas-preparadas';
import { DefinicionPlantillaDto } from '../dto/plantilla.dto';

const parser = new PathParser();

const definicion = (columnas: any[], extra: any = {}): DefinicionPlantillaDto =>
  ({ columnas, filtros: [], ...extra }) as any;

describe('esColumnaFija', () => {
  it('una columna sin path es fija', () => {
    expect(esColumnaFija({ path: '' })).toBe(true);
    expect(esColumnaFija({ path: '   ' })).toBe(true);
    expect(esColumnaFija({})).toBe(true);
  });

  it('una columna con path no lo es', () => {
    expect(esColumnaFija({ path: 'nroCliente' })).toBe(false);
  });
});

describe('prepararColumnas', () => {
  it('no parsea el path de una columna fija', () => {
    const cols = prepararColumnas(
      definicion([{ id: '1', path: '', label: 'telefono2', valorFijo: '' }]),
      parser,
      new Map(),
    );
    expect(cols[0].path).toBeNull();
    expect(cols[0].valorFijo).toBe('');
  });

  it('una columna fija sin valorFijo declarado sale vacía, no undefined', () => {
    const cols = prepararColumnas(definicion([{ id: '1', path: '', label: 'x' }]), parser, new Map());
    expect(cols[0].valorFijo).toBe('');
  });

  it('resuelve el patrón del formato de teléfono del catálogo', () => {
    const cols = prepararColumnas(
      definicion([{ id: '1', path: 'contactos.valor', label: 'tel', tipo: 'telefono', formatoTelefonoId: 5 }]),
      parser,
      new Map([[5, '0{area}{15}{abonado}']]),
    );
    expect(cols[0].formato).toBe('0{area}{15}{abonado}');
  });

  it('la cardinalidad cae al default de la plantilla y después a "primero"', () => {
    const [conDefault] = prepararColumnas(
      definicion([{ id: '1', path: 'contactos.valor', label: 'tel' }], { cardinalidadDefault: 'concatenar' }),
      parser,
      new Map(),
    );
    expect(conDefault.cardinalidad).toBe('concatenar');

    const [sinNada] = prepararColumnas(
      definicion([{ id: '1', path: 'contactos.valor', label: 'tel' }]),
      parser,
      new Map(),
    );
    expect(sinNada.cardinalidad).toBe('primero');
  });
});

describe('cargarFormatosTelefono', () => {
  it('consulta una sola vez los ids usados, sin repetir', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 5, patron: '0{numero}' }]);
    const map = await cargarFormatosTelefono(
      { formato_telefono: { findMany } } as any,
      definicion([
        { id: '1', path: 'a', label: 'a', formatoTelefonoId: 5 },
        { id: '2', path: 'b', label: 'b', formatoTelefonoId: 5 },
      ]),
    );
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({ where: { id: { in: [5] } } });
    expect(map.get(5)).toBe('0{numero}');
  });

  it('no consulta nada si ninguna columna usa formato', async () => {
    const findMany = jest.fn();
    await cargarFormatosTelefono(
      { formato_telefono: { findMany } } as any,
      definicion([{ id: '1', path: 'a', label: 'a' }]),
    );
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('columnasAExpandir', () => {
  it('una columna fija nunca expande, aunque el default de la plantilla sea expandir', () => {
    const cols = columnasAExpandir(
      definicion(
        [
          { id: '1', path: 'contactos.valor', label: 'tel' },
          { id: '2', path: '', label: 'telefono2' },
        ],
        { cardinalidadDefault: 'expandir' },
      ),
    );
    expect(cols).toEqual([{ label: 'tel', path: 'contactos.valor' }]);
  });
});

describe('resolveToFlat con columnas fijas', () => {
  const resolver = new PathResolver();
  const formatter = new Formatter();

  // La estructura que pide Neotel: ocho columnas de teléfono aunque el caso traiga uno solo.
  const columnas = prepararColumnas(
    definicion([
      { id: '1', path: 'contactos.valor', label: 'telefono1', tipo: 'telefono', formatoTelefonoId: 5 },
      { id: '2', path: '', label: 'telefono2' },
      { id: '3', path: '', label: 'telefono3' },
      { id: '4', path: '', label: 'origen', valorFijo: 'AMSA' },
      { id: '5', path: 'nroCliente', label: 'campo1' },
    ]),
    parser,
    new Map([[5, '0{area}{15}{abonado}']]),
  );

  const fila = { nroCliente: '000001182764', contactos: [{ valor: '+5491163525026' }] };

  it('las columnas fijas salen vacías y el resto trae su dato', () => {
    const flat = resolver.resolveToFlat(fila, columnas);
    expect(flat).toEqual({
      telefono1: '+5491163525026',
      telefono2: '',
      telefono3: '',
      origen: 'AMSA',
      campo1: '000001182764',
    });
  });

  it('el formateo posterior no rompe la columna vacía y aplica el patrón al teléfono', () => {
    const flat = resolver.resolveToFlat(fila, columnas);
    const formateada = formatter.formatFila(flat, columnas as any);
    expect(formateada.telefono1).toBe('0111563525026');
    expect(formateada.telefono2).toBe('');
    expect(formateada.origen).toBe('AMSA');
  });
});
