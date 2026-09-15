import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailSenderService } from '../email-sender/email-sender.service';
import { resolverConfigMulticlaves } from './utils/config-multiclaves';
import { MulticlavesConfigDto } from './dto/config-multiclaves.dto';

/**
 * `GET`/`PATCH /multiclaves/empresas/:empresaId/config` (spec §9.4, fase 3). El `PATCH` mergea
 * **solo** la clave `multiclaves` dentro de `empresa.configuracion` — el `update` genérico de
 * `empresas.service.ts` reemplaza el JSON entero y se llevaría puesta la config de mora o de
 * promesas de la misma empresa. Se lee y escribe en una transacción para que dos guardados
 * simultáneos (ajustes de mora + ajustes de multiclaves) no se pisen.
 */
@Injectable()
export class ConfigEmpresaMulticlavesService {
    private readonly logger = new Logger(ConfigEmpresaMulticlavesService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly emailSender: EmailSenderService,
    ) {}

    private async cargarEmpresa(empresaId: number) {
        const empresa = await this.prisma.empresa.findUnique({ where: { id: empresaId }, select: { id: true, configuracion: true } });
        if (!empresa) throw new NotFoundException(`Empresa ${empresaId} no encontrada`);
        return empresa;
    }

    async obtener(empresaId: number) {
        const empresa = await this.cargarEmpresa(empresaId);
        return resolverConfigMulticlaves(empresa.configuracion);
    }

    async actualizar(empresaId: number, dto: MulticlavesConfigDto) {
        const t0 = Date.now();
        this.logger.log(`Actualizando config multiclaves empresaId=${empresaId}`);

        // Se valida ANTES de la transacción, sin escribir nada si Sender no la reconoce (hallazgo de
        // la auditoría, §5): guardar un `templateCuponId` que no existe (o que es de otra cuenta
        // SMTP) deja el diálogo del cupón preseleccionando un id que nunca va a aparecer en la lista.
        if (dto.templateCuponId != null) {
            const { templates } = await this.emailSender.templatesDeEmpresa(empresaId);
            // `templatesDeEmpresa` ya tira 400 si la empresa no tiene `cuentaSmtpId`, y deja pasar el
            // error tal cual si Sender no responde (502) — en los dos casos, no se guarda nada.
            const existe = templates.some((t) => t.id === dto.templateCuponId);
            if (!existe) {
                throw new BadRequestException({
                    code: 'PLANTILLA_INVALIDA',
                    message: `La plantilla ${dto.templateCuponId} no existe, o no es de la cuenta de mail de esta empresa.`,
                });
            }
        }

        const resultado = await this.prisma.$transaction(async (tx) => {
            const empresa = await tx.empresa.findUnique({ where: { id: empresaId }, select: { configuracion: true } });
            if (!empresa) throw new NotFoundException(`Empresa ${empresaId} no encontrada`);

            const configuracionActual = (empresa.configuracion as Record<string, unknown> | null) ?? {};
            const multiclavesActual = (configuracionActual.multiclaves as Record<string, unknown> | undefined) ?? {};

            const multiclavesNueva: Record<string, unknown> = { ...multiclavesActual };
            if (dto.templateCuponId !== undefined) multiclavesNueva.templateCuponId = dto.templateCuponId;
            if (dto.gestionAlGenerar !== undefined) multiclavesNueva.gestionAlGenerar = dto.gestionAlGenerar;
            if (dto.leyendaTalonCedente !== undefined) multiclavesNueva.leyendaTalonCedente = dto.leyendaTalonCedente;
            if (dto.mediosDePago !== undefined) multiclavesNueva.mediosDePago = dto.mediosDePago;

            const configuracionNueva = { ...configuracionActual, multiclaves: multiclavesNueva };

            await tx.empresa.update({ where: { id: empresaId }, data: { configuracion: configuracionNueva as any } });
            return resolverConfigMulticlaves(configuracionNueva);
        });

        this.logger.log(`Config multiclaves empresaId=${empresaId} actualizada en ${Date.now() - t0}ms`);
        return resultado;
    }
}
