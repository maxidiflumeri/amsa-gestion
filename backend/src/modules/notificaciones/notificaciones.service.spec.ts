import { Logger } from '@nestjs/common';
import { NotificacionesService } from './notificaciones.service';

type Emision = [number, string, any];

function armar(opts: { conPermiso?: number[]; count?: jest.Mock } = {}) {
    let seq = 100;
    const emisiones: Emision[] = [];
    const prisma: any = {
        usuario: {
            findMany: jest.fn().mockResolvedValue(
                (opts.conPermiso ?? []).map((id) => ({ id, rolObj: { permisos: ['importacion.ver_progreso_otros'] } })),
            ),
        },
        notificacion: {
            create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: ++seq, usuarioId: data.usuarioId })),
            count: opts.count ?? jest.fn().mockResolvedValue(2),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
    };
    const realtime: any = { emitToUser: jest.fn((u: number, e: string, p: any) => emisiones.push([u, e, p])) };
    const service = new NotificacionesService(prisma, realtime);
    const eventos = (usuario: number, evento: string) => emisiones.filter((e) => e[0] === usuario && e[1] === evento);
    return { service, prisma, realtime, emisiones, eventos };
}

const params = {
    tipo: 'IMPORTACION_FINALIZADA' as const,
    titulo: 'Importación terminada',
    mensaje: 'Listo',
    payload: { remesaId: 9 },
    rutaAccion: '/importacion/historial',
    destinatarioPrincipalId: 3,
};

describe('NotificacionesService — copias silenciosas', () => {
    beforeEach(() => {
        jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());

    it('N-1: el principal recibe nueva; las copias por permiso, silenciosa; todos, contador', async () => {
        const { service, prisma, eventos, emisiones } = armar({ conPermiso: [4, 5] });
        await service.crear({ ...params, incluirUsuariosConPermiso: 'importacion.ver_progreso_otros' });

        expect(prisma.notificacion.create).toHaveBeenCalledTimes(3);
        expect(eventos(3, 'notificacion:nueva')).toHaveLength(1);
        expect(eventos(3, 'notificacion:silenciosa')).toHaveLength(0);
        for (const u of [4, 5]) {
            expect(eventos(u, 'notificacion:silenciosa')).toHaveLength(1);
            expect(eventos(u, 'notificacion:nueva')).toHaveLength(0);
        }
        for (const u of [3, 4, 5]) expect(eventos(u, 'notificacion:contador')).toEqual([[u, 'notificacion:contador', { noLeidas: 2 }]]);
        expect(emisiones.filter((e) => e[1] === 'notificacion:nueva')).toHaveLength(1);
    });

    it('N-2: si el principal también tiene el permiso, una sola fila para él y con nueva', async () => {
        const { service, prisma, eventos } = armar({ conPermiso: [3, 4] });
        await service.crear({ ...params, incluirUsuariosConPermiso: 'importacion.ver_progreso_otros' });

        expect(prisma.notificacion.create).toHaveBeenCalledTimes(2);
        expect(eventos(3, 'notificacion:nueva')).toHaveLength(1);
        expect(eventos(3, 'notificacion:silenciosa')).toHaveLength(0);
        expect(eventos(4, 'notificacion:silenciosa')).toHaveLength(1);
    });

    it('N-3: sin incluirUsuariosConPermiso solo hay nueva para el principal', async () => {
        const { service, prisma, emisiones } = armar();
        await service.crear(params);

        expect(prisma.usuario.findMany).not.toHaveBeenCalled();
        expect(emisiones.map((e) => [e[0], e[1]])).toEqual([
            [3, 'notificacion:nueva'],
            [3, 'notificacion:contador'],
        ]);
    });

    it('N-4: el payload de silenciosa es el de nueva, con el id propio de cada fila', async () => {
        const { service, eventos } = armar({ conPermiso: [4] });
        await service.crear({ ...params, incluirUsuariosConPermiso: 'importacion.ver_progreso_otros' });

        const nueva = eventos(3, 'notificacion:nueva')[0][2];
        const silenciosa = eventos(4, 'notificacion:silenciosa')[0][2];
        expect(Object.keys(silenciosa).sort()).toEqual(Object.keys(nueva).sort());
        expect(nueva.id).not.toBe(silenciosa.id);
        const { id: _a, creadoEn: _b, ...restoNueva } = nueva;
        const { id: _c, creadoEn: _d, ...restoSilenciosa } = silenciosa;
        expect(restoSilenciosa).toEqual(restoNueva);
        expect(silenciosa).toMatchObject({ tipo: params.tipo, titulo: params.titulo, mensaje: params.mensaje, payload: params.payload, rutaAccion: params.rutaAccion });
    });

    it('N-5: marcarTodas emite la cuenta real, no un 0 fijo', async () => {
        const { service, eventos } = armar({ count: jest.fn().mockResolvedValue(1) });
        await service.marcarTodas(3);
        expect(eventos(3, 'notificacion:contador')).toEqual([[3, 'notificacion:contador', { noLeidas: 1 }]]);
    });

    it('N-6: emitirContador no tira si count falla y deja un warn', async () => {
        const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
        const { service, realtime } = armar({ count: jest.fn().mockRejectedValue(new Error('base caída')) });
        await expect(service.emitirContador(3)).resolves.toBeUndefined();
        expect(realtime.emitToUser).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('marcarLeida usa el contador contado', async () => {
        const { service, prisma, eventos } = armar({ count: jest.fn().mockResolvedValue(4) });
        prisma.notificacion.findUnique = jest.fn().mockResolvedValue({ id: 7, usuarioId: 3 });
        prisma.notificacion.update = jest.fn().mockResolvedValue({});
        await service.marcarLeida(3, 7);
        expect(eventos(3, 'notificacion:contador')).toEqual([[3, 'notificacion:contador', { noLeidas: 4 }]]);
    });
});
