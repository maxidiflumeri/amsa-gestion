import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificacionesService } from './notificaciones.service';

export const RETENCION_LEIDAS_DEFAULT_DIAS = 30;
export const RETENCION_NO_LEIDAS_DEFAULT_DIAS = 180;
export const TANDA_LIMPIEZA = 1000;
export const MAX_TANDAS_LIMPIEZA = 50;

const DIA_MS = 24 * 60 * 60 * 1000;

export interface ResultadoLimpieza {
    borradas: number;
    leidas: number;
    noLeidas: number;
    usuarios: number;
    tandas: number;
    topeAlcanzado: boolean;
}

/**
 * `NOTIFICACIONES_LIMPIEZA_DESACTIVADA`: solo `1`, `true`, `si`, `sí` o `yes` (sin distinguir mayúsculas) la apagan.
 * Vacío, `false` o `0` la dejan encendida. Mismos valores que `IMPORTS_REAPER_DESACTIVADO`.
 */
export function limpiezaDesactivada(raw: string | undefined = process.env.NOTIFICACIONES_LIMPIEZA_DESACTIVADA): boolean {
    return ['1', 'true', 'si', 'sí', 'yes'].includes((raw ?? '').trim().toLowerCase());
}

/**
 * Limpieza nocturna de notificaciones (docs/imports-progreso-realtime-spec.md §11.4, N12 de notificaciones-spec).
 * Borra las leídas de más de L días (desde `leidaEn`, con `creadoEn` de respaldo) y las sin leer de más de N días
 * (desde `creadoEn`), por tandas. Las fechas se calculan en JS: no hay SQL crudo.
 */
@Injectable()
export class NotificacionesLimpiezaService implements OnModuleInit {
    private readonly logger = new Logger(NotificacionesLimpiezaService.name);
    /** Valores inválidos ya avisados (`nombre=valor`): el warn sale una vez, no en cada corrida ni en cada lectura. */
    private readonly invalidosAvisados = new Set<string>();

    constructor(
        private readonly prisma: PrismaService,
        private readonly notificaciones: NotificacionesService,
    ) {}

    onModuleInit(): void {
        if (limpiezaDesactivada()) {
            this.logger.log('Limpieza de notificaciones desactivada (NOTIFICACIONES_LIMPIEZA_DESACTIVADA)');
            return;
        }
        this.logger.log(
            `Limpieza de notificaciones activa: todos los días a las 05:00, leídas a los ${this.retencionLeidasDias()} días, sin leer a los ${this.retencionNoLeidasDias()}`,
        );
    }

    retencionLeidasDias(): number {
        return this.diasDeEnv('NOTIFICACIONES_RETENCION_LEIDAS_DIAS', RETENCION_LEIDAS_DEFAULT_DIAS);
    }

    retencionNoLeidasDias(): number {
        return this.diasDeEnv('NOTIFICACIONES_RETENCION_NO_LEIDAS_DIAS', RETENCION_NO_LEIDAS_DEFAULT_DIAS);
    }

    /** 05:00 del reloj del contenedor (`TZ=America/Argentina/Buenos_Aires`), después de promesas, cuotas, mora y borradores. */
    @Cron('0 5 * * *')
    async limpiezaNocturna(): Promise<void> {
        try {
            await this.limpiar();
        } catch (e: any) {
            this.logger.error(`Error en la limpieza de notificaciones: ${e?.message}`, e?.stack);
        }
    }

    /** Las tres ramas de lo que se borra. Público para los tests. */
    condicion(ahora: Date): Prisma.NotificacionWhereInput {
        const limiteLeidas = new Date(ahora.getTime() - this.retencionLeidasDias() * DIA_MS);
        const limiteNoLeidas = new Date(ahora.getTime() - this.retencionNoLeidasDias() * DIA_MS);
        return {
            OR: [
                { leida: true, leidaEn: { lt: limiteLeidas } },
                { leida: true, leidaEn: null, creadoEn: { lt: limiteLeidas } },
                { leida: false, creadoEn: { lt: limiteNoLeidas } },
            ],
        };
    }

    async limpiar(ahora: Date = new Date()): Promise<ResultadoLimpieza> {
        const vacio: ResultadoLimpieza = {
            borradas: 0,
            leidas: 0,
            noLeidas: 0,
            usuarios: 0,
            tandas: 0,
            topeAlcanzado: false,
        };
        if (limpiezaDesactivada()) {
            this.logger.log('Limpieza de notificaciones desactivada (NOTIFICACIONES_LIMPIEZA_DESACTIVADA): no se hace nada');
            return vacio;
        }

        const t0 = Date.now();
        const dl = this.retencionLeidasDias();
        const dn = this.retencionNoLeidasDias();
        this.logger.log(`Limpieza de notificaciones: borrando leídas de más de ${dl} días y sin leer de más de ${dn}`);

        const condicion = this.condicion(ahora);
        const usuarios = new Set<number>();
        let leidas = 0;
        let noLeidas = 0;
        let tandas = 0;
        let borradas = 0;
        let ultimaLlena = false;

        while (tandas < MAX_TANDAS_LIMPIEZA) {
            const filas = await this.prisma.notificacion.findMany({
                where: condicion,
                select: { id: true, usuarioId: true, leida: true },
                orderBy: { id: 'asc' },
                take: TANDA_LIMPIEZA,
            });
            if (filas.length === 0) {
                ultimaLlena = false;
                break;
            }

            // Re-chequea la condición: una que se leyó entre la lectura y el borrado no se borra.
            const r = await this.prisma.notificacion.deleteMany({
                where: { AND: [{ id: { in: filas.map((f) => f.id) } }, condicion] },
            });
            tandas++;
            borradas += r.count;
            ultimaLlena = filas.length >= TANDA_LIMPIEZA;

            if (r.count === 0) {
                this.logger.warn(`Limpieza de notificaciones: la tanda ${tandas} leyó ${filas.length} filas y no borró ninguna; se corta`);
                ultimaLlena = false;
                break;
            }
            if (r.count < filas.length) {
                this.logger.debug(`Limpieza de notificaciones: la tanda ${tandas} borró ${r.count} de ${filas.length} (el resto cambió en el medio)`);
            }
            for (const f of filas) {
                if (f.leida) leidas++;
                else {
                    noLeidas++;
                    usuarios.add(f.usuarioId);
                }
            }
            this.logger.debug(`Limpieza de notificaciones: tanda ${tandas}, ${r.count} borradas`);

            if (!ultimaLlena) break;
        }

        const topeAlcanzado = tandas === MAX_TANDAS_LIMPIEZA && ultimaLlena;
        if (topeAlcanzado) {
            this.logger.warn(`Limpieza de notificaciones: se alcanzó el tope de ${MAX_TANDAS_LIMPIEZA} tandas; el resto queda para mañana`);
        }

        for (const u of usuarios) {
            await this.notificaciones.emitirContador(u);
        }

        // `borradas` sale de lo que borró cada `deleteMany`; el desglose, de las candidatas que se leyeron (una que alguien
        // leyó entre la lectura y el borrado no se borra, pero queda en el desglose).
        const candidatas = leidas + noLeidas;
        const desglose = borradas === candidatas
            ? `${leidas} leídas, ${noLeidas} sin leer`
            : `de ${candidatas} candidatas: ${leidas} leídas, ${noLeidas} sin leer`;
        this.logger.log(
            `Limpieza de notificaciones: ${borradas} borradas (${desglose}) en ${Date.now() - t0}ms; contador actualizado a ${usuarios.size} usuarios`,
        );
        return { borradas, leidas, noLeidas, usuarios: usuarios.size, tandas, topeAlcanzado };
    }

    private diasDeEnv(nombre: string, porDefecto: number): number {
        const raw = process.env[nombre];
        if (raw === undefined) return porDefecto;
        // Solo dígitos: `Number()` aceptaría `1e1` o `0x10` sin aviso.
        const n = /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
        if (!Number.isInteger(n) || n < 1) {
            const clave = `${nombre}=${raw}`;
            if (!this.invalidosAvisados.has(clave)) {
                this.invalidosAvisados.add(clave);
                this.logger.warn(`${nombre}="${raw}" no es un entero >= 1; se usa el default (${porDefecto})`);
            }
            return porDefecto;
        }
        return n;
    }
}
