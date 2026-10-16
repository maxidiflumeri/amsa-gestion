import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { fechaCalendarioUtc, inicioDelDia, sumarDiasYmd, ymdLocal } from '../../common/utils/dia-local';
import {
    AgendaDto,
    EjecucionResumenDto,
    GestionesDto,
    ImportacionTerminadaDto,
    IndicadoresPromesasDto,
    MiDiaDto,
    RetomarItemDto,
} from './dto/mi-dia.dto';
import {
    calcularAgenda,
    calcularGestiones,
    CuotaFila,
    DeudorAgenda,
    inicioSerie,
    PromesaFila,
    recortarRetomar,
    recortarTexto,
} from './inicio-calculos';

type Bloque = MiDiaDto['errores'][number];

/** Tope de filas de comentarios leídas para el cálculo (spec §5.4 G1). */
const TOPE_FILAS_GESTIONES = 20_000;
const RETOMAR_CANTIDAD = 8;
const RETOMAR_DIAS = 30;
const MS_LENTO = 500;

interface RetomarCrudo {
    deudorId: number;
    ultimaGestion: Date;
    texto: string;
    gestiones: number;
}

interface AgendaCruda {
    promesas: PromesaFila[];
    cuotas: CuotaFila[];
}

@Injectable()
export class InicioService {
    private readonly logger = new Logger(InicioService.name);

    constructor(private readonly prisma: PrismaService) {}

    /**
     * Arma "Tu día" del usuario. Cada bloque se calcula solo si tiene su permiso, y si falla va `null` con su
     * nombre en `errores` sin tumbar a los demás. Solo lectura, sin estado. Nunca se loguean documentos,
     * nombres ni textos: solo ids y conteos.
     */
    async miDia(usuarioId: number, permisos: string[], ahora: Date = new Date()): Promise<MiDiaDto> {
        const t0 = Date.now();
        const tiene = (p: string) => permisos.includes(p);
        const hoy = ymdLocal(ahora);

        const quiereGestiones = tiene('comentarios.ver') || tiene('comentarios.crear');
        const quiereRetomar = tiene('comentarios.ver') && tiene('deudores.ver');
        // Las cuotas son de los convenios que armé: hace falta poder armarlos y verlos. Con solo "Ver convenios" (el
        // operador de prod) la agenda estaría siempre vacía.
        const incluye = { promesas: tiene('promesas.ver'), cuotas: tiene('convenios.ver') && tiene('convenios.crear') };
        const quiereAgenda = incluye.promesas || incluye.cuotas;
        const quierePromesas = tiene('promesas.ver');
        const quiereImportaciones = tiene('importacion.ver_historial');
        const quiereReportes = tiene('reportes.ver');

        const pedidos: Bloque[] = [];
        if (quiereGestiones) pedidos.push('gestiones');
        if (quiereRetomar) pedidos.push('retomar');
        if (quiereAgenda) pedidos.push('agenda');
        if (quierePromesas) pedidos.push('promesas');
        if (quiereImportaciones) pedidos.push('importacionesHoy');
        if (quiereReportes) pedidos.push('reportes');
        this.logger.log(`mi-dia usuario=${usuarioId} bloques=[${pedidos.join(',')}]`);

        const tiempos: Record<string, number> = {};
        const medir = async <T>(nombre: string, fn: () => Promise<T>): Promise<T> => {
            const t = Date.now();
            try {
                return await fn();
            } finally {
                tiempos[nombre] = Date.now() - t;
            }
        };

        const [rGestiones, rRetomar, rAgenda, rPromesas, rImportaciones, rReportes] = await Promise.allSettled([
            quiereGestiones ? medir('gestiones', () => this.leerGestiones(usuarioId, ahora)) : Promise.resolve(null),
            quiereRetomar ? medir('retomar', () => this.leerRetomar(usuarioId, ahora)) : Promise.resolve(null),
            quiereAgenda ? medir('agenda', () => this.leerAgenda(usuarioId, ahora, incluye)) : Promise.resolve(null),
            quierePromesas ? medir('promesas', () => this.leerPromesas(usuarioId, ahora)) : Promise.resolve(null),
            quiereImportaciones
                ? medir('importacionesHoy', () => this.leerImportaciones(usuarioId, ahora))
                : Promise.resolve(null),
            quiereReportes ? medir('reportes', () => this.leerReportes(usuarioId, ahora)) : Promise.resolve(null),
        ]);

        const errores: Bloque[] = [];
        const resultado = <T>(nombre: Bloque, r: PromiseSettledResult<T | null>): T | null => {
            if (r.status === 'fulfilled') return r.value;
            errores.push(nombre);
            this.logger.error(
                `mi-dia: falló el bloque ${nombre} usuario=${usuarioId}`,
                r.reason instanceof Error ? r.reason.stack : String(r.reason),
            );
            return null;
        };

        const gestiones = resultado<GestionesDto>('gestiones', rGestiones);
        const retomarCrudo = resultado<RetomarCrudo[]>('retomar', rRetomar);
        const agendaCruda = resultado<AgendaCruda>('agenda', rAgenda);
        const promesas = resultado<IndicadoresPromesasDto>('promesas', rPromesas);
        const importacionesHoy = resultado<ImportacionTerminadaDto[]>('importacionesHoy', rImportaciones);
        const reportes = resultado<EjecucionResumenDto[]>('reportes', rReportes);

        // G4: una sola lectura de deudores con los ids de retomar y de agenda juntos.
        let retomar: RetomarItemDto[] | null = null;
        let agenda: AgendaDto | null = null;
        if (retomarCrudo || agendaCruda) {
            const ids = new Set<number>();
            retomarCrudo?.forEach((r) => ids.add(r.deudorId));
            agendaCruda?.promesas.forEach((p) => ids.add(p.deudorId));
            agendaCruda?.cuotas.forEach((c) => ids.add(c.deudorId));
            try {
                const deudores = await medir('deudores', () => this.leerDeudores([...ids]));
                if (retomarCrudo) retomar = this.armarRetomar(retomarCrudo, deudores);
                if (agendaCruda) {
                    const base = new Map<number, DeudorAgenda>();
                    deudores.forEach((d, id) => base.set(id, { nombre: d.nombre, documento: d.documento, empresa: d.empresa }));
                    agenda = calcularAgenda(agendaCruda.promesas, agendaCruda.cuotas, base, ahora, incluye);
                }
            } catch (e) {
                this.logger.error(
                    `mi-dia: falló la lectura de deudores usuario=${usuarioId}`,
                    e instanceof Error ? e.stack : String(e),
                );
                if (retomarCrudo) errores.push('retomar');
                if (agendaCruda) errores.push('agenda');
            }
        }

        const ms = Date.now() - t0;
        this.logger.log(
            `mi-dia usuario=${usuarioId} gestionesHoy=${gestiones?.hoy ?? '-'} retomar=${retomar?.length ?? '-'} ` +
                `agenda=${agenda ? `${agenda.totales.hoy}/${agenda.totales.proximos}/${agenda.totales.sinCumplir}` : '-'} en ${ms}ms`,
        );
        if (ms > MS_LENTO) {
            this.logger.warn(`mi-dia lento usuario=${usuarioId} ${ms}ms tiempos=${JSON.stringify(tiempos)}`);
        }

        return {
            generadoEn: ahora.toISOString(),
            hoy,
            errores,
            gestiones,
            retomar,
            agenda,
            promesas,
            importacionesHoy,
            reportes,
        };
    }

    // ─── Lecturas (todas con usuarioId = yo) ───────────────────────────────────

    /** G1. */
    private async leerGestiones(usuarioId: number, ahora: Date): Promise<GestionesDto> {
        const filas = await this.prisma.comentario.findMany({
            where: { usuarioId, origen: 'manual', fecha: { gte: inicioSerie(ahora) } },
            select: { fecha: true, deudorId: true },
            // Descendente: si se llega al tope, se pierden las más viejas y hoy y la semana quedan exactos.
            orderBy: { fecha: 'desc' },
            take: TOPE_FILAS_GESTIONES,
        });
        const truncado = filas.length >= TOPE_FILAS_GESTIONES;
        if (truncado) {
            this.logger.warn(`mi-dia: gestiones truncadas en ${TOPE_FILAS_GESTIONES} filas usuario=${usuarioId}`);
        }
        return calcularGestiones(filas, ahora, truncado);
    }

    /** G2 + G3. */
    private async leerRetomar(usuarioId: number, ahora: Date): Promise<RetomarCrudo[]> {
        const desde = inicioDelDia(sumarDiasYmd(ymdLocal(ahora), -RETOMAR_DIAS));
        const grupos = await this.prisma.comentario.groupBy({
            by: ['deudorId'],
            where: { usuarioId, origen: 'manual', fecha: { gte: desde } },
            _max: { fecha: true },
            _count: { _all: true },
            orderBy: { _max: { fecha: 'desc' } },
            take: RETOMAR_CANTIDAD,
        });
        const crudos = await Promise.all(
            grupos.map(async (g) => {
                const ultimo = await this.prisma.comentario.findFirst({
                    where: { deudorId: g.deudorId, usuarioId, origen: 'manual' },
                    orderBy: { fecha: 'desc' },
                    select: { texto: true, fecha: true },
                });
                if (!ultimo) return null;
                return {
                    deudorId: g.deudorId,
                    ultimaGestion: ultimo.fecha,
                    texto: ultimo.texto,
                    gestiones: g._count._all,
                } satisfies RetomarCrudo;
            }),
        );
        return crudos.filter((c): c is RetomarCrudo => c !== null);
    }

    /** G4. */
    private async leerDeudores(ids: number[]) {
        const mapa = new Map<
            number,
            { nombre: string; documento: string; empresa: string; estadoGestion: string | null; estadoSituacion: string | null }
        >();
        if (!ids.length) return mapa;
        const filas = await this.prisma.deudor.findMany({
            where: { id: { in: ids } },
            select: {
                id: true,
                nombre: true,
                apellido: true,
                documento: true,
                empresa: { select: { nombre: true } },
                estadoGestion: { select: { descripcion: true } },
                estadoSituacion: { select: { descripcion: true } },
            },
        });
        for (const f of filas) {
            mapa.set(f.id, {
                nombre: recortarTexto(`${f.nombre} ${f.apellido}`, 60),
                documento: f.documento,
                empresa: f.empresa?.nombre ?? '',
                estadoGestion: f.estadoGestion?.descripcion ?? null,
                estadoSituacion: f.estadoSituacion?.descripcion ?? null,
            });
        }
        return mapa;
    }

    private armarRetomar(
        crudos: RetomarCrudo[],
        deudores: Awaited<ReturnType<InicioService['leerDeudores']>>,
    ): RetomarItemDto[] {
        const items: RetomarItemDto[] = [];
        for (const c of crudos) {
            const d = deudores.get(c.deudorId);
            if (!d) continue; // caso borrado entre las dos lecturas
            items.push({
                deudorId: c.deudorId,
                nombre: d.nombre,
                documento: d.documento,
                empresa: d.empresa,
                ultimaGestion: c.ultimaGestion.toISOString(),
                ultimoTexto: recortarRetomar(c.texto),
                gestionesMias30d: c.gestiones,
                estadoGestion: d.estadoGestion,
                estadoSituacion: d.estadoSituacion,
            });
        }
        return items;
    }

    /** A1 + A2: promesas con `promesas.ver`, cuotas con `convenios.ver` y `convenios.crear`. */
    private async leerAgenda(
        usuarioId: number,
        ahora: Date,
        incluye: { promesas: boolean; cuotas: boolean },
    ): Promise<AgendaCruda> {
        const hoy = ymdLocal(ahora);
        const desde = fechaCalendarioUtc(sumarDiasYmd(hoy, -7));
        const hasta = fechaCalendarioUtc(sumarDiasYmd(hoy, 8));

        const promesas: PromesaFila[] = incluye.promesas
            ? await this.prisma.promesa_pago.findMany({
                  where: {
                      usuarioId,
                      estado: { in: ['VIGENTE', 'CUMPLIDA', 'INCUMPLIDA'] },
                      fechaPromesa: { gte: desde, lt: hasta },
                  },
                  select: {
                      id: true,
                      deudorId: true,
                      fechaPromesa: true,
                      monto: true,
                      estado: true,
                      cerradaEn: true,
                      observacion: true,
                  },
              })
            : [];

        let cuotas: CuotaFila[] = [];
        if (incluye.cuotas) {
            const convenios = await this.prisma.convenio.findMany({
                where: { usuarioId, estado: 'ACTIVO' },
                select: { id: true, deudorId: true, cantCuotas: true },
            });
            if (convenios.length) {
                const porId = new Map(convenios.map((c) => [c.id, c]));
                const filas = await this.prisma.cuota_convenio.findMany({
                    where: {
                        convenioId: { in: convenios.map((c) => c.id) },
                        estado: { in: ['PENDIENTE', 'PAGADA', 'VENCIDA'] },
                        fechaVencimiento: { gte: desde, lt: hasta },
                    },
                });
                cuotas = filas.map((f) => ({
                    id: f.id,
                    deudorId: porId.get(f.convenioId)?.deudorId ?? 0,
                    fechaVencimiento: f.fechaVencimiento,
                    importe: f.importe,
                    estado: f.estado,
                    fechaPago: f.fechaPago,
                    nroCuota: f.nroCuota,
                    cantCuotas: porId.get(f.convenioId)?.cantCuotas ?? 0,
                }));
            }
        }
        return { promesas, cuotas };
    }

    /**
     * P1 + P2 + vencenHoy. `vencenHoy` se lee con su propio `aggregate` en vez de reusar la agenda (spec P3):
     * así el indicador no depende de que la lista de la agenda haya podido cargarse.
     */
    private async leerPromesas(usuarioId: number, ahora: Date): Promise<IndicadoresPromesasDto> {
        const hoy = ymdLocal(ahora);
        const hoyUtc = fechaCalendarioUtc(hoy);
        const [tomadas7d, grupos, hoyAgg] = await Promise.all([
            this.prisma.promesa_pago.count({
                where: { usuarioId, estado: { not: 'ANULADA' }, createdAt: { gte: inicioDelDia(sumarDiasYmd(hoy, -6)) } },
            }),
            this.prisma.promesa_pago.groupBy({
                by: ['estado'],
                where: {
                    usuarioId,
                    estado: { in: ['CUMPLIDA', 'INCUMPLIDA'] },
                    fechaPromesa: { gte: fechaCalendarioUtc(sumarDiasYmd(hoy, -30)), lt: hoyUtc },
                },
                _count: { _all: true },
            }),
            this.prisma.promesa_pago.aggregate({
                where: {
                    usuarioId,
                    estado: 'VIGENTE',
                    fechaPromesa: { gte: hoyUtc, lt: fechaCalendarioUtc(sumarDiasYmd(hoy, 1)) },
                },
                _count: { _all: true },
                _sum: { monto: true },
            }),
        ]);
        const cuenta = (estado: string) => grupos.find((g) => g.estado === estado)?._count._all ?? 0;
        const cumplidas = cuenta('CUMPLIDA');
        return {
            tomadas7d,
            vencidas30d: { total: cumplidas + cuenta('INCUMPLIDA'), cumplidas },
            vencenHoy: { cantidad: hoyAgg._count._all, monto: hoyAgg._sum.monto ?? 0 },
        };
    }

    /** I1: las terminadas hoy de las remesas que creé yo. */
    private async leerImportaciones(usuarioId: number, ahora: Date): Promise<ImportacionTerminadaDto[]> {
        const filas = await this.prisma.import_progreso.findMany({
            where: { finishedAt: { gte: inicioDelDia(ymdLocal(ahora)) }, remesa: { usuarioCreadorId: usuarioId } },
            include: { remesa: { select: { nombre: true, numeroRemesa: true, empresa: { select: { nombre: true } } } } },
            orderBy: { finishedAt: 'desc' },
            take: 10,
        });
        return filas.map((f) => ({
            remesaId: f.remesaId,
            empresa: f.remesa.empresa?.nombre ?? '',
            nombre: f.remesa.nombre,
            numeroRemesa: f.remesa.numeroRemesa,
            resultado: f.resultado,
            terminadaEn: (f.finishedAt as Date).toISOString(),
            ok: f.ok,
            err: f.err,
        }));
    }

    /** R1: solo las mías, aunque tenga `reportes.ver_ejecuciones`. */
    private async leerReportes(usuarioId: number, ahora: Date): Promise<EjecucionResumenDto[]> {
        const filas = await this.prisma.ejecucion_reporte.findMany({
            where: { usuarioId, createdAt: { gte: inicioDelDia(sumarDiasYmd(ymdLocal(ahora), -6)) } },
            include: { plantilla: { select: { nombre: true } } },
            orderBy: { createdAt: 'desc' },
            take: 5,
        });
        return filas.map((f) => ({
            id: f.id,
            plantilla: f.plantilla.nombre,
            estado: f.estado as EjecucionResumenDto['estado'],
            progreso: f.progreso,
            formato: f.formato,
            totalFilas: f.totalFilas,
            creadaEn: f.createdAt.toISOString(),
            terminadaEn: f.finishedAt ? f.finishedAt.toISOString() : null,
            descargable: f.estado === 'FINALIZADA' && f.archivoPath != null,
        }));
    }
}
