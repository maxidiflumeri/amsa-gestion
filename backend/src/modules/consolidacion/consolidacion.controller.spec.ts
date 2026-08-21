/**
 * Tests del ConsolidacionController (Fase 4, spec §6).
 *
 * Ejecutar: npx jest consolidacion.controller.spec.ts --no-coverage
 *
 * Casos cubiertos:
 *  1. POST /preview → encola job con dryRun:true, no verifica lock.
 *  2. POST /aplicar → toma lock, encola job con dryRun:false.
 *  3. POST /aplicar con lock tomado → 409 CONSOLIDACION_EN_CURSO.
 *  4. POST /preview con tipo REMESA sin remesaId → 400.
 *  5. POST /aplicar con tipo EMPRESA sin empresaId → 400.
 *  6. GET /estado sin lock → { enCurso: false }.
 *  7. GET /estado con lock → { enCurso: true, jobId, usuarioId, iniciadoEn }.
 *  8. POST /aplicar falla enqueue → suelta el lock.
 *
 * Estrategia de mocking:
 *  - Instanciamos el controller directamente (sin TestingModule) para evitar
 *    la complejidad del DI de NestJS con BullMQ en entorno unit test.
 *    Siguiendo el mismo espíritu del service.spec.ts que no usa TestingModule.
 */

import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConsolidacionController } from './consolidacion.controller';
import { ConsolidacionRedisLockService } from './consolidacion-redis-lock.service';
import { RequestContextService } from '../../common/logger/request-context';

// ─── Mocks de módulos con infraestructura externa ────────────────────────────
jest.mock('./consolidacion-redis-lock.service');
jest.mock('../../common/logger/request-context', () => ({
    RequestContextService: jest.fn().mockImplementation(() => ({
        getRequestId: jest.fn().mockReturnValue('test-req-id'),
    })),
}));
// El decorador @InjectQueue no puede testearse sin el módulo BullMQ completo.
// Instanciamos el controller directamente pasando la queue como dependencia.
jest.mock('@nestjs/bullmq', () => ({
    InjectQueue: () => () => {},
    BullModule: { registerQueue: jest.fn() },
    Processor: () => () => {},
    WorkerHost: class {},
    OnWorkerEvent: () => () => {},
    getQueueToken: (name: string) => `BullQueue_${name}`,
}));
jest.mock('../../auth/decorators', () => ({
    Permisos: () => () => {},
    UsuarioActual: () => () => {},
    IS_PUBLIC_KEY: 'isPublic',
    Public: () => () => {},
    PERMISOS_KEY: 'permisos',
}));

// ─── Usuario ficticio ─────────────────────────────────────────────────────────
// La forma real del payload del JWT: el id del usuario viaja en `sub`, no en `id`. El fixture usaba
// `{ id }`, así que `usuario.sub` quedaba undefined y las aserciones sobre `usuarioId` no pasaban.
const USUARIO = { sub: 99 };

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makeQueue(jobId = 'job-42') {
    return {
        add: jest.fn().mockResolvedValue({ id: jobId }),
    };
}

function makeLock(acquired = true) {
    return {
        tryAcquire: jest.fn().mockResolvedValue(acquired),
        updateMeta: jest.fn().mockResolvedValue(undefined),
        release: jest.fn().mockResolvedValue(undefined),
        getEstado: jest.fn().mockResolvedValue({ enCurso: false }),
    };
}

function makeRequestCtx() {
    return {
        getRequestId: jest.fn().mockReturnValue('req-test'),
    } as unknown as RequestContextService;
}

/**
 * Crea el controller instanciando directamente sin TestingModule,
 * evitando la complejidad del DI de BullMQ en tests unitarios.
 */
function createController(
    queue: ReturnType<typeof makeQueue>,
    lock: ReturnType<typeof makeLock>,
) {
    const ctrl = new ConsolidacionController(
        queue as any,
        lock as unknown as ConsolidacionRedisLockService,
        makeRequestCtx(),
    );
    return ctrl;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('ConsolidacionController', () => {
    describe('POST /preview', () => {
        it('encola con dryRun:true para scope TODAS y devuelve jobId', async () => {
            const queue = makeQueue('job-1');
            const lock = makeLock();
            const ctrl = createController(queue, lock);

            const result = await ctrl.preview({ tipo: 'TODAS' }, USUARIO);

            expect(result).toEqual({ jobId: 'job-1' });
            expect(queue.add).toHaveBeenCalledWith(
                'consolidar',
                expect.objectContaining({ dryRun: true, usuarioId: USUARIO.sub }),
                expect.any(Object),
            );
            // Preview no toca el lock
            expect(lock.tryAcquire).not.toHaveBeenCalled();
        });

        it('encola scope REMESA con remesaId correcto', async () => {
            const queue = makeQueue('job-2');
            const ctrl = createController(queue, makeLock());

            const result = await ctrl.preview({ tipo: 'REMESA', remesaId: 10 }, USUARIO);

            expect(result).toEqual({ jobId: 'job-2' });
            expect(queue.add).toHaveBeenCalledWith(
                'consolidar',
                expect.objectContaining({
                    dryRun: true,
                    scope: { tipo: 'REMESA', remesaId: 10 },
                }),
                expect.any(Object),
            );
        });

        it('encola scope EMPRESA con empresaId correcto', async () => {
            const queue = makeQueue('job-3');
            const ctrl = createController(queue, makeLock());

            await ctrl.preview({ tipo: 'EMPRESA', empresaId: 5 }, USUARIO);

            expect(queue.add).toHaveBeenCalledWith(
                'consolidar',
                expect.objectContaining({ scope: { tipo: 'EMPRESA', empresaId: 5 } }),
                expect.any(Object),
            );
        });

        it('lanza BadRequestException cuando tipo REMESA sin remesaId', async () => {
            const queue = makeQueue();
            const ctrl = createController(queue, makeLock());

            await expect(
                ctrl.preview({ tipo: 'REMESA' }, USUARIO),
            ).rejects.toThrow(BadRequestException);
            expect(queue.add).not.toHaveBeenCalled();
        });

        it('lanza BadRequestException cuando tipo EMPRESA sin empresaId', async () => {
            const queue = makeQueue();
            const ctrl = createController(queue, makeLock());

            await expect(
                ctrl.preview({ tipo: 'EMPRESA' }, USUARIO),
            ).rejects.toThrow(BadRequestException);
            expect(queue.add).not.toHaveBeenCalled();
        });
    });

    describe('POST /aplicar', () => {
        it('toma el lock y encola con dryRun:false', async () => {
            const queue = makeQueue('job-10');
            const lock = makeLock(true);
            const ctrl = createController(queue, lock);

            const result = await ctrl.aplicar({ tipo: 'TODAS' }, USUARIO);

            expect(result).toEqual({ jobId: 'job-10' });
            expect(lock.tryAcquire).toHaveBeenCalled();
            expect(queue.add).toHaveBeenCalledWith(
                'consolidar',
                expect.objectContaining({ dryRun: false, usuarioId: USUARIO.sub }),
                expect.any(Object),
            );
        });

        it('retorna 409 cuando el lock ya está tomado', async () => {
            const queue = makeQueue();
            const lock = makeLock(false);
            const ctrl = createController(queue, lock);

            await expect(
                ctrl.aplicar({ tipo: 'TODAS' }, USUARIO),
            ).rejects.toThrow(ConflictException);

            expect(queue.add).not.toHaveBeenCalled();
        });

        it('suelta el lock si el enqueue falla', async () => {
            const queue = { add: jest.fn().mockRejectedValue(new Error('Redis down')) };
            const lock = makeLock(true);
            const ctrl = createController(queue as any, lock);

            await expect(
                ctrl.aplicar({ tipo: 'TODAS' }, USUARIO),
            ).rejects.toThrow('Redis down');

            expect(lock.release).toHaveBeenCalled();
        });

        it('lanza BadRequestException cuando tipo REMESA sin remesaId', async () => {
            const queue = makeQueue();
            const lock = makeLock(true);
            const ctrl = createController(queue, lock);

            await expect(
                ctrl.aplicar({ tipo: 'REMESA' }, USUARIO),
            ).rejects.toThrow(BadRequestException);

            // Ni siquiera toca el lock si la validación falla primero
            expect(lock.tryAcquire).not.toHaveBeenCalled();
        });
    });

    describe('GET /estado', () => {
        it('retorna enCurso:false cuando no hay lock activo', async () => {
            const lock = makeLock();
            lock.getEstado.mockResolvedValue({ enCurso: false });
            const ctrl = createController(makeQueue(), lock);

            const result = await ctrl.estado();
            expect(result).toEqual({ enCurso: false });
        });

        it('retorna metadata cuando hay lock activo', async () => {
            const meta = {
                jobId: 'job-99',
                usuarioId: 7,
                iniciadoEn: '2026-06-30T10:00:00.000Z',
            };
            const lock = makeLock();
            lock.getEstado.mockResolvedValue({ enCurso: true, meta });
            const ctrl = createController(makeQueue(), lock);

            const result = await ctrl.estado();
            expect(result).toEqual({
                enCurso: true,
                jobId: meta.jobId,
                usuarioId: meta.usuarioId,
                iniciadoEn: meta.iniciadoEn,
            });
        });
    });
});
