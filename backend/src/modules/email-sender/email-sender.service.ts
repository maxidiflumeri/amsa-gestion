import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SenderHttpClient, SenderTemplateDetalle, SenderTemplateListItem, SenderSmtp, SenderReporteEstado, SenderEnvioResult } from './sender-http.client';
import { autoMapearVariables, DeudorParaMapper, MapeoGuardado, VariableSugerida, listarFuentesCatalogo } from './variables-mapper';

export interface FuenteVariableDisponible {
    tipo: 'campo_deudor' | 'campo_adicional' | 'literal';
    clave: string;
    label: string;
}

export interface MapeoVariableInput {
    variable: string;
    fuenteTipo: 'campo_deudor' | 'campo_adicional' | 'literal' | null;
    fuenteClave?: string | null;
}

interface DeudorConRelaciones extends DeudorParaMapper {
    empresaId: number;
    contactos: Array<{ id: number; tipo: string; valor: string; prioridad: number | null }>;
}

@Injectable()
export class EmailSenderService {
    private readonly logger = new Logger(EmailSenderService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly sender: SenderHttpClient,
    ) { }

    private async cargarDeudor(deudorId: number): Promise<DeudorConRelaciones> {
        const deudor = await this.prisma.deudor.findUnique({
            where: { id: deudorId },
            include: {
                empresa: { select: { id: true, nombre: true, cuentaSmtpId: true } },
                remesa: { select: { id: true, nombre: true } },
                estadoSituacion: { select: { descripcion: true } },
                estadoGestion: { select: { descripcion: true } },
                motivoNoPago: { select: { descripcion: true } },
                contactos: {
                    where: { tipo: 'email' },
                    select: { id: true, tipo: true, valor: true, prioridad: true },
                    orderBy: [{ prioridad: 'asc' }, { id: 'asc' }],
                },
            },
        });
        if (!deudor) throw new NotFoundException(`Deudor id=${deudorId} no encontrado`);
        return deudor as any;
    }

    private async cargarEmpresaConSmtp(empresaId: number) {
        const empresa = await this.prisma.empresa.findUnique({
            where: { id: empresaId },
            select: { id: true, nombre: true, cuentaSmtpId: true },
        });
        if (!empresa) throw new NotFoundException(`Empresa id=${empresaId} no encontrada`);
        return empresa;
    }

    async smtpDeEmpresa(empresaId: number): Promise<{ empresa: { id: number; nombre: string }; smtp: SenderSmtp | null }> {
        const empresa = await this.cargarEmpresaConSmtp(empresaId);
        if (empresa.cuentaSmtpId == null) {
            return { empresa: { id: empresa.id, nombre: empresa.nombre }, smtp: null };
        }
        const smtps = await this.sender.listarSmtps();
        const smtp = smtps.find(s => s.id === empresa.cuentaSmtpId) ?? null;
        return { empresa: { id: empresa.id, nombre: empresa.nombre }, smtp };
    }

    async templatesDeEmpresa(empresaId: number): Promise<{ smtpId: number | null; templates: SenderTemplateListItem[] }> {
        const empresa = await this.cargarEmpresaConSmtp(empresaId);
        if (empresa.cuentaSmtpId == null) {
            throw new BadRequestException(`La empresa ${empresa.nombre} no tiene cuenta SMTP asignada`);
        }
        const templates = await this.sender.templatesPorSmtp(empresa.cuentaSmtpId);
        return { smtpId: empresa.cuentaSmtpId, templates };
    }

    async previewTemplate(templateId: number): Promise<SenderTemplateDetalle> {
        return this.sender.detalleTemplate(templateId);
    }

    async previewVariables(deudorId: number, templateId: number): Promise<{
        template: SenderTemplateDetalle;
        sugerencias: VariableSugerida[];
        destinatariosDisponibles: Array<{ id: number; valor: string; principal: boolean }>;
    }> {
        const [deudor, template] = await Promise.all([
            this.cargarDeudor(deudorId),
            this.sender.detalleTemplate(templateId),
        ]);

        const mapeosGuardados = await this.cargarMapeosTemplate(templateId);
        const sugerencias = autoMapearVariables(template.variables, deudor, mapeosGuardados);
        const destinatarios = deudor.contactos.map(c => ({
            id: c.id,
            valor: c.valor,
            principal: c.prioridad === 1,
        }));

        return { template, sugerencias, destinatariosDisponibles: destinatarios };
    }

    private async cargarMapeosTemplate(templateId: number): Promise<MapeoGuardado[]> {
        const filas = await this.prisma.email_template_variable_mapeo.findMany({
            where: { templateId },
            select: { variable: true, fuenteTipo: true, fuenteClave: true },
        });
        return filas.map(f => ({
            variable: f.variable,
            fuenteTipo: f.fuenteTipo as 'campo_deudor' | 'campo_adicional' | 'literal',
            fuenteClave: f.fuenteClave,
        }));
    }

    async obtenerMapeosTemplate(templateId: number): Promise<MapeoGuardado[]> {
        return this.cargarMapeosTemplate(templateId);
    }

    async guardarMapeosTemplate(
        templateId: number,
        mapeos: MapeoVariableInput[],
        usuarioId: number,
    ): Promise<{ guardados: number; eliminados: number }> {
        let guardados = 0;
        let eliminados = 0;
        for (const m of mapeos) {
            if (!m.fuenteTipo) {
                const res = await this.prisma.email_template_variable_mapeo.deleteMany({
                    where: { templateId, variable: m.variable },
                });
                eliminados += res.count;
                continue;
            }
            await this.prisma.email_template_variable_mapeo.upsert({
                where: { templateId_variable: { templateId, variable: m.variable } },
                create: {
                    templateId,
                    variable: m.variable,
                    fuenteTipo: m.fuenteTipo,
                    fuenteClave: m.fuenteClave ?? '',
                    usuarioId,
                },
                update: {
                    fuenteTipo: m.fuenteTipo,
                    fuenteClave: m.fuenteClave ?? '',
                    usuarioId,
                },
            });
            guardados += 1;
        }
        return { guardados, eliminados };
    }

    async fuentesDeEmpresa(empresaId: number): Promise<FuenteVariableDisponible[]> {
        await this.cargarEmpresaConSmtp(empresaId);
        const fuentesCatalogo = listarFuentesCatalogo();

        const muestra = await this.prisma.deudor.findMany({
            where: { empresaId },
            select: { camposAdicionales: true },
            orderBy: { id: 'desc' },
            take: 500,
        });
        const keys = new Set<string>();
        for (const d of muestra) {
            const ca = d.camposAdicionales as any;
            if (ca && typeof ca === 'object') {
                for (const k of Object.keys(ca)) keys.add(k);
            }
        }
        const fuentesAdicionales: FuenteVariableDisponible[] = Array.from(keys)
            .sort((a, b) => a.localeCompare(b))
            .map(k => ({ tipo: 'campo_adicional' as const, clave: k, label: k }));

        return [...fuentesCatalogo, ...fuentesAdicionales];
    }

    async enviar(params: {
        deudorId: number;
        usuarioId: number;
        templateId: number;
        destinatarios: string[];
        asunto?: string;
        variables: Record<string, string>;
        archivos: any[];
    }): Promise<{ envioId: number; empresaId: number; reporteIds: number[]; ok: boolean; enviados: number; errores?: { email: string; error: string }[]; omitidos?: { email: string; motivo: string }[] }> {
        const { deudorId, usuarioId, templateId, destinatarios, asunto, variables, archivos } = params;

        if (!destinatarios.length) throw new BadRequestException('Indicá al menos un destinatario.');
        this.logger.log(`Enviando email templateId=${templateId} destinatarios=${destinatarios.length} deudorId=${deudorId}`);

        const deudor = await this.cargarDeudor(deudorId);
        const empresa = await this.cargarEmpresaConSmtp(deudor.empresaId);
        if (empresa.cuentaSmtpId == null) {
            throw new BadRequestException(`La empresa ${empresa.nombre} no tiene cuenta SMTP asignada`);
        }

        let resultado: SenderEnvioResult;
        try {
            resultado = await this.sender.enviarManual({
                smtpId: empresa.cuentaSmtpId,
                templateId,
                destinatarios,
                asunto,
                variables,
                toNombre: `${deudor.nombre} ${deudor.apellido}`.trim() || undefined,
                archivos: archivos.map(a => ({ originalname: a.originalname, buffer: a.buffer, mimetype: a.mimetype })),
                deudorDocumento: (deudor as any).documento?.trim() || undefined,
            });
        } catch (err: any) {
            const envio = await this.prisma.envio_email.create({
                data: {
                    deudorId,
                    empresaId: deudor.empresaId,
                    usuarioId,
                    smtpId: empresa.cuentaSmtpId,
                    templateId,
                    destinatarios: destinatarios.join(', '),
                    asunto: asunto ?? '',
                    variables,
                    archivosNombres: archivos.map(a => a.originalname),
                    senderReporteIds: [],
                    estado: 'ERROR',
                    error: String(err?.message ?? err),
                },
            });
            this.logger.error(`Envío email FAIL templateId=${templateId} deudorId=${deudorId}: ${err?.message}`, err?.stack);
            return { envioId: envio.id, empresaId: deudor.empresaId, reporteIds: [], ok: false, enviados: 0, errores: [{ email: destinatarios[0], error: String(err?.message ?? err) }] };
        }

        const envio = await this.prisma.envio_email.create({
            data: {
                deudorId,
                empresaId: deudor.empresaId,
                usuarioId,
                smtpId: empresa.cuentaSmtpId,
                templateId,
                destinatarios: destinatarios.join(', '),
                asunto: asunto ?? '',
                variables,
                archivosNombres: archivos.map(a => a.originalname),
                senderReporteIds: resultado.reporteIds,
                estado: resultado.ok ? 'ENVIADO' : 'ERROR',
                error: resultado.errores ? JSON.stringify(resultado.errores) : null,
            },
        });

        return {
            envioId: envio.id,
            empresaId: deudor.empresaId,
            reporteIds: resultado.reporteIds,
            ok: resultado.ok,
            enviados: resultado.enviados,
            errores: resultado.errores,
            omitidos: resultado.omitidos,
        };
    }

    async listarEnviosDeudor(deudorId: number) {
        return this.prisma.envio_email.findMany({
            where: { deudorId },
            orderBy: { creadoAt: 'desc' },
            include: {
                usuario: { select: { id: true, nombre: true, email: true } },
            },
        });
    }

    async refrescarEstado(envioId: number): Promise<{
        envio: any;
        reportes: SenderReporteEstado[];
    }> {
        const envio = await this.prisma.envio_email.findUnique({ where: { id: envioId } });
        if (!envio) throw new NotFoundException(`Envío id=${envioId} no encontrado`);

        const reporteIds = Array.isArray(envio.senderReporteIds) ? (envio.senderReporteIds as number[]) : [];
        const reportes: SenderReporteEstado[] = [];
        for (const id of reporteIds) {
            try {
                const r = await this.sender.estadoReporte(id);
                reportes.push(r);
            } catch (err: any) {
                this.logger.warn(`No pude obtener reporte ${id}: ${err?.message}`);
            }
        }
        return { envio, reportes };
    }

    async asignarSmtpEmpresa(empresaId: number, cuentaSmtpId: number | null): Promise<{ empresaId: number; cuentaSmtpId: number | null }> {
        const empresa = await this.prisma.empresa.findUnique({ where: { id: empresaId }, select: { id: true } });
        if (!empresa) throw new NotFoundException(`Empresa id=${empresaId} no encontrada`);

        if (cuentaSmtpId != null) {
            const smtps = await this.sender.listarSmtps();
            const existe = smtps.find(s => s.id === cuentaSmtpId);
            if (!existe) throw new BadRequestException(`SMTP id=${cuentaSmtpId} no existe en Sender`);
        }

        await this.prisma.empresa.update({
            where: { id: empresaId },
            data: { cuentaSmtpId },
        });

        return { empresaId, cuentaSmtpId };
    }

    async listarSmtpsDisponibles(): Promise<SenderSmtp[]> {
        return this.sender.listarSmtps();
    }
}
