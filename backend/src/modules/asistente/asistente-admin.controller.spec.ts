import 'reflect-metadata';
import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { PERMISOS_KEY } from '../../auth/decorators';
import { AsistenteAdminController } from './asistente-admin.controller';

function armar() {
    const medicion: any = { tiempos: jest.fn().mockResolvedValue({ mes: '2026-10', respuestas: 0, recortado: false, porFuncion: [] }), consumo: jest.fn() };
    const conversaciones: any = { detalleDeMensaje: jest.fn().mockResolvedValue({ version: 1, totalMs: 10 }) };
    const ctrl = new AsistenteAdminController({} as any, medicion, {} as any, conversaciones);
    return { ctrl, medicion, conversaciones };
}

describe('AsistenteAdminController: detalle y tiempos', () => {
    beforeEach(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation());
    afterEach(() => jest.restoreAllMocks());

    it('GET mensajes/:id/detalle: con administrar pero sin ver_detalle es 403 SIN_PERMISO_DETALLE', async () => {
        const { ctrl, conversaciones } = armar();
        const e = await ctrl.detalleDeMensaje({ sub: 1, permisos: ['asistente.administrar'] }, 102).catch((x) => x);
        expect(e).toBeInstanceOf(ForbiddenException);
        expect(e.getResponse()).toMatchObject({
            codigo: 'SIN_PERMISO_DETALLE',
            mensaje: 'Para ver el detalle hace falta el permiso «Ver el detalle de las respuestas de amaIA».',
        });
        expect(conversaciones.detalleDeMensaje).not.toHaveBeenCalled();
        expect(Logger.prototype.warn).toHaveBeenCalled();
    });

    it('con los dos permisos devuelve el detalle de la respuesta pedida; un 404 del servicio se propaga', async () => {
        const { ctrl, conversaciones } = armar();
        await expect(ctrl.detalleDeMensaje({ sub: 1, permisos: ['asistente.administrar', 'asistente.ver_detalle'] }, 102)).resolves.toEqual({ version: 1, totalMs: 10 });
        expect(conversaciones.detalleDeMensaje).toHaveBeenCalledWith(102);
        conversaciones.detalleDeMensaje.mockRejectedValue(new NotFoundException());
        await expect(ctrl.detalleDeMensaje({ sub: 1, permisos: ['asistente.ver_detalle'] }, 5)).rejects.toBeInstanceOf(NotFoundException);
        await expect(ctrl.detalleDeMensaje({ sub: 1 }, 5)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('los métodos nuevos NO llevan @Permisos propio: heredan asistente.administrar de la clase (un @Permisos de método lo reemplazaría)', () => {
        expect(Reflect.getMetadata(PERMISOS_KEY, AsistenteAdminController)).toEqual(['asistente.administrar']);
        expect(Reflect.getMetadata(PERMISOS_KEY, AsistenteAdminController.prototype.detalleDeMensaje)).toBeUndefined();
        expect(Reflect.getMetadata(PERMISOS_KEY, AsistenteAdminController.prototype.tiempos)).toBeUndefined();
    });

    it('GET consumo/tiempos pide el mes al servicio de medición', async () => {
        const { ctrl, medicion } = armar();
        await expect(ctrl.tiempos({ mes: '2026-10' })).resolves.toMatchObject({ mes: '2026-10' });
        expect(medicion.tiempos).toHaveBeenCalledWith('2026-10');
        await ctrl.tiempos({});
        expect(medicion.tiempos).toHaveBeenLastCalledWith(undefined);
    });
});
