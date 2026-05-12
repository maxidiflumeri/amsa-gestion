export interface SmtpAccount {
    id: number
    nombre: string
    emailFrom: string
    remitente: string
}

export interface EmailTemplateListItem {
    id: number
    nombre: string
    asunto: string
    cuentaSmtpId: number | null
    variables: string[]
}

export interface EmailTemplateDetalle {
    id: number
    nombre: string
    asunto: string
    html: string
    variables: string[]
    cuentaSmtpId: number | null
}

export type VariableOrigen = 'auto' | 'campo_adicional' | 'manual' | 'mapeo_guardado' | 'literal'

export interface VariableSugerida {
    variable: string
    valor: string | null
    origen: VariableOrigen
    fuente?: string
}

export type FuenteTipo = 'campo_deudor' | 'campo_adicional' | 'literal'

export interface FuenteVariable {
    tipo: FuenteTipo
    clave: string
    label: string
}

export interface MapeoVariable {
    variable: string
    fuenteTipo: FuenteTipo
    fuenteClave: string
}

export interface MapeoVariableInput {
    variable: string
    fuenteTipo: FuenteTipo | null
    fuenteClave?: string | null
}

export interface DestinatarioDisponible {
    id: number
    valor: string
    principal: boolean
}

export interface PreviewVariablesResponse {
    template: EmailTemplateDetalle
    sugerencias: VariableSugerida[]
    destinatariosDisponibles: DestinatarioDisponible[]
}

export interface SmtpDeEmpresaResponse {
    empresa: { id: number; nombre: string }
    smtp: SmtpAccount | null
}

export interface TemplatesDeEmpresaResponse {
    smtpId: number | null
    templates: EmailTemplateListItem[]
}

export interface EnviarEmailResponse {
    envioId: number
    empresaId: number
    reporteIds: number[]
    ok: boolean
    enviados: number
    errores?: { email: string; error: string }[]
}

export interface EnvioEmail {
    id: number
    deudorId: number
    empresaId: number
    usuarioId: number
    smtpId: number
    templateId: number
    destinatarios: string
    asunto: string
    variables: Record<string, string>
    archivosNombres: string[]
    senderReporteIds: number[]
    estado: string
    error: string | null
    creadoAt: string
    usuario?: { id: number; nombre: string; email: string }
}

export interface ReporteEstado {
    id: number
    estado: string
    destinatario: string
    asunto: string
    fechaEnvio: string | null
    error: string | null
    eventos?: Array<{ tipo: string; timestamp: string; detalle?: string }>
}

export interface EstadoEnvioResponse {
    envio: EnvioEmail
    reportes: ReporteEstado[]
}
