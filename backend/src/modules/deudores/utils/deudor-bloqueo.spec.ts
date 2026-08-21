/**
 * Tests unitarios de DeudorBloqueoService.
 *
 * Ejecutar: npx jest deudor-bloqueo.spec.ts --no-coverage
 *
 * Casos cubiertos:
 *  - Con los códigos seedeados: bloquea toda la categoría CANCELADO (SIT-050 a SIT-053).
 *  - Sin códigos seedeados (modo degradado): no bloquea en ningún caso.
 *  - Deudor inexistente: no lanza (no hay estado que comparar).
 */
import { ForbiddenException } from '@nestjs/common';
import { DeudorBloqueoService } from './deudor-bloqueo';

// ─── Helpers de mock ──────────────────────────────────────────────────────────

function makeService(
    codigosEnDb: boolean,
    deudorEstadoSituacionId: number | null,
): DeudorBloqueoService {
    const prisma = {
        parametro: {
            // Los cuatro códigos de categoría CANCELADO del catálogo real.
            findMany: jest.fn().mockResolvedValue(
                codigosEnDb
                    ? [
                        { id: 42, clave: 'SIT-050' },
                        { id: 51, clave: 'SIT-051' },
                        { id: 52, clave: 'SIT-052' },
                        { id: 53, clave: 'SIT-053' },
                    ]
                    : [],
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
    describe('onModuleInit — con los códigos seedeados', () => {
        it('cachea los códigos de cancelación correctamente', async () => {
            const svc = makeService(true, null);
            await svc.onModuleInit();
            // El servicio no expone los ids directamente — lo verificamos
            // comprobando el comportamiento en assertNoBloqueado.
            // Si quedaron cacheados, un deudor con uno de esos ids será bloqueado.
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

    describe('onModuleInit — sin códigos seedeados (modo degradado)', () => {
        it('no lanza en onModuleInit cuando no hay códigos de cancelación', async () => {
            const svc = makeService(false, null);
            await expect(svc.onModuleInit()).resolves.not.toThrow();
        });
    });

    describe('assertNoBloqueado — CON los códigos seedeados', () => {
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

        it.each([51, 52, 53])(
            'también bloquea los otros códigos de cancelación (id %i)',
            async (id) => {
                // Antes solo bloqueaba SIT-050: un caso puesto a mano en "Cancelado antes de la
                // gestión" se seguía pudiendo gestionar como si estuviera abierto.
                (svc as any).prisma.deudor.findUnique = jest.fn().mockResolvedValue({
                    estadoSituacionId: id,
                });
                await expect(svc.assertNoBloqueado(1, 'crear comentario')).rejects.toThrow(ForbiddenException);
            },
        );

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
                expect(resp.message).toContain('cancelado');
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

    describe('assertNoBloqueado — SIN códigos seedeados (modo degradado)', () => {
        let svc: DeudorBloqueoService;

        beforeEach(async () => {
            svc = makeService(false, null);
            await svc.onModuleInit();
        });

        it('NO lanza aunque el deudor tenga estadoSituacionId que coincidiría con SIT-050', async () => {
            // En modo degradado no hay ids cacheados, no se hace el check
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
