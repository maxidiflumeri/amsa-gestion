/**
 * Anti-duplicados de PAGOS.
 *
 * El criterio por defecto —mismo deudor, mismo día, mismo importe— existe para que reimportar un
 * archivo acumulativo no duplique pagos. Lo que se verifica acá es que ese criterio se afine cuando
 * la plantilla mapea un identificador del comprobante, sin cambiar nada para las que no lo mapean.
 */
import { PagosProcessor } from './pagos.processor';
import { ProcessContext } from './processor.interface';

/** Prisma mockeado con una tabla de pagos en memoria que respeta el filtro del anti-dup. */
function makeCtx(facturas: Array<{ id: number; nroFactura: string; estado?: string }> = []) {
    const pagos: any[] = [];
    let seq = 1;

    // Marca PAGADA la factura del comprobante, si existe y no lo estaba ya.
    const updateMany = jest.fn().mockImplementation(({ where, data }: any) => {
        const tocadas = facturas.filter(
            (f) => f.nroFactura === where.nroFactura && f.estado !== where.estado?.not,
        );
        for (const f of tocadas) Object.assign(f, data);
        return Promise.resolve({ count: tocadas.length });
    });

    const findFirst = jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(
            pagos.find((p) => {
                // `deudorId` puede venir como valor exacto (el claim MANUAL) o como `{in: [...]}`
                // (el anti-duplicados de la fase 4a, que busca en TODOS los candidatos del trámite,
                // no solo en el elegido — acá siempre hay uno solo, pero la forma del `where` es la
                // misma que en producción).
                if (where.deudorId?.in) {
                    if (!where.deudorId.in.includes(p.deudorId)) return false;
                } else if (p.deudorId !== where.deudorId) {
                    return false;
                }
                if (where.origen && p.origen !== where.origen) return false;
                if (where.importe !== undefined && p.importe !== where.importe) return false;
                if (where.fecha?.gte && (p.fecha < where.fecha.gte || p.fecha > where.fecha.lte)) return false;
                if (where.confirmadoImport !== undefined && p.confirmadoImport !== where.confirmadoImport) return false;
                // La clave del test: si el where trae observación, tiene que coincidir.
                if (where.observacion !== undefined && p.observacion !== where.observacion) return false;
                if (where.idExterno !== undefined && p.idExterno !== where.idExterno) return false;
                return true;
            }) ?? null,
        ),
    );

    const ctx = {
        prisma: {
            $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
            pago: {
                findFirst,
                create: jest.fn().mockImplementation(({ data }: any) => {
                    pagos.push({ id: seq++, ...data });
                    return Promise.resolve(pagos[pagos.length - 1]);
                }),
                update: jest.fn().mockResolvedValue({}),
            },
            factura: { updateMany },
        },
        remesaId: 10,
        remesaOrigenId: 9,
        empresaId: 19,
        consolidacion: { consolidar: jest.fn().mockResolvedValue({}) },
        promesas: { cerrarCumplidas: jest.fn().mockResolvedValue({}) },
    } as unknown as ProcessContext;

    return { ctx, pagos, facturas, updateMany };
}

const fila = (importe: number, fecha: string, observacion?: string) => ({
    nro_cliente: '000003462007',
    importe,
    fecha,
    ...(observacion ? { observacion } : {}),
});

describe('PagosProcessor — anti-duplicados sin identificador de comprobante', () => {
    it('no reinserta el mismo pago al reimportar el archivo', async () => {
        const { ctx, pagos } = makeCtx();
        const p = new PagosProcessor();

        await p.processRow(fila(195.04, '2026-07-17'), ctx);
        await p.processRow(fila(195.04, '2026-07-17'), ctx);

        expect(pagos).toHaveLength(1);
    });

    it('registra por separado dos importes distintos del mismo día', async () => {
        const { ctx, pagos } = makeCtx();
        const p = new PagosProcessor();

        await p.processRow(fila(195.04, '2026-07-17'), ctx);
        await p.processRow(fila(500.50, '2026-07-17'), ctx);

        expect(pagos).toHaveLength(2);
    });

    it('registra por separado el mismo importe en días distintos', async () => {
        const { ctx, pagos } = makeCtx();
        const p = new PagosProcessor();

        await p.processRow(fila(195.04, '2026-07-17'), ctx);
        await p.processRow(fila(195.04, '2026-07-18'), ctx);

        expect(pagos).toHaveLength(2);
    });
});

describe('PagosProcessor — anti-duplicados con identificador de comprobante', () => {
    it('registra los dos cobros si son de comprobantes distintos', async () => {
        const { ctx, pagos } = makeCtx();
        const p = new PagosProcessor();

        await p.processRow(fila(195.04, '2026-07-17', '0108B14819919A'), ctx);
        await p.processRow(fila(195.04, '2026-07-17', '0108B18215291A'), ctx);

        expect(pagos).toHaveLength(2);
        expect(pagos.map((x) => x.observacion)).toEqual(['0108B14819919A', '0108B18215291A']);
    });

    it('sigue sin reinsertar el mismo comprobante: reimportar es idempotente', async () => {
        const { ctx, pagos } = makeCtx();
        const p = new PagosProcessor();

        await p.processRow(fila(195.04, '2026-07-17', '0108B14819919A'), ctx);
        await p.processRow(fila(195.04, '2026-07-17', '0108B14819919A'), ctx);

        expect(pagos).toHaveLength(1);
    });

    it('el comprobante en blanco se trata como ausente, no como un valor más', async () => {
        const { ctx, pagos } = makeCtx();
        const p = new PagosProcessor();

        await p.processRow(fila(195.04, '2026-07-17', '   '), ctx);
        await p.processRow(fila(195.04, '2026-07-17'), ctx);

        expect(pagos).toHaveLength(1);
        expect(pagos[0].observacion).toBeNull();
    });

    it('AYSA: las 36 cuotas iguales cobradas el mismo día se registran todas', async () => {
        // El caso real que motivó el cambio: la cuenta 000003462007 canceló 36 partidas de $195,04
        // el 17/07. Con el criterio anterior quedaba una sola y se perdían $6.826,40.
        const { ctx, pagos } = makeCtx();
        const p = new PagosProcessor();

        const partidas = Array.from({ length: 36 }, (_, i) => `0108B${String(14819919 + i * 3400).padStart(8, '0')}A`);
        for (const doc of partidas) {
            await p.processRow(fila(195.04, '2026-07-17', doc), ctx);
        }

        expect(pagos).toHaveLength(36);
        const total = pagos.reduce((a, x) => a + x.importe, 0);
        expect(total).toBeCloseTo(195.04 * 36, 2);
    });
});

describe('PagosProcessor — marcar la factura cobrada', () => {
    it('pone PAGADA la factura que nombra el comprobante del pago', async () => {
        const { ctx, facturas } = makeCtx([
            { id: 1, nroFactura: '0108B14819919A', estado: 'PENDIENTE' },
            { id: 2, nroFactura: '0108B18215291A', estado: 'PENDIENTE' },
        ]);
        const p = new PagosProcessor();

        await p.processRow(fila(195.04, '2026-07-17', '0108B14819919A'), ctx);

        expect(facturas[0].estado).toBe('PAGADA');
        // La otra factura del mismo deudor no se toca.
        expect(facturas[1].estado).toBe('PENDIENTE');
    });

    it('sin comprobante no toca ninguna factura', async () => {
        const { ctx, facturas, updateMany } = makeCtx([
            { id: 1, nroFactura: '0108B14819919A', estado: 'PENDIENTE' },
        ]);
        const p = new PagosProcessor();

        await p.processRow(fila(195.04, '2026-07-17'), ctx);

        expect(updateMany).not.toHaveBeenCalled();
        expect(facturas[0].estado).toBe('PENDIENTE');
    });

    it('un comprobante que no existe como factura no rompe el pago', async () => {
        const { ctx, pagos } = makeCtx([{ id: 1, nroFactura: 'OTRA', estado: 'PENDIENTE' }]);
        const p = new PagosProcessor();

        await p.processRow(fila(195.04, '2026-07-17', 'NO-EXISTE'), ctx);

        expect(pagos).toHaveLength(1);
    });

    it('las 36 cuotas del plan marcan sus 36 facturas', async () => {
        const partidas = Array.from({ length: 36 }, (_, i) => `0108B${String(14819919 + i * 3400).padStart(8, '0')}A`);
        const { ctx, facturas } = makeCtx(
            partidas.map((nroFactura, i) => ({ id: i + 1, nroFactura, estado: 'PENDIENTE' })),
        );
        const p = new PagosProcessor();

        for (const doc of partidas) await p.processRow(fila(195.04, '2026-07-17', doc), ctx);

        expect(facturas.every((f) => f.estado === 'PAGADA')).toBe(true);
    });
});


describe('PagosProcessor — idExterno: el identificador del cobro del cedente', () => {
    const conId = (importe: number, fecha: string, idExterno: string) => ({
        nro_cliente: '000003462007',
        importe,
        fecha,
        idExterno,
    });

    it('reimportar un archivo acumulativo no duplica: el mismo PAYMENT_ID entra una vez', async () => {
        const { ctx, pagos } = makeCtx();
        const p = new PagosProcessor();

        // Día 1: llegan 2 cobros.
        await p.processRow(conId(68000, '2026-08-03', '3248264860'), ctx);
        await p.processRow(conId(20000, '2026-08-03', '3248268100'), ctx);
        // Día 2: el cedente reenvía los 2 de ayer y suma uno nuevo.
        await p.processRow(conId(68000, '2026-08-03', '3248264860'), ctx);
        await p.processRow(conId(20000, '2026-08-03', '3248268100'), ctx);
        await p.processRow(conId(55605, '2026-08-04', '3248271094'), ctx);

        expect(pagos).toHaveLength(3);
        expect(pagos.map((x) => x.idExterno)).toEqual(['3248264860', '3248268100', '3248271094']);
    });

    it('dos cobros del mismo importe y el mismo día se registran los dos', async () => {
        const { ctx, pagos } = makeCtx();
        const p = new PagosProcessor();

        // Sin idExterno, el criterio por día + importe los colapsaría en uno solo.
        await p.processRow(conId(195.04, '2026-08-03', 'A1'), ctx);
        await p.processRow(conId(195.04, '2026-08-03', 'A2'), ctx);

        expect(pagos).toHaveLength(2);
    });

    it('el mismo PAYMENT_ID con la fecha mal parseada tampoco duplica', async () => {
        const { ctx, pagos } = makeCtx();
        const p = new PagosProcessor();

        // Sin fecha mapeable, el processor usa `new Date()`: en dos corridas de días distintos el
        // criterio por día veía dos pagos. Con el identificador, no.
        await p.processRow({ nro_cliente: '000003462007', importe: 68000, idExterno: 'X1' }, ctx);
        await p.processRow({ nro_cliente: '000003462007', importe: 68000, idExterno: 'X1' }, ctx);

        expect(pagos).toHaveLength(1);
    });

    it('las plantillas sin identificador siguen con el criterio de siempre', async () => {
        const { ctx, pagos } = makeCtx();
        const p = new PagosProcessor();

        await p.processRow(fila(195.04, '2026-07-17'), ctx);
        await p.processRow(fila(195.04, '2026-07-17'), ctx);

        expect(pagos).toHaveLength(1);
        expect(pagos[0].idExterno).toBeNull();
    });
});

describe('PagosProcessor — el importe llega como texto', () => {
    it('acepta el número escrito como texto y lo guarda como número', async () => {
        const { ctx, pagos } = makeCtx();
        const p = new PagosProcessor();

        // Es lo que produce el orden `toNumber` → `removeDashes` de las plantillas de Telecom:
        // antes la fila moría con `Argument importe: Expected Float, provided String`.
        await p.processRow({ nro_cliente: '000003462007', importe: '68062.52' } as any, ctx);

        expect(pagos).toHaveLength(1);
        expect(pagos[0].importe).toBe(68062.52);
        expect(typeof pagos[0].importe).toBe('number');
    });

    it('lee el formato argentino con coma decimal', async () => {
        const { ctx, pagos } = makeCtx();
        const p = new PagosProcessor();

        await p.processRow({ nro_cliente: '000003462007', monto: '-68.062,52' } as any, ctx);

        expect(pagos[0].importe).toBe(-68062.52);
    });

    it('rechaza la fila con un mensaje que se entiende, en vez de un error de tipo de Prisma', () => {
        const p = new PagosProcessor();

        const r = p.validateRow!({ nro_cliente: '1', importe: 'NO INFORMADO' } as any, {} as any);

        expect(r.valid).toBe(false);
        expect(r.error).toContain('no es un número');
    });

    it('sigue exigiendo que el importe venga', () => {
        const p = new PagosProcessor();

        expect(p.validateRow!({ nro_cliente: '1' } as any, {} as any).valid).toBe(false);
        expect(p.validateRow!({ nro_cliente: '1', importe: 0 } as any, {} as any).valid).toBe(true);
    });
});

// ─── Fase 4a de multiclaves (docs/multiclaves-spec.md §10) ─────────────────────────────────────

import { refClaveDeFila, elegirPorRemesaMasRecienteYId } from './pagos.processor';

describe('refClaveDeFila — normalización de la referencia (§10.2/§10.3a)', () => {
    it.each([
        ['96234420', '96234420'],
        ['0096332206000019880014', '96332206'], // clave de 22
        ['49800019880012710202600000000000096332206000000007', '96332206'], // código de barras de 50
    ])('%s normaliza a %s', (crudo, esperado) => {
        expect(refClaveDeFila(crudo)).toEqual({ refClave: esperado, ilegible: false });
    });

    it.each(['0', '', '  ', '-', '00000000', null, undefined])(
        '%s se trata como "sin clave", sin aviso',
        (crudo) => {
            expect(refClaveDeFila(crudo as any)).toEqual({ refClave: null, ilegible: false });
        },
    );

    it('un valor que no normaliza a ninguna forma conocida es ilegible', () => {
        expect(refClaveDeFila('9623442')).toEqual({ refClave: null, ilegible: true });
    });
});

describe('elegirPorRemesaMasRecienteYId — desempate del camino común (§10.3c, criterios 3 y 4)', () => {
    it('elige la remesa más reciente', () => {
        const candidatos = [
            { id: 1, remesa: { createdAt: new Date('2026-01-01') } },
            { id: 2, remesa: { createdAt: new Date('2026-06-01') } },
        ];
        expect(elegirPorRemesaMasRecienteYId(candidatos).id).toBe(2);
    });

    it('con la misma remesa, el id más alto', () => {
        const fecha = new Date('2026-06-01');
        const candidatos = [
            { id: 5, remesa: { createdAt: fecha } },
            { id: 9, remesa: { createdAt: fecha } },
        ];
        expect(elegirPorRemesaMasRecienteYId(candidatos).id).toBe(9);
    });

    it('BLOQUEANTE de la auditoría: elige la remesa más reciente aunque ESE caso esté cancelado', () => {
        // La versión anterior de esta función prefería "el no cancelado" antes que la remesa más
        // reciente. Un auditor midió que esto duplica cobros: la propia carga de pagos cambia la
        // situación del caso elegido (lo cancela), así que una RECARGA del mismo archivo ve un
        // estado distinto al de la primera carga, elige el caso HERMANO (que ahora es "el no
        // cancelado") y le crea un segundo pago. El desempate ya no mira la situación en absoluto —
        // ver el comentario de `elegirPorRemesaMasRecienteYId` — así que este caso (cancelado, pero
        // de la remesa más reciente) tiene que ganar igual.
        const candidatos = [
            { id: 1, remesa: { createdAt: new Date('2026-01-01') } }, // vivo, remesa vieja
            { id: 2, remesa: { createdAt: new Date('2026-06-01') } }, // cancelado, remesa nueva
        ];
        expect(elegirPorRemesaMasRecienteYId(candidatos).id).toBe(2);
    });
});

/**
 * Prisma mockeado con claves de pago y convenios, para los tests de resolución del caso.
 *
 * `candidatosPorTramite` mapea el ÚLTIMO valor del `$queryRaw` (el `nroTramite`/`nroCliente` que
 * cierra el `WHERE`, sea la query TRIM del camino de la clave o la del camino común) a los ids que
 * "existen en la base". Si el valor es un array de arrays, se interpreta como una SECUENCIA de
 * respuestas (una por llamada sucesiva con esa misma clave) — lo que hace falta para simular
 * "vacío dentro de la remesa origen, pero hay uno fuera" (dos llamadas, la segunda sin filtro).
 */
function makeCtxConClaves(opts: {
    claves?: Array<{ nroConvenio: string; empresaId: number; nroTramite: string }>;
    candidatosPorTramite?: Record<string, number[] | number[][]>;
    deudores?: Array<{ id: number; estadoSituacion: { categoria: string | null } | null; remesa: { createdAt: Date } | null }>;
    conveniosActivos?: Array<{ deudorId: number; clavePagoId: number | null; origen: string }>;
} = {}) {
    const pagos: any[] = [];
    let seq = 1;
    const claves = opts.claves ?? [];
    const candidatosPorTramite = opts.candidatosPorTramite ?? {};
    const deudores = opts.deudores ?? [];
    const conveniosActivos = opts.conveniosActivos ?? [];
    const llamadasPorClave = new Map<string, number>();

    const queryRaw = jest.fn().mockImplementation((query: any) => {
        const valores: any[] = query?.values ?? [];
        const clave = String(valores[valores.length - 1]);
        const entry = candidatosPorTramite[clave];
        if (entry === undefined) return Promise.resolve([{ id: 7 }]); // default: 1 candidato fijo

        const esSecuencia = Array.isArray(entry) && entry.length > 0 && Array.isArray(entry[0]);
        if (esSecuencia) {
            const seqArr = entry as number[][];
            const idx = llamadasPorClave.get(clave) ?? 0;
            llamadasPorClave.set(clave, idx + 1);
            const ids = seqArr[Math.min(idx, seqArr.length - 1)];
            return Promise.resolve(ids.map((id) => ({ id })));
        }
        return Promise.resolve((entry as number[]).map((id) => ({ id })));
    });

    const ctx = {
        prisma: {
            $queryRaw: queryRaw,
            pago: {
                // Mismo criterio que el `findFirst` de `makeCtx()` (arriba en este archivo): respeta
                // TODOS los campos del `where` real (`origen`, `importe`, ventana de `fecha`,
                // `confirmadoImport`, `observacion`, `idExterno`) — un mock que solo mirara
                // `deudorId` "encontraría" el pago de IMPORT_PAGOS ya creado como si fuera un claim
                // MANUAL pendiente, y rompería las pruebas de anti-duplicados.
                //
                // `deudorId` puede venir como valor exacto (`{deudorId: 42}`, el claim MANUAL) o
                // como lista (`{deudorId: {in: [42, 55]}}`, el anti-duplicados de la fase 4a que
                // busca en TODOS los candidatos del trámite, no solo en el elegido).
                findFirst: jest.fn().mockImplementation(({ where }: any) =>
                    Promise.resolve(
                        pagos.find((p) => {
                            if (where.deudorId?.in) {
                                if (!where.deudorId.in.includes(p.deudorId)) return false;
                            } else if (p.deudorId !== where.deudorId) {
                                return false;
                            }
                            if (where.origen !== undefined && p.origen !== where.origen) return false;
                            if (where.importe !== undefined && p.importe !== where.importe) return false;
                            if (where.fecha?.gte && (p.fecha < where.fecha.gte || p.fecha > where.fecha.lte)) return false;
                            if (where.confirmadoImport !== undefined && p.confirmadoImport !== where.confirmadoImport) return false;
                            if (where.observacion !== undefined && p.observacion !== where.observacion) return false;
                            if (where.idExterno !== undefined && p.idExterno !== where.idExterno) return false;
                            return true;
                        }) ?? null,
                    ),
                ),
                create: jest.fn().mockImplementation(({ data }: any) => {
                    pagos.push({ id: seq++, ...data });
                    return Promise.resolve(pagos[pagos.length - 1]);
                }),
                update: jest.fn().mockResolvedValue({}),
            },
            factura: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
            clave_pago: {
                findUnique: jest.fn().mockImplementation(({ where }: any) => {
                    const c = claves.find((k) => k.nroConvenio === where.nroConvenio);
                    return Promise.resolve(c ? { id: 1000 + claves.indexOf(c), ...c } : null);
                }),
            },
            convenio: {
                findFirst: jest.fn().mockImplementation(({ where }: any) => {
                    // El criterio 1 busca por `clavePagoId` en toda la empresa (sin `deudorId`); el
                    // criterio 2, por origen dentro de los candidatos.
                    const ids: number[] | undefined = where.deudorId?.in;
                    const match = conveniosActivos.find((c) =>
                        (ids === undefined || ids.includes(c.deudorId)) &&
                        (where.clavePagoId === undefined || c.clavePagoId === where.clavePagoId) &&
                        (where.origen === undefined || c.origen === where.origen));
                    return Promise.resolve(match ? { deudorId: match.deudorId } : null);
                }),
            },
            deudor: {
                findMany: jest.fn().mockImplementation(({ where }: any) => {
                    const ids: number[] = where.id?.in ?? [];
                    return Promise.resolve(deudores.filter((d) => ids.includes(d.id)));
                }),
            },
        },
        remesaId: 10,
        remesaOrigenId: 9,
        empresaId: 19,
        consolidacion: { consolidar: jest.fn().mockResolvedValue({}) },
        promesas: { cerrarCumplidas: jest.fn().mockResolvedValue({}) },
    } as unknown as ProcessContext;

    return { ctx, pagos };
}

describe('PagosProcessor — pago con clave de pago (multiclaves, §10.3)', () => {
    it('con clave cargada de esta empresa y un solo caso: guarda referenciaClave e idExterno derivado', async () => {
        const { ctx, pagos } = makeCtxConClaves({
            claves: [{ nroConvenio: '96234420', empresaId: 19, nroTramite: '1981517609' }],
            candidatosPorTramite: { '1981517609': [42] },
        });
        const p = new PagosProcessor();

        await p.processRow(
            { nro_cliente: '1981517609', importe: 15500, fecha: '2026-09-10', nroConvenio: '96234420' } as any,
            ctx,
        );

        expect(pagos).toHaveLength(1);
        expect(pagos[0].deudorId).toBe(42);
        expect(pagos[0].referenciaClave).toBe('96234420');
        expect(pagos[0].idExterno).toBe('MC-96234420-20260910-1550000');
    });

    it('convenio de 8, clave de 22 y código de barras de 50 dígitos normalizan igual', async () => {
        const claves = [{ nroConvenio: '96234420', empresaId: 19, nroTramite: '1981517609' }];
        const candidatosPorTramite = { '1981517609': [42] };

        // El de 50 dígitos no necesita ser un código de barras válido para `normalizarReferenciaClave`
        // (D.6/§5.4): solo cuenta el largo total y la posición [33,41) — acá 33 ceros + el convenio + 9 ceros.
        const codigoBarras50 = `${'0'.repeat(33)}96234420${'0'.repeat(9)}`;
        for (const ref of ['96234420', '0096234420000015500011', codigoBarras50]) {
            const { ctx, pagos } = makeCtxConClaves({ claves, candidatosPorTramite });
            const p = new PagosProcessor();
            await p.processRow({ nro_cliente: '1981517609', importe: 15500, fecha: '2026-09-10', nroConvenio: ref } as any, ctx);
            expect(pagos[0]?.referenciaClave).toBe('96234420');
        }
    });

    it('"0", vacío y "-" no cuentan como clave: siguen el camino común, sin aviso', async () => {
        const { ctx, pagos } = makeCtxConClaves();
        const p = new PagosProcessor();

        await p.processRow({ nro_cliente: '000003462007', importe: 100, fecha: '2026-09-10', nroConvenio: '0' } as any, ctx);

        expect(pagos).toHaveLength(1);
        expect(pagos[0].referenciaClave).toBeNull();
        expect(pagos[0].deudorId).toBe(7); // camino común, mock fijo
    });

    it('un valor ilegible carga como pago común y no rompe la fila', async () => {
        const { ctx, pagos } = makeCtxConClaves();
        const p = new PagosProcessor();

        await p.processRow({ nro_cliente: '000003462007', importe: 100, fecha: '2026-09-10', nroConvenio: '9623442' } as any, ctx);

        expect(pagos).toHaveLength(1);
        expect(pagos[0].referenciaClave).toBeNull();
    });

    it('clave de OTRA empresa: sigue el camino común (no cae en el trámite de la clave)', async () => {
        const { ctx, pagos } = makeCtxConClaves({
            claves: [{ nroConvenio: '11111111', empresaId: 999, nroTramite: '1981517609' }],
        });
        const p = new PagosProcessor();

        await p.processRow({ nro_cliente: '000003462007', importe: 100, fecha: '2026-09-10', nroConvenio: '11111111' } as any, ctx);

        expect(pagos).toHaveLength(1);
        // referenciaClave se guarda igual (dato), pero el caso resuelto es el del camino común (id 7).
        expect(pagos[0].referenciaClave).toBe('11111111');
        expect(pagos[0].deudorId).toBe(7);
    });

    it('clave cargada pero el trámite no tiene NINGÚN caso: error de fila con trámite y convenio', async () => {
        const { ctx } = makeCtxConClaves({
            claves: [{ nroConvenio: '96234420', empresaId: 19, nroTramite: '1981517609' }],
            candidatosPorTramite: { '1981517609': [] }, // sin candidatos ni dentro ni fuera de la remesa origen
        });
        const p = new PagosProcessor();

        await expect(
            p.processRow({ nro_cliente: 'lo-que-sea', importe: 15500, fecha: '2026-09-10', nroConvenio: '96234420' } as any, ctx),
        ).rejects.toThrow(/1981517609.*96234420|96234420.*1981517609/);
    });

    it('trámite en dos casos: gana el que tiene el convenio ACTIVO de esa clave exacta', async () => {
        const { ctx, pagos } = makeCtxConClaves({
            claves: [{ nroConvenio: '96234420', empresaId: 19, nroTramite: '1981517609' }],
            candidatosPorTramite: { '1981517609': [10, 20] },
            conveniosActivos: [{ deudorId: 20, clavePagoId: 1000, origen: 'CLAVE_PAGO' }],
        });
        const p = new PagosProcessor();

        await p.processRow({ nro_cliente: '1981517609', importe: 15500, fecha: '2026-09-10', nroConvenio: '96234420' } as any, ctx);

        expect(pagos[0].deudorId).toBe(20);
    });

    it('trámite en dos casos sin convenio: gana el de la remesa más reciente, y es determinista sin importar la situación', async () => {
        const deudores = [
            { id: 10, remesa: { createdAt: new Date('2026-01-01') } },
            { id: 20, remesa: { createdAt: new Date('2026-05-01') } },
        ];
        for (let i = 0; i < 3; i++) {
            const { ctx, pagos } = makeCtxConClaves({
                claves: [{ nroConvenio: '96234420', empresaId: 19, nroTramite: '1981517609' }],
                candidatosPorTramite: { '1981517609': [10, 20] },
                deudores,
            });
            const p = new PagosProcessor();
            await p.processRow({ nro_cliente: '1981517609', importe: 15500, fecha: '2026-09-10', nroConvenio: '96234420' } as any, ctx);
            expect(pagos[0].deudorId).toBe(20);
        }
    });

    // Trámite en la remesa vieja (caso 30) y en la nueva (caso 40); se eligió solo la nueva. La
    // secuencia de respuestas es: casos dentro de las remesas de origen, después todos los del trámite.
    const TRAMITE_EN_DOS_REMESAS = { '1981517609': [[40], [30, 40]] };
    const FILA_CON_CLAVE = { nro_cliente: '1981517609', importe: 15500, fecha: '2026-09-10', nroConvenio: '96234420' };

    it('el convenio de la clave está en un caso FUERA de las remesas elegidas: el pago va a ese caso', async () => {
        // Antes el pago caía en 40 y el caso del convenio no se cancelaba.
        const { ctx, pagos } = makeCtxConClaves({
            claves: [{ nroConvenio: '96234420', empresaId: 19, nroTramite: '1981517609' }],
            candidatosPorTramite: TRAMITE_EN_DOS_REMESAS,
            conveniosActivos: [{ deudorId: 30, clavePagoId: 1000, origen: 'CLAVE_PAGO' }],
        });
        const p = new PagosProcessor();

        await p.processRow({ ...FILA_CON_CLAVE } as any, ctx);
        await p.processRow({ ...FILA_CON_CLAVE } as any, ctx); // recargar no duplica

        expect(pagos).toHaveLength(1);
        expect(pagos[0].deudorId).toBe(30);
    });

    it('el convenio de OTRA clave del trámite fuera de las remesas elegidas también se lleva el pago', async () => {
        // Es el caso desde el que se gestionan las claves del trámite (criterio 2, toda la empresa).
        const { ctx, pagos } = makeCtxConClaves({
            claves: [{ nroConvenio: '96234420', empresaId: 19, nroTramite: '1981517609' }],
            candidatosPorTramite: TRAMITE_EN_DOS_REMESAS,
            conveniosActivos: [{ deudorId: 30, clavePagoId: 999, origen: 'CLAVE_PAGO' }],
        });
        const p = new PagosProcessor();

        await p.processRow({ ...FILA_CON_CLAVE } as any, ctx);

        expect(pagos[0].deudorId).toBe(30);
    });

    it('sin convenio, el pago queda en las remesas elegidas aunque el trámite esté en otra', async () => {
        const { ctx, pagos } = makeCtxConClaves({
            claves: [{ nroConvenio: '96234420', empresaId: 19, nroTramite: '1981517609' }],
            candidatosPorTramite: TRAMITE_EN_DOS_REMESAS,
        });
        const p = new PagosProcessor();

        await p.processRow({ ...FILA_CON_CLAVE } as any, ctx);

        expect(pagos[0].deudorId).toBe(40);
    });

    it('BLOQUEANTE de la auditoría: anular el convenio entre dos cargas NO duplica el pago en el otro caso', async () => {
        const conveniosActivos = [{ deudorId: 30, clavePagoId: 1000, origen: 'CLAVE_PAGO' }];
        const { ctx, pagos } = makeCtxConClaves({
            claves: [{ nroConvenio: '96234420', empresaId: 19, nroTramite: '1981517609' }],
            candidatosPorTramite: { '1981517609': [[40], [30, 40], [40], [30, 40]] },
            conveniosActivos,
        });
        const p = new PagosProcessor();

        await p.processRow({ ...FILA_CON_CLAVE } as any, ctx);
        expect(pagos[0].deudorId).toBe(30);

        conveniosActivos.length = 0; // el operador anula el convenio
        await p.processRow({ ...FILA_CON_CLAVE } as any, ctx); // y se recarga el mismo archivo

        expect(pagos).toHaveLength(1);
    });

    it('sin candidatos en la remesa origen pero sí fuera: usa ese caso (aviso, no error)', async () => {
        // Primera consulta (dentro de las remesas de origen) → vacío; segunda (sin ese filtro) → 55.
        const { ctx, pagos } = makeCtxConClaves({
            claves: [{ nroConvenio: '96234420', empresaId: 19, nroTramite: '1981517609' }],
            candidatosPorTramite: { '1981517609': [[], [55]] },
        });
        const p = new PagosProcessor();

        await p.processRow({ nro_cliente: '1981517609', importe: 15500, fecha: '2026-09-10', nroConvenio: '96234420' } as any, ctx);

        expect(pagos[0].deudorId).toBe(55);
    });
});

describe('PagosProcessor — regresión del anti-duplicados con la llave derivada (§10.3b, D16)', () => {
    it('(a) una cartera con PAYMENT_ID real sigue salteando la heurística de día+importe', async () => {
        // Ya cubierto arriba ("idExterno: el identificador del cobro del cedente"), repetido acá
        // para dejar explícita la regresión que pide el spec: un `idExterno` DEL ARCHIVO (no
        // derivado) sigue salteando la heurística.
        const { ctx, pagos } = makeCtxConClaves();
        const p = new PagosProcessor();
        await p.processRow({ nro_cliente: '000003462007', importe: 195.04, fecha: '2026-08-03', idExterno: 'REAL1' } as any, ctx);
        await p.processRow({ nro_cliente: '000003462007', importe: 195.04, fecha: '2026-08-03', idExterno: 'REAL2' } as any, ctx);
        expect(pagos).toHaveLength(2);
    });

    it('(b) mismo archivo con clave cargado dos veces → 1 solo pago (idempotente)', async () => {
        const { ctx, pagos } = makeCtxConClaves({
            claves: [{ nroConvenio: '96234420', empresaId: 19, nroTramite: '1981517609' }],
            candidatosPorTramite: { '1981517609': [42] },
        });
        const p = new PagosProcessor();
        const fila = { nro_cliente: '1981517609', importe: 15500, fecha: '2026-09-10', nroConvenio: '96234420' } as any;
        await p.processRow(fila, ctx);
        await p.processRow(fila, ctx);
        expect(pagos).toHaveLength(1);
    });

    it('(c) archivo cargado primero SIN mapear nroConvenio y después CON el mapeo: sigue habiendo 1 pago', async () => {
        // Primera carga: la plantilla no mapea `nroConvenio` — el pago entra por el camino común
        // (mismo `nro_cliente` que el trámite de la clave, así que cae en el MISMO caso), sin
        // `idExterno` (ni derivado ni del archivo). Si la llave derivada salteara la heurística de
        // día+importe, la segunda carga (ya con el mapeo, `idExterno` derivado nuevo) no la
        // encontraría por idExterno exacto (todavía no existía) y, si además saltease la
        // heurística, duplicaría el pago.
        const { ctx, pagos } = makeCtxConClaves({
            claves: [{ nroConvenio: '96234420', empresaId: 19, nroTramite: '1981517609' }],
            candidatosPorTramite: { '1981517609': [42] },
        });
        const p = new PagosProcessor();

        // Primera carga: sin nroConvenio → camino común, mismo nro_cliente/trámite → deudor 42.
        await p.processRow({ nro_cliente: '1981517609', importe: 15500, fecha: '2026-09-10' } as any, ctx);
        // Segunda carga: ahora SÍ mapea nroConvenio → resuelve por la clave, mismo caso (42).
        await p.processRow({ nro_cliente: '1981517609', importe: 15500, fecha: '2026-09-10', nroConvenio: '96234420' } as any, ctx);

        expect(pagos).toHaveLength(1);
        expect(pagos[0].deudorId).toBe(42);
    });

    it('(d) dos pagos de la misma clave en días distintos entran los dos', async () => {
        const { ctx, pagos } = makeCtxConClaves({
            claves: [{ nroConvenio: '96234420', empresaId: 19, nroTramite: '1981517609' }],
            candidatosPorTramite: { '1981517609': [42] },
        });
        const p = new PagosProcessor();
        await p.processRow({ nro_cliente: '1981517609', importe: 15500, fecha: '2026-09-10', nroConvenio: '96234420' } as any, ctx);
        await p.processRow({ nro_cliente: '1981517609', importe: 15500, fecha: '2026-09-24', nroConvenio: '96234420' } as any, ctx);
        expect(pagos).toHaveLength(2);
    });
});

/**
 * BLOQUEANTE de la auditoría de la fase 4a: "recargar un archivo de pagos duplica la cobranza en
 * trámites con más de un caso". Medido contra MySQL local en tres escenarios — los tres reproducidos
 * acá como tests deterministas, más una prueba de punta a punta con el archivo real (§16.3,
 * documentada en el CHANGELOG con los conteos).
 *
 * Causa raíz (ya corregida arriba, en el código): el desempate por "no cancelado" dependía de un
 * dato que la propia importación cambia (la situación del caso, al cancelarlo). Con dos casos por
 * trámite, la primera carga podía elegir el caso A; si A queda cancelado, una recarga del MISMO
 * archivo veía a A como "cancelado" y elegía a B — que no tenía el pago — y se lo creaba de nuevo.
 * La corrección tiene dos partes, y estos tests ejercitan las dos juntas:
 *   1. El desempate (`elegirPorRemesaMasRecienteYId`) ya no mira la situación — es estable entre
 *      corridas sin importar qué haga la consolidación en el medio.
 *   2. El anti-duplicados busca en TODOS los candidatos del trámite (`candidatoIds`), no solo en el
 *      elegido — así que aunque el desempate cambiara por cualquier otro motivo, no duplicaría.
 */
describe('PagosProcessor — BLOQUEANTE: recargar con trámite en varios casos NO duplica', () => {
    it('con clave (multiclaves): recargar el mismo cobro con dos casos candidatos → 1 solo pago', async () => {
        const deudores = [
            { id: 10, remesa: { createdAt: new Date('2026-01-01') } },
            { id: 20, remesa: { createdAt: new Date('2026-05-01') } }, // remesa más reciente → elegido
        ];
        const { ctx, pagos } = makeCtxConClaves({
            claves: [{ nroConvenio: '96234420', empresaId: 19, nroTramite: '1981517609' }],
            candidatosPorTramite: { '1981517609': [10, 20] },
            deudores,
        });
        const p = new PagosProcessor();
        const fila = { nro_cliente: '1981517609', importe: 15500, fecha: '2026-09-10', nroConvenio: '96234420' } as any;

        await p.processRow(fila, ctx); // primera carga
        await p.processRow(fila, ctx); // recarga del mismo archivo

        expect(pagos).toHaveLength(1);
        expect(pagos[0].deudorId).toBe(20);
    });

    it('sin clave, cartera cualquiera (camino común): recargar con dos casos candidatos → 1 solo pago', async () => {
        // Repro exacto del auditor: "$62.000 por un cobro de $31.000, dos casos en SIT-050" — es el
        // `ORDER BY` nuevo solo, sin multiclaves de por medio (sin `nroConvenio` mapeado).
        const deudores = [
            { id: 10, remesa: { createdAt: new Date('2026-01-01') } },
            { id: 20, remesa: { createdAt: new Date('2026-05-01') } },
        ];
        const { ctx, pagos } = makeCtxConClaves({
            candidatosPorTramite: { '5551234': [10, 20] },
            deudores,
        });
        const p = new PagosProcessor();
        const fila = { nro_cliente: '5551234', importe: 31000, fecha: '2026-09-10' } as any;

        await p.processRow(fila, ctx);
        await p.processRow(fila, ctx);

        expect(pagos).toHaveLength(1);
        expect(pagos[0].deudorId).toBe(20);
        expect(pagos[0].importe).toBe(31000); // NO 62000: no se duplicó
    });

    it('con PAYMENT_ID real del cedente (AYSA/Toyota): recargar con dos casos candidatos → 1 solo pago', async () => {
        // El caso que el auditor marcó como el más peligroso: "pasa incluso con PAYMENT_ID real del
        // cedente, así que AYSA y Toyota no están a salvo si tienen nroCliente repetido entre
        // remesas origen". El anti-dup exacto por `idExterno` ahora busca en TODOS los candidatos.
        const deudores = [
            { id: 10, remesa: { createdAt: new Date('2026-01-01') } },
            { id: 20, remesa: { createdAt: new Date('2026-05-01') } },
        ];
        const { ctx, pagos } = makeCtxConClaves({
            candidatosPorTramite: { '9998887': [10, 20] },
            deudores,
        });
        const p = new PagosProcessor();
        const fila = { nro_cliente: '9998887', importe: 18353.10, fecha: '2026-07-25', idExterno: 'PAYMENT-REAL-001' } as any;

        await p.processRow(fila, ctx);
        await p.processRow(fila, ctx);

        expect(pagos).toHaveLength(1);
        expect(pagos[0].deudorId).toBe(20);
    });

    it('el pago MANUAL de otro caso se mueve al caso del convenio de la clave, y se consolidan los dos', async () => {
        // Hallazgo de la auditoría del 2026-09-25: confirmado en el caso 30, el caso del convenio (40)
        // no se cancelaba nunca, porque la consolidación mira los pagos del propio caso.
        const { ctx, pagos } = makeCtxConClaves({
            claves: [{ nroConvenio: '96234420', empresaId: 19, nroTramite: '1981517609' }],
            candidatosPorTramite: { '1981517609': [[40], [30, 40]] },
            conveniosActivos: [{ deudorId: 40, clavePagoId: 1000, origen: 'CLAVE_PAGO' }],
        });
        pagos.push({
            id: 777, deudorId: 30, origen: 'MANUAL', confirmadoImport: false,
            importe: 15500, fecha: new Date('2026-09-09'),
        });
        const p = new PagosProcessor();

        await p.processRow({ nro_cliente: '1981517609', importe: 15500, fecha: '2026-09-10', nroConvenio: '96234420' } as any, ctx);

        expect(ctx.prisma.pago.create).not.toHaveBeenCalled();
        expect(ctx.prisma.pago.update).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 777 }, data: expect.objectContaining({ deudorId: 40, confirmadoImport: true }) }),
        );
        expect([...(p as any).processedDeudorIds].sort()).toEqual([30, 40]);
    });

    it('el pago MANUAL del OTRO caso del trámite se confirma, no se duplica', async () => {
        // Hallazgo de la re-auditoría: el claim miraba solo el caso elegido. El gestor registra el
        // pago a mano en el caso que tiene abierto (10) y el desempate elige el otro (20): el import
        // creaba un segundo pago en 20 y dejaba el manual sin confirmar, así que el mismo cobro
        // quedaba contado dos veces en el trámite.
        const deudores = [
            { id: 10, remesa: { createdAt: new Date('2026-01-01') } },
            { id: 20, remesa: { createdAt: new Date('2026-05-01') } }, // elegido
        ];
        const { ctx, pagos } = makeCtxConClaves({
            claves: [{ nroConvenio: '96234420', empresaId: 19, nroTramite: '1981517609' }],
            candidatosPorTramite: { '1981517609': [10, 20] },
            deudores,
        });
        pagos.push({
            id: 777, deudorId: 10, origen: 'MANUAL', confirmadoImport: false,
            importe: 15500, fecha: new Date('2026-09-09'),
        });
        const p = new PagosProcessor();

        await p.processRow(
            { nro_cliente: '1981517609', importe: 15500, fecha: '2026-09-10', nroConvenio: '96234420' } as any,
            ctx,
        );

        expect(ctx.prisma.pago.create).not.toHaveBeenCalled();
        expect(ctx.prisma.pago.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 777 },
                data: expect.objectContaining({ confirmadoImport: true, referenciaClave: '96234420' }),
            }),
        );
        // Sin convenio no se mueve: queda en el caso donde lo cargó el gestor, y ese se consolida.
        expect(ctx.prisma.pago.update.mock.calls[0][0].data.deudorId).toBeUndefined();
        expect((p as any).processedDeudorIds.has(10)).toBe(true);
    });

    it('con el pago MANUAL en el caso elegido se confirma ese, no el del gemelo', async () => {
        const deudores = [
            { id: 10, remesa: { createdAt: new Date('2026-01-01') } },
            { id: 20, remesa: { createdAt: new Date('2026-05-01') } }, // elegido
        ];
        const { ctx, pagos } = makeCtxConClaves({
            candidatosPorTramite: { '5551234': [10, 20] },
            deudores,
        });
        pagos.push({ id: 100, deudorId: 10, origen: 'MANUAL', confirmadoImport: false, importe: 31000, fecha: new Date('2026-09-08') });
        pagos.push({ id: 200, deudorId: 20, origen: 'MANUAL', confirmadoImport: false, importe: 31000, fecha: new Date('2026-09-09') });
        const p = new PagosProcessor();

        await p.processRow({ nro_cliente: '5551234', importe: 31000, fecha: '2026-09-10' } as any, ctx);

        expect(ctx.prisma.pago.update).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 200 } }),
        );
    });

    it('los tres escenarios sobreviven a una TERCERA recarga (no es "una sola vez de suerte")', async () => {
        const deudores = [
            { id: 10, remesa: { createdAt: new Date('2026-01-01') } },
            { id: 20, remesa: { createdAt: new Date('2026-05-01') } },
        ];
        const { ctx, pagos } = makeCtxConClaves({
            claves: [{ nroConvenio: '96234420', empresaId: 19, nroTramite: '1981517609' }],
            candidatosPorTramite: { '1981517609': [10, 20] },
            deudores,
        });
        const p = new PagosProcessor();
        const fila = { nro_cliente: '1981517609', importe: 15500, fecha: '2026-09-10', nroConvenio: '96234420' } as any;

        await p.processRow(fila, ctx);
        await p.processRow(fila, ctx);
        await p.processRow(fila, ctx);

        expect(pagos).toHaveLength(1);
    });
});
