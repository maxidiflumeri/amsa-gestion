import { readFileSync } from 'fs';
import { join } from 'path';
import { BadRequestException } from '@nestjs/common';
import { ExecutorService } from './executor/executor.service';
import { AsyncExecutorService } from './async/async-executor.service';
import { QueryPlanner } from './planner/query-planner';
import { ReportesController } from './reportes.controller';

/**
 * Las validaciones del motor tienen que cortar **antes** de pegarle a la base, en los tres caminos
 * de ejecución (sync / preview, streaming y estimación), y la plantilla de prod tiene que seguir
 * ejecutando.
 */
const plantilla = JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'plantilla-prod-1.json'), 'utf8'));

describe('validaciones al ejecutar', () => {
  let prisma: any;
  let sync: ExecutorService;
  let async_: AsyncExecutorService;

  beforeEach(() => {
    prisma = {
      deudor: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      formato_telefono: { findMany: jest.fn().mockResolvedValue([{ id: 5, patron: '{numero}' }]) },
    };
    sync = new ExecutorService(prisma, new QueryPlanner());
    async_ = new AsyncExecutorService(prisma, new QueryPlanner());
  });

  const mala = (extra: any) => ({ columnas: [{ id: 'c', path: 'documento', label: 'DNI' }], ...extra });

  const casos: Array<[string, any, string]> = [
    ['operador desconocido', mala({ filtros: [{ id: 'f', path: 'documento', operador: 'rangoClaves', valor: 'x', labelVariable: 'Claves' }] }), 'El filtro «Claves» usa un operador que el motor no soporta: rangoClaves'],
    ['campo inexistente', mala({ columnas: [{ id: 'c', path: 'documentos', label: 'DNI' }] }), 'El campo «documentos» no existe'],
    ['columnas repetidas', mala({ columnas: [{ id: 'a', path: 'nombre', label: 'X' }, { id: 'b', path: 'apellido', label: 'X' }] }), 'Hay dos columnas con el nombre «X»'],
  ];

  it.each(casos)('execute (ejecutar y preview) rechaza: %s', async (_n, definicion, texto) => {
    for (const preview of [false, true]) {
      await expect(sync.execute(definicion, 'deudor', {}, preview)).rejects.toThrow(texto);
    }
    expect(prisma.deudor.findMany).not.toHaveBeenCalled();
  });

  it.each(casos)('streaming y estimación rechazan: %s', async (_n, definicion, texto) => {
    await expect(async_.executeStreaming(definicion, { raiz: 'deudor', filtrosVars: {} } as any)).rejects.toThrow(texto);
    await expect(async_.estimarFilas(definicion, 'deudor', {})).rejects.toThrow(texto);
    expect(prisma.deudor.findMany).not.toHaveBeenCalled();
    expect(prisma.deudor.count).not.toHaveBeenCalled();
  });

  it('una fecha mal escrita en un filtro variable corta antes de consultar', async () => {
    const definicion = mala({ filtros: [{ id: 'v', path: 'fechaVencimiento', operador: 'gte', variable: true, labelVariable: 'Vence desde' }] });
    await expect(sync.execute(definicion, 'deudor', { v: 'hoy-90' }, false)).rejects.toThrow('Fecha inválida en el filtro «Vence desde». Usá el formato AAAA-MM-DD');
    expect(prisma.deudor.findMany).not.toHaveBeenCalled();
  });

  it('un post-procesado con operador desconocido no devuelve todo: falla', async () => {
    prisma.deudor.findMany.mockResolvedValue([{ id: 1, pagos: [] }]);
    // El planner ya frena el operador; esto prueba la red de abajo, la del evaluador en memoria.
    const planner = new QueryPlanner();
    jest.spyOn(planner, 'planQuery').mockReturnValue({
      where: {}, include: {}, requiresPostProcessing: true,
      postProcessingFilters: [{ path: 'pagos[count]', operador: 'rangoClaves', valor: 1 }],
    } as any);
    const ejecutor = new ExecutorService(prisma, planner);
    await expect(ejecutor.execute(mala({}), 'deudor', {}, false)).rejects.toThrow(BadRequestException);
  });

  it('convenios.cuotas[count] >= 2 cuenta las cuotas de TODOS los convenios (y 0 si no hay convenios)', async () => {
    prisma.deudor.findMany.mockResolvedValue([
      { id: 1, documento: 'sin-convenios', convenios: [] },
      { id: 2, documento: 'primero-vacio', convenios: [{ cuotas: [] }, { cuotas: [{}, {}] }] },
      { id: 3, documento: 'una', convenios: [{ cuotas: [{}] }] },
    ]);
    const definicion = {
      columnas: [{ id: 'c', path: 'documento', label: 'DNI' }, { id: 'n', path: 'convenios.cuotas[count]', label: 'Cuotas' }],
      filtros: [{ id: 'f', path: 'convenios.cuotas[count]', operador: 'gte', valor: 2 }],
    } as any;
    const r = await sync.execute(definicion, 'deudor', {}, false);
    expect(r.filas).toEqual([{ DNI: 'primero-vacio', Cuotas: '2' }].map((f) => expect.objectContaining({ DNI: f.DNI })));
    expect((r.filas[0] as any).Cuotas).toBeDefined();
    expect(r.totalFilas).toBe(1);
  });

  it('la plantilla de prod ejecuta (con sus filtros variables) y devuelve sus 19 columnas', async () => {
    prisma.deudor.findMany.mockResolvedValue([
      {
        id: 1, nroCliente: 'C1', montoTotal: 100, nombre: 'Ana', apellido: 'Pérez', saldo: 50,
        estadoSituacion: { clave: 'SIT-1' }, estadoGestion: { clave: 'GES-1' },
        empresa: { nombre: 'AYSA', remesa: [{ politicaId: 3 }] }, remesa: { numeroRemesa: '10' },
        contactos: [{ tipo: 'telefono', valor: '+5491163525026', validado: true }],
      },
    ]);
    const vars = {
      '60884e76-a79d-42af-80b1-f884e94ba1e3': 'AYSA',
      'e516b35e-a01d-4388-9038-16af92a6754f': ['10', '20'],
    };
    const r = await sync.execute(plantilla.definicion, plantilla.raiz, vars, false);
    expect(r.columnas).toHaveLength(19);
    expect(r.totalFilas).toBe(1);
    expect(prisma.deudor.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('ReportesController.create', () => {
  it('le pasa al servicio el usuario del JWT (creadoPorId quedaba en null)', async () => {
    const create = jest.fn().mockResolvedValue({ id: 1 });
    const controller = new ReportesController({ create } as any, {} as any, {} as any);
    const dto = { nombre: 'n' } as any;
    await controller.create(dto, { usuario: { sub: 42 } } as any);
    expect(create).toHaveBeenCalledWith(dto, 42);
  });
});
