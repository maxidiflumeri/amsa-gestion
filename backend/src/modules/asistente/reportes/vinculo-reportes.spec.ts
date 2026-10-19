import { Logger } from '@nestjs/common';
import { ReportesController } from '../../reportes/reportes.controller';
import { PropuestasService } from './propuestas.service';

/** `POST /reportes/plantillas` con `asistentePropuestaId`: vincula la propuesta y nunca hace fallar el alta. */
describe('ReportesController.create + propuesta del asistente', () => {
    beforeEach(() => {
        jest.spyOn(Logger.prototype, 'log').mockImplementation();
        jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());

    function armar(vincular: jest.Mock | Error = jest.fn().mockResolvedValue(undefined)) {
        const creada = { id: 99, nombre: 'Cartera', definicion: { columnas: [] } };
        const reportes: any = { create: jest.fn().mockResolvedValue(creada) };
        const moduleRef: any = { get: jest.fn(() => (vincular instanceof Error ? (() => { throw vincular; })() : { vincularGuardada: vincular })) };
        const ctrl = new ReportesController(reportes, {} as any, {} as any, moduleRef);
        return { ctrl, reportes, moduleRef, vincular, creada };
    }
    const req: any = { usuario: { sub: 7 } };

    it('crea con el usuario (creadoPorId) y vincula la propuesta con la plantilla creada', async () => {
        const { ctrl, reportes, vincular, creada, moduleRef } = armar();
        const r = await ctrl.create({ nombre: 'Cartera', asistentePropuestaId: 5 } as any, req);
        expect(r).toBe(creada);
        expect(reportes.create).toHaveBeenCalledWith(expect.anything(), 7);
        expect(moduleRef.get).toHaveBeenCalledWith(PropuestasService, { strict: false });
        expect(vincular).toHaveBeenCalledWith(7, 5, creada);
    });

    it('sin asistentePropuestaId no busca el servicio', async () => {
        const { ctrl, moduleRef } = armar();
        await ctrl.create({ nombre: 'Cartera' } as any, req);
        expect(moduleRef.get).not.toHaveBeenCalled();
    });

    it('si el vínculo falla: warn, y la plantilla queda creada', async () => {
        const { ctrl, creada } = armar(jest.fn().mockRejectedValue(new Error('db')));
        await expect(ctrl.create({ nombre: 'Cartera', asistentePropuestaId: 5 } as any, req)).resolves.toBe(creada);
        expect(Logger.prototype.warn).toHaveBeenCalled();
    });

    it('si el servicio ni siquiera existe (módulo sin cargar): igual crea', async () => {
        const { ctrl, creada } = armar(new Error('no encontrado'));
        await expect(ctrl.create({ nombre: 'Cartera', asistentePropuestaId: 5 } as any, req)).resolves.toBe(creada);
    });
});
