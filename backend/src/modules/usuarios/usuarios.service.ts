import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SipCryptoService } from '../neotel/crypto/sip-crypto.service';
import { UsuarioActivoService } from '../../auth/usuario-activo.service';
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { UpdateUsuarioDto } from './dto/update-usuario.dto';

/** Campos de agente_telefonia que se devuelven al frontend (sin passwords). */
const AGENTE_SELECT = {
    id: true,
    usuarioNeotel: true,
    device: true,
    sipAuthUser: true,
    sipDisplayName: true,
    habilitado: true,
} as const;

/** Campos de usuario que se devuelven en listas y findOne. */
const USUARIO_SELECT = {
    id: true,
    nombre: true,
    email: true,
    legajo: true,
    // Faltaba: el formulario de edición lo mostraba siempre vacío aunque estuviera cargado, así que
    // no había forma de ver ni de corregir el DNI de alguien.
    dni: true,
    avatarUrl: true,
    activo: true,
    rolId: true,
    rolObj: { select: { id: true, nombre: true } },
    agenteTelefonia: { select: AGENTE_SELECT },
    createdAt: true,
} as const;

/** Normaliza DNI/CUIL: quita guiones y espacios. */
function normalizarDni(raw: string): string {
    return raw.replace(/[-\s]/g, '');
}

/** Mapea un usuario de DB a la respuesta esperada por el frontend. */
function mapUsuario(u: {
    id: number;
    nombre: string;
    email: string;
    legajo: string | null;
    dni: string | null;
    avatarUrl: string | null;
    activo: boolean;
    rolId: number | null;
    rolObj: { id: number; nombre: string } | null;
    agenteTelefonia: {
        id: number;
        usuarioNeotel: string;
        device: string;
        sipAuthUser: string;
        sipDisplayName: string | null;
        habilitado: boolean;
    } | null;
    createdAt: Date;
}) {
    return {
        ...u,
        esAgente: u.agenteTelefonia !== null,
        agente: u.agenteTelefonia ?? null,
    };
}

function handlePrismaUniqueViolation(err: unknown): never {
    if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
    ) {
        const fields = (err.meta?.target as string[] | undefined) ?? [];
        if (fields.some((f) => f.includes('email')))
            throw new ConflictException('Ya existe un usuario con ese email');
        if (fields.some((f) => f.includes('legajo')))
            throw new ConflictException('El legajo ya está en uso por otro usuario');
        if (fields.some((f) => f.includes('dni')))
            throw new ConflictException('El DNI/CUIL ya está en uso por otro usuario');
        throw new ConflictException('Dato duplicado: ya existe un registro con ese valor');
    }
    throw err;
}

@Injectable()
export class UsuariosService {
    private readonly logger = new Logger(UsuariosService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly crypto: SipCryptoService,
        private readonly usuarioActivo: UsuarioActivoService,
    ) {}

    async findAll() {
        const usuarios = await this.prisma.usuario.findMany({
            select: USUARIO_SELECT,
            orderBy: { nombre: 'asc' },
        });
        return usuarios.map(mapUsuario);
    }

    async findOne(id: number) {
        const usuario = await this.prisma.usuario.findUnique({
            where: { id },
            select: {
                ...USUARIO_SELECT,
                rolObj: { select: { id: true, nombre: true, permisos: true } },
            },
        });
        if (!usuario) throw new NotFoundException(`Usuario ${id} no encontrado`);
        return mapUsuario(usuario);
    }

    async create(dto: CreateUsuarioDto) {
        const dniNormalizado = dto.dni ? normalizarDni(dto.dni) : undefined;

        this.logger.log(`Creando usuario: ${dto.email}`);
        try {
            return await this.prisma.$transaction(async (tx) => {
                const usuario = await tx.usuario.create({
                    data: {
                        nombre: dto.nombre,
                        email: dto.email,
                        rolId: dto.rolId ?? null,
                        activo: dto.activo ?? true,
                        legajo: dto.legajo?.trim() || null,
                        dni: dniNormalizado || null,
                        updatedAt: new Date(),
                    },
                    select: USUARIO_SELECT,
                });

                if (dto.esAgente && dto.agente) {
                    const ag = dto.agente;
                    await tx.agente_telefonia.create({
                        data: {
                            usuarioId: usuario.id,
                            usuarioNeotel: ag.usuarioNeotel,
                            claveNeotelEnc: this.crypto.encrypt(ag.claveNeotel),
                            device: ag.device,
                            sipAuthUser: ag.sipAuthUser,
                            sipPasswordEnc: this.crypto.encrypt(ag.sipPassword),
                            sipDisplayName: ag.sipDisplayName ?? null,
                            habilitado: ag.habilitado ?? true,
                        },
                    });
                    this.logger.log(
                        `Agente de telefonía creado para usuario ${usuario.id} (${usuario.email})`,
                    );
                }

                // Re-leer con el agente ya creado
                const completo = await tx.usuario.findUniqueOrThrow({
                    where: { id: usuario.id },
                    select: USUARIO_SELECT,
                });
                return mapUsuario(completo);
            });
        } catch (err) {
            handlePrismaUniqueViolation(err);
        }
    }

    async update(id: number, dto: UpdateUsuarioDto) {
        await this.findOne(id);
        // `undefined` conserva; `null` o `''` borran. Antes las dos ramas caían en `undefined`, así
        // que un DNI cargado no se podía dejar vacío nunca.
        const dniNormalizado =
            dto.dni === undefined ? undefined : dto.dni === null || dto.dni === '' ? null : normalizarDni(dto.dni);

        this.logger.log(`Actualizando usuario: ${id}`);
        try {
            return await this.prisma.$transaction(async (tx) => {
                // Construir datos de usuario
                const dataUsuario: Record<string, unknown> = { updatedAt: new Date() };
                if (dto.nombre   !== undefined) dataUsuario.nombre  = dto.nombre;
                if (dto.rolId    !== undefined) dataUsuario.rolId   = dto.rolId;
                if (dto.activo   !== undefined) dataUsuario.activo  = dto.activo;
                if (dto.legajo   !== undefined) dataUsuario.legajo  = dto.legajo?.trim() || null;
                if (dniNormalizado !== undefined) dataUsuario.dni   = dniNormalizado;
                // El email es la credencial de login: un error de tipeo en el alta dejaba a la
                // persona sin poder entrar y sin forma de arreglarlo desde la pantalla. La unicidad
                // la sigue verificando la base.
                if (dto.email !== undefined) dataUsuario.email = dto.email.trim();

                await tx.usuario.update({
                    where: { id },
                    data: dataUsuario as Prisma.usuarioUpdateInput,
                });

                // Lógica agente_telefonia
                const agenteExistente = await tx.agente_telefonia.findUnique({
                    where: { usuarioId: id },
                });

                if (dto.esAgente === true) {
                    if (agenteExistente) {
                        // Actualizar agente existente
                        const ag = dto.agente ?? {};
                        const dataAgente: Record<string, unknown> = { updatedAt: new Date() };
                        if (ag.usuarioNeotel  !== undefined) dataAgente.usuarioNeotel  = ag.usuarioNeotel;
                        if (ag.device         !== undefined) dataAgente.device         = ag.device;
                        if (ag.sipAuthUser    !== undefined) dataAgente.sipAuthUser    = ag.sipAuthUser;
                        if (ag.sipDisplayName !== undefined) dataAgente.sipDisplayName = ag.sipDisplayName;
                        if (ag.habilitado     !== undefined) dataAgente.habilitado     = ag.habilitado;
                        // Solo recifrar passwords si vienen con valor
                        if (ag.claveNeotel && ag.claveNeotel.trim()) {
                            dataAgente.claveNeotelEnc = this.crypto.encrypt(ag.claveNeotel);
                        }
                        if (ag.sipPassword && ag.sipPassword.trim()) {
                            dataAgente.sipPasswordEnc = this.crypto.encrypt(ag.sipPassword);
                        }
                        await tx.agente_telefonia.update({
                            where: { usuarioId: id },
                            data: dataAgente as Prisma.agente_telefoniaUpdateInput,
                        });
                        this.logger.log(`Agente de telefonía actualizado para usuario ${id}`);
                    } else {
                        // Crear agente nuevo — todos los campos obligatorios
                        const ag = dto.agente;
                        if (
                            !ag ||
                            !ag.usuarioNeotel ||
                            !ag.device ||
                            !ag.sipAuthUser ||
                            !ag.claveNeotel ||
                            !ag.sipPassword
                        ) {
                            throw new BadRequestException(
                                'Para habilitar telefonía se requieren: usuarioNeotel, device, sipAuthUser, claveNeotel y sipPassword',
                            );
                        }
                        const usuarioNeotel = ag.usuarioNeotel as string;
                        const device        = ag.device as string;
                        const sipAuthUser   = ag.sipAuthUser as string;
                        const claveNeotel   = ag.claveNeotel as string;
                        const sipPassword   = ag.sipPassword as string;
                        await tx.agente_telefonia.create({
                            data: {
                                usuarioId: id,
                                usuarioNeotel,
                                claveNeotelEnc: this.crypto.encrypt(claveNeotel),
                                device,
                                sipAuthUser,
                                sipPasswordEnc: this.crypto.encrypt(sipPassword),
                                sipDisplayName: ag.sipDisplayName ?? null,
                                habilitado: ag.habilitado ?? true,
                            },
                        });
                        this.logger.log(`Agente de telefonía creado para usuario ${id}`);
                    }
                } else if (dto.esAgente === false && agenteExistente) {
                    // Borrar el agente
                    await tx.agente_telefonia.delete({ where: { usuarioId: id } });
                    this.logger.log(`Agente de telefonía eliminado para usuario ${id}`);
                }

                const completo = await tx.usuario.findUniqueOrThrow({
                    where: { id },
                    select: USUARIO_SELECT,
                });
                return mapUsuario(completo);
            });
        } catch (err) {
            handlePrismaUniqueViolation(err);
        } finally {
            // Corta la sesión abierta en el momento si se lo desactivó, sin esperar al TTL de la
            // caché. Va en `finally` porque una violación de unicidad puede haber tocado el usuario
            // igual antes de fallar en el agente.
            this.usuarioActivo.invalidar(id);
        }
    }

    /**
     * Borra un usuario, **solo si nunca hizo nada**.
     *
     * Las FKs que apuntan al usuario son casi todas `ON DELETE SET NULL`, así que el borrado
     * funcionaba: no fallaba, se llevaba puesta la trazabilidad. Sus comentarios, pagos, promesas,
     * convenios y registros de auditoría quedaban huérfanos y pasaban a figurar como "Sistema", en
     * silencio y sin vuelta atrás. Justo lo contrario de lo que una bitácora inmutable promete.
     *
     * Para dar de baja a alguien está el interruptor **activo**, que además ahora corta la sesión
     * abierta (ver `UsuarioActivoService`). Esto queda para el alta equivocada que nunca se usó.
     */
    async remove(id: number) {
        const usuario = await this.findOne(id);

        const [comentarios, pagos, promesas, transacciones, convenios, remesas, ejecuciones, envios] =
            await Promise.all([
                this.prisma.comentario.count({ where: { usuarioId: id } }),
                this.prisma.pago.count({ where: { usuarioId: id } }),
                this.prisma.promesa_pago.count({ where: { usuarioId: id } }),
                this.prisma.transaccion.count({ where: { usuarioId: id } }),
                this.prisma.convenio.count({ where: { usuarioId: id } }),
                this.prisma.remesa.count({ where: { usuarioCreadorId: id } }),
                this.prisma.ejecucion_reporte.count({ where: { usuarioId: id } }),
                this.prisma.envio_email.count({ where: { usuarioId: id } }),
            ]);

        // Singular y plural explícitos: agregarle una "s" al final da "69 registro de auditorías".
        const actividad: Array<[string, string, number]> = [
            ['comentario', 'comentarios', comentarios],
            ['pago', 'pagos', pagos],
            ['promesa', 'promesas', promesas],
            ['registro de auditoría', 'registros de auditoría', transacciones],
            ['convenio', 'convenios', convenios],
            ['importación', 'importaciones', remesas],
            ['ejecución de reporte', 'ejecuciones de reporte', ejecuciones],
            ['email enviado', 'emails enviados', envios],
        ];
        const conActividad = actividad.filter(([, , n]) => n > 0);

        if (conActividad.length > 0) {
            const detalle = conActividad.map(([uno, varios, n]) => `${n} ${n === 1 ? uno : varios}`).join(', ');
            this.logger.warn(`Borrado de usuario ${id} rechazado — tiene actividad: ${detalle}`);
            throw new ConflictException(
                `No se puede eliminar a ${usuario.nombre}: tiene ${detalle}. Borrarlo dejaría ` +
                `esos registros sin autor. Para darle de baja, desactivalo con el interruptor.`,
            );
        }

        this.logger.log(`Eliminando usuario: ${id} (${usuario.email}) — sin actividad registrada`);
        await this.prisma.usuario.delete({ where: { id } });
        this.usuarioActivo.invalidar(id);
        return { mensaje: 'Usuario eliminado correctamente' };
    }
}
