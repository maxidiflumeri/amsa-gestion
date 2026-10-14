/**
 * Eliminar con el `rev` que mostró la pantalla (hallazgo bloqueante de la auditoría de C2a): si la carga cambió desde
 * entonces —el caso típico, un borrador que alguien confirmó con el diálogo abierto—, 409 y no se toca la cola.
 */
import { BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { ImportController } from './imports.controller';
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

describe('DELETE /import/remesas/:id?rev=N en el controller', () => {
    const armarCtrl = () => {
        const service: any = { deleteRemesa: jest.fn().mockResolvedValue({ ok: true }) };
        return { c: new ImportController(service), service };
    };
    const usuario: any = { sub: 1, permisos: ['importacion.eliminar'] };

    it('un rev que no es un entero ≥ 0 es un 400 «rev inválido», sin llegar al servicio (el deploy del 14/10 falló por este import)', () => {
        for (const malo of ['abc', '-1', '2.5']) {
            const { c, service } = armarCtrl();
            expect(() => c.deleteRemesa(7, usuario, malo)).toThrow(BadRequestException);
            expect(() => c.deleteRemesa(7, usuario, malo)).toThrow('rev inválido');
            expect(service.deleteRemesa).not.toHaveBeenCalled();
        }
    });

    it('sin rev, como siempre; con rev, lo pasa como revEsperado', async () => {
        const { c, service } = armarCtrl();
        await c.deleteRemesa(7, usuario, undefined);
        await c.deleteRemesa(7, usuario, '');
        await c.deleteRemesa(7, usuario, '5');
        expect(service.deleteRemesa.mock.calls).toEqual([
            [7, { sub: 1, permisos: ['importacion.eliminar'] }],
            [7, { sub: 1, permisos: ['importacion.eliminar'] }],
            [7, { sub: 1, permisos: ['importacion.eliminar'] }, { revEsperado: 5 }],
        ]);
    });
});

