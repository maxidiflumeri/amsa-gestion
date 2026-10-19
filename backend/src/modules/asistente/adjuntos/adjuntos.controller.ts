import {
    Body,
    Catch,
    Controller,
    Delete,
    ExceptionFilter,
    HttpException,
    ArgumentsHost,
    ForbiddenException,
    HttpCode,
    HttpStatus,
    Param,
    ParseIntPipe,
    PayloadTooLargeException,
    Patch,
    Post,
    UploadedFile,
    UseFilters,
    UseInterceptors,
    UnauthorizedException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Permisos, UsuarioActual } from '../../../auth/decorators';
import type { UsuarioJwt } from '../asistente.service';
import { ActualizarAdjuntoDto } from '../dto/adjunto.dto';
import { AdjuntoSubido } from '../dto/asistente.tipos';
import { MENSAJE_SIN_PERMISO_FUNCION } from '../reportes/funcion-reportes';
import { AdjuntosService, leerMaxBytes } from './adjuntos.service';

const MENSAJES_MULTER: Record<string, { status: HttpStatus; codigo: string; mensaje: string }> = {
    'Too many files': { status: HttpStatus.BAD_REQUEST, codigo: 'DEMASIADOS_ARCHIVOS', mensaje: 'Subí un solo archivo por vez.' },
    'Unexpected field': { status: HttpStatus.BAD_REQUEST, codigo: 'CAMPO_INESPERADO', mensaje: 'El archivo tiene que ir en el campo «archivo».' },
    'File too large': { status: HttpStatus.PAYLOAD_TOO_LARGE, codigo: 'DEMASIADO_GRANDE', mensaje: '' },
};

/**
 * Los errores de multer (tamaño, cantidad, campo) salen en inglés y sin código: acá se los pasa a `{codigo, mensaje}` en
 * castellano. Los demás errores del endpoint (que ya traen su `codigo`) salen como estaban.
 */
@Catch(HttpException)
export class ErroresDeSubidaFilter implements ExceptionFilter {
    catch(e: HttpException, host: ArgumentsHost): void {
        const res = host.switchToHttp().getResponse<Response>();
        const cuerpo = e.getResponse();
        if (typeof cuerpo === 'object' && cuerpo !== null && 'codigo' in cuerpo) {
            res.status(e.getStatus()).json(cuerpo);
            return;
        }
        const texto = typeof cuerpo === 'string' ? cuerpo : String((cuerpo as { message?: unknown }).message ?? '');
        const conocido = Object.entries(MENSAJES_MULTER).find(([k]) => texto.startsWith(k))?.[1];
        if (conocido) {
            const mensaje =
                conocido.codigo === 'DEMASIADO_GRANDE'
                    ? `El archivo pesa más de ${Math.round(leerMaxBytes() / 1024 / 1024)} MB. Un ejemplo de formato no necesita tanto: subí un recorte.`
                    : conocido.mensaje;
            res.status(conocido.status).json({ codigo: conocido.codigo, mensaje, message: mensaje });
            return;
        }
        if (e instanceof PayloadTooLargeException) {
            const mensaje = `El archivo pesa más de ${Math.round(leerMaxBytes() / 1024 / 1024)} MB. Un ejemplo de formato no necesita tanto: subí un recorte.`;
            res.status(HttpStatus.PAYLOAD_TOO_LARGE).json({ codigo: 'DEMASIADO_GRANDE', mensaje, message: mensaje });
            return;
        }
        // Cualquier otro error de la subida (multipart mal formado): en castellano y con código.
        if (e.getStatus() === HttpStatus.BAD_REQUEST) {
            const mensaje = 'No pude recibir el archivo. Probá subirlo de nuevo.';
            res.status(HttpStatus.BAD_REQUEST).json({ codigo: 'ARCHIVO_INVALIDO', mensaje, message: mensaje });
            return;
        }
        res.status(e.getStatus()).json(cuerpo);
    }
}

/** El nombre de antes, por los tests y las referencias. */
export const ArchivoGrandeFilter = ErroresDeSubidaFilter;

function usuarioValido(u: UsuarioJwt | undefined): UsuarioJwt {
    if (!u?.sub) throw new UnauthorizedException('Sesión inválida');
    return u;
}

/** Subir un ejemplo pide la función entera: sin poder crear reportes, armar la propuesta es gastar. */
function permisoDeLaFuncion(u: UsuarioJwt): void {
    if (!(u.permisos ?? []).includes('reportes.crear')) {
        const mensaje = MENSAJE_SIN_PERMISO_FUNCION;
        throw new ForbiddenException({ codigo: 'SIN_PERMISO_FUNCION', mensaje, message: mensaje });
    }
}

@Controller('asistente/adjuntos')
@Permisos('asistente.reportes')
export class AdjuntosController {
    constructor(private readonly servicio: AdjuntosService) {}

    // Sin `@Audit`: no cambia nada del sistema, y el body es un archivo (el LoggingInterceptor loguea método y ruta, no el body).
    @Post()
    @UseFilters(ErroresDeSubidaFilter)
    @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: leerMaxBytes(), files: 1 } }))
    subir(@UsuarioActual() u: UsuarioJwt, @UploadedFile() archivo: { buffer: Buffer; originalname: string; size: number } | undefined): Promise<AdjuntoSubido> {
        const user = usuarioValido(u);
        permisoDeLaFuncion(user);
        return this.servicio.subir(user.sub, archivo);
    }

    @Patch(':id')
    actualizar(@UsuarioActual() u: UsuarioJwt, @Param('id', ParseIntPipe) id: number, @Body() dto: ActualizarAdjuntoDto): Promise<AdjuntoSubido> {
        const user = usuarioValido(u);
        permisoDeLaFuncion(user);
        return this.servicio.actualizar(user.sub, id, dto.primeraFilaEsEncabezado);
    }

    @Delete(':id')
    @HttpCode(204)
    async borrar(@UsuarioActual() u: UsuarioJwt, @Param('id', ParseIntPipe) id: number): Promise<void> {
        const user = usuarioValido(u);
        permisoDeLaFuncion(user);
        await this.servicio.borrar(user.sub, id);
    }
}
