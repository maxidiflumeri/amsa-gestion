import { Module } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { MulticlavesController } from './multiclaves.controller';
import { ClavesService } from './claves.service';

/**
 * Módulo de claves de pago de Telecom/Personal (multiclaves). Fase 1: resumen y sin-caso de una
 * carga. Las fases 2-3 agregan `CuponService`, `CuponPdfService` y la config de empresa acá mismo.
 *
 * Ver `docs/multiclaves-spec.md`.
 */
@Module({
    controllers: [MulticlavesController],
    providers: [ClavesService, PrismaService],
    exports: [ClavesService],
})
export class MulticlavesModule { }
