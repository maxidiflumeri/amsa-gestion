// src/import/import.controller.ts
import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, UploadedFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { ImportService } from './imports.service';
import { CambiarEmpresaPlantillaDto, ClonarPlantillaDto, CreatePlantillaDto, CreateRemesaDto } from './dtos/import.dto';
import { Permisos, UsuarioActual } from '../../auth/decorators';
import { Audit } from '../transacciones/audit.decorator';
import { AuditModulo, AuditTipo } from '../transacciones/audit.enums';

interface UsuarioJwt {
    sub: number;
    email: string;
    rol: string;
    permisos: string[];
}

/** Parsea un campo JSON que llega dentro de un multipart. Devuelve `undefined` si no es válido. */
function parseJsonOpcional<T>(raw: string | undefined): T | undefined {
    if (!raw) return undefined;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return undefined;
    }
}

@Controller('import')
@Permisos('importacion.ver_historial')
export class ImportController {
    constructor(private readonly service: ImportService) { }

    // --- CATEGORÍAS ---
    @Get('categorias')
    getCategories() {
        return this.service.getCategories();
    }

    @Get('empresas')
    getEmpresas() {
        return this.service.listEmpresas();
    }

    // --- PLANTILLAS ---
    @Post('plantillas')
    @Permisos('plantillas_import.crear')
    @Audit({
        modulo: AuditModulo.IMPORT,
        entidad: 'PlantillaImport',
        tipo: AuditTipo.CREATE,
        entidadIdFromResponse: 'id',
        empresaId: (res) => res?.empresaId,
        resumen: (res) => `Creó plantilla import "${res?.nombre}"`,
        data: (res, req) => ({ params: req.body, after: res }),
    })
    createPlantilla(@Body() dto: CreatePlantillaDto) {
        return this.service.createPlantilla(dto);
    }

    @Get('plantillas/:empresaId/:categoria')
    @Permisos('plantillas_import.ver')
    listPlantillas(@Param('empresaId', ParseIntPipe) empresaId: number, @Param('categoria') categoria: string) {
        return this.service.listPlantillas(empresaId, categoria);
    }

    @Get('plantillas/:empresaId')
    listAllPlantillas(@Param('empresaId', ParseIntPipe) empresaId: number) {
        return this.service.listPlantillas(empresaId);
    }

    @Get('plantilla/:id')
    getPlantilla(@Param('id', ParseIntPipe) id: number) {
        return this.service.getPlantilla(id);
    }

    @Post('plantillas/preview')
    @UseInterceptors(FileInterceptor('file'))
    previewFile(
        @UploadedFile() file: any,
        @Body('separador') separador?: string,
        @Body('tieneHeader') tieneHeader?: string,
        @Body('anchoFijo') anchoFijo?: string,
    ) {
        return this.service.previewFile(
            file,
            separador || '|',
            tieneHeader === 'true',
            undefined,
            5,
            // Viaja como JSON dentro del multipart. Si viene roto se ignora y el preview cae al
            // camino delimitado, que es lo que el operador espera mientras arma el layout.
            parseJsonOpcional(anchoFijo),
        );
    }

    /**
     * Propone un layout de ancho fijo a partir del archivo, para arrancar el editor de la plantilla.
     * Ver `ImportService.inferirAnchoFijo`: es un punto de partida editable, no una detección exacta.
     */
    @Post('plantillas/inferir-ancho-fijo')
    @Permisos('plantillas_import.ver')
    @UseInterceptors(FileInterceptor('file'))
    inferirAnchoFijo(
        @UploadedFile() file: any,
        @Body('tieneHeader') tieneHeader?: string,
        @Body('encoding') encoding?: string,
    ) {
        return this.service.inferirAnchoFijo(
            file,
            tieneHeader !== 'false',
            encoding === 'utf8' ? 'utf8' : 'latin1',
        );
    }

    @Post('plantillas/:id')
    @Permisos('plantillas_import.editar')
    @Audit({
        modulo: AuditModulo.IMPORT,
        entidad: 'PlantillaImport',
        tipo: AuditTipo.UPDATE,
        entidadIdParam: 'id',
        empresaId: (res) => res?.empresaId,
        resumen: (res, req) => `Actualizó plantilla import ${req.params.id}`,
        data: (res, req) => ({ params: req.body, after: res }),
    })
    updatePlantilla(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: Partial<CreatePlantillaDto>,
    ) {
        return this.service.updatePlantilla(id, dto);
    }

    @Post('plantillas/:id/delete')
    @Permisos('plantillas_import.eliminar')
    @Audit({
        modulo: AuditModulo.IMPORT,
        entidad: 'PlantillaImport',
        tipo: AuditTipo.DELETE,
        entidadIdParam: 'id',
        resumen: (res, req) => `Eliminó plantilla import ${req.params.id}`,
    })
    deletePlantilla(@Param('id', ParseIntPipe) id: number) {
        return this.service.deletePlantilla(id);
    }

    @Post('plantillas/:id/clonar')
    @Permisos('plantillas_import.crear')
    @Audit({
        modulo: AuditModulo.IMPORT,
        entidad: 'PlantillaImport',
        tipo: AuditTipo.CREATE,
        entidadIdFromResponse: 'id',
        empresaId: (res) => res?.empresaId,
        resumen: (res, req) => `Clonó plantilla import ${req.params.id} → "${res?.nombre}"`,
        data: (res, req) => ({ params: req.body, after: res }),
    })
    clonarPlantilla(@Param('id', ParseIntPipe) id: number, @Body() dto: ClonarPlantillaDto) {
        return this.service.clonarPlantilla(id, dto);
    }

    @Post('plantillas/:id/cambiar-empresa')
    @Permisos('plantillas_import.editar')
    @Audit({
        modulo: AuditModulo.IMPORT,
        entidad: 'PlantillaImport',
        tipo: AuditTipo.UPDATE,
        entidadIdParam: 'id',
        empresaId: (res) => res?.empresaId,
        resumen: (res, req) => `Cambió de empresa la plantilla import ${req.params.id}`,
        data: (res, req) => ({ params: req.body, after: res }),
    })
    cambiarEmpresaPlantilla(@Param('id', ParseIntPipe) id: number, @Body() dto: CambiarEmpresaPlantillaDto) {
        return this.service.cambiarEmpresaPlantilla(id, dto.empresaId);
    }

    // --- REMESAS ---
    /**
     * Alta de remesa. Acepta un archivo (`file`, el caso de siempre) o varios (`files`): el paquete
     * de roles distintos de MULTIARCHIVO, o N archivos del mismo formato que se recorren como uno
     * solo. Se usa `FileFieldsInterceptor` en vez de cambiar el `FileInterceptor` por uno múltiple
     * para no tocar el contrato de las categorías existentes.
     *
     * El tope de 100 archivos está puesto por AYSA, que manda 31 TXT por tanda (uno por sucursal).
     */
    @Post('remesas')
    @UseInterceptors(FileFieldsInterceptor([
        { name: 'file', maxCount: 1 },
        { name: 'files', maxCount: 100 },
    ]))
    @Audit({
        modulo: AuditModulo.IMPORT,
        entidad: 'Remesa',
        tipo: AuditTipo.CREATE,
        entidadIdFromResponse: 'id',
        empresaId: (res, req) => Number(req.body?.empresaId) || undefined,
        resumen: (res, req) => `Creó remesa para empresa ${req.body?.empresaId}`,
        data: (res, req) => ({ params: { ...req.body, file: undefined, files: undefined }, after: res }),
    })
    createRemesa(
        @Body() dto: CreateRemesaDto,
        @UploadedFiles() archivos: { file?: any[]; files?: any[] },
    ) {
        const subidos = [...(archivos?.file ?? []), ...(archivos?.files ?? [])];
        return this.service.createRemesa(dto, subidos);
    }

    @Get('remesas/empresa/:empresaId')
    listRemesas(
        @Param('empresaId', ParseIntPipe) empresaId: number,
        @Query('categoria') categoria?: string,
        @Query('conDeudores') conDeudores?: string,
        @Query('enGestion') enGestion?: string,
    ) {
        return this.service.listRemesas(
            empresaId,
            categoria,
            conDeudores === 'true',
            enGestion === 'true',
        );
    }

    /**
     * Cortes (nómina / gestión) que trae un archivo, para decidir en cuántas remesas se parte.
     *
     * No guarda nada: lee el archivo en un temporal, cuenta y lo borra. Las remesas se crean
     * después, con `POST remesas` y el campo `divisiones`.
     */
    @Post('remesas/division-preview')
    @Permisos('importacion.ejecutar')
    @UseInterceptors(FileFieldsInterceptor([
        { name: 'file', maxCount: 1 },
        { name: 'files', maxCount: 100 },
    ]))
    divisionPreview(
        @UploadedFiles() archivos: { file?: any[]; files?: any[] },
        @Body('plantillaId') plantillaId: string,
        @Body('empresaId') empresaId: string,
        @Body('numeroRemesa') numeroRemesa?: string,
        @Body('hoja') hoja?: string,
    ) {
        const subidos = [...(archivos?.file ?? []), ...(archivos?.files ?? [])];
        return this.service.previewDivision(
            subidos,
            Number(plantillaId),
            Number(empresaId),
            numeroRemesa,
            hoja,
        );
    }

    @Post('validar/:id')
    @Permisos('importacion.ejecutar')
    @Audit({
        modulo: AuditModulo.IMPORT,
        entidad: 'Remesa',
        tipo: AuditTipo.VALIDAR,
        entidadIdParam: 'id',
        resumen: (res, req) => `Validó remesa ${req.params.id}`,
    })
    validate(@Param('id', ParseIntPipe) id: number) {
        return this.service.validateRemesa(id);
    }

    @Get('remesas/:id/acciones-preview')
    @Permisos('deudores.acciones_masivas')
    accionesPreview(
        @Param('id', ParseIntPipe) id: number,
        @Query('remesaOrigenId') remesaOrigenId?: string,
    ) {
        return this.service.previewAccionesImpacto(id, remesaOrigenId ? Number(remesaOrigenId) : undefined);
    }

    @Post('remesas/:id/revertir-acciones')
    @Permisos('deudores.acciones_masivas')
    @Audit({
        modulo: AuditModulo.IMPORT,
        entidad: 'Remesa',
        tipo: AuditTipo.DELETE,
        entidadIdParam: 'id',
        resumen: (res, req) => `Revirtió acción masiva remesa ${req.params.id}`,
    })
    revertirAcciones(@Param('id', ParseIntPipe) id: number, @UsuarioActual() user: UsuarioJwt) {
        return this.service.revertirAcciones(id, user.sub);
    }

    @Post('ejecutar/:id')
    @Permisos('importacion.ejecutar')
    @Audit({
        modulo: AuditModulo.IMPORT,
        entidad: 'Remesa',
        tipo: AuditTipo.IMPORT_START,
        entidadIdParam: 'id',
        resumen: (res, req) => `Inició ejecución remesa ${req.params.id}`,
        data: (res, req) => ({ params: req.body }),
    })
    run(
        @Param('id', ParseIntPipe) id: number,
        @UsuarioActual() user: UsuarioJwt,
        @Body('remesaOrigenId') remesaOrigenId?: number,
        @Body('remesaOrigenIds') remesaOrigenIds?: number[],
    ) {
        const ids = Array.isArray(remesaOrigenIds)
            ? remesaOrigenIds.map(Number).filter((n) => Number.isFinite(n))
            : undefined;
        return this.service.executeRemesa(
            id,
            user.sub,
            remesaOrigenId ? Number(remesaOrigenId) : undefined,
            ids && ids.length ? ids : undefined,
        );
    }

    @Get('en-curso')
    @Permisos('importacion.ver_historial')
    getEnCurso(@UsuarioActual() user: UsuarioJwt) {
        return this.service.listarEnCurso(user);
    }

    @Get('remesas/:id')
    status(@Param('id', ParseIntPipe) id: number) {
        return this.service.status(id);
    }

    // --- ERRORES ---
    @Get('errores/:remesaId')
    getErrors(
        @Param('remesaId', ParseIntPipe) remesaId: number,
        @Query('page') page?: string,
        @Query('pageSize') pageSize?: string,
    ) {
        return this.service.getErrors(
            remesaId,
            page ? parseInt(page, 10) : 1,
            pageSize ? parseInt(pageSize, 10) : 50,
        );
    }

    // --- POLÍTICA ---
    @Put('remesas/:id/politica')
    @Audit({
        modulo: AuditModulo.IMPORT,
        entidad: 'Remesa',
        tipo: AuditTipo.UPDATE,
        entidadIdParam: 'id',
        resumen: (res, req) => `Cambió política de remesa ${req.params.id}`,
        data: (res, req) => ({ params: req.body }),
    })
    updatePolitica(
        @Param('id', ParseIntPipe) id: number,
        @Body('politicaId') politicaId: number | null,
    ) {
        return this.service.updatePolitica(id, politicaId);
    }

    // --- ELIMINAR REMESA ---
    @Delete('remesas/:id')
    @Permisos('importacion.eliminar')
    @Audit({
        modulo: AuditModulo.IMPORT,
        entidad: 'Remesa',
        tipo: AuditTipo.DELETE,
        entidadIdParam: 'id',
        resumen: (res, req) => `Eliminó remesa ${req.params.id}`,
    })
    deleteRemesa(
        @Param('id', ParseIntPipe) id: number,
        @UsuarioActual() user: UsuarioJwt,
    ) {
        return this.service.deleteRemesa(id, { sub: user.sub, permisos: user.permisos });
    }
}
