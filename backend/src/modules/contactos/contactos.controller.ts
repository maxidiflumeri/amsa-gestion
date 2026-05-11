import {
    Controller,
    Post,
    Body,
    Put,
    Param,
    Delete,
    Req,
    Get,
} from '@nestjs/common';
import { ContactosService } from './contactos.service';
import { Audit } from '../transacciones/audit.decorator';
import { CreateContactoDto } from './dtos/create-contacto.dto';
import { UpdateContactoDto } from './dtos/update-contacto.dto';

const etiquetaTipo = (tipo: string) => {
    switch (tipo) {
        case 'telefono': return 'teléfono';
        case 'whatsapp': return 'teléfono';
        case 'email': return 'email';
        case 'direccion': return 'dirección';
        case 'red_social': return 'red social';
        default: return tipo;
    }
};

const flagsContacto = (c: any): string => {
    const flags: string[] = [];
    const esWhatsapp = c?.whatsapp === true || c?.tipo === 'whatsapp';
    if (c?.prioridad === 1) flags.push('principal');
    if (esWhatsapp) flags.push('WhatsApp');
    return flags.length ? ` [${flags.join(', ')}]` : '';
};

const resumenUpdateContacto = (res: any, req: any): string => {
    const before = res?.before;
    const after = res?.after;
    if (!before || !after) return `Actualizó contacto ${req.params.id}`;

    const tipo = etiquetaTipo(after.tipo ?? before.tipo);
    const valor = after.valor ?? before.valor;
    const cambios: string[] = [];

    const wasWA = before.whatsapp === true || before.tipo === 'whatsapp';
    const isWA = after.whatsapp === true || after.tipo === 'whatsapp';
    if (wasWA !== isWA) cambios.push(isWA ? 'marcó como WhatsApp' : 'quitó WhatsApp');

    const wasPrincipal = before.prioridad === 1;
    const isPrincipal = after.prioridad === 1;
    if (wasPrincipal !== isPrincipal) cambios.push(isPrincipal ? 'marcó como principal' : 'quitó principal');

    if (before.valor !== after.valor) cambios.push(`cambió valor de ${before.valor} a ${after.valor}`);

    if (!cambios.length) return `Actualizó ${tipo} ${valor} (sin cambios visibles)`;
    return `${cambios.join(', ')} en ${tipo} ${valor}`;
};

@Controller('contactos')
export class ContactosController {
    constructor(private readonly contactosService: ContactosService) { }

    @Post()
    @Audit({
        tipo: 'CREATE',
        entidad: 'Contacto',
        deudorIdParam: 'deudorId',
        entidadIdFromResponse: 'id',
        resumen: (res, req) => `Agregó ${etiquetaTipo(res?.tipo ?? req.body.tipo)} ${res?.valor ?? req.body.valor}${flagsContacto(res)}`,
        data: (res, req) => ({ body: req.body, after: res }),
    })
    create(@Body() dto: CreateContactoDto, @Req() req: any) {
        return this.contactosService.create(dto);
    }

    @Put(':id')
    @Audit({
        tipo: 'UPDATE',
        entidad: 'Contacto',
        entidadIdParam: 'id',
        resumen: resumenUpdateContacto,
        data: (res, req) => ({ before: res?.before, after: res?.after, cambios: req.body }),
    })
    update(@Param('id') id: string, @Body() dto: UpdateContactoDto) {
        return this.contactosService.update(+id, dto);
    }

    @Delete(':id')
    @Audit({
        tipo: 'DELETE',
        entidad: 'Contacto',
        entidadIdFromResponse: 'id',
        resumen: (res, req) => `Eliminó ${etiquetaTipo(res?.tipo)} ${res?.valor}${flagsContacto(res)}`,
        data: (res, req) => res,
    })
    remove(@Param('id') id: string) {
        return this.contactosService.remove(+id);
    }

    @Get('deudor/:deudorId')
    findByDeudor(@Param('deudorId') deudorId: string) {
        return this.contactosService.findByDeudor(+deudorId);
    }
}
