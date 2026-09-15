import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CuponService, UsuarioJwt } from './cupon.service';
import { GenerarCuponDto } from './dto/generar-cupon.dto';

const CLAVE_QUITA = {
    id: 10,
    empresaId: 1,
    nroTramite: '1841012140',
    nroConvenio: '96332206',
    tipo: 'QUITA',
    importe: '19880.01',
    saldoTramite: '39760.03',
    fechaVencimiento: new Date('2026-10-27T00:00:00.000Z'),
    clavePago: '0096332206000019880014',
    codigoBarras: '49800019880012710202600000000000096332206000000007',
    codigoGestor: '1008',
    marca: 'C',
    estado: 'VIGENTE',
};

const CLAVE_TOTAL = {
    ...CLAVE_QUITA,
    id: 11,
    nroConvenio: '96311343',
    tipo: 'TOTAL',
    importe: '39760.03',
    clavePago: '0096311343000039760032',
    codigoBarras: '49800039760032710202600000000000096311343000000009',
};

const DEUDOR = {
    id: 500,
    empresaId: 1,
    nroCliente: '1841012140',
    nombre: 'JUAN',
    apellido: 'PEREZ',
    estadoSituacionId: 1,
    estadoGestionId: 2,
};

const USUARIO: UsuarioJwt = { sub: 77, email: 'gestor@amsa.com', permisos: [] };
const USUARIO_CON_CANCELAR: UsuarioJwt = { ...USUARIO, permisos: ['convenios.cancelar'] };

function dtoDescargar(overrides: Partial<GenerarCuponDto> = {}): GenerarCuponDto {
    return { deudorId: DEUDOR.id, accion: 'DESCARGAR', ...overrides } as GenerarCuponDto;
}

/** Prisma + colaboradores mockeados. `activosEnTx` es lo que devuelve `tx.convenio.findMany` (los
 * convenios de clave ACTIVOS del trámite, ya con `clavePago` incluido). */
function armar(opts: {
    clave?: any;
    deudor?: any;
    activosEnTx?: any[];
    gestion?: { id: number; clave: string } | null;
    cuponPdfFalla?: boolean;
    bloqueoFalla?: boolean;
    estaBloqueado?: boolean;
    otroConvenioDeEstaClave?: any; // prisma.convenio.findFirst (fuera de la tx) — clave REEMPLAZADA
} = {}) {
    const tx = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
        convenio: {
            findMany: jest.fn().mockResolvedValue(opts.activosEnTx ?? []),
            create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 999, ...data })),
            update: jest.fn().mockImplementation(({ where, data }: any) => Promise.resolve({ id: where.id, ...data })),
        },
        comentario: { create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 555, ...data })) },
        parametro: { findUnique: jest.fn().mockResolvedValue('gestion' in opts ? opts.gestion : { id: 99, clave: 'GES-050' }) },
        deudor: { update: jest.fn().mockResolvedValue(undefined) },
    };

    const prisma: any = {
        clave_pago: { findUnique: jest.fn().mockResolvedValue(opts.clave ?? CLAVE_QUITA) },
        deudor: { findUnique: jest.fn().mockResolvedValue(opts.deudor ?? DEUDOR) },
        empresa: { findUnique: jest.fn().mockResolvedValue({ configuracion: null }) },
        convenio: { findFirst: jest.fn().mockResolvedValue(opts.otroConvenioDeEstaClave ?? null) },
        $transaction: jest.fn((cb: any) => cb(tx)),
    };

    const bloqueo: any = {
        assertNoBloqueado: jest.fn().mockImplementation(() => {
            if (opts.bloqueoFalla) return Promise.reject(new ForbiddenException({ code: 'DEUDOR_CANCELADO', message: 'cancelado' }));
            return Promise.resolve(undefined);
        }),
        estaBloqueado: jest.fn().mockReturnValue(opts.estaBloqueado ?? false),
    };

    const cuponPdf: any = {
        generar: jest.fn().mockImplementation(() => {
            if (opts.cuponPdfFalla) return Promise.reject(new Error('pdfmake explotó'));
            return Promise.resolve(Buffer.from('%PDF-fake'));
        }),
    };

    const consolidacion: any = { consolidar: jest.fn().mockResolvedValue(undefined) };

    const service = new CuponService(prisma, bloqueo, cuponPdf, consolidacion);
    return { service, prisma, tx, bloqueo, cuponPdf, consolidacion };
}

describe('CuponService.generar', () => {
    it('flujo feliz DESCARGAR: crea el convenio con montoOriginal/importeQuita/clavePagoId, usuarioId del JWT, cambia la gestión y comenta', async () => {
        const { service, tx, consolidacion } = armar();

        const res = await service.generar(CLAVE_QUITA.id, dtoDescargar(), USUARIO);

        expect(res.convenioReusado).toBe(false);
        expect(res.convenioAnuladoId).toBeNull();
        expect(res.gestionCambiada).toBe(true);
        expect(res.descargaUrl).toBe(`/api/multiclaves/convenios/${res.convenioId}/cupon.pdf`);
        expect(res.envio).toBeNull();

        const dataCreado = tx.convenio.create.mock.calls[0][0].data;
        expect(dataCreado.usuarioId).toBe(USUARIO.sub); // nunca del body/DTO
        expect(dataCreado.clavePagoId).toBe(CLAVE_QUITA.id);
        expect(dataCreado.origen).toBe('CLAVE_PAGO');
        expect(dataCreado.cantCuotas).toBe(1);
        expect(dataCreado.montoTotal).toBeCloseTo(198.8001 * 100, 2);
        expect(dataCreado.montoOriginal).toBeCloseTo(39760.03, 2);
        expect(dataCreado.importeQuita).toBeCloseTo(39760.03 - 19880.01, 2);

        expect(tx.deudor.update).toHaveBeenCalledWith({ where: { id: DEUDOR.id }, data: { estadoGestionId: 99 } });
        expect(tx.comentario.create).toHaveBeenCalled();
        expect(consolidacion.consolidar).toHaveBeenCalledWith({ tipo: 'DEUDORES', deudorIds: [DEUDOR.id] });
    });

    it('si el parámetro de gestión no existe en el catálogo, no cambia la gestión pero sigue generando (no bloquea por un catálogo incompleto)', async () => {
        const { service, tx } = armar({ gestion: null });
        const res = await service.generar(CLAVE_QUITA.id, dtoDescargar(), USUARIO);
        expect(res.gestionCambiada).toBe(false);
        expect(tx.deudor.update).not.toHaveBeenCalled();
    });

    it('reuso: generar dos veces la misma clave para el mismo caso no crea un segundo convenio', async () => {
        const activo = { id: 777, deudorId: DEUDOR.id, clavePagoId: CLAVE_QUITA.id, observaciones: null, clavePago: CLAVE_QUITA };
        const { service, tx, consolidacion } = armar({ activosEnTx: [activo] });

        const res = await service.generar(CLAVE_QUITA.id, dtoDescargar(), USUARIO);

        expect(res.convenioReusado).toBe(true);
        expect(res.convenioId).toBe(777);
        expect(res.gestionCambiada).toBe(false);
        expect(tx.convenio.create).not.toHaveBeenCalled();
        expect(tx.comentario.create.mock.calls[0][0].data.texto).toMatch(/reenviado/);
        expect(consolidacion.consolidar).not.toHaveBeenCalled(); // no hubo convenio nuevo ni anulado
    });

    it('convenio de esta clave activo en OTRO caso → 409 CONVENIO_CLAVE_EN_OTRO_CASO', async () => {
        const activo = { id: 777, deudorId: 999, clavePagoId: CLAVE_QUITA.id, observaciones: null, clavePago: CLAVE_QUITA };
        const { service, tx } = armar({ activosEnTx: [activo] });

        await expect(service.generar(CLAVE_QUITA.id, dtoDescargar(), USUARIO)).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'CONVENIO_CLAVE_EN_OTRO_CASO' }),
        });
        expect(tx.convenio.create).not.toHaveBeenCalled();
    });

    it('otra clave del trámite con convenio activo, sin reemplazarConvenioActivo → 409 CONVENIO_OTRA_CLAVE_ACTIVO', async () => {
        const otro = { id: 900, deudorId: DEUDOR.id, clavePagoId: CLAVE_TOTAL.id, montoTotal: 39760.03, observaciones: null, clavePago: CLAVE_TOTAL };
        const { service, tx } = armar({ activosEnTx: [otro] });

        await expect(service.generar(CLAVE_QUITA.id, dtoDescargar(), USUARIO)).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'CONVENIO_OTRA_CLAVE_ACTIVO' }),
        });
        expect(tx.convenio.update).not.toHaveBeenCalled();
        expect(tx.convenio.create).not.toHaveBeenCalled();
    });

    it('con reemplazarConvenioActivo pero SIN permiso convenios.cancelar → 403, no anula ni crea', async () => {
        const otro = { id: 900, deudorId: DEUDOR.id, clavePagoId: CLAVE_TOTAL.id, montoTotal: 39760.03, observaciones: null, clavePago: CLAVE_TOTAL };
        const { service, tx } = armar({ activosEnTx: [otro] });

        await expect(
            service.generar(CLAVE_QUITA.id, dtoDescargar({ reemplazarConvenioActivo: true }), USUARIO), // USUARIO sin el permiso
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(tx.convenio.update).not.toHaveBeenCalled();
        expect(tx.convenio.create).not.toHaveBeenCalled();
    });

    it('con reemplazarConvenioActivo Y el permiso → anula el convenio anterior y crea el nuevo', async () => {
        const otro = { id: 900, deudorId: DEUDOR.id, clavePagoId: CLAVE_TOTAL.id, montoTotal: 39760.03, observaciones: null, clavePago: CLAVE_TOTAL };
        const { service, tx, consolidacion } = armar({ activosEnTx: [otro] });

        const res = await service.generar(CLAVE_QUITA.id, dtoDescargar({ reemplazarConvenioActivo: true }), USUARIO_CON_CANCELAR);

        expect(res.convenioAnuladoId).toBe(900);
        expect(res.convenioReusado).toBe(false);
        expect(tx.convenio.update).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 900 }, data: expect.objectContaining({ estado: 'ANULADO' }) }),
        );
        // La observación nombra cada clave con su propio tipo y número: el cupón generado es de la
        // QUITA y el convenio anulado era de la TOTAL.
        const obsAnulado = tx.convenio.update.mock.calls[0][0].data.observaciones;
        expect(obsAnulado).toBe(
            `Anulado: se generó el cupón de la clave QUITA ${CLAVE_QUITA.nroConvenio} ` +
            `(este convenio era de la clave TOTAL ${CLAVE_TOTAL.nroConvenio})`,
        );
        expect(tx.convenio.create).toHaveBeenCalled();
        expect(consolidacion.consolidar).toHaveBeenCalled();
    });

    it('reemplazarConvenioActivo cuando el convenio de la otra clave está en otro caso → 409 CONVENIO_CLAVE_EN_OTRO_CASO', async () => {
        const otro = { id: 900, deudorId: 111, clavePagoId: CLAVE_TOTAL.id, montoTotal: 39760.03, observaciones: null, clavePago: CLAVE_TOTAL };
        const { service } = armar({ activosEnTx: [otro] });

        await expect(
            service.generar(CLAVE_QUITA.id, dtoDescargar({ reemplazarConvenioActivo: true }), USUARIO_CON_CANCELAR),
        ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'CONVENIO_CLAVE_EN_OTRO_CASO' }) });
    });

    it('caso cancelado → 403 y sin escrituras (ni siquiera se genera el PDF)', async () => {
        const { service, prisma, cuponPdf } = armar({ bloqueoFalla: true });
        await expect(service.generar(CLAVE_QUITA.id, dtoDescargar(), USUARIO)).rejects.toBeInstanceOf(ForbiddenException);
        expect(cuponPdf.generar).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('clave vencida → 400 CLAVE_VENCIDA, sin generar el PDF ni escribir', async () => {
        const vencida = { ...CLAVE_QUITA, fechaVencimiento: new Date('2020-01-01T00:00:00.000Z') };
        const { service, prisma, cuponPdf } = armar({ clave: vencida });

        await expect(service.generar(vencida.id, dtoDescargar(), USUARIO)).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'CLAVE_VENCIDA' }),
        });
        expect(cuponPdf.generar).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('clave de otro trámite (no corresponde al caso) → 400 CLAVE_NO_CORRESPONDE', async () => {
        const otroTramite = { ...CLAVE_QUITA, nroTramite: '9999999999' };
        const { service } = armar({ clave: otroTramite });
        await expect(service.generar(otroTramite.id, dtoDescargar(), USUARIO)).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'CLAVE_NO_CORRESPONDE' }),
        });
    });

    it('clave REEMPLAZADA sin convenio activo → 400 CLAVE_REEMPLAZADA', async () => {
        const reemplazada = { ...CLAVE_QUITA, estado: 'REEMPLAZADA' };
        const { service } = armar({ clave: reemplazada, otroConvenioDeEstaClave: null });
        await expect(service.generar(reemplazada.id, dtoDescargar(), USUARIO)).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'CLAVE_REEMPLAZADA' }),
        });
    });

    it('clave REEMPLAZADA CON convenio activo de este caso (R8) sigue funcionando como reuso', async () => {
        const reemplazada = { ...CLAVE_QUITA, estado: 'REEMPLAZADA' };
        const activo = { id: 777, deudorId: DEUDOR.id, clavePagoId: reemplazada.id, observaciones: null, clavePago: reemplazada };
        const { service } = armar({
            clave: reemplazada,
            otroConvenioDeEstaClave: { id: 777, deudorId: DEUDOR.id },
            activosEnTx: [activo],
        });

        const res = await service.generar(reemplazada.id, dtoDescargar(), USUARIO);
        expect(res.convenioReusado).toBe(true);
        expect(res.convenioId).toBe(777);
    });

    it('un trámite SOLO_TOTAL (una única clave activa) genera igual, sin comparar contra una cantidad fija', async () => {
        const { service, tx } = armar({ clave: CLAVE_TOTAL, activosEnTx: [] });
        const res = await service.generar(CLAVE_TOTAL.id, dtoDescargar(), USUARIO);
        expect(res.convenioReusado).toBe(false);
        expect(tx.convenio.create.mock.calls[0][0].data.montoOriginal).toBeCloseTo(39760.03, 2);
        expect(tx.convenio.create.mock.calls[0][0].data.importeQuita).toBeCloseTo(0, 2);
    });

    it('si falla la generación del PDF, no queda ninguna escritura (todo antes de la transacción)', async () => {
        const { service, prisma, cuponPdf } = armar({ cuponPdfFalla: true });
        await expect(service.generar(CLAVE_QUITA.id, dtoDescargar(), USUARIO)).rejects.toThrow();
        expect(cuponPdf.generar).toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('acción ENVIAR o DESCARGAR_Y_ENVIAR (fase 3, sin implementar) → 400 ACCION_NO_DISPONIBLE, sin tocar nada', async () => {
        const { service, prisma, cuponPdf } = armar();
        await expect(service.generar(CLAVE_QUITA.id, dtoDescargar({ accion: 'ENVIAR' }), USUARIO)).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'ACCION_NO_DISPONIBLE' }),
        });
        expect(cuponPdf.generar).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('clave inexistente → 404 CLAVE_NO_ENCONTRADA', async () => {
        const { service } = armar();
        (service as any).prisma.clave_pago.findUnique = jest.fn().mockResolvedValue(null);
        await expect(service.generar(999, dtoDescargar(), USUARIO)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('deudor inexistente → 404 DEUDOR_NO_ENCONTRADO', async () => {
        const { service } = armar();
        (service as any).prisma.deudor.findUnique = jest.fn().mockResolvedValue(null);
        await expect(service.generar(CLAVE_QUITA.id, dtoDescargar({ deudorId: 12345 }), USUARIO)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('concurrencia: dos generaciones "simultáneas" de la misma clave, serializadas por la transacción, dejan un solo convenio ACTIVO', async () => {
        // Fake de Prisma con estado compartido y un `$transaction` que serializa las llamadas (como
        // lo hace de verdad el `SELECT … FOR UPDATE`), para probar que la lógica de reuso/creación
        // es correcta una vez serializada. La serialización real contra MySQL se prueba en la base
        // local (ver la verificación manual de la fase 2).
        const convenios: any[] = [];
        let nextId = 1000;
        let mutex: Promise<any> = Promise.resolve();

        const tx = {
            $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
            convenio: {
                findMany: jest.fn().mockImplementation(() =>
                    Promise.resolve(convenios.filter((c) => c.estado === 'ACTIVO').map((c) => ({ ...c, clavePago: CLAVE_QUITA }))),
                ),
                create: jest.fn().mockImplementation(({ data }: any) => {
                    const row = { id: nextId++, estado: 'ACTIVO', ...data };
                    convenios.push(row);
                    return Promise.resolve(row);
                }),
                update: jest.fn(),
            },
            comentario: { create: jest.fn().mockResolvedValue({ id: 1 }) },
            parametro: { findUnique: jest.fn().mockResolvedValue(null) },
            deudor: { update: jest.fn() },
        };

        const prisma: any = {
            clave_pago: { findUnique: jest.fn().mockResolvedValue(CLAVE_QUITA) },
            deudor: { findUnique: jest.fn().mockResolvedValue(DEUDOR) },
            empresa: { findUnique: jest.fn().mockResolvedValue({ configuracion: null }) },
            convenio: { findFirst: jest.fn().mockResolvedValue(null) },
            $transaction: jest.fn((cb: any) => {
                const run = mutex.then(() => cb(tx));
                mutex = run.catch(() => undefined);
                return run;
            }),
        };

        const bloqueo: any = { assertNoBloqueado: jest.fn().mockResolvedValue(undefined), estaBloqueado: jest.fn().mockReturnValue(false) };
        const cuponPdf: any = { generar: jest.fn().mockResolvedValue(Buffer.from('%PDF-fake')) };
        const consolidacion: any = { consolidar: jest.fn().mockResolvedValue(undefined) };
        const service = new CuponService(prisma, bloqueo, cuponPdf, consolidacion);

        const [r1, r2] = await Promise.all([
            service.generar(CLAVE_QUITA.id, dtoDescargar(), USUARIO),
            service.generar(CLAVE_QUITA.id, dtoDescargar(), USUARIO),
        ]);

        expect(convenios.length).toBe(1); // un solo convenio ACTIVO, nunca dos
        expect(r1.convenioId).toBe(r2.convenioId);
        expect([r1.convenioReusado, r2.convenioReusado].filter(Boolean).length).toBe(1); // uno crea, el otro reusa
    });
});

describe('CuponService.preview', () => {
    function armarPreview(opts: {
        clave?: any;
        deudor?: any;
        convenioDeEstaClave?: any; // prisma.convenio.findFirst — clavePagoId = claveId
        otroActivo?: any; // prisma.convenio.findFirst — clavePagoId != claveId
        estaBloqueado?: boolean;
    } = {}) {
        const findFirstCalls: any[] = [];
        const prisma: any = {
            clave_pago: { findUnique: jest.fn().mockResolvedValue(opts.clave ?? CLAVE_QUITA) },
            deudor: { findUnique: jest.fn().mockResolvedValue(opts.deudor ?? DEUDOR) },
            empresa: { findUnique: jest.fn().mockResolvedValue({ configuracion: null }) },
            convenio: {
                findFirst: jest.fn().mockImplementation((args: any) => {
                    findFirstCalls.push(args);
                    // `convenioActivoDeClave` filtra por clavePagoId exacto; el de "otroActivo" por clavePagoId != claveId.
                    if (args.where.clavePagoId && typeof args.where.clavePagoId === 'number') {
                        return Promise.resolve(opts.convenioDeEstaClave ?? null);
                    }
                    return Promise.resolve(opts.otroActivo ?? null);
                }),
            },
        };
        const bloqueo: any = { estaBloqueado: jest.fn().mockReturnValue(opts.estaBloqueado ?? false) };
        const cuponPdf: any = {};
        const consolidacion: any = {};
        return { service: new CuponService(prisma, bloqueo, cuponPdf, consolidacion), prisma };
    }

    it('NUNCA devuelve la clave de 22 dígitos ni el código de barras completos (D6, hallazgo de la auditoría)', async () => {
        const { service } = armarPreview();
        const res = await service.preview(CLAVE_QUITA.id, DEUDOR.id);
        expect(res.clave).not.toHaveProperty('clavePago');
        expect(res.clave).not.toHaveProperty('codigoBarras');
        expect((res.clave as any).clavePagoUltimos4).toBe(CLAVE_QUITA.clavePago.slice(-4));
    });

    it('puedeGenerar true y sin avisos cuando no hay bloqueos ni conflictos', async () => {
        const { service } = armarPreview();
        const res = await service.preview(CLAVE_QUITA.id, DEUDOR.id);
        expect(res.puedeGenerar).toBe(true);
        expect(res.avisos).toEqual([]);
    });

    it('la clave ya tiene un convenio activo en OTRO caso: puedeGenerar false, con aviso y el id del otro caso (§11.2.5)', async () => {
        const { service } = armarPreview({
            convenioDeEstaClave: { id: 777, deudorId: 999, createdAt: new Date('2026-09-01T00:00:00.000Z') },
        });
        const res = await service.preview(CLAVE_QUITA.id, DEUDOR.id);
        expect(res.puedeGenerar).toBe(false);
        expect(res.avisos.some((a) => a.includes('999'))).toBe(true);
        expect(res.convenioActivo).toEqual({ id: 777, deudorId: 999, esEsteCaso: false, createdAt: '2026-09-01T00:00:00.000Z' });
    });

    it('la clave ya tiene un convenio activo en ESTE mismo caso: puedeGenerar sigue true (es un reuso, no un conflicto)', async () => {
        const { service } = armarPreview({
            convenioDeEstaClave: { id: 777, deudorId: DEUDOR.id, createdAt: new Date('2026-09-01T00:00:00.000Z') },
        });
        const res = await service.preview(CLAVE_QUITA.id, DEUDOR.id);
        expect(res.puedeGenerar).toBe(true);
        expect(res.avisos).toEqual([]);
    });

    it('caso cancelado: puedeGenerar false con aviso', async () => {
        const { service } = armarPreview({ estaBloqueado: true });
        const res = await service.preview(CLAVE_QUITA.id, DEUDOR.id);
        expect(res.puedeGenerar).toBe(false);
        expect(res.avisos.some((a) => /cancelada/.test(a))).toBe(true);
    });

    it('clave vencida: puedeGenerar false con aviso', async () => {
        const vencida = { ...CLAVE_QUITA, fechaVencimiento: new Date('2020-01-01T00:00:00.000Z') };
        const { service } = armarPreview({ clave: vencida });
        const res = await service.preview(vencida.id, DEUDOR.id);
        expect(res.puedeGenerar).toBe(false);
        expect(res.avisos.some((a) => /vencida/.test(a))).toBe(true);
    });
});

describe('CuponService.obtenerPdfDeConvenio (reimpresión, §8.2)', () => {
    function armarReimpresion(convenio: any) {
        const prisma: any = {
            convenio: { findUnique: jest.fn().mockResolvedValue(convenio) },
            empresa: { findUnique: jest.fn().mockResolvedValue({ configuracion: null }) },
        };
        const bloqueo: any = { assertNoBloqueado: jest.fn().mockResolvedValue(undefined), estaBloqueado: jest.fn() };
        const cuponPdf: any = { generar: jest.fn().mockResolvedValue(Buffer.from('%PDF-fake')) };
        const consolidacion: any = { consolidar: jest.fn() };
        return { service: new CuponService(prisma, bloqueo, cuponPdf, consolidacion), prisma, bloqueo, cuponPdf };
    }

    const CONVENIO_ACTIVO = {
        id: 1,
        origen: 'CLAVE_PAGO',
        estado: 'ACTIVO',
        deudorId: DEUDOR.id,
        clavePagoId: CLAVE_QUITA.id,
        clavePago: CLAVE_QUITA,
        deudor: DEUDOR,
    };

    it('reimprime un convenio de clave activo y no vencido', async () => {
        const { service, cuponPdf } = armarReimpresion(CONVENIO_ACTIVO);
        const res = await service.obtenerPdfDeConvenio(1);
        expect(res.buffer.toString('ascii', 0, 4)).toBe('%PDF');
        expect(res.nroTramite).toBe(CLAVE_QUITA.nroTramite);
        expect(cuponPdf.generar).toHaveBeenCalled();
    });

    it('convenio inexistente o que no es de clave de pago → 404', async () => {
        const { service } = armarReimpresion(null);
        await expect(service.obtenerPdfDeConvenio(1)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('convenio ANULADO → 400 (no se reimprime)', async () => {
        const { service } = armarReimpresion({ ...CONVENIO_ACTIVO, estado: 'ANULADO' });
        await expect(service.obtenerPdfDeConvenio(1)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('caso cancelado → 403 (R7)', async () => {
        const { service, bloqueo } = armarReimpresion(CONVENIO_ACTIVO);
        bloqueo.assertNoBloqueado.mockRejectedValue(new ForbiddenException({ code: 'DEUDOR_CANCELADO' }));
        await expect(service.obtenerPdfDeConvenio(1)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('clave vencida → 400 CLAVE_VENCIDA (aunque el convenio siga activo)', async () => {
        const vencida = { ...CLAVE_QUITA, fechaVencimiento: new Date('2020-01-01T00:00:00.000Z') };
        const { service } = armarReimpresion({ ...CONVENIO_ACTIVO, clavePago: vencida });
        await expect(service.obtenerPdfDeConvenio(1)).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'CLAVE_VENCIDA' }),
        });
    });
});
