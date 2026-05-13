import { Controller, Get, Logger, NotFoundException, Param, ParseIntPipe, Query } from '@nestjs/common';
import { DeudoresService } from '../deudores/deudores.service';
import { SenderHttpClient, SenderTimelineResponse } from '../email-sender/sender-http.client';
import { TimelineQueryDto } from './dtos/timeline-query.dto';
import { Permisos } from '../../auth/decorators';

@Controller('timeline')
export class TimelineController {
    private readonly logger = new Logger(TimelineController.name);

    constructor(
        private readonly deudoresService: DeudoresService,
        private readonly sender: SenderHttpClient,
    ) { }

    @Get('deudores/:id')
    @Permisos('deudores.ver')
    async porDeudor(
        @Param('id', ParseIntPipe) id: number,
        @Query() query: TimelineQueryDto,
    ): Promise<SenderTimelineResponse> {
        const deudor = await this.deudoresService.findOne(id);
        if (!deudor) throw new NotFoundException(`Deudor ${id} no encontrado`);

        const documento = (deudor.documento ?? '').trim();
        const empty: SenderTimelineResponse = {
            deudor: null,
            data: [],
            total: 0,
            page: query.page ?? 0,
            size: query.size ?? 30,
            totalPages: 0,
        };

        if (!documento) {
            this.logger.log(`Deudor ${id} sin documento → timeline vacío`);
            return empty;
        }

        return this.sender.timelinePorDocumento(documento, query);
    }
}
