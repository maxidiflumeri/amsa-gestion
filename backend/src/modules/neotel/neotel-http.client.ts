import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sanitizeParams } from 'src/common/logger/sanitize';
import { NeotelApiError, NeotelAuthError, NeotelTimeoutError } from './errors/neotel.errors';
import { XmlResponseParser } from './parsers/xml-response.parser';
import type {
    NeotelAddScheduleCallParams,
    NeotelCloseContactParams,
    NeotelCrmShowContactParams,
    NeotelDialParams,
    NeotelDtmfParams,
    NeotelEventsParams,
    NeotelLoginCampanaParams,
    NeotelLoginParams,
    NeotelLogoutCampanaParams,
    NeotelPauseParams,
    NeotelPositionRaw,
    NeotelTiempoAdminParams,
    NeotelTransferParams,
    NeotelUpdateContactParams,
} from './dto/neotel-http.dto';

interface CallOptions {
    timeoutMs?: number;
    retries?: number;
    expects?: 'void' | 'string' | 'boolean';
    /** Si true, no reintenta en error 4xx (errores de negocio, no transitorios) */
    noRetryOn4xx?: boolean;
}

@Injectable()
export class NeotelHttpClient implements OnModuleInit {
    private readonly logger = new Logger(NeotelHttpClient.name);

    private baseUrl!: string;
    private defaultTimeoutMs!: number;
    private defaultRetries!: number;

    constructor(private readonly config: ConfigService) {}

    onModuleInit() {
        const host = this.config.getOrThrow<string>('NEOTEL_API_HOST');
        this.baseUrl = host.endsWith('/')
            ? `${host}neoapi/webservice.asmx`
            : `${host}/neoapi/webservice.asmx`;

        this.defaultTimeoutMs = this.config.get<number>('NEOTEL_TIMEOUT_MS', 8000);
        this.defaultRetries   = this.config.get<number>('NEOTEL_RETRY_ATTEMPTS', 3);

        this.logger.log(`NeotelHttpClient inicializado → baseUrl=${this.baseUrl} timeout=${this.defaultTimeoutMs}ms retries=${this.defaultRetries}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MÉTODO CORE
    // ─────────────────────────────────────────────────────────────────────────

    private async call<T = void>(
        endpoint: string,
        params: Record<string, string | number | boolean>,
        options: CallOptions = {},
    ): Promise<T> {
        const {
            timeoutMs   = this.defaultTimeoutMs,
            retries     = this.defaultRetries,
            expects     = 'void',
            noRetryOn4xx = false,
        } = options;

        const url  = `${this.baseUrl}/${endpoint}`;
        const body = new URLSearchParams(
            Object.fromEntries(
                Object.entries(params).map(([k, v]) => [k, String(v)]),
            ),
        ).toString();

        const safeParams = sanitizeParams(params as Record<string, any>, ['CLAVE', 'DATA', 'XML_UPDATE']);
        this.logger.debug(`→ ${endpoint} params=${JSON.stringify(safeParams)}`);

        let lastError: Error = new NeotelTimeoutError(endpoint);

        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const controller = new AbortController();
                const timeoutId  = setTimeout(() => controller.abort(), timeoutMs);

                let res: Response;
                try {
                    res = await fetch(url, {
                        method:  'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body,
                        signal: controller.signal,
                    });
                } finally {
                    clearTimeout(timeoutId);
                }

                if (res.status === 401 || res.status === 403) {
                    throw new NeotelAuthError(endpoint);
                }

                if (!res.ok) {
                    const text = await res.text().catch(() => '');
                    const err  = new NeotelApiError(endpoint, res.status, text);

                    // Error 4xx de negocio: no reintentar
                    if (noRetryOn4xx && res.status < 500) throw err;
                    throw err;
                }

                const text = await res.text();
                this.logger.debug(`← ${endpoint} status=${res.status} body=${text.slice(0, 120)}`);

                return XmlResponseParser.parse<T>(text, expects);

            } catch (err) {
                if (err instanceof NeotelAuthError) throw err; // nunca reintentar auth errors

                lastError = err as Error;

                if (attempt < retries) {
                    const delayMs = Math.pow(2, attempt) * 150; // 300ms, 600ms
                    this.logger.warn(`Retry ${attempt}/${retries} en ${endpoint} (${lastError.message}) — esperando ${delayMs}ms`);
                    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
                } else {
                    this.logger.error(`Fallo definitivo en ${endpoint} tras ${retries} intentos: ${lastError.message}`);
                }
            }
        }

        // Si llegamos acá el error es de red/timeout/5xx
        if (lastError instanceof NeotelTimeoutError || lastError.name === 'AbortError') {
            throw new NeotelTimeoutError(endpoint);
        }
        throw new ServiceUnavailableException(`Neotel no disponible: ${lastError.message}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // §4.1 — AUTENTICACIÓN Y SESIÓN
    // ─────────────────────────────────────────────────────────────────────────

    async login(p: NeotelLoginParams): Promise<void> {
        await this.call('Login', {
            DEVICE:   p.device,
            USUARIO:  p.usuario,
            CLAVE:    p.clave,
        }, { noRetryOn4xx: true });
    }

    async logout(usuario: string): Promise<void> {
        await this.call('Logout', { USUARIO: usuario });
    }

    async validate(telefono: string, campana: number): Promise<boolean> {
        return this.call<boolean>('Validate', {
            TELEFONO: telefono,
            CAMPANA:  campana,
        }, { expects: 'boolean' });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // §4.2 — GESTIÓN DE CAMPAÑAS
    // ─────────────────────────────────────────────────────────────────────────

    async loginCampaign(p: NeotelLoginCampanaParams): Promise<void> {
        // Usar Login_Campaign2 (sin Ñ) — más seguro contra encoding
        await this.call('Login_Campaign2', {
            USUARIO: p.usuario,
            CAMPANA: p.campana,
        }, { noRetryOn4xx: true });
    }

    async logoutCampaign(p: NeotelLogoutCampanaParams): Promise<void> {
        // La API docs indica CAMPAÑA con Ñ; URLSearchParams lo encodea correctamente.
        // Si Neotel rechaza el encoding, cambiar la clave a 'CAMPANA' (como Login_Campaign2).
        const params: Record<string, string | number | boolean> = {
            USUARIO: p.usuario,
        };
        (params as Record<string, unknown>)['CAMPA\u00D1A'] = p.campaña;
        await this.call('Logout_Campaign', params as Record<string, string | number | boolean>);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // §4.3 — ESTADOS DEL AGENTE
    // ─────────────────────────────────────────────────────────────────────────

    async pause(p: NeotelPauseParams): Promise<void> {
        await this.call('Pause', {
            USUARIO:          p.usuario,
            SUBTIPO_DESCANSO: p.subtipoDescanso,
        }, { noRetryOn4xx: true });
    }

    async unpause(usuario: string): Promise<void> {
        await this.call('Unpause', { USUARIO: usuario }, { noRetryOn4xx: true });
    }

    async tiempoAdministrativo(p: NeotelTiempoAdminParams): Promise<void> {
        await this.call('Tiempo_Administrativo', {
            USUARIO:    p.usuario,
            TIEMPO_ADM: p.tiempoAdm,
        }, { noRetryOn4xx: true });
    }

    async crmAvailable(usuario: string): Promise<void> {
        await this.call('CRM_Available', { USUARIO: usuario });
    }

    async crmUnavailable(usuario: string): Promise<void> {
        await this.call('CRM_Unavailable', { USUARIO: usuario });
    }

    async position(usuario: string): Promise<NeotelPositionRaw> {
        return this.call<string>('Position', { USUARIO: usuario }, { expects: 'string' });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // §4.4 — CONTROL DE LLAMADA
    // ─────────────────────────────────────────────────────────────────────────

    async dial(p: NeotelDialParams): Promise<boolean> {
        return this.call<boolean>('Dial', {
            USUARIO:  p.usuario,
            TELEFONO: p.telefono,
        }, { expects: 'boolean', noRetryOn4xx: true });
    }

    async hangup(usuario: string): Promise<void> {
        await this.call('Hangup', { USUARIO: usuario });
    }

    async sendDtmf(p: NeotelDtmfParams): Promise<void> {
        await this.call('SendDTMF', {
            USUARIO: p.usuario,
            DIGITOS: p.digitos,
        });
    }

    async blindTransfer(p: NeotelTransferParams): Promise<void> {
        await this.call('BlindTransfer', {
            USUARIO:    p.usuario,
            EXTENSION:  p.extension,
        }, { noRetryOn4xx: true });
    }

    async attendedTransfer(p: NeotelTransferParams): Promise<void> {
        await this.call('AttendedTransfer', {
            USUARIO:   p.usuario,
            EXTENSION: p.extension,
        }, { noRetryOn4xx: true });
    }

    async iniciarGrabacion(usuario: string): Promise<void> {
        await this.call('Iniciar_Grabacion', { USUARIO: usuario });
    }

    async detenerGrabacion(usuario: string): Promise<void> {
        await this.call('Detener_Grabacion', { USUARIO: usuario });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // §4.6 — EVENTOS
    // ─────────────────────────────────────────────────────────────────────────

    async neotelEvents(p: NeotelEventsParams): Promise<string> {
        // TODO: confirmar con Neotel el formato exacto de eventInfo y la respuesta
        return this.call<string>('NeotelEvents', {
            eventInfo: p.eventInfo,
        }, { expects: 'string', timeoutMs: 5000 });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // §4.7 — GESTIÓN DE CONTACTOS (integración CRM)
    // ─────────────────────────────────────────────────────────────────────────

    async crmShowingContact(p: NeotelCrmShowContactParams): Promise<void> {
        await this.call('CRM_ShowingContact', {
            USUARIO:    p.usuario,
            BASE:       p.base,
            IDCONTACTO: p.idContacto,
            DATA:       p.data ?? '',
        });
    }

    async updateContact(p: NeotelUpdateContactParams): Promise<void> {
        const params: Record<string, string | number | boolean> = {
            CRM:          p.crm,
            USUARIO:      p.usuario,
            BASE:         p.base,
            IDCONTACTO:   p.idContacto,
            DATA:         p.data,
            SUBCATEGORIA: p.subcategoria,
            XML_UPDATE:   p.xmlUpdate ?? '',
            AGENDA:       p.agenda,
        };
        if (p.agenda && p.fechaAgenda)   params.FECHA_AGENDA   = p.fechaAgenda;
        if (p.agenda && p.usuarioAgenda) params.USUARIO_AGENDA  = p.usuarioAgenda;
        if (p.agenda && p.telAgenda)     params.TEL_AGENDA      = p.telAgenda;

        await this.call('UpdateContact', params, { noRetryOn4xx: true });
    }

    async closeContact(p: NeotelCloseContactParams): Promise<void> {
        await this.call('CloseContact', {
            BASE:       p.base,
            IDCONTACTO: p.idContacto,
        });
    }

    async addScheduleCall(p: NeotelAddScheduleCallParams): Promise<string> {
        return this.call<string>('AddScheduleCall', {
            USUARIO:      p.usuario,
            BASE:         p.base,
            IDCONTACTO:   p.idContacto,
            DATA:         p.data ?? '',
            TELEFONO:     p.telefono,
            FECHA_AGENDA: p.fechaAgenda,
        }, { expects: 'string', noRetryOn4xx: true });
    }

}
