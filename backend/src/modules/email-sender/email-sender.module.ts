import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailSenderController } from './email-sender.controller';
import { EmailSenderService } from './email-sender.service';
import { SenderHttpClient } from './sender-http.client';

@Module({
    controllers: [EmailSenderController],
    providers: [EmailSenderService, SenderHttpClient, PrismaService],
    exports: [EmailSenderService, SenderHttpClient],
})
export class EmailSenderModule { }
