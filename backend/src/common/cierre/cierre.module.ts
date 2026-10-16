import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { CierreOrdenadoService } from './cierre-ordenado.service';

@Module({
    imports: [DiscoveryModule],
    providers: [CierreOrdenadoService],
    exports: [CierreOrdenadoService],
})
export class CierreModule {}
