import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AgenteTelefoniaService } from './agente-telefonia.service';
import { SipCryptoService } from './crypto/sip-crypto.service';
import { NeotelHttpClient } from './neotel-http.client';
import { NeotelAdminController, NeotelController } from './neotel.controller';
import { NeotelSesionController } from './neotel-sesion.controller';
import { NeotelRedisService } from './neotel-redis.service';
import { SesionAgenteService } from './sesion-agente.service';
import { EstadoAgenteService } from './estado-agente.service';
import { CampañaAgenteService } from './campaña-agente.service';
import { TransaccionesModule } from '../transacciones/transacciones.module';
import { DeudoresModule } from '../deudores/deudores.module';

@Module({
    imports: [ConfigModule, TransaccionesModule, forwardRef(() => DeudoresModule)],
    controllers: [
        NeotelController,
        NeotelAdminController,
        NeotelSesionController,
    ],
    providers: [
        NeotelHttpClient,
        SipCryptoService,
        AgenteTelefoniaService,
        NeotelRedisService,
        SesionAgenteService,
        EstadoAgenteService,
        CampañaAgenteService,
        PrismaService,
    ],
    exports: [
        NeotelHttpClient,
        SipCryptoService,
        AgenteTelefoniaService,
        NeotelRedisService,
        SesionAgenteService,
        EstadoAgenteService,
        CampañaAgenteService,
    ],
})
export class NeotelModule {}
