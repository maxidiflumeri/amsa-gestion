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

@Controller('contactos')
export class ContactosController {
    constructor(private readonly contactosService: ContactosService) { }

    @Post()
    @Audit({
        tipo: 'CREATE',
        entidad: 'Contacto',
        deudorIdParam: 'deudorId',
        entidadIdFromResponse: 'id',
        resumen: (res, req) => `Agregó contacto tipo ${req.body.tipo} (${req.body.valor})`,
        data: (res, req) => ({ body: req.body }),
    })
    create(@Body() dto: CreateContactoDto, @Req() req: any) {
        // suponiendo que req.user.id viene del guard de auth
        return this.contactosService.create(dto);
    }

    @Put(':id')
    @Audit({
        tipo: 'UPDATE',
        entidad: 'Contacto',
        entidadIdFromResponse: 'id',
        resumen: (res, req) => `Actualizó contacto ${req.params.id}`,
        data: (res, req) => ({ cambios: req.body }),
    })
    update(@Param('id') id: string, @Body() dto: UpdateContactoDto) {
        return this.contactosService.update(+id, dto);
    }

    @Delete(':id')
    @Audit({
        tipo: 'DELETE',
        entidad: 'Contacto',
        entidadIdFromResponse: 'id',
        resumen: (res, req) => `Eliminó contacto ID=${req.params.id} (${res.tipo}: ${res.valor})`,
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