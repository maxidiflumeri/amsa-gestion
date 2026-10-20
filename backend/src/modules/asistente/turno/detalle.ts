import {
    DetalleRespuesta,
    FilaTiempo,
    MotivoFin,
    NodoDetalle,
    PasoTiempo,
    PrecioModelo,
    RecursoHerramienta,
} from '../dto/asistente.tipos';
import type { TipoBloque } from '../modelo/cliente-modelo';
import { USO_VACIO, UsoTokens, tokensPrompt } from '../modelo/precios';

/**
 * El armado del detalle de una respuesta (docs/asistente-detalle-spec.md §7). Puro: recibe lo que juntó el medidor
 * (`traza.ts`) y devuelve los nodos. Sin Nest, sin Prisma, sin reloj. NUNCA lee contenido: lo único que entra son nombres
 * de tipo, instantes, tokens, costos y largos.
 *
 * Todos los instantes son milisegundos ENTEROS desde el inicio del turno: así los tramos de una llamada, que se calculan
 * como diferencia de instantes, suman exactamente la llamada.
 */

// ============ Lo que junta el medidor ============

export interface BloqueRegistro {
    indice: number;
    tipo: TipoBloque;
    herramienta?: string;
    inicio: number;
    /** null = nunca llegó su `content_block_stop` (se abortó o falló a mitad). */
    fin: number | null;
}

/** Lo que `llamarModelo` le pasa al medidor al terminar una llamada: números, nunca contenido. */
export interface CierreLlamada {
    uso: UsoTokens;
    /** Lo que devolvió `registrarLlamada`: el mismo número que guarda `asistente_llamada`. */
    costo: number;
    stopReason: string | null;
    abortada: boolean;
    /** La clase del error del SDK ('APIConnectionTimeoutError', 'RateLimitError'…), o null si no falló. */
    clase: string | null;
    /** El uso salió de una estimación (llamada abortada: `usoAbortado`). */
    usoEstimado: boolean;
    /** El largo en caracteres de cada bloque: del texto, o del `JSON.stringify(input)` en un `tool_use`. */
    largos: { indice: number; tipo: TipoBloque; caracteres: number }[];
}

export interface RegistroLlamada {
    orden: number;
    numero: number;
    desde: number;
    tStream: number | null;
    tConexion: number | null;
    tPrimerEvento: number | null;
    bloques: BloqueRegistro[];
    hasta: number | null;
    cierre: CierreLlamada | null;
    /** `TOPE_MENSUAL` | `TOPE_FUNCION` | `TOPE_TURNO` si el control de topes cortó antes de llamar. */
    tope: string | null;
}

export interface RegistroParte {
    tipo: string;
    desde: number;
    hasta: number | null;
}

export interface RegistroHerramienta {
    orden: number;
    nombre: string;
    recurso?: RecursoHerramienta;
    desde: number;
    hasta: number | null;
    cierre: { esError: boolean; caracteres: number } | null;
    descripcion?: string;
    estado?: 'ok' | 'aviso' | 'error';
    partes: RegistroParte[];
}

export interface RegistroTurno {
    funcion: string;
    modelo: string;
    precio: PrecioModelo | null;
    /** El instante en que se arma: lo que sigue abierto se cierra acá, con `cortado`. */
    ahora: number;
    estado: DetalleRespuesta['estado'];
    motivo: MotivoFin | null;
    primerTextoMs: number | null;
    incompleto: boolean;
    /** Las partes del servicio: `topes`, `historial`, `contexto` y `guardar`. */
    partes: RegistroParte[];
    llamadas: RegistroLlamada[];
    herramientas: RegistroHerramienta[];
}

// ============ Utilidades ============

const r6 = (n: number): number => {
    const v = Number(n.toFixed(6));
    return v === 0 ? 0 : v;
};

/** Por debajo de esto, un hueco entre pasos no se nombra (§7.6). */
export const HUECO_MINIMO_MS = 100;
/** Con menos razonamiento que esto en el tiempo, se lo toma como «sin tiempo propio» (§7.3.5). */
const RAZONAMIENTO_MIN_TOKENS = 50;
const RAZONAMIENTO_MIN_MS = 50;

/** Reparte `total` (entero) según `pesos`, con enteros que suman exactamente `total` (mayor resto). */
function repartir(total: number, pesos: number[]): number[] {
    const suma = pesos.reduce((a, b) => a + b, 0);
    const base = suma > 0 ? pesos.map((p) => (total * p) / suma) : pesos.map(() => total / pesos.length);
    const piso = base.map(Math.floor);
    let resto = total - piso.reduce((a, b) => a + b, 0);
    const orden = base.map((b, i) => ({ i, f: b - Math.floor(b) })).sort((a, b) => b.f - a.f || a.i - b.i);
    for (const { i } of orden) {
        if (resto <= 0) break;
        piso[i]++;
        resto--;
    }
    return piso;
}

/** La tarifa de salida que aplicó `calcularCosto` (la «larga» si el prompt pasa el umbral). */
function tarifaSalida(precio: PrecioModelo, uso: UsoTokens): number {
    const larga = !!precio.umbralLargo && !!precio.largo && tokensPrompt(uso) > precio.umbralLargo;
    return larga ? precio.largo!.salida : precio.salida;
}

// ============ Una llamada ============

interface Tramo {
    tipo: 'razonamiento' | 'respuesta' | 'pedido';
    nombre?: string;
    inicio: number;
    caracteres: number;
    cortado: boolean;
    fin: number;
}

function agruparTramos(r: RegistroLlamada, desde: number, hasta: number): Tramo[] {
    const tramos: Tramo[] = [];
    const bloques = [...r.bloques].sort((a, b) => a.inicio - b.inicio || a.indice - b.indice);
    for (const b of bloques) {
        const largo = r.cierre?.largos.find((l) => l.indice === b.indice)?.caracteres ?? 0;
        const cortado = b.fin === null;
        const inicio = Math.min(hasta, Math.max(desde, b.inicio));
        const ultimo = tramos[tramos.length - 1];
        const clase = b.tipo === 'thinking' || b.tipo === 'redacted_thinking' ? 'razonamiento' : b.tipo === 'text' ? 'respuesta' : b.tipo === 'tool_use' ? 'pedido' : null;
        if (clase === null || (clase !== 'pedido' && ultimo?.tipo === clase)) {
            // `otro` y los bloques seguidos del mismo tipo se suman al tramo anterior.
            if (ultimo) {
                ultimo.caracteres += largo;
                ultimo.cortado = ultimo.cortado || cortado;
            }
            continue;
        }
        tramos.push({ tipo: clase, nombre: clase === 'pedido' ? (b.herramienta ?? 'otra') : undefined, inicio, caracteres: largo, cortado, fin: inicio });
    }
    // Contiguos: cada tramo va hasta el inicio del siguiente; el último, hasta el fin de la llamada.
    for (let i = 0; i < tramos.length; i++) {
        if (i > 0) tramos[i].inicio = Math.max(tramos[i].inicio, tramos[i - 1].inicio);
        tramos[i].fin = hasta;
    }
    for (let i = 0; i < tramos.length - 1; i++) tramos[i].fin = tramos[i + 1].inicio;
    return tramos;
}

/**
 * El nodo de una llamada con sus tramos (§7.3). Los hijos son contiguos y suman exactamente la llamada; los costos de
 * los hijos suman el de la llamada (±1e-6).
 */
export function nodosDeLlamada(r: RegistroLlamada, precio: PrecioModelo | null): NodoDetalle {
    const desde = r.desde;
    if (r.tope) {
        return { tipo: 'llamada', numero: r.numero, desdeMs: desde, ms: Math.max(0, (r.hasta ?? desde) - desde), fin: r.tope.toLowerCase() };
    }
    const hasta = Math.max(desde, r.hasta ?? desde);
    const cierre = r.cierre;
    const uso = cierre?.uso ?? USO_VACIO;
    const conCosto = cierre !== null && precio !== null;

    let fin: string;
    let error: string | undefined;
    if (!cierre || cierre.abortada) fin = 'abortada';
    else if (cierre.clase) {
        fin = cierre.clase === 'APIConnectionTimeoutError' ? 'timeout' : 'error';
        error = cierre.clase;
    } else fin = cierre.stopReason ?? 'error';

    const llamada: NodoDetalle = {
        tipo: 'llamada',
        numero: r.numero,
        desdeMs: desde,
        ms: hasta - desde,
        fin,
        ...(error ? { error } : {}),
        uso: {
            entrada: uso.entrada,
            cacheLectura: uso.cacheLectura,
            cacheEscritura: uso.cacheEscritura5m + uso.cacheEscritura1h,
            salida: uso.salida,
            razonamiento: uso.thinking,
        },
        ...(cierre ? { costoUsd: cierre.costo } : {}),
        ...(cierre?.usoEstimado ? { estimado: true } : {}),
        ...(!cierre ? { cortado: true } : {}),
    };

    const esperaBase = (fin: number, extra: Partial<NodoDetalle> = {}): NodoDetalle => ({
        tipo: 'espera',
        desdeMs: desde,
        ms: fin - desde,
        tokens: tokensPrompt(uso),
        msConexion: r.tConexion !== null ? r.tConexion - desde : null,
        msPrimerEvento: r.tPrimerEvento !== null ? r.tPrimerEvento - desde : null,
        msTopes: r.tStream !== null ? Math.max(0, r.tStream - desde) : 0,
        ...extra,
    });

    // Sin ningún evento de bloque pero con salida: el stream no informó su desglose (un doble, o falló el medidor).
    if (r.bloques.length === 0 && uso.salida > 0) {
        llamada.sinDesglose = true;
        llamada.hijos = [esperaBase(hasta, conCosto ? { costoUsd: cierre!.costo } : {})];
        return llamada;
    }

    let tramos = agruparTramos(r, desde, hasta);

    // La regla de fusión (§7.3.5): el razonamiento llegó sin tiempo propio.
    const razon = tramos.filter((t) => t.tipo === 'razonamiento');
    const msRazon = razon.reduce((a, t) => a + (t.fin - t.inicio), 0);
    const fusion = uso.thinking >= RAZONAMIENTO_MIN_TOKENS && msRazon < RAZONAMIENTO_MIN_MS;
    if (fusion) {
        tramos = tramos.filter((t) => t.tipo !== 'razonamiento');
        for (let i = 0; i < tramos.length - 1; i++) tramos[i].fin = tramos[i + 1].inicio;
        if (tramos.length > 0) tramos[tramos.length - 1].fin = hasta;
    }
    const finEspera = tramos.length > 0 ? tramos[0].inicio : hasta;

    // Tokens (§7.3.3).
    const estimadoUso = cierre?.usoEstimado === true;
    const tokensRazon = new Map<Tramo, { n: number; estimado: boolean }>();
    const razonRestantes = tramos.filter((t) => t.tipo === 'razonamiento');
    if (razonRestantes.length === 1) tokensRazon.set(razonRestantes[0], { n: uso.thinking, estimado: false });
    else if (razonRestantes.length > 1) {
        const partes = repartir(uso.thinking, razonRestantes.map((t) => t.fin - t.inicio));
        razonRestantes.forEach((t, i) => tokensRazon.set(t, { n: partes[i], estimado: uso.thinking > 0 }));
    }
    const salidaVisible = Math.max(0, uso.salida - uso.thinking);
    const tokensSalida = new Map<Tramo, { n: number; estimado: boolean }>();
    const salida = tramos.filter((t) => t.tipo !== 'razonamiento');
    if (salida.length === 1) tokensSalida.set(salida[0], { n: salidaVisible, estimado: false });
    else if (salida.length > 1) {
        const suman = salida.reduce((a, t) => a + t.caracteres, 0);
        const partes = repartir(salidaVisible, suman > 0 ? salida.map((t) => t.caracteres) : salida.map(() => 1));
        salida.forEach((t, i) => tokensSalida.set(t, { n: partes[i], estimado: salidaVisible > 0 }));
    }

    // Costos (§7.3.4): la salida de cada tramo a la tarifa que aplicó; la entrada queda en la espera.
    const sal = conCosto ? tarifaSalida(precio!, uso) : 0;
    const costoDe = (tokens: number): number => r6((tokens * sal) / 1e6);

    const hijos: NodoDetalle[] = [];
    let sumaSalida = 0;
    const nodoTramo = (t: Tramo): NodoDetalle => {
        const tk = (t.tipo === 'razonamiento' ? tokensRazon.get(t) : tokensSalida.get(t)) ?? { n: 0, estimado: false };
        const estimado = tk.estimado || (estimadoUso && t.tipo !== 'razonamiento');
        const costo = conCosto ? costoDe(tk.n) : undefined;
        if (costo !== undefined) sumaSalida += costo;
        return {
            tipo: t.tipo,
            desdeMs: t.inicio,
            ms: t.fin - t.inicio,
            ...(t.nombre ? { nombre: t.nombre } : {}),
            tokens: tk.n,
            ...(costo !== undefined ? { costoUsd: costo } : {}),
            ...(estimado ? { estimado: true } : {}),
            ...(t.cortado ? { cortado: true } : {}),
        };
    };

    const nodosTramos: NodoDetalle[] = [];
    if (fusion) {
        const costo = conCosto ? costoDe(uso.thinking) : undefined;
        if (costo !== undefined) sumaSalida += costo;
        nodosTramos.push({
            tipo: 'razonamiento',
            desdeMs: finEspera,
            ms: 0,
            sinTiempoPropio: true,
            tokens: uso.thinking,
            ...(costo !== undefined ? { costoUsd: costo } : {}),
        });
    }
    for (const t of tramos) nodosTramos.push(nodoTramo(t));

    const espera = esperaBase(finEspera, {
        ...(fusion ? { incluyeRazonamiento: true } : {}),
        ...(conCosto ? { costoUsd: Math.max(0, r6(cierre!.costo - sumaSalida)) } : {}),
    });
    llamada.hijos = [espera, ...nodosTramos];
    return llamada;
}

// ============ Los huecos ============

/**
 * Agrega un nodo `otros` por cada hueco de 100 ms o más entre `desde` y `hasta` que ningún nodo cubre (los solapados
 * cuentan una sola vez). Lo que nadie mide no queda escondido (§7.6).
 */
export function completarHuecos(nodos: NodoDetalle[], desde: number, hasta: number): NodoDetalle[] {
    const intervalos = nodos.map((n) => [n.desdeMs, n.desdeMs + n.ms] as const).sort((a, b) => a[0] - b[0]);
    const huecos: NodoDetalle[] = [];
    let cursor = desde;
    for (const [a, b] of intervalos) {
        if (a - cursor >= HUECO_MINIMO_MS) huecos.push({ tipo: 'otros', desdeMs: cursor, ms: a - cursor });
        cursor = Math.max(cursor, b);
    }
    if (hasta - cursor >= HUECO_MINIMO_MS) huecos.push({ tipo: 'otros', desdeMs: cursor, ms: hasta - cursor });
    if (huecos.length === 0) return nodos;
    return [...nodos, ...huecos].sort((a, b) => a.desdeMs - b.desdeMs);
}

// ============ El turno ============

function nodoParte(p: RegistroParte, ahora: number): NodoDetalle {
    const hasta = Math.max(p.desde, p.hasta ?? ahora);
    return { tipo: p.tipo, desdeMs: p.desde, ms: hasta - p.desde, ...(p.hasta === null ? { cortado: true } : {}) };
}

function nodoHerramienta(h: RegistroHerramienta, ahora: number): NodoDetalle {
    const hasta = Math.max(h.desde, h.hasta ?? ahora);
    const abierta = h.hasta === null;
    const hijos = completarHuecos(
        h.partes.map((p) => nodoParte(p, Math.max(ahora, hasta))).sort((a, b) => a.desdeMs - b.desdeMs),
        h.desde,
        hasta,
    );
    const descripcion = h.descripcion ?? (h.cierre?.esError ? 'Le devolvió un error al modelo' : undefined);
    const estado = h.cierre?.esError ? 'error' : h.estado;
    return {
        tipo: 'herramienta',
        nombre: h.nombre,
        ...(h.recurso ? { recurso: h.recurso } : {}),
        desdeMs: h.desde,
        ms: hasta - h.desde,
        ...(descripcion ? { descripcion } : {}),
        ...(estado ? { estado } : {}),
        ...(h.cierre ? { tokensResultado: Math.ceil(h.cierre.caracteres / 3) } : {}),
        ...(abierta ? { cortado: true } : {}),
        ...(hijos.length > 0 ? { hijos } : {}),
    };
}

/**
 * El detalle de una respuesta a partir de lo que midió el turno (§7.7). Cierra con `cortado` lo que haya quedado abierto en
 * `ahora`, y calcula el total y el costo.
 */
export function armarDetalle(reg: RegistroTurno): DetalleRespuesta {
    const { ahora } = reg;
    const parte = (tipo: string) => reg.partes.filter((p) => p.tipo === tipo).pop();
    const guardar = parte('guardar');
    const totalMs = Math.max(0, guardar ? Math.max(guardar.desde, guardar.hasta ?? ahora) : ahora);

    const llamadas = reg.llamadas.map((l) => ({ l, nodo: nodosDeLlamada({ ...l, hasta: l.hasta ?? ahora }, reg.precio) }));
    const herramientas = reg.herramientas.map((h) => ({ orden: h.orden, nodo: nodoHerramienta(h, ahora) }));

    const primera = [...reg.llamadas].sort((a, b) => a.desde - b.desde)[0];
    const finPreparacion = Math.min(totalMs, primera ? primera.desde : (guardar?.desde ?? totalMs));
    const hijosPrep = (['topes', 'historial', 'contexto'] as const)
        .map(parte)
        .filter((p): p is RegistroParte => !!p)
        .map((p) => nodoParte(p, ahora));
    const preparacion: NodoDetalle = {
        tipo: 'preparacion',
        desdeMs: 0,
        ms: finPreparacion,
        hijos: completarHuecos(hijosPrep, 0, finPreparacion),
    };

    const cuerpo = [
        ...llamadas.map((x) => ({ orden: x.l.orden, nodo: x.nodo })),
        ...herramientas,
    ]
        .sort((a, b) => a.nodo.desdeMs - b.nodo.desdeMs || a.orden - b.orden)
        .map((x) => x.nodo);
    const nodos = completarHuecos([preparacion, ...cuerpo, ...(guardar ? [nodoParte(guardar, ahora)] : [])], 0, totalMs);

    const hechas = llamadas.filter((x) => !x.l.tope);
    return {
        version: 1,
        funcion: reg.funcion,
        modelo: reg.modelo,
        estado: reg.estado,
        motivo: reg.motivo,
        totalMs,
        primerTextoMs: reg.primerTextoMs,
        costoUsd: r6(hechas.reduce((a, x) => a + (x.nodo.costoUsd ?? 0), 0)),
        llamadas: hechas.length,
        nodos,
        parcial: false,
        incompleto: reg.incompleto,
        recortado: false,
        navegador: null,
    };
}

// ============ Tamaño ============

export const MAX_NODOS_DETALLE = 200;
export const MAX_BYTES_DETALLE = 48 * 1024;

function contarNodos(ns: NodoDetalle[]): number {
    return ns.reduce((a, n) => a + 1 + contarNodos(n.hijos ?? []), 0);
}

/** Los primeros `cupo` nodos en orden (profundidad primero). Devuelve lo que quedó afuera. */
function podar(ns: NodoDetalle[], cupo: { n: number }, fuera: NodoDetalle[]): NodoDetalle[] {
    const out: NodoDetalle[] = [];
    for (const n of ns) {
        if (cupo.n <= 0) {
            fuera.push(n);
            continue;
        }
        cupo.n--;
        const { hijos, ...resto } = n;
        if (hijos) {
            const sub = podar(hijos, cupo, fuera);
            out.push(sub.length > 0 ? { ...resto, hijos: sub } : { ...resto });
        } else out.push({ ...resto });
    }
    return out;
}

/**
 * El tope del detalle (§4.4): 200 nodos (contado el nodo `otros` que resume el resto) o 48 KB de JSON. Si se pasa, quedan
 * los primeros nodos en orden, lo demás se cuenta en un nodo `otros` y va `recortado: true`.
 */
export function recortarDetalle(d: DetalleRespuesta, maxNodos = MAX_NODOS_DETALLE, maxBytes = MAX_BYTES_DETALLE): DetalleRespuesta {
    let tope = maxNodos;
    const cabe = (x: DetalleRespuesta) => contarNodos(x.nodos) <= maxNodos && JSON.stringify(x).length <= maxBytes;
    if (cabe(d)) return d;
    for (let intento = 0; intento < 12; intento++) {
        const fuera: NodoDetalle[] = [];
        const cupo = { n: Math.max(1, tope - 1) };
        const nodos = podar(d.nodos, cupo, fuera);
        const sinMostrar = fuera.reduce((a, n) => a + 1 + contarNodos(n.hijos ?? []), 0);
        const desde = fuera.length ? Math.min(...fuera.map((n) => n.desdeMs)) : 0;
        const hasta = fuera.length ? Math.max(...fuera.map((n) => n.desdeMs + n.ms)) : 0;
        const r: DetalleRespuesta = {
            ...d,
            nodos: [...nodos, { tipo: 'otros', desdeMs: desde, ms: Math.max(0, hasta - desde), descripcion: `${sinMostrar} pasos más sin mostrar` }],
            recortado: true,
        };
        if (cabe(r) || tope <= 2) return r;
        tope = Math.floor(tope / 2);
    }
    return d;
}

// ============ Respuestas sin traza (§7.9) ============

/** Una fila de `asistente_llamada`, con los campos que usa la reconstrucción. */
export interface FilaLlamadaGuardada {
    iteracion: number;
    ms: number;
    createdAt: Date;
    costoUsd: number | { toString(): string };
    stopReason: string | null;
    error: string | null;
    tokensEntrada: number;
    tokensSalida: number;
    tokensThinking: number;
    cacheLectura: number;
    cacheEscritura5m: number;
    cacheEscritura1h: number;
}

/**
 * El detalle de una respuesta de antes de que se midieran los pasos: una llamada por fila de `asistente_llamada`, sin
 * tramos. La posición sale de `createdAt` (el fin de la llamada). Sin llamadas: null.
 */
export function detalleDesdeLlamadas(
    filas: FilaLlamadaGuardada[],
    ctx: { funcion: string; modelo: string; precio: PrecioModelo | null; mensajeMs: number | null; estado: DetalleRespuesta['estado']; textoVacio: boolean },
): DetalleRespuesta | null {
    if (filas.length === 0) return null;
    const primero = filas[0];
    const t0 = primero.createdAt.getTime() - primero.ms;
    const nodos: NodoDetalle[] = [];
    let fin = 0;
    let costoTotal = 0;
    for (const f of filas) {
        const desde = Math.max(0, f.createdAt.getTime() - f.ms - t0);
        const costo = Number(f.costoUsd);
        costoTotal += costo;
        const uso: UsoTokens = {
            entrada: f.tokensEntrada,
            salida: f.tokensSalida,
            thinking: f.tokensThinking,
            cacheLectura: f.cacheLectura,
            cacheEscritura5m: f.cacheEscritura5m,
            cacheEscritura1h: f.cacheEscritura1h,
        };
        const abortada = f.error === 'abortado';
        const llamada: NodoDetalle = {
            tipo: 'llamada',
            numero: f.iteracion + 1,
            desdeMs: desde,
            ms: f.ms,
            fin: abortada ? 'abortada' : f.error ? (f.error === 'APIConnectionTimeoutError' ? 'timeout' : 'error') : (f.stopReason ?? 'error'),
            ...(f.error && !abortada ? { error: f.error } : {}),
            uso: {
                entrada: uso.entrada,
                cacheLectura: uso.cacheLectura,
                cacheEscritura: uso.cacheEscritura5m + uso.cacheEscritura1h,
                salida: uso.salida,
                razonamiento: uso.thinking,
            },
            costoUsd: costo,
        };
        if (f.tokensThinking > 0) {
            llamada.hijos = [
                {
                    tipo: 'razonamiento',
                    desdeMs: desde,
                    ms: 0,
                    sinTiempoPropio: true,
                    tokens: f.tokensThinking,
                    ...(ctx.precio ? { costoUsd: r6((f.tokensThinking * tarifaSalida(ctx.precio, uso)) / 1e6) } : {}),
                },
            ];
        }
        nodos.push(llamada);
        fin = Math.max(fin, desde + f.ms);
    }
    // Entre llamadas hubo herramientas u otra cosa que no se midió.
    const conHuecos = completarHuecos(nodos, nodos[0].desdeMs, fin).map((n) =>
        n.tipo === 'otros' ? ({ ...n, tipo: 'sin_detalle' } as NodoDetalle) : n,
    );
    return {
        version: 1,
        funcion: ctx.funcion,
        modelo: ctx.modelo,
        estado: ctx.estado,
        motivo: ctx.estado === 'error' && ctx.textoVacio ? 'sin_terminar' : null,
        totalMs: Math.max(ctx.mensajeMs ?? 0, fin),
        primerTextoMs: null,
        costoUsd: r6(costoTotal),
        llamadas: filas.length,
        nodos: conHuecos,
        parcial: true,
        incompleto: false,
        recortado: false,
        navegador: null,
    };
}

// ============ Consumo: muestras, percentiles y tabla (§7.11) ============

export interface MuestraTiempo {
    funcion: string;
    paso: PasoTiempo;
    herramienta: string | null;
    ms: number;
}

/**
 * Las llamadas que NO terminaron bien: detenidas, cortadas por un tope antes de llamar, vencidas por timeout o falladas. Todo
 * otro `fin` es un `stop_reason` del modelo (end_turn, tool_use, max_tokens, refusal…): la llamada terminó y su tiempo es real.
 */
const FIN_EXCLUIDO = new Set(['abortada', 'timeout', 'error', 'tope_turno', 'tope_mensual', 'tope_funcion']);

/** Qué cuenta cada respuesta para la tabla de tiempos. Las detenidas y las cortadas no bajan la mediana. */
export function muestrasDeDetalle(d: DetalleRespuesta): MuestraTiempo[] {
    const out: MuestraTiempo[] = [];
    const agregar = (paso: PasoTiempo, ms: number, herramienta: string | null = null) => out.push({ funcion: d.funcion, paso, herramienta, ms });

    // Una respuesta que no terminó bien no suma en ningún «Total», ni en el servidor ni en el navegador.
    if (d.estado === 'ok') agregar('total', d.totalMs);
    if (d.estado === 'ok' && d.navegador) {
        agregar('navegador_total', d.navegador.totalMs);
        if (d.navegador.primerTextoMs !== null) agregar('navegador_primer_texto', d.navegador.primerTextoMs);
    }
    for (const n of d.nodos) {
        if (n.cortado) continue;
        if (n.tipo === 'preparacion') agregar('preparacion', n.ms);
        else if (n.tipo === 'guardar') agregar('guardar', n.ms);
        else if (n.tipo === 'herramienta') agregar('herramienta', n.ms, n.nombre ?? 'otra');
        else if (n.tipo === 'llamada') {
            if (FIN_EXCLUIDO.has(n.fin ?? '')) continue;
            agregar('llamada', n.ms);
            for (const h of n.hijos ?? []) {
                if (h.cortado || h.sinTiempoPropio) continue;
                if (h.tipo === 'espera' || h.tipo === 'razonamiento' || h.tipo === 'respuesta' || h.tipo === 'pedido') agregar(h.tipo, h.ms);
            }
        }
    }
    return out;
}

/** Por rango más cercano: `ordenados[ceil(p × n) − 1]`. `ordenados` va de menor a mayor. */
export function percentil(ordenados: number[], p: number): number {
    if (ordenados.length === 0) return 0;
    const i = Math.min(ordenados.length - 1, Math.max(0, Math.ceil(p * ordenados.length - 1e-9) - 1));
    return ordenados[i];
}

const ORDEN_PASOS: PasoTiempo[] = [
    'total', 'navegador_total', 'navegador_primer_texto', 'preparacion', 'llamada', 'espera', 'razonamiento', 'respuesta', 'pedido',
];

/**
 * La tabla de tiempos por función: mediana y p95 de cada paso. El orden de las filas es fijo (total, navegador,
 * preparación, llamada y sus tramos, las herramientas por nombre y guardar); las filas sin muestras no van.
 */
export function tablaDeTiempos(muestras: MuestraTiempo[]): { funcion: string; filas: FilaTiempo[] }[] {
    const porFuncion = new Map<string, Map<string, { paso: PasoTiempo; herramienta: string | null; valores: number[] }>>();
    for (const m of muestras) {
        const filas = porFuncion.get(m.funcion) ?? new Map();
        porFuncion.set(m.funcion, filas);
        const clave = `${m.paso}|${m.herramienta ?? ''}`;
        const fila = filas.get(clave) ?? { paso: m.paso, herramienta: m.herramienta, valores: [] };
        fila.valores.push(m.ms);
        filas.set(clave, fila);
    }
    const posicion = (paso: PasoTiempo, herramienta: string | null): [number, string] => {
        const i = ORDEN_PASOS.indexOf(paso);
        if (i >= 0) return [i, ''];
        return paso === 'herramienta' ? [ORDEN_PASOS.length, herramienta ?? ''] : [ORDEN_PASOS.length + 1, ''];
    };
    return [...porFuncion.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([funcion, filas]) => ({
            funcion,
            filas: [...filas.values()]
                .sort((a, b) => {
                    const [pa, na] = posicion(a.paso, a.herramienta);
                    const [pb, nb] = posicion(b.paso, b.herramienta);
                    return pa - pb || na.localeCompare(nb);
                })
                .map((f) => {
                    const v = [...f.valores].sort((a, b) => a - b);
                    return { paso: f.paso, herramienta: f.herramienta, muestras: v.length, medianaMs: percentil(v, 0.5), p95Ms: percentil(v, 0.95) };
                }),
        }));
}

/** El desglose para el log de cierre: solo tiempos, ninguna descripción ni nombre de página. */
export function resumenParaLog(d: DetalleRespuesta): string {
    const suma = (tipo: string) => d.nodos.filter((n) => n.tipo === tipo).reduce((a, n) => a + n.ms, 0);
    return `(prep ${suma('preparacion')} · modelo ${suma('llamada')} · herramientas ${suma('herramienta')} · guardar ${suma('guardar')})`;
}
