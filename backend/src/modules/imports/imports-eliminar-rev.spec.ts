/**
 * Eliminar con el `rev` que mostró la pantalla (hallazgo bloqueante de la auditoría de C2a): si la carga cambió desde
 * entonces —el caso típico, un borrador que alguien confirmó con el diálogo abierto—, 409 y no se toca la cola.
 */
import { ConflictException, Logger } from '@nestjs/common';
import { ImportService } from './imports.service';

beforeAll(() => Logger.overrideLogger(false));

function armar(progreso: { rev: number; encoladaAt: Date | null; startedAt: Date | null } | null) {
    const prisma: any = {
        remesa: {
            findUnique: jest.fn().mockResolvedValue({
                id: 7, categoria: 'DEUDORES', estadoProceso: progreso?.encoladaAt ? 'PENDIENTE' : 'VALIDANDO', usuarioCreadorId: 1,
                progreso: progreso ? { ...progreso, finishedAt: null, jobId: null } : null,
            }),
        },
    };
    const svc = new ImportService(prisma, null as never, null as never, null as never, null as never, null as never, null as never, null as never, null as never);
    const sacar = jest.spyOn(svc as any, 'sacarJobDeLaCola').mockResolvedValue(true);
    return { svc, sacar };
}
const user = { sub: 1, permisos: ['importacion.eliminar'] };

describe('deleteRemesa con revEsperado', () => {
    it('la carga se confirmó después de que la pantalla la mostró como borrador: 409 CAMBIO_DE_ESTADO, sin tocar la cola', async () => {
        const { svc, sacar } = armar({ rev: 4, encoladaAt: new Date(), startedAt: null });
        const e = await svc.deleteRemesa(7, user, { revEsperado: 3 }).catch((x) => x);
        expect(e).toBeInstanceOf(ConflictException);
        expect((e as ConflictException).getResponse()).toMatchObject({ code: 'CAMBIO_DE_ESTADO' });
        expect(sacar).not.toHaveBeenCalled();
    });

    it('una remesa heredada (sin fila de progreso) se compara contra rev 0', async () => {
        const { svc } = armar(null);
        const e = await svc.deleteRemesa(7, user, { revEsperado: 2 }).catch((x) => x);
        expect((e as ConflictException).getResponse()).toMatchObject({ code: 'CAMBIO_DE_ESTADO' });
    });
});
