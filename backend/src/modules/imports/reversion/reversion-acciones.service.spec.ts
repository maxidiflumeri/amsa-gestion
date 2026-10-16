/**
 * Revertir una acción masiva como job (docs/imports-progreso-c3-spec.md §17.5.3 a §17.5.7 y §17.11.1).
 *
 * Usa una base en memoria con transacciones de verdad (si el callback tira, se deshace todo lo que escribió): sin eso
 * no se puede probar lo importante de este diseño, que una tanda que falla no marca ni toca nada.
 */
import { BadRequestException, ConflictException, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ReversionAccionesService, ReversionConcurrenteError } from './reversion-acciones.service';
import { evaluarReversion, EntradaEvaluarReversion, textoReversionFallida } from './reversion-accion.reglas';

beforeAll(() => Logger.overrideLogger(false));

// ─────────────────────────────────────────────────────────────────────────────────────────────
// evaluarReversion (pura)
// ─────────────────────────────────────────────────────────────────────────────────────────────

const base = (o: Partial<EntradaEvaluarReversion> = {}): EntradaEvaluarReversion => ({
    remesa: { accionRevertidaEn: null, accionSnapshotsPorCaso: true, estadoProceso: 'FINALIZADA' },
    progreso: { encoladaAt: new Date(), finishedAt: new Date(), errorPostProceso: null },
    reversion: null,
    pendientes: 5,
    yaRevertidos: 0,
    ...o,
});

describe('evaluarReversion', () => {
    it('YA_REVERTIDA: una reversión TERMINADA, o accionRevertidaEn de C3a', () => {
        expect(evaluarReversion(base({ reversion: { estado: 'TERMINADA' } }))).toBe('YA_REVERTIDA');
        expect(evaluarReversion(base({ remesa: { accionRevertidaEn: new Date(), accionSnapshotsPorCaso: false, estadoProceso: 'FALLIDA' } }))).toBe('YA_REVERTIDA');
    });

    it.each(['EN_COLA', 'REVIRTIENDO'])('REVERSION_EN_CURSO: la reversión está %s', (estado) => {
        expect(evaluarReversion(base({ reversion: { estado } }))).toBe('REVERSION_EN_CURSO');
    });

    it('REVERTIR_CARGA_EN_CURSO: la acción masiva todavía corre o está en cola', () => {
        expect(evaluarReversion(base({ progreso: { encoladaAt: new Date(), finishedAt: null, errorPostProceso: null } }))).toBe('REVERTIR_CARGA_EN_CURSO');
        expect(evaluarReversion(base({
            remesa: { accionRevertidaEn: null, accionSnapshotsPorCaso: true, estadoProceso: 'PROCESANDO' },
        }))).toBe('REVERTIR_CARGA_EN_CURSO');
    });

    it('una heredada sin fila de progreso que figura PROCESANDO no cuenta como en curso (no hay forma de saberlo)', () => {
        expect(evaluarReversion(base({ progreso: null, remesa: { accionRevertidaEn: null, accionSnapshotsPorCaso: true, estadoProceso: 'PROCESANDO' } }))).toBeNull();
    });

    it('REVERTIR_NO_TERMINO y REVERTIR_INCOMPLETO: solo para las anteriores a C3b (D5)', () => {
        const vieja = (estadoProceso: string) => ({ accionRevertidaEn: null, accionSnapshotsPorCaso: false, estadoProceso });
        expect(evaluarReversion(base({ remesa: vieja('FALLIDA') }))).toBe('REVERTIR_NO_TERMINO');
        expect(evaluarReversion(base({
            remesa: vieja('FINALIZADA'),
            progreso: { encoladaAt: new Date(), finishedAt: new Date(), errorPostProceso: 'se cayó' },
        }))).toBe('REVERTIR_INCOMPLETO');
        expect(evaluarReversion(base({ remesa: vieja('FINALIZADA') }))).toBeNull();
    });

    it('una cancelada antes de procesar ninguna fila (sin la marca, porque no escribió nada) es REVERTIR_NADA, no la mandamos a soporte (auditoría de C3b)', () => {
        const sinMarca = { accionRevertidaEn: null, accionSnapshotsPorCaso: false, estadoProceso: 'FALLIDA' };
        const fin = { encoladaAt: new Date(), finishedAt: new Date(), errorPostProceso: null };
        expect(evaluarReversion(base({ remesa: sinMarca, progreso: { ...fin, procesadas: 0 }, pendientes: 0 }))).toBe('REVERTIR_NADA');
        // Con filas procesadas y sin la marca es una anterior a C3b a medias: sigue mandando a soporte (D5).
        expect(evaluarReversion(base({ remesa: sinMarca, progreso: { ...fin, procesadas: 40 }, pendientes: 0 }))).toBe('REVERTIR_NO_TERMINO');
        // Heredada sin fila de progreso: no se sabe cuántas procesó, sigue D5.
        expect(evaluarReversion(base({ remesa: sinMarca, progreso: null, pendientes: 0 }))).toBe('REVERTIR_NO_TERMINO');
    });

    it('el texto de una reversión fallida no repite cómo seguir ni deja doble punto (auditoría de C3b)', () => {
        const interrumpida = 'Se interrumpió por un reinicio del servidor o una falla: se revirtieron 2000 de 7551. Revertir de nuevo sigue desde ahí.';
        expect(textoReversionFallida(interrumpida)).toBe(`La reversión falló: ${interrumpida}`);
        expect(textoReversionFallida('Deadlock')).toBe('La reversión falló: Deadlock. Revertir de nuevo sigue desde donde quedó.');
        expect(textoReversionFallida(null)).toBe('La reversión falló: sin detalle. Revertir de nuevo sigue desde donde quedó.');
    });

    it('una FALLIDA (cancelada o cortada) de C3b SÍ es revertible, también con errorPostProceso', () => {
        expect(evaluarReversion(base({ remesa: { accionRevertidaEn: null, accionSnapshotsPorCaso: true, estadoProceso: 'FALLIDA' } }))).toBeNull();
        expect(evaluarReversion(base({ progreso: { encoladaAt: new Date(), finishedAt: new Date(), errorPostProceso: 'x' } }))).toBeNull();
    });

    it('REVERTIR_NADA: sin pendientes y sin nada hecho', () => {
        expect(evaluarReversion(base({ pendientes: 0, yaRevertidos: 0 }))).toBe('REVERTIR_NADA');
    });

    it('todas hechas pero sin la marca final (murió antes del cierre): revertible, el job solo cierra', () => {
        expect(evaluarReversion(base({ pendientes: 0, yaRevertidos: 12, reversion: { estado: 'INTERRUMPIDA' } }))).toBeNull();
    });

    it('FALLIDA e INTERRUMPIDA se pueden retomar', () => {
        expect(evaluarReversion(base({ reversion: { estado: 'FALLIDA' } }))).toBeNull();
        expect(evaluarReversion(base({ reversion: { estado: 'INTERRUMPIDA' }, yaRevertidos: 3 }))).toBeNull();
    });

    it('el orden de las comprobaciones es el del diseño: ya revertida gana a todo', () => {
        expect(evaluarReversion(base({
            remesa: { accionRevertidaEn: new Date(), accionSnapshotsPorCaso: false, estadoProceso: 'FALLIDA' },
            reversion: { estado: 'REVIRTIENDO' },
        }))).toBe('YA_REVERTIDA');
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// La base en memoria
// ─────────────────────────────────────────────────────────────────────────────────────────────

interface Snap {
    id: bigint; remesaId: number; entidad: string; entidadId: number; accion: string;
    datosPrevios: Record<string, unknown> | null; deudorId: number | null; revertidoEn: Date | null;
}
interface Fila {
    remesaId: number; estado: string; usuarioId: number | null; jobId: string | null; intentos: number;
    total: number; hechos: number; deudoresRevertidos: number; contactosRestaurados: number; comentariosBorrados: number;
    casosQueNoExistian: number; contactosSinCaso: number; error: string | null;
    encoladaAt: Date; startedAt: Date | null; heartbeatAt: Date | null; finishedAt: Date | null;
}
interface Estado {
    snaps: Snap[];
    deudores: Map<number, Record<string, unknown>>;
    contactos: Array<{ id: number; deudorId: number; tipo: string; valor: string }>;
    comentarios: Set<number>;
    reversion: Fila | null;
    remesa: { id: number; empresaId: number; categoria: string; estadoProceso: string; accionRevertidaEn: Date | null; accionRevertidaPorId: number | null; accionSnapshotsPorCaso: boolean; numeroRemesa: string };
    progreso: { encoladaAt: Date | null; finishedAt: Date | null; errorPostProceso: string | null; procesadas: number; totalEsperado: number | null; resumen: unknown } | null;
}

const copiar = (e: Estado): Estado => ({
    snaps: e.snaps.map((s) => ({ ...s })),
    deudores: new Map([...e.deudores].map(([k, v]) => [k, { ...v }])),
    contactos: e.contactos.map((c) => ({ ...c })),
    comentarios: new Set(e.comentarios),
    reversion: e.reversion ? { ...e.reversion } : null,
    remesa: { ...e.remesa },
    progreso: e.progreso ? { ...e.progreso } : null,
});

const filaNueva = (o: Partial<Fila> = {}): Fila => ({
    remesaId: 5, estado: 'EN_COLA', usuarioId: 9, jobId: 'revertir-5-1', intentos: 1, total: 0, hechos: 0,
    deudoresRevertidos: 0, contactosRestaurados: 0, comentariosBorrados: 0, casosQueNoExistian: 0, contactosSinCaso: 0,
    error: null, encoladaAt: new Date('2026-10-14T12:00:00Z'), startedAt: null, heartbeatAt: null, finishedAt: null, ...o,
});

interface Opciones {
    snaps?: Snap[];
    reversion?: Fila | null;
    remesa?: Partial<Estado['remesa']>;
    progreso?: Estado['progreso'];
    deudores?: Array<[number, Record<string, unknown>]>;
    contactos?: Estado['contactos'];
    comentarios?: number[];
    /** Hace tirar la n-ésima llamada (1-based) a `deudor.updateMany`. */
    tirarEnDeudor?: number;
}

const snap = (id: number, entidad: string, entidadId: number, accion: string, datosPrevios: Record<string, unknown> | null, deudorId: number | null, revertidoEn: Date | null = null): Snap =>
    ({ id: BigInt(id), remesaId: 5, entidad, entidadId, accion, datosPrevios, deudorId, revertidoEn });

/** Tres cambios del caso 1 (comentario, contacto, update) y uno del caso 2, como los deja una acción masiva de C3b. */
const snapsBasicos = (): Snap[] => [
    snap(1, 'comentario', 91, 'INSERT', null, 1),
    snap(2, 'contacto', 70, 'DELETE', { deudorId: 1, tipo: 'telefono', valor: '1155', subtipo: null, prioridad: 1, validado: false, whatsapp: false }, 1),
    snap(3, 'deudor', 1, 'UPDATE', { estadoSituacionId: 41 }, 1),
    snap(4, 'deudor', 2, 'UPDATE', { estadoSituacionId: 41 }, 2),
];

function armar(o: Opciones = {}) {
    let estado: Estado = {
        snaps: o.snaps ?? snapsBasicos(),
        deudores: new Map(o.deudores ?? [[1, { estadoSituacionId: 42 }], [2, { estadoSituacionId: 42 }]]),
        contactos: o.contactos ?? [],
        comentarios: new Set(o.comentarios ?? [91]),
        reversion: o.reversion === undefined ? null : o.reversion,
        remesa: {
            id: 5, empresaId: 10, categoria: 'ACCIONES', estadoProceso: 'FINALIZADA', accionRevertidaEn: null, accionRevertidaPorId: null,
            accionSnapshotsPorCaso: true, numeroRemesa: '00005', ...o.remesa,
        },
        progreso: o.progreso === undefined
            ? { encoladaAt: new Date(), finishedAt: new Date(), errorPostProceso: null, procesadas: 10, totalEsperado: 10, resumen: { categoria: { v: 1, tipo: 'ACCIONES', deudoresAfectados: 2 } } }
            : o.progreso,
    };
    let llamadasDeudor = 0;
    let cola: Promise<void> = Promise.resolve();
    const aplicarData = (f: Fila, data: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(data)) {
            if (v && typeof v === 'object' && 'increment' in (v as object)) (f as any)[k] += (v as any).increment;
            else (f as any)[k] = v;
        }
    };
    const coincide = (f: Fila, where: Record<string, unknown>) =>
        Object.entries(where).every(([k, v]) => v === undefined || (f as any)[k] === v || (v === null && (f as any)[k] === null));

    const prisma: any = {
        remesa: {
            findUnique: jest.fn().mockImplementation(async () => ({
                ...estado.remesa,
                progreso: estado.progreso,
                reversion: estado.reversion,
            })),
            updateMany: jest.fn().mockImplementation(async ({ where, data }: any) => {
                if (where.accionRevertidaEn === null && estado.remesa.accionRevertidaEn !== null) return { count: 0 };
                Object.assign(estado.remesa, data);
                return { count: 1 };
            }),
        },
        import_progreso: { findUnique: jest.fn().mockImplementation(async () => estado.progreso) },
        accion_masiva_snapshot: {
            count: jest.fn().mockImplementation(async ({ where }: any) =>
                estado.snaps.filter((s) => s.remesaId === where.remesaId &&
                    (where.revertidoEn === null ? s.revertidoEn === null : s.revertidoEn !== null)).length),
            groupBy: jest.fn().mockImplementation(async ({ where }: any) => {
                const pend = estado.snaps.filter((s) => s.remesaId === where.remesaId && s.revertidoEn === null);
                const por = new Map<string, number>();
                for (const s of pend) por.set(s.entidad, (por.get(s.entidad) ?? 0) + 1);
                return [...por].map(([entidad, n]) => ({ entidad, _count: { _all: n } }));
            }),
            findMany: jest.fn().mockImplementation(async ({ where, take }: any) =>
                estado.snaps
                    .filter((s) => s.remesaId === where.remesaId && s.revertidoEn === null && (where.id?.lt == null || s.id < where.id.lt))
                    .sort((a, b) => (a.id < b.id ? 1 : -1))
                    .slice(0, take)
                    .map((s) => ({ ...s }))),
            updateMany: jest.fn().mockImplementation(async ({ where, data }: any) => {
                const ids = new Set<bigint>(where.id.in);
                const hit = estado.snaps.filter((s) => ids.has(s.id) && s.remesaId === where.remesaId && s.revertidoEn === null);
                for (const s of hit) s.revertidoEn = data.revertidoEn;
                return { count: hit.length };
            }),
        },
        deudor: {
            updateMany: jest.fn().mockImplementation(async ({ where, data }: any) => {
                llamadasDeudor++;
                if (o.tirarEnDeudor === llamadasDeudor) throw new Error('lock wait timeout');
                const d = estado.deudores.get(where.id);
                if (!d) return { count: 0 };
                Object.assign(d, data);
                return { count: 1 };
            }),
            findMany: jest.fn().mockImplementation(async ({ where }: any) =>
                (where.id.in as number[]).filter((id) => estado.deudores.has(id)).map((id) => ({ id }))),
        },
        contacto: {
            createMany: jest.fn().mockImplementation(async ({ data, skipDuplicates }: any) => {
                let creados = 0;
                for (const c of data) {
                    const existe = estado.contactos.some((x) => x.deudorId === c.deudorId && x.tipo === c.tipo && x.valor === c.valor);
                    if (existe) {
                        if (!skipDuplicates) throw new Error('unique');
                        continue;
                    }
                    estado.contactos.push({ id: 1000 + estado.contactos.length, ...c });
                    creados++;
                }
                return { count: creados };
            }),
        },
        comentario: {
            deleteMany: jest.fn().mockImplementation(async ({ where }: any) => {
                let n = 0;
                for (const id of where.id.in as number[]) if (estado.comentarios.delete(id)) n++;
                return { count: n };
            }),
        },
        reversion_accion: {
            findUnique: jest.fn().mockImplementation(async () => (estado.reversion ? { ...estado.reversion } : null)),
            findUniqueOrThrow: jest.fn().mockImplementation(async () => {
                if (!estado.reversion) throw new Error('no existe');
                return { ...estado.reversion };
            }),
            findMany: jest.fn().mockImplementation(async ({ where }: any) =>
                estado.reversion && estado.reversion.estado === where.estado ? [{ ...estado.reversion }] : []),
            update: jest.fn().mockImplementation(async ({ data }: any) => {
                aplicarData(estado.reversion!, data);
                return { ...estado.reversion! };
            }),
            updateMany: jest.fn().mockImplementation(async ({ where, data }: any) => {
                if (!estado.reversion || !coincide(estado.reversion, where)) return { count: 0 };
                aplicarData(estado.reversion, data);
                return { count: 1 };
            }),
            upsert: jest.fn().mockImplementation(async ({ create, update }: any) => {
                if (estado.reversion) aplicarData(estado.reversion, update);
                else estado.reversion = filaNueva({ ...create });
                return { ...estado.reversion! };
            }),
        },
        // Transacción de verdad: serializa (el FOR UPDATE de la fila) y, si el callback tira, deshace todo lo escrito.
        $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => {
            const turno = cola.then(async () => {
                const antes = copiar(estado);
                try {
                    return await fn(prisma);
                } catch (e) {
                    estado = antes;
                    throw e;
                }
            });
            cola = turno.then(() => undefined, () => undefined);
            return turno;
        }),
        $queryRaw: jest.fn().mockImplementation(async (sql: TemplateStringsArray) => {
            const texto = sql.join('?');
            if (/COUNT\(DISTINCT/.test(texto)) {
                const casos = new Set(estado.snaps.filter((s) => s.revertidoEn === null).map((s) => s.deudorId ?? s.entidadId));
                return [{ casos: BigInt(casos.size) }];
            }
            return [{
                id: estado.remesa.id, empresaId: estado.remesa.empresaId, categoria: estado.remesa.categoria,
                estadoProceso: estado.remesa.estadoProceso, accionRevertidaEn: estado.remesa.accionRevertidaEn,
                accionSnapshotsPorCaso: estado.remesa.accionSnapshotsPorCaso ? 1 : 0,
                progresoId: estado.progreso ? 5 : null,
                encoladaAt: estado.progreso?.encoladaAt ?? null, finishedAt: estado.progreso?.finishedAt ?? null,
                errorPostProceso: estado.progreso?.errorPostProceso ?? null,
                estadoReversion: estado.reversion?.estado ?? null, intentos: estado.reversion?.intentos ?? null,
            }];
        }),
    };

    const colaBull = { add: jest.fn().mockResolvedValue(undefined), getJob: jest.fn().mockResolvedValue(null) };
    const realtime = { emitReversionProgreso: jest.fn(), emitReversionTerminada: jest.fn() };
    const notificaciones = { crear: jest.fn().mockResolvedValue(undefined) };
    const auditoria = { log: jest.fn().mockResolvedValue(undefined) };
    const requestContext = { get: jest.fn().mockReturnValue({ requestId: 'req-1', usuarioId: 9 }) };
    const svc = new ReversionAccionesService(prisma, colaBull as never, realtime as never, notificaciones as never, auditoria as never, requestContext as never);
    svc.esperar = async () => undefined;
    return { svc, prisma, cola: colaBull, realtime, notificaciones, auditoria, estado: () => estado };
}

const codigo = (e: unknown) => (e as ConflictException).getResponse() as { code: string; message: string; statusCode: number };

// ─────────────────────────────────────────────────────────────────────────────────────────────
// solicitar
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('solicitar', () => {
    it('una revertible queda EN_COLA con el jobId del intento, encola el job y emite el progreso', async () => {
        const e = armar();
        const { dto, yaEstaba } = await e.svc.solicitar(5, 9);

        expect(yaEstaba).toBe(false);
        expect(e.estado().reversion).toMatchObject({ estado: 'EN_COLA', usuarioId: 9, jobId: 'revertir-5-1', intentos: 1 });
        expect(e.cola.add).toHaveBeenCalledWith(
            'revertir',
            { remesaId: 5, usuarioId: 9, _ctx: { requestId: 'req-1', usuarioId: 9 } },
            { jobId: 'revertir-5-1', removeOnComplete: 100, removeOnFail: 100 },
        );
        expect(e.realtime.emitReversionProgreso).toHaveBeenCalledWith(expect.objectContaining({ remesaId: 5, estado: 'EN_COLA', empresaId: 10 }));
        expect(dto.reversion?.estado).toBe('EN_COLA');
    });

    it('el jobId lleva el intento: retomar una INTERRUMPIDA es el job -2, y no pone en cero lo ya hecho', async () => {
        const e = armar({ reversion: filaNueva({ estado: 'INTERRUMPIDA', intentos: 1, hechos: 2, deudoresRevertidos: 1 }), snaps: snapsBasicos().map((s, i) => (i < 2 ? { ...s, revertidoEn: new Date() } : s)) });
        await e.svc.solicitar(5, 9);

        expect(e.estado().reversion).toMatchObject({ estado: 'EN_COLA', jobId: 'revertir-5-2', intentos: 2, hechos: 2, deudoresRevertidos: 1, error: null, finishedAt: null });
        expect(e.cola.add.mock.calls[0][2]).toMatchObject({ jobId: 'revertir-5-2' });
    });

    it.each([
        ['REVERSION_EN_CURSO', { reversion: filaNueva({ estado: 'REVIRTIENDO' }) }, 'Esta acción ya se está revirtiendo. Mirá el avance en el Historial.'],
        ['REVERTIR_CARGA_EN_CURSO', { progreso: { encoladaAt: new Date(), finishedAt: null, errorPostProceso: null, procesadas: 1, totalEsperado: 10, resumen: null } }, 'La acción masiva todavía está corriendo. Cancelala, o esperá a que termine, y después revertila.'],
        ['REVERTIR_NO_TERMINO', { remesa: { accionSnapshotsPorCaso: false, estadoProceso: 'FALLIDA' } }, 'Esta acción masiva no terminó bien: los datos para revertirla no se guardaron. Avisá a soporte; no la vuelvas a cargar.'],
        ['REVERTIR_INCOMPLETO', { remesa: { accionSnapshotsPorCaso: false }, progreso: { encoladaAt: new Date(), finishedAt: new Date(), errorPostProceso: 'x', procesadas: 1, totalEsperado: 1, resumen: null } }, 'Los datos para revertir esta acción no se guardaron completos: Revertir desharía solo una parte. Avisá a soporte.'],
        ['REVERTIR_NADA', { snaps: [] }, 'Esta acción masiva no llegó a cambiar ningún caso: no hay nada que revertir.'],
    ] as Array<[string, Opciones, string]>)('409 %s con su texto, sin encolar ni escribir', async (code, opciones, texto) => {
        const e = armar(opciones);
        const antes = JSON.stringify(e.estado().reversion);
        const err = await e.svc.solicitar(5, 9).catch((x) => x);

        expect(err).toBeInstanceOf(ConflictException);
        expect(codigo(err)).toMatchObject({ statusCode: 409, code, message: texto });
        expect(e.cola.add).not.toHaveBeenCalled();
        expect(JSON.stringify(e.estado().reversion)).toBe(antes);
    });

    it('ya revertida: responde yaEstaba con la reversión TERMINADA, sin encolar (también si la revirtió C3a, sin fila)', async () => {
        const e = armar({ remesa: { accionRevertidaEn: new Date('2026-10-01T10:00:00Z') } });
        const r = await e.svc.solicitar(5, 9);

        expect(r.yaEstaba).toBe(true);
        expect(r.dto.reversion?.estado).toBe('TERMINADA');
        expect(e.cola.add).not.toHaveBeenCalled();
        expect(e.estado().reversion).toBeNull();
    });

    it('404 si la remesa no existe y 400 si no es de acciones', async () => {
        const sin = armar();
        sin.prisma.$queryRaw.mockResolvedValueOnce([]);
        expect(await sin.svc.solicitar(5, 9).catch((x) => x)).toBeInstanceOf(NotFoundException);
        expect(await armar({ remesa: { categoria: 'DEUDORES' } }).svc.solicitar(5, 9).catch((x) => x)).toBeInstanceOf(BadRequestException);
    });

    it('si Redis no acepta el job: 503 REVERSION_NO_ENCOLADA y la fila queda FALLIDA', async () => {
        const e = armar();
        e.cola.add.mockRejectedValue(new Error('ECONNREFUSED'));
        const err = await e.svc.solicitar(5, 9).catch((x) => x);

        expect(err).toBeInstanceOf(ServiceUnavailableException);
        expect((err as ServiceUnavailableException).getResponse()).toMatchObject({
            code: 'REVERSION_NO_ENCOLADA',
            message: 'No se pudo poner la reversión en la cola. Probá de nuevo en unos minutos; si se repite, avisá a soporte.',
        });
        expect(e.estado().reversion).toMatchObject({ estado: 'FALLIDA', error: 'No se pudo encolar la reversión' });
        // Y un reintento posterior se acepta (FALLIDA se puede retomar).
        e.cola.add.mockResolvedValue(undefined);
        expect((await e.svc.solicitar(5, 9)).yaEstaba).toBe(false);
        expect(e.estado().reversion).toMatchObject({ estado: 'EN_COLA', intentos: 2 });
    });

    it('dos solicitar simultáneos, con el lock simulado: 202 el primero y 409 REVERSION_EN_CURSO el segundo; un solo job', async () => {
        const e = armar();
        const [a, b] = await Promise.all([e.svc.solicitar(5, 9).catch((x) => x), e.svc.solicitar(5, 9).catch((x) => x)]);

        expect(a.yaEstaba).toBe(false);
        expect(codigo(b)).toMatchObject({ code: 'REVERSION_EN_CURSO' });
        expect(e.cola.add).toHaveBeenCalledTimes(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// obtener (el GET)
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('obtener', () => {
    it('una revertida por C3a (sin revertidoEn en sus snapshots) no ofrece deshacer nada: todo figura como ya revertido (auditoría de C3b)', async () => {
        const dto = await armar({ remesa: { accionRevertidaEn: new Date('2026-10-01T10:00:00Z') } }).svc.obtener(5);
        expect(dto.revertible).toBe(false);
        expect(dto.motivo?.code).toBe('YA_REVERTIDA');
        expect(dto.cobertura).toMatchObject({ casos: 0, cambiosDeCaso: 0, contactos: 0, comentarios: 0, yaRevertidos: 4 });
    });

    it('cuenta casos y cambios por tipo, dice que es exacta y que es revertible', async () => {
        const dto = await armar().svc.obtener(5);

        expect(dto).toMatchObject({
            remesaId: 5, revertible: true, motivo: null, reversion: null, accionRevertidaEn: null,
            cobertura: {
                exacta: true, casos: 2, cambiosDeCaso: 2, contactos: 1, comentarios: 1, yaRevertidos: 0,
                casosAfectadosInformados: 2, cargaCortada: false, filasProcesadas: 10, totalFilas: 10,
            },
        });
    });

    it('una cortada (FALLIDA) de C3b: revertible y cargaCortada', async () => {
        const dto = await armar({ remesa: { estadoProceso: 'FALLIDA' }, progreso: { encoladaAt: new Date(), finishedAt: new Date(), errorPostProceso: null, procesadas: 4, totalEsperado: 10, resumen: null } }).svc.obtener(5);
        expect(dto.revertible).toBe(true);
        expect(dto.cobertura).toMatchObject({ cargaCortada: true, exacta: true, filasProcesadas: 4, totalFilas: 10, casosAfectadosInformados: null });
    });

    it('una anterior a C3b con errorPostProceso: no revertible y cobertura no exacta', async () => {
        const dto = await armar({
            remesa: { accionSnapshotsPorCaso: false },
            progreso: { encoladaAt: new Date(), finishedAt: new Date(), errorPostProceso: 'x', procesadas: 4, totalEsperado: 10, resumen: null },
        }).svc.obtener(5);
        expect(dto.revertible).toBe(false);
        expect(dto.motivo?.code).toBe('REVERTIR_INCOMPLETO');
        expect(dto.cobertura.exacta).toBe(false);
    });

    it('al retomar, dice cuántos ya revirtió el intento anterior', async () => {
        const e = armar({ reversion: filaNueva({ estado: 'INTERRUMPIDA', hechos: 2 }), snaps: snapsBasicos().map((s, i) => (i >= 2 ? { ...s, revertidoEn: new Date() } : s)) });
        const dto = await e.svc.obtener(5);
        expect(dto.cobertura).toMatchObject({ yaRevertidos: 2, cambiosDeCaso: 0, contactos: 1, comentarios: 1 });
        expect(dto.reversion).toMatchObject({ estado: 'INTERRUMPIDA', hechos: 2 });
    });

    it('404 y 400', async () => {
        const e = armar();
        e.prisma.remesa.findUnique.mockResolvedValueOnce(null);
        expect(await e.svc.obtener(5).catch((x) => x)).toBeInstanceOf(NotFoundException);
        expect(await armar({ remesa: { categoria: 'PAGOS' } }).svc.obtener(5).catch((x) => x)).toBeInstanceOf(BadRequestException);
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ejecutar (el job)
// ─────────────────────────────────────────────────────────────────────────────────────────────

const enCola = (o: Partial<Fila> = {}) => filaNueva(o);

describe('ejecutar', () => {
    it('deshace todo: casos, contactos y comentarios; marca los snapshots; cierra TERMINADA y accionRevertidaEn', async () => {
        const e = armar({ reversion: enCola() });
        await e.svc.ejecutar(5, 'revertir-5-1');

        const s = e.estado();
        expect(s.deudores.get(1)).toEqual({ estadoSituacionId: 41 });
        expect(s.deudores.get(2)).toEqual({ estadoSituacionId: 41 });
        expect(s.contactos).toEqual([expect.objectContaining({ deudorId: 1, tipo: 'telefono', valor: '1155' })]);
        expect(s.comentarios.has(91)).toBe(false);
        expect(s.snaps.every((x) => x.revertidoEn !== null)).toBe(true);
        expect(s.reversion).toMatchObject({
            estado: 'TERMINADA', total: 4, hechos: 4, deudoresRevertidos: 2, contactosRestaurados: 1, comentariosBorrados: 1,
            casosQueNoExistian: 0, contactosSinCaso: 0, error: null,
        });
        expect(s.reversion!.finishedAt).not.toBeNull();
        expect(s.remesa.accionRevertidaEn).not.toBeNull();
        expect(s.remesa.accionRevertidaPorId).toBe(9);
    });

    it('al cerrar: auditoría con los números, notificación sin resultado/err/procesadas y el evento terminada', async () => {
        const e = armar({ reversion: enCola() });
        await e.svc.ejecutar(5, 'revertir-5-1');

        expect(e.auditoria.log).toHaveBeenCalledTimes(1);
        expect(e.auditoria.log.mock.calls[0][0]).toMatchObject({
            resumen: 'Revirtió acción masiva (remesa 5)', usuarioId: 9, empresaId: 10, entidadId: 5,
            data: { deudoresRevertidos: 2, contactosRestaurados: 1, comentariosBorrados: 1 },
        });
        const n = e.notificaciones.crear.mock.calls[0][0];
        expect(n).toMatchObject({
            tipo: 'IMPORTACION_FINALIZADA', titulo: 'Acción masiva revertida', entidadTipo: 'REMESA', entidadId: 5,
            destinatarioPrincipalId: 9, rutaAccion: '/historial-importaciones/5',
        });
        expect(Object.keys(n.payload)).toEqual(['reversion']);
        expect(e.realtime.emitReversionTerminada).toHaveBeenCalledWith(expect.objectContaining({ estado: 'TERMINADA', porcentaje: 100, hechos: 4, total: 4 }));
    });

    it('el orden es descendente: con dos cambios del mismo caso queda el valor ANTERIOR al primero', async () => {
        const e = armar({
            reversion: enCola(),
            snaps: [
                snap(1, 'deudor', 1, 'UPDATE', { estadoSituacionId: 10 }, 1),
                snap(2, 'deudor', 1, 'UPDATE', { estadoSituacionId: 20 }, 1),
            ],
            deudores: [[1, { estadoSituacionId: 30 }]],
        });
        await e.svc.ejecutar(5, 'revertir-5-1');
        expect(e.estado().deudores.get(1)).toEqual({ estadoSituacionId: 10 });
        const orden = e.prisma.deudor.updateMany.mock.calls.map((c: any) => c[0].data.estadoSituacionId);
        expect(orden).toEqual([20, 10]);
    });

    it('camposAdicionales null vuelve como JsonNull y la fecha como Date', async () => {
        const e = armar({
            reversion: enCola(),
            snaps: [snap(1, 'deudor', 1, 'UPDATE', { camposAdicionales: null, fechaVencimiento: '2026-01-31T00:00:00.000Z' }, 1)],
            deudores: [[1, { camposAdicionales: { a: 1 } }]],
        });
        await e.svc.ejecutar(5, 'revertir-5-1');
        const data = e.prisma.deudor.updateMany.mock.calls[0][0].data;
        expect(data.camposAdicionales).toBe(Prisma.JsonNull);
        expect(data.fechaVencimiento).toEqual(new Date('2026-01-31T00:00:00.000Z'));
    });

    it('una tanda que tira deja sus snapshots SIN marcar, sin tocar nada de la tanda, y la fila FALLIDA; el job re-lanza', async () => {
        const e = armar({ reversion: enCola(), tirarEnDeudor: 2 });
        await expect(e.svc.ejecutar(5, 'revertir-5-1')).rejects.toThrow('lock wait timeout');

        const s = e.estado();
        // La tanda es una sola (4 snapshots): rollback entero, nada marcado, nada cambiado.
        expect(s.snaps.every((x) => x.revertidoEn === null)).toBe(true);
        expect(s.deudores.get(1)).toEqual({ estadoSituacionId: 42 });
        expect(s.comentarios.has(91)).toBe(true);
        expect(s.contactos).toEqual([]);
        expect(s.reversion).toMatchObject({ estado: 'FALLIDA', error: 'lock wait timeout', hechos: 0 });
        expect(s.reversion!.finishedAt).not.toBeNull();
        expect(s.remesa.accionRevertidaEn).toBeNull();
        expect(e.notificaciones.crear.mock.calls[0][0]).toMatchObject({ tipo: 'IMPORTACION_ERROR', titulo: 'La reversión no terminó' });
        expect(e.realtime.emitReversionTerminada).toHaveBeenCalledWith(expect.objectContaining({ estado: 'FALLIDA' }));
        expect(e.auditoria.log).not.toHaveBeenCalled();
    });

    it('un reintento tras una falla en la 2da tanda solo procesa los pendientes y suma sobre los contadores (sin duplicar contactos)', async () => {
        // 250 cambios de caso: la 1ra tanda (ids 250..51) entra, la 2da falla.
        const muchos = Array.from({ length: 250 }, (_, i) => snap(i + 1, 'deudor', i + 1, 'UPDATE', { estadoSituacionId: 41 }, i + 1));
        const conContacto = [...muchos, snap(300, 'contacto', 70, 'DELETE', { deudorId: 1, tipo: 'telefono', valor: '1155', subtipo: null, prioridad: 1, validado: false, whatsapp: false }, 1)];
        const deudores: Array<[number, Record<string, unknown>]> = muchos.map((_, i) => [i + 1, { estadoSituacionId: 42 }]);
        // La falla cae en la 202ª llamada a deudor.updateMany: la primera tanda (200) pasó, la segunda no.
        const e = armar({ reversion: enCola(), snaps: conContacto, deudores, tirarEnDeudor: 202 });
        await expect(e.svc.ejecutar(5, 'revertir-5-1')).rejects.toThrow();

        let s = e.estado();
        expect(s.snaps.filter((x) => x.revertidoEn !== null)).toHaveLength(200);
        expect(s.reversion).toMatchObject({ estado: 'FALLIDA', hechos: 200, total: 251, contactosRestaurados: 1 });
        expect(s.contactos).toHaveLength(1);

        // Se retoma: el intento 2 sigue desde ahí.
        e.prisma.deudor.updateMany.mockClear();
        await e.svc.solicitar(5, 9);
        await e.svc.ejecutar(5, 'revertir-5-2');

        s = e.estado();
        // La 1ra tanda tomó el contacto y 199 casos; quedan 51.
        expect(e.prisma.deudor.updateMany).toHaveBeenCalledTimes(51);
        expect(s.contactos).toHaveLength(1);
        expect(s.reversion).toMatchObject({ estado: 'TERMINADA', hechos: 251, total: 251, deudoresRevertidos: 250, contactosRestaurados: 1 });
        expect(s.snaps.every((x) => x.revertidoEn !== null)).toBe(true);
    });

    it('un contacto que ya existe no se duplica (skipDuplicates): se cuenta como no restaurado, no como falla', async () => {
        const e = armar({ reversion: enCola(), contactos: [{ id: 1, deudorId: 1, tipo: 'telefono', valor: '1155' }] });
        await e.svc.ejecutar(5, 'revertir-5-1');
        expect(e.estado().contactos).toHaveLength(1);
        expect(e.estado().reversion).toMatchObject({ estado: 'TERMINADA', contactosRestaurados: 0 });
    });

    it('un contacto vuelve como estaba: prioridad null sigue null y el de un codeudor sigue siendo del codeudor (auditoría de C3b)', async () => {
        const snaps = [
            snap(1, 'contacto', 70, 'DELETE', { deudorId: 1, tipo: 'telefono', valor: '1155', subtipo: null, prioridad: null, validado: false, whatsapp: false, relacion: 'CODEUDOR' }, 1),
            // Un snapshot anterior a que se guardara `relacion`: vuelve como del titular, igual que antes.
            snap(2, 'contacto', 71, 'DELETE', { deudorId: 1, tipo: 'telefono', valor: '1166', subtipo: null, prioridad: 3, validado: true, whatsapp: false }, 1),
        ];
        const e = armar({ reversion: enCola(), snaps });
        await e.svc.ejecutar(5, 'revertir-5-1');
        const c = e.estado().contactos;
        expect(c.find((x: any) => x.valor === '1155')).toMatchObject({ prioridad: null, relacion: 'CODEUDOR' });
        expect(c.find((x: any) => x.valor === '1166')).toMatchObject({ prioridad: 3, relacion: null, validado: true });
    });

    it('un count distinto de n hace rollback: otra reversión marcó esos snapshots', async () => {
        const e = armar({ reversion: enCola() });
        e.prisma.accion_masiva_snapshot.updateMany.mockImplementationOnce(async () => ({ count: 3 }));
        await expect(e.svc.ejecutar(5, 'revertir-5-1')).rejects.toBeInstanceOf(ReversionConcurrenteError);
        expect(e.estado().deudores.get(1)).toEqual({ estadoSituacionId: 42 });
        expect(e.estado().reversion?.estado).toBe('FALLIDA');
    });

    it('los contactos de casos borrados terminan en contactosSinCaso y los cambios de casos borrados en casosQueNoExistian', async () => {
        const e = armar({ reversion: enCola(), deudores: [[2, { estadoSituacionId: 42 }]] }); // el caso 1 ya no existe
        await e.svc.ejecutar(5, 'revertir-5-1');

        const s = e.estado();
        expect(s.contactos).toEqual([]);
        expect(s.reversion).toMatchObject({ estado: 'TERMINADA', contactosSinCaso: 1, contactosRestaurados: 0, casosQueNoExistian: 1, deudoresRevertidos: 1 });
    });

    it('con el claim en 0 (la cerró el cron, o es un job viejo) no hace nada', async () => {
        const e = armar({ reversion: enCola({ estado: 'INTERRUMPIDA' }) });
        await e.svc.ejecutar(5, 'revertir-5-1');

        expect(e.prisma.accion_masiva_snapshot.findMany).not.toHaveBeenCalled();
        expect(e.prisma.deudor.updateMany).not.toHaveBeenCalled();
        expect(e.estado().reversion?.estado).toBe('INTERRUMPIDA');
        const otroJob = armar({ reversion: enCola() });
        await otroJob.svc.ejecutar(5, 'revertir-5-9');
        expect(otroJob.estado().reversion?.estado).toBe('EN_COLA');
    });

    it('el cierre escribe accionRevertidaEn solo si era null (no pisa quién la revirtió)', async () => {
        const marca = new Date('2026-10-01T10:00:00Z');
        const e = armar({ reversion: enCola(), remesa: { accionRevertidaEn: marca, accionRevertidaPorId: 77 } });
        await e.svc.ejecutar(5, 'revertir-5-1');
        expect(e.estado().remesa).toMatchObject({ accionRevertidaEn: marca, accionRevertidaPorId: 77 });
        expect(e.estado().reversion?.estado).toBe('TERMINADA');
    });

    it('todas hechas pero sin la marca final: no hay tandas y solo cierra', async () => {
        const hechos = snapsBasicos().map((s) => ({ ...s, revertidoEn: new Date() }));
        const e = armar({ reversion: enCola({ hechos: 4, total: 4, deudoresRevertidos: 2 }), snaps: hechos });
        await e.svc.ejecutar(5, 'revertir-5-1');
        expect(e.prisma.deudor.updateMany).not.toHaveBeenCalled();
        expect(e.estado().reversion).toMatchObject({ estado: 'TERMINADA', hechos: 4, total: 4 });
        expect(e.estado().remesa.accionRevertidaEn).not.toBeNull();
    });

    it('si el cron la pasó a INTERRUMPIDA en medio de una tanda, esa tanda no se aplica y no se pisa la fila', async () => {
        const e = armar({ reversion: enCola() });
        // Entre el claim y la tanda alguien la deja INTERRUMPIDA.
        e.prisma.accion_masiva_snapshot.findMany.mockImplementationOnce(async () => {
            e.estado().reversion!.estado = 'INTERRUMPIDA';
            return snapsBasicos().sort((a, b) => (a.id < b.id ? 1 : -1));
        });
        await expect(e.svc.ejecutar(5, 'revertir-5-1')).rejects.toBeInstanceOf(ReversionConcurrenteError);
        expect(e.estado().reversion?.estado).toBe('INTERRUMPIDA');
        expect(e.estado().deudores.get(1)).toEqual({ estadoSituacionId: 42 });
    });

    it('emite el progreso como mucho una vez por segundo', async () => {
        const muchos = () => Array.from({ length: 600 }, (_, i) => snap(i + 1, 'deudor', i + 1, 'UPDATE', { estadoSituacionId: 41 }, i + 1));
        const deudores = (): Array<[number, Record<string, unknown>]> => Array.from({ length: 600 }, (_, i) => [i + 1, { estadoSituacionId: 42 }]);
        const e = armar({ reversion: enCola(), snaps: muchos(), deudores: deudores() });
        const reloj = 1_000_000;
        e.svc.ahora = () => reloj;
        await e.svc.ejecutar(5, 'revertir-5-1');
        expect(e.realtime.emitReversionProgreso).toHaveBeenCalledTimes(1); // 3 tandas dentro del mismo segundo

        const otra = armar({ reversion: enCola(), snaps: muchos(), deudores: deudores() });
        let t = 1_000_000;
        otra.svc.ahora = () => (t += 1500);
        await otra.svc.ejecutar(5, 'revertir-5-1');
        expect(otra.realtime.emitReversionProgreso).toHaveBeenCalledTimes(3);
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// El cierre ordenado del servidor (C3c, docs/imports-progreso-c3-spec.md §19.4.5)
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('ejecutar — el cierre ordenado del servidor', () => {
    const muchos = () => Array.from({ length: 600 }, (_, i) => snap(i + 1, 'deudor', i + 1, 'UPDATE', { estadoSituacionId: 41 }, i + 1));
    const deudores = (): Array<[number, Record<string, unknown>]> => Array.from({ length: 600 }, (_, i) => [i + 1, { estadoSituacionId: 42 }]);

    it('el corte pedido durante la 2da tanda: esa tanda completa, queda INTERRUMPIDA con H de T exactos, anuncia y no relanza', async () => {
        const e = armar({ reversion: enCola(), snaps: muchos(), deudores: deudores() });
        const original = e.prisma.deudor.updateMany.getMockImplementation()!;
        let n = 0;
        let lineas: string[] = [];
        e.prisma.deudor.updateMany.mockImplementation(async (a: unknown) => {
            n++;
            if (n === 250) {
                e.svc.cortarPorCierre();
                lineas = e.svc.trabajosEnCurso();
            }
            return original(a);
        });

        await expect(e.svc.ejecutar(5, 'revertir-5-1')).resolves.toBeUndefined();

        const s = e.estado();
        expect(s.reversion).toMatchObject({
            estado: 'INTERRUMPIDA', hechos: 400, total: 600,
            error: 'Se interrumpió por un reinicio del servidor: se revirtieron 400 de 600. Revertir de nuevo sigue desde ahí.',
        });
        expect(s.reversion!.finishedAt).not.toBeNull();
        expect(s.snaps.filter((x) => x.revertidoEn !== null)).toHaveLength(400);
        expect(s.remesa.accionRevertidaEn).toBeNull();
        expect(e.realtime.emitReversionTerminada).toHaveBeenCalledTimes(1);
        expect(e.realtime.emitReversionTerminada.mock.calls[0][0]).toMatchObject({ estado: 'INTERRUMPIDA', hechos: 400, total: 600 });
        expect(e.notificaciones.crear).toHaveBeenCalledTimes(1);
        expect(e.notificaciones.crear.mock.calls[0][0]).toMatchObject({ tipo: 'IMPORTACION_ERROR', titulo: 'La reversión no terminó' });
        expect(e.auditoria.log).not.toHaveBeenCalled();
        expect(lineas).toEqual([expect.stringContaining('reversión remesa=5')]);
        expect(e.svc.trabajosEnCurso()).toEqual([]);
    });

    it('con el corte ya pedido al empezar: no deshace nada y queda retomable (0 de T)', async () => {
        const e = armar({ reversion: enCola() });
        e.svc.cortarPorCierre();
        await e.svc.ejecutar(5, 'revertir-5-1');
        expect(e.prisma.deudor.updateMany).not.toHaveBeenCalled();
        expect(e.estado().reversion).toMatchObject({ estado: 'INTERRUMPIDA', hechos: 0, total: 4 });
        expect(e.estado().snaps.every((x) => x.revertidoEn === null)).toBe(true);
    });

    it('una INTERRUMPIDA por el cierre se retoma: el siguiente job sigue desde ahí y no duplica contactos', async () => {
        const e = armar({ reversion: enCola() });
        e.svc.cortarPorCierre();
        await e.svc.ejecutar(5, 'revertir-5-1');
        // Proceso nuevo: sin corte pedido, la fila vuelve a EN_COLA con otro jobId (lo hace `solicitar`).
        const nuevo = armar({ reversion: enCola({ jobId: 'revertir-5-2', intentos: 2, hechos: 0, total: 4 }) });
        await nuevo.svc.ejecutar(5, 'revertir-5-2');
        expect(nuevo.estado().reversion).toMatchObject({ estado: 'TERMINADA', hechos: 4, total: 4 });
        expect(nuevo.estado().contactos).toHaveLength(1);
    });

    it('con la fila ya cerrada por otro (afecta 0): warn y sin anuncio', async () => {
        const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
        const e = armar({ reversion: enCola() });
        e.svc.cortarPorCierre();
        // Después del arranque del job, otro (el cron) la deja INTERRUMPIDA.
        const original = e.prisma.reversion_accion.update.getMockImplementation()!;
        e.prisma.reversion_accion.update.mockImplementationOnce(async (a: unknown) => {
            const r = await original(a);
            e.estado().reversion!.estado = 'INTERRUMPIDA';
            return r;
        });

        await e.svc.ejecutar(5, 'revertir-5-1');

        expect(e.estado().reversion).toMatchObject({ estado: 'INTERRUMPIDA', error: null });
        expect(e.realtime.emitReversionTerminada).not.toHaveBeenCalled();
        expect(e.notificaciones.crear).not.toHaveBeenCalled();
        expect(warn.mock.calls.some(([m]) => String(m).includes('la fila ya estaba cerrada'))).toBe(true);
        jest.restoreAllMocks();
    });

    it('cortarPorCierre es idempotente y sin trabajos no hay líneas', () => {
        const e = armar();
        expect(e.svc.trabajosEnCurso()).toEqual([]);
        e.svc.cortarPorCierre();
        e.svc.cortarPorCierre();
        expect(e.svc.trabajosEnCurso()).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// El endpoint de compatibilidad (C3a)
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('revertirCompat (el endpoint viejo)', () => {
    it('ya revertida: la forma de siempre, sin encolar', async () => {
        const e = armar({ remesa: { accionRevertidaEn: new Date() } });
        expect(await e.svc.revertirCompat(5, 9)).toEqual({ yaRevertida: true, deudoresRevertidos: 0, contactosRestaurados: 0, comentariosBorrados: 0 });
        expect(e.cola.add).not.toHaveBeenCalled();
    });

    it('si el job termina mientras espera: 200 con la forma vieja y los números del job', async () => {
        const e = armar();
        e.svc.esperar = async () => {
            if (e.estado().reversion?.estado === 'EN_COLA') await e.svc.ejecutar(5, 'revertir-5-1');
        };
        expect(await e.svc.revertirCompat(5, 9)).toEqual({ yaRevertida: false, deudoresRevertidos: 2, contactosRestaurados: 1, comentariosBorrados: 1 });
    });

    it('si a los 20 s no terminó: 409 REVERSION_EN_CURSO con «sigue en segundo plano»', async () => {
        const e = armar();
        let reloj = 0;
        e.svc.ahora = () => reloj;
        e.svc.esperar = async (ms) => { reloj += ms; };
        const err = await e.svc.revertirCompat(5, 9).catch((x) => x);

        expect(err).toBeInstanceOf(ConflictException);
        expect(codigo(err)).toMatchObject({
            code: 'REVERSION_EN_CURSO',
            message: 'La reversión sigue en segundo plano. Actualizá el Historial en unos minutos para ver cómo terminó.',
        });
        expect(reloj).toBeGreaterThanOrEqual(20_000);
    });

    it('si el job falla mientras espera: 409 REVERSION_FALLIDA con el motivo', async () => {
        const e = armar();
        e.svc.esperar = async () => {
            Object.assign(e.estado().reversion!, { estado: 'FALLIDA', error: 'se cayó la base' });
        };
        const err = await e.svc.revertirCompat(5, 9).catch((x) => x);
        expect(codigo(err)).toMatchObject({
            code: 'REVERSION_FALLIDA',
            message: 'La reversión falló: se cayó la base. Revertir de nuevo sigue desde donde quedó.',
        });
    });

    it('los rechazos de solicitar pasan tal cual (409 de C3a)', async () => {
        const e = armar({ remesa: { accionSnapshotsPorCaso: false, estadoProceso: 'FALLIDA' } });
        expect(codigo(await e.svc.revertirCompat(5, 9).catch((x) => x))).toMatchObject({ code: 'REVERTIR_NO_TERMINO' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// El cron
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('revisarReversionesColgadas', () => {
    const AHORA = new Date('2026-10-14T12:10:00Z').getTime();
    const viejo = new Date(AHORA - 10 * 60_000);
    const fresco = new Date(AHORA - 30_000);

    it('REVIRTIENDO con el latido viejo pasa a INTERRUMPIDA con «se revirtieron H de T», avisa y emite', async () => {
        const e = armar({ reversion: filaNueva({ estado: 'REVIRTIENDO', hechos: 120, total: 450, heartbeatAt: viejo, startedAt: viejo }) });
        e.svc.ahora = () => AHORA;

        expect(await e.svc.revisarReversionesColgadas()).toEqual([5]);

        expect(e.estado().reversion).toMatchObject({
            estado: 'INTERRUMPIDA',
            error: 'Se interrumpió por un reinicio del servidor o una falla: se revirtieron 120 de 450. Revertir de nuevo sigue desde ahí.',
        });
        expect(e.realtime.emitReversionTerminada).toHaveBeenCalledWith(expect.objectContaining({ estado: 'INTERRUMPIDA', hechos: 120, total: 450 }));
        expect(e.notificaciones.crear.mock.calls[0][0]).toMatchObject({ tipo: 'IMPORTACION_ERROR', titulo: 'La reversión no terminó' });
    });

    it('la notificación de una interrumpida no repite cómo seguir (auditoría de C3b)', async () => {
        const e = armar({ reversion: filaNueva({ estado: 'REVIRTIENDO', hechos: 120, total: 450, heartbeatAt: viejo, startedAt: viejo }) });
        e.svc.ahora = () => AHORA;
        await e.svc.revisarReversionesColgadas();
        const mensaje: string = e.notificaciones.crear.mock.calls[0][0].mensaje;
        expect(mensaje.match(/Revertir de nuevo/g)).toHaveLength(1);
        expect(mensaje).toContain('se revirtieron 120 de 450. Revertir de nuevo sigue desde ahí.');
    });

    it('el filtro de la consulta pide solo latidos de hace más de 3 minutos', async () => {
        const e = armar({ reversion: filaNueva({ estado: 'REVIRTIENDO', heartbeatAt: fresco }) });
        e.svc.ahora = () => AHORA;
        await e.svc.revisarReversionesColgadas();
        const where = e.prisma.reversion_accion.findMany.mock.calls[0][0].where;
        expect(where.estado).toBe('REVIRTIENDO');
        expect(where.OR[0].heartbeatAt.lt).toEqual(new Date(AHORA - 3 * 60_000));
    });

    it('si latió entre la lectura y la escritura no la pisa (updateMany condicionado al latido)', async () => {
        const e = armar({ reversion: filaNueva({ estado: 'REVIRTIENDO', heartbeatAt: viejo, startedAt: viejo }) });
        e.svc.ahora = () => AHORA;
        e.prisma.reversion_accion.findMany.mockImplementationOnce(async () => {
            const leida = { ...e.estado().reversion! };
            e.estado().reversion!.heartbeatAt = new Date(AHORA); // latió justo después
            return [leida];
        });
        expect(await e.svc.revisarReversionesColgadas()).toEqual([]);
        expect(e.estado().reversion?.estado).toBe('REVIRTIENDO');
    });

    it('EN_COLA de hace más de 3 min con el job inexistente o failed pasa a INTERRUMPIDA; con el job waiting no se toca', async () => {
        const sinJob = armar({ reversion: filaNueva({ estado: 'EN_COLA', encoladaAt: viejo }) });
        sinJob.svc.ahora = () => AHORA;
        expect(await sinJob.svc.revisarReversionesColgadas()).toEqual([5]);
        expect(sinJob.estado().reversion).toMatchObject({ estado: 'INTERRUMPIDA' });
        expect(sinJob.estado().reversion!.error).toContain('No llegó a empezar');

        const fallido = armar({ reversion: filaNueva({ estado: 'EN_COLA', encoladaAt: viejo }) });
        fallido.svc.ahora = () => AHORA;
        fallido.cola.getJob.mockResolvedValue({ getState: async () => 'failed' });
        expect(await fallido.svc.revisarReversionesColgadas()).toEqual([5]);

        const esperando = armar({ reversion: filaNueva({ estado: 'EN_COLA', encoladaAt: viejo }) });
        esperando.svc.ahora = () => AHORA;
        esperando.cola.getJob.mockResolvedValue({ getState: async () => 'waiting' });
        expect(await esperando.svc.revisarReversionesColgadas()).toEqual([]);
        expect(esperando.estado().reversion?.estado).toBe('EN_COLA');
    });

    it('sin Redis (getJob tira) no toca una EN_COLA: ante la duda, no cierra', async () => {
        const e = armar({ reversion: filaNueva({ estado: 'EN_COLA', encoladaAt: viejo }) });
        e.svc.ahora = () => AHORA;
        e.cola.getJob.mockRejectedValue(new Error('ECONNREFUSED'));
        expect(await e.svc.revisarReversionesColgadas()).toEqual([]);
    });
});
