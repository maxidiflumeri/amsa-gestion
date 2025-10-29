import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { json } from 'express';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);
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
