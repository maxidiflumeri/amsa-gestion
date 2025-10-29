import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DeudoresModule } from './modules/deudores/deudores.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule, DeudoresModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
