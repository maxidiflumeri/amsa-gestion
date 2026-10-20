import { BadRequestException, Logger } from '@nestjs/common';
import { validarPrecios } from './asistente-config.service';
import { FRASES_SIN_DOCUMENTAR, MedicionService, mesLocal, rangoDelMes } from './medicion.service';
import { PRECIOS_DEFAULT, calcularCosto, usoDeUsage } from './modelo/precios';
import { LlamadaRegistro } from './turno/turno-runner';

const PRECIO = PRECIOS_DEFAULT['us.anthropic.claude-haiku-5-5'];

function armar() {
    const create = jest.fn().mockResolvedValue({});
    const groupBy = jest.fn().mockResolvedValue([
        { funcion: 'ayuda', _sum: { costoUsd: '1.5' } },
        { funcion: 'reportes', _sum: { costoUsd: null } },
    ]);
    const prisma: any = { asistente_llamada: { create, groupBy } };
    const config: any = { precioVigente: jest.fn().mockResolvedValue(PRECIO) };
    return { svc: new MedicionService(prisma, config, { getRequestId: () => 'abc12345' } as any), create, groupBy, config };
}

const llamada = (uso: LlamadaRegistro['uso']): LlamadaRegistro => ({
    usuarioId: 7, conversacionId: 1, mensajeId: 3, funcion: 'ayuda', modelo: 'us.anthropic.claude-haiku-5-5', iteracion: 0, uso, ms: 900, stopReason: 'end_turn', error: null,
});

describe('MedicionService', () => {
    beforeEach(() => {
        jest.spyOn(Logger.prototype, 'log').mockImplementation();
        jest.spyOn(Logger.prototype, 'error').mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());

    it('guarda una fila por llamada con el costo de calcularCosto (±0,000001) y el requestId', async () => {
        const { svc, create } = armar();
        const uso = usoDeUsage({
            input_tokens: 123, output_tokens: 298, cache_read_input_tokens: 0, cache_creation_input_tokens: 11166,
            cache_creation: { ephemeral_5m_input_tokens: 11166, ephemeral_1h_input_tokens: 0 }, output_tokens_details: { thinking_tokens: 238 },
        });
        const costo = await svc.registrarLlamada(llamada(uso));
        expect(Math.abs(costo - calcularCosto(uso, PRECIO))).toBeLessThanOrEqual(0.000001);
        expect(create.mock.calls[0][0].data).toMatchObject({
            tokensEntrada: 123, tokensSalida: 298, tokensThinking: 238, cacheEscritura5m: 11166, cacheLectura: 0,
            costoUsd: costo, ms: 900, stopReason: 'end_turn', requestId: 'abc12345', error: null,
        });
    });

    it('costea con el precio del modelo DE LA LLAMADA (reportes corre con Sonnet, la ayuda con Haiku)', async () => {
        const { svc, config } = armar();
        const sonnet = PRECIOS_DEFAULT['us.anthropic.claude-sonnet-5-5'];
        config.precioVigente.mockImplementation(async (m: string) => (m === 'us.anthropic.claude-sonnet-5-5' ? sonnet : PRECIO));
        const uso = usoDeUsage({ input_tokens: 1000, output_tokens: 100 });
        const costo = await svc.registrarLlamada({ ...llamada(uso), funcion: 'reportes', modelo: 'us.anthropic.claude-sonnet-5-5' });
        expect(config.precioVigente).toHaveBeenCalledWith('us.anthropic.claude-sonnet-5-5');
        expect(Math.abs(costo - calcularCosto(uso, sonnet))).toBeLessThanOrEqual(0.000001);
        expect(costo).toBeGreaterThan(calcularCosto(uso, PRECIO) * 10);
    });

    it('si la base falla, el costo no se pierde: se devuelve igual y queda en el log con todo para reconstruirlo', async () => {
        const { svc, create } = armar();
        create.mockRejectedValue(new Error('db caída'));
        const uso = usoDeUsage({ input_tokens: 1000, output_tokens: 100 });
        const costo = await svc.registrarLlamada(llamada(uso));
        expect(costo).toBeGreaterThan(0);
        const log = (Logger.prototype.error as jest.Mock).mock.calls[0][0] as string;
        expect(log).toContain(`costo=$${costo}`);
        expect(log).toContain('in=1000');
        expect(log).toContain('out=100');
    });

    it('sin precio del modelo registra costo 0 y lo grita en el log', async () => {
        const { svc, config } = armar();
        config.precioVigente.mockResolvedValue(null);
        await expect(svc.registrarLlamada(llamada(usoDeUsage({ input_tokens: 5 })))).resolves.toBe(0);
        expect(Logger.prototype.error).toHaveBeenCalled();
    });

    it('el gasto del mes se lee una vez, se reutiliza y se suma en caliente después de cada llamada', async () => {
        const { svc, groupBy } = armar();
        const g1 = await svc.gastoDelMes();
        expect(g1.total).toBe(1.5);
        expect(g1.porFuncion).toEqual({ ayuda: 1.5, reportes: 0 });
        await svc.gastoDelMes();
        expect(groupBy).toHaveBeenCalledTimes(1);

        const costo = await svc.registrarLlamada(llamada(usoDeUsage({ input_tokens: 100000, output_tokens: 1000 })));
        const g2 = await svc.gastoDelMes();
        expect(g2.total).toBeCloseTo(1.5 + costo, 9);
        expect(g2.porFuncion.ayuda).toBeCloseTo(1.5 + costo, 9);
        expect(groupBy).toHaveBeenCalledTimes(1);
    });

    it('rangoDelMes y mesLocal usan la hora de Argentina', () => {
        const { desde, hasta } = rangoDelMes('2026-10');
        expect(desde.toISOString()).toBe('2026-10-01T03:00:00.000Z');
        expect(hasta.toISOString()).toBe('2026-11-01T03:00:00.000Z');
        expect(mesLocal(new Date('2026-11-01T02:59:59Z'))).toBe('2026-10');
        expect(mesLocal(new Date('2026-11-01T03:00:00Z'))).toBe('2026-11');
    });

    it('consumo con un mes mal escrito: 400', async () => {
        const { svc } = armar();
        await expect(svc.consumo('2026-13', null)).rejects.toBeInstanceOf(BadRequestException);
    });

    describe('validarPrecios', () => {
        const ok = { entrada: 1, salida: 2, cacheEscritura5m: 1, cacheEscritura1h: 1, cacheLectura: 0.1 };
        it('acepta un precio completo, con o sin tarifa larga', () => {
            expect(validarPrecios({ m: ok })).toEqual({ m: ok });
            const largo = validarPrecios({ m: { ...ok, umbralLargo: 100000, largo: ok } });
            expect(largo.m.umbralLargo).toBe(100000);
        });
        it('rechaza lo que no es un número entre 0 y 10000, o un precio incompleto', () => {
            expect(() => validarPrecios({ m: { ...ok, entrada: -1 } })).toThrow(BadRequestException);
            expect(() => validarPrecios({ m: { ...ok, salida: '2' } })).toThrow(BadRequestException);
            expect(() => validarPrecios({ m: { entrada: 1 } })).toThrow(BadRequestException);
            expect(() => validarPrecios([])).toThrow(BadRequestException);
            expect(() => validarPrecios({ m: { ...ok, umbralLargo: 10.5 } })).toThrow(BadRequestException);
        });
    });
});

describe('FRASES_SIN_DOCUMENTAR', () => {
    it('cuenta la frase exacta y las paráfrasis que se vieron en la auditoría', () => {
        const sinAcentos = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        const cuenta = (t: string) => FRASES_SIN_DOCUMENTAR.some((f) => sinAcentos(t).includes(f));
        expect(cuenta('Eso no está en la documentación.')).toBe(true);
        expect(cuenta('La documentación no tiene el paso a paso para cargar un mail.')).toBe(true);
        expect(cuenta('Andá a **Reportes** y tocá **Nueva plantilla**.')).toBe(false);
    });
});

// ---- Tiempos por paso (docs/asistente-detalle-spec.md §7.11) --------------------------------------------------------------

describe('MedicionService.tiempos', () => {
    beforeEach(() => {
        jest.spyOn(Logger.prototype, 'log').mockImplementation();
        jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());

    const nodoLlamada = (ms: number, fin = 'end_turn') => ({ tipo: 'llamada', desdeMs: 0, ms, fin, hijos: [{ tipo: 'espera', desdeMs: 0, ms: ms / 2 }] });
    const traza = (funcion: string, totalMs: number, extra: object = {}) => ({
        version: 1, funcion, modelo: 'm', estado: 'ok', motivo: null, totalMs, primerTextoMs: null, costoUsd: 0, llamadas: 1, parcial: false, incompleto: false, recortado: false, navegador: null,
        nodos: [{ tipo: 'preparacion', desdeMs: 0, ms: 100 }, nodoLlamada(totalMs - 100), { tipo: 'guardar', desdeMs: totalMs - 10, ms: 10 }], ...extra,
    });
    function armarTiempos(filas: unknown[]) {
        const findMany = jest.fn().mockResolvedValue(filas);
        const prisma: any = { asistente_mensaje: { findMany } };
        const config: any = { funciones: jest.fn().mockResolvedValue([{ clave: 'ayuda', nombre: 'Ayuda' }, { clave: 'reportes', nombre: 'Armar reportes' }]) };
        return { svc: new MedicionService(prisma, config), findMany };
    }

    it('tres trazas de dos funciones: filas, orden, mediana y p95 exactos, con el nombre legible de la función', async () => {
        const { svc, findMany } = armarTiempos([
            { traza: traza('ayuda', 1000), tiemposNavegador: { primeraSenalMs: 400, primerTextoMs: 500, totalMs: 1100 } },
            { traza: traza('ayuda', 3000), tiemposNavegador: null },
            { traza: traza('reportes', 20000), tiemposNavegador: null },
        ]);
        const t = await svc.tiempos('2026-10');
        expect(t).toMatchObject({ mes: '2026-10', respuestas: 3, recortado: false });
        expect(t.porFuncion.map((f) => [f.funcion, f.nombre])).toEqual([['ayuda', 'Ayuda'], ['reportes', 'Armar reportes']]);
        const filasAyuda = t.porFuncion[0].filas.map((f) => [f.paso, f.muestras, f.medianaMs, f.p95Ms]);
        expect(filasAyuda).toEqual([
            ['total', 2, 1000, 3000],
            ['navegador_total', 1, 1100, 1100],
            ['navegador_primer_texto', 1, 500, 500],
            ['preparacion', 2, 100, 100],
            ['llamada', 2, 900, 2900],
            ['espera', 2, 450, 1450],
            ['guardar', 2, 10, 10],
        ]);
        // Filtra por rol y por el mes, y solo trae las que tienen traza.
        const where = findMany.mock.calls[0][0].where;
        expect(where).toMatchObject({ rol: 'asistente' });
        expect(where.createdAt.gte).toEqual(new Date(2026, 9, 1));
        expect(where.createdAt.lt).toEqual(new Date(2026, 10, 1));
        expect(where.NOT).toBeDefined();
    });

    it('lo detenido o cortado no baja la mediana, y un JSON que no es un detalle se ignora', async () => {
        const { svc } = armarTiempos([
            { traza: traza('ayuda', 1000), tiemposNavegador: null },
            { traza: traza('ayuda', 50, { estado: 'cortado', nodos: [nodoLlamada(40, 'abortada')] }), tiemposNavegador: null },
            { traza: { cualquier: 'cosa' }, tiemposNavegador: null },
        ]);
        const t = await svc.tiempos('2026-10');
        expect(t.respuestas).toBe(2);
        const fila = (p: string) => t.porFuncion[0].filas.find((f) => f.paso === p)!;
        expect(fila('total').muestras).toBe(1);
        expect(fila('llamada').muestras).toBe(1);
    });

    it('5.001 filas: se usan 5.000 y va «recortado»', async () => {
        const filas = Array.from({ length: 5001 }, () => ({ traza: traza('ayuda', 1000), tiemposNavegador: null }));
        const { svc, findMany } = armarTiempos(filas);
        const t = await svc.tiempos('2026-10');
        expect(t).toMatchObject({ respuestas: 5000, recortado: true });
        expect(findMany.mock.calls[0][0]).toMatchObject({ take: 5001, orderBy: { id: 'desc' } });
    });

    it('un mes inválido da 400; sin mes, el corriente; una función que no está en la base va con su clave', async () => {
        const { svc } = armarTiempos([{ traza: traza('cartera', 500), tiemposNavegador: null }]);
        await expect(svc.tiempos('2026-13')).rejects.toBeInstanceOf(BadRequestException);
        const t = await svc.tiempos();
        expect(t.mes).toBe(mesLocal());
        expect(t.porFuncion[0]).toMatchObject({ funcion: 'cartera', nombre: 'cartera' });
    });

    it('precioDe delega en la configuración', async () => {
        const { svc } = armarTiempos([]);
        (svc as any).config.precioVigente = jest.fn().mockResolvedValue(PRECIO);
        await expect(svc.precioDe('x')).resolves.toBe(PRECIO);
    });
});
