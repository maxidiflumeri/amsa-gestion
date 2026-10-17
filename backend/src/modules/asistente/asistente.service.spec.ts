import { ConflictException, HttpException, Logger } from '@nestjs/common';
import { AsistenteService } from './asistente.service';
import { EventoSse } from './dto/asistente.tipos';
import { TurnosActivos } from './turnos-activos';
import { ResultadoTurno } from './turno/turno-runner';

const ok: ResultadoTurno = {
    estado: 'ok', texto: 'Listo', fuentes: [], acciones: [], apiUsuario: [], apiAsistente: [], costoUsd: 0.002, llamadas: 1, ms: 10,
};

function armar(opciones: { verificar?: jest.Mock; crear?: jest.Mock } = {}) {
    const turnos = new TurnosActivos();
    const topes: any = {
        verificarInicio: opciones.verificar ?? jest.fn().mockResolvedValue({ usadas: 1, limite: 100 }),
        verificarIteracion: jest.fn(),
        evaluarAvisos: jest.fn().mockResolvedValue(undefined),
    };
    const conversaciones: any = {
        crearTurno: opciones.crear ?? jest.fn().mockResolvedValue({
            conversacionId: 1, mensajeUsuarioId: 2, mensajeId: 3, versionWiki: 'v', historial: [], ultimoPromptTokens: 0,
        }),
        finalizarTurno: jest.fn().mockResolvedValue(undefined),
        marcarError: jest.fn().mockResolvedValue(undefined),
    };
    const prisma: any = { usuario: { findUnique: jest.fn().mockResolvedValue({ nombre: 'Ana María Pérez', rol: 'usuario', rolObj: { nombre: 'OPERADOR' } }) } };
    const wiki: any = { version: 'v', indice: '', slugs: [], paginaPrincipalParaRuta: () => undefined, pagina: () => undefined };
    const cliente: any = { stream: jest.fn() };
    const svc = new AsistenteService(prisma, topes, {} as any, conversaciones, wiki, { modelo: 'm', soportaStrict: true } as any, turnos, cliente);
    // El runner se sustituye por un doble: acá se prueba la orquestación, no el loop.
    const correr = jest.fn().mockResolvedValue(ok);
    (svc as any).runner = { correr };
    return { svc, turnos, topes, conversaciones, correr, prisma };
}

const u = { sub: 7, permisos: ['asistente.usar'] };
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
        expect(eventos).toEqual([{ evento: 'fin', data: { mensajeId: 3, estado: 'ok', texto: 'Listo', fuentes: [], acciones: [], ms: 10 } }]);
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
});
