import { Controller, Get, Param, Post, Body, Put, Delete } from '@nestjs/common';
import { DeudoresService } from './deudores.service';
import { CreateDeudorDto } from './dtos/create-deudor.dto';
import { UpdateDeudorDto } from './dtos/update-deudor.dto';
import { Prisma } from '@prisma/client';

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
    update(@Param('id') id: string, @Body() dto: UpdateDeudorDto) {
        return this.deudoresService.update(+id, dto);
    }

    @Delete(':id')
    delete(@Param('id') id: string) {
        return this.deudoresService.delete(+id);
    }
}