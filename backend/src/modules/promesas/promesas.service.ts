import {
    Injectable,
    Logger,
    OnModuleInit,
    NotFoundException,
    BadRequestException,
    ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DeudorBloqueoService } from '../deudores/utils/deudor-bloqueo';
import { AuditoriaHelper } from '../transacciones/auditoria.helper';
import { AuditModulo, AuditTipo } from '../transacciones/audit.enums';
import { CreatePromesaDto } from './dtos/create-promesa.dto';

/**
 * Gestión de promesas de pago (ver docs/pagos-promesas-spec.md §5).
 *
 * - Crear promesa: se registra siempre; el código pasa a SIT-020 SOLO si Σpagos=0.
 * - Cumplimiento: si Σpagos supera el snapshot `pagosAlCrear` → CUMPLIDA (código lo pone la consolidación).
 * - Vencimiento (cron): sin pago → INCUMPLIDA; SIT-021 solo si el deudor sigue en SIT-020.
 *
 * NO modifica la lógica de consolidación.
 */
@Injectable()
export class PromesasService implements OnModuleInit {
    private readonly logger = new Logger(PromesasService.name);
    private sit020Id: number | null = null;
    private sit021Id: number | null = null;
    private procesandoVencidas = false; // guard simple contra corridas concurrentes (cron + endpoint)

    private static readonly EPS = 1; // ruido de float (1 peso)
    private static readonly DEFAULT_MAX_DIAS = 7;

    constructor(
        private readonly prisma: PrismaService,
        private readonly bloqueo: DeudorBloqueoService,
        private readonly auditoria: AuditoriaHelper,
    ) {}

    async onModuleInit(): Promise<void> {
        const [s020, s021] = await Promise.all([
            this.prisma.parametro.findUnique({ where: { clave: 'SIT-020' } }),
            this.prisma.parametro.findUnique({ where: { clave: 'SIT-021' } }),
        ]);
        this.sit020Id = s020?.id ?? null;
        this.sit021Id = s021?.id ?? null;
        if (!this.sit020Id || !this.sit021Id) {
            this.logger.warn(
                `SIT-020/SIT-021 no seedeados (sit020=${this.sit020Id} sit021=${this.sit021Id}) — promesas en modo degradado`,
            );
        } else {
            this.logger.log(`Promesas: SIT cacheados sit020Id=${this.sit020Id} sit021Id=${this.sit021Id}`);
        }
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    private async sumPagos(deudorId: number): Promise<number> {
        const agg = await this.prisma.pago.aggregate({
            where: { deudorId },
            _sum: { importe: true },
        });
        return agg._sum.importe ?? 0;
    }

    /** Σpagos por deudor para un conjunto (una sola query agregada). */
    private async sumPagosPorDeudor(deudorIds: number[]): Promise<Map<number, number>> {
        const rows = await this.prisma.pago.groupBy({
            by: ['deudorId'],
            where: { deudorId: { in: deudorIds } },
            _sum: { importe: true },
        });
        const map = new Map<number, number>();
        for (const r of rows) map.set(r.deudorId, r._sum.importe ?? 0);
        return map;
    }

    private async maxDiasEmpresa(empresaId: number): Promise<number> {
        const emp = await this.prisma.empresa.findUnique({
            where: { id: empresaId },
            select: { configuracion: true },
        });
        const cfg = emp?.configuracion as any;
        const v = cfg?.promesa_pago?.maxDias;
        if (typeof v === 'number' && v >= 1 && v <= 30) return v;
        return PromesasService.DEFAULT_MAX_DIAS;
    }

    // ─── Lectura ──────────────────────────────────────────────────────────────

    async findByDeudor(deudorId: number) {
        return this.prisma.promesa_pago.findMany({
            where: { deudorId },
            include: { usuario: { select: { id: true, nombre: true } } },
            orderBy: { createdAt: 'desc' },
        });
    }

    // ─── Crear ────────────────────────────────────────────────────────────────

    async crear(dto: CreatePromesaDto, usuarioId?: number) {
        if (!this.sit020Id) {
            throw new BadRequestException('El código SIT-020 no está configurado; no se pueden cargar promesas.');
        }
        await this.bloqueo.assertNoBloqueado(dto.deudorId, 'cargar promesa'); // regla 6

        const deudor = await this.prisma.deudor.findUnique({
            where: { id: dto.deudorId },
            select: { id: true, empresaId: true, estadoSituacionId: true },
        });
        if (!deudor) throw new NotFoundException(`Deudor ${dto.deudorId} no encontrado`);

        const fechaPromesa = new Date(dto.fechaPromesa);
        if (isNaN(fechaPromesa.getTime())) throw new BadRequestException('fechaPromesa inválida');

        const hoy0 = new Date();
        hoy0.setHours(0, 0, 0, 0);
        if (fechaPromesa < hoy0) {
            throw new BadRequestException('La fecha de promesa no puede ser anterior a hoy.');
        }
        const maxDias = await this.maxDiasEmpresa(deudor.empresaId);
        const limite = new Date();
        limite.setHours(23, 59, 59, 999);
        limite.setDate(limite.getDate() + maxDias);
        if (fechaPromesa > limite) {
            throw new BadRequestException(`La fecha de promesa no puede superar los ${maxDias} días.`);
        }

        const sumPagos = await this.sumPagos(deudor.id);
        const situActual = deudor.estadoSituacionId ?? null;
        const cambiaCodigo = sumPagos === 0; // regla 5

        const t0 = Date.now();
        const promesa = await this.prisma.$transaction(async (tx) => {
            // Superseder la VIGENTE previa (una sola VIGENTE por deudor)
            const vigente = await tx.promesa_pago.findFirst({
                where: { deudorId: deudor.id, estado: 'VIGENTE' },
            });

            let cambioSit020 = cambiaCodigo;
            let situacionAnteriorId: number | null = cambiaCodigo ? situActual : null;

            if (vigente) {
                if (vigente.cambioSit020) {
                    // El código actual ya es SIT-020 por la promesa previa: heredar su "anterior".
                    cambioSit020 = true;
                    situacionAnteriorId = vigente.situacionAnteriorId;
                }
                await tx.promesa_pago.update({
                    where: { id: vigente.id },
                    data: { estado: 'ANULADA', cerradaEn: new Date() },
                });
            }

            // Cambio condicional del código a SIT-020 (optimistic lock contra race con consolidación)
            if (cambioSit020) {
                const res = await tx.deudor.updateMany({
                    where: { id: deudor.id, estadoSituacionId: situActual },
                    data: { estadoSituacionId: this.sit020Id },
                });
                if (res.count === 0) {
                    throw new ConflictException({
                        code: 'SITUACION_CAMBIO',
                        message: 'La situación del deudor cambió mientras cargabas la promesa. Refrescá la ficha e intentá de nuevo.',
                    });
                }
            }

            return tx.promesa_pago.create({
                data: {
                    deudorId: deudor.id,
                    usuarioId: usuarioId ?? null,
                    fechaPromesa,
                    monto: dto.monto ?? null,
                    estado: 'VIGENTE',
                    cambioSit020,
                    situacionAnteriorId,
                    pagosAlCrear: sumPagos,
                    observacion: dto.observacion ?? null,
                },
                include: { usuario: { select: { id: true, nombre: true } } },
            });
        });

        this.logger.log(
            `Promesa creada id=${promesa.id} deudor=${deudor.id} fecha=${dto.fechaPromesa} cambioSit020=${cambiaCodigo} en ${Date.now() - t0}ms`,
        );
        return promesa;
    }

    // ─── Anular ───────────────────────────────────────────────────────────────

    async anular(id: number, _usuarioId?: number) {
        const promesa = await this.prisma.promesa_pago.findUnique({ where: { id } });
        if (!promesa) throw new NotFoundException(`Promesa ${id} no encontrada`);
        if (promesa.estado !== 'VIGENTE') {
            throw new BadRequestException(`La promesa ya está en estado ${promesa.estado}`);
        }

        await this.prisma.promesa_pago.update({
            where: { id },
            data: { estado: 'ANULADA', cerradaEn: new Date() },
        });

        // Revertir el código solo si esta promesa lo había cambiado a SIT-020 y el deudor sigue ahí.
        if (promesa.cambioSit020 && this.sit020Id) {
            const deudor = await this.prisma.deudor.findUnique({
                where: { id: promesa.deudorId },
                select: { estadoSituacionId: true },
            });
            if (deudor?.estadoSituacionId === this.sit020Id) {
                if (promesa.situacionAnteriorId != null) {
                    const anterior = await this.prisma.parametro.findUnique({
                        where: { id: promesa.situacionAnteriorId },
                        select: { id: true, activo: true },
                    });
                    if (anterior?.activo) {
                        await this.prisma.deudor.update({
                            where: { id: promesa.deudorId },
                            data: { estadoSituacionId: anterior.id },
                        });
                    } else {
                        this.logger.warn(
                            `Anular promesa ${id}: situacionAnteriorId=${promesa.situacionAnteriorId} inactivo/inexistente; no se restaura código.`,
                        );
                    }
                } else {
                    this.logger.warn(`Anular promesa ${id}: sin situacionAnterior; deudor queda en SIT-020.`);
                }
            }
        }

        this.logger.log(`Promesa ${id} anulada (deudor ${promesa.deudorId})`);
        return { id, estado: 'ANULADA' };
    }

    // ─── Cierre por cumplimiento (llamado tras registrar pagos) ─────────────────

    /**
     * Marca CUMPLIDA toda promesa VIGENTE de estos deudores cuya deuda pagada
     * superó el snapshot `pagosAlCrear`. El código de situación lo pone la
     * consolidación (SIT-041/050). Idempotente.
     */
    async cerrarCumplidas(deudorIds: number[]): Promise<number> {
        if (!deudorIds.length) return 0;
        const vigentes = await this.prisma.promesa_pago.findMany({
            where: { estado: 'VIGENTE', deudorId: { in: deudorIds } },
        });
        if (!vigentes.length) return 0;

        const sums = await this.sumPagosPorDeudor([...new Set(vigentes.map((p) => p.deudorId))]);
        let cerradas = 0;
        for (const p of vigentes) {
            const sum = sums.get(p.deudorId) ?? 0;
            if (sum > p.pagosAlCrear + PromesasService.EPS) {
                await this.prisma.promesa_pago.update({
                    where: { id: p.id },
                    data: { estado: 'CUMPLIDA', cerradaEn: new Date() },
                });
                cerradas++;
            }
        }
        if (cerradas > 0) this.logger.log(`cerrarCumplidas: ${cerradas} promesa(s) marcada(s) CUMPLIDA`);
        return cerradas;
    }

    // ─── Vencidas (cron / endpoint manual) ──────────────────────────────────────

    async procesarVencidas(): Promise<{ evaluadas: number; cumplidas: number; incumplidas: number }> {
        if (this.procesandoVencidas) {
            this.logger.warn('procesarVencidas ya en curso; se omite esta corrida.');
            return { evaluadas: 0, cumplidas: 0, incumplidas: 0 };
        }
        this.procesandoVencidas = true;
        try {
            const hoy0 = new Date();
            hoy0.setHours(0, 0, 0, 0);

            const vencidas = await this.prisma.promesa_pago.findMany({
                where: { estado: 'VIGENTE', fechaPromesa: { lt: hoy0 } },
            });
            if (!vencidas.length) return { evaluadas: 0, cumplidas: 0, incumplidas: 0 };

            const sums = await this.sumPagosPorDeudor([...new Set(vencidas.map((p) => p.deudorId))]);
            let cumplidas = 0;
            let incumplidas = 0;

            for (const p of vencidas) {
                const sum = sums.get(p.deudorId) ?? 0;
                if (sum > p.pagosAlCrear + PromesasService.EPS) {
                    // Cumplió: entró un pago después de crear la promesa (código lo puso la consolidación)
                    await this.prisma.promesa_pago.update({
                        where: { id: p.id },
                        data: { estado: 'CUMPLIDA', cerradaEn: new Date() },
                    });
                    cumplidas++;
                } else {
                    await this.prisma.promesa_pago.update({
                        where: { id: p.id },
                        data: { estado: 'INCUMPLIDA', cerradaEn: new Date() },
                    });
                    // SIT-021 solo si el deudor sigue en SIT-020 (no pisa códigos por pagos)
                    if (this.sit020Id && this.sit021Id) {
                        await this.prisma.deudor.updateMany({
                            where: { id: p.deudorId, estadoSituacionId: this.sit020Id },
                            data: { estadoSituacionId: this.sit021Id },
                        });
                    }
                    incumplidas++;
                }
            }

            this.logger.log(
                `procesarVencidas: evaluadas=${vencidas.length} cumplidas=${cumplidas} incumplidas=${incumplidas}`,
            );
            // La corrida queda auditada. El `@Audit` estaba en el controller, así que solo dejaba
            // rastro el disparo manual: la corrida nocturna —que es la que mueve los estados casi
            // siempre— no registraba nada y Auditoría no podía explicar esos cambios.
            await this.auditoria.log({
                modulo: AuditModulo.GESTION,
                entidad: 'PromesaPago',
                tipo: AuditTipo.EJECUTAR,
                resumen:
                    `Procesó promesas vencidas: ${vencidas.length} evaluadas, ` +
                    `${cumplidas} cumplida(s), ${incumplidas} incumplida(s)`,
                data: {
                    contexto: { evaluadas: vencidas.length, cumplidas, incumplidas },
                    // Los casos afectados, para poder cruzarlo desde la ficha.
                    params: { deudorIds: [...new Set(vencidas.map((p) => p.deudorId))] },
                },
            });

            return { evaluadas: vencidas.length, cumplidas, incumplidas };
        } finally {
            this.procesandoVencidas = false;
        }
    }
}
