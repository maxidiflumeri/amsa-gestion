import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post, Put, Req, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { EmailSenderService } from './email-sender.service';
import { PreviewVarsDto } from './dtos/preview-vars.dto';
import { AsignarSmtpDto } from './dtos/asignar-smtp.dto';
import { Permisos } from '../../auth/decorators';
import { Audit } from '../transacciones/audit.decorator';
import { AuditModulo, AuditTipo } from '../transacciones/audit.enums';

@Controller('email')
export class EmailSenderController {
    constructor(private readonly service: EmailSenderService) { }

    @Get('smtps')
    @Permisos('email.administrar')
    listarSmtps() {
        return this.service.listarSmtpsDisponibles();
    }

    @Get('empresa/:id/smtp')
    @Permisos('email.enviar')
    smtpEmpresa(@Param('id', ParseIntPipe) id: number) {
        return this.service.smtpDeEmpresa(id);
    }

    @Get('empresa/:id/templates')
    @Permisos('email.enviar')
    templates(@Param('id', ParseIntPipe) id: number) {
        return this.service.templatesDeEmpresa(id);
    }

    @Get('templates/:id/preview')
    @Permisos('email.enviar')
    preview(@Param('id', ParseIntPipe) id: number) {
        return this.service.previewTemplate(id);
    }

    @Post('deudores/:id/preview-vars')
    @Permisos('email.enviar')
    previewVars(@Param('id', ParseIntPipe) deudorId: number, @Body() dto: PreviewVarsDto) {
        if (!dto?.templateId) throw new BadRequestException('templateId requerido');
        return this.service.previewVariables(deudorId, Number(dto.templateId));
    }

    @Post('deudores/:id/enviar')
    @Permisos('email.enviar')
    @UseInterceptors(FilesInterceptor('archivos', 10, {
        storage: memoryStorage(),
        limits: { fileSize: 10 * 1024 * 1024 },
    }))
    @Audit({
        modulo: AuditModulo.EMAIL,
        entidad: 'deudor',
        tipo: AuditTipo.EMAIL_ENVIADO,
        entidadIdFromResponse: 'envioId',
        empresaId: (res) => res?.empresaId ?? null,
        resumen: (res, req) => {
            const destinatarios = req.body?.destinatarios;
            const listado = typeof destinatarios === 'string' ? destinatarios : Array.isArray(destinatarios) ? destinatarios.join(', ') : '';
            const ok = res?.ok ? 'OK' : 'FAIL';
            return `Email a deudor ${req.params.id} [${ok}] template=${req.body?.templateId} dest=${listado}`;
        },
        data: (_res, req) => ({
            params: {
                templateId: req.body?.templateId,
                destinatarios: req.body?.destinatarios,
                archivosNombres: (req.files ?? []).map((f: any) => f.originalname),
            },
        }),
    })
    async enviar(
        @Param('id', ParseIntPipe) deudorId: number,
        @Body() body: any,
        @UploadedFiles() archivos: any[],
        @Req() req: any,
    ) {
        if (!body?.templateId) throw new BadRequestException('templateId requerido');

        const destinatariosRaw = body.destinatarios;
        let destinatarios: string[];
        if (Array.isArray(destinatariosRaw)) destinatarios = destinatariosRaw;
        else if (typeof destinatariosRaw === 'string') {
            const trim = destinatariosRaw.trim();
            if (trim.startsWith('[')) {
                try { destinatarios = JSON.parse(trim); } catch { destinatarios = trim.split(',').map(s => s.trim()).filter(Boolean); }
            } else {
                destinatarios = trim.split(',').map(s => s.trim()).filter(Boolean);
            }
        } else destinatarios = [];

        let variables: Record<string, string> = {};
        if (body.variables) {
            try {
                variables = typeof body.variables === 'string' ? JSON.parse(body.variables) : body.variables;
            } catch {
                throw new BadRequestException('variables debe ser JSON válido');
            }
        }

        return this.service.enviar({
            deudorId,
            usuarioId: req['usuario']?.sub ?? req['usuario']?.id,
            templateId: Number(body.templateId),
            destinatarios,
            asunto: body.asunto ?? undefined,
            variables,
            archivos: archivos ?? [],
        });
    }

    @Get('deudores/:id/envios')
    @Permisos('email.enviar')
    listarEnvios(@Param('id', ParseIntPipe) deudorId: number) {
        return this.service.listarEnviosDeudor(deudorId);
    }

    @Get('envios/:id/estado')
    @Permisos('email.enviar')
    estado(@Param('id', ParseIntPipe) envioId: number) {
        return this.service.refrescarEstado(envioId);
    }

    @Get('empresas/:id/fuentes-variables')
    @Permisos('email.enviar')
    fuentes(@Param('id', ParseIntPipe) empresaId: number) {
        return this.service.fuentesDeEmpresa(empresaId);
    }

    @Get('templates/:id/mapeos')
    @Permisos('email.enviar')
    obtenerMapeos(@Param('id', ParseIntPipe) templateId: number) {
        return this.service.obtenerMapeosTemplate(templateId);
    }

    @Put('templates/:id/mapeos')
    @Permisos('email.enviar')
    @Audit({
        modulo: AuditModulo.EMAIL,
        entidad: 'template',
        tipo: AuditTipo.EMAIL_MAPEO_GUARDADO,
        entidadIdParam: 'id',
        resumen: (_res, req) => `Mapeos variables template ${req.params.id}: ${(req.body?.mapeos ?? []).length} entradas`,
        data: (_res, req) => ({ params: { mapeos: req.body?.mapeos } }),
    })
    guardarMapeos(
        @Param('id', ParseIntPipe) templateId: number,
        @Body() body: { mapeos: { variable: string; fuenteTipo: string | null; fuenteClave?: string | null }[] },
        @Req() req: any,
    ) {
        if (!Array.isArray(body?.mapeos)) throw new BadRequestException('mapeos requerido');
        const usuarioId = req['usuario']?.sub ?? req['usuario']?.id;
        return this.service.guardarMapeosTemplate(templateId, body.mapeos as any, usuarioId);
    }

    @Put('empresas/:id/smtp')
    @Permisos('email.administrar')
    @Audit({
        modulo: AuditModulo.EMAIL,
        entidad: 'empresa',
        tipo: AuditTipo.EMPRESA_SMTP_CAMBIADO,
        empresaId: (_res, req) => Number(req.params.id),
        resumen: (_res, req) => `Asignó SMTP id=${req.body?.cuentaSmtpId ?? 'null'} a empresa ${req.params.id}`,
        data: (_res, req) => ({ params: { cuentaSmtpId: req.body?.cuentaSmtpId } }),
    })
    asignarSmtp(@Param('id', ParseIntPipe) empresaId: number, @Body() dto: AsignarSmtpDto) {
        return this.service.asignarSmtpEmpresa(empresaId, dto.cuentaSmtpId);
    }
}
