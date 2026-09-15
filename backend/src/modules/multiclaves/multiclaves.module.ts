import { Module } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { DeudoresModule } from '../deudores/deudores.module';
import { ConsolidacionModule } from '../consolidacion/consolidacion.module';
import { EmailSenderModule } from '../email-sender/email-sender.module';
import { ContactosModule } from '../contactos/contactos.module';
import { MulticlavesController } from './multiclaves.controller';
import { ClavesService } from './claves.service';
import { CuponService } from './cupon.service';
import { CuponPdfService } from './cupon-pdf.service';
import { ConfigEmpresaMulticlavesService } from './config-empresa.service';

/**
 * Módulo de claves de pago de Telecom/Personal (multiclaves). Fase 1: resumen y sin-caso de una
 * carga. Fase 2: cupón PDF, convenio de clave y las claves del caso (`ClavesService`,
 * `CuponService`, `CuponPdfService`). Fase 3: envío del cupón por mail (`EmailSenderModule`, para
 * reusar plantillas/mapeos/`envio_email` de siempre) y la config de empresa
 * (`ConfigEmpresaMulticlavesService`, `PATCH /multiclaves/empresas/:id/config`).
 *
 * `DeudoresModule` trae `DeudorBloqueoService` (R7); `ConsolidacionModule` trae
 * `ConsolidacionSituacionService` (paso 13 de generar un cupón, §8.1); `ContactosModule` trae
 * `ContactosService` (reusado por "guardar como contacto", hallazgo de la auditoría de esta fase:
 * antes se hacía un `prisma.contacto.create` a mano, sin la validación de siempre).
 *
 * Ver `docs/multiclaves-spec.md`.
 */
@Module({
    imports: [DeudoresModule, ConsolidacionModule, EmailSenderModule, ContactosModule],
    controllers: [MulticlavesController],
    providers: [ClavesService, CuponService, CuponPdfService, ConfigEmpresaMulticlavesService, PrismaService],
    exports: [ClavesService, CuponService],
})
export class MulticlavesModule { }
