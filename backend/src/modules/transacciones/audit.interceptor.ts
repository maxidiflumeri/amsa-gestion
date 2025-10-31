import {
    CallHandler,
    ExecutionContext,
    Injectable,
    NestInterceptor,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { TransaccionesService } from './transacciones.service';

export interface AuditOptions {
    tipo: string;                 // "CREATE" | "UPDATE" | "DELETE" | ...
    entidad: string;              // "Contacto", "Comentario", "Deudor", ...
    deudorIdParam?: string;       // nombre del param/body con el deudorId
    entidadIdFromResponse?: string; // propiedad del resultado para extraer el ID creado
    resumen?: (result: any, req: any) => string | undefined; // texto legible
    data?: (result: any, req: any) => any; // payload adicional
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
    private txService: TransaccionesService;
    private opts: AuditOptions;

    constructor(private moduleRef: ModuleRef) { }

    /**
     * Método para inicializar el interceptor con opciones dinámicas
     */
    setOptions(opts: AuditOptions) {
        this.opts = opts;
        return this;
    }

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        // Lazy resolve del servicio
        if (!this.txService) {
            this.txService = this.moduleRef.get(TransaccionesService, { strict: false });
        }

        const http = context.switchToHttp();
        const req = http.getRequest();
        const usuarioId = req.user?.id ?? 1; // valor default por ahora
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
                                req.query?.[this.opts.deudorIdParam],
                            ) || undefined
                            : result?.deudorId ?? undefined; // 👈 fallback automático

                    const entidadId =
                        this.opts.entidadIdFromResponse
                            ? String(result?.[this.opts.entidadIdFromResponse] ?? '')
                            : undefined;

                    const resumen = this.opts.resumen?.(result, req);
                    const data = this.opts.data?.(result, req);

                    await this.txService.registrar({
                        usuarioId,
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
                    console.error('❌ Error al registrar transacción:', e);
                }
            }),
        );
    }
}  