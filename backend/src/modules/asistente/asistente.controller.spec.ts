import { EventEmitter } from 'events';
import { ConflictException, HttpException } from '@nestjs/common';
import { AsistenteController, PING_SSE_MS } from './asistente.controller';
import { EventoSse } from './dto/asistente.tipos';
import { TurnoPreparado } from './asistente.service';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TiemposNavegadorDto } from './dto/tiempos-navegador.dto';

class ResFalsa extends EventEmitter {
    writableEnded = false;
    destroyed = false;
    cabeceras: Record<string, string> = {};
    status = 0;
    escrito: string[] = [];
    writeHead = jest.fn((status: number, h: Record<string, string>) => {
        this.status = status;
        this.cabeceras = h;
    });
    flushHeaders = jest.fn();
    write = jest.fn((s: string) => {
        this.escrito.push(s);
        return true;
    });
    end = jest.fn(() => {
        this.writableEnded = true;
        this.emit('close');
    });
}

const dto = { pregunta: 'hola', ruta: '/gestion' };
const usuario = { sub: 7, permisos: ['asistente.usar'] };

function armar(turno: Partial<TurnoPreparado> & { correr: TurnoPreparado['correr'] }, falla?: Error) {
    const preparado: TurnoPreparado = {
        inicio: { conversacionId: 1, mensajeUsuarioId: 2, mensajeId: 3, limiteDiario: { usadas: 1, limite: 100 } },
        abortar: jest.fn(),
        ...turno,
    };
    const servicio: any = { preparar: jest.fn(async () => { if (falla) throw falla; return preparado; }) };
    const ctrl = new AsistenteController(servicio, {} as any, {} as any);
    return { ctrl, servicio, preparado };
}

describe('AsistenteController.preguntar (SSE)', () => {
    afterEach(() => jest.useRealTimers());

    it('manda las cabeceras SSE, el evento inicio primero y cierra la respuesta al terminar', async () => {
        const { ctrl } = armar({
            correr: async (emitir) => {
                emitir({ evento: 'texto', data: { delta: 'Ho' } });
                emitir({ evento: 'fin', data: { mensajeId: 3, estado: 'ok', texto: 'Ho', fuentes: [], acciones: [], pasos: [], propuestas: [], ms: 5 } });
            },
        });
        const res = new ResFalsa();
        await ctrl.preguntar(dto as any, usuario, res as any);
        expect(res.status).toBe(200);
        expect(res.cabeceras).toMatchObject({
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
        expect(res.flushHeaders).toHaveBeenCalled();
        expect(res.escrito[0]).toBe('event: inicio\ndata: {"conversacionId":1,"mensajeUsuarioId":2,"mensajeId":3,"limiteDiario":{"usadas":1,"limite":100}}\n\n');
        expect(res.escrito[1]).toBe('event: texto\ndata: {"delta":"Ho"}\n\n');
        expect(res.escrito[2].startsWith('event: fin\n')).toBe(true);
        expect(res.end).toHaveBeenCalled();
    });

    it.each([
        ['validación o negocio previo al stream (503)', new HttpException({ codigo: 'PAUSADO', mensaje: 'x' }, 503)],
        ['límite diario (429)', new HttpException({ codigo: 'LIMITE_DIARIO' }, 429)],
        ['turno en curso (409)', new ConflictException({ codigo: 'TURNO_EN_CURSO' })],
    ])('error previo al stream: %s sale como excepción HTTP y no se escribe nada', async (_n, error) => {
        const { ctrl } = armar({ correr: async () => undefined }, error);
        const res = new ResFalsa();
        await expect(ctrl.preguntar(dto as any, usuario, res as any)).rejects.toBe(error);
        expect(res.writeHead).not.toHaveBeenCalled();
        expect(res.write).not.toHaveBeenCalled();
    });

    it('sin sesión (sin sub): 401 antes de tocar nada', async () => {
        const { ctrl, servicio } = armar({ correr: async () => undefined });
        await expect(ctrl.preguntar(dto as any, undefined as any, new ResFalsa() as any)).rejects.toThrow('Sesión inválida');
        expect(servicio.preparar).not.toHaveBeenCalled();
    });

    it('manda ": ping" cada 15 s mientras el turno corre y deja de mandarlo al terminar', async () => {
        jest.useFakeTimers();
        let terminar!: () => void;
        const { ctrl } = armar({ correr: () => new Promise<void>((r) => { terminar = r; }) });
        const res = new ResFalsa();
        const p = ctrl.preguntar(dto as any, usuario, res as any);
        await Promise.resolve();
        await Promise.resolve();
        expect(PING_SSE_MS).toBe(15000);
        jest.advanceTimersByTime(PING_SSE_MS);
        jest.advanceTimersByTime(PING_SSE_MS);
        expect(res.escrito.filter((s) => s === ': ping\n\n')).toHaveLength(2);
        terminar();
        await p;
        jest.advanceTimersByTime(PING_SSE_MS * 3);
        expect(res.escrito.filter((s) => s === ': ping\n\n')).toHaveLength(2);
    });

    it('si el cliente cierra la conexión a mitad, aborta el turno (corta el stream de Bedrock)', async () => {
        let terminar!: () => void;
        const { ctrl, preparado } = armar({ correr: () => new Promise<void>((r) => { terminar = r; }) });
        const res = new ResFalsa();
        const p = ctrl.preguntar(dto as any, usuario, res as any);
        await new Promise((r) => setImmediate(r));
        res.emit('close');
        expect(preparado.abortar).toHaveBeenCalledTimes(1);
        terminar();
        await p;
    });

    it('un cierre normal (después de res.end) no aborta', async () => {
        const { ctrl, preparado } = armar({ correr: async () => undefined });
        await ctrl.preguntar(dto as any, usuario, new ResFalsa() as any);
        expect(preparado.abortar).not.toHaveBeenCalled();
    });

    it('no escribe en una respuesta ya cerrada', async () => {
        const { ctrl } = armar({
            correr: async (emitir) => {
                emitir({ evento: 'texto', data: { delta: 'tarde' } } as EventoSse);
            },
        });
        const res = new ResFalsa();
        res.destroyed = true;
        await ctrl.preguntar(dto as any, usuario, res as any);
        expect(res.write).not.toHaveBeenCalled();
    });
});

// ---- Detalle de la respuesta (docs/asistente-detalle-spec.md §6.1, §14.1) -----------------------------------------------

describe('AsistenteController: el detalle de la respuesta', () => {
    const detalle = { version: 1, funcion: 'ayuda', nodos: [] };

    it('fin y error se escriben tal cual: con el detalle que arma el servicio, y sin la clave si el servicio no la puso', async () => {
        const { ctrl } = armar({
            correr: async (emitir) => {
                emitir({ evento: 'fin', data: { mensajeId: 3, estado: 'ok', texto: 'x', fuentes: [], acciones: [], pasos: [], propuestas: [], ms: 5, detalle: detalle as never } });
            },
        });
        const res = new ResFalsa();
        await ctrl.preguntar(dto as any, usuario, res as any);
        expect(res.escrito[1]).toContain('"detalle":{"version":1,"funcion":"ayuda","nodos":[]}');

        const sin = armar({ correr: async (emitir) => emitir({ evento: 'error', data: { codigo: 'INTERNO', mensaje: 'x', mensajeId: 3 } }) });
        const res2 = new ResFalsa();
        await sin.ctrl.preguntar(dto as any, usuario, res2 as any);
        expect(res2.escrito[1]).not.toContain('detalle');
    });

    function conServicios() {
        const conversaciones: any = {
            detalle: jest.fn().mockResolvedValue({ mensajes: [] }),
            registrarTiemposNavegador: jest.fn().mockResolvedValue(undefined),
        };
        return { ctrl: new AsistenteController({} as any, conversaciones, {} as any), conversaciones };
    }

    it('GET conversaciones/:id pide el detalle solo si el JWT tiene asistente.ver_detalle', async () => {
        const { ctrl, conversaciones } = conServicios();
        await ctrl.detalle({ sub: 7, permisos: ['asistente.usar'] }, 9);
        expect(conversaciones.detalle).toHaveBeenLastCalledWith(7, 9, { conDetalle: false });
        await ctrl.detalle({ sub: 7, permisos: ['asistente.usar', 'asistente.ver_detalle'] }, 9);
        expect(conversaciones.detalle).toHaveBeenLastCalledWith(7, 9, { conDetalle: true });
        await ctrl.detalle({ sub: 7 }, 9);
        expect(conversaciones.detalle).toHaveBeenLastCalledWith(7, 9, { conDetalle: false });
    });

    it('POST mensajes/:id/tiempos: pasa los tiempos de la persona logueada (responde 204)', async () => {
        const { ctrl, conversaciones } = conServicios();
        await expect(ctrl.tiempos({ sub: 7, permisos: ['asistente.usar'] }, 30, { primeraSenalMs: 1, primerTextoMs: 2, totalMs: 3 })).resolves.toBeUndefined();
        expect(conversaciones.registrarTiemposNavegador).toHaveBeenCalledWith(7, 30, { primeraSenalMs: 1, primerTextoMs: 2, totalMs: 3 });
        expect(Reflect.getMetadata('__httpCode__', AsistenteController.prototype.tiempos)).toBe(204);
        expect(Reflect.getMetadata('permisos', AsistenteController.prototype.tiempos)).toEqual(['asistente.usar']);
    });

    describe('TiemposNavegadorDto', () => {
        const errores = async (o: object) => (await validate(plainToInstance(TiemposNavegadorDto, o))).map((e) => e.property);
        it('acepta enteros de 0 a 900.000 y los dos opcionales (también null)', async () => {
            expect(await errores({ totalMs: 0 })).toEqual([]);
            expect(await errores({ primeraSenalMs: 0, primerTextoMs: 900000, totalMs: 900000 })).toEqual([]);
            expect(await errores({ primeraSenalMs: null, primerTextoMs: null, totalMs: 10 })).toEqual([]);
        });
        it('rechaza negativos, más de 900.000, no enteros y el total ausente', async () => {
            expect(await errores({ totalMs: -1 })).toEqual(['totalMs']);
            expect(await errores({ totalMs: 900001 })).toEqual(['totalMs']);
            expect(await errores({ totalMs: 1.5 })).toEqual(['totalMs']);
            expect(await errores({ totalMs: '10' })).toEqual(['totalMs']);
            expect(await errores({ primeraSenalMs: -5, totalMs: 10 })).toEqual(['primeraSenalMs']);
            expect(await errores({ primerTextoMs: 900001, totalMs: 10 })).toEqual(['primerTextoMs']);
            expect(await errores({})).toEqual(['totalMs']);
        });
    });
});
