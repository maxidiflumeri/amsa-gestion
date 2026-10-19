import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

export const TANDA_LIMPIEZA_ASISTENTE = 500;
export const MAX_TANDAS_LIMPIEZA_ASISTENTE = 40;
export const RETENCION_CONVERSACIONES_DEFAULT_DIAS = 90;
/** Las filas de `asistente_llamada` (sin contenido) se guardan más: el consumo histórico no cambia al borrar. */
export const RETENCION_LLAMADAS_DIAS = 400;

const DIA_MS = 24 * 60 * 60 * 1000;

/** Solo `1`, `true`, `si`, `sí` o `yes` la apagan. Mismos valores que `limpiezaDesactivada` de notificaciones. */
export function limpiezaAsistenteDesactivada(raw: string | undefined = process.env.ASISTENTE_LIMPIEZA_DESACTIVADA): boolean {
    return ['1', 'true', 'si', 'sí', 'yes'].includes((raw ?? '').trim().toLowerCase());
}

export interface ResultadoLimpiezaAsistente {
    conversaciones: number;
    /** Archivos de ejemplo que nunca se mandaron (más de 24 h). */
    adjuntos: number;
    llamadas: number;
    tandas: number;
    topeAlcanzado: boolean;
}

/** Limpieza nocturna (04:30) de las conversaciones del asistente: docs/asistente-spec.md §11.4. */
@Injectable()
export class AsistenteLimpiezaService implements OnModuleInit {
    private readonly logger = new Logger(AsistenteLimpiezaService.name);

    constructor(private readonly prisma: PrismaService) {}

    onModuleInit(): void {
        if (limpiezaAsistenteDesactivada()) {
            this.logger.log('Limpieza del asistente desactivada (ASISTENTE_LIMPIEZA_DESACTIVADA)');
            return;
        }
        this.logger.log(
            `Limpieza del asistente activa: todos los días a las 04:30, conversaciones a los ${this.retencionDias()} días, llamadas a los ${RETENCION_LLAMADAS_DIAS}`,
        );
    }

    retencionDias(): number {
        const raw = process.env.ASISTENTE_RETENCION_DIAS;
        if (raw === undefined) return RETENCION_CONVERSACIONES_DEFAULT_DIAS;
        const n = /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
        if (!Number.isInteger(n) || n < 1) {
            this.logger.warn(`ASISTENTE_RETENCION_DIAS="${raw}" no es un entero >= 1; se usa el default (${RETENCION_CONVERSACIONES_DEFAULT_DIAS})`);
            return RETENCION_CONVERSACIONES_DEFAULT_DIAS;
        }
        return n;
    }

    @Cron('30 4 * * *')
    async limpiezaNocturna(): Promise<void> {
        try {
            await this.limpiar();
        } catch (e: any) {
            this.logger.error(`Error en la limpieza del asistente: ${e?.message}`, e?.stack);
        }
    }

    async limpiar(ahora: Date = new Date()): Promise<ResultadoLimpiezaAsistente> {
        const vacio = { conversaciones: 0, adjuntos: 0, llamadas: 0, tandas: 0, topeAlcanzado: false };
        if (limpiezaAsistenteDesactivada()) {
            this.logger.log('Limpieza del asistente desactivada (ASISTENTE_LIMPIEZA_DESACTIVADA): no se hace nada');
            return vacio;
        }
        const t0 = Date.now();
        const dias = this.retencionDias();
        this.logger.log(`Limpieza del asistente: borrando conversaciones de más de ${dias} días y llamadas de más de ${RETENCION_LLAMADAS_DIAS}`);

        const limiteConv = new Date(ahora.getTime() - dias * DIA_MS);
        const limiteLlam = new Date(ahora.getTime() - RETENCION_LLAMADAS_DIAS * DIA_MS);
        let conversaciones = 0;
        let tandas = 0;
        let ultimaLlena = false;

        while (tandas < MAX_TANDAS_LIMPIEZA_ASISTENTE) {
            const filas = await this.prisma.asistente_conversacion.findMany({
                where: { updatedAt: { lt: limiteConv } },
                select: { id: true },
                orderBy: { id: 'asc' },
                take: TANDA_LIMPIEZA_ASISTENTE,
            });
            if (filas.length === 0) {
                ultimaLlena = false;
                break;
            }
            // Los mensajes caen en cascada; las llamadas quedan con conversacionId = null (onDelete: SetNull).
            const r = await this.prisma.asistente_conversacion.deleteMany({
                where: { id: { in: filas.map((f) => f.id) }, updatedAt: { lt: limiteConv } },
            });
            tandas++;
            conversaciones += r.count;
            ultimaLlena = filas.length >= TANDA_LIMPIEZA_ASISTENTE;
            if (r.count === 0) {
                this.logger.warn(`Limpieza del asistente: la tanda ${tandas} leyó ${filas.length} conversaciones y no borró ninguna; se corta`);
                ultimaLlena = false;
                break;
            }
            if (!ultimaLlena) break;
        }

        const topeAlcanzado = tandas === MAX_TANDAS_LIMPIEZA_ASISTENTE && ultimaLlena;
        if (topeAlcanzado) {
            this.logger.warn(`Limpieza del asistente: se alcanzó el tope de ${MAX_TANDAS_LIMPIEZA_ASISTENTE} tandas; el resto queda para mañana`);
        }

        // Los adjuntos vinculados caen con su conversación (cascada); los que nunca se mandaron se borran a las 24 h.
        const adj = await this.prisma.asistente_adjunto.deleteMany({
            where: { conversacionId: null, createdAt: { lt: new Date(ahora.getTime() - DIA_MS) } },
        });

        const llam = await this.prisma.asistente_llamada.deleteMany({ where: { createdAt: { lt: limiteLlam } } });
        this.logger.log(
            `Limpieza del asistente: ${conversaciones} conversaciones, ${adj.count} adjuntos sin mandar y ${llam.count} llamadas borradas en ${Date.now() - t0}ms`,
        );
        return { conversaciones, adjuntos: adj.count, llamadas: llam.count, tandas, topeAlcanzado };
    }
}
