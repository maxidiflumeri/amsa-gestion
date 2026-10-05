import type { import_progreso } from '@prisma/client';
import {
    armarEstadoCarga,
    motivoLegible,
    calcularPorcentaje,
    clasificarResultado,
    primeraLineaDelMotivo,
    RemesaParaEstado,
    textoNotificacion,
} from './estado-carga';
import type { EstadoCargaDto } from './estado-carga.types';

const remesaBase = (o: Partial<RemesaParaEstado> = {}): RemesaParaEstado => ({
    id: 98,
    numeroRemesa: '00098',
    nombre: 'Carga',
    empresaId: 10,
    categoria: 'DEUDORES',
    usuarioCreadorId: 3,
    usuarioCreador: { id: 3, nombre: 'Maxi' },
    estadoProceso: 'PENDIENTE',
    totalFilas: 0,
    okFilas: 0,
    errFilas: 0,
    ...o,
});

const filaBase = (o: Partial<import_progreso> = {}): import_progreso => ({
    remesaId: 98,
    rev: 0,
    fase: 'BORRADOR',
    subfase: null,
    porcentaje: 0,
    totalEsperado: 0,
    procesadas: 0,
    ok: 0,
    err: 0,
    descartadas: 0,
    advertencias: 0,
    nuevos: null,
    actualizados: null,
    resultado: null,
    error: null,
    errorPostProceso: null,
    resumen: null,
    intentos: 0,
    jobId: null,
    grupoId: null,
    grupoOrden: null,
    grupoTotal: null,
    cancelSolicitadaAt: null,
    encoladaAt: null,
    startedAt: null,
    heartbeatAt: null,
    finishedAt: null,
    ...o,
});

describe('calcularPorcentaje', () => {
    it('0 de 0 da 0 y nunca NaN', () => {
        expect(calcularPorcentaje(0, 0)).toBe(0);
        expect(Number.isNaN(calcularPorcentaje(5, 0))).toBe(false);
        expect(calcularPorcentaje(NaN, NaN)).toBe(0);
    });
    it('500 de 1000 da 50', () => expect(calcularPorcentaje(500, 1000)).toBe(50));
    it('1000 de 1000 sin terminar da 99, no 100', () => expect(calcularPorcentaje(1000, 1000)).toBe(99));
    it('1200 de 1000 da 99', () => expect(calcularPorcentaje(1200, 1000)).toBe(99));
    it('terminada FINALIZADA da 100, aunque no se sepa el total', () => {
        expect(calcularPorcentaje(1000, 1000, 'FINALIZADA')).toBe(100);
        expect(calcularPorcentaje(0, 0, 'FINALIZADA')).toBe(100);
    });
    it('FALLIDA con 300 de 1000 conserva 30', () => expect(calcularPorcentaje(300, 1000, 'FALLIDA')).toBe(30));
});

describe('clasificarResultado', () => {
    const e = (o: Partial<Parameters<typeof clasificarResultado>[0]> = {}) =>
        clasificarResultado({ huboExcepcion: false, postProcesoFallo: false, procesadas: 10, err: 0, ...o });

    it('las cinco filas de la tabla', () => {
        expect(e({ huboExcepcion: true })).toBe('FALLIDA');
        expect(e({ postProcesoFallo: true })).toBe('CON_ADVERTENCIAS');
        expect(e({ procesadas: 0 })).toBe('SIN_FILAS');
        expect(e({ err: 3 })).toBe('CON_ERRORES');
        expect(e()).toBe('OK');
    });
    it('el post-proceso fallido gana sobre err > 0 y sobre 0 procesadas', () => {
        expect(e({ postProcesoFallo: true, err: 4 })).toBe('CON_ADVERTENCIAS');
        expect(e({ postProcesoFallo: true, procesadas: 0 })).toBe('CON_ADVERTENCIAS');
    });
    it('una excepción gana sobre todo lo demás', () => {
        expect(e({ huboExcepcion: true, postProcesoFallo: true, err: 2 })).toBe('FALLIDA');
    });
    it('todas las filas con error es CON_ERRORES', () => {
        expect(e({ procesadas: 12, err: 12 })).toBe('CON_ERRORES');
    });
});

describe('armarEstadoCarga sin fila (remesa heredada)', () => {
    it('la 98: VALIDANDO 912/912 no está en curso y tiene progreso 0', () => {
        const s = armarEstadoCarga(remesaBase({ estadoProceso: 'VALIDANDO', totalFilas: 912, okFilas: 912 }), null);
        expect(s.enCurso).toBe(false);
        expect(s.terminal).toBe(false);
        expect(s.fase).toBe('BORRADOR');
        expect(s.progreso).toBe(0);
        expect(s.ok).toBe(0);
        expect(s.resultado).toBeNull();
        expect(s.rev).toBe(0);
    });
    it('la 93: PENDIENTE con total 0 no está en curso', () => {
        const s = armarEstadoCarga(remesaBase({ id: 93, estadoProceso: 'PENDIENTE' }), null);
        expect(s.enCurso).toBe(false);
        expect(s.fase).toBe('BORRADOR');
        expect(s.progreso).toBe(0);
    });
    it('PROCESANDO: en curso y el porcentaje sale de ok + err sobre totalFilas', () => {
        const s = armarEstadoCarga(
            remesaBase({ estadoProceso: 'PROCESANDO', totalFilas: 1000, okFilas: 400, errFilas: 100 }),
            null,
        );
        expect(s.enCurso).toBe(true);
        expect(s.fase).toBe('PROCESANDO');
        expect(s.progreso).toBe(50);
        expect(s.procesadas).toBe(500);
    });
    it('FINALIZADA: 100 y el resultado se deduce de los contadores', () => {
        const ok = armarEstadoCarga(remesaBase({ estadoProceso: 'FINALIZADA', totalFilas: 10, okFilas: 10 }), null);
        expect(ok).toMatchObject({ terminal: true, enCurso: false, fase: 'TERMINADA', resultado: 'OK', progreso: 100 });
        const conErr = armarEstadoCarga(
            remesaBase({ estadoProceso: 'FINALIZADA', totalFilas: 10, okFilas: 8, errFilas: 2 }),
            null,
        );
        expect(conErr.resultado).toBe('CON_ERRORES');
        const vacia = armarEstadoCarga(remesaBase({ estadoProceso: 'FINALIZADA', totalFilas: 0 }), null);
        expect(vacia.resultado).toBe('SIN_FILAS');
    });
    it('FALLIDA: resultado FALLIDA, progreso 0, sin duración ni motivo', () => {
        const s = armarEstadoCarga(remesaBase({ estadoProceso: 'FALLIDA', totalFilas: 10, okFilas: 3 }), null);
        expect(s).toMatchObject({
            terminal: true, enCurso: false, resultado: 'FALLIDA', progreso: 0,
            duracionMs: null, error: null, finishedAt: null,
        });
        // F8: no afirma filas procesadas (los contadores de la remesa pueden ser los de la muestra).
        expect(s).toMatchObject({ ok: 0, err: 0, procesadas: 0, okFilas: 0, errFilas: 0 });
    });
    it('sin creador el usuarioNombre es Sistema y usuarioId null', () => {
        const s = armarEstadoCarga(remesaBase({ usuarioCreadorId: null, usuarioCreador: null }), null);
        expect(s.usuarioId).toBeNull();
        expect(s.usuarioNombre).toBe('Sistema');
    });
});

describe('armarEstadoCarga con fila', () => {
    it('un borrador recién validado con okFilas=50 de la muestra: ok es 0', () => {
        const s = armarEstadoCarga(
            remesaBase({ estadoProceso: 'VALIDANDO', totalFilas: 912, okFilas: 50 }),
            filaBase({ totalEsperado: 912 }),
        );
        expect(s.ok).toBe(0);
        expect(s.enCurso).toBe(false);
        expect(s.totalEsperado).toBe(912);
        expect(s.totalFilas).toBe(912);
    });
    it('encolada y sin terminar está en curso; los alias coinciden', () => {
        const s = armarEstadoCarga(
            remesaBase({ estadoProceso: 'PROCESANDO' }),
            filaBase({
                rev: 4, fase: 'PROCESANDO', porcentaje: 40, totalEsperado: 2500, procesadas: 1000, ok: 900, err: 100,
                encoladaAt: new Date('2026-10-05T14:00:00.000Z'), startedAt: new Date('2026-10-05T14:00:01.000Z'),
            }),
        );
        expect(s.enCurso).toBe(true);
        expect(s.progreso).toBe(40);
        expect(s).toMatchObject({ okFilas: 900, errFilas: 100, totalFilas: 2500, durationMs: null, rev: 4 });
    });
    it('terminada: duracionMs, fechas ISO, alias totalFilas = procesadas', () => {
        const s = armarEstadoCarga(
            remesaBase({ estadoProceso: 'FINALIZADA' }),
            filaBase({
                fase: 'TERMINADA', resultado: 'OK', porcentaje: 100, totalEsperado: 2500, procesadas: 2400, ok: 2400,
                encoladaAt: new Date('2026-10-05T14:00:00.000Z'),
                startedAt: new Date('2026-10-05T14:00:01.000Z'),
                finishedAt: new Date('2026-10-05T14:00:03.500Z'),
            }),
        );
        expect(s.duracionMs).toBe(2500);
        expect(s.durationMs).toBe(2500);
        expect(s.finishedAt).toBe('2026-10-05T14:00:03.500Z');
        expect(s.startedAt).toBe('2026-10-05T14:00:01.000Z');
        expect(s.totalFilas).toBe(2400);
        expect(s.progreso).toBe(100);
        expect(s.enCurso).toBe(false);
        expect(s.terminal).toBe(true);
    });
    it('nunca informa 100 mientras no sea terminal, aunque la fila lo traiga', () => {
        const s = armarEstadoCarga(
            remesaBase({ estadoProceso: 'PROCESANDO' }),
            filaBase({ porcentaje: 100, encoladaAt: new Date() }),
        );
        expect(s.progreso).toBe(99);
    });
    it('FALLIDA conserva el porcentaje y trae el motivo', () => {
        const s = armarEstadoCarga(
            remesaBase({ estadoProceso: 'FALLIDA' }),
            filaBase({
                fase: 'TERMINADA', resultado: 'FALLIDA', error: 'boom', porcentaje: 30, procesadas: 300, totalEsperado: 1000,
                encoladaAt: new Date(), finishedAt: new Date(),
            }),
        );
        expect(s.progreso).toBe(30);
        expect(s.error).toBe('boom');
        expect(s.resultado).toBe('FALLIDA');
    });
});

describe('textoNotificacion', () => {
    const estado = (o: Partial<EstadoCargaDto>): EstadoCargaDto =>
        ({ ...armarEstadoCarga(remesaBase({ estadoProceso: 'FINALIZADA' }), null), ...o });

    it('OK', () => {
        expect(textoNotificacion(estado({ resultado: 'OK', ok: 120 }))).toEqual({
            tipo: 'IMPORTACION_FINALIZADA',
            titulo: 'Importación finalizada',
            mensaje: 'Se procesaron 120 filas correctamente.',
        });
    });
    it('CON_ERRORES con ok > 0', () => {
        expect(textoNotificacion(estado({ resultado: 'CON_ERRORES', ok: 90, err: 10 }))).toEqual({
            tipo: 'IMPORTACION_FINALIZADA',
            titulo: 'Importación finalizada con errores',
            mensaje: 'Se cargaron 90 filas y 10 dieron error.',
        });
    });
    it('CON_ERRORES con ok = 0 es IMPORTACION_ERROR y no dice "fallida"', () => {
        const t = textoNotificacion(estado({ resultado: 'CON_ERRORES', ok: 0, err: 12 }));
        expect(t.tipo).toBe('IMPORTACION_ERROR');
        expect(t.titulo).toBe('Importación sin filas cargadas');
        expect(t.mensaje).toBe('Las 12 filas del archivo dieron error: no se cargó ninguna.');
        expect(`${t.titulo} ${t.mensaje}`.toLowerCase()).not.toContain('fallida');
    });
    it('SIN_FILAS, con y sin descartadas', () => {
        const sin = textoNotificacion(estado({ resultado: 'SIN_FILAS' }));
        expect(sin.titulo).toBe('Importación sin filas');
        expect(sin.mensaje).toBe('El archivo no tenía filas para procesar.');
        expect(sin.mensaje).not.toContain('0 filas correctamente');
        const filtro = textoNotificacion(estado({ resultado: 'SIN_FILAS', descartadas: 1234 }));
        expect(filtro.mensaje).toContain('1234');
        expect(filtro.mensaje).toContain('El filtro de la plantilla descartó las 1234 filas.');
    });
    it('CON_ADVERTENCIAS usa la primera línea del motivo', () => {
        const t = textoNotificacion(
            estado({ resultado: 'CON_ADVERTENCIAS', ok: 50, err: 2, errorPostProceso: 'Deadlock al consolidar\nsegunda línea' }),
        );
        expect(t.tipo).toBe('IMPORTACION_FINALIZADA');
        expect(t.titulo).toBe('Importación finalizada con advertencias');
        expect(t.mensaje).toBe(
            'Se cargaron 50 filas y 2 dieron error, pero el post-proceso no terminó: Deadlock al consolidar.',
        );
        const sinErr = textoNotificacion(estado({ resultado: 'CON_ADVERTENCIAS', ok: 50, err: 0, errorPostProceso: 'x' }));
        expect(sinErr.mensaje).toBe('Se cargaron 50 filas, pero el post-proceso no terminó: x.');
        const todasErr = textoNotificacion(estado({ resultado: 'CON_ADVERTENCIAS', ok: 0, err: 10, errorPostProceso: 'x' }));
        expect(todasErr.mensaje).toBe('Se cargaron 0 filas y 10 dieron error, pero el post-proceso no terminó: x.');
    });
    it('FALLIDA, con y sin filas procesadas', () => {
        const a = textoNotificacion(estado({ resultado: 'FALLIDA', error: 'No existe el archivo.' }));
        expect(a).toEqual({
            tipo: 'IMPORTACION_ERROR',
            titulo: 'Importación fallida',
            mensaje: 'No existe el archivo.',
        });
        const b = textoNotificacion(estado({ resultado: 'FALLIDA', error: 'Se cortó', procesadas: 2000 }));
        expect(b.mensaje).toBe('Se cortó. Se habían procesado 2000 filas.');
    });
    it('un error de 5.000 caracteres en varias líneas da un mensaje de a lo sumo 1000 y de una línea', () => {
        const largo = Array.from({ length: 100 }, (_, i) => `línea ${i} ${'x'.repeat(45)}`).join('\n');
        expect(largo.length).toBeGreaterThan(4900);
        const t = textoNotificacion(estado({ resultado: 'FALLIDA', error: largo, procesadas: 10 }));
        expect(t.mensaje.length).toBeLessThanOrEqual(1000);
        expect(t.mensaje).not.toContain('\n');
        expect(t.mensaje.startsWith('línea 0')).toBe(true);
    });
    it('un motivo vacío no deja el mensaje en blanco', () => {
        expect(textoNotificacion(estado({ resultado: 'FALLIDA', error: null })).mensaje).toBe('Error desconocido.');
        expect(primeraLineaDelMotivo('\n  \n')).toBe('Error desconocido');
    });
});

describe('motivoLegible', () => {
    it('un error de Prisma da la última línea no vacía más el código', () => {
        const e: any = new Error('Invalid `prisma.deudor.create()` invocation in\n/app/dist/x.js:88:40\n\n  85 código\n\nUnique constraint failed on the constraint: `K`\n');
        e.code = 'P2002';
        expect(motivoLegible(e)).toBe('Unique constraint failed on the constraint: `K` (P2002)');
    });
    it('no repite el código si la última línea ya lo trae', () => {
        const e: any = new Error('Invalid `x` invocation\nError P2002: duplicado');
        e.code = 'P2002';
        expect(motivoLegible(e)).toBe('Error P2002: duplicado');
    });
    it('un mensaje con la forma de Prisma pero sin código también se resume', () => {
        expect(motivoLegible('Invalid `prisma.x.update()` invocation in\n/app/x.js\n\nRecord not found')).toBe('Record not found');
    });
    it('un error común va como viene, recortado', () => {
        expect(motivoLegible(new Error('Archivo no encontrado'))).toBe('Archivo no encontrado');
        expect(motivoLegible(new Error('x'.repeat(5000))).length).toBe(4000);
        expect(motivoLegible(undefined)).toBe('Error desconocido');
    });
});

describe('textoNotificacion — estado sin registrar', () => {
    it('agrega el aviso y respeta el tope de 1000', () => {
        const base = armarEstadoCarga(remesaBase({ estadoProceso: 'FALLIDA' }), null);
        const e = { ...base, resultado: 'FALLIDA' as const, error: 'y'.repeat(2000) };
        const t = textoNotificacion(e, { sinRegistrar: true });
        expect(t.mensaje.length).toBeLessThanOrEqual(1000);
        expect(t.mensaje.endsWith('La carga puede figurar todavía en proceso.') || t.mensaje.endsWith('la carga puede figurar todavía en proceso.')).toBe(true);
        expect(textoNotificacion(e).mensaje).not.toContain('no se pudo registrar');
    });
});

describe('servidorAhora', () => {
    const ahora = new Date('2026-10-05T15:00:00.000Z');
    it('con fila y sin fila sale la hora con que se armó el DTO, no la de la última escritura', () => {
        const fila = filaBase({ heartbeatAt: new Date('2026-10-05T14:00:00Z') });
        expect(armarEstadoCarga(remesaBase(), fila, ahora).servidorAhora).toBe('2026-10-05T15:00:00.000Z');
        expect(armarEstadoCarga(remesaBase(), null, ahora).servidorAhora).toBe('2026-10-05T15:00:00.000Z');
    });
    it('sin reloj inyectado usa la hora actual', () => {
        const antes = Date.now();
        const t = Date.parse(armarEstadoCarga(remesaBase(), null).servidorAhora);
        expect(t).toBeGreaterThanOrEqual(antes);
        expect(t).toBeLessThanOrEqual(Date.now());
    });
});
