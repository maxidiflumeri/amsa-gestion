import {
    ForbiddenException,
    Injectable,
    Logger,
    UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaHelper } from '../modules/transacciones/auditoria.helper';
import { AuditEstado, AuditModulo, AuditSeveridad, AuditTipo } from '../modules/transacciones/audit.enums';

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);

    constructor(
        private readonly jwtService: JwtService,
        private readonly prisma: PrismaService,
        private readonly auditoria: AuditoriaHelper,
    ) {}

    async loginWithGoogle(idToken: string, ctx?: { ip?: string; userAgent?: string }) {
        const ticket = await client.verifyIdToken({
            idToken,
            audience: process.env.GOOGLE_CLIENT_ID,
        });

        const payload = ticket.getPayload();
        if (!payload) throw new UnauthorizedException('Token de Google inválido');

        const { email, name, picture } = payload;

        if (!email) throw new UnauthorizedException('No se pudo obtener el email de Google');
        if (!name) throw new UnauthorizedException('No se pudo obtener el nombre del usuario');

        const usuarioExistente = await this.prisma.usuario.findUnique({
            where: { email },
            include: { rolObj: { select: { nombre: true, permisos: true } } },
        });

        if (!usuarioExistente) {
            this.logger.warn(`Login rechazado — usuario no dado de alta: ${email}`);
            await this.auditoria.log({
                modulo: AuditModulo.AUTH,
                entidad: 'Sesion',
                tipo: AuditTipo.LOGIN_FAIL,
                severidad: AuditSeveridad.WARN,
                estado: AuditEstado.FALLIDO,
                resumen: `Login rechazado — usuario no dado de alta`,
                data: { params: { email }, contexto: { motivo: 'no_existe' } },
                ip: ctx?.ip ?? null,
                userAgent: ctx?.userAgent ?? null,
            });
            throw new ForbiddenException(
                'No tenés acceso al sistema. Pedile al administrador que te dé de alta.',
            );
        }

        if (!usuarioExistente.activo) {
            this.logger.warn(`Login rechazado — usuario inactivo: ${email}`);
            await this.auditoria.log({
                modulo: AuditModulo.AUTH,
                entidad: 'Sesion',
                tipo: AuditTipo.LOGIN_FAIL,
                severidad: AuditSeveridad.WARN,
                estado: AuditEstado.FALLIDO,
                usuarioId: usuarioExistente.id,
                resumen: `Login rechazado — usuario inactivo`,
                data: { params: { email }, contexto: { motivo: 'inactivo' } },
                ip: ctx?.ip ?? null,
                userAgent: ctx?.userAgent ?? null,
            });
            throw new ForbiddenException('Tu cuenta está suspendida. Contactá al administrador.');
        }

        const usuario = await this.prisma.usuario.update({
            where: { email },
            data: { nombre: name, avatarUrl: picture },
            include: { rolObj: { select: { nombre: true, permisos: true } } },
        });

        const permisos: string[] = Array.isArray(usuario.rolObj?.permisos)
            ? (usuario.rolObj.permisos as string[])
            : [];

        const token = this.jwtService.sign(
            {
                sub: usuario.id,
                email: usuario.email,
                rol: usuario.rolObj?.nombre ?? usuario.rol,
                permisos,
            },
        );

        this.logger.log(`Login exitoso: ${email} (rol: ${usuario.rolObj?.nombre ?? usuario.rol})`);

        await this.auditoria.log({
            modulo: AuditModulo.AUTH,
            entidad: 'Sesion',
            tipo: AuditTipo.LOGIN_OK,
            usuarioId: usuario.id,
            resumen: `Login exitoso (${usuario.rolObj?.nombre ?? usuario.rol})`,
            ip: ctx?.ip ?? null,
            userAgent: ctx?.userAgent ?? null,
        });

        return {
            token,
            usuario: {
                id: usuario.id,
                nombre: usuario.nombre,
                email: usuario.email,
                avatarUrl: usuario.avatarUrl,
                rol: usuario.rolObj?.nombre ?? usuario.rol,
                permisos,
            },
        };
    }

    async getMe(sub: number) {
        const usuario = await this.prisma.usuario.findUnique({
            where: { id: sub },
            include: { rolObj: { select: { nombre: true, permisos: true } } },
        });

        if (!usuario || !usuario.activo) {
            throw new UnauthorizedException('Usuario no encontrado o inactivo');
        }

        const permisos: string[] = Array.isArray(usuario.rolObj?.permisos)
            ? (usuario.rolObj.permisos as string[])
            : [];

        return {
            id: usuario.id,
            nombre: usuario.nombre,
            email: usuario.email,
            avatarUrl: usuario.avatarUrl,
            rol: usuario.rolObj?.nombre ?? usuario.rol,
            permisos,
        };
    }
}
