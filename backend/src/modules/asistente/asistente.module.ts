import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { TransaccionesModule } from '../transacciones/transacciones.module';
import { AsistenteAdminController } from './asistente-admin.controller';
import { AsistenteConfigService } from './asistente-config.service';
import { AsistenteLimpiezaService } from './asistente-limpieza.service';
import { AsistenteController } from './asistente.controller';
import { AsistenteService } from './asistente.service';
import { ConversacionesService } from './conversaciones.service';
import { MedicionService } from './medicion.service';
import { AsistenteModeloService } from './modelo/asistente-modelo.service';
import { CLIENTE_MODELO } from './modelo/cliente-modelo';
import { TopesService } from './topes.service';
import { TurnosActivos } from './turnos-activos';
import { WikiIndiceService } from './wiki/wiki-indice.service';

/**
 * Asistente de IA, Fase A (ayuda y navegación). Spec: docs/asistente-spec.md.
 * Habla con Claude Haiku 5.5 por Bedrock detrás de la interfaz `ClienteModelo`.
 */
@Module({
    imports: [PrismaModule, NotificacionesModule, TransaccionesModule],
    controllers: [AsistenteController, AsistenteAdminController],
    providers: [
        AsistenteModeloService,
        { provide: CLIENTE_MODELO, useFactory: (m: AsistenteModeloService) => m.cliente(), inject: [AsistenteModeloService] },
        WikiIndiceService,
        AsistenteConfigService,
        MedicionService,
        TopesService,
        ConversacionesService,
        TurnosActivos,
        AsistenteService,
        AsistenteLimpiezaService,
    ],
})
export class AsistenteModule {}
