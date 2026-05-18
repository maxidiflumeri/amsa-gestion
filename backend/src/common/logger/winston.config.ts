import { utilities as nestWinstonUtilities, WinstonModuleOptions } from 'nest-winston';
import * as winston from 'winston';
import 'winston-daily-rotate-file';

export function winstonConfig(): WinstonModuleOptions {
    const logDir = process.env.LOG_DIR ?? './logs';
    const logLevel = process.env.LOG_LEVEL ?? 'log';
    const maxSize = process.env.LOG_MAX_SIZE ?? '20m';
    const retentionDays = process.env.LOG_RETENTION_DAYS ?? '14';

    const requestIdFormat = winston.format((info) => {
        const ctx = (globalThis as any).__requestContext?.get?.();
        if (ctx?.requestId) {
            const parts = [`[reqId=${ctx.requestId}`];
            if (ctx.usuarioId != null) parts.push(` u=${ctx.usuarioId}`);
            parts.push(']');
            info.message = `${parts.join('')} ${info.message}`;
            info.requestId = ctx.requestId;
            info.usuarioId = ctx.usuarioId;
            info.source = ctx.source;
            info.jobId = ctx.jobId;
            info.queue = ctx.queue;
        }
        return info;
    });

    const consoleTransport = new winston.transports.Console({
        format: winston.format.combine(
            requestIdFormat(),
            nestWinstonUtilities.format.nestLike('AMSA', {
                prettyPrint: true,
                colors: true,
            }),
        ),
    });

    const combinedTransport = new (winston.transports as any).DailyRotateFile({
        dirname: logDir,
        filename: 'combined-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize,
        maxFiles: `${retentionDays}d`,
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.errors({ stack: true }),
            requestIdFormat(),
            winston.format.json(),
        ),
    });

    const errorTransport = new (winston.transports as any).DailyRotateFile({
        dirname: logDir,
        filename: 'error-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        zippedArchive: true,
        maxSize,
        maxFiles: `${retentionDays}d`,
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.errors({ stack: true }),
            requestIdFormat(),
            winston.format.json(),
        ),
    });

    const exceptionsTransport = new (winston.transports as any).DailyRotateFile({
        dirname: logDir,
        filename: 'exceptions-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize,
        maxFiles: `${retentionDays}d`,
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.errors({ stack: true }),
            winston.format.json(),
        ),
    });

    return {
        level: logLevel === 'log' ? 'info' : logLevel,
        exitOnError: false,
        transports: [consoleTransport, combinedTransport, errorTransport],
        exceptionHandlers: [exceptionsTransport],
        rejectionHandlers: [exceptionsTransport],
    };
}
