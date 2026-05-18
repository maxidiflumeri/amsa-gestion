import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { json } from 'express';
import * as bodyParser from 'body-parser';
import { WinstonModule, WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { winstonConfig } from './common/logger/winston.config';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { RequestContextInterceptor } from './common/interceptors/request-context.interceptor';
import { RequestContextService } from './common/logger/request-context';

async function bootstrap() {
    const app = await NestFactory.create(AppModule, {
        bufferLogs: true,
        logger: WinstonModule.createLogger(winstonConfig()),
    });

    app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));

    const requestContext = app.get(RequestContextService);
    (globalThis as any).__requestContext = requestContext;

    app.use(bodyParser.json({ limit: '10mb' }));
    app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));

    app.useGlobalInterceptors(
        new RequestContextInterceptor(requestContext),
        new LoggingInterceptor(requestContext),
    );

    app.useGlobalPipes(new ValidationPipe({ whitelist: false, transform: true }));
    app.setGlobalPrefix('api');

    app.enableCors({
        origin: [
            'http://localhost:5173',
            'http://localhost:3000',
            'https://amsasender.anamayasa.com',
        ],
        credentials: true,
    });
    app.use(json());

    await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
