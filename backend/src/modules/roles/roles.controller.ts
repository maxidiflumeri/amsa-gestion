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
import { CreateRolDto } from './dto/create-rol.dto';
import { UpdateRolDto } from './dto/update-rol.dto';
import { RolesService } from './roles.service';

@Controller('roles')
@Permisos('admin.gestionar_roles')
export class RolesController {
    private readonly logger = new Logger(RolesController.name);

    constructor(private readonly rolesService: RolesService) {}

    @Get()
    findAll() {
        return this.rolesService.findAll();
    }

    @Get('permisos-catalogo')
    getPermisosCatalogo() {
        return this.rolesService.getPermisosCatalogo();
    }

    @Get(':id')
    findOne(@Param('id', ParseIntPipe) id: number) {
        return this.rolesService.findOne(id);
    }

    @Post()
    @Audit({
        modulo: AuditModulo.ADMIN,
        entidad: 'Rol',
        tipo: AuditTipo.CREATE,
        entidadIdFromResponse: 'id',
        resumen: (res) => `Creó rol "${res?.nombre}"`,
        data: (res, req) => ({ params: req.body, after: res }),
    })
    create(@Body() dto: CreateRolDto) {
        return this.rolesService.create(dto);
    }

    @Patch(':id')
    @Audit({
        modulo: AuditModulo.ADMIN,
        entidad: 'Rol',
        tipo: AuditTipo.ROL_CAMBIO,
        entidadIdParam: 'id',
        resumen: (res, req) => `Actualizó rol ${req.params.id}`,
        data: (res, req) => ({ params: req.body, after: res }),
    })
    update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRolDto) {
        return this.rolesService.update(id, dto);
    }

    @Delete(':id')
    @Audit({
        modulo: AuditModulo.ADMIN,
        entidad: 'Rol',
        tipo: AuditTipo.DELETE,
        entidadIdParam: 'id',
        resumen: (res, req) => `Eliminó rol ${req.params.id}`,
    })
    remove(@Param('id', ParseIntPipe) id: number) {
        return this.rolesService.remove(id);
    }
}
