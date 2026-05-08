import { Test } from '@nestjs/testing';
import { GroupingService } from './grouping.service';
import { AgrupacionDto, TotalDto } from '../dto/plantilla-v2.dto';

describe('GroupingService', () => {
  let service: GroupingService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [GroupingService],
    }).compile();

    service = module.get<GroupingService>(GroupingService);
  });

  it('debe aplicar solo totales cuando no hay agrupaciones', () => {
    const filas = [
      { nombre: 'A', monto: 100 },
      { nombre: 'B', monto: 200 },
    ];

    const totales: TotalDto[] = [{ path: 'monto', funcion: 'sum', label: 'Total Monto' }];

    const resultado = service.aplicarAgrupacionYTotales(filas, [], totales, ['nombre', 'Total Monto']);

    expect(resultado.length).toBe(3);
    expect(resultado[0].tipo).toBe('dato');
    expect(resultado[1].tipo).toBe('dato');
    expect(resultado[2].tipo).toBe('total');
    expect(resultado[2].datos['Total Monto']).toBe(300);
  });

  it('debe aplicar agrupación con subtotales', () => {
    const filas = [
      { empresa: 'Telecom', monto: 100 },
      { empresa: 'Telecom', monto: 50 },
      { empresa: 'Claro', monto: 200 },
    ];

    const agrupaciones: AgrupacionDto[] = [{ path: 'empresa', mostrarSubtotales: true }];
    const totales: TotalDto[] = [{ path: 'monto', funcion: 'sum' }];

    const resultado = service.aplicarAgrupacionYTotales(filas, agrupaciones, totales, ['empresa', 'monto']);

    expect(resultado.length).toBeGreaterThan(filas.length);

    const subtotales = resultado.filter(r => r.tipo === 'subtotal');
    expect(subtotales.length).toBe(2);

    const total = resultado.find(r => r.tipo === 'total');
    expect(total).toBeDefined();
    expect(total?.datos.monto).toBe(350);
  });

  it('debe calcular agregaciones correctamente', () => {
    const filas = [
      { categoria: 'A', valor: 10 },
      { categoria: 'A', valor: 20 },
      { categoria: 'A', valor: 30 },
    ];

    const totales: TotalDto[] = [
      { path: 'valor', funcion: 'sum', label: 'Suma' },
      { path: 'valor', funcion: 'avg', label: 'Promedio' },
      { path: 'valor', funcion: 'count', label: 'Cantidad' },
      { path: 'valor', funcion: 'min', label: 'Mínimo' },
      { path: 'valor', funcion: 'max', label: 'Máximo' },
    ];

    const resultado = service.aplicarAgrupacionYTotales(filas, [], totales, [
      'categoria',
      'Suma',
      'Promedio',
      'Cantidad',
      'Mínimo',
      'Máximo',
    ]);

    const total = resultado.find(r => r.tipo === 'total');
    expect(total).toBeDefined();
    expect(total?.datos.Suma).toBe(60);
    expect(total?.datos.Promedio).toBe(20);
    expect(total?.datos.Cantidad).toBe(3);
    expect(total?.datos.Mínimo).toBe(10);
    expect(total?.datos.Máximo).toBe(30);
  });

  it('debe devolver solo datos cuando no hay agrupaciones ni totales', () => {
    const filas = [{ nombre: 'A' }, { nombre: 'B' }];

    const resultado = service.aplicarAgrupacionYTotales(filas, [], [], ['nombre']);

    expect(resultado.length).toBe(2);
    expect(resultado.every(r => r.tipo === 'dato')).toBe(true);
  });
});
