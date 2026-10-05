import { RequestMethod } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { ImportController } from './imports.controller';

describe('ImportController — progreso de la carga', () => {
    const armar = () => {
        const service: any = {
            createRemesa: jest.fn().mockResolvedValue({ remesaId: 9 }),
            progreso: jest.fn().mockResolvedValue({ remesaId: 5 }),
        };
        return { controller: new ImportController(service), service };
    };

    it('createRemesa le pasa el usuario del token al alta (los borradores dejan de ser de "Sistema")', async () => {
        const { controller, service } = armar();
        const dto: any = { empresaId: 1 };
        await controller.createRemesa(dto, { file: [{ originalname: 'a' }], files: [{ originalname: 'b' }] }, { sub: 7 } as any);
        expect(service.createRemesa).toHaveBeenCalledWith(dto, [{ originalname: 'a' }, { originalname: 'b' }], 7);
    });

    it('GET remesas/:id/progreso existe y delega en service.progreso', async () => {
        const { controller, service } = armar();
        expect(Reflect.getMetadata(PATH_METADATA, ImportController.prototype.progreso)).toBe('remesas/:id/progreso');
        expect(Reflect.getMetadata(METHOD_METADATA, ImportController.prototype.progreso)).toBe(RequestMethod.GET);
        await expect(controller.progreso(5)).resolves.toEqual({ remesaId: 5 });
        expect(service.progreso).toHaveBeenCalledWith(5);
    });
});
