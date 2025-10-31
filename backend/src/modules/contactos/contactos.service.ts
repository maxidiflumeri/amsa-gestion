// src/contactos/contactos.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UpdateContactoDto } from './dtos/update-contacto.dto';
import { CreateContactoDto } from './dtos/create-contacto.dto';
import { normalizarTelefonoArgentino } from 'src/common/utils/phone-utils';
import { validarEmail } from 'src/common/utils/email-utils';
import { normalizarDireccionArgentina } from 'src/common/utils/direccion-utils';

@Injectable()
export class ContactosService {
    constructor(private prisma: PrismaService) { }

    async create(dto: CreateContactoDto) {
        const data: any = { ...dto };
        if (data.tipo === 'telefono' || data.tipo === 'whatsapp') {
            const res = normalizarTelefonoArgentino(data.valor);
            if (!res.valido || !res.e164) {
                throw new BadRequestException('Número de teléfono inválido para Argentina');
            }
            data.valor = res.e164;      // guardar E.164
            data.subtipo = res.tipo ?? null;
        }

        // 🔹 Validación específica por tipo
        if (data.tipo === 'email') {
            const res = await validarEmail(data.valor);
            if (!res.valido) {
                throw new BadRequestException(`Correo inválido: ${res.motivoInvalido}`);
            }
            data.valor = res.normalizado;
        }

        if (data.tipo === 'direccion') {
            const res = await normalizarDireccionArgentina(data.valor);
            if (!res.valido) throw new BadRequestException(res.motivoInvalido || 'Dirección inválida');
            // Guardamos nomenclatura completa
            data.valor = res.nomenclatura || data.valor.trim();
            data.localidad = res.localidad;
            data.provincia = res.provincia;
            data.lat = res.lat;
            data.lon = res.lon;
        }

        return this.prisma.contacto.create({ data: dto });
    }

    async update(id: number, dto: UpdateContactoDto) {
        const contacto = await this.prisma.contacto.findUnique({ where: { id } });
        if (!contacto) throw new NotFoundException('Contacto no encontrado');

        const data: any = { ...dto };

        if ((contacto.tipo === 'telefono' || contacto.tipo === 'whatsapp') && dto.valor) {
            const res = normalizarTelefonoArgentino(dto.valor);
            if (!res.valido || !res.e164) {
                throw new BadRequestException('Número de teléfono inválido para Argentina');
            }
            data.valor = res.e164;
            data.subtipo = res.tipo ?? null;
        }

        if (contacto.tipo === 'email' && dto.valor) {
            const res = await validarEmail(dto.valor);
            if (!res.valido) {
                throw new BadRequestException(`Correo inválido: ${res.motivoInvalido}`);
            }
            data.valor = res.normalizado;
        }

        if (data.tipo === 'direccion') {
            const res = await normalizarDireccionArgentina(data.valor);
            if (!res.valido) throw new BadRequestException(res.motivoInvalido || 'Dirección inválida');
            // Guardamos nomenclatura completa
            data.valor = res.nomenclatura || data.valor.trim();
            data.localidad = res.localidad;
            data.provincia = res.provincia;
            data.lat = res.lat;
            data.lon = res.lon;
        }

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