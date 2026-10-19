import { Injectable, Logger } from '@nestjs/common';
import { AnthropicBedrock, AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';
import { ClienteAnthropic, ClienteBedrock, ClienteModelo } from './cliente-modelo';
import { leerModeloReportes, leerTimeoutReportes } from '../reportes/funcion-reportes';

export type EndpointBedrock = 'runtime' | 'mantle';

export const MODELO_DEFAULT = 'us.anthropic.claude-haiku-5-5';
export const REGION_DEFAULT = 'us-east-1';

/**
 * Construye el cliente de Bedrock (docs/asistente-spec.md §3 y §14). Las credenciales salen de la cadena por defecto
 * de AWS: el rol de la EC2 en prod, `AWS_PROFILE` en local. No llama a Bedrock al arrancar y nunca loguea credenciales.
 */
@Injectable()
export class AsistenteModeloService {
    private readonly logger = new Logger(AsistenteModeloService.name);

    readonly modelo: string;
    /** El modelo de la función de reportes (Fase B). */
    readonly modeloReportes: string;
    readonly timeoutReportesMs: number;
    readonly endpoint: EndpointBedrock;
    readonly region: string;
    private _cliente: ClienteModelo | null = null;

    constructor() {
        this.modelo = (process.env.ASISTENTE_MODELO ?? '').trim() || MODELO_DEFAULT;
        this.modeloReportes = leerModeloReportes();
        this.timeoutReportesMs = leerTimeoutReportes();
        this.region = (process.env.ASISTENTE_AWS_REGION ?? '').trim() || REGION_DEFAULT;
        const raw = (process.env.ASISTENTE_BEDROCK_ENDPOINT ?? '').trim().toLowerCase();
        if (raw && raw !== 'runtime' && raw !== 'mantle') {
            this.logger.warn(`ASISTENTE_BEDROCK_ENDPOINT="${raw}" no es runtime ni mantle; se usa runtime`);
        }
        this.endpoint = raw === 'mantle' ? 'mantle' : 'runtime';
        this.logger.log(
            `Asistente listo: modelo=${this.modelo} reportes=${this.modeloReportes} endpoint=${this.endpoint} región=${this.region}`,
        );
    }

    /** El modelo de cada función: el cliente es uno solo, el modelo va en cada request. */
    modeloPara(funcion: string): string {
        return funcion === 'reportes' ? this.modeloReportes : this.modelo;
    }

    /** `strict: true` en las herramientas solo existe en bedrock-runtime. */
    get soportaStrict(): boolean {
        return this.endpoint === 'runtime';
    }

    cliente(): ClienteModelo {
        if (!this._cliente) {
            const opciones = { awsRegion: this.region, maxRetries: 2, timeout: 60_000 };
            const sdk =
                this.endpoint === 'mantle'
                    ? new AnthropicBedrockMantle({ ...opciones, awsProfile: process.env.AWS_PROFILE || undefined })
                    : new AnthropicBedrock(opciones);
            this._cliente = new ClienteBedrock(sdk as unknown as ClienteAnthropic);
        }
        return this._cliente;
    }
}
