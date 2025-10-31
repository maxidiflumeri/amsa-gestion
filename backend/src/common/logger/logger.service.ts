import { Injectable, LoggerService as NestLoggerService, Scope } from '@nestjs/common';
import { createLogger, format, transports } from 'winston';

const { combine, timestamp, printf, colorize } = format;

// Formato visual del log
const logFormat = printf(({ level, message, context, timestamp }) => {
    return `${timestamp} [${level}]${context ? ` [${context}]` : ''}: ${message}`;
});

@Injectable({ scope: Scope.TRANSIENT })
export class LoggerService implements NestLoggerService {
    private logger;

    constructor() {
        this.logger = createLogger({
            level: 'debug',
            format: combine(
                colorize(),
                timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
                logFormat,
            ),
            transports: [
                new transports.Console(),
                new transports.File({
                    filename: 'logs/error.log',
                    level: 'error',
                }),
                new transports.File({
                    filename: 'logs/combined.log',
                }),
            ],
        });
    }

    log(message: string, context?: string) {
        this.logger.info(message, { context });
    }

    error(message: string, trace?: string, context?: string) {
        this.logger.error(`${message} — ${trace || ''}`, { context });
    }

    warn(message: string, context?: string) {
        this.logger.warn(message, { context });
    }

    debug(message: string, context?: string) {
        this.logger.debug(message, { context });
    }

    verbose(message: string, context?: string) {
        this.logger.verbose(message, { context });
    }
}