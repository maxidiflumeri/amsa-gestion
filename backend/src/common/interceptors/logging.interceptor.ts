import {
    Injectable,
    NestInterceptor,
    ExecutionContext,
    CallHandler,
    Logger,
} from '@nestjs/common';
import { Observable, tap, catchError, throwError } from 'rxjs';
import { RequestContextService } from '../logger/request-context';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
    private readonly logger = new Logger('HTTP');

    constructor(private readonly requestContext: RequestContextService) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        if (context.getType() !== 'http') {
            return next.handle();
        }

        const request = context.switchToHttp().getRequest();
        const response = context.switchToHttp().getResponse();
        const { method, url } = request;
        const usuario = request.usuario;
        const userInfo = usuario?.sub ? `u=${usuario.sub}` : 'anon';
        const start = Date.now();

        this.logger.log(`${method} ${url} (${userInfo})`);

        return next.handle().pipe(
            tap(() => {
                const duration = Date.now() - start;
                const status = response.statusCode;
                const msg = `${method} ${url} ${status} ${duration}ms`;

                if (duration > 1000) {
                    this.logger.warn(msg);
                } else if (duration < 100) {
                    this.logger.debug(msg);
                } else {
                    this.logger.log(msg);
                }
            }),
            catchError((err) => {
                const duration = Date.now() - start;
                const status = err?.status ?? err?.statusCode ?? 500;
                const msg = `${method} ${url} ${status} ${duration}ms — ${err?.message ?? 'Error desconocido'}`;

                if (status >= 500) {
                    this.logger.error(msg, err?.stack);
                } else {
                    this.logger.warn(msg);
                }

                return throwError(() => err);
            }),
        );
    }
}
