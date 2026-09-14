import { MulticlavesProcessor } from './multiclaves.processor';
import { BatchRow, ProcessContext } from './processor.interface';
import { TramiteClaves } from '../utils/multiclaves-parser';

interface FilaDb {
    id: number;
    empresaId: number;
    remesaId: number;
    nroTramite: string;
    nroConvenio: string;
    tipo: string;
    estado: string;
    reemplazadaPorRemesaId: number | null;
    fechaVencimiento: Date;
    [key: string]: unknown;
}

/** Prisma mockeado con una "base" en memoria de `clave_pago`, al estilo de facturas.processor.spec.ts. */
function makeDb(seed: FilaDb[] = []) {
    const rows: FilaDb[] = [...seed];
    let nextId = seed.reduce((m, r) => Math.max(m, r.id), 0) + 1;
    const empresas: Record<number, string> = { 1: 'TELECOM', 2: 'TELECOM_PERSONAL' };
    const remesasNombre: Record<number, string> = { 100: 'MC-A', 200: 'MC-B', 900: 'MC-VIEJA' };
    /** Convenios que `createMany` rechaza a propósito, para simular una falla puntual del lote. */
    const failConvenios = new Set<string>();
    /** Remesas que "ya no existen" (hallazgo #6): el join a `remesa` tiene que dar null, no explotar. */
    const remesasBorradas = new Set<number>();

    const findMany = jest.fn(async ({ where, distinct }: any) => {
        let out = rows;
        if (where?.nroConvenio?.in) out = out.filter((r) => where.nroConvenio.in.includes(r.nroConvenio));
        if (where?.empresaId != null) out = out.filter((r) => r.empresaId === where.empresaId);
        if (where?.nroTramite?.in) out = out.filter((r) => where.nroTramite.in.includes(r.nroTramite));
        if (where?.estado) out = out.filter((r) => r.estado === where.estado);
        if (distinct) {
            const vistos = new Set<string>();
            out = out.filter((r) => {
                const k = distinct.map((d: string) => r[d]).join('|');
                if (vistos.has(k)) return false;
                vistos.add(k);
                return true;
            });
        }
        return out.map((r) => ({
            ...r,
            empresa: { nombre: empresas[r.empresaId] ?? `Empresa${r.empresaId}` },
            remesa: remesasBorradas.has(r.remesaId) ? null : { numeroRemesa: remesasNombre[r.remesaId] ?? `R${r.remesaId}` },
        }));
    });

    const createMany = jest.fn(async ({ data }: any) => {
        if (data.some((d: any) => failConvenios.has(d.nroConvenio))) {
            throw new Error('constraint violation simulada');
        }
        for (const d of data) rows.push({ id: nextId++, ...d });
        return { count: data.length };
    });

    const updateMany = jest.fn(async ({ where, data }: any) => {
        let n = 0;
        for (const r of rows) {
            if (where.id.in.includes(r.id)) {
                Object.assign(r, data);
                n++;
            }
        }
        return { count: n };
    });

    const count = jest.fn(async ({ where }: any) => {
        let out = rows;
        if (where?.remesaId != null) out = out.filter((r) => r.remesaId === where.remesaId);
        if (where?.reemplazadaPorRemesaId != null) out = out.filter((r) => r.reemplazadaPorRemesaId === where.reemplazadaPorRemesaId);
        return out.length;
    });

    const deudorFindMany = jest.fn(async () => []);
    const importerrorCreateMany = jest.fn(async () => ({}));

    const $transaction = jest.fn(async (fnOrArr: any) => {
        const tx = { clave_pago: { createMany, updateMany }, deudor: { findMany: deudorFindMany } };
        return typeof fnOrArr === 'function' ? fnOrArr(tx) : Promise.all(fnOrArr);
    });

    return { rows, failConvenios, remesasBorradas, findMany, createMany, updateMany, count, deudorFindMany, importerrorCreateMany, $transaction };
}

function makeCtx(db: ReturnType<typeof makeDb>, over: Partial<{ empresaId: number; remesaId: number }> = {}): ProcessContext {
    return {
        prisma: {
            clave_pago: { findMany: db.findMany, createMany: db.createMany, updateMany: db.updateMany, count: db.count },
            deudor: { findMany: db.deudorFindMany },
            importerror: { createMany: db.importerrorCreateMany },
            $transaction: db.$transaction,
        },
        empresaId: 1,
        remesaId: 100,
        ...over,
    } as unknown as ProcessContext;
}

/** Arma un trámite con sus 2 claves ya clasificadas, como lo devuelve el parser. */
function tramite(nroTramite: string, opts: {
    convenioTotal: string; convenioQuita: string; totalCent: number; quitaCent: number; vto?: string;
}): TramiteClaves {
    const vto = opts.vto ?? '2026-10-27';
    return {
        nroTramite,
        lineas: [1, 2],
        saldoTramiteCentavos: opts.totalCent,
        claves: [
            {
                tipo: 'TOTAL', nroConvenio: opts.convenioTotal, importeCentavos: opts.totalCent,
                clavePago: '0'.repeat(22), codigoBarras: '4'.repeat(50), fechaVencimiento: vto,
                codigoGestor: '1008', marca: 'C', linea: 1,
            },
            {
                tipo: 'QUITA', nroConvenio: opts.convenioQuita, importeCentavos: opts.quitaCent,
                clavePago: '0'.repeat(22), codigoBarras: '4'.repeat(50), fechaVencimiento: vto,
                codigoGestor: '1008', marca: 'C', linea: 2,
            },
        ],
    };
}

const fila = (idx: number, t: TramiteClaves): BatchRow => ({ idx, row: t as any });

const filaExistente = (over: Partial<FilaDb> & { id: number; nroConvenio: string }): FilaDb => ({
    empresaId: 1,
    remesaId: 100,
    nroTramite: '1000000001',
    tipo: 'TOTAL',
    estado: 'VIGENTE',
    reemplazadaPorRemesaId: null,
    fechaVencimiento: new Date('2026-10-27'),
    ...over,
});

describe('MulticlavesProcessor — camino por lote', () => {
    it('trámite nuevo inserta las 2 claves VIGENTE', async () => {
        const db = makeDb();
        const p = new MulticlavesProcessor();
        const t = tramite('1000000001', { convenioTotal: '11111111', convenioQuita: '22222222', totalCent: 100000, quitaCent: 50000 });

        const errores = await p.processBatch([fila(0, t)], makeCtx(db));

        expect(errores).toEqual([]);
        expect(db.rows).toHaveLength(2);
        expect(db.rows.every((r) => r.estado === 'VIGENTE')).toBe(true);
        expect(db.rows.map((r) => r.tipo).sort()).toEqual(['QUITA', 'TOTAL']);
    });

    it('recargar el mismo trámite es idempotente: no duplica ni da error (R4)', async () => {
        const db = makeDb();
        const p = new MulticlavesProcessor();
        const t = tramite('1000000001', { convenioTotal: '11111111', convenioQuita: '22222222', totalCent: 100000, quitaCent: 50000 });

        await p.processBatch([fila(0, t)], makeCtx(db));
        db.createMany.mockClear();
        const errores = await p.processBatch([fila(0, t)], makeCtx(db));

        expect(errores).toEqual([]);
        expect(db.createMany).not.toHaveBeenCalled();
        expect(db.rows).toHaveLength(2);
    });

    it('reemisión con vencimiento posterior: las vigentes pasan a REEMPLAZADA y las nuevas quedan VIGENTE', async () => {
        const db = makeDb([
            filaExistente({ id: 1, nroConvenio: '11111111', tipo: 'TOTAL', fechaVencimiento: new Date('2026-09-01') }),
            filaExistente({ id: 2, nroConvenio: '22222222', tipo: 'QUITA', fechaVencimiento: new Date('2026-09-01') }),
        ]);
        const p = new MulticlavesProcessor();
        const t = tramite('1000000001', { convenioTotal: '33333333', convenioQuita: '44444444', totalCent: 100000, quitaCent: 50000, vto: '2026-10-27' });

        const errores = await p.processBatch([fila(0, t)], makeCtx(db, { remesaId: 200 }));

        expect(errores).toEqual([]);
        const viejas = db.rows.filter((r) => ['11111111', '22222222'].includes(r.nroConvenio));
        expect(viejas.every((r) => r.estado === 'REEMPLAZADA' && r.reemplazadaPorRemesaId === 200)).toBe(true);
        const nuevas = db.rows.filter((r) => ['33333333', '44444444'].includes(r.nroConvenio));
        expect(nuevas.every((r) => r.estado === 'VIGENTE')).toBe(true);
    });

    it('tanda con vencimiento ANTERIOR al vigente entra directo como REEMPLAZADA, sin tocar las vigentes', async () => {
        const db = makeDb([
            filaExistente({ id: 1, nroConvenio: '11111111', tipo: 'TOTAL', fechaVencimiento: new Date('2026-10-27') }),
            filaExistente({ id: 2, nroConvenio: '22222222', tipo: 'QUITA', fechaVencimiento: new Date('2026-10-27') }),
        ]);
        const p = new MulticlavesProcessor();
        const t = tramite('1000000001', { convenioTotal: '33333333', convenioQuita: '44444444', totalCent: 100000, quitaCent: 50000, vto: '2026-09-01' });

        const errores = await p.processBatch([fila(0, t)], makeCtx(db, { remesaId: 200 }));

        expect(errores).toEqual([]);
        const viejas = db.rows.filter((r) => ['11111111', '22222222'].includes(r.nroConvenio));
        expect(viejas.every((r) => r.estado === 'VIGENTE')).toBe(true); // no tocadas
        const nuevas = db.rows.filter((r) => ['33333333', '44444444'].includes(r.nroConvenio));
        // Reemplazadas por la remesa que trajo la tanda VIGENTE actual (100), no por la nueva (200).
        expect(nuevas.every((r) => r.estado === 'REEMPLAZADA' && r.reemplazadaPorRemesaId === 100)).toBe(true);

        // §5.4/R2: la tanda anterior no puede entrar en silencio — el aviso queda en importerror.
        expect(db.importerrorCreateMany).toHaveBeenCalledTimes(1);
        const aviso = db.importerrorCreateMany.mock.calls[0][0].data[0];
        expect(aviso.remesaId).toBe(200);
        expect(aviso.rowNumber).toBe(0);
        expect(aviso.errorMsg).toContain('[aviso] TANDA_ANTERIOR: 1 caso(s)');
        expect(aviso.errorMsg).toContain('1000000001');
    });

    it('convenio ya cargado en OTRA empresa → error del trámite, sin escrituras', async () => {
        const db = makeDb([
            filaExistente({ id: 1, nroConvenio: '11111111', empresaId: 2, remesaId: 900, nroTramite: '9999999999' }),
        ]);
        const p = new MulticlavesProcessor();
        const t = tramite('1000000001', { convenioTotal: '11111111', convenioQuita: '22222222', totalCent: 100000, quitaCent: 50000 });

        const errores = await p.processBatch([fila(0, t)], makeCtx(db, { empresaId: 1, remesaId: 100 }));

        expect(errores).toHaveLength(1);
        expect(errores[0].error).toContain('CONVENIO_YA_EXISTE');
        expect(errores[0].error).toContain('TELECOM_PERSONAL');
        expect(db.rows).toHaveLength(1); // sin escrituras nuevas
    });

    it('conflicto contra una clave cuya remesa ya no existe no explota (hallazgo #6, FK RESTRICT sin join defensivo)', async () => {
        const db = makeDb([
            filaExistente({ id: 1, nroConvenio: '11111111', empresaId: 2, remesaId: 900, nroTramite: '9999999999' }),
        ]);
        db.remesasBorradas.add(900); // simula un wipe manual que no respetó el orden (clave_pago antes que remesa)
        const p = new MulticlavesProcessor();
        const t = tramite('1000000001', { convenioTotal: '11111111', convenioQuita: '22222222', totalCent: 100000, quitaCent: 50000 });

        const errores = await p.processBatch([fila(0, t)], makeCtx(db, { empresaId: 1, remesaId: 100 }));

        expect(errores).toHaveLength(1);
        expect(errores[0].error).toContain('CONVENIO_YA_EXISTE');
        expect(errores[0].error).toContain('(remesa eliminada)'); // no revienta con `.numeroRemesa` de null
    });

    it('un solo convenio del par ya cargado (mismo trámite) → TANDA_PARCIAL, no modifica nada', async () => {
        const db = makeDb([filaExistente({ id: 1, nroConvenio: '11111111' })]);
        const p = new MulticlavesProcessor();
        const t = tramite('1000000001', { convenioTotal: '11111111', convenioQuita: '22222222', totalCent: 100000, quitaCent: 50000 });

        const errores = await p.processBatch([fila(0, t)], makeCtx(db));

        expect(errores).toHaveLength(1);
        expect(errores[0].error).toContain('TANDA_PARCIAL');
        expect(db.rows).toHaveLength(1);
    });

    it('si el lote falla, reintenta trámite por trámite y el error queda en el trámite culpable', async () => {
        const db = makeDb();
        db.failConvenios.add('99999999');
        const p = new MulticlavesProcessor();
        const bueno = tramite('1000000001', { convenioTotal: '11111111', convenioQuita: '22222222', totalCent: 100000, quitaCent: 50000 });
        const malo = tramite('2000000002', { convenioTotal: '99999999', convenioQuita: '88888888', totalCent: 200000, quitaCent: 100000 });

        const errores = await p.processBatch([fila(0, bueno), fila(1, malo)], makeCtx(db));

        expect(errores).toHaveLength(1);
        expect(errores[0].idx).toBe(1);
        expect(db.rows.some((r) => r.nroConvenio === '11111111')).toBe(true); // el trámite bueno sí se guardó
        expect(db.rows.some((r) => r.nroConvenio === '99999999')).toBe(false); // el malo no
    });

    it('el processor (singleton del registry) no arrastra estado entre corridas de remesas distintas', async () => {
        const p = new MulticlavesProcessor();

        const db1 = makeDb();
        await p.processBatch(
            [fila(0, tramite('1000000001', { convenioTotal: '11111111', convenioQuita: '22222222', totalCent: 100000, quitaCent: 50000 }))],
            makeCtx(db1, { empresaId: 1, remesaId: 100 }),
        );

        const db2 = makeDb();
        const errores = await p.processBatch(
            [fila(0, tramite('1000000001', { convenioTotal: '33333333', convenioQuita: '44444444', totalCent: 100000, quitaCent: 50000 }))],
            makeCtx(db2, { empresaId: 2, remesaId: 200 }),
        );

        expect(errores).toEqual([]);
        expect(db2.rows).toHaveLength(2);
    });

    it('un lote de 1.000 trámites en reemisión escribe en pocas queries, no una por trámite (hallazgo de escala)', async () => {
        const N = 1000;
        const seed: FilaDb[] = [];
        for (let i = 0; i < N; i++) {
            seed.push(filaExistente({ id: i * 2 + 1, nroTramite: `T${i}`, nroConvenio: `A${String(i).padStart(7, '0')}`, tipo: 'TOTAL', fechaVencimiento: new Date('2026-01-01') }));
            seed.push(filaExistente({ id: i * 2 + 2, nroTramite: `T${i}`, nroConvenio: `B${String(i).padStart(7, '0')}`, tipo: 'QUITA', fechaVencimiento: new Date('2026-01-01') }));
        }
        const db = makeDb(seed);
        const p = new MulticlavesProcessor();

        const filas = Array.from({ length: N }, (_, i) => fila(i, tramite(`T${i}`, {
            convenioTotal: `C${String(i).padStart(7, '0')}`, convenioQuita: `D${String(i).padStart(7, '0')}`,
            totalCent: 100000, quitaCent: 50000, vto: '2026-12-27', // posterior: reemisión para las 1.000
        })));

        const errores = await p.processBatch(filas, makeCtx(db));

        expect(errores).toEqual([]);
        expect(db.rows.filter((r) => r.estado === 'VIGENTE')).toHaveLength(N * 2);
        // El punto del hallazgo: la cantidad de llamadas a Prisma no puede crecer 1:1 con los
        // trámites — con 1.000 trámites (2.000 updates + 2.000 inserts si fuera por trámite) el
        // auditor midió que la transacción se corta bastante antes de terminar.
        expect(db.updateMany.mock.calls.length).toBeLessThanOrEqual(3);
        expect(db.createMany.mock.calls.length).toBeLessThanOrEqual(3);
    });
});

describe('MulticlavesProcessor — afterAll', () => {
    it('loguea el resumen sin lanzar y sin escribir nada', async () => {
        const db = makeDb([
            filaExistente({ id: 1, nroConvenio: '11111111', remesaId: 100 }),
            filaExistente({ id: 2, nroConvenio: '22222222', remesaId: 100 }),
        ]);
        const p = new MulticlavesProcessor();
        await expect(p.afterAll(makeCtx(db))).resolves.toBeUndefined();
        expect(db.rows).toHaveLength(2); // no escribió nada
    });
});
