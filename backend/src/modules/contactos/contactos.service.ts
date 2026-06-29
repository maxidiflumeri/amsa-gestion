// src/contactos/contactos.service.ts
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UpdateContactoDto } from './dtos/update-contacto.dto';
import { CreateContactoDto } from './dtos/create-contacto.dto';
import { normalizarTelefonoArgentino } from 'src/common/utils/phone-utils';
import { validarEmail } from 'src/common/utils/email-utils';
import { normalizarDireccionArgentina } from 'src/common/utils/direccion-utils';

@Injectable()
export class ContactosService {
    private readonly logger = new Logger(ContactosService.name);

    constructor(private prisma: PrismaService) { }

    async create(dto: CreateContactoDto) {
        this.logger.log(`Creando contacto tipo=${dto.tipo} deudorId=${dto.deudorId}`);
        const data: any = { ...dto };
        if (data.tipo === 'telefono' || data.tipo === 'whatsapp') {
            const res = normalizarTelefonoArgentino(data.valor);
            if (!res.valido || !res.e164) {
                throw new BadRequestException('Número de teléfono inválido para Argentina');
            }
            data.valor = res.e164;
            data.subtipo = res.tipo ?? null;
            data.validado = true;

            const marcaWhatsapp = data.whatsapp === true || data.tipo === 'whatsapp';
            if (marcaWhatsapp && data.subtipo === 'FIXED_LINE') {
                throw new BadRequestException('No se puede marcar como WhatsApp un teléfono fijo');
            }
        }

        if (data.tipo === 'email') {
            const res = await validarEmail(data.valor);
            if (!res.valido) {
                throw new BadRequestException(`Correo inválido: ${res.motivoInvalido}`);
            }
            data.valor = res.normalizado;
            data.validado = true;
        }

        if (data.tipo === 'direccion') {
            const res = await normalizarDireccionArgentina(data.valor, {
                localidad: data.direccionLocalidad,
                provincia: data.direccionProvincia,
            });
            const cp = String(data.direccionCp ?? '').trim();
            const cpSuffix = cp ? ` (CP ${cp})` : '';
            if (res.valido) {
                data.valor = (res.nomenclatura || data.valor.trim()) + cpSuffix;
                data.validado = true;
            } else {
                data.valor = data.valor.trim();
                data.validado = false;
            }
        }

        const payload = this.pickContactoFields(data);

        const esTelefono = payload.tipo === 'telefono' || payload.tipo === 'whatsapp';
        if (esTelefono && payload.prioridad === 1) {
            return this.prisma.$transaction(async (tx) => {
                await tx.contacto.updateMany({
                    where: {
                        deudorId: payload.deudorId,
                        tipo: { in: ['telefono', 'whatsapp'] },
                        prioridad: 1,
                    },
                    data: { prioridad: null },
                });
                return tx.contacto.create({ data: payload });
            });
        }

        return this.prisma.contacto.create({ data: payload });
    }

    private pickContactoFields(data: any) {
        const { tipo, valor, deudorId, prioridad, validado, subtipo, whatsapp } = data;
        return { tipo, valor, deudorId, prioridad, validado, subtipo, whatsapp };
    }

    async update(id: number, dto: UpdateContactoDto) {
        this.logger.log(`Actualizando contacto id=${id}`);
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
            data.validado = true;
        }

        // Bloquear marcar WhatsApp en líneas fijas. El toggle no reenvía `valor`,
        // así que usamos el subtipo guardado y lo recalculamos si es legacy/nulo.
        if (dto.whatsapp === true) {
            let tipoLinea: string | null = data.subtipo ?? contacto.subtipo;
            if (!tipoLinea || tipoLinea === 'UNKNOWN') {
                tipoLinea = normalizarTelefonoArgentino(contacto.valor).tipo ?? null;
            }
            if (tipoLinea === 'FIXED_LINE') {
                // Autocorrección perezosa: si el subtipo guardado todavía no reflejaba que
                // es fijo (dato viejo), lo persistimos ahora antes de rechazar. Así la próxima
                // vez el frontend ya muestra el botón de WhatsApp deshabilitado de entrada.
                if (contacto.subtipo !== 'FIXED_LINE') {
                    await this.prisma.contacto.update({ where: { id }, data: { subtipo: 'FIXED_LINE' } });
                }
                throw new BadRequestException('No se puede marcar como WhatsApp un teléfono fijo');
            }
            if (tipoLinea) data.subtipo = tipoLinea; // backfill oportunista en el caso permitido (móvil)
        }

        if (contacto.tipo === 'email' && dto.valor) {
            const res = await validarEmail(dto.valor);
            if (!res.valido) {
                throw new BadRequestException(`Correo inválido: ${res.motivoInvalido}`);
            }
            data.valor = res.normalizado;
            data.validado = true;
        }

        if (contacto.tipo === 'direccion' && dto.valor) {
            const res = await normalizarDireccionArgentina(dto.valor, {
                localidad: (dto as any).direccionLocalidad,
                provincia: (dto as any).direccionProvincia,
            });
            const cp = String((dto as any).direccionCp ?? '').trim();
            const cpSuffix = cp ? ` (CP ${cp})` : '';
            if (res.valido) {
                data.valor = (res.nomenclatura || dto.valor.trim()) + cpSuffix;
                data.validado = true;
            } else {
                data.valor = dto.valor.trim();
                data.validado = false;
            }
        }

        const payload = this.pickContactoFields(data);

        // Si se marca como principal (prioridad=1), resetear los otros teléfonos del deudor.
        const esTelefono = contacto.tipo === 'telefono' || contacto.tipo === 'whatsapp';
        if (esTelefono && payload.prioridad === 1) {
            const after = await this.prisma.$transaction(async (tx) => {
                await tx.contacto.updateMany({
                    where: {
                        deudorId: contacto.deudorId,
                        tipo: { in: ['telefono', 'whatsapp'] },
                        id: { not: id },
                        prioridad: 1,
                    },
                    data: { prioridad: null },
                });
                return tx.contacto.update({ where: { id }, data: payload });
            });
            return { before: contacto, after, deudorId: after.deudorId };
        }

        const after = await this.prisma.contacto.update({
            where: { id },
            data: payload,
        });
        return { before: contacto, after, deudorId: after.deudorId };
    }

    async remove(id: number) {
        this.logger.log(`Eliminando contacto id=${id}`);
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