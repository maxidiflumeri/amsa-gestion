import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { ConversacionesService, EN_CURSO_VENCIDO_MS, MAX_TURNOS_CONVERSACION } from './conversaciones.service';
import { ResultadoTurno } from './turno/turno-runner';
import { DetalleRespuesta } from './dto/asistente.tipos';
import { VENTANA_TIEMPOS_NAVEGADOR_MS } from './conversaciones.service';
import { PRECIOS_DEFAULT } from './modelo/precios';

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

// ---- Detalle de la respuesta (docs/asistente-detalle-spec.md §7.9, §7.10, §14.1) ----------------------------------------

describe('ConversacionesService: el detalle de la respuesta', () => {
    beforeEach(() => {
        jest.spyOn(Logger.prototype, 'log').mockImplementation();
        jest.spyOn(Logger.prototype, 'warn').mockImplementation();
        jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());

    const fecha = new Date('2026-10-20T12:00:00Z');
    const traza: DetalleRespuesta = {
        version: 1, funcion: 'ayuda', modelo: 'm', estado: 'ok', motivo: null, totalMs: 1234, primerTextoMs: 900, costoUsd: 0.002, llamadas: 1,
        nodos: [{ tipo: 'llamada', desdeMs: 0, ms: 1000, numero: 1 }], parcial: false, incompleto: false, recortado: false, navegador: null,
    };
    const mensaje = (id: number, extra: Record<string, unknown> = {}) => ({
        id, rol: 'asistente', texto: 'r', ruta: null, fuentes: [], acciones: [], estado: 'ok', calificacion: null, createdAt: fecha, ms: 5000, pasos: null,
        traza: null, tiemposNavegador: null, ...extra,
    });
    const fila = (mensajeId: number, iteracion: number, finMs: number, ms: number, extra: Record<string, unknown> = {}) => ({
        mensajeId, iteracion, ms, createdAt: new Date(fecha.getTime() + finMs), costoUsd: '0.010000', stopReason: 'end_turn', error: null, modelo: 'us.anthropic.claude-sonnet-5-5',
        tokensEntrada: 10, tokensSalida: 20, tokensThinking: 0, cacheLectura: 0, cacheEscritura5m: 0, cacheEscritura1h: 0, ...extra,
    });
    function conConversacion(mensajes: unknown[]) {
        const a = armar();
        a.prisma.asistente_conversacion.findFirst.mockResolvedValue({ id: 9, titulo: 't', turnos: 1, updatedAt: fecha, funcion: 'ayuda', mensajes });
        a.prisma.asistente_llamada = { findMany: jest.fn().mockResolvedValue([]) };
        return a;
    }

    it('sin el permiso (conDetalle falso) ningún mensaje tiene la clave, ni siquiera null', async () => {
        const { svc, prisma } = conConversacion([mensaje(2, { traza }), mensaje(3)]);
        const d = await svc.detalle(7, 9);
        for (const m of d.mensajes) expect('detalle' in m).toBe(false);
        const d2 = await svc.detalle(7, 9, { conDetalle: false });
        for (const m of d2.mensajes) expect('detalle' in m).toBe(false);
        expect(prisma.asistente_llamada.findMany).not.toHaveBeenCalled();
    });

    it('con el permiso: la traza guardada más lo que midió el navegador; los mensajes de la persona no llevan la clave', async () => {
        const { svc, prisma } = conConversacion([
            { ...mensaje(1), rol: 'usuario', ruta: '/gestion' },
            mensaje(2, { traza, tiemposNavegador: { primeraSenalMs: 800, primerTextoMs: 900, totalMs: 1300 } }),
        ]);
        const d = await svc.detalle(7, 9, { conDetalle: true });
        expect('detalle' in d.mensajes[0]).toBe(false);
        expect(d.mensajes[1].detalle).toEqual({ ...traza, parcial: false, navegador: { primeraSenalMs: 800, primerTextoMs: 900, totalMs: 1300 } });
        // Con traza no hace falta ir a buscar las llamadas.
        expect(prisma.asistente_llamada.findMany).not.toHaveBeenCalled();
    });

    it('sin traza se reconstruye desde las llamadas con UNA consulta para toda la conversación, y queda «parcial»', async () => {
        const { svc, prisma } = conConversacion([mensaje(2), mensaje(4, { ms: 9000 })]);
        prisma.asistente_llamada.findMany.mockResolvedValue([
            fila(2, 0, 2000, 2000, { stopReason: 'tool_use' }),
            fila(2, 1, 8000, 3000),
            fila(4, 0, 100_000, 1500),
        ]);
        const d = await svc.detalle(7, 9, { conDetalle: true });
        expect(prisma.asistente_llamada.findMany).toHaveBeenCalledTimes(1);
        expect(prisma.asistente_llamada.findMany.mock.calls[0][0]).toMatchObject({ where: { conversacionId: 9, mensajeId: { in: [2, 4] } }, orderBy: { id: 'asc' } });
        const r = d.mensajes[0].detalle!;
        expect(r).toMatchObject({ parcial: true, llamadas: 2, funcion: 'ayuda', modelo: 'us.anthropic.claude-sonnet-5-5', navegador: null });
        expect(r.nodos.map((n) => n.tipo)).toEqual(['llamada', 'sin_detalle', 'llamada']);
        expect(r.costoUsd).toBeCloseTo(0.02, 6);
        expect(d.mensajes[1].detalle).toMatchObject({ parcial: true, llamadas: 1 });
    });

    it('en_curso no tiene detalle todavía (null) y no se buscan sus llamadas; sin llamadas ni traza también es null', async () => {
        const { svc, prisma } = conConversacion([mensaje(2, { estado: 'en_curso' }), mensaje(3)]);
        const d = await svc.detalle(7, 9, { conDetalle: true });
        expect(d.mensajes[0].detalle).toBeNull();
        expect(d.mensajes[1].detalle).toBeNull();
        expect(prisma.asistente_llamada.findMany.mock.calls[0][0].where).toEqual({ conversacionId: 9, mensajeId: { in: [3] } });
    });

    it('una respuesta que quedó sin texto en error es «sin_terminar»; el precio sale de MedicionService', async () => {
        const a = conConversacion([mensaje(2, { estado: 'error', texto: '' })]);
        a.prisma.asistente_llamada.findMany.mockResolvedValue([fila(2, 0, 1000, 1000, { tokensThinking: 10, tokensSalida: 50 })]);
        const precioDe = jest.fn().mockResolvedValue(PRECIOS_DEFAULT['us.anthropic.claude-sonnet-5-5']);
        const svc = new ConversacionesService(a.prisma, a.adjuntos as never, a.propuestas as never, { precioDe } as never);
        const d = await svc.detalle(7, 9, { conDetalle: true });
        expect(d.mensajes[0].detalle).toMatchObject({ motivo: 'sin_terminar', estado: 'error', parcial: true });
        expect(precioDe).toHaveBeenCalledWith('us.anthropic.claude-sonnet-5-5');
    });

    it('un JSON raro en traza no rompe la lectura: se reconstruye', async () => {
        const { svc, prisma } = conConversacion([mensaje(2, { traza: { cualquier: 'cosa' } })]);
        prisma.asistente_llamada.findMany.mockResolvedValue([fila(2, 0, 1000, 1000)]);
        const d = await svc.detalle(7, 9, { conDetalle: true });
        expect(d.mensajes[0].detalle).toMatchObject({ parcial: true });
    });

    describe('guardarTraza', () => {
        it('escribe solo la columna traza del mensaje', async () => {
            const { svc, prisma } = armar();
            await svc.guardarTraza(5, traza);
            expect(prisma.asistente_mensaje.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { traza } });
        });
    });

    describe('registrarTiemposNavegador', () => {
        const t = { primeraSenalMs: 800, primerTextoMs: 900, totalMs: 1300 };

        it('guarda solo si todavía no había (la primera escritura gana) y solo de un mensaje propio, terminado y reciente', async () => {
            const { svc, prisma } = armar();
            prisma.asistente_mensaje.updateMany.mockResolvedValue({ count: 1 });
            const antes = Date.now();
            await svc.registrarTiemposNavegador(7, 30, t);
            const arg = prisma.asistente_mensaje.updateMany.mock.calls[0][0];
            expect(arg.where).toMatchObject({ id: 30, usuarioId: 7, rol: 'asistente', estado: { not: 'en_curso' } });
            expect(arg.where.tiemposNavegador).toBeDefined();
            expect(arg.where.createdAt.gte.getTime()).toBeGreaterThanOrEqual(antes - VENTANA_TIEMPOS_NAVEGADOR_MS - 1000);
            expect(arg.where.createdAt.gte.getTime()).toBeLessThanOrEqual(Date.now() - VENTANA_TIEMPOS_NAVEGADOR_MS + 1000);
            expect(arg.data).toEqual({ tiemposNavegador: t });
            expect(prisma.asistente_mensaje.findFirst).not.toHaveBeenCalled();
        });

        it('si ya estaban cargados no cambia nada y no es un error', async () => {
            const { svc, prisma } = armar();
            prisma.asistente_mensaje.updateMany.mockResolvedValue({ count: 0 });
            prisma.asistente_mensaje.findFirst.mockResolvedValue({ id: 30 });
            await expect(svc.registrarTiemposNavegador(7, 30, t)).resolves.toBeUndefined();
        });

        it('ajeno, inexistente, de la persona, en curso o de hace más de 30 minutos: 404', async () => {
            const { svc, prisma } = armar();
            prisma.asistente_mensaje.updateMany.mockResolvedValue({ count: 0 });
            prisma.asistente_mensaje.findFirst.mockResolvedValue(null);
            await expect(svc.registrarTiemposNavegador(7, 30, t)).rejects.toBeInstanceOf(NotFoundException);
            // El findFirst usa los mismos filtros: por eso un mensaje ajeno o vencido no se confunde con «ya estaba».
            expect(prisma.asistente_mensaje.findFirst.mock.calls[0][0].where).toMatchObject({ id: 30, usuarioId: 7, rol: 'asistente', estado: { not: 'en_curso' } });
            expect(prisma.asistente_mensaje.findFirst.mock.calls[0][0].where.createdAt.gte).toBeInstanceOf(Date);
        });

        it('el primer texto o la primera señal después del total: 400 TIEMPOS_INVALIDOS, sin tocar la base', async () => {
            const { svc, prisma } = armar();
            for (const malo of [{ primerTextoMs: 2000, totalMs: 1000 }, { primeraSenalMs: 1001, totalMs: 1000 }]) {
                const e = await svc.registrarTiemposNavegador(7, 30, malo).catch((x) => x);
                expect(e).toBeInstanceOf(BadRequestException);
                expect(e.getResponse()).toMatchObject({ codigo: 'TIEMPOS_INVALIDOS' });
            }
            expect(prisma.asistente_mensaje.updateMany).not.toHaveBeenCalled();
        });

        it('los tiempos que faltan se guardan como null', async () => {
            const { svc, prisma } = armar();
            prisma.asistente_mensaje.updateMany.mockResolvedValue({ count: 1 });
            await svc.registrarTiemposNavegador(7, 30, { totalMs: 500 });
            expect(prisma.asistente_mensaje.updateMany.mock.calls[0][0].data).toEqual({ tiemposNavegador: { primeraSenalMs: null, primerTextoMs: null, totalMs: 500 } });
        });
    });

    describe('detalleDeMensaje (las 👎 de Consumo)', () => {
        it('de cualquier persona (no filtra por dueño), solo respuestas del asistente', async () => {
            const { svc, prisma } = armar();
            prisma.asistente_mensaje.findFirst.mockResolvedValue({ ...mensaje(102, { traza }), conversacion: { funcion: 'ayuda' } });
            prisma.asistente_llamada = { findMany: jest.fn() };
            const d = await svc.detalleDeMensaje(102);
            expect(prisma.asistente_mensaje.findFirst.mock.calls[0][0].where).toEqual({ id: 102, rol: 'asistente' });
            expect(d.totalMs).toBe(1234);
            expect(prisma.asistente_llamada.findMany).not.toHaveBeenCalled();
        });
        it('inexistente, de la persona o sin nada que mostrar: 404', async () => {
            const { svc, prisma } = armar();
            prisma.asistente_mensaje.findFirst.mockResolvedValue(null);
            await expect(svc.detalleDeMensaje(1)).rejects.toBeInstanceOf(NotFoundException);
            prisma.asistente_mensaje.findFirst.mockResolvedValue({ ...mensaje(2), conversacion: { funcion: 'ayuda' } });
            prisma.asistente_llamada = { findMany: jest.fn().mockResolvedValue([]) };
            await expect(svc.detalleDeMensaje(2)).rejects.toBeInstanceOf(NotFoundException);
        });
        it('al reconstruir, la consulta de llamadas lleva conversacionId (usa el índice de la FK; no hay uno por mensajeId)', async () => {
            const { svc, prisma } = armar();
            prisma.asistente_mensaje.findFirst.mockResolvedValue({ ...mensaje(2), conversacionId: 9, conversacion: { funcion: 'ayuda' } });
            prisma.asistente_llamada = { findMany: jest.fn().mockResolvedValue([fila(2, 0, 1000, 1000)]) };
            await svc.detalleDeMensaje(2);
            expect(prisma.asistente_llamada.findMany.mock.calls[0][0].where).toEqual({ conversacionId: 9, mensajeId: { in: [2] } });
        });
    });
});
