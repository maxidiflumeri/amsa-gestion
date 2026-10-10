// Único escritor del estado de una carga durante el job (docs/imports-progreso-realtime-spec.md §8.5.1 y §9.5.2).
// Clase común, no un provider de Nest: `processImportJob` la instancia con lo que `ImportService` ya
// tiene inyectado, así que el constructor de `ImportService` no cambia.
//
// Fase B: el tracker tiene un reloj propio. Los reportes (`avance`, `avanceDelLote`, `subfase`,
// `contadores`) solo cambian la memoria; el reloj la vuelca a la base a lo sumo una vez por intervalo
// y late cada 15 s aunque no avance nada. Una sola escritura en vuelo por vez, y después de cada una
// la memoria NO se reemplaza (solo `rev` y `heartbeatAt`): mientras escribía, la carga siguió.
import { Logger } from '@nestjs/common';
import type { import_progreso, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { RealtimeService } from '../../realtime/realtime.service';
import {
    armarEstadoCarga,
    calcularPorcentaje,
    clasificarResultado,
    conPuntoDeMiles,
    leerResumen,
    motivoLegible,
    RESULTADO_CANCELADA,
    recortarMotivo,
} from './estado-carga';
import type { EstadoCargaDto, ResultadoCarga, ResumenCarga } from './estado-carga.types';

/** Lo que no cambia durante el job. */
export interface CargaInfo {
    remesaId: number;
    numeroRemesa: string;
    nombre: string;
    empresaId: number;
    tipo: string;
    usuarioId: number | null;
    /** 'Sistema' si no hay dueño. */
    usuarioNombre: string;
    /** `remesa.totalFilas` al cargar la remesa: el total de la vista previa. */
    totalFilasVistaPrevia: number;
}

export interface TrackerDeps {
    prisma: PrismaService;
    realtime: RealtimeService;
    logger: Logger;
    /** Reloj en milisegundos. Default `Date.now`. Para los tests. */
    ahora?: () => number;
    /** Intervalo del reloj. Default: `IMPORTS_PROGRESO_INTERVALO_MS`. Se acota a [250, 10.000]. */
    intervaloMs?: number;
}

export interface ContadoresCarga {
    ok: number;
    err: number;
    descartadas: number;
    /** Opcional para no romper las llamadas de hoy. undefined = no se toca lo que había. */
    fueraDeCorte?: number | null;
}

/** La tiran `iniciar`, `lote`, `entrarEnPostProceso` y `finalizar` cuando su escritura no afecta nada
 *  (la carga ya terminó, se borró o volvió a borrador): otro la cerró. */
export class CargaCerradaPorFueraError extends Error {
    constructor(remesaId?: number) {
        super(
            remesaId != null
                ? `La carga de la remesa ${remesaId} fue cerrada por fuera mientras se procesaba`
                : 'La carga fue cerrada por fuera mientras se procesaba',
        );
        this.name = 'CargaCerradaPorFueraError';
    }
}

/**
 * La tiran `iniciar` y `entrarEnPostProceso` cuando la compuerta lee un pedido de cancelación (la carga no
 * arranca / el `afterAll` no corre), y el runner en sus puntos de corte (§10.5.3). No es una falla.
 */
export class CargaCanceladaError extends Error {
    /** Dónde cortó el runner, para el log: `lote`, `fila`, `antes del cierre`, `post-proceso`. La compuerta no lo informa. */
    constructor(readonly donde?: string) {
        super('La carga fue cancelada');
        this.name = 'CargaCanceladaError';
    }
}

/** El `SELECT … FOR UPDATE` de la compuerta no devolvió fila: puede ser una remesa borrada o un resultado vacío espurio. */
class FilaAusenteError extends Error {}

/** La escritura no afectó ninguna fila pero la carga sigue viva: falla transitoria, se reintenta en el tic siguiente. */
class EscrituraVaciaError extends Error {}

export const INTERVALO_PROGRESO_DEFAULT_MS = 1_000;
export const INTERVALO_PROGRESO_MIN_MS = 250;
export const INTERVALO_PROGRESO_MAX_MS = 10_000;
/** Cada cuánto late el reloj aunque no haya nada que contar. Constante: guarda proporción con el umbral del reaper. */
export const LATIDO_MS = 15_000;
/** Una deriva del reloj de esto o más es un bloqueo del event loop que vale la pena dejar en el log. */
const DERIVA_WARN_MS = 5_000;
/** Largo máximo del texto de la subfase (`import_progreso.subfase` es VarChar(160)). */
const MAX_SUBFASE = 160;
/**
 * Tiempos de TODAS las transacciones del tracker. Con los defaults de Prisma (`maxWait` 2 s, `timeout` 5 s) un pool
 * sin conexiones libres 3 s, o la fila de la remesa tomada 7 s, hacían fallar `lote()` con P2028 y la carga quedaba
 * FALLIDA a mitad; antes de la atomicidad `lote` era un `update` común que toleraba 10 s de espera por conexión y
 * 50 s por lock.
 */
const TX_TRACKER = { maxWait: 10_000, timeout: 60_000 };
/** A lo sumo un `warn` por minuto por una escritura del reloj que falla. */
const WARN_FALLO_CADA_MS = 60_000;

/** Intervalo del reloj. Un valor que no es número cae al default; fuera de las cotas, a la cota. */
export function intervaloProgresoMs(raw: number | string | undefined | null = process.env.IMPORTS_PROGRESO_INTERVALO_MS): number {
    if (raw === undefined || raw === null || raw === '') return INTERVALO_PROGRESO_DEFAULT_MS;
    const n = Number(raw);
    if (!Number.isFinite(n)) return INTERVALO_PROGRESO_DEFAULT_MS;
    return Math.min(INTERVALO_PROGRESO_MAX_MS, Math.max(INTERVALO_PROGRESO_MIN_MS, Math.floor(n)));
}

export { conPuntoDeMiles };

/** "Consolidando casos: 1.500 de 8.875"; sin total (o con 0), solo el nombre. Recortado a 160. */
export function textoSubfase(nombre: string, hecho?: number, total?: number): string {
    let texto = nombre;
    if (total != null && Number.isFinite(total) && total > 0) {
        const h = hecho != null && Number.isFinite(hecho) ? Math.min(Math.max(0, hecho), total) : 0;
        texto = `${nombre}: ${conPuntoDeMiles(h)} de ${conPuntoDeMiles(total)}`;
    }
    return texto.length > MAX_SUBFASE ? texto.slice(0, MAX_SUBFASE) : texto;
}

/** Espejo en memoria. Lo escriben los reportes; el reloj lo vuelca a la base. */
interface Memoria {
    rev: number;
    estadoProceso: 'PROCESANDO' | 'FINALIZADA' | 'FALLIDA';
    fase: string;
    subfase: string | null;
    porcentaje: number;
    totalEsperado: number;
    procesadas: number;
    ok: number;
    err: number;
    descartadas: number;
    fueraDeCorte: number | null;
    nuevos: number | null;
    actualizados: number | null;
    advertencias: number;
    /** Filas ya resueltas del lote en curso (processors por lote). No se persiste: va dentro de `procesadas`. */
    adelantoDelLote: number;
    resultado: ResultadoCarga | typeof RESULTADO_CANCELADA | null;
    error: string | null;
    errorPostProceso: string | null;
    /** Lo último que leyó la compuerta o la escritura del reloj (`import_progreso.resumen`). */
    resumen: unknown;
    grupoId: string | null;
    grupoOrden: number | null;
    grupoTotal: number | null;
    /** Lo último que leyó la compuerta o el reloj. null = nadie pidió cancelar (o no se sabe). */
    cancelSolicitadaAt: Date | null;
    intentos: number;
    jobId: string | null;
    encoladaAt: Date | null;
    startedAt: Date | null;
    heartbeatAt: Date | null;
    finishedAt: Date | null;
}

export class ProgresoTracker {
    private readonly prisma: PrismaService;
    private readonly realtime: RealtimeService;
    private readonly logger: Logger;
    private readonly ahora: () => number;
    private readonly intervaloMs: number;
    private mem: Memoria;
    /** El estado terminal ya se persistió. */
    private terminado = false;
    /** `finalizar`/`fallar` empezaron: desde ahí el reloj no hace nada. */
    private terminando = false;
    private sinRegistrar = false;
    /** La fila previa ya tenía `startedAt`: BullMQ está re-ejecutando la carga. */
    private readonly reejecucion: boolean;

    private timer: NodeJS.Timeout | null = null;
    /** `cerrar()` ya se llamó (o el reloj se detuvo porque otro cerró la carga). */
    private cerrado = false;
    private cerradaPorFueraFlag = false;
    /** Hay reportes en memoria que todavía no se escribieron. Se apaga ANTES del `await` de la escritura. */
    private sucio = false;
    /** La escritura en vuelo (nunca rechaza). null = no hay ninguna. */
    private enVuelo: Promise<void> | null = null;
    private ultimaEscrituraMs = 0;
    private ultimoTicMs = 0;
    private ultimoCambioMs = 0;
    private ultimoWarnFalloMs = -Infinity;
    /** Nombre y comienzo del paso del post-proceso en curso (para loguear su duración). */
    private subfaseNombre: string | null = null;
    private subfaseDesdeMs = 0;
    /** Comienzo de la fase LEYENDO (para loguear cuánto tardó la lectura). */
    private lecturaDesdeMs: number | null = null;
    /**
     * Lo que el processor informó con `contadores()` y todavía no entró a la foto: el processor reporta a
     * mitad de una fila y el runner suma `ok` al final de ella, así que `nuevos` podía superar a `ok` en lo
     * persistido. Entra junto con el `avance` / `lote` siguiente, no antes.
     */
    private pendientes: { nuevos?: number; actualizados?: number } = {};
    /**
     * Escrituras del reloj o del latido seguidas que no afectaron ninguna fila y cuya lectura de confirmación también
     * salió vacía. Un resultado vacío aislado NO prueba que otro cerró la carga: una transacción vencida (por ejemplo
     * la de un borrado) contamina la operación siguiente de ese cliente Prisma y puede devolver vacío sobre una fila
     * que existe (medido: el runner cortó una carga sana en 1.300 de 2.500). Hacen falta dos seguidas.
     */
    private vaciosSeguidos = 0;
    /** Se supo que alguien pidió cancelar (compuerta, reloj o `avisarCancelacion`). No se apaga. */
    private cancelacionPedidaFlag = false;
    private cancelacionDesdeMs: number | null = null;
    private canceladaPorNombre: string | null = null;

    constructor(
        deps: TrackerDeps,
        private readonly info: CargaInfo,
        previa: import_progreso | null,
    ) {
        this.prisma = deps.prisma;
        this.realtime = deps.realtime;
        this.logger = deps.logger;
        this.ahora = deps.ahora ?? Date.now;
        this.intervaloMs = deps.intervaloMs !== undefined ? intervaloProgresoMs(deps.intervaloMs) : intervaloProgresoMs();
        this.mem = {
            rev: previa?.rev ?? 0,
            estadoProceso: 'PROCESANDO',
            fase: previa?.fase ?? 'BORRADOR',
            subfase: null,
            porcentaje: 0,
            totalEsperado: previa?.totalEsperado && previa.totalEsperado > 0 ? previa.totalEsperado : info.totalFilasVistaPrevia,
            procesadas: 0,
            ok: 0,
            err: 0,
            descartadas: 0,
            fueraDeCorte: null,
            nuevos: null,
            actualizados: null,
            advertencias: 0,
            adelantoDelLote: 0,
            resultado: null,
            error: null,
            errorPostProceso: null,
            resumen: previa?.resumen ?? null,
            grupoId: previa?.grupoId ?? null,
            grupoOrden: previa?.grupoOrden ?? null,
            grupoTotal: previa?.grupoTotal ?? null,
            cancelSolicitadaAt: previa?.cancelSolicitadaAt ?? null,
            intentos: previa?.intentos ?? 0,
            jobId: previa?.jobId ?? null,
            encoladaAt: previa?.encoladaAt ?? null,
            startedAt: previa?.startedAt ?? null,
            heartbeatAt: previa?.heartbeatAt ?? null,
            finishedAt: null,
        };
        // `iniciar` pisa el resto: la fila previa solo aporta `rev`, `intentos`, `encoladaAt` y `totalEsperado`.
        this.reejecucion = previa?.startedAt != null;
        this.ultimoCambioMs = this.ahora();
    }

    /** `fallar()` no pudo escribir el estado terminal: la base todavía dice PROCESANDO. */
    get noSePudoRegistrar(): boolean {
        return this.sinRegistrar;
    }

    /** Una escritura encontró la carga ya terminal o borrada: otro la cerró. */
    get cerradaPorFuera(): boolean {
        return this.cerradaPorFueraFlag;
    }

    /** `true` desde que el tracker supo que alguien pidió cancelar. No se apaga. */
    get cancelacionPedida(): boolean {
        return this.cancelacionPedidaFlag;
    }

    /** Nombre de quien pidió cancelar, si la compuerta o el reloj lo leyeron. Para el texto. */
    get canceladaPor(): string | null {
        return this.canceladaPorNombre;
    }

    /** Milisegundos desde que se supo del pedido; null si no hay pedido. Para el aviso del reaper. */
    get cancelacionPedidaHaceMs(): number | null {
        return this.cancelacionPedidaFlag && this.cancelacionDesdeMs != null
            ? Math.max(0, this.ahora() - this.cancelacionDesdeMs)
            : null;
    }

    /** Atajo en memoria: lo llama `cancelarCarga` después de su commit. Idempotente; no escribe. */
    avisarCancelacion(): void {
        this.marcarPedido();
    }

    private marcarPedido(): void {
        if (this.cancelacionPedidaFlag) return;
        this.cancelacionPedidaFlag = true;
        this.cancelacionDesdeMs = this.ahora();
    }

    /**
     * Lo que acaba de leer la compuerta (bajo el lock) o el reloj. Solo un valor NO nulo cuenta como pedido: un
     * resultado vacío espurio (§9.15) se lee como "nadie pidió cancelar". Deja `resumen` y el pedido al día
     * en la memoria y en la foto que se va a emitir.
     */
    private registrarLectura(
        leido: { cancelSolicitadaAt?: Date | string | null; resumen?: unknown },
        foto?: Memoria,
    ): void {
        const destinos = foto ? [this.mem, foto] : [this.mem];
        if (leido.resumen !== undefined) for (const d of destinos) d.resumen = leido.resumen;
        if (leido.cancelSolicitadaAt == null) return;
        const cuando = leido.cancelSolicitadaAt instanceof Date ? leido.cancelSolicitadaAt : new Date(leido.cancelSolicitadaAt);
        for (const d of destinos) d.cancelSolicitadaAt = cuando;
        this.marcarPedido();
        const nombre = leerResumen(leido.resumen ?? this.mem.resumen)?.cancelacion?.nombre;
        if (typeof nombre === 'string' && nombre) this.canceladaPorNombre = nombre;
    }

    /** Milisegundos desde el último reporte que cambió algo. Para el log del reaper. */
    get sinAvanceMs(): number {
        return Math.max(0, this.ahora() - this.ultimoCambioMs);
    }

    /** Fase y subfase en memoria, para el log del reaper y el aviso de deriva. */
    get faseActual(): { fase: string; subfase: string | null } {
        return { fase: this.mem.fase, subfase: this.mem.subfase };
    }

    /** Lo último que hay en memoria, armado con el mismo código que usan las lecturas HTTP. */
    get estado(): EstadoCargaDto {
        return this.armar(this.mem);
    }

    private armar(m: Memoria): EstadoCargaDto {
        const i = this.info;
        return armarEstadoCarga(
            {
                id: i.remesaId,
                numeroRemesa: i.numeroRemesa,
                nombre: i.nombre,
                empresaId: i.empresaId,
                categoria: i.tipo,
                usuarioCreadorId: i.usuarioId,
                usuarioCreador: i.usuarioId != null ? { id: i.usuarioId, nombre: i.usuarioNombre } : null,
                estadoProceso: m.estadoProceso,
                totalFilas: m.estadoProceso === 'FINALIZADA' ? m.procesadas : m.totalEsperado,
                okFilas: m.ok,
                errFilas: m.err,
            },
            {
                remesaId: i.remesaId,
                rev: m.rev,
                fase: m.fase,
                subfase: m.subfase,
                porcentaje: m.porcentaje,
                totalEsperado: m.totalEsperado,
                procesadas: m.procesadas,
                ok: m.ok,
                err: m.err,
                descartadas: m.descartadas,
                fueraDeCorte: m.fueraDeCorte,
                advertencias: m.advertencias,
                nuevos: m.nuevos,
                actualizados: m.actualizados,
                resultado: m.resultado,
                error: m.error,
                errorPostProceso: m.errorPostProceso,
                resumen: (m.resumen ?? null) as import_progreso['resumen'],
                intentos: m.intentos,
                jobId: m.jobId,
                grupoId: m.grupoId,
                grupoOrden: m.grupoOrden,
                grupoTotal: m.grupoTotal,
                cancelSolicitadaAt: m.cancelSolicitadaAt,
                encoladaAt: m.encoladaAt,
                startedAt: m.startedAt,
                heartbeatAt: m.heartbeatAt,
                finishedAt: m.finishedAt,
            },
            new Date(this.ahora()),
        );
    }

    // ── Reportes: solo memoria, sincrónicos, sin IO ─────────────────────────────────────────

    fijarTotalEsperado(n: number): void {
        this.mem.totalEsperado = Math.max(0, Math.floor(n));
        this.recalcular();
        this.sucio = true;
    }

    sumarAdvertencias(n: number): void {
        const antes = this.mem.advertencias;
        this.mem.advertencias += Math.max(0, Math.floor(n));
        if (this.mem.advertencias !== antes) this.sucio = true;
    }

    /** Contadores después de una fila. Si la fase era LEYENDO, pasa a PROCESANDO (llegó la primera fila). */
    avance(c: ContadoresCarga): void {
        let cambio = this.aplicarPendientes();
        if (this.mem.fase === 'LEYENDO') {
            this.mem.fase = 'PROCESANDO';
            if (this.lecturaDesdeMs != null) {
                this.logger.log(`Lectura remesa=${this.info.remesaId} terminó en ${this.ahora() - this.lecturaDesdeMs}ms`);
                this.lecturaDesdeMs = null;
            }
            cambio = true;
        }
        if (this.mem.ok !== c.ok || this.mem.err !== c.err || this.mem.descartadas !== c.descartadas) cambio = true;
        this.mem.ok = c.ok;
        this.mem.err = c.err;
        this.mem.descartadas = c.descartadas;
        if (c.fueraDeCorte !== undefined && this.mem.fueraDeCorte !== c.fueraDeCorte) {
            this.mem.fueraDeCorte = c.fueraDeCorte;
            cambio = true;
        }
        this.recalcular();
        if (cambio) this.marcarCambio();
    }

    /** Filas del lote en curso ya resueltas (processors por lote). Acotado a lo que le falta al total. */
    avanceDelLote(n: number): void {
        const pedido = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
        const hechas = this.mem.ok + this.mem.err;
        const tope = this.mem.totalEsperado > 0 ? Math.max(0, this.mem.totalEsperado - hechas) : pedido;
        const adelanto = Math.min(pedido, tope);
        if (adelanto === this.mem.adelantoDelLote) return;
        this.mem.adelantoDelLote = adelanto;
        this.recalcular();
        this.marcarCambio();
    }

    /** Paso del post-proceso. Arma el texto y, si cambió el nombre, loguea el tiempo del paso anterior. */
    subfase(nombre: string, hecho?: number, total?: number): void {
        const texto = textoSubfase(nombre, hecho, total);
        if (nombre !== this.subfaseNombre) {
            this.loguearSubfaseTerminada();
            this.subfaseNombre = nombre;
            this.subfaseDesdeMs = this.ahora();
        }
        if (texto === this.mem.subfase) return;
        this.mem.subfase = texto;
        this.marcarCambio();
    }

    /** Casos nuevos y actualizados de la carga hasta ahora (absolutos). `undefined` = no se toca. */
    contadores(c: { nuevos?: number; actualizados?: number }): void {
        // Solo se anotan: entran a la foto con el próximo `avance` o `lote` (ver `pendientes`).
        if (c.nuevos !== undefined) this.pendientes.nuevos = c.nuevos;
        if (c.actualizados !== undefined) this.pendientes.actualizados = c.actualizados;
    }

    /** Pasa los contadores informados a la memoria. Devuelve si algo cambió. */
    private aplicarPendientes(): boolean {
        let cambio = false;
        const { nuevos, actualizados } = this.pendientes;
        if (nuevos !== undefined && this.mem.nuevos !== nuevos) {
            this.mem.nuevos = nuevos;
            cambio = true;
        }
        if (actualizados !== undefined && this.mem.actualizados !== actualizados) {
            this.mem.actualizados = actualizados;
            cambio = true;
        }
        this.pendientes = {};
        return cambio;
    }

    /** Loguea el paso del post-proceso que quedó abierto. La llama el runner al terminar el `afterAll`. */
    cerrarSubfase(): void {
        this.loguearSubfaseTerminada();
        this.subfaseNombre = null;
    }

    private loguearSubfaseTerminada(): void {
        if (this.subfaseNombre == null) return;
        this.logger.log(
            `Post-proceso remesa=${this.info.remesaId} «${this.subfaseNombre}» en ${this.ahora() - this.subfaseDesdeMs}ms`,
        );
    }

    private marcarCambio(): void {
        this.sucio = true;
        this.ultimoCambioMs = this.ahora();
    }

    private recalcular(): void {
        this.mem.procesadas = this.mem.ok + this.mem.err + this.mem.adelantoDelLote;
        this.mem.porcentaje = calcularPorcentaje(this.mem.procesadas, this.mem.totalEsperado);
    }

    // ── Escrituras que pide el runner ───────────────────────────────────────────────────────

    /** El worker tomó el job. Una vez por intento; va ANTES de cualquier validación. Arranca el reloj. */
    async iniciar(jobId: string | undefined): Promise<void> {
        const ahora = new Date(this.ahora());
        const intentos = this.mem.intentos + 1;
        if (intentos > 1 || this.reejecucion) {
            this.logger.warn(
                `Re-ejecución de la remesa ${this.info.remesaId} (intento ${intentos}): el progreso se reinicia`,
            );
        }
        const siguiente: Memoria = {
            ...this.mem,
            estadoProceso: 'PROCESANDO',
            fase: 'PROCESANDO',
            subfase: null,
            porcentaje: 0,
            procesadas: 0,
            ok: 0,
            err: 0,
            descartadas: 0,
            fueraDeCorte: null,
            nuevos: null,
            actualizados: null,
            advertencias: 0,
            adelantoDelLote: 0,
            resultado: null,
            error: null,
            errorPostProceso: null,
            intentos,
            jobId: jobId ? String(jobId).slice(0, 64) : null,
            // Solo si estaba en null: el job lo encoló `executeRemesa`; uno del código viejo no tiene fecha.
            encoladaAt: this.mem.encoladaAt ?? ahora,
            startedAt: ahora,
            heartbeatAt: ahora,
            finishedAt: null,
        };
        // `totalEsperado` puede haberlo fijado el runner antes (no pasa: `iniciar` va primero), pero si
        // llegó un reporte previo no se pierde.
        await this.escribirExclusivo(async () => {
            siguiente.rev = await this.persistir(
                { estadoProceso: 'PROCESANDO', okFilas: 0, errFilas: 0 },
                siguiente,
                { soloSiSigueEncolada: true, abortarSiCancelada: true },
            );
            this.mem = siguiente;
            this.sucio = false;
            this.ultimaEscrituraMs = this.ahora();
            this.emitir('emitImportIniciada', siguiente);
        });
        this.arrancarReloj();
    }

    /** Fase LEYENDO: antes de una lectura que bloquea (Excel, categorías pre-parseadas). Nunca tira. */
    async entrarEnLectura(): Promise<void> {
        try {
            if (this.cerradaPorFueraFlag) return;
            await this.escribirExclusivo(async () => {
                this.mem.fase = 'LEYENDO';
                this.lecturaDesdeMs = this.ahora();
                const foto = this.fotoParaEscribir();
                this.sucio = false;
                try {
                    foto.rev = await this.persistir({}, foto);
                } catch (e) {
                    this.sucio = true;
                    throw e;
                }
                this.despuesDeEscribir(foto);
                this.emitir('emitImportProgreso', foto);
            });
        } catch (e: any) {
            if (e instanceof CargaCerradaPorFueraError) return;
            this.logger.warn(`No se pudo registrar la fase LEYENDO de la remesa ${this.info.remesaId}: ${motivoLegible(e)}`);
        }
    }

    /** Un lote ya procesado. Persiste y emite SIEMPRE. Deja pasar el error de la base: sin poder escribir
     *  el progreso no hay forma de escribir las filas, y es mejor fallar acá que seguir a ciegas. */
    async lote(c: ContadoresCarga): Promise<void> {
        if (this.cerradaPorFueraFlag) throw new CargaCerradaPorFueraError(this.info.remesaId);
        this.mem.fase = 'PROCESANDO';
        this.aplicarPendientes();
        this.mem.ok = c.ok;
        this.mem.err = c.err;
        this.mem.descartadas = c.descartadas;
        if (c.fueraDeCorte !== undefined) this.mem.fueraDeCorte = c.fueraDeCorte;
        // El adelanto del lote vuelve a 0: desde acá `procesadas = ok + err`.
        this.mem.adelantoDelLote = 0;
        this.recalcular();
        this.ultimoCambioMs = this.ahora();
        await this.escribirExclusivo(async () => {
            if (this.cerradaPorFueraFlag) throw new CargaCerradaPorFueraError(this.info.remesaId);
            const foto = this.fotoParaEscribir();
            this.sucio = false;
            try {
                // `totalFilas` NO se toca acá: el acumulado pisaba el total de la vista previa (#9).
                foto.rev = await this.persistir({ okFilas: foto.ok, errFilas: foto.err }, foto);
            } catch (e) {
                this.sucio = true;
                throw e;
            }
            this.despuesDeEscribir(foto);
            this.emitir('emitImportProgreso', foto);
        });
    }

    /**
     * Va a empezar el `afterAll`. La compuerta relee el pedido de cancelación con la fila bloqueada: si lo hay, NO
     * escribe y tira `CargaCanceladaError` (el cierre no corre). Es lo que serializa el pedido contra esta entrada.
     */
    async entrarEnPostProceso(): Promise<void> {
        if (this.cerradaPorFueraFlag) throw new CargaCerradaPorFueraError(this.info.remesaId);
        const antes = { fase: this.mem.fase, subfase: this.mem.subfase, subfaseNombre: this.subfaseNombre };
        this.mem.fase = 'POST_PROCESO';
        this.mem.subfase = null;
        this.mem.adelantoDelLote = 0;
        this.subfaseNombre = null;
        this.recalcular();
        this.ultimoCambioMs = this.ahora();
        await this.escribirExclusivo(async () => {
            if (this.cerradaPorFueraFlag) throw new CargaCerradaPorFueraError(this.info.remesaId);
            const foto = this.fotoParaEscribir();
            this.sucio = false;
            try {
                foto.rev = await this.persistir({}, foto, { abortarSiCancelada: true });
            } catch (e) {
                this.sucio = true;
                if (e instanceof CargaCanceladaError) {
                    // No entró: la fase vuelve a ser la que era (la memoria se había adelantado a la escritura).
                    this.mem.fase = antes.fase;
                    this.mem.subfase = antes.subfase;
                    this.subfaseNombre = antes.subfaseNombre;
                }
                throw e;
            }
            this.despuesDeEscribir(foto);
            this.emitir('emitImportProgreso', foto);
        });
    }

    /** Terminaron las filas (y el post-proceso, si lo hay). Idempotente. Si la base falla, tira. */
    async finalizar(c: ContadoresCarga & { errorPostProceso: string | null }): Promise<EstadoCargaDto> {
        if (this.terminado) {
            this.logger.warn(`finalizar() sobre la remesa ${this.info.remesaId}, que ya terminó: se ignora`);
            return this.estado;
        }
        if (this.cerradaPorFueraFlag) throw new CargaCerradaPorFueraError(this.info.remesaId);
        // Desde acá el reloj no hace nada; esperar la escritura en vuelo es parte de `escribirExclusivo`.
        this.terminando = true;
        this.detenerReloj();
        this.cerrarSubfase();
        const ahora = new Date(this.ahora());
        const procesadas = c.ok + c.err;
        const resultado = clasificarResultado({
            huboExcepcion: false,
            postProcesoFallo: c.errorPostProceso != null,
            procesadas,
            err: c.err,
        });
        return this.escribirExclusivo(async () => {
            if (this.cerradaPorFueraFlag) throw new CargaCerradaPorFueraError(this.info.remesaId);
            const foto: Memoria = {
                ...this.mem,
                estadoProceso: 'FINALIZADA',
                fase: 'TERMINADA',
                subfase: null,
                porcentaje: 100,
                procesadas,
                ok: c.ok,
                err: c.err,
                descartadas: c.descartadas,
                fueraDeCorte: c.fueraDeCorte !== undefined ? c.fueraDeCorte : this.mem.fueraDeCorte,
                adelantoDelLote: 0,
                resultado,
                errorPostProceso: c.errorPostProceso != null ? recortarMotivo(c.errorPostProceso) : null,
                heartbeatAt: ahora,
                finishedAt: ahora,
            };
            foto.rev = await this.persistir(
                { estadoProceso: 'FINALIZADA', totalFilas: procesadas, okFilas: c.ok, errFilas: c.err },
                foto,
            );
            this.mem = foto;
            this.terminado = true;
            const estado = this.armar(foto);
            this.emitir('emitImportFinalizada', foto);
            return estado;
        });
    }

    /**
     * La carga falló. Nunca tira: si no puede escribir, lo loguea con stack y NO emite (la carga queda
     * en PROCESANDO; es el caso que cubre el reaper). Devuelve igual el estado terminal que
     * correspondía, para que quien llama pueda notificar.
     */
    async fallar(error: unknown, c: ContadoresCarga, o: { sinFilasEntregadas?: boolean } = {}): Promise<EstadoCargaDto> {
        if (this.terminado) {
            this.logger.error(
                `fallar() sobre la remesa ${this.info.remesaId}, que ya terminó: no se pisa el estado terminal ` +
                `(${error instanceof Error ? error.message : String(error)})`,
            );
            return this.estado;
        }
        this.terminando = true;
        this.detenerReloj();
        this.cerrarSubfase();
        const ahora = new Date(this.ahora());
        const procesadas = c.ok + c.err;
        const foto: Memoria = {
            ...this.mem,
            estadoProceso: 'FALLIDA',
            fase: 'TERMINADA',
            subfase: null,
            porcentaje: calcularPorcentaje(procesadas, this.mem.totalEsperado, 'FALLIDA'),
            procesadas,
            ok: c.ok,
            err: c.err,
            descartadas: c.descartadas,
            fueraDeCorte: c.fueraDeCorte !== undefined ? c.fueraDeCorte : this.mem.fueraDeCorte,
            adelantoDelLote: 0,
            resultado: 'FALLIDA',
            error: motivoLegible(error),
            heartbeatAt: ahora,
            finishedAt: ahora,
        };
        if (this.cerradaPorFueraFlag) return this.armar(foto);
        try {
            await this.escribirExclusivo(async () => {
                if (this.cerradaPorFueraFlag) return;
                // La clave `resumen` entra a la escritura SOLO con el marcador: en cualquier otro caso no se toca.
                foto.rev = await this.persistir(
                    { estadoProceso: 'FALLIDA', okFilas: c.ok, errFilas: c.err },
                    foto,
                    o.sinFilasEntregadas === true ? { mezclarResumen: { sinFilasEntregadas: true } } : {},
                );
                this.mem = foto;
                this.terminado = true;
                this.emitir('emitImportFinalizada', foto);
            });
        } catch (e: any) {
            if (e instanceof CargaCerradaPorFueraError) return this.armar({ ...foto, rev: this.mem.rev });
            this.logger.error(
                `No se pudo marcar la remesa ${this.info.remesaId} como FALLIDA: ${motivoLegible(e)}. ` +
                'Queda en PROCESANDO y no se emite import:finalizada.',
                e?.stack,
            );
            this.sinRegistrar = true;
            return this.armar({ ...foto, rev: this.mem.rev });
        }
        return this.terminado ? this.estado : this.armar({ ...foto, rev: this.mem.rev });
    }

    /**
     * Cierre por cancelación (§10.5.3). Mismo contrato que `fallar`: nunca tira, detiene el reloj, espera la
     * escritura en vuelo, escribe por la compuerta y emite `import:finalizada`. Los contadores son exactos:
     * el runner vivo los escribe, y el corte cae siempre después de una fila o de un lote completos. La
     * columna `resultado` guarda `CANCELADA`; el DTO la traduce a `FALLIDA` + `cancelada: true`.
     */
    async cancelar(c: ContadoresCarga, o: { texto: string; sinFilasEntregadas: boolean }): Promise<EstadoCargaDto> {
        if (this.terminado) {
            this.logger.error(`cancelar() sobre la remesa ${this.info.remesaId}, que ya terminó: no se pisa el estado terminal`);
            return this.estado;
        }
        this.terminando = true;
        this.detenerReloj();
        this.cerrarSubfase();
        this.marcarPedido();
        const ahora = new Date(this.ahora());
        const procesadas = c.ok + c.err;
        const foto: Memoria = {
            ...this.mem,
            estadoProceso: 'FALLIDA',
            fase: 'TERMINADA',
            subfase: null,
            porcentaje: calcularPorcentaje(procesadas, this.mem.totalEsperado, 'FALLIDA'),
            procesadas,
            ok: c.ok,
            err: c.err,
            descartadas: c.descartadas,
            fueraDeCorte: c.fueraDeCorte !== undefined ? c.fueraDeCorte : this.mem.fueraDeCorte,
            adelantoDelLote: 0,
            resultado: RESULTADO_CANCELADA,
            error: recortarMotivo(o.texto),
            heartbeatAt: ahora,
            finishedAt: ahora,
        };
        if (this.cerradaPorFueraFlag) return this.armar(foto);
        try {
            await this.escribirExclusivo(async () => {
                if (this.cerradaPorFueraFlag) return;
                // Sin `abortarSiCancelada`: el pedido es justamente lo que se está honrando.
                foto.rev = await this.persistir(
                    { estadoProceso: 'FALLIDA', okFilas: c.ok, errFilas: c.err },
                    foto,
                    o.sinFilasEntregadas ? { mezclarResumen: { sinFilasEntregadas: true } } : {},
                );
                this.mem = foto;
                this.terminado = true;
                this.emitir('emitImportFinalizada', foto);
            });
        } catch (e: any) {
            if (e instanceof CargaCerradaPorFueraError) return this.armar({ ...foto, rev: this.mem.rev });
            this.logger.error(
                `No se pudo marcar la remesa ${this.info.remesaId} como cancelada: ${motivoLegible(e)}. ` +
                'Queda en PROCESANDO y no se emite import:finalizada.',
                e?.stack,
            );
            this.sinRegistrar = true;
            return this.armar({ ...foto, rev: this.mem.rev });
        }
        return this.terminado ? this.estado : this.armar({ ...foto, rev: this.mem.rev });
    }

    /** Detiene el reloj. Idempotente. Lo llama el `finally` del runner. */
    cerrar(): void {
        this.cerrado = true;
        this.detenerReloj();
    }

    // ── Reloj ───────────────────────────────────────────────────────────────────────────────

    private arrancarReloj(): void {
        if (this.timer || this.cerrado || this.terminando || this.cerradaPorFueraFlag) return;
        this.ultimoTicMs = this.ahora();
        this.timer = setInterval(() => {
            // `tic` atrapa todo, pero el `catch` final es el seguro: una promesa rechazada sin manejar
            // dentro de un `setInterval` tumba el proceso entero.
            this.tic().catch(() => undefined);
        }, this.intervaloMs);
        this.timer.unref?.();
    }

    private detenerReloj(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    private async tic(): Promise<void> {
        try {
            const ahora = this.ahora();
            const deriva = ahora - (this.ultimoTicMs + this.intervaloMs);
            this.ultimoTicMs = ahora;
            if (deriva >= DERIVA_WARN_MS) {
                const { fase, subfase } = this.faseActual;
                this.logger.warn(
                    `Event loop bloqueado ~${Math.round(deriva)} ms durante la remesa ${this.info.remesaId} ` +
                    `(${fase}${subfase ? `, ${subfase}` : ''})`,
                );
            }
            if (this.cerrado || this.terminando || this.terminado || this.cerradaPorFueraFlag) return;
            if (this.enVuelo) return;
            if (this.sucio) {
                await this.escribirProgresoDelReloj();
            } else if (ahora - this.ultimaEscrituraMs >= LATIDO_MS) {
                await this.escribirLatido();
            }
        } catch (e: any) {
            if (e instanceof CargaCerradaPorFueraError) return;
            const ahora = this.ahora();
            if (ahora - this.ultimoWarnFalloMs >= WARN_FALLO_CADA_MS) {
                this.ultimoWarnFalloMs = ahora;
                try {
                    this.logger.warn(`Falló la escritura del progreso de la remesa ${this.info.remesaId}: ${motivoLegible(e)}`);
                } catch {
                    // un logger roto no puede tumbar el reloj
                }
            }
        }
    }

    /** La escritura del reloj: la foto de progreso y el `import:progreso`. Va SOLO a `import_progreso`. */
    private async escribirProgresoDelReloj(): Promise<void> {
        await this.escribirExclusivo(async () => {
            if (this.cerradaPorFueraFlag || this.terminando || this.cerrado) return;
            const foto = this.fotoParaEscribir();
            this.sucio = false;
            try {
                foto.rev = await this.persistirSoloProgreso(foto);
            } catch (e) {
                // Vuelve a quedar pendiente: el próximo tic reintenta.
                this.sucio = true;
                throw e;
            }
            this.despuesDeEscribir(foto);
            this.emitir('emitImportProgreso', foto);
        });
    }

    /** El latido: solo `heartbeatAt`. Una sentencia sobre una fila que ningún processor toca. No emite. */
    private async escribirLatido(): Promise<void> {
        await this.escribirExclusivo(async () => {
            if (this.cerradaPorFueraFlag || this.terminando || this.cerrado) return;
            const heartbeatAt = new Date(this.ahora());
            const { count } = await this.prisma.import_progreso.updateMany({
                where: { remesaId: this.info.remesaId, finishedAt: null },
                data: { heartbeatAt, rev: { increment: 1 } },
            });
            if (count === 0) {
                try {
                    await this.resolverEscrituraVacia();
                } catch (e) {
                    if (e instanceof CargaCerradaPorFueraError) this.marcarCerradaPorFuera();
                    throw e;
                }
            }
            this.vaciosSeguidos = 0;
            this.mem.rev += 1;
            this.mem.heartbeatAt = heartbeatAt;
            this.ultimaEscrituraMs = this.ahora();
        });
    }

    // ── Escritura ───────────────────────────────────────────────────────────────────────────

    /** Una copia de la memoria, con el latido en este instante. Es lo que se persiste Y lo que se emite. */
    private fotoParaEscribir(): Memoria {
        return { ...this.mem, heartbeatAt: new Date(this.ahora()) };
    }

    /**
     * Después de una escritura la memoria NO se reemplaza con la foto: mientras escribía, la carga
     * siguió y los reportes cambiaron la memoria. Solo se actualizan `rev` y `heartbeatAt`.
     */
    private despuesDeEscribir(foto: Memoria): void {
        this.mem.rev = foto.rev;
        this.mem.heartbeatAt = foto.heartbeatAt;
        this.ultimaEscrituraMs = this.ahora();
    }

    /** Una escritura por vez: espera a la que esté en vuelo y recién ahí corre la suya. */
    private async escribirExclusivo<T>(escribir: () => Promise<T>): Promise<T> {
        while (this.enVuelo) await this.enVuelo;
        const propia = escribir();
        const marca: Promise<void> = propia.then(
            () => undefined,
            () => undefined,
        );
        this.enVuelo = marca;
        try {
            return await propia;
        } finally {
            if (this.enVuelo === marca) this.enVuelo = null;
        }
    }

    private marcarCerradaPorFuera(): void {
        if (!this.cerradaPorFueraFlag) {
            this.cerradaPorFueraFlag = true;
            this.logger.warn(
                `La remesa ${this.info.remesaId} fue cerrada por fuera (terminó, se borró o volvió a borrador): ` +
                'se deja de escribir su progreso',
            );
        }
        this.detenerReloj();
    }

    /** Los campos de la fila de progreso que cambian durante la carga. */
    private camposDeProgreso(m: Memoria) {
        return {
            fase: m.fase,
            subfase: m.subfase,
            porcentaje: m.porcentaje,
            totalEsperado: m.totalEsperado,
            procesadas: m.procesadas,
            ok: m.ok,
            err: m.err,
            descartadas: m.descartadas,
            fueraDeCorte: m.fueraDeCorte,
            nuevos: m.nuevos,
            actualizados: m.actualizados,
            advertencias: m.advertencias,
            heartbeatAt: m.heartbeatAt,
        };
    }

    /**
     * Escritura del reloj: SOLO `import_progreso`, en una sentencia condicionada (`finishedAt IS NULL`) con el
     * chequeo de filas afectadas, y el `rev` que quedó en la base leído en la misma transacción. No toca
     * `remesa`: así no espera detrás de los locks de FK de las transacciones de los processors (medido: una
     * transacción de MULTICLAVES de 12 s la dejaba esperando 12 s) ni encola a terceros detrás de ella.
     * `remesa.okFilas` / `errFilas` se escriben al cierre de cada lote.
     */
    private async persistirSoloProgreso(m: Memoria): Promise<number> {
        const remesaId = this.info.remesaId;
        try {
            return await this.prisma.$transaction(async (tx) => {
                const { count } = await tx.import_progreso.updateMany({
                    where: { remesaId, finishedAt: null },
                    data: { ...this.camposDeProgreso(m), rev: { increment: 1 } },
                });
                if (count === 0) return null;
                // Mismo `select` que antes más el pedido de cancelación: ninguna sentencia nueva. Es lo que hace llegar
                // el pedido a una carga que corre en otro proceso.
                const r = await tx.import_progreso.findUnique({
                    where: { remesaId },
                    select: { rev: true, cancelSolicitadaAt: true, resumen: true },
                });
                if (r) this.registrarLectura({ cancelSolicitadaAt: r.cancelSolicitadaAt, resumen: r.resumen }, m);
                return r?.rev ?? this.mem.rev + 1;
            }, TX_TRACKER).then(async (rev) => {
                if (rev === null) return this.resolverEscrituraVacia();
                this.vaciosSeguidos = 0;
                return rev;
            });
        } catch (e) {
            if (e instanceof CargaCerradaPorFueraError) this.marcarCerradaPorFuera();
            throw e;
        }
    }

    /**
     * Una sentencia condicionada del reloj o del latido no afectó ninguna fila. Antes de darse por cerrado por fuera
     * se CONFIRMA con una lectura nueva: cerrada de verdad (la fila tiene `finishedAt` o la remesa es terminal) →
     * cerrada por fuera; fila viva → falla transitoria (se reintenta en el tic siguiente); lectura vacía o que falla →
     * dudoso, y recién el segundo tic seguido que lo confirma da por cerrada la carga.
     */
    private async resolverEscrituraVacia(): Promise<never> {
        const remesaId = this.info.remesaId;
        let veredicto: 'CERRADA' | 'VIVA' | 'DUDOSA' = 'DUDOSA';
        try {
            const r = await this.prisma.import_progreso.findUnique({
                where: { remesaId },
                select: { finishedAt: true, remesa: { select: { estadoProceso: true } } },
            });
            if (r) {
                const estado = r.remesa?.estadoProceso;
                veredicto = r.finishedAt != null || estado === 'FINALIZADA' || estado === 'FALLIDA' ? 'CERRADA' : 'VIVA';
            }
        } catch {
            veredicto = 'DUDOSA';
        }
        if (veredicto === 'VIVA') this.vaciosSeguidos = 0;
        else if (veredicto === 'CERRADA' || ++this.vaciosSeguidos >= 2) {
            this.vaciosSeguidos = 0;
            throw new CargaCerradaPorFueraError(remesaId);
        }
        throw new EscrituraVaciaError(
            `La escritura del progreso de la remesa ${remesaId} no afectó ninguna fila pero no se pudo confirmar que la carga esté cerrada: se reintenta`,
        );
    }

    /**
     * Escritura que toca `remesa`: la condición ("la carga no terminó", y en `iniciar` además "sigue encolada")
     * y la escritura son ATÓMICAS. El `update` con `where` condicionado de Prisma no lo es (hace un `SELECT` y
     * después un `UPDATE … WHERE id IN`, así que si otro cerró la carga en el medio no tira `P2025` y el `UPDATE`
     * de la fila anidada corre igual y pisa el estado terminal): se relee la remesa y su fila con `FOR UPDATE`
     * —mismo orden de locks que `cerrarCargaInterrumpida`: `remesa` y después `import_progreso`— y recién
     * entonces se escribe. Una remesa sin fila de progreso (job del código viejo) sigue entrando: el `upsert`
     * anidado la crea. Devuelve el `rev` resultante.
     */
    private async persistir(
        remesaData: Prisma.remesaUpdateInput,
        m: Memoria,
        opciones: {
            soloSiSigueEncolada?: boolean;
            /** Con un pedido de cancelación en la fila NO escribe y tira `CargaCanceladaError`. */
            abortarSiCancelada?: boolean;
            /** Se mezcla con el `resumen` que se acaba de leer bajo el lock, nunca con una copia de memoria. */
            mezclarResumen?: Partial<ResumenCarga>;
        } = {},
    ): Promise<number> {
        const remesaId = this.info.remesaId;
        const campos = {
            ...this.camposDeProgreso(m),
            resultado: m.resultado,
            error: m.error,
            errorPostProceso: m.errorPostProceso,
            intentos: m.intentos,
            jobId: m.jobId,
            encoladaAt: m.encoladaAt,
            startedAt: m.startedAt,
            finishedAt: m.finishedAt,
        };
        // El `resumen` mezclado solo pasa a la foto cuando la transacción confirmó.
        let resumenEscrito: ResumenCarga | undefined;
        const una = () => this.prisma.$transaction(async (tx) => {
                const filas = await tx.$queryRaw<
                    Array<{
                        estadoProceso: string;
                        progresoId: number | null;
                        encoladaAt: Date | null;
                        finishedAt: Date | null;
                        // Tolerante: un doble que no las devuelve se lee como "nadie pidió cancelar".
                        cancelSolicitadaAt?: Date | null;
                        resumen?: unknown;
                    }>
                >`
                    SELECT r.estadoProceso AS estadoProceso, p.remesaId AS progresoId, p.encoladaAt AS encoladaAt, p.finishedAt AS finishedAt,
                           p.cancelSolicitadaAt AS cancelSolicitadaAt, p.resumen AS resumen
                    FROM remesa r LEFT JOIN import_progreso p ON p.remesaId = r.id
                    WHERE r.id = ${remesaId}
                    FOR UPDATE
                `;
                const f = filas[0];
                // Sin fila: puede ser una remesa borrada o un vacío espurio (ver `vaciosSeguidos`): se reintenta una vez.
                if (!f) throw new FilaAusenteError();
                if (
                    f.estadoProceso === 'FINALIZADA' ||
                    f.estadoProceso === 'FALLIDA' ||
                    f.finishedAt != null ||
                    // Solo en `iniciar`: la carga tiene que seguir encolada (cierra la carrera de §9.5.8). En
                    // negativo, para que una remesa sin fila (job del código viejo) siga entrando.
                    (opciones.soloSiSigueEncolada && f.progresoId != null && f.encoladaAt == null)
                ) {
                    throw new CargaCerradaPorFueraError(remesaId);
                }
                // Lo que dice la fila AHORA, con el lock tomado: el pedido de cancelación se serializa contra esta escritura.
                this.registrarLectura({ cancelSolicitadaAt: f.cancelSolicitadaAt, resumen: f.resumen }, m);
                if (opciones.abortarSiCancelada && f.cancelSolicitadaAt != null) throw new CargaCanceladaError();
                const mezclado = opciones.mezclarResumen
                    ? { v: 1, ...(leerResumen(f.resumen) ?? {}), ...opciones.mezclarResumen }
                    : undefined;
                resumenEscrito = mezclado;
                const conResumen = mezclado ? { ...campos, resumen: mezclado as Prisma.InputJsonObject } : campos;
                const r = await tx.remesa.update({
                    where: { id: remesaId },
                    data: {
                        ...remesaData,
                        progreso: {
                            upsert: {
                                create: { ...conResumen, rev: 1 },
                                update: { ...conResumen, rev: { increment: 1 } },
                            },
                        },
                    },
                    select: { progreso: { select: { rev: true } } },
                });
                return r?.progreso?.rev ?? this.mem.rev + 1;
            }, TX_TRACKER);
        try {
            try {
                const rev = await una();
                if (resumenEscrito) m.resumen = resumenEscrito;
                return rev;
            } catch (e) {
                if (!(e instanceof FilaAusenteError)) throw e;
                this.logger.warn(`La remesa ${remesaId} no devolvió fila al bloquearla: se reintenta una vez antes de darla por cerrada`);
                const rev = await una();
                if (resumenEscrito) m.resumen = resumenEscrito;
                return rev;
            }
        } catch (e: any) {
            if (e instanceof FilaAusenteError) e = new CargaCerradaPorFueraError(remesaId);
            if (e instanceof CargaCerradaPorFueraError || e?.code === 'P2025') {
                this.marcarCerradaPorFuera();
                throw e instanceof CargaCerradaPorFueraError ? e : new CargaCerradaPorFueraError(remesaId);
            }
            throw e;
        }
    }

    /** Persistir primero, emitir después; un fallo del socket es un `warn`, nunca una carga caída. */
    private emitir(metodo: 'emitImportIniciada' | 'emitImportProgreso' | 'emitImportFinalizada', foto: Memoria): void {
        try {
            this.realtime[metodo](this.armar(foto));
        } catch (e: any) {
            this.logger.warn(`Error emitiendo ${metodo} de la remesa ${this.info.remesaId}: ${e?.message}`);
        }
    }
}
