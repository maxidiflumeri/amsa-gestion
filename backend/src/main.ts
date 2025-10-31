import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { json } from 'express';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { LoggerService } from './common/logger/logger.service';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);
    const logger = await app.resolve(LoggerService);
    app.useGlobalInterceptors(new LoggingInterceptor(logger));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    // Middlewares globales
    app.enableCors({
        origin: [
            'http://localhost:5173',
            'http://localhost:3000', // por si usás React en ese puerto
            'https://amsasender.anamayasa.com',
        ],
        credentials: true,
    });
    app.use(json());
    await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
