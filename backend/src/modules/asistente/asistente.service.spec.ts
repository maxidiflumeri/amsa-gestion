import { BadRequestException, ConflictException, ForbiddenException, HttpException, Logger } from '@nestjs/common';
import { AsistenteService } from './asistente.service';
import { EventoSse } from './dto/asistente.tipos';
import { TurnosActivos } from './turnos-activos';
import { ResultadoTurno } from './turno/turno-runner';

const ok: ResultadoTurno = {
    estado: 'ok', texto: 'Listo', fuentes: [], acciones: [], apiUsuario: [], apiAsistente: [], costoUsd: 0.002, llamadas: 1, ms: 10,
};

function armar(opciones: { verificar?: jest.Mock; crear?: jest.Mock; funcionDe?: jest.Mock } = {}) {
    const turnos = new TurnosActivos();
    const topes: any = {
        verificarInicio: opciones.verificar ?? jest.fn().mockResolvedValue({ usadas: 1, limite: 100 }),
        verificarIteracion: jest.fn(),
        evaluarAvisos: jest.fn().mockResolvedValue(undefined),
    };
    const conversaciones: any = {
        crearTurno: opciones.crear ?? jest.fn().mockResolvedValue({
            conversacionId: 1, mensajeUsuarioId: 2, mensajeId: 3, versionWiki: 'v', historial: [], ultimoPromptTokens: 0, esPrimerTurno: true,
        }),
        funcionDe: opciones.funcionDe ?? jest.fn().mockResolvedValue(null),
        finalizarTurno: jest.fn().mockResolvedValue(undefined),
        marcarError: jest.fn().mockResolvedValue(undefined),
    };
    const prisma: any = { usuario: { findUnique: jest.fn().mockResolvedValue({ nombre: 'Ana María Pérez', rol: 'usuario', rolObj: { nombre: 'OPERADOR' } }) } };
    const wiki: any = { version: 'v', indice: '', slugs: [], paginaPrincipalParaRuta: () => undefined, pagina: () => undefined };
    const cliente: any = { stream: jest.fn() };
    const adjuntos: any = { paraTurno: jest.fn().mockResolvedValue({ ejemplos: [], nuevos: [], principalId: null }) };
    const propuestas: any = { ultimaMostrada: jest.fn().mockResolvedValue(null), asignarCosto: jest.fn().mockResolvedValue(undefined) };
    const svc = new AsistenteService(
        prisma, topes, {} as any, conversaciones, wiki,
        { modelo: 'm', soportaStrict: true, modeloPara: () => 'm', timeoutReportesMs: 1000 } as any,
        turnos, cliente, adjuntos, propuestas,
    );
    // El runner se sustituye por un doble: acá se prueba la orquestación, no el loop.
    const correr = jest.fn().mockResolvedValue(ok);
    (svc as any).runner = { correr };
    const correrReportes = jest.fn().mockResolvedValue({ ...ok, pasos: [{ tipo: 'prueba', estado: 'ok', texto: 'x' }], propuestas: [{ propuestaId: 9 }] });
    (svc as any).runnerReportes = Promise.resolve({ correr: correrReportes });
    return { svc, turnos, topes, conversaciones, correr, prisma, correrReportes, adjuntos, propuestas };
}

const u = { sub: 7, permisos: ['asistente.usar'] };
const uReportes = { sub: 7, permisos: ['asistente.usar', 'asistente.reportes', 'reportes.ver', 'reportes.crear'] };
const dto = { pregunta: 'hola', ruta: '/gestion' } as any;

describe('AsistenteService', () => {
    beforeEach(() => {
        jest.spyOn(Logger.prototype, 'log').mockImplementation();
        jest.spyOn(Logger.prototype, 'warn').mockImplementation();
        jest.spyOn(Logger.prototype, 'error').mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());

    it('un turno por persona: el segundo da 409 TURNO_EN_CURSO y el primero sigue vivo', async () => {
        const { svc, turnos } = armar();
        const a = await svc.preparar(u, dto);
        const e = await svc.preparar(u, dto).catch((x) => x);
        expect(e).toBeInstanceOf(ConflictException);
        expect(e.getResponse()).toMatchObject({ codigo: 'TURNO_EN_CURSO' });
        expect(turnos.cantidad()).toBe(1);
        await a.correr(() => undefined);
        expect(turnos.cantidad()).toBe(0);
        await expect(svc.preparar(u, dto)).resolves.toBeDefined();
    });

    it('otra persona sí puede preguntar a la vez', async () => {
        const { svc } = armar();
        await svc.preparar(u, dto);
        await expect(svc.preparar({ sub: 8 }, dto)).resolves.toBeDefined();
    });

    it('si falla un control previo (tope, límite diario), libera el turno y propaga el error', async () => {
        const falla = new HttpException({ codigo: 'LIMITE_DIARIO' }, 429);
        const { svc, turnos } = armar({ verificar: jest.fn().mockRejectedValue(falla) });
        await expect(svc.preparar(u, dto)).rejects.toBe(falla);
        expect(turnos.cantidad()).toBe(0);
    });

    it('si falla guardar la pregunta, libera el turno', async () => {
        const { svc, turnos } = armar({ crear: jest.fn().mockRejectedValue(new Error('db')) });
        await expect(svc.preparar(u, dto)).rejects.toThrow('db');
        expect(turnos.cantidad()).toBe(0);
    });

    it('turno ok: persiste y emite fin con el id del mensaje; la persona va con su primer nombre y el rol de la base', async () => {
        const { svc, conversaciones, correr } = armar();
        const t = await svc.preparar(u, dto);
        expect(t.inicio).toEqual({ conversacionId: 1, mensajeUsuarioId: 2, mensajeId: 3, limiteDiario: { usadas: 1, limite: 100 } });
        const eventos: EventoSse[] = [];
        await t.correr((e) => eventos.push(e));
        expect(correr.mock.calls[0][0].persona).toEqual({ nombre: 'Ana', rol: 'OPERADOR', permisos: ['asistente.usar'] });
        expect(conversaciones.finalizarTurno).toHaveBeenCalledWith({ conversacionId: 1, mensajeUsuarioId: 2, mensajeId: 3, resultado: ok });
        expect(eventos).toEqual([{ evento: 'fin', data: { mensajeId: 3, estado: 'ok', texto: 'Listo', fuentes: [], acciones: [], pasos: [], propuestas: [], ms: 10 } }]);
    });

    it('el log del turno no lleva el texto de la pregunta ni de la respuesta', async () => {
        const { svc } = armar();
        const t = await svc.preparar(u, { pregunta: 'DNI 30111222 secreto', ruta: '/gestion' } as any);
        await t.correr(() => undefined);
        const todo = (Logger.prototype.log as jest.Mock).mock.calls.map((c) => c[0]).join('\n');
        expect(todo).toContain('Turno asistente 3 terminado estado=ok');
        expect(todo).not.toContain('30111222');
        expect(todo).not.toContain('Listo');
    });

    it('turno con error del modelo: emite error (no fin) con el mensajeId', async () => {
        const { svc, correr } = armar();
        correr.mockResolvedValue({ ...ok, estado: 'error', error: { codigo: 'MODELO_NO_DISPONIBLE', mensaje: 'caído' } });
        const t = await svc.preparar(u, dto);
        const eventos: EventoSse[] = [];
        await t.correr((e) => eventos.push(e));
        expect(eventos).toEqual([{ evento: 'error', data: { codigo: 'MODELO_NO_DISPONIBLE', mensaje: 'caído', mensajeId: 3 } }]);
    });

    it('si algo explota adentro: marca el mensaje como error, emite error INTERNO y libera el turno', async () => {
        const { svc, correr, conversaciones, turnos } = armar();
        correr.mockRejectedValue(new Error('boom'));
        const t = await svc.preparar(u, dto);
        const eventos: EventoSse[] = [];
        await t.correr((e) => eventos.push(e));
        expect(conversaciones.marcarError).toHaveBeenCalledWith(3);
        expect(eventos).toHaveLength(1);
        expect(eventos[0]).toMatchObject({ evento: 'error', data: { codigo: 'INTERNO', mensajeId: 3 } });
        expect(turnos.cantidad()).toBe(0);
    });

    it('abortar() corta el signal que recibe el runner', async () => {
        const { svc, correr } = armar();
        const t = await svc.preparar(u, dto);
        t.abortar();
        await t.correr(() => undefined);
        expect(correr.mock.calls[0][0].signal.aborted).toBe(true);
    });

    describe('función de reportes (Fase B)', () => {
        const dtoR = { pregunta: 'armame un reporte', ruta: '/reportes', funcion: 'reportes', adjuntos: [4] } as any;

        it('sin asistente.reportes, reportes.ver o reportes.crear: 403 SIN_PERMISO_FUNCION y el turno se libera', async () => {
            for (const falta of ['asistente.reportes', 'reportes.ver', 'reportes.crear']) {
                const { svc, turnos, topes, conversaciones } = armar();
                const permisos = uReportes.permisos.filter((p) => p !== falta);
                const e = await svc.preparar({ sub: 7, permisos }, dtoR).catch((x) => x);
                expect(e).toBeInstanceOf(ForbiddenException);
                expect(e.getResponse()).toMatchObject({ codigo: 'SIN_PERMISO_FUNCION' });
                expect(turnos.cantidad()).toBe(0);
                expect(topes.verificarInicio).not.toHaveBeenCalled();
                expect(conversaciones.crearTurno).not.toHaveBeenCalled();
            }
        });

        it('despacha al runner de reportes, con la función y los adjuntos en crearTurno, y emite pasos y propuestas en fin', async () => {
            const { svc, conversaciones, topes, correr, correrReportes, propuestas } = armar();
            const t = await svc.preparar(uReportes, dtoR);
            expect(topes.verificarInicio).toHaveBeenCalledWith(7, 'reportes');
            expect(conversaciones.crearTurno).toHaveBeenCalledWith(expect.objectContaining({ funcion: 'reportes', adjuntoIds: [4] }));
            const eventos: EventoSse[] = [];
            await t.correr((e) => eventos.push(e));
            expect(correr).not.toHaveBeenCalled();
            expect(correrReportes).toHaveBeenCalledTimes(1);
            expect(correrReportes.mock.calls[0][0]).toMatchObject({ esPrimerTurno: true, previos: [], persona: { nombre: 'Ana', rol: 'OPERADOR' } });
            const fin = eventos.find((e) => e.evento === 'fin') as Extract<EventoSse, { evento: 'fin' }>;
            expect(fin.data.pasos).toHaveLength(1);
            expect(fin.data.propuestas).toHaveLength(1);
            expect(propuestas.asignarCosto).toHaveBeenCalledWith(3, ok.costoUsd);
        });

        it('la ayuda no recibe adjuntos: 400 ADJUNTO_INVALIDO', async () => {
            const { svc, turnos } = armar();
            const e = await svc.preparar(u, { ...dto, funcion: 'ayuda', adjuntos: [4] }).catch((x) => x);
            expect(e).toBeInstanceOf(BadRequestException);
            expect(e.getResponse()).toMatchObject({ codigo: 'ADJUNTO_INVALIDO' });
            expect(turnos.cantidad()).toBe(0);
        });

        it('una conversación de ayuda no se usa en reportes: 409 FUNCION_DISTINTA', async () => {
            const { svc, turnos } = armar({ funcionDe: jest.fn().mockResolvedValue('ayuda') });
            const e = await svc.preparar(uReportes, { ...dtoR, conversacionId: 5 }).catch((x) => x);
            expect(e).toBeInstanceOf(ConflictException);
            expect(e.getResponse()).toMatchObject({ codigo: 'FUNCION_DISTINTA' });
            expect(turnos.cantidad()).toBe(0);
        });

        it('FUNCION_DISTINTA dice de cuál es la conversación: una de reportes no es «de ayuda»', async () => {
            const { svc } = armar({ funcionDe: jest.fn().mockResolvedValue('reportes') });
            const e = await svc.preparar(uReportes, { pregunta: 'x', ruta: '/gestion', funcion: 'ayuda', conversacionId: 5 } as any).catch((x) => x);
            expect(e.getResponse().mensaje).toContain('Esta conversación es de «Armar un reporte»');
            expect(e.getResponse().mensaje).not.toContain('es de ayuda');
            const b = armar({ funcionDe: jest.fn().mockResolvedValue('ayuda') });
            const e2 = await b.svc.preparar(uReportes, { ...dtoR, conversacionId: 5 }).catch((x) => x);
            expect(e2.getResponse().mensaje).toContain('Esta conversación es de ayuda');
        });

        it('el 403 de la función nombra «Ver reportes»', async () => {
            const { svc } = armar();
            const e = await svc.preparar({ sub: 7, permisos: ['asistente.usar'] }, dtoR).catch((x) => x);
            expect(e.getResponse().mensaje).toContain('«Ver reportes»');
        });

        it('sin funcion en el pedido rige la de la conversación', async () => {
            const { svc, topes } = armar({ funcionDe: jest.fn().mockResolvedValue('reportes') });
            await svc.preparar(uReportes, { pregunta: 'ajustá', ruta: '/reportes', conversacionId: 5 } as any);
            expect(topes.verificarInicio).toHaveBeenCalledWith(7, 'reportes');
        });

        it('el log del turno de reportes no lleva el texto de la pregunta', async () => {
            const { svc } = armar();
            const t = await svc.preparar(uReportes, { ...dtoR, pregunta: 'DNI 30111222 secreto' });
            await t.correr(() => undefined);
            const todo = (Logger.prototype.log as jest.Mock).mock.calls.map((c) => c[0]).join('\n');
            expect(todo).not.toContain('30111222');
        });
    });
});
