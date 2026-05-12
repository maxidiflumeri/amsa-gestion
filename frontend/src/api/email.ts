import api from './axios'
import type {
    SmtpAccount,
    SmtpDeEmpresaResponse,
    TemplatesDeEmpresaResponse,
    EmailTemplateDetalle,
    PreviewVariablesResponse,
    EnviarEmailResponse,
    EnvioEmail,
    EstadoEnvioResponse,
    FuenteVariable,
    MapeoVariable,
    MapeoVariableInput,
} from '../types/email'

export const emailApi = {
    listarSmtps(): Promise<SmtpAccount[]> {
        return api.get('/email/smtps').then((r) => r.data)
    },

    smtpDeEmpresa(empresaId: number): Promise<SmtpDeEmpresaResponse> {
        return api.get(`/email/empresa/${empresaId}/smtp`).then((r) => r.data)
    },

    templatesDeEmpresa(empresaId: number): Promise<TemplatesDeEmpresaResponse> {
        return api.get(`/email/empresa/${empresaId}/templates`).then((r) => r.data)
    },

    previewTemplate(templateId: number): Promise<EmailTemplateDetalle> {
        return api.get(`/email/templates/${templateId}/preview`).then((r) => r.data)
    },

    previewVariables(deudorId: number, templateId: number): Promise<PreviewVariablesResponse> {
        return api
            .post(`/email/deudores/${deudorId}/preview-vars`, { templateId })
            .then((r) => r.data)
    },

    enviar(params: {
        deudorId: number
        templateId: number
        destinatarios: string[]
        asunto?: string
        variables: Record<string, string>
        archivos: File[]
    }): Promise<EnviarEmailResponse> {
        const form = new FormData()
        form.append('templateId', String(params.templateId))
        form.append('destinatarios', JSON.stringify(params.destinatarios))
        if (params.asunto) form.append('asunto', params.asunto)
        form.append('variables', JSON.stringify(params.variables))
        for (const f of params.archivos) form.append('archivos', f, f.name)
        return api
            .post(`/email/deudores/${params.deudorId}/enviar`, form, {
                headers: { 'Content-Type': 'multipart/form-data' },
            })
            .then((r) => r.data)
    },

    listarEnviosDeudor(deudorId: number): Promise<EnvioEmail[]> {
        return api.get(`/email/deudores/${deudorId}/envios`).then((r) => r.data)
    },

    estadoEnvio(envioId: number): Promise<EstadoEnvioResponse> {
        return api.get(`/email/envios/${envioId}/estado`).then((r) => r.data)
    },

    asignarSmtp(empresaId: number, cuentaSmtpId: number | null): Promise<{ empresaId: number; cuentaSmtpId: number | null }> {
        return api
            .put(`/email/empresas/${empresaId}/smtp`, { cuentaSmtpId })
            .then((r) => r.data)
    },

    fuentesDeEmpresa(empresaId: number): Promise<FuenteVariable[]> {
        return api.get(`/email/empresas/${empresaId}/fuentes-variables`).then((r) => r.data)
    },

    mapeosDeTemplate(templateId: number): Promise<MapeoVariable[]> {
        return api.get(`/email/templates/${templateId}/mapeos`).then((r) => r.data)
    },

    guardarMapeosTemplate(templateId: number, mapeos: MapeoVariableInput[]): Promise<{ guardados: number; eliminados: number }> {
        return api.put(`/email/templates/${templateId}/mapeos`, { mapeos }).then((r) => r.data)
    },
}
