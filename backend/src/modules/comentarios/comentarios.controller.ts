import {
    Controller,
    Post,
    Delete,
    Param,
    Body,
    Get,
    Req,
} from '@nestjs/common';
import { ComentariosService } from './comentarios.service';
import { Audit } from '../transacciones/audit.decorator';
import { CreateComentarioDto } from './dtos/create-comentario.dto';

@Controller('comentarios')
export class ComentariosController {
    constructor(private readonly comentariosService: ComentariosService) { }

    @Post()
    @Audit({
        tipo: 'CREATE',
        entidad: 'Comentario',
        deudorIdParam: 'deudorId',
        entidadIdFromResponse: 'id',
        resumen: (res, req) => `Agregó comentario: "${req.body.texto.slice(0, 80)}"`,
        data: (res, req) => ({ body: req.body }),
    })
    create(@Body() dto: CreateComentarioDto, @Req() req: any) {
        dto.usuarioId = req.user?.id ?? null;
        return this.comentariosService.create(dto);
    }

    @Delete(':id')
    @Audit({
        tipo: 'DELETE',
        entidad: 'Comentario',
        entidadIdFromResponse: 'id',
        resumen: (res, req) => `Eliminó comentario ${req.params.id}`,
    })
    remove(@Param('id') id: string) {
        return this.comentariosService.remove(+id);
    }

    @Get('deudor/:deudorId')
    findByDeudor(@Param('deudorId') deudorId: string) {
        return this.comentariosService.findByDeudor(+deudorId);
    }
}  