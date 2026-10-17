import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestContextService } from '../../common/logger/request-context';
import { ymdLocal } from '../../common/utils/dia-local';
import { AsistenteConfigService } from './asistente-config.service';
import { ConsumoAsistente, FuenteAyuda } from './dto/asistente.tipos';
import { calcularCosto } from './modelo/precios';
import { LlamadaRegistro, PuertoMedicion } from './turno/turno-runner';

/** El gasto del mes se reutiliza 30 s y se suma en caliente después de cada llamada. */
const TTL_GASTO_MS = 30_000;

export interface GastoMes {
    mes: string;
    total: number;
    porFuncion: Record<string, number>;
}

/** 'YYYY-MM' del mes de una fecha, en hora local (TZ del proceso: Argentina). */
export function mesLocal(d: Date = new Date()): string {
    return ymdLocal(d).slice(0, 7);
}

/** [primer instante del mes, primer instante del mes siguiente), en hora local. */
export function rangoDelMes(mes: string): { desde: Date; hasta: Date } {
    const [a, m] = mes.split('-').map(Number);
    return { desde: new Date(a, m - 1, 1, 0, 0, 0, 0), hasta: new Date(a, m, 1, 0, 0, 0, 0) };
}

const redondear6 = (n: number) => Number(n.toFixed(6));

/** Una fila por llamada al modelo, con su costo; y el consumo que ve el administrador. */
/** Cómo dice el modelo que algo no está en la wiki (sin acentos: la colación los ignora). */
export const FRASES_SIN_DOCUMENTAR = [
    'no esta en la documentacion',
    'la documentacion no ',
    'no figura en la documentacion',
    'no aparece en la documentacion',
    'no lo cubre la documentacion',
];

@Injectable()
export class MedicionService implements PuertoMedicion {
    private readonly logger = new Logger(MedicionService.name);
    private cache: { gasto: GastoMes; ts: number } | null = null;

    constructor(
        private readonly prisma: PrismaService,
        private readonly config: AsistenteConfigService,
        @Optional() private readonly contexto?: RequestContextService,
    ) {}

    async registrarLlamada(l: LlamadaRegistro): Promise<number> {
        const precio = await this.config.precioVigente();
        if (!precio) {
            this.logger.error(`No hay precio para el modelo ${l.modelo}: la llamada se registra con costo 0 (mensaje=${l.mensajeId})`);
        }
        const costo = precio ? redondear6(calcularCosto(l.uso, precio)) : 0;
        const requestId = this.contexto?.getRequestId()?.slice(0, 20) ?? null;
        try {
            await this.prisma.asistente_llamada.create({
                data: {
                    usuarioId: l.usuarioId,
                    conversacionId: l.conversacionId,
                    mensajeId: l.mensajeId,
                    funcion: l.funcion,
                    modelo: l.modelo,
                    iteracion: l.iteracion,
                    tokensEntrada: l.uso.entrada,
                    tokensSalida: l.uso.salida,
                    tokensThinking: l.uso.thinking,
                    cacheLectura: l.uso.cacheLectura,
                    cacheEscritura5m: l.uso.cacheEscritura5m,
                    cacheEscritura1h: l.uso.cacheEscritura1h,
                    costoUsd: costo,
                    ms: l.ms,
                    stopReason: l.stopReason,
                    error: l.error,
                    requestId,
                },
            });
        } catch (e: any) {
            // El costo no se pierde: queda en el log con todo lo necesario para reconstruir la fila.
            this.logger.error(
                `No se pudo guardar la llamada al modelo (mensaje=${l.mensajeId}, iteracion=${l.iteracion}, ` +
                    `costo=$${costo}, in=${l.uso.entrada}, out=${l.uso.salida}, cr=${l.uso.cacheLectura}, ` +
                    `cw5m=${l.uso.cacheEscritura5m}, cw1h=${l.uso.cacheEscritura1h}): ${e?.message}`,
                e?.stack,
            );
        }
        this.sumarEnCaliente(l.funcion, costo);
        this.logger.log(
            `Llamada al modelo registrada: mensaje=${l.mensajeId} it=${l.iteracion} stop=${l.stopReason ?? l.error} ` +
                `in=${l.uso.entrada} out=${l.uso.salida} think=${l.uso.thinking} cr=${l.uso.cacheLectura} ` +
                `cw=${l.uso.cacheEscritura5m + l.uso.cacheEscritura1h} costo=$${costo.toFixed(6)} en ${l.ms}ms`,
        );
        return costo;
    }

    private sumarEnCaliente(funcion: string, costo: number): void {
        const c = this.cache;
        if (!c || c.gasto.mes !== mesLocal()) return;
        c.gasto.total += costo;
        c.gasto.porFuncion[funcion] = (c.gasto.porFuncion[funcion] ?? 0) + costo;
    }

    /** Fuerza que la próxima lectura vaya a la base (los tests y el cambio de tope lo usan). */
    invalidarGasto(): void {
        this.cache = null;
    }

    /** Gasto del mes corriente (hora de Argentina), global y por función. */
    async gastoDelMes(): Promise<GastoMes> {
        const mes = mesLocal();
        if (this.cache && this.cache.gasto.mes === mes && Date.now() - this.cache.ts < TTL_GASTO_MS) {
            return this.cache.gasto;
        }
        const { desde, hasta } = rangoDelMes(mes);
        const filas = await this.prisma.asistente_llamada.groupBy({
            by: ['funcion'],
            where: { createdAt: { gte: desde, lt: hasta } },
            _sum: { costoUsd: true },
        });
        const porFuncion: Record<string, number> = {};
        let total = 0;
        for (const f of filas) {
            const v = Number(f._sum.costoUsd ?? 0);
            porFuncion[f.funcion] = v;
            total += v;
        }
        const gasto: GastoMes = { mes, total, porFuncion };
        this.cache = { gasto, ts: Date.now() };
        return gasto;
    }

    // --- Pantalla de consumo ------------------------------------------------------------------------------------

    async consumo(mesPedido: string | undefined, pausa: ConsumoAsistente['pausa']): Promise<ConsumoAsistente> {
        const actual = mesLocal();
        const mes = mesPedido ?? actual;
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new BadRequestException('El mes tiene que tener el formato AAAA-MM.');
        const { desde, hasta } = rangoDelMes(mes);
        const cfg = await this.config.leer();
        const funciones = await this.config.funciones();
        const t0 = Date.now();

        const llamadas = await this.prisma.asistente_llamada.findMany({
            where: { createdAt: { gte: desde, lt: hasta } },
            select: {
                createdAt: true,
                usuarioId: true,
                funcion: true,
                iteracion: true,
                costoUsd: true,
                tokensEntrada: true,
                cacheLectura: true,
                cacheEscritura5m: true,
                cacheEscritura1h: true,
            },
        });

        let gastoUsd = 0;
        let leidos = 0;
        let prompt = 0;
        let preguntas = 0;
        const usuarios = new Set<number>();
        const porFuncion = new Map<string, { gasto: number; preguntas: number }>();
        const porUsuario = new Map<number, { gasto: number; preguntas: number }>();
        const porDia = new Map<string, { gasto: number; preguntas: number }>();
        for (const l of llamadas) {
            const costo = Number(l.costoUsd);
            const esPregunta = l.iteracion === 0 ? 1 : 0;
            gastoUsd += costo;
            leidos += l.cacheLectura;
            prompt += l.tokensEntrada + l.cacheLectura + l.cacheEscritura5m + l.cacheEscritura1h;
            preguntas += esPregunta;
            const sumar = <K>(m: Map<K, { gasto: number; preguntas: number }>, k: K) => {
                const v = m.get(k) ?? { gasto: 0, preguntas: 0 };
                v.gasto += costo;
                v.preguntas += esPregunta;
                m.set(k, v);
            };
            sumar(porFuncion, l.funcion);
            sumar(porDia, ymdLocal(l.createdAt));
            if (l.usuarioId !== null) {
                usuarios.add(l.usuarioId);
                sumar(porUsuario, l.usuarioId);
            }
        }

        const topUsuarios = [...porUsuario.entries()].sort((a, b) => b[1].gasto - a[1].gasto).slice(0, 50);
        const nombres = topUsuarios.length
            ? await this.prisma.usuario.findMany({
                  where: { id: { in: topUsuarios.map(([id]) => id) } },
                  select: { id: true, nombre: true },
              })
            : [];
        const nombrePorId = new Map(nombres.map((u) => [u.id, u.nombre]));

        const rangoMsg = { gte: desde, lt: hasta };
        const [positivas, negativas, sinCalificar, sinDocumentar, negRecientes] = await Promise.all([
            this.prisma.asistente_mensaje.count({ where: { rol: 'asistente', calificacion: 1, createdAt: rangoMsg } }),
            this.prisma.asistente_mensaje.count({ where: { rol: 'asistente', calificacion: -1, createdAt: rangoMsg } }),
            this.prisma.asistente_mensaje.count({
                where: { rol: 'asistente', calificacion: null, estado: { in: ['ok', 'cortado'] }, createdAt: rangoMsg },
            }),
            // La colación de MySQL no distingue acentos ni mayúsculas. El prompt pide la frase exacta, pero el modelo a veces
            // la parafrasea ("la documentación no tiene el paso a paso"): se cuentan también esas variantes.
            this.prisma.asistente_mensaje.count({
                where: {
                    rol: 'asistente',
                    estado: 'ok',
                    createdAt: rangoMsg,
                    OR: FRASES_SIN_DOCUMENTAR.map((f) => ({ texto: { contains: f } })),
                },
            }),
            this.prisma.asistente_mensaje.findMany({
                where: { rol: 'asistente', calificacion: -1, createdAt: rangoMsg },
                orderBy: { id: 'desc' },
                take: 20,
                include: { usuario: { select: { nombre: true } } },
            }),
        ]);

        const negativasRecientes: ConsumoAsistente['negativasRecientes'] = [];
        for (const m of negRecientes) {
            const pregunta = await this.prisma.asistente_mensaje.findFirst({
                where: { conversacionId: m.conversacionId, rol: 'usuario', id: { lt: m.id } },
                orderBy: { id: 'desc' },
                select: { texto: true },
            });
            negativasRecientes.push({
                mensajeId: m.id,
                fecha: m.createdAt.toISOString(),
                usuario: m.usuario.nombre,
                pregunta: pregunta?.texto ?? '',
                respuesta: m.texto,
                comentario: m.comentario,
                fuentes: Array.isArray(m.fuentes) ? (m.fuentes as unknown as FuenteAyuda[]) : [],
            });
        }

        const diasDelMes = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0).getDate();
        let transcurridos = diasDelMes;
        if (mes === actual) transcurridos = Number(ymdLocal().slice(8, 10));
        else if (mes > actual) transcurridos = 0;
        const proyeccionUsd = transcurridos > 0 ? (gastoUsd / transcurridos) * diasDelMes : 0;

        const r6 = (n: number) => Number(n.toFixed(6));
        this.logger.debug(`Consumo del asistente ${mes}: ${llamadas.length} llamadas en ${Date.now() - t0}ms`);
        return {
            mes,
            topeMensualUsd: cfg.topeMensualUsd,
            gastoUsd: r6(gastoUsd),
            porcentaje: cfg.topeMensualUsd > 0 ? Number(((gastoUsd / cfg.topeMensualUsd) * 100).toFixed(2)) : 0,
            proyeccionUsd: r6(proyeccionUsd),
            pausa,
            totales: {
                preguntas,
                llamadas: llamadas.length,
                usuarios: usuarios.size,
                costoPorPregunta: preguntas > 0 ? r6(gastoUsd / preguntas) : 0,
                tasaCache: prompt > 0 ? Number((leidos / prompt).toFixed(4)) : 0,
            },
            porFuncion: funciones.map((f) => ({
                funcion: f.clave,
                nombre: f.nombre,
                gastoUsd: r6(porFuncion.get(f.clave)?.gasto ?? 0),
                preguntas: porFuncion.get(f.clave)?.preguntas ?? 0,
                topeUsd: f.topeMensualUsd,
            })),
            porUsuario: topUsuarios.map(([usuarioId, v]) => ({
                usuarioId,
                nombre: nombrePorId.get(usuarioId) ?? `Usuario ${usuarioId}`,
                preguntas: v.preguntas,
                gastoUsd: r6(v.gasto),
            })),
            porDia: [...porDia.entries()]
                .sort((a, b) => (a[0] < b[0] ? -1 : 1))
                .map(([dia, v]) => ({ dia, gastoUsd: r6(v.gasto), preguntas: v.preguntas })),
            calidad: { positivas, negativas, sinCalificar, sinDocumentar },
            negativasRecientes,
        };
    }
}
