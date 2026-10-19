import { Logger, NotFoundException } from '@nestjs/common';
import { PropuestasService } from './propuestas.service';
import { hashDefinicion } from './hash-plantilla';
import { SemaforoReportes } from './semaforo';

const definicion = {
    columnas: [
        { id: 'a', path: 'documento', label: 'DNI' },
        { id: 'b', path: 'contactos[tipo=telefono][0].valor', label: 'Teléfono', tipo: 'telefono' },
        { id: 'c', path: 'saldo', label: 'Saldo' },
        { id: 'd', path: 'camposAdicionales.PATENTE', label: 'Patente' },
    ],
    filtros: [],
    ordenamientos: [],
    cardinalidadDefault: 'concatenar',
};

const tarjeta = (extra: object = {}) => ({ nombre: 'Cartera', descripcion: null, empresa: 'TOYOTA', formato: 'xlsx', opciones: [], mapeo: [], filtros: [], orden: [], casos: 8412, casosAproximado: false, avisos: [], mensaje: '', sugerencias: [], version: 0, ...extra });
const fila = (extra: object = {}) => ({
    id: 5,
    conversacionId: 12,
    mensajeId: 30,
    usuarioId: 7,
    prueba: 'p2',
    estado: 'probada',
    plantillaId: null,
    tarjeta: tarjeta(),
    plantilla: { nombre: 'Cartera', descripcion: null, raiz: 'deudor', empresaId: 1, definicion, formatoSalida: 'xlsx', opcionesFormato: { xlsx: {} } },
    hash: hashDefinicion(definicion),
    ...extra,
});

function armar(filaActual: any = fila()) {
    const prisma: any = {
        asistente_propuesta: {
            findUnique: jest.fn().mockResolvedValue(filaActual),
            findFirst: jest.fn().mockImplementation(async ({ where }: any) => (where.usuarioId === filaActual?.usuarioId && (!where.estado || where.estado.in.includes(filaActual.estado)) ? filaActual : null)),
            findMany: jest.fn().mockResolvedValue([]),
            count: jest.fn().mockResolvedValue(0),
            update: jest.fn().mockImplementation(async ({ data }: any) => ({ ...filaActual, ...data })),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
    };
    const executor: any = { execute: jest.fn() };
    return { svc: new PropuestasService(prisma, executor, new SemaforoReportes(2)), prisma, executor };
}

describe('PropuestasService', () => {
    beforeEach(() => {
        jest.spyOn(Logger.prototype, 'log').mockImplementation();
        jest.spyOn(Logger.prototype, 'warn').mockImplementation();
        jest.spyOn(Logger.prototype, 'error').mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());

    describe('mostrar', () => {
        it('marca mostrada, guarda el mensaje y las sugerencias, y numera la versión', async () => {
            const { svc, prisma } = armar();
            prisma.asistente_propuesta.count.mockResolvedValue(1);
            const t = await svc.mostrar({ conversacionId: 12, prueba: 'p2', mensaje: 'Revisala.', sugerencias: ['Agregá el teléfono'] });
            expect(t).toMatchObject({ propuestaId: 5, prueba: 'p2', estado: 'mostrada', version: 2, mensaje: 'Revisala.', sugerencias: ['Agregá el teléfono'], vigente: true, plantillaId: null });
            expect(prisma.asistente_propuesta.update.mock.calls[0][0].data.estado).toBe('mostrada');
            expect(prisma.asistente_propuesta.findUnique).toHaveBeenCalledWith({ where: { conversacionId_prueba: { conversacionId: 12, prueba: 'p2' } } });
        });

        it('una prueba que no existe en la conversación: null', async () => {
            const { svc } = armar(null);
            await expect(svc.mostrar({ conversacionId: 12, prueba: 'p9', mensaje: 'x', sugerencias: [] })).resolves.toBeNull();
            await expect(svc.mostrar({ conversacionId: null, prueba: 'p1', mensaje: 'x', sugerencias: [] })).resolves.toBeNull();
        });

        it('volver a mostrar una ya abierta no la baja de estado', async () => {
            const { svc } = armar(fila({ estado: 'abierta', tarjeta: tarjeta({ version: 3 }) }));
            const t = await svc.mostrar({ conversacionId: 12, prueba: 'p2', mensaje: 'x', sugerencias: [] });
            expect(t).toMatchObject({ estado: 'abierta', version: 3 });
        });
    });

    describe('tarjetasDeConversacion', () => {
        it('agrupa por mensaje y solo la última mostrada es vigente', async () => {
            const { svc, prisma } = armar();
            prisma.asistente_propuesta.findMany.mockResolvedValue([
                { id: 1, mensajeId: 10, prueba: 'p1', estado: 'mostrada', plantillaId: null, tarjeta: tarjeta({ version: 1 }) },
                { id: 3, mensajeId: 20, prueba: 'p3', estado: 'guardada', plantillaId: 44, tarjeta: tarjeta({ version: 2 }) },
            ]);
            const m = await svc.tarjetasDeConversacion(12);
            expect(m.get(10)![0]).toMatchObject({ propuestaId: 1, version: 1, vigente: false });
            expect(m.get(20)![0]).toMatchObject({ propuestaId: 3, estado: 'guardada', plantillaId: 44, vigente: true });
        });
    });

    describe('plantillaDe', () => {
        it('devuelve la plantilla para el editor y marca abierta la mostrada', async () => {
            const { svc, prisma } = armar(fila({ estado: 'mostrada' }));
            const p = await svc.plantillaDe(7, 5);
            expect(p).toMatchObject({ nombre: 'Cartera', raiz: 'deudor', empresaId: 1, formatoSalida: 'xlsx', asistentePropuestaId: 5 });
            expect(p.definicion).toEqual(definicion);
            expect(prisma.asistente_propuesta.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { estado: 'abierta' } });
        });

        it('una ya abierta o guardada no cambia de estado', async () => {
            const { svc, prisma } = armar(fila({ estado: 'guardada' }));
            await svc.plantillaDe(7, 5);
            expect(prisma.asistente_propuesta.update).not.toHaveBeenCalled();
        });

        it('ajena, inexistente o probada y nunca mostrada: 404', async () => {
            await expect(armar(fila()).svc.plantillaDe(7, 5)).rejects.toBeInstanceOf(NotFoundException);
            await expect(armar(fila({ estado: 'mostrada' })).svc.plantillaDe(8, 5)).rejects.toBeInstanceOf(NotFoundException);
            await expect(armar(null).svc.plantillaDe(7, 5)).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe('vistaPrevia', () => {
        const filas = [
            { DNI: '30111222', Teléfono: '1155578807', Saldo: '248.300,00', Patente: 'AB123CD' },
            { DNI: '27888999', Teléfono: '1144443322', Saldo: '91.250,50', Patente: 'AC456EF' },
        ];

        it('devuelve las filas enmascaradas, los casos y NO escribe nada', async () => {
            const { svc, prisma, executor } = armar(fila({ estado: 'mostrada' }));
            executor.execute.mockResolvedValue({ filas, totalFilas: 2, columnas: [] });
            const v = await svc.vistaPrevia(7, 5, 5);
            expect(v.columnas).toEqual(['DNI', 'Teléfono', 'Saldo', 'Patente']);
            expect(v.filas[0]).toEqual({ DNI: '··· 1222', Teléfono: '11 ···· 8807', Saldo: '248.300,00', Patente: 'XX999XX' });
            expect(v.casos).toBe(8412);
            expect(v.error).toBeUndefined();
            expect(JSON.stringify(v)).not.toMatch(/30111222|1155578807|AB123CD/);
            expect(prisma.asistente_propuesta.update).not.toHaveBeenCalled();
            expect(prisma.asistente_propuesta.updateMany).not.toHaveBeenCalled();
            expect(executor.execute.mock.calls[0][3]).toBe(true);
        });

        it('respeta la cantidad pedida (1 a 10)', async () => {
            const { svc, executor } = armar(fila({ estado: 'mostrada' }));
            executor.execute.mockResolvedValue({ filas, totalFilas: 2, columnas: [] });
            expect((await svc.vistaPrevia(7, 5, 1)).filas).toHaveLength(1);
        });

        it('si el motor falla: 200 con error FALLO (y error en el log)', async () => {
            const { svc, executor } = armar(fila({ estado: 'mostrada' }));
            executor.execute.mockRejectedValue(new Error('db'));
            expect(await svc.vistaPrevia(7, 5)).toMatchObject({ error: 'FALLO', filas: [], casos: 8412 });
            expect(Logger.prototype.error).toHaveBeenCalled();
        });

        it('si tarda más de 20 s: error TIMEOUT', async () => {
            jest.useFakeTimers();
            const { svc, executor } = armar(fila({ estado: 'mostrada' }));
            executor.execute.mockReturnValue(new Promise(() => undefined));
            const p = svc.vistaPrevia(7, 5);
            await jest.advanceTimersByTimeAsync(20_001);
            expect(await p).toMatchObject({ error: 'TIMEOUT', filas: [] });
            jest.useRealTimers();
        });
    });

    describe('vincularGuardada', () => {
        it('queda guardada con su plantilla y sin cambios si el hash coincide (los ids no cuentan)', async () => {
            const { svc, prisma } = armar(fila({ estado: 'abierta' }));
            const guardada = { ...definicion, columnas: definicion.columnas.map((c) => ({ ...c, id: 'otro-' + c.id })) };
            await svc.vincularGuardada(7, 5, { id: 99, definicion: guardada });
            expect(prisma.asistente_propuesta.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { estado: 'guardada', plantillaId: 99, guardadaSinCambios: true } });
        });

        it('si la persona cambió algo en el editor: guardadaSinCambios false', async () => {
            const { svc, prisma } = armar(fila({ estado: 'abierta' }));
            await svc.vincularGuardada(7, 5, { id: 99, definicion: { ...definicion, columnas: definicion.columnas.slice(0, 2) } });
            expect(prisma.asistente_propuesta.update.mock.calls[0][0].data.guardadaSinCambios).toBe(false);
        });

        it('una propuesta ajena o inexistente no falla: warn y no se vincula', async () => {
            const { svc, prisma } = armar(fila({ estado: 'abierta' }));
            await expect(svc.vincularGuardada(8, 5, { id: 99, definicion })).resolves.toBeUndefined();
            expect(prisma.asistente_propuesta.update).not.toHaveBeenCalled();
            expect(Logger.prototype.warn).toHaveBeenCalled();
        });

        it('sin id de propuesta no hace nada, y si la base falla tampoco rompe', async () => {
            const { svc, prisma } = armar();
            await svc.vincularGuardada(7, undefined, { id: 99, definicion });
            expect(prisma.asistente_propuesta.findFirst).not.toHaveBeenCalled();
            prisma.asistente_propuesta.findFirst.mockRejectedValue(new Error('db'));
            await expect(svc.vincularGuardada(7, 5, { id: 99, definicion })).resolves.toBeUndefined();
        });
    });

    it('ultimaMostrada y asignarCosto', async () => {
        const { svc, prisma } = armar();
        prisma.asistente_propuesta.findFirst.mockResolvedValue({ prueba: 'p4', tarjeta: tarjeta({ nombre: 'Cartera v2' }) });
        expect(await svc.ultimaMostrada(12)).toEqual({ prueba: 'p4', nombre: 'Cartera v2' });
        await svc.asignarCosto(30, 0.071);
        expect(prisma.asistente_propuesta.updateMany).toHaveBeenCalledWith({ where: { mensajeId: 30, estado: { not: 'probada' } }, data: { costoUsd: 0.071 } });
    });
});
