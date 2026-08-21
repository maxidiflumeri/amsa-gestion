import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class ParametrosService {
    private readonly logger = new Logger(ParametrosService.name);

    constructor(private prisma: PrismaService) {}

    findAll(filters: { grupo?: string; empresaId?: number; activo?: boolean } = {}) {
        const where: any = {};
        if (filters.grupo) where.grupo = filters.grupo;
        if (filters.activo !== undefined) where.activo = filters.activo;
        if (filters.empresaId) {
            where.empresas = { some: { empresaId: filters.empresaId, activo: true } };
        }
        return this.prisma.parametro.findMany({
            where,
            include: { parametroPadre: true, empresas: true, subParametros: true },
            orderBy: [{ grupo: 'asc' }, { clave: 'asc' }],
        });
    }

    async getGrupos() {
        const grupos = await this.prisma.parametro.groupBy({
            by: ['grupo'],
            _count: { id: true },
            orderBy: { grupo: 'asc' },
        });
        return grupos.map(g => ({ grupo: g.grupo, total: g._count.id }));
    }

    findByGrupo(grupo: string) {
        return this.findAll({ grupo, activo: true });
    }

    async findOne(id: number) {
        const p = await this.prisma.parametro.findUnique({
            where: { id },
            include: { subParametros: true, empresas: true },
        });
        if (!p) throw new NotFoundException('Parámetro no encontrado');
        return p;
    }

    create(data: { grupo: string; clave: string; descripcion: string; padreId?: number; categoria?: string; esGlobal?: boolean; activo?: boolean }) {
        this.logger.log(`Creando parámetro grupo=${data.grupo} clave=${data.clave}`);
        return this.prisma.parametro.create({ data });
    }

    async update(id: number, data: { grupo?: string; clave?: string; descripcion?: string; padreId?: number; categoria?: string; esGlobal?: boolean; activo?: boolean }) {
        this.logger.log(`Actualizando parámetro id=${id}`);
        await this.findOne(id);
        return this.prisma.parametro.update({ where: { id }, data });
    }

    async toggleActivo(id: number) {
        const p = await this.findOne(id);
        this.logger.log(`Toggle activo parámetro id=${id} activo=${p.activo} → ${!p.activo}`);
        return this.prisma.parametro.update({
            where: { id },
            data: { activo: !p.activo },
        });
    }

    async remove(id: number) {
        this.logger.log(`Eliminando parámetro id=${id}`);
        await this.findOne(id);
        return this.prisma.parametro.delete({ where: { id } });
    }

    /**
     * Asigna o desasigna **un código en una empresa**.
     *
     * Es la operación que usa la pantalla. Antes se hacía con `assignToCompanies`, que reescribía la
     * lista completa de empresas del parámetro: dos administradores configurando **empresas
     * distintas** al mismo tiempo se pisaban, porque cada uno mandaba la foto que había leído y el
     * segundo en guardar borraba lo del primero. Tocando una sola fila el problema desaparece.
     */
    async setAsignacion(parametroId: number, empresaId: number, asignado: boolean) {
        if (asignado) {
            // Upsert y no create: si la fila ya existe se conserva lo que tenga (`nombreOverride`,
            // `activo`), en vez de recrearla con los defaults.
            return this.prisma.empresa_parametro.upsert({
                where: { empresaId_parametroId: { empresaId, parametroId } },
                create: { empresaId, parametroId },
                update: { activo: true },
            });
        }
        return this.prisma.empresa_parametro.deleteMany({ where: { empresaId, parametroId } });
    }

    /**
     * Reemplaza la lista de empresas de un parámetro.
     *
     * Se hace por diferencia y no con `deleteMany` + `createMany`: así las asignaciones que no
     * cambian conservan sus columnas (`nombreOverride`, `activo`) en vez de recrearse en cero.
     */
    async assignToCompanies(parametroId: number, empresaIds: number[]) {
        const actuales = await this.prisma.empresa_parametro.findMany({
            where: { parametroId },
            select: { empresaId: true },
        });
        const antes = new Set(actuales.map((a) => a.empresaId));
        const despues = new Set(empresaIds);

        const aQuitar = [...antes].filter((id) => !despues.has(id));
        const aSumar = [...despues].filter((id) => !antes.has(id));

        if (aQuitar.length === 0 && aSumar.length === 0) return { count: 0 };

        return this.prisma.$transaction(async (tx) => {
            if (aQuitar.length > 0) {
                await tx.empresa_parametro.deleteMany({
                    where: { parametroId, empresaId: { in: aQuitar } },
                });
            }
            if (aSumar.length > 0) {
                await tx.empresa_parametro.createMany({
                    data: aSumar.map((empresaId) => ({ parametroId, empresaId })),
                });
            }
            return { count: aQuitar.length + aSumar.length };
        });
    }

    async setEmpresasForParametro(parametroId: number, empresaIds: number[]) {
        return this.assignToCompanies(parametroId, empresaIds);
    }
}