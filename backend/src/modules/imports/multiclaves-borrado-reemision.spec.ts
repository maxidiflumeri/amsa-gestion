/**
 * Hallazgo bloqueante del auditor sobre la fase 1 de multiclaves: borrar una carga podía dejar un
 * trámite con 4 claves VIGENTE (reactivaba una tanda "anterior" que nunca debió ganar) o con 0
 * (una cadena de reemisión con un eslabón borrado en el medio quedaba apuntando a una remesa ya
 * borrada, sin que nadie lo corrigiera).
 *
 * Se prueba con el processor y el `deleteRemesaMulticlaves` REALES contra una base en memoria que
 * simula lo suficiente de Prisma (incluida la ausencia de una remesa borrada, para el hallazgo #6).
 * No usa mocks de alto nivel: arma el estado cargando trámites de verdad, igual que haría el
 * runner, y borra con el mismo método que usa el controller.
 */
import { ImportService } from './imports.service';
import { MulticlavesProcessor } from './processors/multiclaves.processor';
import { ProcessContext } from './processors/processor.interface';
import { TramiteClaves } from './utils/multiclaves-parser';

interface FilaDb {
    id: number;
    empresaId: number;
    remesaId: number;
    nroTramite: string;
    nroConvenio: string;
    tipo: string;
    estado: string;
    reemplazadaPorRemesaId: number | null;
    reemplazadaEn: Date | null;
    fechaVencimiento: Date;
    createdAt: Date;
    [key: string]: unknown;
}

function match(c: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean {
    return Object.entries(where ?? {}).every(([k, v]) => {
        if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)) {
            const cond = v as Record<string, unknown>;
            if ('in' in cond) return (cond.in as unknown[]).includes(c[k]);
            if ('not' in cond) return c[k] !== cond.not;
        }
        return c[k] === v;
    });
}

/** Base en memoria: `clave_pago` + `remesa` reales (para poder borrar remesas de verdad) + el resto vacío. */
function makeFakeDb() {
    const claves: FilaDb[] = [];
    const remesasVivas = new Set<number>();
    let nextId = 1;
    let reloj = 0; // createdAt determinístico y creciente, para desempatar por "cargada más tarde"

    const clave_pago = {
        findMany: jest.fn(async ({ where, distinct }: any) => {
            let r = claves.filter((c) => match(c, where));
            if (distinct) {
                const vistos = new Set<string>();
                r = r.filter((c) => {
                    const k = distinct.map((d: string) => c[d]).join('|');
                    if (vistos.has(k)) return false;
                    vistos.add(k);
                    return true;
                });
            }
            // Hallazgo #6: el join a `remesa` no puede explotar si la remesa referenciada (por
            // `reemplazadaPorRemesaId`, sin FK a propósito) ya no existe. Acá no se arma un join de
            // verdad —el código de multiclaves no hace `include: { remesa }` sobre ese campo—, pero
            // si alguna vez lo hiciera, `remesa` da `null` en vez de reventar.
            return r.map((c) => ({
                ...c,
                empresa: { nombre: `Empresa${c.empresaId}` },
                remesa: remesasVivas.has(c.remesaId) ? { numeroRemesa: `R${c.remesaId}` } : null,
            }));
        }),
        count: jest.fn(async ({ where }: any) => claves.filter((c) => match(c, where)).length),
        createMany: jest.fn(async ({ data }: any) => {
            for (const d of data) claves.push({ id: nextId++, createdAt: new Date(reloj++), reemplazadaEn: null, ...d });
            return { count: data.length };
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
            let n = 0;
            for (const c of claves) if (match(c, where)) { Object.assign(c, data); n++; }
            return { count: n };
        }),
        deleteMany: jest.fn(async ({ where }: any) => {
            const antes = claves.length;
            for (let i = claves.length - 1; i >= 0; i--) if (match(claves[i], where)) claves.splice(i, 1);
            return { count: antes - claves.length };
        }),
    };

    const remesa = {
        findUnique: jest.fn(async ({ where }: any) =>
            remesasVivas.has(where.id)
                ? { id: where.id, categoria: 'MULTICLAVES', estadoProceso: 'FINALIZADA', usuarioCreadorId: 1 }
                : null,
        ),
        delete: jest.fn(async ({ where }: any) => { remesasVivas.delete(where.id); return {}; }),
    };

    const prisma: any = {
        clave_pago,
        remesa,
        convenio: { count: jest.fn(async () => 0) },
        jobimport: { deleteMany: jest.fn(async () => ({})) },
        importerror: { deleteMany: jest.fn(async () => ({})), createMany: jest.fn(async () => ({})) },
    };
    prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));

    return { prisma, claves, remesasVivas };
}

function tramite(nroTramite: string, opts: {
    convenioTotal: string; convenioQuita: string; vto: string; totalCent?: number; quitaCent?: number;
}): TramiteClaves {
    const totalCent = opts.totalCent ?? 3976003;
    const quitaCent = opts.quitaCent ?? 1988001;
    return {
        nroTramite,
        lineas: [1, 2],
        saldoTramiteCentavos: totalCent,
        claves: [
            { tipo: 'TOTAL', nroConvenio: opts.convenioTotal, importeCentavos: totalCent, clavePago: '0'.repeat(22), codigoBarras: '4'.repeat(50), fechaVencimiento: opts.vto, codigoGestor: '1008', marca: 'C', linea: 1 },
            { tipo: 'QUITA', nroConvenio: opts.convenioQuita, importeCentavos: quitaCent, clavePago: '0'.repeat(22), codigoBarras: '4'.repeat(50), fechaVencimiento: opts.vto, codigoGestor: '1008', marca: 'C', linea: 2 },
        ],
    };
}

/** Un trámite SOLO_TOTAL (fase 1.1): una única clave, siempre clasificada TOTAL. */
function tramiteSoloTotal(nroTramite: string, opts: {
    convenioTotal: string; vto: string; totalCent?: number;
}): TramiteClaves {
    const totalCent = opts.totalCent ?? 3976003;
    return {
        nroTramite,
        lineas: [1],
        saldoTramiteCentavos: totalCent,
        claves: [
            { tipo: 'TOTAL', nroConvenio: opts.convenioTotal, importeCentavos: totalCent, clavePago: '0'.repeat(22), codigoBarras: '4'.repeat(50), fechaVencimiento: opts.vto, codigoGestor: '1008', marca: 'C', linea: 1 },
        ],
    };
}

/** Sube una tanda a una remesa nueva y la registra como viva. */
async function cargar(
    db: ReturnType<typeof makeFakeDb>,
    processor: MulticlavesProcessor,
    remesaId: number,
    empresaId: number,
    t: TramiteClaves,
) {
    db.remesasVivas.add(remesaId);
    const ctx = { prisma: db.prisma, empresaId, remesaId } as unknown as ProcessContext;
    return processor.processBatch([{ row: t as any, idx: 0 }], ctx);
}

function makeService(prisma: any): ImportService {
    return new ImportService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
}

const USER = { sub: 1, permisos: ['importacion.eliminar', 'importacion.ver_progreso_otros'] };

/**
 * El invariante que tiene que sobrevivir a cualquier secuencia de cargas y borrados (§5.8, R2).
 *
 * Fase 1.1: una tanda puede traer 1 clave (SOLO_TOTAL) o 2 (TOTAL + QUITA), así que el invariante
 * deja de ser "0 o 2 vigentes" y pasa a ser **"0 vigentes, o exactamente 1 TOTAL y a lo sumo 1
 * QUITA, todas de la misma carga"** — nunca 2 TOTAL, nunca una QUITA sin su TOTAL, nunca 3 o más.
 */
function verificarInvariante(claves: FilaDb[], remesasVivas: Set<number>) {
    const porTramite = new Map<string, FilaDb[]>();
    for (const c of claves) {
        const k = `${c.empresaId}|${c.nroTramite}`;
        (porTramite.get(k) ?? porTramite.set(k, []).get(k)!).push(c);
    }
    for (const [tramiteKey, filas] of porTramite) {
        const vigentes = filas.filter((f) => f.estado === 'VIGENTE');
        const totalesVig = vigentes.filter((f) => f.tipo === 'TOTAL');
        const quitasVig = vigentes.filter((f) => f.tipo === 'QUITA');
        expect(totalesVig.length).toBeLessThanOrEqual(1); // nunca 2 TOTAL vigentes
        expect(quitasVig.length).toBeLessThanOrEqual(1); // nunca 2 QUITA vigentes
        expect(quitasVig.length === 0 || totalesVig.length === 1).toBe(true); // nunca QUITA sin su TOTAL
        expect(vigentes.length).toBeLessThanOrEqual(2); // nunca 3+
        for (const f of filas) {
            if (f.reemplazadaPorRemesaId != null) {
                expect(remesasVivas.has(f.reemplazadaPorRemesaId)).toBe(true); // nunca apunta a una remesa borrada
            }
        }
        if (vigentes.length > 0) {
            // Todas las vigentes son de la MISMA remesa (la tanda ganadora, sea de 1 o 2 claves).
            expect(new Set(vigentes.map((v) => v.remesaId)).size).toBe(1);
        }
        void tramiteKey;
    }
}

describe('MULTICLAVES — borrado con historial de reemisión (bloqueante del auditor)', () => {
    it('Escenario 1 — A (27/10) < B (27/11, reemisión) + C (15/10, tanda anterior de B): borrar B deja 2 vigentes, no 4', async () => {
        const db = makeFakeDb();
        const processor = new MulticlavesProcessor();

        await cargar(db, processor, 1, 5, tramite('1841012140', { convenioTotal: '00000001', convenioQuita: '00000002', vto: '2026-10-27' })); // A
        await cargar(db, processor, 2, 5, tramite('1841012140', { convenioTotal: '00000003', convenioQuita: '00000004', vto: '2026-11-27' })); // B, reemisión: reemplaza a A
        const errC = await cargar(db, processor, 3, 5, tramite('1841012140', { convenioTotal: '00000005', convenioQuita: '00000006', vto: '2026-10-15' })); // C, tanda anterior a B
        expect(errC).toEqual([]);

        // Estado antes de borrar: A REEMPLAZADA<-B, B VIGENTE, C REEMPLAZADA<-B (tanda anterior).
        expect(db.claves.filter((c) => c.estado === 'VIGENTE')).toHaveLength(2);
        expect(db.claves.filter((c) => c.remesaId === 3).every((c) => c.reemplazadaPorRemesaId === 2)).toBe(true);
        verificarInvariante(db.claves, db.remesasVivas);

        const service = makeService(db.prisma);
        const r = await service.deleteRemesa(2, USER); // borra B

        expect(r).toMatchObject({ deleted: true, clavesEliminadas: 2 });
        verificarInvariante(db.claves, db.remesasVivas);

        const vigentes = db.claves.filter((c) => c.estado === 'VIGENTE');
        expect(vigentes).toHaveLength(2); // NO 4: la auditoría encontró 4 acá
        expect(vigentes.every((c) => c.remesaId === 1)).toBe(true); // gana A (27/10 > 15/10 de C)

        const c = db.claves.filter((c) => c.remesaId === 3);
        expect(c.every((f) => f.estado === 'REEMPLAZADA' && f.reemplazadaPorRemesaId === 1)).toBe(true); // C ahora apunta a A, no a B (borrada)
    });

    it('Escenario 2 — cadena A(27/10)→B(27/11)→C(27/12): borrar B y después C no deja 0 vigentes', async () => {
        const db = makeFakeDb();
        const processor = new MulticlavesProcessor();

        await cargar(db, processor, 1, 5, tramite('1841012140', { convenioTotal: '00000001', convenioQuita: '00000002', vto: '2026-10-27' })); // A
        await cargar(db, processor, 2, 5, tramite('1841012140', { convenioTotal: '00000003', convenioQuita: '00000004', vto: '2026-11-27' })); // B, reemplaza a A
        await cargar(db, processor, 3, 5, tramite('1841012140', { convenioTotal: '00000005', convenioQuita: '00000006', vto: '2026-12-27' })); // C, reemplaza a B
        verificarInvariante(db.claves, db.remesasVivas);

        const service = makeService(db.prisma);

        await service.deleteRemesa(2, USER); // borra B (el eslabón del medio)
        verificarInvariante(db.claves, db.remesasVivas);
        // A ya no puede seguir apuntando a B (borrada): tiene que repuntar a la tanda que de verdad
        // sigue ganando, que es C.
        const aTrasBorrarB = db.claves.filter((c) => c.remesaId === 1);
        expect(aTrasBorrarB.every((f) => f.reemplazadaPorRemesaId === 3)).toBe(true);
        expect(db.claves.filter((c) => c.estado === 'VIGENTE').every((c) => c.remesaId === 3)).toBe(true);

        await service.deleteRemesa(3, USER); // borra C
        verificarInvariante(db.claves, db.remesasVivas);

        const vigentesFinales = db.claves.filter((c) => c.estado === 'VIGENTE');
        expect(vigentesFinales).toHaveLength(2); // NO 0: la auditoría encontró 0 acá
        expect(vigentesFinales.every((c) => c.remesaId === 1)).toBe(true); // solo queda A
    });

    it('invariante — una secuencia larga de cargas y borrados nunca deja 1/3/4 vigentes ni punteros colgados', async () => {
        const db = makeFakeDb();
        const processor = new MulticlavesProcessor();
        const EMPRESA = 5;
        const TRAMITE = '1841012140';

        const pasos: Array<
            | { accion: 'cargar'; remesaId: number; vto: string; convenios: [string, string] }
            | { accion: 'borrar'; remesaId: number }
        > = [
            { accion: 'cargar', remesaId: 1, vto: '2026-10-27', convenios: ['00000001', '00000002'] }, // A
            { accion: 'cargar', remesaId: 2, vto: '2026-11-27', convenios: ['00000003', '00000004'] }, // B reemplaza A
            { accion: 'cargar', remesaId: 3, vto: '2026-10-01', convenios: ['00000005', '00000006'] }, // C tanda anterior de B
            { accion: 'cargar', remesaId: 4, vto: '2026-12-27', convenios: ['00000007', '00000008'] }, // D reemplaza B
            { accion: 'borrar', remesaId: 2 }, // eslabón del medio con una tanda anterior colgando de él
            { accion: 'borrar', remesaId: 3 }, // la tanda anterior misma (no debería cambiar nada)
            { accion: 'cargar', remesaId: 6, vto: '2026-09-01', convenios: ['00000009', '00000010'] }, // E tanda anterior de D
            { accion: 'borrar', remesaId: 4 }, // la vigente actual, con una tanda anterior propia
            { accion: 'borrar', remesaId: 1 }, // la más vieja de todas, ya sin nada que la referencie
        ];

        const service = makeService(db.prisma);
        for (const paso of pasos) {
            if (paso.accion === 'cargar') {
                await cargar(db, processor, paso.remesaId, EMPRESA, tramite(TRAMITE, { convenioTotal: paso.convenios[0], convenioQuita: paso.convenios[1], vto: paso.vto }));
            } else {
                await service.deleteRemesa(paso.remesaId, USER);
            }
            verificarInvariante(db.claves, db.remesasVivas);
        }

        // A, B, C y D quedaron borradas; solo sobrevive E (remesa 6) — la única tanda que queda.
        const vigentesFinales = db.claves.filter((c) => c.estado === 'VIGENTE');
        expect(vigentesFinales).toHaveLength(2);
        expect(vigentesFinales.every((c) => c.remesaId === 6)).toBe(true);
    });
});

describe('MULTICLAVES — reemisión con cantidad distinta de claves (fase 1.1)', () => {
    it('vigente con PAR (2) y llega una tanda SOLO_TOTAL (1): reemplaza las 2, no quedan mezcladas', async () => {
        const db = makeFakeDb();
        const processor = new MulticlavesProcessor();

        await cargar(db, processor, 1, 5, tramite('1841012140', { convenioTotal: '00000001', convenioQuita: '00000002', vto: '2026-10-27' })); // A: par
        verificarInvariante(db.claves, db.remesasVivas);

        const errB = await cargar(db, processor, 2, 5, tramiteSoloTotal('1841012140', { convenioTotal: '00000003', vto: '2026-11-27' })); // B: solo total, más nueva
        expect(errB).toEqual([]);
        verificarInvariante(db.claves, db.remesasVivas);

        const vigentes = db.claves.filter((c) => c.estado === 'VIGENTE');
        expect(vigentes).toHaveLength(1); // NO quedan 3 (la QUITA vieja de A + la TOTAL nueva de B)
        expect(vigentes[0].tipo).toBe('TOTAL');
        expect(vigentes[0].remesaId).toBe(2);
        const deA = db.claves.filter((c) => c.remesaId === 1);
        expect(deA.every((c) => c.estado === 'REEMPLAZADA' && c.reemplazadaPorRemesaId === 2)).toBe(true);
    });

    it('vigente SOLO_TOTAL (1) y llega una tanda PAR (2): reemplaza la única vigente', async () => {
        const db = makeFakeDb();
        const processor = new MulticlavesProcessor();

        await cargar(db, processor, 1, 5, tramiteSoloTotal('1841012140', { convenioTotal: '00000001', vto: '2026-10-27' })); // A: solo total
        verificarInvariante(db.claves, db.remesasVivas);

        const errB = await cargar(db, processor, 2, 5, tramite('1841012140', { convenioTotal: '00000002', convenioQuita: '00000003', vto: '2026-11-27' })); // B: par, más nueva
        expect(errB).toEqual([]);
        verificarInvariante(db.claves, db.remesasVivas);

        const vigentes = db.claves.filter((c) => c.estado === 'VIGENTE');
        expect(vigentes).toHaveLength(2);
        expect(vigentes.every((c) => c.remesaId === 2)).toBe(true);
        const deA = db.claves.filter((c) => c.remesaId === 1);
        expect(deA.every((c) => c.estado === 'REEMPLAZADA' && c.reemplazadaPorRemesaId === 2)).toBe(true);
    });

    it('recargar el mismo archivo SOLO_TOTAL es idempotente (R4), aunque tenga 1 sola clave', async () => {
        const db = makeFakeDb();
        const processor = new MulticlavesProcessor();
        const t = tramiteSoloTotal('1841012140', { convenioTotal: '00000001', vto: '2026-10-27' });

        await cargar(db, processor, 1, 5, t);
        const errores = await cargar(db, processor, 1, 5, t); // misma remesa, mismo convenio

        expect(errores).toEqual([]);
        expect(db.claves.filter((c) => c.nroConvenio === '00000001')).toHaveLength(1); // no duplica
    });

    it('borrado: cadena PAR(A) → SOLO_TOTAL(B) → PAR(C); borrar B repunta A a C sin dejar una QUITA colgada', async () => {
        const db = makeFakeDb();
        const processor = new MulticlavesProcessor();

        await cargar(db, processor, 1, 5, tramite('1841012140', { convenioTotal: '00000001', convenioQuita: '00000002', vto: '2026-10-27' })); // A: par
        await cargar(db, processor, 2, 5, tramiteSoloTotal('1841012140', { convenioTotal: '00000003', vto: '2026-11-27' })); // B: solo total, reemplaza A
        await cargar(db, processor, 3, 5, tramite('1841012140', { convenioTotal: '00000004', convenioQuita: '00000005', vto: '2026-12-27' })); // C: par, reemplaza B
        verificarInvariante(db.claves, db.remesasVivas);
        expect(db.claves.filter((c) => c.estado === 'VIGENTE')).toHaveLength(2); // C, el par

        const service = makeService(db.prisma);
        await service.deleteRemesa(2, USER); // borra B (la solo-total del medio)
        verificarInvariante(db.claves, db.remesasVivas);

        // A (el par viejo) no puede quedar apuntando a B (borrada): repunta a C, que sigue vigente.
        const deA = db.claves.filter((c) => c.remesaId === 1);
        expect(deA.every((f) => f.reemplazadaPorRemesaId === 3)).toBe(true);
        const vigentesFinales = db.claves.filter((c) => c.estado === 'VIGENTE');
        expect(vigentesFinales.every((c) => c.remesaId === 3)).toBe(true);
        expect(vigentesFinales).toHaveLength(2);

        // Borrar también C tiene que dejar vigente el PAR de A (no una QUITA suelta ni una mezcla).
        await service.deleteRemesa(3, USER);
        verificarInvariante(db.claves, db.remesasVivas);
        const vigentesTrasBorrarC = db.claves.filter((c) => c.estado === 'VIGENTE');
        expect(vigentesTrasBorrarC).toHaveLength(2);
        expect(vigentesTrasBorrarC.every((c) => c.remesaId === 1)).toBe(true);
        expect(vigentesTrasBorrarC.map((c) => c.tipo).sort()).toEqual(['QUITA', 'TOTAL']);
    });

    it('borrado: al borrar la tanda SOLO_TOTAL vigente (sin nada más detrás) no deja nada colgado', async () => {
        const db = makeFakeDb();
        const processor = new MulticlavesProcessor();

        await cargar(db, processor, 1, 5, tramiteSoloTotal('1841012140', { convenioTotal: '00000001', vto: '2026-10-27' }));
        verificarInvariante(db.claves, db.remesasVivas);

        const service = makeService(db.prisma);
        const r = await service.deleteRemesa(1, USER);

        expect(r).toMatchObject({ deleted: true, clavesEliminadas: 1 });
        expect(db.claves).toHaveLength(0);
        verificarInvariante(db.claves, db.remesasVivas);
    });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Hallazgo de escala (segunda auditoría): el recálculo hacía 1 findMany + hasta 2 updateMany POR
 * TRÁMITE afectado, dentro de una única transacción interactiva — con miles de trámites (una
 * reemisión de archivo completo) esa transacción se corta contra el timeout de Prisma antes de
 * terminar. El fix trae todo en tandas de 1.000 por `IN` y aplica en updateMany agrupados: la
 * cantidad de queries tiene que crecer con la cantidad de TANDAS de 1.000, no con la cantidad de
 * trámites.
 * ──────────────────────────────────────────────────────────────────────────── */
describe('MULTICLAVES — borrado a escala (no puede ser O(trámites))', () => {
    it('con 7.500 trámites afectados por una reemisión, la cantidad de queries no crece con la cantidad de trámites', async () => {
        const db = makeFakeDb();
        const N = 7500;
        db.remesasVivas.add(1); // A: la tanda vieja, reemplazada por B en los 7.500 trámites
        db.remesasVivas.add(2); // B: la que se va a borrar
        const vtoViejo = new Date('2026-01-01');
        const vtoNuevo = new Date('2026-12-27');

        for (let i = 0; i < N; i++) {
            const nroTramite = `T${i}`;
            db.claves.push(
                { id: i * 4 + 1, empresaId: 5, remesaId: 1, nroTramite, nroConvenio: `A${i}`, tipo: 'TOTAL', estado: 'REEMPLAZADA', reemplazadaPorRemesaId: 2, reemplazadaEn: new Date(), fechaVencimiento: vtoViejo, createdAt: new Date(i) },
                { id: i * 4 + 2, empresaId: 5, remesaId: 1, nroTramite, nroConvenio: `B${i}`, tipo: 'QUITA', estado: 'REEMPLAZADA', reemplazadaPorRemesaId: 2, reemplazadaEn: new Date(), fechaVencimiento: vtoViejo, createdAt: new Date(i) },
                { id: i * 4 + 3, empresaId: 5, remesaId: 2, nroTramite, nroConvenio: `C${i}`, tipo: 'TOTAL', estado: 'VIGENTE', reemplazadaPorRemesaId: null, reemplazadaEn: null, fechaVencimiento: vtoNuevo, createdAt: new Date(N + i) },
                { id: i * 4 + 4, empresaId: 5, remesaId: 2, nroTramite, nroConvenio: `D${i}`, tipo: 'QUITA', estado: 'VIGENTE', reemplazadaPorRemesaId: null, reemplazadaEn: null, fechaVencimiento: vtoNuevo, createdAt: new Date(N + i) },
            );
        }

        const service = makeService(db.prisma);
        const t0 = Date.now();
        const r = await service.deleteRemesa(2, USER);
        const ms = Date.now() - t0;

        expect(r).toMatchObject({ deleted: true, clavesEliminadas: N * 2 });
        expect(db.claves.filter((c) => c.estado === 'VIGENTE')).toHaveLength(N * 2); // las 15.000 de A, ganadora
        expect(db.claves.filter((c) => c.estado === 'VIGENTE').every((c) => c.remesaId === 1)).toBe(true);

        const llamadasFindMany = db.prisma.clave_pago.findMany.mock.calls.length;
        const llamadasUpdateMany = db.prisma.clave_pago.updateMany.mock.calls.length;
        // eslint-disable-next-line no-console
        console.log(`Borrado con ${N} trámites afectados: ${ms}ms — findMany=${llamadasFindMany} updateMany=${llamadasUpdateMany}`);

        // El punto del hallazgo: con 7.500 trámites (15.000 filas de por medio + 15.000 restantes),
        // la vieja implementación hacía ~7.500 findMany y hasta ~15.000 updateMany. Acotado a un
        // puñado de tandas de 1.000: nunca tiene que acercarse a la cantidad de trámites.
        expect(llamadasFindMany).toBeLessThan(20);
        expect(llamadasUpdateMany).toBeLessThan(20);
    });
});
