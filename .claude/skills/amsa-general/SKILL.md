---
name: amsa-general
description: >
  Patrones transversales de AMSA Sender: logging con Winston, manejo de errores,
  DTOs, sockets, guards JWT, filtros globales, configuración de variables de entorno.
  Usar este skill para cualquier patrón que aplique a todo el backend NestJS o cuando
  se pida configurar algo que afecte la arquitectura global: interceptors, pipes globales,
  filtros de excepción, configuración de CORS, WebSocket gateway, o estructura de respuestas.
---

# Skill: Patrones Generales — AMSA Sender

## Winston Logger (configuración global)

```typescript
// src/logger/winston.config.ts
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';

export const winstonConfig = WinstonModule.createLogger({
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, context, stack }) => {
          return `${timestamp} [${context ?? 'App'}] ${level}: ${message}${stack ? `\n${stack}` : ''}`;
        }),
      ),
    }),
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    }),
  ],
});
```

```typescript
// main.ts
const app = await NestFactory.create(AppModule, {
  logger: winstonConfig,
});
```

## Filtro global de excepciones

```typescript
// src/filters/http-exception.filter.ts
import {
  ExceptionFilter, Catch, ArgumentsHost,
  HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Error interno del servidor';

    this.logger.error(`${request.method} ${request.url} — ${status}`, 
      exception instanceof Error ? exception.stack : String(exception)
    );

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message,
    });
  }
}
```

```typescript
// main.ts
app.useGlobalFilters(new AllExceptionsFilter());
```

## Socket.io Gateway

```typescript
// src/gateways/campana.gateway.ts
import {
  WebSocketGateway, WebSocketServer, OnGatewayConnection,
  OnGatewayDisconnect, SubscribeMessage, MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: { origin: process.env.FRONTEND_URL, credentials: true },
})
export class CampanaGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(CampanaGateway.name);

  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    this.logger.log(`Cliente conectado: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Cliente desconectado: ${client.id}`);
  }

  emitirProgreso(campanaId: number, data: ProgresoPayload) {
    this.server.emit(`campana:${campanaId}:progreso`, data);
  }

  @SubscribeMessage('suscribir-campana')
  handleSuscripcion(@MessageBody() campanaId: number) {
    this.logger.log(`Suscripción a campaña ${campanaId}`);
  }
}
```

## Variables de entorno

```typescript
// src/config/env.config.ts
import { plainToInstance } from 'class-transformer';
import { IsString, IsInt, validateSync } from 'class-validator';

class EnvironmentVariables {
  @IsString() DATABASE_URL: string;
  @IsString() REDIS_HOST: string;
  @IsInt() REDIS_PORT: number;
  @IsString() JWT_SECRET: string;
  @IsString() FRONTEND_URL: string;
}

export function validate(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated);
  if (errors.length > 0) throw new Error(errors.toString());
  return validated;
}
```

```typescript
// app.module.ts
ConfigModule.forRoot({
  isGlobal: true,
  validate,
}),
```

## Guard JWT

```typescript
// src/guards/jwt-auth.guard.ts
import { Injectable, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any) {
    if (err || !user) {
      this.logger.warn('Acceso denegado: token inválido o ausente');
      throw err || new UnauthorizedException();
    }
    return user;
  }
}
```

## Interceptor de respuesta estándar

```typescript
// src/interceptors/response.interceptor.ts
import {
  Injectable, NestInterceptor, ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface StandardResponse<T> {
  success: boolean;
  data: T;
  timestamp: string;
}

@Injectable()
export class ResponseInterceptor<T>
  implements NestInterceptor<T, StandardResponse<T>> {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<StandardResponse<T>> {
    return next.handle().pipe(
      map((data) => ({
        success: true,
        data,
        timestamp: new Date().toISOString(),
      })),
    );
  }
}
```

## Configuración CORS (main.ts)

```typescript
app.enableCors({
  origin: process.env.FRONTEND_URL,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
});
```

## Checklist arquitectura global

- [ ] ¿Winston está configurado en `main.ts`?
- [ ] ¿El filtro global de excepciones está registrado?
- [ ] ¿Las variables de entorno se validan al arrancar?
- [ ] ¿CORS tiene `origin` restringido a `FRONTEND_URL`?
- [ ] ¿El Gateway de sockets tiene `cors` configurado?
- [ ] ¿No hay `console.log` en ningún archivo de src/?
