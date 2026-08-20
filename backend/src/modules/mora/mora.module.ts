import { Module } from '@nestjs/common';
import { MoraService } from './mora.service';
import { MoraController } from './mora.controller';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * MoraModule
 *
 * Recargo por mora del régimen de AYSA. Ver docs/mora-aysa-spec.md.
 *
 * Se exporta `MoraService` porque lo van a consumir la ficha del deudor y los reportes (fase 4),
 * y eventualmente la consolidación (que ya recorre la cartera en batches).
 */
@Module({
    controllers: [MoraController],
    providers: [MoraService, PrismaService],
    exports: [MoraService],
})
export class MoraModule {}
