import { Controller, Get, Param, Post, Body, Put, Delete, Req } from '@nestjs/common';
import { DeudoresService } from './deudores.service';
import { CreateDeudorDto } from './dtos/create-deudor.dto';
import { UpdateDeudorDto } from './dtos/update-deudor.dto';
import { Prisma } from '@prisma/client';
import { Audit } from '../transacciones/audit.decorator';

@Controller('deudores')
export class DeudoresController {
    constructor(private readonly deudoresService: DeudoresService) { }

    @Get()
    findAll() {
        return this.deudoresService.findAll();
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.deudoresService.findOne(+id);
    }

    @Post()
    create(@Body() dto: CreateDeudorDto) {
        return this.deudoresService.create(dto);
    }

    @Put(':id')
    @Audit({
        tipo: 'UPDATE',
        entidad: 'Deudor',
        deudorIdParam: 'id',
        entidadIdFromResponse: 'after.id',
        resumen: (res, req) => {
            const before = res.before;
            const after = res.after;
            let changes: string[] = [];
            if (before.estadoSituacionId !== after.estadoSituacionId)
                changes.push(`situación: ${before.estadoSituacionId} → ${after.estadoSituacionId}`);
            if (before.estadoGestionId !== after.estadoGestionId)
                changes.push(`gestión: ${before.estadoGestionId} → ${after.estadoGestionId}`);
            return `Actualizó estado de ${changes.join(', ')}`;
        },
        data: (res, req) => ({
            before: res.before,
            after: res.after,
            body: req.body,
        }),
    })
    update(@Param('id') id: string, @Body() dto: UpdateDeudorDto, @Req() req: any) {
        return this.deudoresService.update(+id, dto);
    }

    @Delete(':id')
    delete(@Param('id') id: string) {
        return this.deudoresService.delete(+id);
    }
}