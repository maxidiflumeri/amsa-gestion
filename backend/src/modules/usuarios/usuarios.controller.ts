import {
    Body,
    Controller,
    Delete,
    Get,
    Logger,
    Param,
    ParseIntPipe,
    Patch,
    Post,
} from '@nestjs/common';
import { Permisos } from '../../auth/decorators';
import { Audit } from '../transacciones/audit.decorator';
import { AuditModulo, AuditTipo } from '../transacciones/audit.enums';
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { UpdateUsuarioDto } from './dto/update-usuario.dto';
import { UsuariosService } from './usuarios.service';

@Controller('usuarios')
@Permisos('admin.gestionar_usuarios')
export class UsuariosController {
    private readonly logger = new Logger(UsuariosController.name);

    constructor(private readonly usuariosService: UsuariosService) {}

    @Get()
    findAll() {
        return this.usuariosService.findAll();
    }

    @Get(':id')
    findOne(@Param('id', ParseIntPipe) id: number) {
        return this.usuariosService.findOne(id);
    }

    @Post()
    @Audit({
        modulo: AuditModulo.ADMIN,
        entidad: 'Usuario',
        tipo: AuditTipo.USUARIO_ALTA,
        entidadIdFromResponse: 'id',
        resumen: (res) => `Alta de usuario ${res?.email}`,
        data: (res, req) => ({ params: req.body, after: res }),
    })
    create(@Body() dto: CreateUsuarioDto) {
        return this.usuariosService.create(dto);
    }

    @Patch(':id')
    @Audit({
        modulo: AuditModulo.ADMIN,
        entidad: 'Usuario',
        tipo: AuditTipo.UPDATE,
        entidadIdParam: 'id',
        resumen: (res, req) => `Actualizó usuario ${req.params.id}`,
        data: (res, req) => ({ params: req.body, after: res }),
    })
    update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUsuarioDto) {
        return this.usuariosService.update(id, dto);
    }

    @Delete(':id')
    @Audit({
        modulo: AuditModulo.ADMIN,
        entidad: 'Usuario',
        tipo: AuditTipo.USUARIO_BAJA,
        entidadIdParam: 'id',
        resumen: (res, req) => `Baja de usuario ${req.params.id}`,
    })
    remove(@Param('id', ParseIntPipe) id: number) {
        return this.usuariosService.remove(id);
    }
}
