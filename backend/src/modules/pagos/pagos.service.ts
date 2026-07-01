import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DeudorBloqueoService } from '../deudores/utils/deudor-bloqueo';
import { ConsolidacionSituacionService } from '../consolidacion/consolidacion.service';
import { PromesasService } from '../promesas/promesas.service';
import { CreatePagoDto } from './dtos/create-pago.dto';

/**
 * Carga manual de pagos reales (docs/pagos-promesas-spec.md §4).
 * Al crear/eliminar se consolida el deudor (recalcula saldo + código). Los pagos
 * manuales (origen='MANUAL') pueden luego ser "confirmados" por una bajada (§3.1).
 */
@Injectable()
export class PagosService {
    private readonly logger = new Logger(PagosService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly bloqueo: DeudorBloqueoService,
        private readonly consolidacion: ConsolidacionSituacionService,
        private readonly promesas: PromesasService,
    ) {}

    async findByDeudor(deudorId: number) {
        return this.prisma.pago.findMany({
            where: { deudorId },
            include: { usuario: { select: { id: true, nombre: true } } },
            orderBy: { fecha: 'desc' },
        });
    }

    async crearManual(dto: CreatePagoDto, usuarioId?: number) {
        const t0 = Date.now();
        await this.bloqueo.assertNoBloqueado(dto.deudorId, 'cargar pago'); // regla 6

        const deudor = await this.prisma.deudor.findUnique({
            where: { id: dto.deudorId },
            select: { id: true },
        });
        if (!deudor) throw new NotFoundException(`Deudor ${dto.deudorId} no encontrado`);

        this.logger.log(`Cargando pago manual deudor=${dto.deudorId} importe=${dto.importe}`);

        const pago = await this.prisma.pago.create({
            data: {
                deudorId: dto.deudorId,
                fecha: new Date(dto.fecha),
                importe: dto.importe,
                observacion: dto.observacion ?? null,
                origen: 'MANUAL',
                usuarioId: usuarioId ?? null,
            },
        });

        // Recalcular saldo + código (idempotente)
        await this.consolidacion.consolidar({ tipo: 'DEUDORES', deudorIds: [dto.deudorId] });
        // Cerrar promesa VIGENTE si este pago la cumple
        await this.promesas.cerrarCumplidas([dto.deudorId]);

        this.logger.log(`Pago manual creado id=${pago.id} deudor=${dto.deudorId} en ${Date.now() - t0}ms`);
        return pago;
    }

    async eliminar(id: number, _usuarioId?: number) {
        const pago = await this.prisma.pago.findUnique({ where: { id } });
        if (!pago) throw new NotFoundException(`Pago ${id} no encontrado`);

        // I8: solo se eliminan pagos manuales (los de import los re-crearía la próxima bajada)
        if (pago.origen !== 'MANUAL') {
            this.logger.warn(`Intento de eliminar pago no-MANUAL id=${id} origen=${pago.origen}`);
            throw new BadRequestException('Solo se pueden eliminar pagos cargados manualmente.');
        }

        await this.bloqueo.assertNoBloqueado(pago.deudorId, 'eliminar pago'); // regla 6

        await this.prisma.pago.delete({ where: { id } });

        // Reconciliar. Ojo: la consolidación saltea deudores con Σpagos=0 (no revierte),
        // así que si al borrar no quedan pagos hay que revertir a mano (spec/edge).
        const agg = await this.prisma.pago.aggregate({
            where: { deudorId: pago.deudorId },
            _sum: { importe: true },
        });
        const restante = agg._sum.importe ?? 0;
        if (restante > 0) {
            await this.consolidacion.consolidar({ tipo: 'DEUDORES', deudorIds: [pago.deudorId] });
        } else {
            await this.revertirSinPagos(pago.deudorId);
        }

        this.logger.log(`Pago manual eliminado id=${id} deudor=${pago.deudorId} restante=${restante}`);
        return { id, deleted: true };
    }

    /**
     * El deudor quedó sin pagos: resetear el saldo persistido y, si el código actual
     * es de consolidación (SIT-041/SIT-050), devolverlo al default de la plantilla
     * (estado "sin pagos"). La consolidación no hace esto porque saltea Σpagos=0.
     */
    private async revertirSinPagos(deudorId: number): Promise<void> {
        const deudor = await this.prisma.deudor.findUnique({
            where: { id: deudorId },
            select: {
                estadoSituacion: { select: { clave: true } },
                remesa: { select: { plantilla: { select: { defaultEstadoSituacionId: true } } } },
            },
        });

        const data: { saldo: null; situacionConsolidadaEn: Date; estadoSituacionId?: number } = {
            saldo: null,
            situacionConsolidadaEn: new Date(),
        };

        const clave = deudor?.estadoSituacion?.clave;
        const defaultSit = deudor?.remesa?.plantilla?.defaultEstadoSituacionId ?? null;
        if ((clave === 'SIT-041' || clave === 'SIT-050') && defaultSit) {
            data.estadoSituacionId = defaultSit;
        }

        await this.prisma.deudor.update({ where: { id: deudorId }, data });
        this.logger.log(
            `Deudor ${deudorId} sin pagos: saldo reseteado${data.estadoSituacionId ? ` + situación → default(${defaultSit})` : ''}`,
        );
    }
}
