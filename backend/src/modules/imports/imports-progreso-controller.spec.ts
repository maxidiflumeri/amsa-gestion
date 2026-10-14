import { RequestMethod } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { INTERCEPTORS_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PERMISOS_KEY } from '../../auth/decorators';
import { ImportController } from './imports.controller';
import { ConfirmarPendientesDto, ErroresQueryDto, HistorialQueryDto } from './dtos/import.dto';

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

describe('ImportController — C2a: historial, errores y confirmar pendientes', () => {
    const ruta = (m: (...a: never[]) => unknown) => ({
        path: Reflect.getMetadata(PATH_METADATA, m),
        metodo: Reflect.getMetadata(METHOD_METADATA, m),
        permisos: Reflect.getMetadata(PERMISOS_KEY, m),
        auditado: (Reflect.getMetadata(INTERCEPTORS_METADATA, m) ?? []).length > 0,
    });
    const proto = ImportController.prototype;

    it('las tres rutas nuevas existen con su permiso (las de lectura usan el de clase)', () => {
        expect(ruta(proto.historial)).toMatchObject({ path: 'historial', metodo: RequestMethod.GET, permisos: undefined });
        expect(ruta(proto.erroresCsv)).toMatchObject({ path: 'errores/:remesaId/csv', metodo: RequestMethod.GET, permisos: undefined });
        expect(ruta(proto.confirmarPendientes)).toMatchObject({ path: 'remesas/confirmar-pendientes', metodo: RequestMethod.POST, permisos: ['importacion.ejecutar'] });
        expect(Reflect.getMetadata(PERMISOS_KEY, ImportController)).toEqual(['importacion.ver_historial']);
    });

    it('el CSV y confirmar-pendientes se auditan', () => {
        expect(ruta(proto.erroresCsv).auditado).toBe(true);
        expect(ruta(proto.confirmarPendientes).auditado).toBe(true);
    });

    it('historial, errores y confirmar delegan en el servicio', async () => {
        const service: any = {
            historial: jest.fn().mockResolvedValue({ data: [] }),
            getErrors: jest.fn().mockResolvedValue({ data: [] }),
            erroresCsv: jest.fn().mockResolvedValue(undefined),
            confirmarPendientes: jest.fn().mockResolvedValue({ grupoId: null }),
        };
        const c = new ImportController(service);
        await c.historial({ empresaId: 10 } as never);
        expect(service.historial).toHaveBeenCalledWith({ empresaId: 10 });
        await c.getErrors(5, { tipo: 'FILA' } as never);
        expect(service.getErrors).toHaveBeenCalledWith(5, { tipo: 'FILA' });
        const res: any = { headersSent: false };
        await c.erroresCsv(5, {} as never, res);
        expect(service.erroresCsv).toHaveBeenCalledWith(5, 'TODOS', res);
        await c.confirmarPendientes({ remesaIds: [1, 2] } as never, { sub: 3, permisos: ['x'] } as never);
        expect(service.confirmarPendientes).toHaveBeenCalledWith([1, 2], { sub: 3, permisos: ['x'] });
    });

    it('si el CSV falla, el controller relanza aunque la respuesta ya haya empezado: así la auditoría queda FALLIDO', async () => {
        const service: any = { erroresCsv: jest.fn().mockRejectedValue(new Error('boom')) };
        const c = new ImportController(service);
        await expect(c.erroresCsv(5, {} as never, { headersSent: true } as never)).rejects.toThrow('boom');
        await expect(c.erroresCsv(5, {} as never, { headersSent: false } as never)).rejects.toThrow('boom');
    });

    const errores = async (cls: new () => object, plano: object) => (await validate(plainToInstance(cls, plano))).map((e) => e.property);

    it('los DTO: el Historial rechaza pageSize=500; errores rechaza tipo=OTRO y acepta pageSize=100 (lo que manda una pestaña vieja)', async () => {
        expect(await errores(HistorialQueryDto, { empresaId: '10', pageSize: '500' })).toEqual(['pageSize']);
        expect(await errores(HistorialQueryDto, { empresaId: '10', pageSize: '100', page: '2', q: 'abc' })).toEqual([]);
        expect(await errores(HistorialQueryDto, {})).toEqual(['empresaId']);
        expect(await errores(HistorialQueryDto, { empresaId: '10', q: 'x'.repeat(61) })).toEqual(['q']);
        expect(await errores(ErroresQueryDto, { tipo: 'OTRO' })).toEqual(['tipo']);
        expect(await errores(ErroresQueryDto, { pageSize: '100', page: '1' })).toEqual([]);
        expect(await errores(ErroresQueryDto, { pageSize: '201' })).toEqual(['pageSize']);
        expect(await errores(ErroresQueryDto, { page: 'abc' })).toEqual(['page']);
        expect(await errores(ErroresQueryDto, { orden: 'sideways' })).toEqual(['orden']);
    });

    it('el DTO de confirmar pide de 1 a 100 ids enteros', async () => {
        expect(await errores(ConfirmarPendientesDto, { remesaIds: [] })).toEqual(['remesaIds']);
        expect(await errores(ConfirmarPendientesDto, { remesaIds: Array.from({ length: 101 }, (_, i) => i + 1) })).toEqual(['remesaIds']);
        expect(await errores(ConfirmarPendientesDto, { remesaIds: ['1', '2'] })).toEqual([]);
        expect(await errores(ConfirmarPendientesDto, {})).toEqual(['remesaIds']);
    });
});
