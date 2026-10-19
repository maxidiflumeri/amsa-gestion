import { BadRequestException } from '@nestjs/common';
import { ReportesService } from './reportes.service';

const definicionOk = { columnas: [{ id: 'c', path: 'documento', label: 'DNI' }] };

describe('ReportesService: plantillas', () => {
  const crear = jest.fn().mockResolvedValue({ id: 1 });
  const actualizar = jest.fn().mockResolvedValue({ id: 1 });
  const prisma: any = {
    plantilla_reporte: {
      create: crear,
      update: actualizar,
      findUnique: jest.fn().mockResolvedValue({ id: 1, raiz: 'deudor', nombre: 'x', definicion: definicionOk }),
    },
  };
  const servicio = new ReportesService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);

  beforeEach(() => jest.clearAllMocks());

  it('create guarda quién la creó (creadoPorId quedaba siempre en null)', async () => {
    await servicio.create({ nombre: 'n', raiz: 'deudor', formatoSalida: 'csv', definicion: definicionOk } as any, 7);
    expect(crear.mock.calls[0][0].data.creadoPorId).toBe(7);
  });

  it('create rechaza una definición con un campo inexistente antes de tocar la base', async () => {
    await expect(
      servicio.create({ nombre: 'n', raiz: 'deudor', formatoSalida: 'csv', definicion: { columnas: [{ id: 'c', path: 'nope', label: 'X' }] } } as any, 7),
    ).rejects.toThrow('El campo «nope» no existe');
    expect(crear).not.toHaveBeenCalled();
  });

  it('create rechaza dos columnas con el mismo nombre', async () => {
    const definicion = { columnas: [{ id: '1', path: 'nombre', label: 'A' }, { id: '2', path: 'apellido', label: 'A' }] };
    await expect(servicio.create({ nombre: 'n', raiz: 'deudor', formatoSalida: 'csv', definicion } as any, 1)).rejects.toThrow(BadRequestException);
  });

  it('update valida la definición nueva contra la raíz de la plantilla', async () => {
    await expect(
      servicio.update(1, { definicion: { columnas: [{ id: 'c', path: 'nope', label: 'X' }] } } as any),
    ).rejects.toThrow('El campo «nope» no existe');
    expect(actualizar).not.toHaveBeenCalled();
  });

  it('update sin definición (solo el nombre) no valida nada', async () => {
    await servicio.update(1, { nombre: 'otro' } as any);
    expect(actualizar).toHaveBeenCalled();
  });

  it('duplicate conserva el usuario que la duplica', async () => {
    prisma.plantilla_reporte.findUnique.mockResolvedValueOnce({
      id: 1, nombre: 'x', raiz: 'deudor', empresaId: null, formatoSalida: 'csv', definicion: definicionOk, opcionesFormato: null, descripcion: null,
    });
    await servicio.duplicate(1, undefined, 9);
    expect(crear.mock.calls[0][0].data.creadoPorId).toBe(9);
  });
});
