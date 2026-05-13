import { Module } from '@nestjs/common';
import { DeudoresModule } from '../deudores/deudores.module';
import { EmailSenderModule } from '../email-sender/email-sender.module';
import { TimelineController } from './timeline.controller';

@Module({
    imports: [DeudoresModule, EmailSenderModule],
    controllers: [TimelineController],
})
export class TimelineModule { }
