/**
 * Los endpoints de revertir una acción masiva, por HTTP de verdad (docs/imports-progreso-c3-spec.md §17.4 y §17.11.1):
 *  - el nuevo POST responde 202 al encolar y 200 si ya estaba revertida (`@Res({ passthrough })` con el código elegido);
 *  - el viejo (compatibilidad con C3a) devuelve la forma de siempre, y su 409 llega con `code` y `message`;
 *  - el GET devuelve la cobertura.
 * La lógica de la reversión está en `reversion/reversion-acciones.service.spec.ts`.
 */
import { ConflictException, INestApplication, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ImportController } from './imports.controller';
import { ImportService } from './imports.service';
import { ReversionAccionesService } from './reversion/reversion-acciones.service';
import { TransaccionesService } from '../transacciones/transacciones.service';

beforeAll(() => Logger.overrideLogger(false));

const dtoDe = (estado: string) => ({
    remesaId: 5, revertible: false, motivo: null, accionRevertidaEn: null,
    cobertura: { exacta: true, casos: 2, cambiosDeCaso: 2, contactos: 1, comentarios: 1, yaRevertidos: 0, casosAfectadosInformados: 2, cargaCortada: false, filasProcesadas: 10, totalFilas: 10 },
    reversion: { remesaId: 5, empresaId: 10, estado, total: 4, hechos: 0, porcentaje: 0 },
});

async function levantar() {
    const reversion = {
        obtener: jest.fn(),
        solicitar: jest.fn(),
        revertirCompat: jest.fn(),
    };
    const registrar = jest.fn().mockResolvedValue(undefined);
    const modulo = await Test.createTestingModule({
        controllers: [ImportController],
        providers: [
            { provide: ImportService, useValue: {} },
            { provide: ReversionAccionesService, useValue: reversion },
            { provide: TransaccionesService, useValue: { registrar } },
        ],
    }).compile();
    const app: INestApplication = modulo.createNestApplication();
    app.use((req: any, _res: unknown, next: () => void) => { req.usuario = { sub: 9, permisos: ['deudores.acciones_masivas'] }; next(); });
    app.setGlobalPrefix('api');
    await app.init();
    return { app, reversion, registrar };
}

describe('POST /api/import/remesas/:id/reversion', () => {
    it('202 con el DTO cuando se encoló', async () => {
        const { app, reversion } = await levantar();
        reversion.solicitar.mockResolvedValue({ dto: dtoDe('EN_COLA'), yaEstaba: false });

        const res = await request(app.getHttpServer()).post('/api/import/remesas/5/reversion');

        expect(res.status).toBe(202);
        expect(res.body.reversion.estado).toBe('EN_COLA');
        expect(reversion.solicitar).toHaveBeenCalledWith(5, 9);
        await app.close();
    });

    it('200 con reversion.estado TERMINADA cuando ya estaba revertida (idempotente)', async () => {
        const { app, reversion } = await levantar();
        reversion.solicitar.mockResolvedValue({ dto: dtoDe('TERMINADA'), yaEstaba: true });

        const res = await request(app.getHttpServer()).post('/api/import/remesas/5/reversion');

        expect(res.status).toBe(200);
        expect(res.body.reversion.estado).toBe('TERMINADA');
        await app.close();
    });

    it('el 409 llega con code y message; el 503 con REVERSION_NO_ENCOLADA; el 404 con su texto', async () => {
        const { app, reversion } = await levantar();
        reversion.solicitar.mockRejectedValueOnce(new ConflictException({ statusCode: 409, error: 'Conflict', message: 'Esta acción ya se está revirtiendo. Mirá el avance en el Historial.', code: 'REVERSION_EN_CURSO' }));
        let res = await request(app.getHttpServer()).post('/api/import/remesas/5/reversion');
        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ code: 'REVERSION_EN_CURSO', message: 'Esta acción ya se está revirtiendo. Mirá el avance en el Historial.' });

        reversion.solicitar.mockRejectedValueOnce(new ServiceUnavailableException({ statusCode: 503, message: 'No se pudo poner la reversión en la cola.', code: 'REVERSION_NO_ENCOLADA' }));
        res = await request(app.getHttpServer()).post('/api/import/remesas/5/reversion');
        expect(res.status).toBe(503);
        expect(res.body.code).toBe('REVERSION_NO_ENCOLADA');

        reversion.solicitar.mockRejectedValueOnce(new NotFoundException('Remesa no existe'));
        res = await request(app.getHttpServer()).post('/api/import/remesas/5/reversion');
        expect(res.status).toBe(404);
        await app.close();
    });

    it('la auditoría dice «Pidió revertir» al encolar, «ya estaba revertida» si ya lo estaba y «Intentó» si lo rechazaron', async () => {
        const { app, reversion, registrar } = await levantar();
        const resumenes = async () => {
            await new Promise((r) => setTimeout(r, 20));
            return registrar.mock.calls.map((c) => c[0].resumen);
        };
        reversion.solicitar.mockResolvedValueOnce({ dto: dtoDe('EN_COLA'), yaEstaba: false });
        await request(app.getHttpServer()).post('/api/import/remesas/5/reversion');
        reversion.solicitar.mockResolvedValueOnce({ dto: dtoDe('TERMINADA'), yaEstaba: true });
        await request(app.getHttpServer()).post('/api/import/remesas/5/reversion');
        reversion.solicitar.mockRejectedValueOnce(new ConflictException('x'));
        await request(app.getHttpServer()).post('/api/import/remesas/5/reversion');

        expect(await resumenes()).toEqual([
            'Pidió revertir la acción masiva de la remesa 5',
            'La acción masiva de la remesa 5 ya estaba revertida',
            'Intentó revertir la acción masiva de la remesa 5',
        ]);
        await app.close();
    });
});

describe('GET /api/import/remesas/:id/reversion', () => {
    it('devuelve la cobertura', async () => {
        const { app, reversion } = await levantar();
        reversion.obtener.mockResolvedValue({ ...dtoDe('EN_COLA'), revertible: true, reversion: null });

        const res = await request(app.getHttpServer()).get('/api/import/remesas/5/reversion');

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ remesaId: 5, revertible: true, cobertura: { casos: 2 } });
        expect(reversion.obtener).toHaveBeenCalledWith(5);
        await app.close();
    });
});

describe('POST /api/import/remesas/:id/revertir-acciones (compatibilidad con C3a)', () => {
    it('devuelve la forma de hoy', async () => {
        const { app, reversion } = await levantar();
        reversion.revertirCompat.mockResolvedValue({ yaRevertida: false, deudoresRevertidos: 3, contactosRestaurados: 2, comentariosBorrados: 1 });

        const res = await request(app.getHttpServer()).post('/api/import/remesas/5/revertir-acciones');

        expect(res.status).toBe(201); // el POST de siempre: la pestaña de C3a no depende del código exacto
        expect(res.body).toEqual({ yaRevertida: false, deudoresRevertidos: 3, contactosRestaurados: 2, comentariosBorrados: 1 });
        expect(reversion.revertirCompat).toHaveBeenCalledWith(5, 9);
        await app.close();
    });

    it('a los 20 s: 409 REVERSION_EN_CURSO con «sigue en segundo plano»', async () => {
        const { app, reversion } = await levantar();
        reversion.revertirCompat.mockRejectedValue(new ConflictException({
            statusCode: 409, error: 'Conflict', code: 'REVERSION_EN_CURSO',
            message: 'La reversión sigue en segundo plano. Actualizá el Historial en unos minutos para ver cómo terminó.',
        }));

        const res = await request(app.getHttpServer()).post('/api/import/remesas/5/revertir-acciones');

        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ code: 'REVERSION_EN_CURSO', message: expect.stringContaining('sigue en segundo plano') });
        await app.close();
    });
});
