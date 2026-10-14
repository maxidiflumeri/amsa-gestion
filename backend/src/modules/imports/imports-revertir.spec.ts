/**
 * Revertir una acción masiva, honesto (docs/imports-progreso-c3-spec.md §4.4, §5.7 y §9.1; CA-8):
 * rechaza lo que no puede deshacer entero, no corre dos veces a la vez y la marca final es condicional.
 */
import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { ImportService } from './imports.service';

beforeAll(() => Logger.overrideLogger(false));

interface Opciones {
    remesa?: Record<string, unknown> | null;
    /** `undefined` = sin fila de progreso (remesa anterior a la Fase A). */
    progreso?: { errorPostProceso: string | null; finishedAt: Date | null } | null;
    snaps?: unknown[];
    /** Cuántas filas afecta la marca condicional. */
    marcadas?: number;
    /** Hace que la lectura de snapshots espere a que el test la suelte (para dos pedidos a la vez). */
    esperarSnaps?: Promise<void>;
}

function armar(o: Opciones = {}) {
    const remesa =
        o.remesa === null
            ? null
            : {
                id: 5, empresaId: 10, categoria: 'ACCIONES', estadoProceso: 'FINALIZADA', accionRevertidaEn: null,
                progreso: o.progreso === undefined ? { errorPostProceso: null, finishedAt: new Date() } : o.progreso,
                ...o.remesa,
            };
    const snaps = o.snaps ?? [
        { id: 3, entidad: 'comentario', accion: 'INSERT', entidadId: 91, datosPrevios: null },
        { id: 2, entidad: 'contacto', accion: 'DELETE', entidadId: 7, datosPrevios: { deudorId: 1, tipo: 'telefono', valor: '1155' } },
        { id: 1, entidad: 'deudor', accion: 'UPDATE', entidadId: 1, datosPrevios: { nombre: 'ANTES' } },
    ];
    const prisma: any = {
        remesa: {
            findUnique: jest.fn().mockResolvedValue(remesa),
            updateMany: jest.fn().mockResolvedValue({ count: o.marcadas ?? 1 }),
        },
        accion_masiva_snapshot: {
            findMany: jest.fn().mockImplementation(async () => {
                if (o.esperarSnaps) await o.esperarSnaps;
                return snaps;
            }),
        },
        deudor: { update: jest.fn().mockResolvedValue({}) },
        contacto: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
        comentario: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const auditoria: any = { log: jest.fn().mockResolvedValue(undefined) };
    const svc = new ImportService(prisma, null as never, null as never, null as never, null as never, null as never, null as never, null as never, auditoria);
    return { svc, prisma, auditoria };
}

const codigo = (e: unknown) => (e as ConflictException).getResponse() as { code: string; message: string; statusCode: number };

describe('revertirAcciones — lo que rechaza', () => {
    it.each([
        ['FALLIDA', 'FALLIDA'],
        ['en curso', 'PROCESANDO'],
        ['borrador', 'PENDIENTE'],
    ])('REVERTIR_NO_TERMINO: una remesa %s da 409 y no toca nada', async (_n, estadoProceso) => {
        const { svc, prisma, auditoria } = armar({ remesa: { estadoProceso } });
        const e = await svc.revertirAcciones(5, 9).catch((x) => x);
        expect(e).toBeInstanceOf(ConflictException);
        expect(codigo(e)).toMatchObject({
            statusCode: 409,
            code: 'REVERTIR_NO_TERMINO',
            message: 'Esta acción masiva no terminó bien: los datos para revertirla no se guardaron. Avisá a soporte; no la vuelvas a cargar.',
        });
        expect(prisma.accion_masiva_snapshot.findMany).not.toHaveBeenCalled();
        expect(prisma.remesa.updateMany).not.toHaveBeenCalled();
        expect(auditoria.log).not.toHaveBeenCalled();
    });

    it('REVERTIR_INCOMPLETO: FINALIZADA con errorPostProceso no nulo da 409 y deja accionRevertidaEn como estaba', async () => {
        const { svc, prisma } = armar({ progreso: { errorPostProceso: 'Guardando datos para revertir: se cayó', finishedAt: new Date() } });
        const e = await svc.revertirAcciones(5, 9).catch((x) => x);
        expect(codigo(e)).toMatchObject({
            code: 'REVERTIR_INCOMPLETO',
            message: 'Los datos para revertir esta acción no se guardaron completos: Revertir desharía solo una parte. Avisá a soporte.',
        });
        expect(prisma.deudor.update).not.toHaveBeenCalled();
        expect(prisma.remesa.updateMany).not.toHaveBeenCalled();
    });

    it('una FINALIZADA heredada, sin fila de progreso, se sigue pudiendo revertir', async () => {
        const { svc, prisma } = armar({ progreso: null });
        const r = await svc.revertirAcciones(5, 9);
        expect(r).toEqual({ yaRevertida: false, deudoresRevertidos: 1, contactosRestaurados: 1, comentariosBorrados: 1 });
        expect(prisma.remesa.updateMany).toHaveBeenCalledTimes(1);
    });

    it('la remesa no existe: 404; no es de acciones: 400; ya revertida: yaRevertida sin tocar nada', async () => {
        expect(await armar({ remesa: null }).svc.revertirAcciones(5).catch((x) => x)).toBeInstanceOf(NotFoundException);
        expect(await armar({ remesa: { categoria: 'DEUDORES' } }).svc.revertirAcciones(5).catch((x) => x)).toBeInstanceOf(BadRequestException);
        const { svc, prisma } = armar({ remesa: { accionRevertidaEn: new Date() } });
        expect(await svc.revertirAcciones(5)).toEqual({ yaRevertida: true, deudoresRevertidos: 0, contactosRestaurados: 0, comentariosBorrados: 0 });
        expect(prisma.accion_masiva_snapshot.findMany).not.toHaveBeenCalled();
    });

    it('una ya revertida que además está FALLIDA responde yaRevertida (el orden de las comprobaciones es el del diseño)', async () => {
        const { svc } = armar({ remesa: { accionRevertidaEn: new Date(), estadoProceso: 'FALLIDA' } });
        expect((await svc.revertirAcciones(5)).yaRevertida).toBe(true);
    });
});

describe('revertirAcciones — una sola reversión a la vez', () => {
    it('CA-8: dos pedidos simultáneos sobre una FINALIZADA: uno revierte y el otro 409 REVERSION_EN_CURSO; la auditoría tiene UN registro', async () => {
        let soltar!: () => void;
        const { svc, prisma, auditoria } = armar({ esperarSnaps: new Promise<void>((r) => { soltar = r; }) });

        const primero = svc.revertirAcciones(5, 9);
        const segundo = await svc.revertirAcciones(5, 9).catch((x) => x);
        soltar();
        const r = await primero;

        expect(r).toMatchObject({ yaRevertida: false, deudoresRevertidos: 1 });
        expect(codigo(segundo)).toMatchObject({
            code: 'REVERSION_EN_CURSO',
            message: 'Esta acción ya se está revirtiendo. Esperá a que termine y actualizá el Historial.',
        });
        expect(auditoria.log).toHaveBeenCalledTimes(1);
        expect(auditoria.log.mock.calls[0][0]).toMatchObject({ resumen: 'Revirtió acción masiva (remesa 5)' });
        expect(prisma.deudor.update).toHaveBeenCalledTimes(1);
        expect(prisma.remesa.updateMany).toHaveBeenCalledTimes(1);
    });

    it('el candado se libera si la reversión tira, y un reintento corre', async () => {
        const { svc, prisma } = armar();
        prisma.contacto.createMany.mockRejectedValueOnce(new Error('MySQL se cayó'));
        await expect(svc.revertirAcciones(5, 9)).rejects.toThrow('MySQL se cayó');
        expect(prisma.remesa.updateMany).not.toHaveBeenCalled();
        const r = await svc.revertirAcciones(5, 9);
        expect(r.yaRevertida).toBe(false);
    });

    it('pedidos sobre remesas distintas no se bloquean entre sí', async () => {
        let soltar!: () => void;
        const a = armar({ esperarSnaps: new Promise<void>((r) => { soltar = r; }) });
        const enCurso = a.svc.revertirAcciones(5, 9);
        // Misma instancia del servicio, otra remesa: el doble devuelve la misma fila, así que se pide con otro id.
        a.prisma.remesa.findUnique.mockResolvedValueOnce({
            id: 6, empresaId: 10, categoria: 'ACCIONES', estadoProceso: 'FINALIZADA', accionRevertidaEn: null, progreso: null,
        });
        const otra = a.svc.revertirAcciones(6, 9);
        soltar();
        await expect(Promise.all([enCurso, otra])).resolves.toHaveLength(2);
    });
});

describe('revertirAcciones — la marca final', () => {
    it('es condicional (accionRevertidaEn: null) y lleva quién revirtió', async () => {
        const { svc, prisma } = armar();
        await svc.revertirAcciones(5, 9);
        expect(prisma.remesa.updateMany).toHaveBeenCalledWith({
            where: { id: 5, accionRevertidaEn: null },
            data: { accionRevertidaEn: expect.any(Date), accionRevertidaPorId: 9 },
        });
    });

    it('si otra reversión ya la marcó (0 filas) no tira: lo revertido es idempotente y responde igual', async () => {
        const { svc, auditoria } = armar({ marcadas: 0 });
        const r = await svc.revertirAcciones(5, 9);
        expect(r).toEqual({ yaRevertida: false, deudoresRevertidos: 1, contactosRestaurados: 1, comentariosBorrados: 1 });
        expect(auditoria.log).toHaveBeenCalledTimes(1);
    });

    it('un caso que ya no existe no frena el resto de la reversión', async () => {
        const { svc, prisma } = armar();
        prisma.deudor.update.mockRejectedValueOnce(new Error('Record to update not found'));
        const r = await svc.revertirAcciones(5, 9);
        expect(r.deudoresRevertidos).toBe(1);
        expect(prisma.contacto.createMany).toHaveBeenCalledTimes(1);
        expect(prisma.comentario.deleteMany).toHaveBeenCalledTimes(1);
    });
});

describe('auditoría de revertir (auditoría de C3a)', () => {
    // El interceptor que deja @Audit en el método, con sus opciones: el texto sale de `opts.resumen(res, req)`.
    const resumen = (res: unknown) => {
        const { INTERCEPTORS_METADATA } = require('@nestjs/common/constants');
        const { ImportController } = require('./imports.controller');
        const [Interceptor] = Reflect.getMetadata(INTERCEPTORS_METADATA, ImportController.prototype.revertirAcciones);
        return new Interceptor({} as never).opts.resumen(res, { params: { id: '10711' } });
    };

    it('un pedido rechazado no queda como «Revirtió»', () => {
        expect(resumen(undefined)).toBe('Intentó revertir la acción masiva de la remesa 10711');
    });
    it('una ya revertida tampoco', () => {
        expect(resumen({ yaRevertida: true, deudoresRevertidos: 0, contactosRestaurados: 0, comentariosBorrados: 0 })).toBe('La acción masiva de la remesa 10711 ya estaba revertida');
    });
    it('la que revirtió, como siempre', () => {
        expect(resumen({ yaRevertida: false, deudoresRevertidos: 3, contactosRestaurados: 2, comentariosBorrados: 3 })).toBe('Revirtió acción masiva remesa 10711');
    });
});

