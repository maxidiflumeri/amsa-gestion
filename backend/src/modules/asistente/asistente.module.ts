import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ReportesModule } from '../reportes/reportes.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { TransaccionesModule } from '../transacciones/transacciones.module';
import { AdjuntosController } from './adjuntos/adjuntos.controller';
import { AdjuntosService } from './adjuntos/adjuntos.service';
import { PerfilEjemploService } from './adjuntos/perfil-ejemplo.service';
import { DatosAdicionalesService } from './reportes/datos-adicionales.service';
import { PropuestasController } from './reportes/propuestas.controller';
import { PropuestasService } from './reportes/propuestas.service';
import { PruebaPropuestaService } from './reportes/prueba-propuesta.service';
import { SemaforoReportes } from './reportes/semaforo';
import { VocabulariosService } from './reportes/vocabularios.service';
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
 * Asistente de IA: ayuda y navegación (Fase A, docs/asistente-spec.md) y armado de plantillas de reportes (Fase B,
 * docs/asistente-reportes-spec.md). Habla con Claude (Haiku 5.5 la ayuda, Sonnet 5.5 los reportes) por Bedrock detrás de la
 * interfaz `ClienteModelo`.
 */
@Module({
    imports: [PrismaModule, NotificacionesModule, TransaccionesModule, ReportesModule],
    controllers: [AsistenteController, AsistenteAdminController, AdjuntosController, PropuestasController],
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
        // Fase B: armar plantillas de reportes (docs/asistente-reportes-spec.md)
        // Dos pruebas contra la base a la vez en todo el backend (el constructor recibe un número: va por fábrica).
        { provide: SemaforoReportes, useFactory: () => new SemaforoReportes(2) },
        VocabulariosService,
        DatosAdicionalesService,
        PerfilEjemploService,
        AdjuntosService,
        PruebaPropuestaService,
        PropuestasService,
    ],
    exports: [PropuestasService],
})
export class AsistenteModule {}
