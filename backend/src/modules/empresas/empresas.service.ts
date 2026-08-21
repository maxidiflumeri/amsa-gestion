import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class EmpresasService {
    private readonly logger = new Logger(EmpresasService.name);

    constructor(private prisma: PrismaService) { }

    findAll() {
        return this.prisma.empresa.findMany({
            orderBy: { nombre: 'asc' },
        });
    }

    async findOne(id: number) {
        const empresa = await this.prisma.empresa.findUnique({
            where: { id },
        });
        if (!empresa) throw new NotFoundException('Empresa no encontrada');
        return empresa;
    }

    create(data: { nombre: string; cuit?: string; configuracion?: any }) {
        this.logger.log(`Creando empresa nombre=${data.nombre}`);
        return this.prisma.empresa.create({
            data,
        });
    }

    async update(id: number, data: { nombre?: string; cuit?: string; configuracion?: any }) {
        this.logger.log(`Actualizando empresa id=${id}`);
        await this.findOne(id);
        return this.prisma.empresa.update({
            where: { id },
            data,
        });
    }

    /**
     * Borra una empresa, **solo si está vacía**.
     *
     * Antes se llamaba a `delete` en seco y salía cualquiera de dos cosas malas: con casos, remesas,
     * plantillas o políticas asociadas la FK RESTRICT devolvía un 500 con el mensaje interno de
     * Prisma; y si la empresa sí era borrable, se llevaba **en cascada y sin aviso** las tasas e
     * índices de recargo por mora y todo el historial de emails enviados.
     */
    async remove(id: number) {
        const empresa = await this.findOne(id);

        const [deudores, remesas, plantillas, politicas, tasas, emails] = await Promise.all([
            this.prisma.deudor.count({ where: { empresaId: id } }),
            this.prisma.remesa.count({ where: { empresaId: id } }),
            this.prisma.plantillaimport.count({ where: { empresaId: id } }),
            this.prisma.politica.count({ where: { empresaId: id } }),
            this.prisma.tasa_mora.count({ where: { empresaId: id } }),
            this.prisma.envio_email.count({ where: { empresaId: id } }),
        ]);

        // Lo que bloquea (FK RESTRICT): borrarlos primero es una decisión del usuario, no nuestra.
        const bloqueantes: Array<[string, string, number]> = [
            ['caso', 'casos', deudores],
            ['remesa', 'remesas', remesas],
            ['plantilla de importación', 'plantillas de importación', plantillas],
            ['política', 'políticas', politicas],
        ].filter(([, , n]) => (n as number) > 0) as Array<[string, string, number]>;

        if (bloqueantes.length > 0) {
            const detalle = bloqueantes.map(([uno, varios, n]) => `${n} ${n === 1 ? uno : varios}`).join(', ');
            this.logger.warn(`Borrado de empresa ${id} rechazado — tiene ${detalle}`);
            throw new ConflictException(
                `No se puede eliminar "${empresa.nombre}": tiene ${detalle}. Hay que vaciar la cartera primero.`,
            );
        }

        // Lo que se iría en cascada, sin que nadie lo pida. Es dato del cedente: mejor frenar y que
        // lo resuelva alguien a mano que borrarlo en silencio.
        if (tasas > 0 || emails > 0) {
            const detalle = [
                tasas > 0 ? `${tasas} tasa(s) de recargo por mora` : null,
                emails > 0 ? `${emails} email(s) enviado(s)` : null,
            ].filter(Boolean).join(' y ');
            this.logger.warn(`Borrado de empresa ${id} rechazado — arrastraría ${detalle}`);
            throw new ConflictException(
                `No se puede eliminar "${empresa.nombre}": borrarla se llevaría ${detalle}, sin vuelta atrás. ` +
                `Si igual hay que hacerlo, tiene que resolverlo el equipo técnico.`,
            );
        }

        this.logger.log(`Eliminando empresa id=${id} (${empresa.nombre}) — sin datos asociados`);
        return this.prisma.empresa.delete({ where: { id } });
    }

    /**
     * Reemplaza los parámetros asignados a una empresa, **por diferencia**.
     *
     * Con `deleteMany` + `createMany` las asignaciones que no cambiaban se recreaban en cero, así que
     * cualquier cosa guardada en `empresa_parametro` —`nombreOverride`, `activo`— se destruía en cada
     * guardado.
     */
    async assignParametros(empresaId: number, parametroIds: number[]) {
        this.logger.log(`Asignando ${parametroIds.length} parámetros a empresa id=${empresaId}`);

        const actuales = await this.prisma.empresa_parametro.findMany({
            where: { empresaId },
            select: { parametroId: true },
        });
        const antes = new Set(actuales.map((a) => a.parametroId));
        const despues = new Set(parametroIds);

        const aQuitar = [...antes].filter((id) => !despues.has(id));
        const aSumar = [...despues].filter((id) => !antes.has(id));

        if (aQuitar.length === 0 && aSumar.length === 0) return { count: 0 };

        return this.prisma.$transaction(async (tx) => {
            if (aQuitar.length > 0) {
                await tx.empresa_parametro.deleteMany({
                    where: { empresaId, parametroId: { in: aQuitar } },
                });
            }
            if (aSumar.length > 0) {
                await tx.empresa_parametro.createMany({
                    data: aSumar.map((parametroId) => ({ empresaId, parametroId })),
                });
            }
            return { count: aQuitar.length + aSumar.length };
        });
    }
}
