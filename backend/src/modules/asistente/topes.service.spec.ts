import { HttpException, Logger } from '@nestjs/common';
import { TipoNotificacion } from '@prisma/client';
import { TopeError } from './turno/errores';
import { TopesService } from './topes.service';

const PRECIO = { entrada: 1, salida: 1, cacheEscritura5m: 1, cacheEscritura1h: 1, cacheLectura: 1 };

function armar(
    opts: {
        habilitado?: boolean;
        funcionHabilitada?: boolean;
        topeFuncion?: number | null;
        tope?: number;
        gasto?: number;
        gastoFuncion?: number;
        hechasHoy?: number;
        limite?: number;
        topeTurno?: number;
        precio?: object | null;
        wiki?: boolean;
        admins?: number[];
        aviso?: number;
    } = {},
) {
    const cfg = {
        habilitado: opts.habilitado ?? true,
        topeMensualUsd: opts.tope ?? 100,
        avisoPorcentaje: opts.aviso ?? 80,
        limiteDiarioUsuario: opts.limite ?? 100,
        topeTurnoUsd: opts.topeTurno ?? 0.05,
        precios: null,
    };
    const config: any = {
        leer: jest.fn().mockResolvedValue(cfg),
        funcion: jest.fn().mockResolvedValue({
            clave: 'ayuda', nombre: 'Ayuda', habilitada: opts.funcionHabilitada ?? true, topeMensualUsd: opts.topeFuncion ?? null,
        }),
        precioVigente: jest.fn().mockResolvedValue(opts.precio === undefined ? PRECIO : opts.precio),
        administradoresActivos: jest.fn().mockResolvedValue(opts.admins ?? [1, 2]),
    };
    const medicion: any = {
        gastoDelMes: jest.fn().mockResolvedValue({ mes: '2026-10', total: opts.gasto ?? 0, porFuncion: { ayuda: opts.gastoFuncion ?? opts.gasto ?? 0 } }),
    };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma: any = {
        asistente_mensaje: { count: jest.fn().mockResolvedValue(opts.hechasHoy ?? 0) },
        asistente_config: { updateMany },
    };
    const wiki: any = { disponible: opts.wiki ?? true };
    const notificaciones: any = { crear: jest.fn().mockResolvedValue(undefined) };
    const svc = new TopesService(prisma, config, medicion, wiki, { modelo: 'us.anthropic.claude-haiku-5-5' } as any, notificaciones);
    return { svc, prisma, config, medicion, updateMany, notificaciones };
}

const codigoDe = async (p: Promise<unknown>) => {
    try {
        await p;
    } catch (e) {
        expect(e).toBeInstanceOf(HttpException);
        return { status: (e as HttpException).getStatus(), body: (e as HttpException).getResponse() as Record<string, unknown> };
    }
    throw new Error('no lanzó');
};

describe('TopesService', () => {
    let warn: jest.SpyInstance;
    beforeEach(() => {
        jest.spyOn(Logger.prototype, 'log').mockImplementation();
        jest.spyOn(Logger.prototype, 'error').mockImplementation();
        warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    });
    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    describe('verificarInicio', () => {
        it('todo en orden: devuelve cuántas preguntas lleva hoy contando la que entra', async () => {
            const { svc } = armar({ hechasHoy: 4 });
            await expect(svc.verificarInicio(7, 'ayuda')).resolves.toEqual({ usadas: 5, limite: 100 });
        });

        it('el rechazo por tope mensual dispara los avisos (bajar el tope por debajo de lo gastado no pasa por ninguna llamada)', async () => {
            const { svc, notificaciones } = armar({ gasto: 5, tope: 1, admins: [1] });
            await codigoDe(svc.verificarInicio(7, 'ayuda'));
            expect(notificaciones.crear).toHaveBeenCalledTimes(2);
        });

        it('pausado por un administrador: 429 PAUSADO (no 503: no es una falla del servidor)', async () => {
            const { svc } = armar({ habilitado: false });
            const r = await codigoDe(svc.verificarInicio(7, 'ayuda'));
            expect(r.status).toBe(429);
            expect(r.body).toMatchObject({ codigo: 'PAUSADO', mensaje: 'El asistente está pausado por un administrador.' });
        });

        it('función apagada: 429 PAUSADO', async () => {
            const { svc } = armar({ funcionHabilitada: false });
            const r = await codigoDe(svc.verificarInicio(7, 'ayuda'));
            expect(r.status).toBe(429);
            expect(r.body).toMatchObject({ codigo: 'PAUSADO' });
        });

        it('gasto del mes en el tope: 429 TOPE_MENSUAL (con el mensaje del spec)', async () => {
            const { svc } = armar({ gasto: 100, tope: 100 });
            const r = await codigoDe(svc.verificarInicio(7, 'ayuda'));
            expect(r.status).toBe(429);
            expect(r.body).toMatchObject({ codigo: 'TOPE_MENSUAL' });
            expect(String(r.body.mensaje)).toContain('Vuelve el 1.º');
        });

        it('justo debajo del tope todavía responde', async () => {
            const { svc } = armar({ gasto: 99.99, tope: 100 });
            await expect(svc.verificarInicio(7, 'ayuda')).resolves.toBeDefined();
        });

        it('tope propio de la función: 429 TOPE_FUNCION aunque el global no esté', async () => {
            const { svc } = armar({ gasto: 10, tope: 100, topeFuncion: 5, gastoFuncion: 5 });
            const r = await codigoDe(svc.verificarInicio(7, 'ayuda'));
            expect(r.status).toBe(429);
            expect(r.body).toMatchObject({ codigo: 'TOPE_FUNCION' });
        });

        it('sin precio del modelo: 503 SIN_PRECIO (nunca se cuenta un costo en cero)', async () => {
            const { svc } = armar({ precio: null });
            const r = await codigoDe(svc.verificarInicio(7, 'ayuda'));
            expect(r.status).toBe(503); // falla de configuración: sí tiene que alarmar
            expect(r.body).toMatchObject({ codigo: 'SIN_PRECIO' });
        });

        it('sin wiki: 503 SIN_WIKI', async () => {
            const { svc } = armar({ wiki: false });
            const r = await codigoDe(svc.verificarInicio(7, 'ayuda'));
            expect(r.status).toBe(503);
            expect(r.body).toMatchObject({ codigo: 'SIN_WIKI' });
        });

        it('límite diario: la pregunta 100 entra, la 101 da 429', async () => {
            const entra = armar({ hechasHoy: 99, limite: 100 });
            await expect(entra.svc.verificarInicio(7, 'ayuda')).resolves.toEqual({ usadas: 100, limite: 100 });

            const noEntra = armar({ hechasHoy: 100, limite: 100 });
            const r = await codigoDe(noEntra.svc.verificarInicio(7, 'ayuda'));
            expect(r.status).toBe(429);
            expect(r.body).toMatchObject({ codigo: 'LIMITE_DIARIO', usadas: 100, limite: 100 });
            expect(r.body.mensaje).toBe('Llegaste al límite de 100 preguntas de hoy. Mañana se renueva.');
        });

        it('cuenta las preguntas de HOY en hora de Argentina (desde las 00:00 locales)', async () => {
            jest.useFakeTimers().setSystemTime(new Date('2026-10-16T02:30:00Z')); // 23:30 del 15 en Argentina
            const { svc, prisma } = armar();
            await svc.verificarInicio(7, 'ayuda');
            const desde: Date = prisma.asistente_mensaje.count.mock.calls[0][0].where.createdAt.gte;
            expect(desde.toISOString()).toBe('2026-10-15T03:00:00.000Z');
        });
    });

    describe('verificarIteracion', () => {
        it('tope mensual y de función entre iteraciones lanzan TopeError', async () => {
            await expect(armar({ gasto: 100 }).svc.verificarIteracion('ayuda', 0)).rejects.toMatchObject({ codigo: 'TOPE_MENSUAL' });
            await expect(
                armar({ gasto: 3, topeFuncion: 3 }).svc.verificarIteracion('ayuda', 0),
            ).rejects.toBeInstanceOf(TopeError);
            await expect(
                armar({ gasto: 3, topeFuncion: 3 }).svc.verificarIteracion('ayuda', 0),
            ).rejects.toMatchObject({ codigo: 'TOPE_FUNCION' });
        });

        it('el tope del turno corta desde la segunda iteración, no la primera', async () => {
            const { svc } = armar({ topeTurno: 0.05 });
            await expect(svc.verificarIteracion('ayuda', 0)).resolves.toBeUndefined();
            await expect(svc.verificarIteracion('ayuda', 0.049)).resolves.toBeUndefined();
            await expect(svc.verificarIteracion('ayuda', 0.05)).rejects.toMatchObject({ codigo: 'TOPE_TURNO' });
        });
    });

    describe('avisos', () => {
        it('al 80 %: una notificación SISTEMA a cada administrador, una por destinatario', async () => {
            const { svc, notificaciones, updateMany } = armar({ gasto: 80, tope: 100, admins: [4, 5, 6] });
            await svc.evaluarAvisos();
            expect(updateMany).toHaveBeenCalledTimes(1);
            expect(notificaciones.crear).toHaveBeenCalledTimes(3);
            expect(notificaciones.crear.mock.calls.map((c: any[]) => c[0].destinatarioPrincipalId)).toEqual([4, 5, 6]);
            expect(notificaciones.crear.mock.calls[0][0]).toMatchObject({
                tipo: TipoNotificacion.SISTEMA,
                rutaAccion: '/asistente/consumo',
                titulo: 'El asistente usó el 80 % del tope del mes',
            });
            // Sin incluirUsuariosConPermiso: las copias no generan el aviso emergente.
            expect(notificaciones.crear.mock.calls[0][0].incluirUsuariosConPermiso).toBeUndefined();
        });

        it('debajo del 80 % no avisa', async () => {
            const { svc, updateMany, notificaciones } = armar({ gasto: 79.9, tope: 100 });
            await svc.evaluarAvisos();
            expect(updateMany).not.toHaveBeenCalled();
            expect(notificaciones.crear).not.toHaveBeenCalled();
        });

        it('dos llamadas simultáneas: el updateMany condicional hace que avise un solo proceso', async () => {
            const { svc, updateMany, notificaciones } = armar({ gasto: 85, tope: 100, admins: [1] });
            updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
            await Promise.all([svc.evaluarAvisos(), svc.evaluarAvisos()]);
            expect(updateMany).toHaveBeenCalledTimes(2);
            expect(notificaciones.crear).toHaveBeenCalledTimes(1);
        });

        it('al 100 % avisa el parcial (si no lo había hecho) y el del tope', async () => {
            const { svc, notificaciones, updateMany } = armar({ gasto: 100.5, tope: 100, admins: [1] });
            await svc.evaluarAvisos();
            expect(updateMany).toHaveBeenCalledTimes(2);
            expect(notificaciones.crear.mock.calls.map((c: any[]) => c[0].titulo)).toEqual([
                'El asistente usó el 80 % del tope del mes',
                'El asistente llegó al tope del mes y se pausó',
            ]);
        });

        it('la condición del updateMany usa el mes en hora de Argentina (23:59 del 31 vs 00:00 del 1.º)', async () => {
            jest.useFakeTimers().setSystemTime(new Date('2026-11-01T02:59:59Z'));
            const a = armar({ gasto: 90, tope: 100, admins: [1] });
            await a.svc.evaluarAvisos();
            expect(a.updateMany.mock.calls[0][0].data).toEqual({ avisoParcialMes: '2026-10' });

            jest.setSystemTime(new Date('2026-11-01T03:00:00Z'));
            const b = armar({ gasto: 90, tope: 100, admins: [1] });
            await b.svc.evaluarAvisos();
            expect(b.updateMany.mock.calls[0][0].data).toEqual({ avisoParcialMes: '2026-11' });
        });

        it('ya avisado este mes (count 0): no notifica de nuevo', async () => {
            const { svc, updateMany, notificaciones } = armar({ gasto: 90, tope: 100 });
            updateMany.mockResolvedValue({ count: 0 });
            await svc.evaluarAvisos();
            expect(notificaciones.crear).not.toHaveBeenCalled();
        });

        it('sin administradores activos: warn y no se notifica a nadie', async () => {
            const { svc, notificaciones } = armar({ gasto: 90, tope: 100, admins: [] });
            await svc.evaluarAvisos();
            expect(notificaciones.crear).not.toHaveBeenCalled();
            expect(warn).toHaveBeenCalledWith(expect.stringContaining('Nadie activo tiene asistente.administrar'));
        });
    });

    it('estado: habilitado solo si no hay pausa, con las preguntas de hoy', async () => {
        const ok = await armar({ hechasHoy: 3 }).svc.estado(7);
        expect(ok).toEqual({ habilitado: true, pausa: null, limiteDiario: { usadas: 3, limite: 100 } });
        const pausado = await armar({ habilitado: false }).svc.estado(7);
        expect(pausado.habilitado).toBe(false);
        expect(pausado.pausa?.codigo).toBe('PAUSADO');
    });
});
