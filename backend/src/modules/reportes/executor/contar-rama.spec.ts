import { PathParser } from '../parser/path-parser';
import { contarRama, terminaEnCount } from './contar-rama';
import { PathResolver } from './path-resolver';
import { evaluarCondicion } from './evaluar-condicion';

const parser = new PathParser();
const ast = (p: string) => parser.parse(p);

describe('contarRama', () => {
  const sinConvenios = { convenios: [] };
  const unoVacioYUnoConDos = { convenios: [{ cuotas: [] }, { cuotas: [{ estado: 'PAGADA' }, { estado: 'PENDIENTE' }] }] };

  it('cuenta el total de la última rama sumando todos los elementos de la del medio', () => {
    expect(contarRama(unoVacioYUnoConDos, ast('convenios.cuotas[count]'))).toBe(2);
  });

  it('sin elementos en la rama del medio es 0 (antes daba null y el caso desaparecía de = 0 y de > 0)', () => {
    expect(contarRama(sinConvenios, ast('convenios.cuotas[count]'))).toBe(0);
    expect(contarRama({}, ast('convenios.cuotas[count]'))).toBe(0);
  });

  it('el primer convenio sin cuotas no tapa a los demás (cardinalidad "primero" miraba solo el primero)', () => {
    const resolver = new PathResolver();
    const viejo = resolver.resolve(unoVacioYUnoConDos, ast('convenios.cuotas[count]'));
    expect(viejo).not.toBe(2);
    expect(contarRama(unoVacioYUnoConDos, ast('convenios.cuotas[count]'))).toBe(2);
  });

  it('aplica los [campo=valor] de cada tramo, sin distinguir mayúsculas', () => {
    expect(contarRama(unoVacioYUnoConDos, ast('convenios.cuotas[estado=pagada][count]'))).toBe(1);
    expect(contarRama({ contactos: [{ tipo: 'telefono' }, { tipo: 'email' }] }, ast('contactos[tipo=telefono][count]'))).toBe(1);
  });

  it('en un nivel da lo mismo que el resolver de siempre', () => {
    const resolver = new PathResolver();
    const fila = { pagos: [{ importe: 1 }, { importe: 2 }, { importe: 3 }] };
    expect(contarRama(fila, ast('pagos[count]'))).toBe(resolver.resolve(fila, ast('pagos[count]')));
  });

  it('no modifica la fila', () => {
    const fila = { contactos: [{ tipo: 'telefono' }, { tipo: 'email' }] };
    contarRama(fila, ast('contactos[tipo=telefono][count]'));
    expect(fila.contactos).toHaveLength(2);
  });

  it('terminaEnCount', () => {
    expect(terminaEnCount(ast('convenios.cuotas[count]'))).toBe(true);
    expect(terminaEnCount(ast('pagos[sum].importe'))).toBe(false);
  });

  it('combinado con el evaluador: = 0 y > 0 sobre los tres casos', () => {
    const casos = [sinConvenios, { convenios: [{ cuotas: [] }] }, unoVacioYUnoConDos];
    const cantidades = casos.map((c) => contarRama(c, ast('convenios.cuotas[count]')));
    expect(cantidades.map((n) => evaluarCondicion(n, 'eq', 0))).toEqual([true, true, false]);
    expect(cantidades.map((n) => evaluarCondicion(n, 'gt', 0))).toEqual([false, false, true]);
    expect(cantidades.map((n) => evaluarCondicion(n, 'gte', 2))).toEqual([false, false, true]);
  });
});
