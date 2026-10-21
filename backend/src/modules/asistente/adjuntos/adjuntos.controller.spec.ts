import { BadRequestException, ConflictException, ForbiddenException, Logger, PayloadTooLargeException } from '@nestjs/common';
import { of } from 'rxjs';
import { LoggingInterceptor } from '../../../common/interceptors/logging.interceptor';
import { AdjuntosController, ArchivoGrandeFilter, ErroresDeSubidaFilter } from './adjuntos.controller';

const ARCHIVO = { buffer: Buffer.from('DNI;Saldo\n30111222;10\n'), originalname: 'a.csv', size: 22 };
const puede = { sub: 7, permisos: ['asistente.usar', 'asistente.reportes', 'reportes.crear'] };

describe('AdjuntosController', () => {
    afterEach(() => jest.restoreAllMocks());

    function armar() {
        const servicio: any = {
            subir: jest.fn().mockResolvedValue({ id: 1 }),
            actualizar: jest.fn().mockResolvedValue({ id: 1 }),
            borrar: jest.fn().mockResolvedValue(undefined),
        };
        return { ctrl: new AdjuntosController(servicio), servicio };
    }

    it('sin reportes.crear: 403 SIN_PERMISO_FUNCION y no se lee el archivo', () => {
        const { ctrl, servicio } = armar();
        let e: ForbiddenException | undefined;
        try {
            ctrl.subir({ sub: 7, permisos: ['asistente.reportes'] }, ARCHIVO);
        } catch (x) {
            e = x as ForbiddenException;
        }
        expect(e).toBeInstanceOf(ForbiddenException);
        expect(e!.getResponse()).toMatchObject({ codigo: 'SIN_PERMISO_FUNCION' });
        expect(servicio.subir).not.toHaveBeenCalled();
    });

    it('sube, actualiza y borra con el usuario de la sesión', async () => {
        const { ctrl, servicio } = armar();
        await ctrl.subir(puede, ARCHIVO);
        await ctrl.actualizar(puede, 1, { primeraFilaEsEncabezado: false });
        await ctrl.borrar(puede, 1);
        expect(servicio.subir).toHaveBeenCalledWith(7, ARCHIVO);
        expect(servicio.actualizar).toHaveBeenCalledWith(7, 1, false);
        expect(servicio.borrar).toHaveBeenCalledWith(7, 1);
    });

    it('un archivo que multer corta por tamaño sale como 413 DEMASIADO_GRANDE con código', () => {
        const json = jest.fn();
        const status = jest.fn().mockReturnValue({ json });
        new ArchivoGrandeFilter().catch(new PayloadTooLargeException(), { switchToHttp: () => ({ getResponse: () => ({ status }) }) } as any);
        expect(status).toHaveBeenCalledWith(413);
        expect(json.mock.calls[0][0]).toMatchObject({ codigo: 'DEMASIADO_GRANDE' });
    });
});

describe('errores de multer en castellano y con código', () => {
    function responder(e: Error) {
        const json = jest.fn();
        const status = jest.fn().mockReturnValue({ json });
        new ErroresDeSubidaFilter().catch(e as never, { switchToHttp: () => ({ getResponse: () => ({ status }) }) } as never);
        return { status: status.mock.calls[0][0], cuerpo: json.mock.calls[0][0] };
    }

    it('Too many files y Unexpected field', () => {
        expect(responder(new BadRequestException('Too many files'))).toMatchObject({ status: 400, cuerpo: { codigo: 'DEMASIADOS_ARCHIVOS', mensaje: 'Subí un solo archivo por vez.' } });
        expect(responder(new BadRequestException('Unexpected field'))).toMatchObject({ status: 400, cuerpo: { codigo: 'CAMPO_INESPERADO', mensaje: expect.stringContaining('campo «archivo»') } });
    });

    it('File too large y cualquier otro 400 de la subida', () => {
        expect(responder(new PayloadTooLargeException('File too large'))).toMatchObject({ status: 413, cuerpo: { codigo: 'DEMASIADO_GRANDE' } });
        expect(responder(new BadRequestException('Multipart: Boundary not found'))).toMatchObject({ status: 400, cuerpo: { codigo: 'ARCHIVO_INVALIDO' } });
    });

    it('lo que ya trae código pasa como estaba', () => {
        const e = new ConflictException({ codigo: 'YA_ENVIADO', mensaje: 'x', message: 'x' });
        expect(responder(e)).toMatchObject({ status: 409, cuerpo: { codigo: 'YA_ENVIADO' } });
    });

    it('el 403 de la función nombra los tres permisos, también «Ver reportes»', () => {
        let e: ForbiddenException | undefined;
        try {
            new AdjuntosController({} as never).subir({ sub: 7, permisos: [] }, undefined);
        } catch (x) {
            e = x as ForbiddenException;
        }
        const m = (e!.getResponse() as { mensaje: string }).mensaje;
        expect(m).toContain('«amaIA: armar reportes»');
        expect(m).toContain('«Ver reportes»');
        expect(m).toContain('«Crear reportes»');
    });
});

describe('LoggingInterceptor con un multipart', () => {
    it('loguea método y ruta, nunca el body ni el buffer del archivo', () => {
        const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
        jest.spyOn(Logger.prototype, 'debug').mockImplementation();
        jest.spyOn(Logger.prototype, 'warn').mockImplementation();
        const request = { method: 'POST', url: '/api/asistente/adjuntos', usuario: { sub: 7 }, body: { archivo: 'x' }, file: ARCHIVO };
        const contexto: any = {
            getType: () => 'http',
            switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ statusCode: 201 }) }),
        };
        const interceptor = new LoggingInterceptor({} as any);
        interceptor.intercept(contexto, { handle: () => of({ id: 1 }) }).subscribe();
        const logueado = [...log.mock.calls, ...(Logger.prototype.debug as jest.Mock).mock.calls].map((c) => c.join(' ')).join('\n');
        expect(logueado).toContain('POST /api/asistente/adjuntos');
        expect(logueado).not.toMatch(/30111222|DNI;Saldo|Buffer|buffer/);
        jest.restoreAllMocks();
    });
});
