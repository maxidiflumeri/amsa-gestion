import { Module } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { DeudoresModule } from '../deudores/deudores.module';
import { ConsolidacionModule } from '../consolidacion/consolidacion.module';
import { MulticlavesController } from './multiclaves.controller';
import { ClavesService } from './claves.service';
import { CuponService } from './cupon.service';
import { CuponPdfService } from './cupon-pdf.service';

/**
 * Módulo de claves de pago de Telecom/Personal (multiclaves). Fase 1: resumen y sin-caso de una
 * carga. Fase 2: cupón PDF, convenio de clave y las claves del caso (`ClavesService`,
 * `CuponService`, `CuponPdfService`). La fase 3 agrega el envío por mail y la config de empresa
 * (`PATCH /multiclaves/empresas/:id/config`).
 *
 * `DeudoresModule` trae `DeudorBloqueoService` (R7); `ConsolidacionModule` trae
 * `ConsolidacionSituacionService` (paso 13 de generar un cupón, §8.1).
 *
 * Ver `docs/multiclaves-spec.md`.
 */
@Module({
    imports: [DeudoresModule, ConsolidacionModule],
    controllers: [MulticlavesController],
    providers: [ClavesService, CuponService, CuponPdfService, PrismaService],
    exports: [ClavesService, CuponService],
})
export class MulticlavesModule { }
