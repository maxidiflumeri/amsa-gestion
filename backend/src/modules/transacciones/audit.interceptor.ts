// src/transacciones/audit.interceptor.ts
import {
    CallHandler, ExecutionContext, Injectable, NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { TransaccionesService } from './transacciones.service';

export interface AuditOptions {
    tipo: string;            // "CREATE" | "UPDATE" | "DELETE" | "SEND" | ...
    entidad: string;         // "Contacto" | "Comentario" | "Pago" | "Mail" | ...
    deudorIdParam?: string;  // nombre del param/body que contiene deudorId
    entidadIdFromResponse?: string; // propiedad del resultado para extraer ID creado
    resumen?: (result: any, req: any) => string | undefined; // generador opcional
    data?: (result: any, req: any) => any; // payload opcional
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
    constructor(private txService: TransaccionesService, private opts: AuditOptions) { }

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const http = context.switchToHttp();
        const req = http.getRequest();
        const usuarioId = req.user?.id ?? req.headers['x-user-id'] ?? 0; // adapta a tu auth
        const ip = req.ip;
        const userAgent = req.headers['user-agent'];

        return next.handle().pipe(
            tap(async (result) => {
                try {
                    const deudorId =
                        this.opts.deudorIdParam
                            ? Number(
                                req.params?.[this.opts.deudorIdParam] ??
                                req.body?.[this.opts.deudorIdParam] ??
                                req.query?.[this.opts.deudorIdParam]
                            ) || undefined
                            : undefined;

                    const entidadId =
                        this.opts.entidadIdFromResponse
                            ? String(result?.[this.opts.entidadIdFromResponse] ?? '')
                            : undefined;

                    const resumen = this.opts.resumen?.(result, req);
                    const data = this.opts.data?.(result, req);

                    await this.txService.registrar({
                        usuarioId: Number(usuarioId),
                        deudorId,
                        entidad: this.opts.entidad,
                        entidadId,
                        tipo: this.opts.tipo,
                        resumen,
                        data,
                        ip,
                        userAgent,
                    });
                } catch (e) {
                    // No romper flujo de negocio si el log falla
                    // console.error('Audit log failed', e);
                }
            }),
        );
    }
}  