import { NotFoundException } from '@nestjs/common';
import { ClavesService } from './claves.service';

function makeService(over: {
    remesa?: any;
    claves?: any[];
    importerrors?: any[];
    reemplazadasPorEsta?: number;
    deudores?: Array<{ empresaId: number; nroCliente: string }>;
} = {}) {
    const remesa = 'remesa' in over ? over.remesa : { id: 10, empresaId: 1, categoria: 'MULTICLAVES', errFilas: 0 };
    const claves = over.claves ?? [];
    const importerrors = over.importerrors ?? [];
    const deudores = over.deudores ?? [];

    const prisma: any = {
        remesa: { findUnique: jest.fn().mockResolvedValue(remesa) },
        clave_pago: {
            findMany: jest.fn().mockImplementation(({ where }: any) =>
                Promise.resolve(claves.filter((c) => c.remesaId === where.remesaId))),
            count: jest.fn().mockImplementation(({ where }: any) =>
                Promise.resolve(claves.filter((c) => c.reemplazadaPorRemesaId === where.reemplazadaPorRemesaId).length)),
        },
        importerror: {
            findMany: jest.fn().mockImplementation(({ where }: any) =>
                Promise.resolve(importerrors.filter((e) => e.remesaId === where.remesaId && e.rowNumber === where.rowNumber))),
        },
        deudor: {
            findMany: jest.fn().mockImplementation(({ where }: any) => {
                const nroClientes: string[] = where.nroCliente.in;
                const vistos = new Set<string>();
                return Promise.resolve(
                    deudores
                        .filter((d) => d.empresaId === where.empresaId && nroClientes.includes(d.nroCliente))
                        .filter((d) => { if (vistos.has(d.nroCliente)) return false; vistos.add(d.nroCliente); return true; })
                        .map((d) => ({ nroCliente: d.nroCliente })),
                );
            }),
        },
    };
    const bloqueo: any = { estaBloqueado: jest.fn().mockReturnValue(false), assertNoBloqueado: jest.fn() };
    return { service: new ClavesService(prisma, bloqueo), prisma, bloqueo };
}

const clave = (over: Partial<any> & { id: number; nroTramite: string }) => ({
    remesaId: 10, tipo: 'TOTAL', estado: 'VIGENTE', reemplazadaPorRemesaId: null,
    importe: '100.00', fechaVencimiento: new Date('2026-10-27'),
    ...over,
});

describe('ClavesService.resumenLote', () => {
    it('404 si la remesa no existe', async () => {
        const { service } = makeService({ remesa: null });
        await expect(service.resumenLote(10)).rejects.toThrow(NotFoundException);
    });

    it('404 si la remesa existe pero no es MULTICLAVES', async () => {
        const { service } = makeService({ remesa: { id: 10, empresaId: 1, categoria: 'DEUDORES', errFilas: 0 } });
        await expect(service.resumenLote(10)).rejects.toThrow(NotFoundException);
    });

    it('cuenta trámites, claves, vigentes/reemplazadas y con/sin caso', async () => {
        const { service } = makeService({
            claves: [
                clave({ id: 1, nroTramite: 'T1', tipo: 'TOTAL', estado: 'VIGENTE' }),
                clave({ id: 2, nroTramite: 'T1', tipo: 'QUITA', estado: 'VIGENTE' }),
                clave({ id: 3, nroTramite: 'T2', tipo: 'TOTAL', estado: 'REEMPLAZADA' }),
                clave({ id: 4, nroTramite: 'T2', tipo: 'QUITA', estado: 'REEMPLAZADA' }),
            ],
            deudores: [{ empresaId: 1, nroCliente: 'T1' }],
        });

        const r = await service.resumenLote(10);

        expect(r).toMatchObject({
            tramites: 2, claves: 4, vigentes: 2, reemplazadasEnEsta: 2,
            conCaso: 1, sinCaso: 1, rechazados: 0,
        });
    });

    it('reparsea los avisos guardados como importerror', async () => {
        const { service } = makeService({
            claves: [clave({ id: 1, nroTramite: 'T1' })],
            importerrors: [
                { remesaId: 10, rowNumber: 0, errorMsg: '[aviso] SALDO_DISTINTO_ENTRE_FILAS: 2 caso(s) (ej: T1, T2)' },
                { remesaId: 10, rowNumber: 0, errorMsg: '[aviso] MARCA_DESCONOCIDA: 5 caso(s) (ej: T3)' },
                { remesaId: 10, rowNumber: 5, errorMsg: 'esto no es un aviso' },
            ],
        });

        const r = await service.resumenLote(10);

        expect(r.avisos).toEqual([
            { codigo: 'SALDO_DISTINTO_ENTRE_FILAS', cantidad: 2 },
            { codigo: 'MARCA_DESCONOCIDA', cantidad: 5 },
        ]);
    });

    it('cuenta los trámites SOLO_TOTAL (una única clave) aparte, sin otra query (fase 1.1)', async () => {
        const { service } = makeService({
            claves: [
                clave({ id: 1, nroTramite: 'T1', tipo: 'TOTAL' }),
                clave({ id: 2, nroTramite: 'T1', tipo: 'QUITA' }),
                clave({ id: 3, nroTramite: 'T2', tipo: 'TOTAL' }), // T2: solo 1 clave en esta carga
            ],
        });

        const r = await service.resumenLote(10);

        expect(r).toMatchObject({ tramites: 2, claves: 3, soloTotal: 1 });
    });

    it('suma un mismo código de aviso repartido en varias filas de importerror (un TANDA_ANTERIOR por lote)', async () => {
        const { service } = makeService({
            claves: [clave({ id: 1, nroTramite: 'T1' })],
            importerrors: [
                { remesaId: 10, rowNumber: 0, errorMsg: '[aviso] TANDA_ANTERIOR: 500 caso(s) (ej: T1, T2)' },
                { remesaId: 10, rowNumber: 0, errorMsg: '[aviso] TANDA_ANTERIOR: 322 caso(s) (ej: T900)' },
            ],
        });

        const r = await service.resumenLote(10);

        expect(r.avisos).toEqual([{ codigo: 'TANDA_ANTERIOR', cantidad: 822 }]);
    });
});

describe('ClavesService.sinCaso', () => {
    it('lista solo los trámites sin caso, paginado', async () => {
        const { service } = makeService({
            claves: [
                clave({ id: 1, nroTramite: 'T1', tipo: 'TOTAL', importe: '200.00' }),
                clave({ id: 2, nroTramite: 'T1', tipo: 'QUITA', importe: '100.00' }),
                clave({ id: 3, nroTramite: 'T2', tipo: 'TOTAL', importe: '300.00' }),
                clave({ id: 4, nroTramite: 'T2', tipo: 'QUITA', importe: '150.00' }),
                clave({ id: 5, nroTramite: 'T3', tipo: 'TOTAL', importe: '400.00' }),
            ],
            deudores: [{ empresaId: 1, nroCliente: 'T2' }], // T2 SÍ tiene caso
        });

        const r = await service.sinCaso(10, 1, 1);

        expect(r.total).toBe(2); // T1 y T3
        expect(r.items).toHaveLength(1);
        expect(r.items[0].nroTramite).toBe('T1');
        // String, no number: es un Decimal (§4.1), igual que el resto de los importes de multiclaves.
        expect(r.items[0].importeTotal).toBe('200.00');
        expect(r.items[0].importeQuita).toBe('100.00');
        expect(r.items[0].fechaVencimiento).toBe('2026-10-27');
    });

    it('segunda página trae el resto', async () => {
        const { service } = makeService({
            claves: [
                clave({ id: 1, nroTramite: 'T1', tipo: 'TOTAL' }),
                clave({ id: 2, nroTramite: 'T3', tipo: 'TOTAL' }),
            ],
        });

        const r = await service.sinCaso(10, 2, 1);

        expect(r.total).toBe(2);
        expect(r.items).toHaveLength(1);
        expect(r.items[0].nroTramite).toBe('T3');
    });

    it('acota pageSize a 200 y descarta valores negativos o en 0 (page y pageSize)', async () => {
        const { service } = makeService({
            claves: Array.from({ length: 3 }, (_, i) => clave({ id: i + 1, nroTramite: `T${i + 1}`, tipo: 'TOTAL' })),
        });

        const pageSizeEnorme = await service.sinCaso(10, 1, 100000);
        expect(pageSizeEnorme.items).toHaveLength(3); // no más de lo que hay, pero tampoco explota

        const pageSizeNegativo = await service.sinCaso(10, 1, -5);
        expect(pageSizeNegativo.items.length).toBeGreaterThan(0); // cae a un default sensato, no a un slice vacío/roto

        const pageNegativa = await service.sinCaso(10, -3, 1);
        expect(pageNegativa.items).toHaveLength(1); // se trata como página 1, no rompe el slice
        expect(pageNegativa.items[0].nroTramite).toBe('T1');
    });
});

describe('ClavesService.clavesDelCaso', () => {
    const CLAVE_QUITA = {
        id: 100, tipo: 'QUITA', nroConvenio: '96332206', importe: '19880.01', saldoTramite: '39760.03',
        fechaVencimiento: new Date('2026-10-27T00:00:00.000Z'),
        clavePago: '0096332206000019880014', codigoBarras: '49800019880012710202600000000000096332206000000007',
        estado: 'VIGENTE',
        remesa: { id: 5, numeroRemesa: 'MC-20260901-1000', createdAt: new Date('2026-09-01T10:00:00.000Z') },
    };
    const CLAVE_TOTAL = {
        ...CLAVE_QUITA, id: 101, tipo: 'TOTAL', nroConvenio: '96311343', importe: '39760.03',
        clavePago: '0096311343000039760032', codigoBarras: '49800039760032710202600000000000096311343000000009',
    };

    function armar(opts: {
        deudor?: any;
        claves?: any[];
        convenios?: any[];
        otrosCasos?: any[];
        pagos?: any[];
        estaBloqueado?: boolean;
    } = {}) {
        const deudor = 'deudor' in opts ? opts.deudor : {
            id: 500, empresaId: 10, nroCliente: '1841012140', saldo: 39760.03, montoTotal: 39760.03, estadoSituacionId: 1,
        };
        const claves = opts.claves ?? [CLAVE_QUITA, CLAVE_TOTAL];
        const convenios = opts.convenios ?? [];
        const otrosCasos = opts.otrosCasos ?? [];

        const prisma: any = {
            deudor: {
                findUnique: jest.fn().mockResolvedValue(deudor),
                findMany: jest.fn().mockResolvedValue(otrosCasos),
            },
            clave_pago: { findMany: jest.fn().mockResolvedValue(claves) },
            convenio: { findMany: jest.fn().mockResolvedValue(convenios), findFirst: jest.fn().mockResolvedValue(null) },
            // Fase 4a (§9.1): pagos de este caso con `referenciaClave` = alguna de sus claves. Vacío
            // por default — la mayoría de los tests de este describe no tienen pagos con clave.
            pago: { findMany: jest.fn().mockResolvedValue(opts.pagos ?? []) },
            // La resolución de "otros casos" hace TRIM en SQL (ver comentario en claves.service.ts):
            // el mock simplemente devuelve los ids de la fixture, como si el TRIM ya los hubiese
            // encontrado — el `deudor.findMany` de arriba resuelve los datos a mostrar.
            $queryRaw: jest.fn().mockResolvedValue(otrosCasos.map((o) => ({ id: o.id }))),
        };
        const bloqueo: any = { estaBloqueado: jest.fn().mockReturnValue(opts.estaBloqueado ?? false) };
        return { service: new ClavesService(prisma, bloqueo), prisma, bloqueo };
    }

    it('404 si el deudor no existe', async () => {
        const { service } = armar({ deudor: null });
        await expect(service.clavesDelCaso(999)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('sin nroCliente, devuelve claves vacías sin consultar clave_pago', async () => {
        const { service, prisma } = armar({ deudor: { id: 1, empresaId: 10, nroCliente: null, saldo: null, montoTotal: null, estadoSituacionId: null } });
        const res = await service.clavesDelCaso(1);
        expect(res).toEqual({
            nroTramite: null,
            claves: [],
            avisos: { cuentaCancelada: false, saldoDistinto: null, otrosCasosDelTramite: [], gestionarDesde: null, plantillaCuponConfigurada: false, canceladoConQuita: null },
        });
        expect(prisma.clave_pago.findMany).not.toHaveBeenCalled();
    });

    it('trae las claves QUITA y TOTAL del trámite, con vtoImpreso y vencida calculados', async () => {
        const { service } = armar();
        const res = await service.clavesDelCaso(500);
        expect(res.nroTramite).toBe('1841012140');
        expect(res.claves).toHaveLength(2);
        const quita = res.claves.find((c: any) => c.tipo === 'QUITA')!;
        expect(quita.importe).toBe('19880.01');
        expect(quita.nroConvenio).toBe('96332206');
        expect(quita.vencida).toBe(false);
        expect(typeof quita.vtoImpreso).toBe('string');
        expect(quita.convenioActivo).toBeNull();
    });

    it('NUNCA devuelve la clave de 22 dígitos ni el código de barras completos (D6, hallazgo de la auditoría)', async () => {
        const { service } = armar();
        const res = await service.clavesDelCaso(500);
        for (const c of res.claves) {
            expect(c).not.toHaveProperty('clavePago');
            expect(c).not.toHaveProperty('codigoBarras');
            expect(c.clavePagoUltimos4).toMatch(/^\d{4}$/);
        }
        const quita = res.claves.find((c: any) => c.tipo === 'QUITA')!;
        expect(quita.clavePagoUltimos4).toBe(CLAVE_QUITA.clavePago.slice(-4));
    });

    it('marca el convenio activo y si es de este caso', async () => {
        const { service } = armar({
            convenios: [{ id: 777, deudorId: 500, clavePagoId: CLAVE_QUITA.id, createdAt: new Date('2026-09-10T00:00:00.000Z') }],
        });
        const res = await service.clavesDelCaso(500);
        const quita = res.claves.find((c: any) => c.tipo === 'QUITA')!;
        expect(quita.convenioActivo).toEqual({ id: 777, deudorId: 500, esEsteCaso: true, createdAt: '2026-09-10T00:00:00.000Z' });
    });

    it('convenio activo de OTRO caso: esEsteCaso false', async () => {
        const { service } = armar({
            convenios: [{ id: 777, deudorId: 999, clavePagoId: CLAVE_QUITA.id, createdAt: new Date('2026-09-10T00:00:00.000Z') }],
        });
        const res = await service.clavesDelCaso(500);
        const quita = res.claves.find((c: any) => c.tipo === 'QUITA')!;
        expect(quita.convenioActivo?.esEsteCaso).toBe(false);
    });

    it('avisa cuando el saldo del caso difiere del saldoTramite en más de $1', async () => {
        const { service } = armar({
            deudor: { id: 500, empresaId: 10, nroCliente: '1841012140', saldo: 50000, montoTotal: 50000, estadoSituacionId: 1 },
        });
        const res = await service.clavesDelCaso(500);
        expect(res.avisos.saldoDistinto).toEqual({ saldoCaso: 50000, saldoTramite: '39760.03' });
    });

    it('no avisa si la diferencia de saldo está dentro de la tolerancia de $1', async () => {
        const { service } = armar({
            deudor: { id: 500, empresaId: 10, nroCliente: '1841012140', saldo: 39760.53, montoTotal: 39760.53, estadoSituacionId: 1 },
        });
        const res = await service.clavesDelCaso(500);
        expect(res.avisos.saldoDistinto).toBeNull();
    });

    it('si el trámite está en una remesa más nueva, indica desde qué caso se gestiona', async () => {
        const { service, prisma } = armar({
            otrosCasos: [{ id: 42, remesa: { numeroRemesa: '201', createdAt: new Date('2026-09-01') }, estadoSituacion: { clave: 'SIT-010' }, estadoGestion: { clave: 'GES-020' } }],
        });
        // Primera llamada: `elegirCasoQueGestiona` (este caso + el hermano); segunda: los datos del aviso.
        prisma.deudor.findMany
            .mockResolvedValueOnce([
                { id: 500, remesa: { numeroRemesa: '200', createdAt: new Date('2026-08-01') } },
                { id: 42, remesa: { numeroRemesa: '201', createdAt: new Date('2026-09-01') } },
            ]);
        const res = await service.clavesDelCaso(500);
        expect(res.avisos.gestionarDesde).toMatchObject({ deudorId: 42, numeroRemesa: '201', porConvenio: false });
        expect(res.avisos.gestionarDesde?.motivo).toContain('remesa 201');
    });

    it('el caso con el convenio de clave activo gestiona, aunque su remesa sea la vieja', async () => {
        const { service, prisma } = armar({
            otrosCasos: [{ id: 42, remesa: { numeroRemesa: '201', createdAt: new Date('2026-09-01') }, estadoSituacion: { clave: 'SIT-010' }, estadoGestion: { clave: 'GES-020' } }],
        });
        prisma.deudor.findMany.mockResolvedValueOnce([
            { id: 500, remesa: { numeroRemesa: '200', createdAt: new Date('2026-08-01') } },
            { id: 42, remesa: { numeroRemesa: '201', createdAt: new Date('2026-09-01') } },
        ]);
        prisma.convenio.findFirst.mockResolvedValueOnce({ deudorId: 500 });
        const res = await service.clavesDelCaso(500);
        expect(res.avisos.gestionarDesde).toBeNull();
    });

    it('un caso más nuevo pero cancelado no se lleva la gestión', async () => {
        const { service, prisma, bloqueo } = armar({
            otrosCasos: [{ id: 42, remesa: { numeroRemesa: '201', createdAt: new Date('2026-09-01') }, estadoSituacion: { clave: 'SIT-051' }, estadoGestion: { clave: 'GES-020' } }],
        });
        prisma.deudor.findMany.mockResolvedValueOnce([
            { id: 500, estadoSituacionId: 1, remesa: { numeroRemesa: '200', createdAt: new Date('2026-08-01') } },
            { id: 42, estadoSituacionId: 51, remesa: { numeroRemesa: '201', createdAt: new Date('2026-09-01') } },
        ]);
        bloqueo.estaBloqueado.mockImplementation((sit: number | null) => sit === 51);
        const res = await service.clavesDelCaso(500);
        expect(res.avisos.gestionarDesde).toBeNull();
    });

    it('el caso de la remesa más nueva gestiona sus claves (gestionarDesde null)', async () => {
        const { service, prisma } = armar({
            otrosCasos: [{ id: 42, remesa: { numeroRemesa: '200', createdAt: new Date('2026-08-01') }, estadoSituacion: { clave: 'SIT-010' }, estadoGestion: { clave: 'GES-020' } }],
        });
        prisma.deudor.findMany
            .mockResolvedValueOnce([
                { id: 500, remesa: { numeroRemesa: '201', createdAt: new Date('2026-09-01') } },
                { id: 42, remesa: { numeroRemesa: '200', createdAt: new Date('2026-08-01') } },
            ]);
        const res = await service.clavesDelCaso(500);
        expect(res.avisos.gestionarDesde).toBeNull();
    });

    it('lista otros casos del mismo trámite (no cancelados)', async () => {
        const { service } = armar({
            otrosCasos: [{ id: 42, remesa: { numeroRemesa: '00609' }, estadoSituacion: { clave: 'SIT-010' }, estadoGestion: { clave: 'GES-020' } }],
        });
        const res = await service.clavesDelCaso(500);
        expect(res.avisos.otrosCasosDelTramite).toEqual([
            { deudorId: 42, numeroRemesa: '00609', situacion: 'SIT-010', enGestion: true },
        ]);
    });

    it('resuelve "otros casos" con TRIM en SQL, no con igualdad exacta (hallazgo de la auditoría: un hermano con espacios en nroCliente no matcheaba)', async () => {
        const { service, prisma } = armar({
            deudor: { id: 500, empresaId: 10, nroCliente: ' 1841012140 ', saldo: 39760.03, montoTotal: 39760.03, estadoSituacionId: 1 },
            otrosCasos: [{ id: 77, remesa: { numeroRemesa: '00610' }, estadoSituacion: { clave: 'SIT-010' }, estadoGestion: { clave: 'GES-020' } }],
        });
        const res = await service.clavesDelCaso(500);
        expect(prisma.$queryRaw).toHaveBeenCalled();
        // El propio trámite ya se resuelve trimeado; la query de "otros casos" tiene que buscar
        // por ese mismo valor trimeado, no por el nroCliente crudo (con espacios) del deudor actual.
        expect(res.nroTramite).toBe('1841012140');
        expect(res.avisos.otrosCasosDelTramite).toEqual([
            { deudorId: 77, numeroRemesa: '00610', situacion: 'SIT-010', enGestion: true },
        ]);
    });

    it('usa DeudorBloqueoService.estaBloqueado para el aviso de cuenta cancelada', async () => {
        const { service, bloqueo } = armar({ estaBloqueado: true });
        const res = await service.clavesDelCaso(500);
        expect(res.avisos.cuentaCancelada).toBe(true);
        expect(bloqueo.estaBloqueado).toHaveBeenCalledWith(1);
    });

    it('incluirReemplazadas=false solo trae VIGENTE (se filtra en la query, no acá)', async () => {
        const { service, prisma } = armar();
        await service.clavesDelCaso(500, false);
        const where = prisma.clave_pago.findMany.mock.calls[0][0].where;
        expect(where.estado).toBe('VIGENTE');
    });

    // ── Fase 4a de multiclaves (spec §9.1): pagos con clave y "cancelado con quita" ──────────
    it('sin pagos con referenciaClave, `pagos` es null en cada clave', async () => {
        const { service } = armar();
        const res = await service.clavesDelCaso(500);
        for (const c of res.claves) expect(c.pagos).toBeNull();
        expect(res.avisos.canceladoConQuita).toBeNull();
    });

    it('con un pago que cubre la clave QUITA, `pagos.cubreLaClave` es true', async () => {
        const { service } = armar({
            pagos: [{ referenciaClave: CLAVE_QUITA.nroConvenio, importe: 19880.01, fecha: new Date('2026-09-10T00:00:00.000Z') }],
        });
        const res = await service.clavesDelCaso(500);
        const quita = res.claves.find((c: any) => c.tipo === 'QUITA')!;
        expect(quita.pagos).toEqual({ cantidad: 1, pagado: '19880.01', ultimaFecha: '2026-09-10T00:00:00.000Z', cubreLaClave: true });
    });

    it('un pago parcial NO cubre la clave: cubreLaClave false, sin aviso de cancelado con quita', async () => {
        const { service } = armar({
            pagos: [{ referenciaClave: CLAVE_QUITA.nroConvenio, importe: 10000, fecha: new Date('2026-09-10T00:00:00.000Z') }],
        });
        const res = await service.clavesDelCaso(500);
        const quita = res.claves.find((c: any) => c.tipo === 'QUITA')!;
        expect(quita.pagos?.cubreLaClave).toBe(false);
        expect(res.avisos.canceladoConQuita).toBeNull();
    });

    it('cuenta cancelada + pago que cubre la QUITA → avisos.canceladoConQuita con el importe perdonado', async () => {
        const { service } = armar({
            deudor: { id: 500, empresaId: 10, nroCliente: '1841012140', saldo: 0, montoTotal: 39760.03, estadoSituacionId: 54 },
            pagos: [{ referenciaClave: CLAVE_QUITA.nroConvenio, importe: 19880.01, fecha: new Date('2026-09-10T00:00:00.000Z') }],
            estaBloqueado: true,
        });
        const res = await service.clavesDelCaso(500);
        expect(res.avisos.canceladoConQuita).toEqual({
            claveId: CLAVE_QUITA.id,
            nroConvenio: CLAVE_QUITA.nroConvenio,
            pagado: '19880.01',
            importeClave: '19880.01',
            quita: '19880.02',
        });
    });

    it('cuenta cancelada por pago de la clave TOTAL: no arma canceladoConQuita (solo aplica a QUITA)', async () => {
        const { service } = armar({
            deudor: { id: 500, empresaId: 10, nroCliente: '1841012140', saldo: 0, montoTotal: 39760.03, estadoSituacionId: 50 },
            pagos: [{ referenciaClave: CLAVE_TOTAL.nroConvenio, importe: 39760.03, fecha: new Date('2026-09-10T00:00:00.000Z') }],
            estaBloqueado: true,
        });
        const res = await service.clavesDelCaso(500);
        expect(res.avisos.canceladoConQuita).toBeNull();
        const total = res.claves.find((c: any) => c.tipo === 'TOTAL')!;
        expect(total.pagos?.cubreLaClave).toBe(true);
    });

    it('incluirReemplazadas=true no filtra por estado', async () => {
        const { service, prisma } = armar();
        await service.clavesDelCaso(500, true);
        const where = prisma.clave_pago.findMany.mock.calls[0][0].where;
        expect(where.estado).toBeUndefined();
    });
});
