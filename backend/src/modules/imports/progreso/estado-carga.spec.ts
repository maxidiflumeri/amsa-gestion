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
    fueraDeCorte: null,
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

// ── Fase B (docs/imports-progreso-realtime-spec.md §9.9.2 A) ────────────────────────────────────────
import { textoInterrupcion } from './estado-carga';

describe('armarEstadoCarga — Fase B', () => {
    const AHORA = new Date('2026-10-09T12:00:00.000Z');
    const haceSegundos = (s: number) => new Date(AHORA.getTime() - s * 1000);
    const enCurso = (o: Partial<import_progreso> = {}) =>
        filaBase({ fase: 'PROCESANDO', encoladaAt: haceSegundos(100), startedAt: haceSegundos(90), ...o });

    it('fueraDeCorte es null en una fila que no trae el campo (fixtures viejas)', () => {
        const fila: any = { ...filaBase({ descartadas: 5 }) };
        delete fila.fueraDeCorte;
        const s = armarEstadoCarga(remesaBase({ estadoProceso: 'PROCESANDO' }), fila, AHORA);
        expect(s.fueraDeCorte).toBeNull();
        expect(s.descartadasPorFiltro).toBe(5);
    });

    it('descartadasPorFiltro = descartadas − fueraDeCorte (7 − 4 = 3) y descartadas sigue siendo el total', () => {
        const s = armarEstadoCarga(
            remesaBase({ estadoProceso: 'PROCESANDO' }),
            enCurso({ descartadas: 7, fueraDeCorte: 4 } as Partial<import_progreso>),
            AHORA,
        );
        expect(s.descartadas).toBe(7);
        expect(s.fueraDeCorte).toBe(4);
        expect(s.descartadasPorFiltro).toBe(3);
    });

    it('descartadasPorFiltro nunca es negativo', () => {
        const s = armarEstadoCarga(
            remesaBase({ estadoProceso: 'PROCESANDO' }),
            enCurso({ descartadas: 2, fueraDeCorte: 9 } as Partial<import_progreso>),
            AHORA,
        );
        expect(s.descartadasPorFiltro).toBe(0);
    });

    it('una remesa heredada (sin fila) trae fueraDeCorte null, descartadasPorFiltro 0 y el resto en null', () => {
        const s = armarEstadoCarga(remesaBase({ estadoProceso: 'FINALIZADA', totalFilas: 10 }), null, AHORA);
        expect(s).toMatchObject({
            fueraDeCorte: null, descartadasPorFiltro: 0, enColaDelante: null, velocidad: null, etaSegundos: null,
        });
    });

    describe('velocidad y ETA', () => {
        it('3.000 de 14.466 a los 90 s → 33,3 filas/s y 344 s', () => {
            const s = armarEstadoCarga(
                remesaBase({ estadoProceso: 'PROCESANDO' }),
                enCurso({ procesadas: 3000, totalEsperado: 14466 }),
                AHORA,
            );
            expect(s.velocidad).toBe(33.3);
            expect(s.etaSegundos).toBe(344);
        });

        it('a los 4 s no hay base para estimar', () => {
            const s = armarEstadoCarga(
                remesaBase({ estadoProceso: 'PROCESANDO' }),
                enCurso({ startedAt: haceSegundos(4), procesadas: 400, totalEsperado: 1000 }),
                AHORA,
            );
            expect(s.velocidad).toBeNull();
            expect(s.etaSegundos).toBeNull();
        });

        it('con procesadas 0 no hay división por cero', () => {
            const s = armarEstadoCarga(
                remesaBase({ estadoProceso: 'PROCESANDO' }),
                enCurso({ procesadas: 0, totalEsperado: 1000 }),
                AHORA,
            );
            expect(s.velocidad).toBeNull();
            expect(s.etaSegundos).toBeNull();
        });

        it.each(['EN_COLA', 'LEYENDO', 'POST_PROCESO', 'TERMINADA', 'BORRADOR'])('fuera de PROCESANDO (%s) son null', (fase) => {
            const s = armarEstadoCarga(
                remesaBase({ estadoProceso: 'PROCESANDO' }),
                enCurso({ fase, procesadas: 3000, totalEsperado: 14466 }),
                AHORA,
            );
            expect(s.velocidad).toBeNull();
            expect(s.etaSegundos).toBeNull();
        });

        it('una carga terminada no tiene ritmo aunque su fase siga diciendo PROCESANDO', () => {
            const s = armarEstadoCarga(
                remesaBase({ estadoProceso: 'FALLIDA' }),
                enCurso({ procesadas: 3000, totalEsperado: 14466, finishedAt: haceSegundos(1) }),
                AHORA,
            );
            expect(s.velocidad).toBeNull();
        });

        it('con procesadas >= totalEsperado hay velocidad y la ETA es null', () => {
            const s = armarEstadoCarga(
                remesaBase({ estadoProceso: 'PROCESANDO' }),
                enCurso({ procesadas: 900, totalEsperado: 900 }),
                AHORA,
            );
            expect(s.velocidad).toBe(10);
            expect(s.etaSegundos).toBeNull();
        });

        it('una ETA de más de 48 h es null', () => {
            const s = armarEstadoCarga(
                remesaBase({ estadoProceso: 'PROCESANDO' }),
                enCurso({ procesadas: 1, totalEsperado: 10_000_000 }),
                AHORA,
            );
            expect(s.velocidad).toBe(0.1);
            expect(s.etaSegundos).toBeNull();
        });

        it('ningún caso da NaN ni Infinity', () => {
            const casos: Array<Partial<import_progreso>> = [
                { procesadas: 0, totalEsperado: 0 },
                { procesadas: 5, totalEsperado: 0 },
                { procesadas: 1, totalEsperado: 1 },
                { procesadas: 1, totalEsperado: 999_999_999 },
                { startedAt: null, procesadas: 10, totalEsperado: 100 },
                { startedAt: AHORA, procesadas: 10, totalEsperado: 100 },
                { startedAt: new Date(AHORA.getTime() + 60_000), procesadas: 10, totalEsperado: 100 },
            ];
            for (const c of casos) {
                const s = armarEstadoCarga(remesaBase({ estadoProceso: 'PROCESANDO' }), enCurso(c), AHORA);
                for (const v of [s.velocidad, s.etaSegundos]) {
                    expect(v === null || Number.isFinite(v)).toBe(true);
                }
            }
        });
    });

    describe('enColaDelante', () => {
        const enCola = filaBase({ fase: 'EN_COLA', encoladaAt: haceSegundos(10) });

        it('sale solo en EN_COLA', () => {
            const s = armarEstadoCarga(remesaBase({ estadoProceso: 'PENDIENTE' }), enCola, AHORA, { enColaDelante: 2 });
            expect(s.enColaDelante).toBe(2);
        });

        it('en otra fase, aunque venga en extras, es null', () => {
            const s = armarEstadoCarga(
                remesaBase({ estadoProceso: 'PROCESANDO' }),
                enCurso({ procesadas: 5 }),
                AHORA,
                { enColaDelante: 2 },
            );
            expect(s.enColaDelante).toBeNull();
        });

        it('sin extras es null (la consulta falló o no se pidió)', () => {
            expect(armarEstadoCarga(remesaBase({ estadoProceso: 'PENDIENTE' }), enCola, AHORA).enColaDelante).toBeNull();
        });
    });
});

describe('textoNotificacion — SIN_FILAS con cortes', () => {
    const estado = (o: Partial<EstadoCargaDto>): EstadoCargaDto =>
        ({ ...armarEstadoCarga(remesaBase({ estadoProceso: 'FINALIZADA' }), null), resultado: 'SIN_FILAS', ...o });

    it('solo filtro de la plantilla', () => {
        expect(textoNotificacion(estado({ descartadas: 50, fueraDeCorte: null })).mensaje).toBe(
            'El archivo no tenía filas para procesar. El filtro de la plantilla descartó las 50 filas.',
        );
    });

    it('solo otro corte', () => {
        expect(textoNotificacion(estado({ descartadas: 30, fueraDeCorte: 30 })).mensaje).toBe(
            'El archivo no tenía filas para procesar. 30 filas son de otros cortes de la división.',
        );
    });

    it('los dos juntos', () => {
        expect(textoNotificacion(estado({ descartadas: 7, fueraDeCorte: 4 })).mensaje).toBe(
            'El archivo no tenía filas para procesar. El filtro de la plantilla descartó las 3 filas. ' +
            '4 filas son de otros cortes de la división.',
        );
    });
});

describe('textoInterrupcion', () => {
    const FIJA = 'La importación se interrumpió: el servidor se reinició o dejó de responder mientras la procesaba.';

    it.each(['DEUDORES', 'DEUDORES_Y_FACTURAS', 'ACCIONES', 'PAGOS', 'ACTUALIZACIONES', 'FACTURAS', 'MULTICLAVES', null])(
        'SIN_LATIDO y REENTREGA (%s) empiezan siempre con la oración fija',
        (categoria) => {
            for (const m of ['SIN_LATIDO', 'REENTREGA'] as const) {
                expect(textoInterrupcion(m, categoria).startsWith(FIJA)).toBe(true);
            }
        },
    );

    it('DEUDORES y DEUDORES_Y_FACTURAS mandan a eliminar desde el Historial y volver a cargar', () => {
        for (const c of ['DEUDORES', 'DEUDORES_Y_FACTURAS']) {
            const t = textoInterrupcion('SIN_LATIDO', c);
            expect(t).toContain(
                'Lo procesado hasta el corte quedó cargado en esta remesa. Eliminá esta importación desde el Historial y volvé a cargar el archivo. ' +
                'Si no se puede eliminar (porque algún caso ya tiene gestión o porque la remesa es muy grande), avisá a soporte antes de volver a cargarlo.',
            );
            expect(t).not.toContain('corte de un archivo dividido');
            expect(textoInterrupcion('SIN_LATIDO', c, { conCorte: true })).toBe(
                t + ' Esta remesa es un corte de un archivo dividido: al volver a cargarlo, tildá solo los cortes que no se cargaron. ' +
                'Si tildás uno que ya está cargado, sus casos quedan duplicados.',
            );
        }
        // El aviso del corte es solo de estas dos categorías.
        expect(textoInterrupcion('SIN_LATIDO', 'PAGOS', { conCorte: true })).not.toContain('corte de un archivo dividido');
        expect(textoInterrupcion('SIN_LATIDO', 'ACCIONES', { conCorte: true })).not.toContain('corte de un archivo dividido');
    });

    it('ACCIONES dice que no se puede revertir y que no se vuelva a cargar', () => {
        const t = textoInterrupcion('SIN_LATIDO', 'ACCIONES');
        expect(t).toContain('no se pueden revertir desde la pantalla');
        expect(t).toContain('No vuelvas a cargar el archivo; avisá a soporte.');
    });

    it('el resto no afirma ningún remedio: avisar a soporte antes de volver a cargar', () => {
        for (const c of ['PAGOS', 'ACTUALIZACIONES', 'FACTURAS', 'MULTICLAVES', 'CONTACTOS', 'ENRIQUECIMIENTO', 'MULTIRREGISTRO', 'MULTIARCHIVO', null]) {
            const t = textoInterrupcion('REENTREGA', c);
            expect(t).toContain('Antes de volver a cargar el archivo, avisá a soporte.');
            expect(t).not.toContain('Eliminá');
        }
    });

    it('SIN_JOB dice que no llegó a empezar y que no se cargó ninguna fila', () => {
        const t = textoInterrupcion('SIN_JOB', 'DEUDORES');
        expect(t.startsWith('La importación no llegó a empezar')).toBe(true);
        expect(t).toContain('No se cargó ninguna fila: volvé a importar el archivo.');
    });

    it('la primera línea entra en los 300 caracteres de la notificación y el total en 4.000', () => {
        for (const m of ['SIN_LATIDO', 'SIN_JOB', 'REENTREGA'] as const) {
            for (const c of ['DEUDORES', 'ACCIONES', 'PAGOS', null]) {
                const t = textoInterrupcion(m, c);
                expect(t.length).toBeLessThanOrEqual(4000);
                expect(primeraLineaDelMotivo(t)).not.toMatch(/…$/);
                expect(primeraLineaDelMotivo(t).length).toBeLessThanOrEqual(300);
            }
        }
    });

    it('en la notificación viaja solo la primera oración, no el qué hacer', () => {
        const e = armarEstadoCarga(
            remesaBase({ estadoProceso: 'FALLIDA' }),
            filaBase({ fase: 'TERMINADA', resultado: 'FALLIDA', error: textoInterrupcion('SIN_LATIDO', 'DEUDORES'), procesadas: 40, encoladaAt: new Date(), finishedAt: new Date() }),
        );
        expect(textoNotificacion(e).mensaje).toBe(`${FIJA} Se habían procesado 40 filas.`);
    });
});

describe('Fase B, ronda final', () => {
    it('motivoLegible traduce P2028 y P1017 a algo que un operador entiende', () => {
        const p2028 = Object.assign(new Error('Transaction API error: Unable to start a transaction in the given time.'), { code: 'P2028' });
        expect(motivoLegible(p2028)).toBe('La base de datos no respondió a tiempo (P2028).');
        const p1017 = Object.assign(new Error('Server has closed the connection.'), { code: 'P1017' });
        expect(motivoLegible(p1017)).toBe('La base de datos cerró la conexión (P1017).');
        const p2010 = Object.assign(new Error('Raw query failed. Code: `1205`. Message: `Lock wait timeout exceeded; try restarting transaction`'), { code: 'P2010' });
        expect(motivoLegible(p2010)).toBe('La base de datos tardó demasiado en liberar un bloqueo (1205).');
        // Un P2010 que no es un lock wait queda como siempre.
        expect(motivoLegible(Object.assign(new Error('Raw query failed. Code: `1064`.'), { code: 'P2010' }))).toBe('Raw query failed. Code: `1064`. (P2010)');
        // Los demás siguen igual.
        expect(motivoLegible(Object.assign(new Error('Invalid `x` invocation\n\nUnique constraint failed'), { code: 'P2002' }))).toBe('Unique constraint failed (P2002)');
    });

    it('SIN_JOB con corte propio avisa que se tilden solo los cortes que no se cargaron (cualquier categoría); sin corte, no', () => {
        const aviso = ' Esta remesa es un corte de un archivo dividido: al volver a cargarlo, tildá solo los cortes que no se cargaron. Si tildás uno que ya está cargado, sus casos quedan duplicados.';
        for (const c of ['DEUDORES', 'PAGOS', 'ACCIONES', 'FACTURAS', null]) {
            const sin = textoInterrupcion('SIN_JOB', c);
            expect(sin).not.toContain('corte de un archivo dividido');
            expect(textoInterrupcion('SIN_JOB', c, { conCorte: true })).toBe(sin + aviso);
        }
        expect(textoInterrupcion('SIN_JOB', 'DEUDORES', { conCorte: true })).toContain('No se cargó ninguna fila: volvé a importar el archivo. Esta remesa es un corte');
    });
});
