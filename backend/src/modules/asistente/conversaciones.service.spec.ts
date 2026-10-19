import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { ConversacionesService, EN_CURSO_VENCIDO_MS, MAX_TURNOS_CONVERSACION } from './conversaciones.service';
import { ResultadoTurno } from './turno/turno-runner';

function armar() {
    const tx: any = {
        asistente_conversacion: { findFirst: jest.fn(), create: jest.fn().mockResolvedValue({ id: 50 }) },
        asistente_mensaje: {
            findMany: jest.fn().mockResolvedValue([]),
            create: jest.fn().mockResolvedValueOnce({ id: 101 }).mockResolvedValueOnce({ id: 102 }),
        },
        asistente_llamada: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const prisma: any = {
        $transaction: jest.fn(async (arg: any) => (typeof arg === 'function' ? arg(tx) : Promise.all(arg))),
        asistente_conversacion: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn().mockResolvedValue({}) },
        asistente_mensaje: {
            findFirst: jest.fn(),
            update: jest.fn().mockResolvedValue({}),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
    };
    const adjuntos = { vincular: jest.fn().mockResolvedValue([]), chipsDeConversacion: jest.fn().mockResolvedValue(new Map()) };
    const propuestas = { tarjetasDeConversacion: jest.fn().mockResolvedValue(new Map()) };
    return { svc: new ConversacionesService(prisma, adjuntos as never, propuestas as never), prisma, tx, adjuntos, propuestas };
}

const p = { usuarioId: 7, pregunta: '¿Cómo cargo una promesa?', ruta: '/gestion', versionWiki: 'abc12345', funcion: 'ayuda' };

describe('ConversacionesService', () => {
    beforeEach(() => {
        jest.spyOn(Logger.prototype, 'log').mockImplementation();
        jest.spyOn(Logger.prototype, 'warn').mockImplementation();
        jest.spyOn(Logger.prototype, 'error').mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());

    describe('crearTurno', () => {
        it('conversación nueva: título recortado a 120, pregunta y mensaje del asistente en_curso', async () => {
            const { svc, tx } = armar();
            const r = await svc.crearTurno({ ...p, pregunta: 'x'.repeat(300) });
            expect(tx.asistente_conversacion.create.mock.calls[0][0].data).toMatchObject({ usuarioId: 7, titulo: 'x'.repeat(120), versionWiki: 'abc12345' });
            expect(r).toMatchObject({ conversacionId: 50, mensajeUsuarioId: 101, mensajeId: 102, historial: [], ultimoPromptTokens: 0 });
            const asistente = tx.asistente_mensaje.create.mock.calls[1][0].data;
            expect(asistente).toMatchObject({ rol: 'asistente', estado: 'en_curso', texto: '', apiMensajes: [] });
        });

        it('un emoji en el carácter 120 no se parte (antes daba 500 al guardar el título)', async () => {
            const { svc, tx } = armar();
            await svc.crearTurno({ ...p, pregunta: 'x'.repeat(119) + '😀' + 'y'.repeat(10) });
            const titulo: string = tx.asistente_conversacion.create.mock.calls[0][0].data.titulo;
            expect(Array.from(titulo)).toHaveLength(120);
            expect(titulo.endsWith('😀')).toBe(true);
        });

        it('conversacionId null es una conversación nueva, no un id', async () => {
            const { svc, tx } = armar();
            const r = await svc.crearTurno({ ...p, conversacionId: null as unknown as undefined });
            expect(tx.asistente_conversacion.findFirst).not.toHaveBeenCalled();
            expect(r.conversacionId).toBe(50);
        });

        it('el historial salta un turno guardado sin mensaje del asistente (si no, Bedrock da 400 en cada pregunta)', async () => {
            const { svc, tx } = armar();
            tx.asistente_conversacion.findFirst.mockResolvedValue({ id: 9, turnos: 2, versionWiki: 'v', funcion: 'ayuda' });
            tx.asistente_mensaje.findMany.mockResolvedValue([
                { rol: 'usuario', estado: 'ok', apiMensajes: [{ role: 'user', content: 'a' }, { role: 'system', content: 'ctx' }] },
                { rol: 'asistente', estado: 'ok', apiMensajes: [] },
                { rol: 'usuario', estado: 'ok', apiMensajes: [{ role: 'user', content: 'b' }, { role: 'system', content: 'ctx' }] },
                { rol: 'asistente', estado: 'ok', apiMensajes: [{ role: 'assistant', content: [{ type: 'text', text: 'resp' }] }] },
            ]);
            const r = await svc.crearTurno({ ...p, conversacionId: 9 });
            expect(r.historial).toHaveLength(1);
            expect(r.historial[0].mensajes.at(-1)).toMatchObject({ role: 'assistant' });
        });

        it('conversación ajena o inexistente: 404 (se busca por id Y por dueño)', async () => {
            const { svc, tx } = armar();
            tx.asistente_conversacion.findFirst.mockResolvedValue(null);
            await expect(svc.crearTurno({ ...p, conversacionId: 9 })).rejects.toBeInstanceOf(NotFoundException);
            expect(tx.asistente_conversacion.findFirst).toHaveBeenCalledWith({ where: { id: 9, usuarioId: 7 } });
            expect(tx.asistente_mensaje.create).not.toHaveBeenCalled();
        });

        it('40 turnos: 409 CONVERSACION_LLENA', async () => {
            const { svc, tx } = armar();
            tx.asistente_conversacion.findFirst.mockResolvedValue({ id: 9, turnos: MAX_TURNOS_CONVERSACION, versionWiki: 'v', funcion: 'ayuda' });
            const e = await svc.crearTurno({ ...p, conversacionId: 9 }).catch((x) => x);
            expect(e).toBeInstanceOf(ConflictException);
            expect(e.getResponse()).toMatchObject({ codigo: 'CONVERSACION_LLENA' });
        });

        it('reportes: una conversación de ayuda da 409 FUNCION_DISTINTA (y al revés)', async () => {
            const { svc, tx } = armar();
            tx.asistente_conversacion.findFirst.mockResolvedValue({ id: 9, turnos: 1, versionWiki: 'v', funcion: 'ayuda' });
            const e = await svc.crearTurno({ ...p, conversacionId: 9, funcion: 'reportes' }).catch((x) => x);
            expect(e).toBeInstanceOf(ConflictException);
            expect(e.getResponse()).toMatchObject({ codigo: 'FUNCION_DISTINTA' });
            expect(tx.asistente_mensaje.create).not.toHaveBeenCalled();
        });

        it('reportes: 12 turnos dan CONVERSACION_LLENA con el texto de reportes', async () => {
            const { svc, tx } = armar();
            tx.asistente_conversacion.findFirst.mockResolvedValue({ id: 9, turnos: 12, versionWiki: 'v', funcion: 'reportes' });
            const e = await svc.crearTurno({ ...p, conversacionId: 9, funcion: 'reportes' }).catch((x) => x);
            expect(e.getResponse()).toMatchObject({ codigo: 'CONVERSACION_LLENA', mensaje: expect.stringContaining('la última propuesta sigue disponible') });
        });

        it('reportes: un prompt de más de 100.000 tokens también la llena (el historial con thinking no se recorta)', async () => {
            const { svc, tx } = armar();
            tx.asistente_conversacion.findFirst.mockResolvedValue({ id: 9, turnos: 3, versionWiki: 'v', funcion: 'reportes' });
            tx.asistente_mensaje.findMany.mockResolvedValue([]);
            tx.asistente_llamada.findFirst.mockResolvedValue({ tokensEntrada: 10, cacheLectura: 100_000, cacheEscritura5m: 0, cacheEscritura1h: 0 });
            const e = await svc.crearTurno({ ...p, conversacionId: 9, funcion: 'reportes' }).catch((x) => x);
            expect(e.getResponse()).toMatchObject({ codigo: 'CONVERSACION_LLENA' });
        });

        it('reportes: el historial conserva los bloques thinking tal cual y los adjuntos se vinculan en la misma transacción', async () => {
            const { svc, tx, adjuntos } = armar();
            tx.asistente_conversacion.findFirst.mockResolvedValue({ id: 9, turnos: 1, versionWiki: 'v', funcion: 'reportes' });
            const asistente = [
                { role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 'firma' }, { type: 'text', text: 'hola' }] },
            ];
            tx.asistente_mensaje.findMany.mockResolvedValue([
                { rol: 'usuario', estado: 'ok', apiMensajes: [{ role: 'user', content: 'a' }, { role: 'system', content: 'ctx' }] },
                { rol: 'asistente', estado: 'ok', apiMensajes: asistente },
            ]);
            const r = await svc.crearTurno({ ...p, conversacionId: 9, funcion: 'reportes', adjuntoIds: [4, 5] });
            expect(r.historial[0].mensajes.at(-1)).toEqual(asistente[0]);
            expect(r.esPrimerTurno).toBe(false);
            expect(adjuntos.vincular).toHaveBeenCalledWith(tx, expect.objectContaining({ usuarioId: 7, conversacionId: 9, ids: [4, 5] }));
        });

        it('una conversación nueva es el primer turno', async () => {
            const { svc } = armar();
            const r = await svc.crearTurno({ ...p, funcion: 'reportes' });
            expect(r.esPrimerTurno).toBe(true);
        });

        it('el historial son solo los turnos ok/cortado, en orden; rechazados y con error quedan afuera', async () => {
            const { svc, tx } = armar();
            tx.asistente_conversacion.findFirst.mockResolvedValue({ id: 9, turnos: 3, versionWiki: 'vieja', funcion: 'ayuda' });
            const u = (id: number) => ({ rol: 'usuario', estado: 'ok', apiMensajes: [{ role: 'user', content: `q${id}` }, { role: 'system', content: 'c' }] });
            const a = (estado: string, t: string) => ({ rol: 'asistente', estado, apiMensajes: [{ role: 'assistant', content: [{ type: 'text', text: t }] }] });
            tx.asistente_mensaje.findMany.mockResolvedValue([u(1), a('ok', 'r1'), u(2), a('rechazado', 'x'), u(3), a('error', 'y'), u(4), a('cortado', 'r4')]);
            tx.asistente_llamada.findFirst.mockResolvedValue({ tokensEntrada: 10, cacheLectura: 11000, cacheEscritura5m: 500, cacheEscritura1h: 0 });
            const r = await svc.crearTurno({ ...p, conversacionId: 9 });
            expect(r.historial.map((t) => t.mensajes.map((m) => m.role).join(','))).toEqual(['user,system,assistant', 'user,system,assistant']);
            expect(r.historial[1].mensajes[0].content).toBe('q4');
            expect(r.ultimoPromptTokens).toBe(11510);
            expect(r.versionWiki).toBe('vieja');
        });
    });

    describe('finalizarTurno', () => {
        const res = (estado: ResultadoTurno['estado']): ResultadoTurno => ({
            estado, texto: 'hola', fuentes: [], acciones: [], apiUsuario: [{ role: 'user', content: 'q' }],
            apiAsistente: [{ role: 'assistant', content: [{ type: 'text', text: 'hola' }] }], costoUsd: 0.002, llamadas: 1, ms: 1200,
        });

        it('ok: guarda la respuesta, lo que aportó la pregunta y suma el turno y el costo', async () => {
            const { svc, prisma } = armar();
            await svc.finalizarTurno({ conversacionId: 50, mensajeUsuarioId: 101, mensajeId: 102, resultado: res('ok') });
            const conv = prisma.asistente_conversacion.update.mock.calls[0][0];
            expect(conv.data).toEqual({ turnos: { increment: 1 }, costoUsd: { increment: 0.002 } });
            const asistente = prisma.asistente_mensaje.update.mock.calls[1][0];
            expect(asistente.data).toMatchObject({ texto: 'hola', estado: 'ok', ms: 1200 });
            expect(asistente.data.apiMensajes).toHaveLength(1);
        });

        it('error o rechazado: no suma turno, el costo sí, y NO entra al historial', async () => {
            const { svc, prisma } = armar();
            await svc.finalizarTurno({ conversacionId: 50, mensajeUsuarioId: 101, mensajeId: 102, resultado: res('rechazado') });
            expect(prisma.asistente_conversacion.update.mock.calls[0][0].data).toEqual({ turnos: undefined, costoUsd: { increment: 0.002 } });
            expect(prisma.asistente_mensaje.update.mock.calls[1][0].data.apiMensajes).toEqual([]);
        });
    });

    it('al arrancar, los en_curso con más de 5 minutos pasan a error', async () => {
        const { svc, prisma } = armar();
        prisma.asistente_mensaje.updateMany.mockResolvedValue({ count: 2 });
        const ahora = new Date('2026-10-16T12:00:00Z');
        await expect(svc.barrerEnCurso(ahora)).resolves.toBe(2);
        expect(prisma.asistente_mensaje.updateMany).toHaveBeenCalledWith({
            where: { estado: 'en_curso', createdAt: { lt: new Date(ahora.getTime() - EN_CURSO_VENCIDO_MS) } },
            data: { estado: 'error' },
        });
        expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('2 mensajes'));
    });

    it('onModuleInit no rompe el arranque si la base falla', async () => {
        const { svc, prisma } = armar();
        prisma.asistente_mensaje.updateMany.mockRejectedValue(new Error('db'));
        await expect(svc.onModuleInit()).resolves.toBeUndefined();
        expect(Logger.prototype.error).toHaveBeenCalled();
    });

    describe('calificar', () => {
        it('1 y -1 guardan la calificación y el comentario; 0 la quita', async () => {
            const { svc, prisma } = armar();
            prisma.asistente_mensaje.findFirst.mockResolvedValue({ id: 5, rol: 'asistente' });
            await svc.calificar(7, 5, -1, '  Faltó el paso 3 ');
            expect(prisma.asistente_mensaje.update).toHaveBeenLastCalledWith({ where: { id: 5 }, data: { calificacion: -1, comentario: 'Faltó el paso 3' } });
            await svc.calificar(7, 5, 1);
            expect(prisma.asistente_mensaje.update).toHaveBeenLastCalledWith({ where: { id: 5 }, data: { calificacion: 1, comentario: null } });
            await svc.calificar(7, 5, 0, 'x');
            expect(prisma.asistente_mensaje.update).toHaveBeenLastCalledWith({ where: { id: 5 }, data: { calificacion: null, comentario: null } });
        });

        it('mensaje ajeno: 404 (se busca con el dueño); de rol usuario: 400', async () => {
            const { svc, prisma } = armar();
            prisma.asistente_mensaje.findFirst.mockResolvedValueOnce(null);
            await expect(svc.calificar(7, 5, 1)).rejects.toBeInstanceOf(NotFoundException);
            expect(prisma.asistente_mensaje.findFirst).toHaveBeenCalledWith({ where: { id: 5, usuarioId: 7 } });
            prisma.asistente_mensaje.findFirst.mockResolvedValueOnce({ id: 5, rol: 'usuario' });
            await expect(svc.calificar(7, 5, 1)).rejects.toBeInstanceOf(BadRequestException);
        });
    });

    describe('registrarAccion', () => {
        it('marca aceptada o rechazada solo esa acción', async () => {
            const { svc, prisma } = armar();
            prisma.asistente_mensaje.findFirst.mockResolvedValue({
                id: 5,
                acciones: [
                    { id: 'a', tipo: 'ir_a', ruta: '/x', etiqueta: 'X', motivo: 'm', resultado: null },
                    { id: 'b', tipo: 'ir_a', ruta: '/y', etiqueta: 'Y', motivo: 'm', resultado: null },
                ],
            });
            await svc.registrarAccion(7, 5, 'b', 'aceptada');
            const data = prisma.asistente_mensaje.update.mock.calls[0][0].data.acciones;
            expect(data.map((a: any) => a.resultado)).toEqual([null, 'aceptada']);
        });

        it('mensaje ajeno o acción inexistente: 404', async () => {
            const { svc, prisma } = armar();
            prisma.asistente_mensaje.findFirst.mockResolvedValueOnce(null);
            await expect(svc.registrarAccion(7, 5, 'a', 'aceptada')).rejects.toBeInstanceOf(NotFoundException);
            prisma.asistente_mensaje.findFirst.mockResolvedValueOnce({ id: 5, acciones: [] });
            await expect(svc.registrarAccion(7, 5, 'zzz', 'aceptada')).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe('detalle y listado', () => {
        it('solo las propias: detalle de una ajena da 404', async () => {
            const { svc, prisma } = armar();
            prisma.asistente_conversacion.findFirst.mockResolvedValue(null);
            await expect(svc.detalle(7, 9)).rejects.toBeInstanceOf(NotFoundException);
            expect(prisma.asistente_conversacion.findFirst.mock.calls[0][0].where).toEqual({ id: 9, usuarioId: 7 });
        });

        it('el listado filtra por dueño y limita a 50', async () => {
            const { svc, prisma } = armar();
            prisma.asistente_conversacion.findMany.mockResolvedValue([]);
            await svc.listar(7, 500);
            expect(prisma.asistente_conversacion.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: { usuarioId: 7 }, take: 50 }),
            );
        });

        it('el detalle devuelve los mensajes con fuentes y acciones tipadas', async () => {
            const { svc, prisma } = armar();
            const fecha = new Date('2026-10-16T12:00:00Z');
            prisma.asistente_conversacion.findFirst.mockResolvedValue({
                id: 9, titulo: 't', turnos: 1, updatedAt: fecha,
                mensajes: [
                    { id: 1, rol: 'usuario', texto: 'q', ruta: '/gestion', fuentes: null, acciones: null, estado: 'ok', calificacion: null, createdAt: fecha },
                    { id: 2, rol: 'asistente', texto: 'r', ruta: null, fuentes: [{ slug: 'a/b', titulo: 'B' }], acciones: [], estado: 'ok', calificacion: -1, createdAt: fecha },
                ],
            });
            const d = await svc.detalle(7, 9);
            expect(d.mensajes[0]).toMatchObject({ rol: 'usuario', fuentes: [], acciones: [], calificacion: null });
            expect(d.mensajes[1]).toMatchObject({ rol: 'asistente', fuentes: [{ slug: 'a/b', titulo: 'B' }], calificacion: -1 });
        });
    });
});
