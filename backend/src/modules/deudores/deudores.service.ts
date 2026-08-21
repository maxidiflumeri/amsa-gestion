import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { deudor, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateDeudorDto } from './dtos/create-deudor.dto';
import { UpdateDeudorDto } from './dtos/update-deudor.dto';
import { AdvancedSearchDto } from './dtos/advanced-search.dto';
import { DeudorBloqueoService } from './utils/deudor-bloqueo';
import { normalizarTelefonoArgentino } from '../../common/utils/phone-utils';

/** Tope de filas de la búsqueda avanzada. El total real se devuelve aparte. */
const LIMITE_BUSQUEDA_AVANZADA = 200;

@Injectable()
export class DeudoresService {
    private readonly logger = new Logger(DeudoresService.name);

    constructor(
        private prisma: PrismaService,
        private bloqueo: DeudorBloqueoService,
    ) { }

    async findAll(page?: number, limit?: number, search?: string) {
        let where: Prisma.deudorWhereInput = {};

        if (search) {
            where = {
                OR: [
                    { nombre: { contains: search } },
                    { apellido: { contains: search } },
                    { documento: { contains: search } },
                ],
            };

            const searchAsId = Number(search);
            if (!isNaN(searchAsId) && searchAsId > 0) {
                // Si el término de búsqueda puede ser un ID válido numérico, lo agregamos al OR.
                (where.OR as any[]).push({ id: searchAsId });
            }
        }

        if (page && limit) {
            const skip = (page - 1) * limit;
            const take = limit;

            const [data, total] = await Promise.all([
                this.prisma.deudor.findMany({
                    skip,
                    take,
                    where,
                    include: { empresa: true, remesa: true },
                }),
                this.prisma.deudor.count({ where }),
            ]);

            return {
                data,
                meta: {
                    total,
                    page,
                    limit,
                    totalPages: Math.ceil(total / limit),
                },
            };
        } else {
            const data = await this.prisma.deudor.findMany({
                where,
                include: { empresa: true, remesa: true },
            });
            return {
                data,
                meta: {
                    total: data.length,
                    page: 1,
                    limit: data.length,
                    totalPages: 1,
                },
            };
        }
    }

    async searchAdvanced(dto: AdvancedSearchDto) {
        const andConditions: Prisma.deudorWhereInput[] = [];

        if (dto.id) {
            andConditions.push({ id: dto.id });
        }
        if (dto.nombre) {
            andConditions.push({ nombre: { contains: dto.nombre } });
        }
        if (dto.apellido) {
            andConditions.push({ apellido: { contains: dto.apellido } });
        }
        if (dto.documento) {
            andConditions.push({ documento: { contains: dto.documento } });
        }
        if (dto.empresa) {
            // Match EXACTO: el valor viene de un combo de empresas, no de texto libre. Con `contains`,
            // filtrar "FIAT" también traía "FIAT PLAN" y "TELECOM" traía "TELECOM_PERSONAL".
            andConditions.push({ empresa: { nombre: { equals: dto.empresa } } });
        }
        if (dto.nroCliente) {
            // Columna principal nroCliente + fallback a datos viejos (campoExtras / camposAdicionales)
            andConditions.push({
                OR: [
                    { nroCliente: { contains: dto.nroCliente } },
                    { campoExtras: { some: { valor: { contains: dto.nroCliente } } } },
                    { camposAdicionales: { string_contains: dto.nroCliente } }
                ]
            });
        }
        if (dto.nroRemesa) {
            andConditions.push({ remesa: { numeroRemesa: { contains: dto.nroRemesa } } });
        }
        if (dto.email) {
            andConditions.push({ contactos: { some: { tipo: 'email', valor: { contains: dto.email } } } });
        }
        if (dto.telefono) {
            andConditions.push({ contactos: { some: { tipo: 'telefono', OR: this.candidatosTelefono(dto.telefono) } } });
        }

        const where: Prisma.deudorWhereInput = andConditions.length > 0 ? { AND: andConditions } : {};

        // Se devuelve el total además de las filas: antes cortaba en 50 en silencio, así que una
        // búsqueda floja parecía tener 50 resultados y el caso buscado podía estar afuera sin que
        // nada lo dijera. No se pagina a propósito — esto es "encontrá un caso", no un listado: lo
        // útil es saber que hay que afinar la búsqueda.
        const [items, total] = await this.prisma.$transaction([
            this.prisma.deudor.findMany({
                where,
                take: LIMITE_BUSQUEDA_AVANZADA,
                include: { empresa: true, remesa: true, contactos: true },
            }),
            this.prisma.deudor.count({ where }),
        ]);

        return { items, total, limite: LIMITE_BUSQUEDA_AVANZADA };
    }

    /**
     * Formas en que un teléfono tipeado puede aparecer en la base.
     *
     * Los contactos se guardan normalizados en E.164 (`+5491155551234`), así que buscar el texto tal
     * cual lo escribe el gestor —`11 5555-1234`— no encontraba nada nunca.
     */
    private candidatosTelefono(entrada: string): Prisma.contactoWhereInput[] {
        const candidatos = new Set<string>([entrada.trim()]);

        // Solo los dígitos: `11 5555-1234` → `1155551234`, que sí es substring del E.164 guardado.
        const soloDigitos = entrada.replace(/\D/g, '');
        if (soloDigitos.length >= 6) candidatos.add(soloDigitos);

        // Y el E.164 completo, por si lo tipeó con área y prefijo.
        const norm = normalizarTelefonoArgentino(entrada);
        if (norm.valido && norm.e164) candidatos.add(norm.e164);

        return [...candidatos].filter(Boolean).map((valor) => ({ valor: { contains: valor } }));
    }

    async getEmpresas() {
        return this.prisma.empresa.findMany({
            select: {
                id: true,
                nombre: true,
            },
            orderBy: { nombre: 'asc' },
        });
    }

    async findOne(id: number): Promise<deudor | null> {
        return this.prisma.deudor.findUnique({
            where: { id },
            include: {
                empresa: true,
                remesa: { include: { politica: true } },
                comentarios: {
                    include: {
                        usuario: true, // 👈 Incluye la relación con Usuario
                    },
                },
                contactos: true,
                facturas: true,
                pagos: true,
                campoExtras: true,
                estadoSituacion: true,
                estadoGestion: true,
                motivoNoPago: true,
            },
        });
    }

    async findByDocumento(documento: string, excludeId?: number) {
        return this.prisma.deudor.findMany({
            where: {
                documento,
                ...(excludeId ? { id: { not: excludeId } } : {}),
            },
            include: {
                empresa: true,
                remesa: true,
                estadoSituacion: true,
                estadoGestion: true,
                motivoNoPago: true,
            },
            orderBy: { createdAt: 'desc' },
        });
    }

    async create(dto: CreateDeudorDto): Promise<deudor> {
        this.logger.log(`Creando deudor documento=${dto.documento} empresaId=${dto.empresaId}`);
        const {
            empresaId,
            remesaId,
            estadoSituacionId,
            estadoGestionId,
            ...rest
        } = dto;

        const d = await this.prisma.deudor.create({
            data: {
                ...rest,
                empresa: { connect: { id: empresaId } },
                remesa: { connect: { id: remesaId } },
                ...(estadoSituacionId && { estadoSituacion: { connect: { id: estadoSituacionId } } }),
                ...(estadoGestionId && { estadoGestion: { connect: { id: estadoGestionId } } }),
            },
        });
        this.logger.log(`Deudor creado id=${d.id} empresaId=${empresaId}`);
        return d;
    }


    async update(id: number, dto: UpdateDeudorDto) {
        this.logger.log(`Actualizando deudor id=${id}`);
        await this.bloqueo.assertNoBloqueado(id, 'actualizar estados');
        const { estadoSituacionClave, estadoGestionClave, motivoNoPagoClave } = dto;

        let data: any = {};

        if (estadoSituacionClave) {
            const estado = await this.prisma.parametro.findUnique({
                where: { clave: estadoSituacionClave },
            });
            if (!estado) throw new NotFoundException('Estado de situación no encontrado');
            data.estadoSituacionId = estado.id;
        }

        if (estadoGestionClave) {
            const gestion = await this.prisma.parametro.findUnique({
                where: { clave: estadoGestionClave },
            });
            if (!gestion) throw new NotFoundException('Estado de gestión no encontrado');
            data.estadoGestionId = gestion.id;
        }

        // Se distingue "no lo mandaron" (undefined → se conserva) de "lo mandaron vacío"
        // (null o '' → se borra). Antes las dos ramas caían en lo mismo, así que **el motivo de no
        // pago no se podía quitar**: una vez cargado quedaba pegado al caso para siempre.
        if (motivoNoPagoClave !== undefined) {
            if (motivoNoPagoClave === null || motivoNoPagoClave === '') {
                data.motivoNoPagoId = null;
            } else {
                const motivo = await this.prisma.parametro.findUnique({
                    where: { clave: motivoNoPagoClave },
                });
                // Antes una clave inexistente se ignoraba en silencio, igual que si no la hubieran
                // mandado: un error de tipeo no cambiaba nada y nadie se enteraba.
                if (!motivo) throw new NotFoundException('Motivo de no pago no encontrado');
                data.motivoNoPagoId = motivo.id;
            }
        }

        const deudor = await this.prisma.deudor.findUnique({ where: { id } });
        if (!deudor) throw new NotFoundException('Deudor no encontrado');

        const updated = await this.prisma.deudor.update({
            where: { id },
            data: {
                estadoSituacionId: data.estadoSituacionId ?? deudor.estadoSituacionId,
                estadoGestionId: data.estadoGestionId ?? deudor.estadoGestionId,
                // `?? ` no sirve acá: `null` es un valor válido —"quitar el motivo"— y `??` lo
                // trataría como "no vino".
                motivoNoPagoId: 'motivoNoPagoId' in data ? data.motivoNoPagoId : deudor.motivoNoPagoId,
            },
            include: {
                estadoSituacion: true,
                estadoGestion: true,
                motivoNoPago: true,
            },
        });

        return { before: deudor, after: updated };
    }

    async delete(id: number): Promise<deudor> {
        this.logger.log(`Eliminando deudor id=${id}`);
        await this.bloqueo.assertNoBloqueado(id, 'eliminar');
        return this.prisma.deudor.delete({
            where: { id },
        });
    }
}