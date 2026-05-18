import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
    requestId: string;
    usuarioId?: number;
    ip?: string;
    userAgent?: string;
    source: 'http' | 'ws' | 'bull' | 'cron';
    jobId?: string;
    queue?: string;
}

@Injectable()
export class RequestContextService {
    private readonly als = new AsyncLocalStorage<RequestContext>();

    run(ctx: RequestContext, fn: () => Promise<any>): Promise<any> {
        return this.als.run(ctx, fn);
    }

    get(): RequestContext | undefined {
        return this.als.getStore();
    }

    getRequestId(): string | undefined {
        return this.als.getStore()?.requestId;
    }

    getUserId(): number | undefined {
        return this.als.getStore()?.usuarioId;
    }

    child(extra: Partial<RequestContext>): RequestContext {
        const current = this.als.getStore();
        return { ...(current ?? { source: 'http', requestId: '' }), ...extra };
    }
}
