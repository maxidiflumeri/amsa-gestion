import { HttpException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import axios, { AxiosInstance, AxiosResponse, isAxiosError } from 'axios';

export interface SenderSmtp {
    id: number;
    nombre: string;
    emailFrom: string;
    remitente: string;
}

export interface SenderTemplateListItem {
    id: number;
    nombre: string;
    asunto: string;
    cuentaSmtpId: number | null;
    variables: string[];
}

export interface SenderTemplateDetalle {
    id: number;
    nombre: string;
    asunto: string;
    html: string;
    cuentaSmtpId: number | null;
    variables: string[];
}

export interface SenderEnvioResult {
    ok: boolean;
    total: number;
    enviados: number;
    reporteIds: number[];
    errores?: { email: string; error: string }[];
}

export interface SenderReporteEstado {
    id: number;
    estado: string;
    asunto: string | null;
    destinatario: string | null;
    enviadoAt: string | null;
    creadoAt: string | null;
    error: string | null;
    aperturas: number;
    clics: number;
    rebote: { codigo: string | null; descripcion: string | null; fecha: string; correo: string | null } | null;
}

export interface SenderTimelineEntry {
    id: string;
    canal: 'whatsapp' | 'email' | 'wapi';
    tipo: string;
    fecha: string;
    detalle: {
        asunto?: string;
        mensaje?: string;
        templateNombre?: string;
        estado: string;
        error?: string;
        urlDestino?: string;
    };
    campaniaId: number | null;
    campaniaNombre: string | null;
    contactoId: number;
}

export interface SenderTimelineResponse {
    deudor: {
        id: number;
        idDeudor: number | null;
        nombre: string | null;
        documento: string | null;
        empresa: string | null;
        nroEmpresa: string | null;
    } | null;
    data: SenderTimelineEntry[];
    total: number;
    page: number;
    size: number;
    totalPages: number;
}

export interface SenderTimelineQuery {
    page?: number;
    size?: number;
    canal?: 'whatsapp' | 'email' | 'wapi';
    desde?: string;
    hasta?: string;
}

@Injectable()
export class SenderHttpClient implements OnModuleInit {
    private readonly logger = new Logger(SenderHttpClient.name);
    private http!: AxiosInstance;

    onModuleInit() {
        const baseURL = process.env.SENDER_BASE_URL;
        const apiKey = process.env.SENDER_INTERNAL_API_KEY;
        const timeout = Number(process.env.SENDER_TIMEOUT_MS ?? 30000);

        if (!baseURL || !apiKey) {
            this.logger.warn('SENDER_BASE_URL o SENDER_INTERNAL_API_KEY no configurados. Las llamadas a Sender van a fallar.');
        }

        this.http = axios.create({
            baseURL: baseURL ?? 'http://localhost:5001/api',
            timeout,
            headers: {
                'X-Internal-Api-Key': apiKey ?? '',
            },
        });
    }

    private handle<T>(p: Promise<AxiosResponse<T>>): Promise<T> {
        return p.then(r => r.data).catch(err => {
            if (isAxiosError(err)) {
                const status = err.response?.status ?? 502;
                const detalle = err.response?.data?.message ?? err.message;
                this.logger.warn(`Sender API error ${status}: ${typeof detalle === 'string' ? detalle : JSON.stringify(detalle)}`);
                throw new HttpException(
                    { message: `Error consultando AMSA Sender: ${detalle}`, sender: err.response?.data ?? null },
                    status >= 500 ? 502 : status,
                );
            }
            throw err;
        });
    }

    listarSmtps(): Promise<SenderSmtp[]> {
        return this.handle(this.http.get<SenderSmtp[]>('/internal/email/smtps'));
    }

    templatesPorSmtp(smtpId: number): Promise<SenderTemplateListItem[]> {
        return this.handle(this.http.get<SenderTemplateListItem[]>(`/internal/email/smtps/${smtpId}/templates`));
    }

    detalleTemplate(templateId: number): Promise<SenderTemplateDetalle> {
        return this.handle(this.http.get<SenderTemplateDetalle>(`/internal/email/templates/${templateId}`));
    }

    estadoReporte(reporteId: number): Promise<SenderReporteEstado> {
        return this.handle(this.http.get<SenderReporteEstado>(`/internal/email/reportes/${reporteId}`));
    }

    timelinePorDocumento(documento: string, query: SenderTimelineQuery = {}): Promise<SenderTimelineResponse> {
        const params: Record<string, any> = {};
        if (query.page !== undefined) params.page = query.page;
        if (query.size !== undefined) params.size = query.size;
        if (query.canal) params.canal = query.canal;
        if (query.desde) params.desde = query.desde;
        if (query.hasta) params.hasta = query.hasta;
        return this.handle(this.http.get<SenderTimelineResponse>(
            `/internal/timeline/por-documento/${encodeURIComponent(documento)}`,
            { params },
        ));
    }

    async enviarManual(params: {
        smtpId: number;
        templateId: number;
        destinatarios: string[];
        asunto?: string;
        variables: Record<string, string>;
        toNombre?: string;
        archivos: Array<{ originalname: string; buffer: Buffer; mimetype: string }>;
        deudorDocumento?: string;
    }): Promise<SenderEnvioResult> {
        const FormData = require('form-data');
        const form = new FormData();
        form.append('smtpId', String(params.smtpId));
        form.append('templateId', String(params.templateId));
        for (const email of params.destinatarios) form.append('to', email);
        if (params.asunto) form.append('subject', params.asunto);
        if (params.toNombre) form.append('toNombre', params.toNombre);
        if (params.deudorDocumento) form.append('deudorDocumento', params.deudorDocumento);
        form.append('variables', JSON.stringify(params.variables ?? {}));
        for (const f of params.archivos) {
            form.append('archivos', f.buffer, { filename: f.originalname, contentType: f.mimetype });
        }

        return this.handle(this.http.post<SenderEnvioResult>('/internal/email/manual/send', form, {
            headers: form.getHeaders(),
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
        }));
    }
}
