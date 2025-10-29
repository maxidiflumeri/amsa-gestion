// src/prisma/prisma.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy, Logger, INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(PrismaService.name);

    async onModuleInit() {
        // 1) Conectá primero
        await this.$connect();

        // 2) Seteá timezone en la sesión actual (afecta esta conexión del pool)
        await this.$executeRawUnsafe('SET time_zone = "-03:00"');

        // 3) Logueá una sola vez
        const [row]: any = await this.$queryRawUnsafe('SELECT @@session.time_zone tz');
        this.logger.log(`Prisma conectado con zona horaria: ${row.tz}`);
    }

    async enableShutdownHooks(app: INestApplication) {
        const shutdown = async () => {
            try {
                await this.$disconnect();
            } finally {
                await app.close();
            }
        };

        // Para Nest:
        app.enableShutdownHooks();

        // Señales y beforeExit del proceso (Node)
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
        process.on('beforeExit', shutdown);
    }

    async onModuleDestroy() {
        await this.$disconnect();
    }
}