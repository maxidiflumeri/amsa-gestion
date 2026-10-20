import { Logger } from '@nestjs/common';
import { PruebaPropuestaService, conteoAproximado, definicionParaPrueba } from './prueba-propuesta.service';
import { SemaforoReportes } from './semaforo';
import { EntradaProbar, PlantillaNormalizada } from './tipos-reportes';
import { TrazaTurno } from '../turno/traza';

const col = (label: string, path: string) => ({ id: label, label, path });
const norm = (extra: Partial<PlantillaNormalizada['definicion']> = {}): PlantillaNormalizada => ({
    nombre: 'Prueba',
    descripcion: null,
    raiz: 'deudor',
    empresaId: 1,
    definicion: {
        columnas: [col('DNI', 'documento'), col('Saldo', 'saldo'), col('Email', 'contactos[tipo=email][0].valor'), col('Fija', '')],
        filtros: [{ id: 'f1', path: 'empresa.nombre', operador: 'eq', valor: 'TOYOTA' }],
        ordenamientos: [],
        cardinalidadDefault: 'concatenar',
        ...extra,
    },
    formatoSalida: 'xlsx',
    opcionesFormato: { xlsx: {} },
});
const entrada = (opciones: EntradaProbar['opciones'] = {}): EntradaProbar => ({ nombre: 'Prueba', empresa: 'TOYOTA', formatoSalida: 'xlsx', opciones, definicion: {} as never, mapeo: [] });
const tarjeta = { nombre: 'Prueba', descripcion: null, empresa: 'TOYOTA', formato: 'xlsx' as const, opciones: [], mapeo: [], filtros: [], orden: [] };
const ids = { conversacionId: 12, usuarioId: 7, mensajeId: 30 };

function armar(opts: { filas?: Record<string, unknown>[]; conteo?: number | Error | 'colgado'; preview?: Error | 'colgado'; semaforo?: SemaforoReportes; cantidad?: number } = {}) {
    const creadas: any[] = [];
    let n = opts.cantidad ?? 0;
    const prisma: any = {
        asistente_propuesta: {
            count: jest.fn(async () => n),
            create: jest.fn(async ({ data }: any) => {
                creadas.push(data);
                n++;
                return { id: 100 + n };
            }),
        },
    };
    const colgado = () => new Promise<never>(() => undefined);
    const executor: any = {
        execute: jest.fn(() => (opts.preview === 'colgado' ? colgado() : opts.preview instanceof Error ? Promise.reject(opts.preview) : Promise.resolve({ filas: opts.filas ?? [], totalFilas: (opts.filas ?? []).length, columnas: [] }))),
    };
    const asyncExec: any = {
        estimarFilas: jest.fn(() => (opts.conteo === 'colgado' ? colgado() : opts.conteo instanceof Error ? Promise.reject(opts.conteo) : Promise.resolve(opts.conteo ?? 8412))),
    };
    const svc = new PruebaPropuestaService(prisma, executor, asyncExec, opts.semaforo ?? new SemaforoReportes(2));
    return { svc, prisma, executor, asyncExec, creadas };
}

const probar = (svc: PruebaPropuestaService, n = norm(), e = entrada(), avisosValidador: string[] = []) =>
    svc.probar({ entrada: e, normalizada: n, tarjeta, avisosValidador, ids, hoy: '2026-10-19' });

describe('PruebaPropuestaService', () => {
    beforeEach(() => {
        jest.spyOn(Logger.prototype, 'log').mockImplementation();
        jest.spyOn(Logger.prototype, 'warn').mockImplementation();
        jest.spyOn(Logger.prototype, 'error').mockImplementation();
    });
    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it('devuelve solo cantidades: ningún valor de las filas llega al resultado ni al texto del modelo', async () => {
        const filas = [
            { DNI: '30111222', Saldo: '248300', Email: 'mlgomez@gmail.com', Fija: '' },
            { DNI: '27888999', Saldo: '91250', Email: 'jperez@hotmail.com', Fija: '' },
        ];
        const { svc } = armar({ filas });
        const r = await probar(svc);
        expect(r).toMatchObject({ tipo: 'ok', id: 'p1', casos: 8412, aproximado: false, columnasVacias: [] });
        const todo = JSON.stringify(r);
        for (const v of ['30111222', '27888999', '248300', '91250', 'mlgomez', 'jperez', 'hotmail']) expect(todo).not.toContain(v);
        if (r.tipo === 'ok') {
            expect(r.textoParaModelo).toContain('Prueba p1: sin errores.');
            expect(r.textoParaModelo).toContain('Muestra: 2 filas.');
            expect(r.textoParaModelo).toContain('Casos de la consulta completa: 8.412.');
            expect(r.textoParaModelo).toContain('Columnas vacías en la muestra: ninguna.');
        }
    });

    it('columnas vacías en toda la muestra (la fija sin_campo no cuenta) con aviso', async () => {
        const filas = [{ DNI: '1', Saldo: '2', Email: '', Fija: '' }, { DNI: '3', Saldo: '4', Email: null, Fija: '' }];
        const r = await probar(armar({ filas }).svc);
        expect(r).toMatchObject({ tipo: 'ok', columnasVacias: ['Email'] });
        if (r.tipo === 'ok') expect(r.avisos.join('\n')).toContain('La columna «Email» salió vacía en toda la muestra');
    });

    it('0 filas en la muestra pero casos en la consulta: aviso de los filtros posteriores', async () => {
        const r = await probar(armar({ filas: [], conteo: 500 }).svc);
        if (r.tipo !== 'ok') throw new Error('debía ser ok');
        expect(r.avisos.join('\n')).toContain('los filtros se aplican después sobre los primeros 100 casos');
    });

    it('el conteo que no termina a tiempo: casos null + aviso, y la propuesta se guarda igual', async () => {
        jest.useFakeTimers();
        const a = armar({ filas: [{ DNI: '1', Saldo: '2', Email: 'x', Fija: '' }], conteo: 'colgado' });
        const p = probar(a.svc);
        await jest.advanceTimersByTimeAsync(15_001);
        const r = await p;
        expect(r).toMatchObject({ tipo: 'ok', casos: null });
        if (r.tipo === 'ok') {
            expect(r.avisos).toContain('No pude contar los casos a tiempo.');
            expect(r.textoParaModelo).toContain('no pude contarlos a tiempo');
        }
        expect(a.creadas).toHaveLength(1);
    });

    it('la preview que no termina a tiempo: ocupada (no se guarda nada)', async () => {
        jest.useFakeTimers();
        const a = armar({ preview: 'colgado' });
        const p = probar(a.svc);
        await jest.advanceTimersByTimeAsync(20_001);
        await expect(p).resolves.toEqual({ tipo: 'ocupada' });
        expect(a.creadas).toHaveLength(0);
    });

    it('un 400 del motor: fallo con su mensaje; un error de la base: fallo genérico con error en el log', async () => {
        const motor = await probar(armar({ preview: Object.assign(new Error('El filtro «x» no tiene valor'), { status: 400 }) }).svc);
        expect(motor).toEqual({ tipo: 'fallo', mensaje: 'El filtro «x» no tiene valor' });
        const base = await probar(armar({ preview: new Error('ECONNRESET') }).svc);
        expect(base).toMatchObject({ tipo: 'fallo' });
        expect(Logger.prototype.error).toHaveBeenCalled();
    });

    it('semáforo: con 2 pruebas en curso la 3.ª espera 30 s y después queda ocupada', async () => {
        jest.useFakeTimers();
        const sem = new SemaforoReportes(2);
        await sem.adquirir(1);
        await sem.adquirir(1);
        const a = armar({ semaforo: sem });
        const p = probar(a.svc);
        await jest.advanceTimersByTimeAsync(30_001);
        await expect(p).resolves.toEqual({ tipo: 'ocupada' });
        expect(a.executor.execute).not.toHaveBeenCalled();
    });

    it('libera el semáforo aunque la prueba falle', async () => {
        const sem = new SemaforoReportes(1);
        await probar(armar({ semaforo: sem, preview: new Error('x') }).svc);
        await expect(sem.adquirir(10)).resolves.toBeTruthy();
    });

    it('ids correlativos p1, p2 por conversación y la propuesta guardada trae entrada, plantilla, tarjeta y hash', async () => {
        const a = armar({ filas: [{ DNI: '1', Saldo: '2', Email: 'x', Fija: '' }] });
        const r1 = await probar(a.svc);
        const r2 = await probar(a.svc);
        expect([r1, r2].map((r) => (r.tipo === 'ok' ? r.id : r.tipo))).toEqual(['p1', 'p2']);
        expect(a.creadas[0]).toMatchObject({ conversacionId: 12, usuarioId: 7, mensajeId: 30, prueba: 'p1', estado: 'probada' });
        expect(a.creadas[0].hash).toMatch(/^[0-9a-f]{40}$/);
        expect(a.creadas[0].plantilla).toMatchObject({ nombre: 'Prueba', empresaId: 1, formatoSalida: 'xlsx' });
        expect(a.creadas[0].tarjeta).toMatchObject({ casos: 8412, casosAproximado: false, mensaje: '', sugerencias: [] });
    });

    it('un choque del unique (p1 ya existe) reintenta con el número siguiente', async () => {
        const a = armar({ filas: [{ DNI: '1', Saldo: '2', Email: 'x', Fija: '' }] });
        a.prisma.asistente_propuesta.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }));
        const r = await probar(a.svc);
        expect(r).toMatchObject({ tipo: 'ok', id: 'p2' });
    });

    it('ancho fijo: los valores que no entran se cortan (aviso); un número a la derecha que pierde dígitos es ERROR y no se guarda', async () => {
        const filas = [
            { DNI: '30111222', Saldo: '1', Email: 'a', Fija: '' },
            { DNI: '30111223', Saldo: '2', Email: 'b', Fija: '' },
        ];
        const aviso = armar({ filas });
        const r1 = await probar(aviso.svc, norm(), entrada({ anchoFijo: [6, 5, 10, 1], alineacion: ['izquierda', 'derecha', 'izquierda', 'izquierda'] }));
        if (r1.tipo !== 'ok') throw new Error('ok');
        expect(r1.avisos.join('\n')).toContain('2 valores de la muestra no entran en «DNI» (ancho 6): se cortan.');

        const mal = armar({ filas: [{ DNI: '1', Saldo: '123456789', Email: 'a', Fija: '' }] });
        const r2 = await probar(mal.svc, norm(), entrada({ anchoFijo: [6, 5, 10, 1], alineacion: ['izquierda', 'derecha', 'izquierda', 'izquierda'] }));
        expect(r2).toMatchObject({ tipo: 'rechazada' });
        if (r2.tipo === 'rechazada') expect(r2.problemas.join('\n')).toContain('1 valor de la muestra no entra en «Saldo» (ancho 5): a la derecha se pierden los dígitos más significativos');
        expect(mal.creadas).toHaveLength(0);
    });

    it('casos > 5.000: segundo plano; > 200.000: va a fallar', async () => {
        const f = [{ DNI: '1', Saldo: '2', Email: 'x', Fija: '' }];
        const a = await probar(armar({ filas: f, conteo: 6000 }).svc);
        const b = await probar(armar({ filas: f, conteo: 250000 }).svc);
        if (a.tipo !== 'ok' || b.tipo !== 'ok') throw new Error('ok');
        expect(a.avisos.join(' ')).toContain('segundo plano');
        expect(b.avisos.join(' ')).toContain('va a fallar al ejecutarse');
    });

    it('los avisos del validador viajan al resultado', async () => {
        const r = await probar(armar({ filas: [{ DNI: '1', Saldo: '2', Email: 'x', Fija: '' }] }).svc, norm(), entrada(), ['Sin filtros trae la cartera entera.']);
        if (r.tipo !== 'ok') throw new Error('ok');
        expect(r.avisos).toContain('Sin filtros trae la cartera entera.');
    });

    it('el log no lleva valores ni textos: solo cantidades', async () => {
        await probar(armar({ filas: [{ DNI: '30111222', Saldo: '2', Email: 'x', Fija: '' }] }).svc);
        const todo = (Logger.prototype.log as jest.Mock).mock.calls.map((c) => c[0]).join('\n');
        expect(todo).toContain('Prueba p1 (conversación 12): ok casos=8412');
        expect(todo).not.toContain('30111222');
    });
});

describe('definicionParaPrueba y conteoAproximado', () => {
    it('los filtros variables sin valor por defecto no se aplican en la prueba', () => {
        const d = definicionParaPrueba(
            norm({
                filtros: [
                    { id: '1', path: 'empresa.nombre', operador: 'eq', valor: 'TOYOTA' },
                    { id: '2', path: 'pagos.fecha', operador: 'between', variable: true, obligatorio: true },
                    { id: '3', path: 'fechaVencimiento', operador: 'lte', variable: true, valorPorDefecto: 'hoy-90' },
                ],
            }).definicion,
        );
        expect(d.filtros?.map((f) => f.id)).toEqual(['1', '3']);
    });

    it('el conteo es aproximado con filtros sobre una rama con selectores, salvo [count] contra 0', () => {
        const f = (path: string, operador: string, valor: unknown) => norm({ filtros: [{ id: '1', path, operador, valor }] }).definicion;
        expect(conteoAproximado(f('empresa.nombre', 'eq', 'TOYOTA'))).toBe(false);
        expect(conteoAproximado(f('contactos[tipo=telefono][count]', 'eq', 0))).toBe(false);
        expect(conteoAproximado(f('contactos[tipo=telefono][count]', 'gt', 0))).toBe(false);
        expect(conteoAproximado(f('contactos[tipo=telefono][count]', 'gt', 2))).toBe(true);
        expect(conteoAproximado(f('pagos[last].importe', 'gt', 100))).toBe(true);
    });
});

// ---- Detalle de la respuesta (docs/asistente-detalle-spec.md §7.4): las partes de probar_plantilla ----------------------

describe('PruebaPropuestaService con traza', () => {
    beforeEach(() => {
        jest.spyOn(Logger.prototype, 'log').mockImplementation();
        jest.spyOn(Logger.prototype, 'warn').mockImplementation();
        jest.spyOn(Logger.prototype, 'error').mockImplementation();
    });
    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    const filas = [{ DNI: '1', Saldo: '2', Email: 'x', Fija: '' }];
    /** Una prueba con tiempos controlados: la muestra y el conteo tardan lo que se diga (timers falsos). */
    function conTiempos(o: { muestraMs: number; conteoMs: number | 'colgado'; semaforo?: SemaforoReportes }) {
        const a = armar({ filas, semaforo: o.semaforo });
        a.executor.execute.mockImplementation(() => new Promise((r) => setTimeout(() => r({ filas, totalFilas: 1, columnas: [] }), o.muestraMs)));
        a.asyncExec.estimarFilas.mockImplementation(() => (o.conteoMs === 'colgado' ? new Promise<never>(() => undefined) : new Promise((r) => setTimeout(() => r(8412), o.conteoMs as number))));
        const traza = new TrazaTurno({ funcion: 'reportes', modelo: 'm' });
        const th = traza.herramienta('probar_plantilla');
        const correr = async (avance: () => Promise<void>) => {
            const p = a.svc.probar({ entrada: entrada(), normalizada: norm(), tarjeta, avisosValidador: [], ids, hoy: '2026-10-19', traza: th });
            await avance();
            const r = await p;
            th.cerrar({ esError: false, caracteresResultado: 100 });
            const nodo = traza.armar({ estado: 'ok' }).nodos.find((n) => n.tipo === 'herramienta')!;
            return { r, partes: Object.fromEntries((nodo.hijos ?? []).map((h) => [h.tipo, h])) };
        };
        return { ...a, correr };
    }

    it('la muestra y el conteo corren a la vez: se solapan, cada una con lo suyo', async () => {
        jest.useFakeTimers();
        const t = conTiempos({ muestraMs: 3100, conteoMs: 4700 });
        const { r, partes } = await t.correr(() => jest.advanceTimersByTimeAsync(5000));
        expect(r.tipo).toBe('ok');
        expect(partes.muestra.ms).toBe(3100);
        expect(partes.conteo.ms).toBe(4700);
        expect(partes.muestra.desdeMs).toBe(partes.conteo.desdeMs);
        expect(partes.espera_base.ms).toBe(0);
    });

    it('la 3.ª prueba espera su lugar en el semáforo: eso es «espera_base»', async () => {
        jest.useFakeTimers();
        const semaforo = new SemaforoReportes(2);
        const liberar1 = await semaforo.adquirir(1000);
        const liberar2 = await semaforo.adquirir(1000);
        expect(liberar1 && liberar2).toBeTruthy();
        const t = conTiempos({ muestraMs: 10, conteoMs: 10, semaforo });
        const { r, partes } = await t.correr(async () => {
            await jest.advanceTimersByTimeAsync(7000);
            liberar1!();
            await jest.advanceTimersByTimeAsync(100);
        });
        expect(r.tipo).toBe('ok');
        expect(partes.espera_base.ms).toBe(7000);
        expect(partes.muestra.desdeMs).toBe(7000);
    });

    it('sin lugar a los 30 s: ocupada, con «espera_base» de 30 s y sin muestra ni conteo', async () => {
        jest.useFakeTimers();
        const semaforo = new SemaforoReportes(1);
        await semaforo.adquirir(1000);
        const t = conTiempos({ muestraMs: 10, conteoMs: 10, semaforo });
        const { r, partes } = await t.correr(() => jest.advanceTimersByTimeAsync(30_001));
        expect(r).toEqual({ tipo: 'ocupada' });
        expect(partes.espera_base.ms).toBe(30_000);
        expect(partes.muestra).toBeUndefined();
        expect(partes.conteo).toBeUndefined();
    });

    it('el conteo vencido por timeout dura lo que esperó (15 s) y la muestra lo suyo', async () => {
        jest.useFakeTimers();
        const t = conTiempos({ muestraMs: 2000, conteoMs: 'colgado' });
        const { r, partes } = await t.correr(() => jest.advanceTimersByTimeAsync(15_001));
        expect(r).toMatchObject({ tipo: 'ok', casos: null });
        expect(partes.muestra.ms).toBe(2000);
        expect(partes.conteo.ms).toBe(15_000);
    });

    it('la prueba da lo mismo con y sin traza', async () => {
        const sin = await probar(armar({ filas }).svc);
        const traza = new TrazaTurno({ funcion: 'reportes', modelo: 'm' });
        const con = await armar({ filas }).svc.probar({ entrada: entrada(), normalizada: norm(), tarjeta, avisosValidador: [], ids, hoy: '2026-10-19', traza: traza.herramienta('probar_plantilla') });
        expect(con).toEqual(sin);
    });
});
