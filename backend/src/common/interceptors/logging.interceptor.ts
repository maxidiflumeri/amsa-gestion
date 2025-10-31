import {
    Injectable,
    NestInterceptor,
    ExecutionContext,
    CallHandler,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { LoggerService } from '../logger/logger.service';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
    constructor(private readonly logger: LoggerService) { }

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const request = context.switchToHttp().getRequest();
        const { method, url, user } = request;
        const userInfo = user ? `user=${user.id}` : 'anon';
        const start = Date.now();

        this.logger.log(`➡️  ${method} ${url} (${userInfo})`, 'HTTP');

        return next.handle().pipe(
            tap(() => {
                const duration = Date.now() - start;
                this.logger.log(`⬅️  ${method} ${url} - ${duration}ms`, 'HTTP');
            }),
        );
    }
}  