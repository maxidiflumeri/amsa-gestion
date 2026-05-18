import {
    Injectable,
    NestInterceptor,
    ExecutionContext,
    CallHandler,
} from '@nestjs/common';
import { Observable, from, switchMap } from 'rxjs';
import { nanoid } from 'nanoid';
import { RequestContextService } from '../logger/request-context';

@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
    constructor(private readonly requestContext: RequestContextService) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        if (context.getType() !== 'http') {
            return next.handle();
        }

        const request = context.switchToHttp().getRequest();
        const response = context.switchToHttp().getResponse();
        const usuario = request.usuario;
        const requestId = nanoid(8);

        response.setHeader('X-Request-Id', requestId);

        const ctx = {
            requestId,
            usuarioId: usuario?.sub ?? undefined,
            ip: request.ip,
            userAgent: request.headers?.['user-agent'],
            source: 'http' as const,
        };

        return from(
            this.requestContext.run(ctx, () => next.handle().toPromise()),
        );
    }
}
