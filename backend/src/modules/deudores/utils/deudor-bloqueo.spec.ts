/**
 * Tests unitarios de DeudorBloqueoService.
 *
 * Ejecutar: npx jest deudor-bloqueo.spec.ts --no-coverage
 *
 * Casos cubiertos:
 *  - Con SIT-050 seedeado: bloquea si el deudor está en SIT-050, no bloquea si no.
 *  - Sin SIT-050 seedeado (modo degradado): no bloquea en ningún caso.
 *  - Deudor inexistente: no lanza (no hay estado que comparar).
 */
import { ForbiddenException } from '@nestjs/common';
import { DeudorBloqueoService } from './deudor-bloqueo';

// ─── Helpers de mock ──────────────────────────────────────────────────────────

function makeService(
    sit050EnDb: boolean,
    deudorEstadoSituacionId: number | null,
): DeudorBloqueoService {
    const SIT050_ID = 42;

    const prisma = {
        parametro: {
            findUnique: jest.fn().mockResolvedValue(
                sit050EnDb ? { id: SIT050_ID, clave: 'SIT-050' } : null,
            ),
        },
        deudor: {
            findUnique: jest.fn().mockResolvedValue(
                deudorEstadoSituacionId !== undefined
                    ? { estadoSituacionId: deudorEstadoSituacionId }
                    : null,
            ),
        },
    } as any;

    return new DeudorBloqueoService(prisma);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('DeudorBloqueoService', () => {
    describe('onModuleInit — con SIT-050 seedeado', () => {
        it('cachea sit050Id correctamente', async () => {
            const svc = makeService(true, null);
            await svc.onModuleInit();
            // El servicio no expone sit050Id directamente — lo verificamos
            // comprobando el comportamiento en assertNoBloqueado.
            // Si sit050Id quedó seteado, un deudor con ese id será bloqueado.
            await expect(
                (() => {
                    // Reemplazamos el mock de deudor para que retorne estadoSituacionId = 42
                    (svc as any).prisma.deudor.findUnique = jest.fn().mockResolvedValue({
                        estadoSituacionId: 42,
                    });
                    return svc.assertNoBloqueado(1, 'test');
                })(),
            ).rejects.toThrow(ForbiddenException);
        });
    });

    describe('onModuleInit — sin SIT-050 seedeado (modo degradado)', () => {
        it('no lanza en onModuleInit cuando SIT-050 no existe', async () => {
            const svc = makeService(false, null);
            await expect(svc.onModuleInit()).resolves.not.toThrow();
        });
    });

    describe('assertNoBloqueado — CON SIT-050 seedeado', () => {
        let svc: DeudorBloqueoService;

        beforeEach(async () => {
            svc = makeService(true, null);
            await svc.onModuleInit();
        });

        it('lanza ForbiddenException si el deudor está en SIT-050', async () => {
            (svc as any).prisma.deudor.findUnique = jest.fn().mockResolvedValue({
                estadoSituacionId: 42,
            });

            await expect(svc.assertNoBloqueado(1, 'crear convenio')).rejects.toThrow(ForbiddenException);
        });

        it('el error tiene code=DEUDOR_CANCELADO', async () => {
            (svc as any).prisma.deudor.findUnique = jest.fn().mockResolvedValue({
                estadoSituacionId: 42,
            });

            try {
                await svc.assertNoBloqueado(1, 'crear comentario');
                fail('Debería haber lanzado');
            } catch (e) {
                expect(e).toBeInstanceOf(ForbiddenException);
                const resp = (e as ForbiddenException).getResponse() as any;
                expect(resp.code).toBe('DEUDOR_CANCELADO');
                expect(resp.message).toContain('SIT-050');
            }
        });

        it('NO lanza si el deudor tiene otro estadoSituacionId', async () => {
            (svc as any).prisma.deudor.findUnique = jest.fn().mockResolvedValue({
                estadoSituacionId: 10, // SIT-010 u otro
            });

            await expect(svc.assertNoBloqueado(1, 'crear convenio')).resolves.not.toThrow();
        });

        it('NO lanza si el deudor tiene estadoSituacionId null', async () => {
            (svc as any).prisma.deudor.findUnique = jest.fn().mockResolvedValue({
                estadoSituacionId: null,
            });

            await expect(svc.assertNoBloqueado(2, 'eliminar')).resolves.not.toThrow();
        });

        it('NO lanza si el deudor no existe en DB (findUnique retorna null)', async () => {
            (svc as any).prisma.deudor.findUnique = jest.fn().mockResolvedValue(null);

            await expect(svc.assertNoBloqueado(999, 'crear comentario')).resolves.not.toThrow();
        });
    });

    describe('assertNoBloqueado — SIN SIT-050 seedeado (modo degradado)', () => {
        let svc: DeudorBloqueoService;

        beforeEach(async () => {
            svc = makeService(false, null);
            await svc.onModuleInit();
        });

        it('NO lanza aunque el deudor tenga estadoSituacionId que coincidiría con SIT-050', async () => {
            // En modo degradado, sit050Id === null, no se hace el check
            (svc as any).prisma.deudor.findUnique = jest.fn().mockResolvedValue({
                estadoSituacionId: 42,
            });

            await expect(svc.assertNoBloqueado(1, 'crear comentario')).resolves.not.toThrow();
        });

        it('no consulta deudor en modo degradado (optimización)', async () => {
            const spy = jest.fn().mockResolvedValue({ estadoSituacionId: 42 });
            (svc as any).prisma.deudor.findUnique = spy;

            await svc.assertNoBloqueado(1, 'crear convenio');

            expect(spy).not.toHaveBeenCalled();
        });
    });
});
