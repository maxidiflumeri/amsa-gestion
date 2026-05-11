import {
    CallHandler,
    ExecutionContext,
    Injectable,
    Logger,
    NestInterceptor,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Observable, catchError, from, of, switchMap, tap, throwError } from 'rxjs';
import { TransaccionesService } from './transacciones.service';
import {
    AuditData,
    AuditEstado,
    AuditModulo,
    AuditSeveridad,
    AuditTipo,
    redactarCamposSensibles,
} from './audit.enums';

export interface AuditOptions {
    modulo?: AuditModulo | string;
    entidad: string;
    tipo: AuditTipo | string;
    severidad?: AuditSeveridad | string;

    deudorIdParam?: string;
    entidadIdParam?: string;
    entidadIdFromResponse?: string;
    empresaIdParam?: string;

    before?: (req: any) => Promise<any> | any;
    recursoTexto?: (result: any, req: any) => string | undefined;
    resumen?: (result: any, req: any) => string | undefined;
    data?: (result: any, req: any) => AuditData | undefined;
    empresaId?: (result: any, req: any) => number | null | undefined;
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
    private readonly logger = new Logger(AuditInterceptor.name);
    private txService: TransaccionesService;
    protected opts: AuditOptions;

    constructor(private moduleRef: ModuleRef) { }

    setOptions(opts: AuditOptions) {
        this.opts = opts;
        return this;
    }

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        if (!this.txService) {
            this.txService = this.moduleRef.get(TransaccionesService, { strict: false });
        }

        const http = context.switchToHttp();
        const req = http.getRequest();
        const usuarioId: number | null = req?.usuario?.sub ?? null;
        const ip: string | null = req?.ip ?? null;
        const userAgent: string | null = req?.headers?.['user-agent'] ?? null;

        // Capturar snapshot "before" antes de la mutación (UPDATE/DELETE)
        const beforePromise: Promise<any> = this.opts.before
            ? Promise.resolve(this.opts.before(req)).catch((e) => {
                this.logger.warn(`before() hook falló: ${e?.message}`);
                return undefined;
            })
            : Promise.resolve(undefined);

        return from(beforePromise).pipe(
            switchMap((beforeData) =>
                next.handle().pipe(
                    tap((result) => {
                        this.registrar({
                            estado: AuditEstado.OK,
                            severidad: (this.opts.severidad as any) ?? AuditSeveridad.INFO,
                            beforeData,
                            result,
                            req,
                            usuarioId,
                            ip,
                            userAgent,
                        }).catch((e) => this.logger.error(`Auditoría OK falló: ${e?.message}`));
                    }),
                    catchError((err) => {
                        this.registrar({
                            estado: AuditEstado.FALLIDO,
                            severidad: AuditSeveridad.ERROR,
                            beforeData,
                            result: undefined,
                            req,
                            usuarioId,
                            ip,
                            userAgent,
                            errorMsg: err?.message,
                        }).catch((e) => this.logger.error(`Auditoría FAIL falló: ${e?.message}`));
                        return throwError(() => err);
                    }),
                ),
            ),
        );
    }

    private async registrar(p: {
        estado: AuditEstado;
        severidad: AuditSeveridad | string;
        beforeData: any;
        result: any;
        req: any;
        usuarioId: number | null;
        ip: string | null;
        userAgent: string | null;
        errorMsg?: string;
    }) {
        const { opts } = this;
        const { req, result, beforeData, estado, severidad, usuarioId, ip, userAgent, errorMsg } = p;

        const deudorId = opts.deudorIdParam
            ? Number(
                req?.params?.[opts.deudorIdParam] ??
                req?.body?.[opts.deudorIdParam] ??
                req?.query?.[opts.deudorIdParam],
            ) || undefined
            : result?.deudorId ?? undefined;

        const entidadId =
            (opts.entidadIdFromResponse && result?.[opts.entidadIdFromResponse] != null
                ? String(result[opts.entidadIdFromResponse])
                : undefined) ??
            (opts.entidadIdParam
                ? String(req?.params?.[opts.entidadIdParam] ?? req?.body?.[opts.entidadIdParam] ?? '') ||
                  undefined
                : undefined);

        const empresaId = opts.empresaIdParam
            ? Number(
                req?.params?.[opts.empresaIdParam] ??
                req?.body?.[opts.empresaIdParam] ??
                req?.query?.[opts.empresaIdParam],
            ) || undefined
            : opts.empresaId
                ? (opts.empresaId(result, req) ?? undefined)
                : undefined;

        const resumen = (() => {
            try { return opts.resumen?.(result, req); } catch { return undefined; }
        })();
        const recursoTexto = (() => {
            try { return opts.recursoTexto?.(result, req); } catch { return undefined; }
        })();

        let userData: AuditData | undefined;
        try { userData = opts.data?.(result, req); } catch { userData = undefined; }

        const data: AuditData = {
            ...(userData ?? {}),
            ...(beforeData !== undefined && !userData?.before ? { before: beforeData } : {}),
            ...(errorMsg ? { contexto: { ...(userData?.contexto ?? {}), error: errorMsg } } : {}),
        };

        const dataSafe = redactarCamposSensibles(data);

        const moduloInferido = opts.modulo
            ?? (deudorId != null ? AuditModulo.GESTION : AuditModulo.SISTEMA);

        await this.txService.registrar({
            usuarioId,
            empresaId: empresaId ?? null,
            modulo: String(moduloInferido),
            entidad: opts.entidad,
            entidadId,
            tipo: String(opts.tipo),
            severidad: String(severidad ?? AuditSeveridad.INFO),
            estado: String(estado),
            deudorId,
            recursoTexto,
            resumen,
            data: Object.keys(dataSafe).length ? dataSafe : undefined,
            ip: ip ?? undefined,
            userAgent: userAgent ?? undefined,
        });
    }
}
