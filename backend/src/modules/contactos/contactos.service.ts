// src/contactos/contactos.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UpdateContactoDto } from './dtos/update-contacto.dto';
import { CreateContactoDto } from './dtos/create-contacto.dto';

@Injectable()
export class ContactosService {
    constructor(private prisma: PrismaService) { }

    async create(dto: CreateContactoDto) {
        return this.prisma.contacto.create({ data: dto });
    }

    async update(id: number, dto: UpdateContactoDto) {
        const contacto = await this.prisma.contacto.findUnique({ where: { id } });
        if (!contacto) throw new NotFoundException('Contacto no encontrado');

        return this.prisma.contacto.update({
            where: { id },
            data: dto,
        });
    }

    async remove(id: number) {
        const contacto = await this.prisma.contacto.findUnique({ where: { id } });
        if (!contacto) throw new NotFoundException('Contacto no encontrado');
        await this.prisma.contacto.delete({ where: { id } });
        return contacto;
    }

    async findByDeudor(deudorId: number) {
        return this.prisma.contacto.findMany({
            where: { deudorId }            
        });
    }
}