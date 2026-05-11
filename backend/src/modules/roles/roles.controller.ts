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
    create(@Body() dto: CreateRolDto) {
        return this.rolesService.create(dto);
    }

    @Patch(':id')
    update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRolDto) {
        return this.rolesService.update(id, dto);
    }

    @Delete(':id')
    remove(@Param('id', ParseIntPipe) id: number) {
        return this.rolesService.remove(id);
    }
}
