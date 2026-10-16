process.env.TZ = 'America/Argentina/Buenos_Aires';

import { InicioService } from './inicio.service';

const AHORA = new Date('2026-10-16T13:30:00.000Z'); // viernes 10:30 AR

const OPERADOR = [
    'deudores.ver', 'comentarios.ver', 'comentarios.crear', 'convenios.ver', 'empresas.ver',
    'importacion.ver_historial', 'plantillas_import.ver', 'parametros.ver', 'politicas.ver',
    'reportes.ver', 'reportes.ejecutar', 'telefonia.usar', 'telefonia.click_to_call',
];
const ADMIN = [
    ...OPERADOR, 'promesas.ver', 'promesas.crear', 'convenios.crear', 'auditoria.ver',
    'auditoria.ver_todos', 'reportes.ver_ejecuciones', 'importacion.ejecutar',
];

const armar = () => {
    const prisma: any = {
        comentario: {
            findMany: jest.fn().mockResolvedValue([{ fecha: new Date('2026-10-16T12:00:00.000Z'), deudorId: 1 }]),
            groupBy: jest.fn().mockResolvedValue([{ deudorId: 1, _max: { fecha: new Date() }, _count: { _all: 2 } }]),
            findFirst: jest.fn().mockResolvedValue({ texto: 'Llamé\ny no atendió', fecha: new Date('2026-10-16T12:00:00.000Z') }),
        },
        deudor: {
            findMany: jest.fn().mockResolvedValue([
                {
                    id: 1, nombre: 'Ana', apellido: 'Pérez', documento: '123', empresa: { nombre: 'AYSA' },
                    estadoGestion: { descripcion: 'En gestión' }, estadoSituacion: null,
                },
            ]),
        },
        promesa_pago: {
            findMany: jest.fn().mockResolvedValue([
                { id: 1, deudorId: 1, fechaPromesa: new Date('2026-10-16T00:00:00.000Z'), monto: 100, estado: 'VIGENTE', cerradaEn: null, observacion: null },
            ]),
            count: jest.fn().mockResolvedValue(3),
            groupBy: jest.fn().mockResolvedValue([{ estado: 'CUMPLIDA', _count: { _all: 1 } }, { estado: 'INCUMPLIDA', _count: { _all: 3 } }]),
            aggregate: jest.fn().mockResolvedValue({ _count: { _all: 1 }, _sum: { monto: 100 } }),
        },
        convenio: { findMany: jest.fn().mockResolvedValue([{ id: 9, deudorId: 1, cantCuotas: 3 }]) },
        cuota_convenio: {
            findMany: jest.fn().mockResolvedValue([
                { id: 4, convenioId: 9, nroCuota: 1, fechaVencimiento: new Date('2026-10-16T00:00:00.000Z'), importe: 50, estado: 'PENDIENTE', fechaPago: null },
            ]),
        },
        import_progreso: { findMany: jest.fn().mockResolvedValue([]) },
        ejecucion_reporte: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return { prisma, service: new InicioService(prisma) };
};

describe('InicioService.miDia', () => {
    it('OPERADOR (13 permisos): agenda y promesas null, sin tocar promesa_pago ni convenio; importaciones []', async () => {
        const { prisma, service } = armar();
        const r = await service.miDia(7, OPERADOR, AHORA);
        expect(r.agenda).toBeNull();
        expect(r.promesas).toBeNull();
        expect(r.gestiones).not.toBeNull();
        expect(r.retomar).toHaveLength(1);
        expect(r.importacionesHoy).toEqual([]);
        expect(r.reportes).toEqual([]);
        expect(r.errores).toEqual([]);
        for (const m of Object.values(prisma.promesa_pago)) expect(m).not.toHaveBeenCalled();
        for (const m of Object.values(prisma.convenio)) expect(m).not.toHaveBeenCalled();
        for (const m of Object.values(prisma.cuota_convenio)) expect(m).not.toHaveBeenCalled();
    });

    it('ADMIN: ningún bloque null y errores vacío', async () => {
        const { service } = armar();
        const r = await service.miDia(1, ADMIN, AHORA);
        expect(r.errores).toEqual([]);
        expect(r.gestiones).not.toBeNull();
        expect(r.retomar).not.toBeNull();
        expect(r.agenda).not.toBeNull();
        expect(r.promesas).toEqual({ tomadas7d: 3, vencidas30d: { total: 4, cumplidas: 1 }, vencenHoy: { cantidad: 1, monto: 100 } });
        expect(r.importacionesHoy).not.toBeNull();
        expect(r.reportes).not.toBeNull();
        expect(r.agenda!.totales.hoy).toBe(2); // la promesa y la cuota de hoy
        expect(r.agenda!.incluye).toEqual({ promesas: true, cuotas: true });
    });

    it('sin ningún permiso: todos los bloques null, sin errores y sin consultas', async () => {
        const { prisma, service } = armar();
        const r = await service.miDia(1, [], AHORA);
        expect([r.gestiones, r.retomar, r.agenda, r.promesas, r.importacionesHoy, r.reportes]).toEqual([null, null, null, null, null, null]);
        expect(r.errores).toEqual([]);
        expect(prisma.comentario.findMany).not.toHaveBeenCalled();
        expect(prisma.deudor.findMany).not.toHaveBeenCalled();
    });

    it('sin comentarios.* no se consulta comentario', async () => {
        const { prisma, service } = armar();
        const r = await service.miDia(1, ['promesas.ver'], AHORA);
        expect(r.gestiones).toBeNull();
        expect(r.retomar).toBeNull();
        for (const m of Object.values(prisma.comentario)) expect(m).not.toHaveBeenCalled();
    });

    it('promesas.ver sin convenios.ver: agenda solo con promesas y sin consultar convenio', async () => {
        const { prisma, service } = armar();
        const r = await service.miDia(1, ['promesas.ver'], AHORA);
        expect(r.agenda!.incluye).toEqual({ promesas: true, cuotas: false });
        expect(prisma.convenio.findMany).not.toHaveBeenCalled();
        expect(prisma.cuota_convenio.findMany).not.toHaveBeenCalled();
    });

    it('convenios.crear + convenios.ver sin promesas.ver: solo cuotas', async () => {
        const { prisma, service } = armar();
        const r = await service.miDia(1, ['convenios.crear', 'convenios.ver'], AHORA);
        expect(r.agenda!.incluye).toEqual({ promesas: false, cuotas: true });
        expect(r.promesas).toBeNull();
        expect(prisma.promesa_pago.findMany).not.toHaveBeenCalled();
    });

    it('convenios.crear sin convenios.ver (y sin promesas.ver): no hay agenda ni consultas (auditoría Inicio)', async () => {
        const { prisma, service } = armar();
        const r = await service.miDia(1, ['convenios.crear'], AHORA);
        expect(r.agenda).toBeNull();
        expect(prisma.convenio.findMany).not.toHaveBeenCalled();
    });

    it('solo convenios.ver (el operador): no hay agenda, porque no puede armar convenios', async () => {
        const { prisma, service } = armar();
        const r = await service.miDia(1, ['convenios.ver'], AHORA);
        expect(r.agenda).toBeNull();
        expect(prisma.convenio.findMany).not.toHaveBeenCalled();
    });

    it('"Promesas tomadas" no cuenta las ANULADA (auditoría Inicio)', async () => {
        const { prisma, service } = armar();
        await service.miDia(1, ADMIN, AHORA);
        expect(prisma.promesa_pago.count).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ usuarioId: 1, estado: { not: 'ANULADA' } }) }),
        );
    });

    it('las gestiones se leen de la más nueva a la más vieja: con tope, se pierden las viejas y no las de hoy', async () => {
        const { prisma, service } = armar();
        await service.miDia(1, OPERADOR, AHORA);
        const g = prisma.comentario.findMany.mock.calls.find((c: any[]) => c[0]?.take !== undefined)?.[0];
        expect(g).toBeDefined();
        expect(g.orderBy).toEqual({ fecha: 'desc' });
    });

    it('si promesa_pago.findMany tira: agenda null, errores incluye "agenda" y el resto sale bien', async () => {
        const { prisma, service } = armar();
        prisma.promesa_pago.findMany.mockRejectedValue(new Error('boom'));
        const r = await service.miDia(1, ADMIN, AHORA);
        expect(r.agenda).toBeNull();
        expect(r.errores).toEqual(['agenda']);
        expect(r.gestiones).not.toBeNull();
        expect(r.retomar).not.toBeNull();
        expect(r.promesas).not.toBeNull();
        expect(r.reportes).not.toBeNull();
    });

    it('si falla la lectura de deudores, retomar y agenda van null con su error', async () => {
        const { prisma, service } = armar();
        prisma.deudor.findMany.mockRejectedValue(new Error('boom'));
        const r = await service.miDia(1, ADMIN, AHORA);
        expect(r.retomar).toBeNull();
        expect(r.agenda).toBeNull();
        expect(r.errores.sort()).toEqual(['agenda', 'retomar']);
        expect(r.gestiones).not.toBeNull();
    });

    it('todas las consultas de comentario filtran usuarioId y origen manual', async () => {
        const { prisma, service } = armar();
        await service.miDia(7, OPERADOR, AHORA);
        const llamadas = [
            ...prisma.comentario.findMany.mock.calls,
            ...prisma.comentario.groupBy.mock.calls,
            ...prisma.comentario.findFirst.mock.calls,
        ];
        expect(llamadas.length).toBe(3);
        for (const [args] of llamadas) {
            expect(args.where.usuarioId).toBe(7);
            expect(args.where.origen).toBe('manual');
        }
    });

    it('las consultas de gestiones empiezan 13 días antes de hoy a las 00:00 locales', async () => {
        const { prisma, service } = armar();
        await service.miDia(7, OPERADOR, AHORA);
        const gte: Date = prisma.comentario.findMany.mock.calls[0][0].where.fecha.gte;
        expect(gte.toISOString()).toBe('2026-10-03T03:00:00.000Z');
    });

    it('"Tus reportes" filtra por usuarioId aunque tenga reportes.ver_ejecuciones', async () => {
        const { prisma, service } = armar();
        await service.miDia(7, ADMIN, AHORA);
        expect(prisma.ejecucion_reporte.findMany.mock.calls[0][0].where.usuarioId).toBe(7);
        expect(prisma.ejecucion_reporte.findMany.mock.calls[0][0].take).toBe(5);
    });

    it('las importaciones terminadas filtran por el usuario creador de la remesa', async () => {
        const { prisma, service } = armar();
        await service.miDia(7, ADMIN, AHORA);
        expect(prisma.import_progreso.findMany.mock.calls[0][0].where.remesa).toEqual({ usuarioCreadorId: 7 });
    });

    it('las promesas y cuotas se piden con rangos calendario a las 00:00Z', async () => {
        const { prisma, service } = armar();
        await service.miDia(7, ADMIN, AHORA);
        const f = prisma.promesa_pago.findMany.mock.calls[0][0].where.fechaPromesa;
        expect(f.gte.toISOString()).toBe('2026-10-09T00:00:00.000Z');
        expect(f.lt.toISOString()).toBe('2026-10-24T00:00:00.000Z');
    });

    it('el texto de retomar sale recortado y sin saltos de línea', async () => {
        const { service } = armar();
        const r = await service.miDia(7, OPERADOR, AHORA);
        expect(r.retomar![0].ultimoTexto).toBe('Llamé y no atendió');
        expect(r.retomar![0].nombre).toBe('Ana Pérez');
    });
});
