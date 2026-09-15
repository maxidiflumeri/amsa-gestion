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
    contactosEmail?: any[];
    smtp?: { id: number } | null; // EmailSenderService.smtpDeEmpresa
    previewVariables?: { template: any; sugerencias: any[] }; // EmailSenderService.previewVariables
    previewVariablesFalla?: Error;
    enviarResultado?: any; // EmailSenderService.enviar
    enviarFalla?: Error;
} = {}) {
    const tx = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
        convenio: {
            findMany: jest.fn().mockResolvedValue(opts.activosEnTx ?? []),
            create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 999, ...data })),
            update: jest.fn().mockImplementation(({ where, data }: any) => Promise.resolve({ id: where.id, ...data })),
        },
        parametro: { findUnique: jest.fn().mockResolvedValue('gestion' in opts ? opts.gestion : { id: 99, clave: 'GES-050' }) },
        deudor: { update: jest.fn().mockResolvedValue(undefined) },
    };

    const prisma: any = {
        clave_pago: { findUnique: jest.fn().mockResolvedValue(opts.clave ?? CLAVE_QUITA) },
        deudor: { findUnique: jest.fn().mockResolvedValue(opts.deudor ?? DEUDOR) },
        empresa: { findUnique: jest.fn().mockResolvedValue({ configuracion: null }) },
        convenio: { findFirst: jest.fn().mockResolvedValue(opts.otroConvenioDeEstaClave ?? null) },
        contacto: {
            findMany: jest.fn().mockResolvedValue(opts.contactosEmail ?? []),
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({ id: 1 }),
        },
        comentario: { create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 555, ...data })) },
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

    const emailSender: any = {
        smtpDeEmpresa: jest.fn().mockResolvedValue({ empresa: { id: 1, nombre: 'TELECOM' }, smtp: 'smtp' in opts ? opts.smtp : { id: 5 } }),
        previewVariables: jest.fn().mockImplementation(() => {
            if (opts.previewVariablesFalla) return Promise.reject(opts.previewVariablesFalla);
            return Promise.resolve(
                opts.previewVariables ?? { template: { id: 1, nombre: 'Plantilla', asunto: 'Asunto', variables: [] }, sugerencias: [] },
            );
        }),
        enviar: jest.fn().mockImplementation(() => {
            if (opts.enviarFalla) return Promise.reject(opts.enviarFalla);
            return Promise.resolve(opts.enviarResultado ?? { envioId: 1, empresaId: 1, reporteIds: [1], ok: true, enviados: 1 });
        }),
    };

    const contactos: any = { create: jest.fn().mockResolvedValue({ id: 1 }) };

    const service = new CuponService(prisma, bloqueo, cuponPdf, consolidacion, emailSender, contactos);
    return { service, prisma, tx, bloqueo, cuponPdf, consolidacion, emailSender, contactos };
}

describe('CuponService.generar', () => {
    it('flujo feliz DESCARGAR: crea el convenio con montoOriginal/importeQuita/clavePagoId, usuarioId del JWT, cambia la gestión y comenta', async () => {
        const { service, prisma, tx, consolidacion } = armar();

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
        // El comentario se crea DESPUÉS de la transacción (fase 3: así puede reflejar el resultado
        // del envío por mail) — ya no cuelga de `tx`.
        expect(prisma.comentario.create).toHaveBeenCalled();
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
        const { service, prisma, tx, consolidacion } = armar({ activosEnTx: [activo] });

        const res = await service.generar(CLAVE_QUITA.id, dtoDescargar(), USUARIO);

        expect(res.convenioReusado).toBe(true);
        expect(res.convenioId).toBe(777);
        expect(res.gestionCambiada).toBe(false);
        expect(tx.convenio.create).not.toHaveBeenCalled();
        expect(prisma.comentario.create.mock.calls[0][0].data.texto).toMatch(/reenviado/);
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

    describe('envío por mail (fase 3)', () => {
        const USUARIO_ENVIA: UsuarioJwt = { sub: 77, email: 'gestor@amsa.com', permisos: ['email.enviar'] };

        function dtoEnviar(overrides: Partial<GenerarCuponDto> = {}): GenerarCuponDto {
            return dtoDescargar({ accion: 'ENVIAR', destinatarios: ['cliente@ejemplo.com'], ...overrides });
        }

        it('con plantilla y variables completas: manda por Sender con el templateId y las variables (propias pisando a las automáticas)', async () => {
            const { service, prisma, emailSender } = armar({
                previewVariables: {
                    template: { id: 5, nombre: 'Cupón', asunto: 'Tu cupón', variables: ['nombre', 'importe_cupon'] },
                    sugerencias: [{ variable: 'nombre', valor: 'Juan', origen: 'auto' }],
                },
            });

            const res = await service.generar(CLAVE_QUITA.id, dtoEnviar({ templateId: 5 }), USUARIO_ENVIA);

            expect(res.envio).toEqual({ envioId: 1, ok: true, enviados: 1, omitidos: undefined, errores: undefined });
            expect(emailSender.enviar).toHaveBeenCalledWith(
                expect.objectContaining({
                    templateId: 5,
                    html: undefined,
                    destinatarios: ['cliente@ejemplo.com'],
                    asunto: 'Tu cupón',
                    variables: expect.objectContaining({ nombre: 'Juan', importe_cupon: '$ 19.880,01' }),
                }),
            );
            const comentario = prisma.comentario.create.mock.calls[0][0].data.texto;
            expect(comentario).toMatch(/Enviado a 1 destinatario\.$/);
        });

        it('con plantilla y variables vacías: 400 PLANTILLA_CON_VARIABLES_VACIAS ANTES de generar el PDF ni tocar la base', async () => {
            const { service, prisma, cuponPdf, emailSender } = armar({
                previewVariables: {
                    template: { id: 5, nombre: 'Cupón', asunto: 'Tu cupón', variables: ['telefono_alternativo'] },
                    sugerencias: [],
                },
            });

            await expect(service.generar(CLAVE_QUITA.id, dtoEnviar({ templateId: 5 }), USUARIO_ENVIA)).rejects.toMatchObject({
                response: expect.objectContaining({ code: 'PLANTILLA_CON_VARIABLES_VACIAS', variables: ['telefono_alternativo'] }),
            });
            expect(cuponPdf.generar).not.toHaveBeenCalled();
            expect(prisma.$transaction).not.toHaveBeenCalled();
            expect(emailSender.enviar).not.toHaveBeenCalled();
        });

        it('la plantilla elegida desaparece de Sender entre el preview y la confirmación: 400 PLANTILLA_INVALIDA, nunca un 500', async () => {
            const { service, prisma, cuponPdf, emailSender } = armar({ previewVariablesFalla: new Error('Template id=5 no encontrado') });

            await expect(service.generar(CLAVE_QUITA.id, dtoEnviar({ templateId: 5 }), USUARIO_ENVIA)).rejects.toMatchObject({
                response: expect.objectContaining({ code: 'PLANTILLA_INVALIDA' }),
            });
            expect(cuponPdf.generar).not.toHaveBeenCalled();
            expect(prisma.$transaction).not.toHaveBeenCalled();
            expect(emailSender.enviar).not.toHaveBeenCalled();
        });

        it('sin plantilla: manda el mensaje por defecto (subject/html propios) con el PDF adjunto y el nombre escapado', async () => {
            const deudorConNombreRaro = { ...DEUDOR, nombre: '<b>Juan</b>', apellido: 'Pérez & Cía' };
            const { service, emailSender } = armar({ deudor: deudorConNombreRaro });

            const res = await service.generar(CLAVE_QUITA.id, dtoEnviar(), USUARIO_ENVIA);

            expect(res.envio?.ok).toBe(true);
            const llamada = emailSender.enviar.mock.calls[0][0];
            expect(llamada.templateId).toBeUndefined();
            expect(llamada.asunto).toBe('Cupón de pago - Personal');
            expect(llamada.html).toContain('$ 19.880,01');
            expect(llamada.html).not.toContain('<b>Juan</b>'); // nunca sin escapar
            expect(llamada.html).toContain('Pérez &amp; Cía &lt;b&gt;Juan&lt;/b&gt;');
            expect(llamada.archivos[0].originalname).toBe(`cupon-pago-${CLAVE_QUITA.nroTramite}.pdf`);
            expect(llamada.archivos[0].mimetype).toBe('application/pdf');
            expect(Buffer.isBuffer(llamada.archivos[0].buffer)).toBe(true);
        });

        it('empresa sin SMTP: 400 EMPRESA_SIN_SMTP, sin generar el PDF ni tocar la base', async () => {
            const { service, prisma, cuponPdf, emailSender } = armar({ smtp: null });

            await expect(service.generar(CLAVE_QUITA.id, dtoEnviar(), USUARIO_ENVIA)).rejects.toMatchObject({
                response: expect.objectContaining({ code: 'EMPRESA_SIN_SMTP' }),
            });
            expect(cuponPdf.generar).not.toHaveBeenCalled();
            expect(prisma.$transaction).not.toHaveBeenCalled();
            expect(emailSender.enviar).not.toHaveBeenCalled();
        });

        it('destinatario inválido: 400 DESTINATARIOS_INVALIDOS, sin generar el PDF ni tocar la base', async () => {
            const { service, prisma, cuponPdf } = armar();
            await expect(
                service.generar(CLAVE_QUITA.id, dtoEnviar({ destinatarios: ['no-es-un-email'] }), USUARIO_ENVIA),
            ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'DESTINATARIOS_INVALIDOS' }) });
            expect(cuponPdf.generar).not.toHaveBeenCalled();
            expect(prisma.$transaction).not.toHaveBeenCalled();
        });

        it('mail que falla: el convenio queda creado, el envío queda ok:false y el comentario dice FALLÓ', async () => {
            const { service, prisma } = armar({ enviarResultado: { envioId: 42, empresaId: 1, reporteIds: [], ok: false, enviados: 0, errores: [{ email: 'cliente@ejemplo.com', error: 'SMTP rechazado' }] } });

            const res = await service.generar(CLAVE_QUITA.id, dtoEnviar(), USUARIO_ENVIA);

            expect(res.convenioId).toBeDefined();
            expect(res.envio).toEqual({
                envioId: 42,
                ok: false,
                enviados: 0,
                omitidos: undefined,
                errores: [{ email: 'cliente@ejemplo.com', error: 'SMTP rechazado' }],
            });
            const comentario = prisma.comentario.create.mock.calls[0][0].data.texto;
            expect(comentario).toContain('El envío por mail FALLÓ: SMTP rechazado.');
            // El convenio se creó igual — nada se revierte por un mail que falla.
            expect(res.convenioReusado).toBe(false);
        });

        it('mail que explota (el cliente HTTP tira una excepción): igual queda registrado como fallo, sin relanzar', async () => {
            const { service } = armar({ enviarFalla: new Error('ECONNREFUSED') });
            const res = await service.generar(CLAVE_QUITA.id, dtoEnviar(), USUARIO_ENVIA);
            expect(res.envio).toEqual({ envioId: null, ok: false, enviados: 0, omitidos: undefined, errores: [{ error: 'ECONNREFUSED' }] });
        });

        it('sin permiso email.enviar: 403, sin generar el PDF ni tocar la base', async () => {
            const { service, prisma, cuponPdf, emailSender } = armar();
            await expect(service.generar(CLAVE_QUITA.id, dtoEnviar(), USUARIO)).rejects.toBeInstanceOf(ForbiddenException); // USUARIO sin permisos
            expect(cuponPdf.generar).not.toHaveBeenCalled();
            expect(prisma.$transaction).not.toHaveBeenCalled();
            expect(emailSender.enviar).not.toHaveBeenCalled();
        });

        it('reenvío (REUSO) con ENVIAR: reusa el convenio y manda otro mail, con comentario de reenvío', async () => {
            const activo = { id: 777, deudorId: DEUDOR.id, clavePagoId: CLAVE_QUITA.id, observaciones: null, clavePago: CLAVE_QUITA };
            const { service, prisma, emailSender } = armar({ activosEnTx: [activo] });

            const res = await service.generar(CLAVE_QUITA.id, dtoEnviar(), USUARIO_ENVIA);

            expect(res.convenioReusado).toBe(true);
            expect(emailSender.enviar).toHaveBeenCalled();
            const comentario = prisma.comentario.create.mock.calls[0][0].data.texto;
            expect(comentario).toMatch(/^Cupón de pago reenviado/);
            expect(comentario).toMatch(/Enviado a 1 destinatario\.$/);
        });

        it('DESCARGAR_Y_ENVIAR: manda el mail Y devuelve descargaUrl', async () => {
            const { service } = armar();
            const res = await service.generar(CLAVE_QUITA.id, dtoEnviar({ accion: 'DESCARGAR_Y_ENVIAR' }), USUARIO_ENVIA);
            expect(res.envio?.ok).toBe(true);
            expect(res.descargaUrl).toBe(`/api/multiclaves/convenios/${res.convenioId}/cupon.pdf`);
        });

        it('ENVIAR solo (sin descarga): descargaUrl es null', async () => {
            const { service } = armar();
            const res = await service.generar(CLAVE_QUITA.id, dtoEnviar({ accion: 'ENVIAR' }), USUARIO_ENVIA);
            expect(res.descargaUrl).toBeNull();
        });

        it('guardarEmailComoContacto: crea el contacto (vía ContactosService, con la validación de siempre) si no existía', async () => {
            const { service, prisma, contactos } = armar();
            await service.generar(CLAVE_QUITA.id, dtoEnviar({ guardarEmailComoContacto: true }), USUARIO_ENVIA);
            expect(prisma.contacto.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({ where: { deudorId: DEUDOR.id, tipo: 'email', valor: 'cliente@ejemplo.com' } }),
            );
            expect(contactos.create).toHaveBeenCalledWith(
                expect.objectContaining({ deudorId: DEUDOR.id, tipo: 'email', valor: 'cliente@ejemplo.com' }),
            );
        });

        it('guardarEmailComoContacto: no duplica si ya existe', async () => {
            const { service, prisma, contactos } = armar();
            prisma.contacto.findFirst.mockResolvedValueOnce({ id: 9 });
            await service.generar(CLAVE_QUITA.id, dtoEnviar({ guardarEmailComoContacto: true }), USUARIO_ENVIA);
            expect(contactos.create).not.toHaveBeenCalled();
        });

        it('guardarEmailComoContacto: NO se guarda si el envío no llegó a nadie (enviados:0)', async () => {
            const { service, contactos } = armar({
                enviarResultado: { envioId: 1, empresaId: 1, reporteIds: [], ok: true, enviados: 0, omitidos: [{ email: 'cliente@ejemplo.com', motivo: 'dado de baja' }] },
            });
            await service.generar(CLAVE_QUITA.id, dtoEnviar({ guardarEmailComoContacto: true }), USUARIO_ENVIA);
            expect(contactos.create).not.toHaveBeenCalled();
        });

        it('guardarEmailComoContacto en un envío PARCIAL: guarda solo a los que sí recibieron, no al omitido (hallazgo de la auditoría)', async () => {
            const { service, contactos } = armar({
                enviarResultado: {
                    envioId: 1,
                    empresaId: 1,
                    reporteIds: [1, 2],
                    ok: true,
                    enviados: 1,
                    omitidos: [{ email: 'baja@ejemplo.com', motivo: 'dado de baja' }],
                },
            });
            await service.generar(
                CLAVE_QUITA.id,
                dtoEnviar({ destinatarios: ['ok@ejemplo.com', 'baja@ejemplo.com'], guardarEmailComoContacto: true }),
                USUARIO_ENVIA,
            );
            expect(contactos.create).toHaveBeenCalledTimes(1);
            expect(contactos.create).toHaveBeenCalledWith(expect.objectContaining({ valor: 'ok@ejemplo.com' }));
            expect(contactos.create).not.toHaveBeenCalledWith(expect.objectContaining({ valor: 'baja@ejemplo.com' }));
        });

        it('guardarComoContacto: si ContactosService.create no responde (DNS/MX colgado), se corta a los 3s, sin bloquear ni tirar', async () => {
            jest.useFakeTimers();
            try {
                const contactos: any = { create: jest.fn().mockImplementation(() => new Promise(() => {})) }; // nunca resuelve
                const { service } = armar();
                (service as any).contactos = contactos;

                const promesa = service.generar(CLAVE_QUITA.id, dtoEnviar({ guardarEmailComoContacto: true }), USUARIO_ENVIA);
                // Deja correr los micro-tasks previos (envío del mail, transacción) antes de avanzar
                // el timer del timeout de `crearContactoConTimeout`.
                await Promise.resolve();
                await Promise.resolve();
                await jest.advanceTimersByTimeAsync(3000);

                const res = await promesa;
                expect(res.convenioId).toBeDefined(); // el cupón se generó igual
                expect(contactos.create).toHaveBeenCalled();
            } finally {
                jest.useRealTimers();
            }
        });

        it('omitido total (todos dados de baja): ok:true pero NO se cuenta como enviado, y el comentario lo dice', async () => {
            const { service, prisma } = armar({
                enviarResultado: {
                    envioId: 1,
                    empresaId: 1,
                    reporteIds: [1],
                    ok: true,
                    enviados: 0,
                    omitidos: [{ email: 'cliente@ejemplo.com', motivo: 'El destinatario se dio de baja de los envíos' }],
                },
            });
            const res = await service.generar(CLAVE_QUITA.id, dtoEnviar(), USUARIO_ENVIA);
            expect(res.envio?.enviados).toBe(0);
            expect(res.envio?.omitidos).toHaveLength(1);
            const comentario = prisma.comentario.create.mock.calls[0][0].data.texto;
            expect(comentario).toContain('No se envió: destinatario(s) dado(s) de baja.');
        });

        it('envío parcial (algunos enviados, otros omitidos): el comentario distingue enviados de omitidos', async () => {
            const { service, prisma } = armar({
                enviarResultado: {
                    envioId: 1,
                    empresaId: 1,
                    reporteIds: [1, 2],
                    ok: true,
                    enviados: 1,
                    omitidos: [{ email: 'baja@ejemplo.com', motivo: 'dado de baja' }],
                },
            });
            const res = await service.generar(CLAVE_QUITA.id, dtoEnviar({ destinatarios: ['ok@ejemplo.com', 'baja@ejemplo.com'] }), USUARIO_ENVIA);
            expect(res.envio?.enviados).toBe(1);
            expect(res.envio?.omitidos).toHaveLength(1);
            const comentario = prisma.comentario.create.mock.calls[0][0].data.texto;
            expect(comentario).toContain('Enviado a 1, 1 dado de baja.');
        });

        it('el asunto que se manda a Sender ya viene resuelto (sin {{variables}} literales) — así el historial de envio_email queda legible', async () => {
            const { service, emailSender } = armar({
                previewVariables: {
                    template: { id: 5, nombre: 'Cupón', asunto: 'Tu cupón, {{nombre_cliente}}', variables: ['nombre_cliente'] },
                    sugerencias: [],
                },
            });
            await service.generar(CLAVE_QUITA.id, dtoEnviar({ templateId: 5 }), USUARIO_ENVIA);
            const llamada = emailSender.enviar.mock.calls[0][0];
            expect(llamada.asunto).not.toContain('{{');
            expect(llamada.asunto).toBe('Tu cupón, PEREZ JUAN');
        });

        it('el comentario del envío que falla nunca supera 191 caracteres (varchar(191)), aunque el motivo sea larguísimo y haya anulación', async () => {
            const motivoGmail =
                'Invalid login: 535-5.7.8 Username and Password not accepted. For more information, go to ' +
                '5.7.8 https://support.google.com/mail/?p=BadCredentials j2-20020a170902d38900b001c7b3e0a1c1sm123456plb.45 - gsmtp';
            const otro = { id: 900, deudorId: DEUDOR.id, clavePagoId: CLAVE_TOTAL.id, montoTotal: 39760.03, observaciones: null, clavePago: CLAVE_TOTAL };
            const { service, prisma } = armar({
                activosEnTx: [otro],
                enviarResultado: { envioId: 42, empresaId: 1, reporteIds: [], ok: false, enviados: 0, errores: [{ email: 'cliente@ejemplo.com', error: motivoGmail }] },
            });

            await service.generar(
                CLAVE_QUITA.id,
                dtoEnviar({ reemplazarConvenioActivo: true }),
                { ...USUARIO_ENVIA, permisos: [...USUARIO_ENVIA.permisos, 'convenios.cancelar'] },
            );

            const comentario = prisma.comentario.create.mock.calls[0][0].data.texto;
            expect(comentario.length).toBeLessThanOrEqual(191);
            expect(comentario).toContain('Se anuló el convenio de la clave');
            expect(comentario).toContain('El envío por mail FALLÓ:');
        });

        it('motivo lleno de emojis (fuera del BMP, 2 unidades UTF-16 cada uno): el truncado corta por code point, nunca a mitad de un carácter — el comentario se inserta', async () => {
            // 😀 es U+1F600 — un solo code point, dos unidades UTF-16 (surrogate pair). Repetido
            // muchas veces para forzar el camino de truncado incluso con la versión compacta.
            const motivoEmoji = '😀'.repeat(120) + ' fin del motivo';
            const { service, prisma } = armar({
                enviarResultado: { envioId: 42, empresaId: 1, reporteIds: [], ok: false, enviados: 0, errores: [{ email: 'cliente@ejemplo.com', error: motivoEmoji }] },
            });

            await service.generar(CLAVE_QUITA.id, dtoEnviar(), USUARIO_ENVIA);

            const comentario: string = prisma.comentario.create.mock.calls[0][0].data.texto;
            // Contado por code point (`Array.from`), no por `.length` (unidades UTF-16) — con emojis
            // de 2 unidades, `.length` daría un número mayor a la cantidad real de caracteres.
            expect(Array.from(comentario).length).toBeLessThanOrEqual(191);
            // Nunca un surrogate suelto: cada code point del comentario tiene que ser válido — si el
            // corte hubiera partido un par por la mitad, `Array.from` tropieza con una unidad huérfana
            // (queda como un `string` de longitud 1 en UTF-16 pero fuera del rango de un carácter
            // completo) y el `codePointAt` da `undefined` para la posición siguiente inexistente.
            for (const ch of comentario) {
                expect(ch.codePointAt(0)).not.toBeUndefined();
            }
            expect(comentario).toContain('Cupón de pago generado — Clave QUITA 96332206.');
        });

        it('si el comentario igual explota (P2000 real u otro error de Prisma), NO tira un 500: el convenio ya escrito se devuelve con comentarioId:null', async () => {
            const { service, prisma } = armar();
            const p2000 = Object.assign(new Error("Data too long for column 'texto'"), { code: 'P2000' });
            prisma.comentario.create.mockRejectedValueOnce(p2000);

            const res = await service.generar(CLAVE_QUITA.id, dtoEnviar(), USUARIO_ENVIA);

            expect(res.convenioId).toBeDefined();
            expect(res.envio?.ok).toBe(true); // el mail sí salió, el comentario es lo que falló
            expect(res.comentarioId).toBeNull();
        });

        it('si la consolidación explota después de la transacción, tampoco tira un 500 (el convenio ya está escrito)', async () => {
            const { service, consolidacion } = armar();
            consolidacion.consolidar.mockRejectedValueOnce(new Error('timeout de consolidación'));
            const res = await service.generar(CLAVE_QUITA.id, dtoDescargar(), USUARIO);
            expect(res.convenioId).toBeDefined();
            expect(res.comentarioId).not.toBeNull();
        });
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
            comentario: { create: jest.fn().mockResolvedValue({ id: 1 }) },
            $transaction: jest.fn((cb: any) => {
                const run = mutex.then(() => cb(tx));
                mutex = run.catch(() => undefined);
                return run;
            }),
        };

        const bloqueo: any = { assertNoBloqueado: jest.fn().mockResolvedValue(undefined), estaBloqueado: jest.fn().mockReturnValue(false) };
        const cuponPdf: any = { generar: jest.fn().mockResolvedValue(Buffer.from('%PDF-fake')) };
        const consolidacion: any = { consolidar: jest.fn().mockResolvedValue(undefined) };
        const emailSender: any = { smtpDeEmpresa: jest.fn(), previewVariables: jest.fn(), enviar: jest.fn() };
        const contactos: any = { create: jest.fn() };
        const service = new CuponService(prisma, bloqueo, cuponPdf, consolidacion, emailSender, contactos);

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
        contactosEmail?: any[];
        previewVariables?: { template: any; sugerencias: any[] };
        previewVariablesFalla?: Error;
    } = {}) {
        const findFirstCalls: any[] = [];
        const prisma: any = {
            clave_pago: { findUnique: jest.fn().mockResolvedValue(opts.clave ?? CLAVE_QUITA) },
            deudor: { findUnique: jest.fn().mockResolvedValue(opts.deudor ?? DEUDOR) },
            empresa: { findUnique: jest.fn().mockResolvedValue({ configuracion: null }) },
            contacto: { findMany: jest.fn().mockResolvedValue(opts.contactosEmail ?? []) },
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
        const emailSender: any = {
            previewVariables: jest.fn().mockImplementation(() => {
                if (opts.previewVariablesFalla) return Promise.reject(opts.previewVariablesFalla);
                return Promise.resolve(
                    opts.previewVariables ?? { template: { id: 1, nombre: 'Plantilla', asunto: 'Asunto', variables: [] }, sugerencias: [] },
                );
            }),
        };
        return { service: new CuponService(prisma, bloqueo, cuponPdf, consolidacion, emailSender), prisma, emailSender };
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

    it('sin templateId: plantilla null y sin variablesSinValor, pero sí trae destinatariosDisponibles', async () => {
        const { service } = armarPreview({ contactosEmail: [{ id: 1, valor: 'a@b.com', prioridad: 1 }] });
        const res = await service.preview(CLAVE_QUITA.id, DEUDOR.id);
        expect(res.plantilla).toBeNull();
        expect(res.variablesSinValor).toEqual([]);
        expect(res.destinatariosDisponibles).toEqual([{ id: 1, valor: 'a@b.com', principal: true }]);
    });

    it('con templateId: arma variablesSinValor filtrando lo que la plantilla necesita y no tiene valor (ni automático ni propio del cupón)', async () => {
        const { service, emailSender } = armarPreview({
            previewVariables: {
                template: { id: 9, nombre: 'Cupón', asunto: 'Asunto', variables: ['nombre', 'importe_cupon', 'telefono_alternativo'] },
                sugerencias: [{ variable: 'nombre', valor: 'Juan', origen: 'auto' }],
            },
        });
        const res = await service.preview(CLAVE_QUITA.id, DEUDOR.id, 9);
        expect(emailSender.previewVariables).toHaveBeenCalledWith(DEUDOR.id, 9);
        expect(res.plantilla).toEqual({ id: 9, nombre: 'Cupón', asunto: 'Asunto' });
        // "nombre" e "importe_cupon" sí tienen valor (automático y propio del cupón); "telefono_alternativo" no.
        expect(res.variablesSinValor).toEqual(['telefono_alternativo']);
    });

    it('con templateId que ya no existe: no revienta la vista previa, sigue con plantilla null y avisa con plantillaError', async () => {
        const { service } = armarPreview({ previewVariablesFalla: new Error('Template id=9 no encontrado') });
        const res = await service.preview(CLAVE_QUITA.id, DEUDOR.id, 9);
        expect(res.plantilla).toBeNull();
        expect(res.puedeGenerar).toBe(true); // el resto de la vista previa sigue andando
        // Antes esto era indistinguible de "la plantilla no tiene variables sin valor" — el frontend
        // habilitaba Enviar con una plantilla que en realidad nunca se pudo validar (hallazgo §5).
        expect(res.plantillaError).toEqual(expect.stringContaining('ya no existe'));
        expect(res.variablesSinValor).toEqual([]);
    });

    it('sin templateId: plantillaError es null (no se pidió ninguna)', async () => {
        const { service } = armarPreview();
        const res = await service.preview(CLAVE_QUITA.id, DEUDOR.id);
        expect(res.plantillaError).toBeNull();
    });

    it('plantilla con variables riesgosas ({{saldo}}, {{importe}}): avisosPlantilla las señala, sin bloquear', async () => {
        const { service } = armarPreview({
            previewVariables: {
                template: { id: 9, nombre: 'Riesgosa', asunto: 'Asunto', variables: ['saldo', 'importe', 'nombre', 'importe_cupon'] },
                sugerencias: [{ variable: 'nombre', valor: 'Juan', origen: 'auto' }],
            },
        });
        const res = await service.preview(CLAVE_QUITA.id, DEUDOR.id, 9);
        expect(res.avisosPlantilla).toHaveLength(2); // saldo e importe, no nombre ni importe_cupon
        expect(res.avisosPlantilla.some((a: string) => a.includes('{{saldo}}'))).toBe(true);
        expect(res.avisosPlantilla.some((a: string) => a.includes('{{importe}}'))).toBe(true);
        expect(res.avisosPlantilla.some((a: string) => a.includes('importe_cupon'))).toBe(true); // sugiere la variable correcta
    });

    it('plantilla con {{deuda_actualizada}}: también es riesgosa (hallazgo de la auditoría — faltaba en la lista original)', async () => {
        const { service } = armarPreview({
            previewVariables: {
                template: { id: 9, nombre: 'Riesgosa2', asunto: 'Asunto', variables: ['deuda_actualizada', 'monto_total', 'importe_cupon'] },
                sugerencias: [],
            },
        });
        const res = await service.preview(CLAVE_QUITA.id, DEUDOR.id, 9);
        expect(res.avisosPlantilla).toHaveLength(2); // deuda_actualizada y monto_total, no importe_cupon
        expect(res.avisosPlantilla.some((a: string) => a.includes('{{deuda_actualizada}}'))).toBe(true);
        expect(res.avisosPlantilla.some((a: string) => a.includes('{{monto_total}}'))).toBe(true);
    });

    it('las variables riesgosas se derivan del CATALOG (esMontoDelCaso), no de una lista fija — agregar un canónico nuevo con esa marca alcanza', async () => {
        const { CATALOG } = require('../email-sender/variables-mapper');
        const marcados = CATALOG.filter((e: any) => e.esMontoDelCaso).map((e: any) => e.canon);
        expect(marcados.sort()).toEqual(['deuda', 'deuda_actualizada', 'monto_total', 'saldo']);
    });

    it('plantilla sin variables riesgosas: avisosPlantilla vacío', async () => {
        const { service } = armarPreview({
            previewVariables: {
                template: { id: 9, nombre: 'OK', asunto: 'Asunto', variables: ['nombre', 'importe_cupon', 'vencimiento_cupon'] },
                sugerencias: [{ variable: 'nombre', valor: 'Juan', origen: 'auto' }],
            },
        });
        const res = await service.preview(CLAVE_QUITA.id, DEUDOR.id, 9);
        expect(res.avisosPlantilla).toEqual([]);
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
        const emailSender: any = {};
        return { service: new CuponService(prisma, bloqueo, cuponPdf, consolidacion, emailSender), prisma, bloqueo, cuponPdf };
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
