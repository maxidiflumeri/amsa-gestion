// src/import/import.controller.ts
import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, NotFoundException, Param, ParseIntPipe, Post, Put, Query, Res, UploadedFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { ImportService } from './imports.service';
import { ReversionAccionesService } from './reversion/reversion-acciones.service';
import { CambiarEmpresaPlantillaDto, ClonarPlantillaDto, ConfirmarPendientesDto, CreatePlantillaDto, CreateRemesaDto, EjecutarGrupoDto, ErroresQueryDto, HistorialQueryDto } from './dtos/import.dto';
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
    constructor(
        private readonly service: ImportService,
        private readonly reversion: ReversionAccionesService,
    ) { }

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
        @UsuarioActual() user: UsuarioJwt,
    ) {
        const subidos = [...(archivos?.file ?? []), ...(archivos?.files ?? [])];
        return this.service.createRemesa(dto, subidos, user.sub);
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

    /** Estado de la reversión y cuánto cubre: se pide al abrir el diálogo de Revertir. */
    @Get('remesas/:id/reversion')
    @Permisos('deudores.acciones_masivas')
    obtenerReversion(@Param('id', ParseIntPipe) id: number) {
        return this.reversion.obtener(id);
    }

    /** Pide revertir la acción masiva: 202 y el avance por socket; 200 si ya estaba revertida. */
    @Post('remesas/:id/reversion')
    @Permisos('deudores.acciones_masivas')
    @Audit({
        modulo: AuditModulo.IMPORT,
        entidad: 'Remesa',
        tipo: AuditTipo.DELETE,
        entidadIdParam: 'id',
        // Un pedido rechazado (un 409) llega acá sin `res`. El «Revirtió…» real lo escribe el job al terminar.
        resumen: (res, req) =>
            res == null
                ? `Intentó revertir la acción masiva de la remesa ${req.params.id}`
                : res.reversion?.estado === 'TERMINADA'
                    ? `La acción masiva de la remesa ${req.params.id} ya estaba revertida`
                    : `Pidió revertir la acción masiva de la remesa ${req.params.id}`,
    })
    async pedirReversion(
        @Param('id', ParseIntPipe) id: number,
        @UsuarioActual() user: UsuarioJwt,
        @Res({ passthrough: true }) res: Response,
    ) {
        const { dto, yaEstaba } = await this.reversion.solicitar(id, user.sub);
        res.status(yaEstaba ? HttpStatus.OK : HttpStatus.ACCEPTED);
        return dto;
    }

    /**
     * Compatibilidad con el frontend de C3a (pestañas abiertas antes del deploy): pide lo mismo que el nuevo y espera hasta
     * 20 s a que termine, para responder con la forma de siempre.
     * @deprecated Se borra cuando no quede ningún frontend de C3a en uso.
     */
    @Post('remesas/:id/revertir-acciones')
    @Permisos('deudores.acciones_masivas')
    @Audit({
        modulo: AuditModulo.IMPORT,
        entidad: 'Remesa',
        tipo: AuditTipo.DELETE,
        entidadIdParam: 'id',
        // Un pedido rechazado (un 409, por ejemplo un segundo clic mientras corre la primera) llega acá sin `res`; y uno que
        // encontró la acción ya revertida no revirtió nada: ninguno de los dos puede quedar como "Revirtió".
        resumen: (res, req) =>
            res == null
                ? `Intentó revertir la acción masiva de la remesa ${req.params.id}`
                : res.yaRevertida
                    ? `La acción masiva de la remesa ${req.params.id} ya estaba revertida`
                    : `Revirtió acción masiva remesa ${req.params.id}`,
    })
    revertirAcciones(@Param('id', ParseIntPipe) id: number, @UsuarioActual() user: UsuarioJwt) {
        return this.reversion.revertirCompat(id, user.sub);
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

    /**
     * Confirma TODAS las remesas de una carga dividida con un solo pedido: el backend las encola juntas y en orden, y la
     * pestaña deja de ser parte del mecanismo (§10.5.2). Cierra el problema de que cerrar la pantalla cortaba la división.
     */
    @Post('ejecutar-grupo')
    @Permisos('importacion.ejecutar')
    @Audit({
        modulo: AuditModulo.IMPORT,
        entidad: 'Remesa',
        tipo: AuditTipo.IMPORT_START,
        resumen: (res, req) => `Inició ejecución de carga dividida (${(req.body?.remesaIds ?? []).length} remesas)`,
        data: (res, req) => ({ params: req.body }),
    })
    runGrupo(@Body() dto: EjecutarGrupoDto, @UsuarioActual() user: UsuarioJwt) {
        const ids = Array.isArray(dto.remesaOrigenIds) ? dto.remesaOrigenIds.map(Number).filter((n) => Number.isFinite(n)) : undefined;
        return this.service.ejecutarGrupo(
            {
                remesaIds: dto.remesaIds,
                remesaOrigenId: dto.remesaOrigenId ? Number(dto.remesaOrigenId) : undefined,
                remesaOrigenIds: ids && ids.length ? ids : undefined,
            },
            user.sub,
        );
    }

    /**
     * Confirma desde el Historial las importaciones que ya se habían confirmado y no llegaron a la cola (§5.5). El origen lo lee el
     * servidor de la fila. Delega en `ejecutar/:id` o `ejecutar-grupo`, que repiten sus validaciones.
     */
    @Post('remesas/confirmar-pendientes')
    @Permisos('importacion.ejecutar')
    @Audit({
        modulo: AuditModulo.IMPORT,
        entidad: 'Remesa',
        tipo: AuditTipo.IMPORT_START,
        resumen: (res, req) => `Confirmó importaciones pendientes de encolar (${(req.body?.remesaIds ?? []).length})`,
        data: (res, req) => ({ params: req.body }),
    })
    confirmarPendientes(@Body() dto: ConfirmarPendientesDto, @UsuarioActual() user: UsuarioJwt) {
        return this.service.confirmarPendientes(dto.remesaIds, { sub: user.sub, permisos: user.permisos });
    }

    /** Una carga dividida: sus remesas por orden, con el estado de cada una. */
    @Get('grupos/:grupoId')
    grupo(@Param('grupoId') grupoId: string) {
        return this.service.grupo(grupoId);
    }

    /**
     * Pide cancelar una carga: corta, deja lo ya procesado y lo informa con el número exacto. No revierte nada.
     * Dueño de la remesa o `importacion.ver_progreso_otros`.
     */
    @Post('remesas/:id/cancelar')
    @HttpCode(200)
    @Permisos('importacion.ejecutar')
    @Audit({
        modulo: AuditModulo.IMPORT,
        entidad: 'Remesa',
        tipo: AuditTipo.ANULAR,
        entidadIdParam: 'id',
        resumen: (res, req) => `Pidió cancelar la importación de la remesa ${req.params.id}`,
    })
    cancelar(@Param('id', ParseIntPipe) id: number, @UsuarioActual() user: UsuarioJwt) {
        return this.service.cancelarCarga(id, { sub: user.sub, permisos: user.permisos });
    }

    /** Cancela todo lo que falta de una carga dividida: las que no empezaron primero, la que corre al final. */
    @Post('grupos/:grupoId/cancelar')
    @HttpCode(200)
    @Permisos('importacion.ejecutar')
    @Audit({
        modulo: AuditModulo.IMPORT,
        entidad: 'Remesa',
        tipo: AuditTipo.ANULAR,
        resumen: (res, req) => `Pidió cancelar la carga dividida ${req.params.grupoId}`,
    })
    cancelarGrupo(@Param('grupoId') grupoId: string, @UsuarioActual() user: UsuarioJwt) {
        return this.service.cancelarGrupo(grupoId, { sub: user.sub, permisos: user.permisos });
    }

    /** Vuelve a encolar la MISMA remesa, solo si no cargó ninguna fila (§10.5.4). */
    @Post('remesas/:id/retomar')
    @Permisos('importacion.ejecutar')
    @Audit({
        modulo: AuditModulo.IMPORT,
        entidad: 'Remesa',
        tipo: AuditTipo.IMPORT_START,
        entidadIdParam: 'id',
        resumen: (res, req) => `Retomó la remesa ${req.params.id}`,
    })
    async retomar(@Param('id', ParseIntPipe) id: number, @UsuarioActual() user: UsuarioJwt) {
        const r = await this.service.retomarRemesas({ remesaIds: [id] }, { sub: user.sub, permisos: user.permisos });
        if (!r.cargas[0]) throw new NotFoundException('La importación fue eliminada mientras se retomaba.');
        return { message: 'Importación encolada de nuevo', remesaId: id, carga: r.cargas[0] };
    }

    /** Retoma las remesas de una carga dividida que no cargaron ninguna fila; las demás van en `omitidas`. */
    @Post('grupos/:grupoId/retomar')
    @Permisos('importacion.ejecutar')
    @Audit({
        modulo: AuditModulo.IMPORT,
        entidad: 'Remesa',
        tipo: AuditTipo.IMPORT_START,
        resumen: (res, req) => `Retomó la carga dividida ${req.params.grupoId}`,
    })
    async retomarGrupo(@Param('grupoId') grupoId: string, @UsuarioActual() user: UsuarioJwt) {
        const r = await this.service.retomarRemesas({ grupoId }, { sub: user.sub, permisos: user.permisos });
        return {
            message: 'Importaciones encoladas de nuevo',
            grupoId,
            cargas: r.cargas,
            omitidas: r.omitidas,
            ...(r.noEncoladas.length > 0 ? { noEncoladas: r.noEncoladas } : {}),
        };
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

    /** Estado liviano de una carga (EstadoCargaDto): lo que consultan los hooks del frontend al hacer polling. */
    @Get('remesas/:id/progreso')
    progreso(@Param('id', ParseIntPipe) id: number) {
        return this.service.progreso(id);
    }

    // --- HISTORIAL ---
    /** Una página de remesas de la empresa con el estado real de cada carga (docs/imports-progreso-c2-spec.md §5.1). */
    @Get('historial')
    historial(@Query() q: HistorialQueryDto) {
        return this.service.historial(q);
    }

    // --- ERRORES ---
    @Get('errores/:remesaId')
    getErrors(@Param('remesaId', ParseIntPipe) remesaId: number, @Query() q: ErroresQueryDto) {
        return this.service.getErrors(remesaId, q);
    }

    /** Todos los errores de la carga en un CSV, en streaming. Se audita: trae datos personales de los casos. */
    @Get('errores/:remesaId/csv')
    @Audit({
        modulo: AuditModulo.IMPORT,
        entidad: 'Remesa',
        tipo: AuditTipo.REPORTE_DESCARGAR,
        entidadIdParam: 'remesaId',
        resumen: (res, req) => `Descargó el CSV de errores de la remesa ${req.params.remesaId}`,
        data: (res, req) => ({ tipo: req.query?.tipo ?? 'TODOS' }),
    })
    async erroresCsv(
        @Param('remesaId', ParseIntPipe) remesaId: number,
        @Query() q: ErroresQueryDto,
        @Res() res: Response,
    ) {
        // Si falla con la respuesta ya empezada, el servicio la destruye y relanza: el error sigue hasta la auditoría
        // (queda FALLIDO, no "Descargó") y Nest no intenta contestar porque los encabezados ya salieron.
        await this.service.erroresCsv(remesaId, q.tipo ?? 'TODOS', res);
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
        @Query('rev') rev?: string,
    ) {
        const u = { sub: user.sub, permisos: user.permisos };
        if (rev == null || rev === '') return this.service.deleteRemesa(id, u);
        const revEsperado = Number(rev);
        if (!Number.isInteger(revEsperado) || revEsperado < 0) throw new BadRequestException('rev inválido');
        return this.service.deleteRemesa(id, u, { revEsperado });
    }
}
