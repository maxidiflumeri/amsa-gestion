// utils/multiclaves-parser.ts
//
// Parser de la categoría MULTICLAVES (claves de pago de Telecom/Personal). Función pura, sin
// dependencias de Nest ni de Prisma: recibe los archivos ya leídos como buffers y devuelve los
// trámites agrupados, listos para que el processor los escriba.
//
// El layout (nombres de columna, posiciones, formato de la clave y del código de barras) vive en
// `plantillas/telecom-multiclaves.ts`, NO en la plantilla de la base (D2 del spec): un archivo con
// el encabezado cambiado es un archivo distinto, no una plantilla mal configurada.
//
// Ver `docs/multiclaves-spec.md` §1 y §5.4.

import {
    centavosDeTexto,
    descomponerClave,
    descomponerCodigoBarras,
    dvModulo10_31,
} from '../../multiclaves/utils/clave-pago';
import { MulticlavesConfig } from '../mapping-types';
import {
    MULTICLAVES_ENCABEZADO,
    MULTICLAVES_MAX_COLUMNAS,
    MULTICLAVES_MIN_COLUMNAS,
} from '../plantillas/telecom-multiclaves';

/** El archivo no tiene la forma de un archivo de multiclaves: encabezado con otros nombres. */
export class MulticlavesArchivoInvalidoError extends Error {
    constructor(readonly archivo: string) {
        super(
            `El archivo "${archivo}" no tiene el encabezado de multiclaves (se esperaba ` +
            `"${MULTICLAVES_ENCABEZADO.join('|')}"); ¿es el archivo correcto?`,
        );
        this.name = 'MulticlavesArchivoInvalidoError';
    }
}

// ── Motivos y avisos ─────────────────────────────────────────────────────────

/** Motivo de rechazo de una LÍNEA. El primero que falla en este orden es el motivo reportado. */
export type MotivoRechazoLinea =
    | 'COLUMNAS'
    | 'TRAMITE_INVALIDO'
    | 'CONVENIO_INVALIDO'
    | 'IMPORTE_INVALIDO'
    | 'IMPORTE_NO_POSITIVO'
    | 'SALDO_INVALIDO'
    | 'FECHA_INVALIDA'
    | 'GESTOR_AJENO'
    | 'CLAVE_FORMATO'
    | 'CLAVE_DV'
    | 'CLAVE_NO_COINCIDE'
    | 'BARRA_FORMATO'
    | 'BARRA_DV'
    | 'BARRA_NO_COINCIDE'
    | 'CONVENIO_REPETIDO_EN_ARCHIVO';

/** Motivo de rechazo de un TRÁMITE (grupo de líneas). */
export type MotivoRechazoTramite = 'TRAMITE_INCOMPLETO' | 'IMPORTES_IGUALES' | 'CLAVE_UNICA_NO_ES_TOTAL';

export type MotivoRechazo = MotivoRechazoLinea | MotivoRechazoTramite;

/** Avisos que no rechazan la carga, pero conviene mostrar antes de confirmar. */
export type CodigoAviso =
    | 'SIN_ENCABEZADO'
    | 'SALDO_DISTINTO_ENTRE_FILAS'
    | 'TOTAL_DISTINTO_DE_SALDO'
    | 'QUITA_NO_ES_MITAD'
    | 'VTO_DISTINTO_ENTRE_CLAVES'
    | 'YA_VENCIDA_AL_CARGAR'
    | 'MARCA_DESCONOCIDA'
    | 'TRAMITE_LARGO_INESPERADO'
    /**
     * El trámite trajo una única línea válida (sin su par de quita). Se acepta igual, clasificada
     * siempre como TOTAL (decisión de Ana Maya del 2026-09-14, fase 1.1): Telecom a veces manda un
     * trámite sin la clave de quita. Ver `docs/multiclaves-spec.md` §20.
     */
    | 'SOLO_TOTAL';

export interface AvisoMulticlaves {
    codigo: CodigoAviso;
    cantidad: number;
    /** Primeros 20 trámites (o nombres de archivo, para SIN_ENCABEZADO) donde se detectó el aviso. */
    ejemplos: string[];
}

/** Una clave ya parseada y clasificada, lista para que el processor la escriba. */
export interface ClaveParseada {
    tipo: 'TOTAL' | 'QUITA';
    nroConvenio: string;
    importeCentavos: number;
    clavePago: string;
    codigoBarras: string;
    /** `YYYY-MM-DD`. */
    fechaVencimiento: string;
    codigoGestor: string;
    marca: string | null;
    /** Línea del archivo (1-based) de donde salió esta clave. */
    linea: number;
}

/** Un trámite del archivo, con sus dos claves si pasó todas las validaciones, o su rechazo. */
export interface TramiteClaves {
    nroTramite: string;
    /** Líneas del archivo (1-based) que componen este trámite. */
    lineas: number[];
    rechazo?: { motivo: MotivoRechazoTramite; detalle: string };
    /**
     * Texto crudo de cada línea que compuso el trámite, en el mismo orden que `lineas`. Solo se
     * completa cuando el trámite se rechaza: es lo que termina en `importerror.rawRow` para poder
     * reclamarle al cedente con la línea exacta, no solo el número.
     */
    lineasCrudas?: string[];
    /** El de la fila TOTAL del par, o el de la única línea si el trámite es SOLO_TOTAL (spec §1.5). Ausente si el trámite se rechazó. */
    saldoTramiteCentavos?: number;
    /**
     * 2 (TOTAL + QUITA) si no hay rechazo, o 1 si el trámite trajo una única línea válida
     * (aviso `SOLO_TOTAL`): en ese caso la única clave se clasifica siempre como TOTAL.
     */
    claves?: ClaveParseada[];
}

export interface ResumenMulticlaves {
    lineas: number;
    /** Claves de trámites ACEPTADOS únicamente (1 o 2 por trámite válido — 1 si es SOLO_TOTAL, fase 1.1). No cuenta las de trámites rechazados. */
    claves: number;
    /**
     * Líneas que pasaron la validación de línea (dígitos verificadores, formato) pero cuyo trámite
     * se rechazó igual — por ejemplo, dos claves individualmente válidas con el mismo importe
     * (`IMPORTES_IGUALES`). Se separan de `claves` para que ese contador no infle con claves que no
     * se van a cargar.
     */
    clavesRechazadas: number;
    tramites: number;
    rechazados: number;
    porMotivo: Record<string, number>;
    porAviso: Record<string, number>;
}

export interface ResultadoParseoMulticlaves {
    tramites: TramiteClaves[];
    avisos: AvisoMulticlaves[];
    resumen: ResumenMulticlaves;
}

export interface ArchivoMulticlaves {
    buffer: Buffer;
    nombre: string;
}

/**
 * Motivo "principal" de un trámite rechazado, para mostrar en la vista previa: si el rechazo es
 * `TRAMITE_INCOMPLETO` por una única línea caída, cita el motivo de ESA línea (más útil que el
 * genérico "incompleto" — es lo que arma el "8 por CLAVE_DV, 4 por TRAMITE_INCOMPLETO" del §5.6).
 * En cualquier otro caso (varias líneas con motivos distintos, o `IMPORTES_IGUALES`), se queda con
 * el motivo del trámite tal cual.
 */
export function motivoPrincipalRechazo(t: TramiteClaves): string {
    if (!t.rechazo) return '';
    if (t.rechazo.motivo !== 'TRAMITE_INCOMPLETO') return t.rechazo.motivo;
    const motivosCitados = [...new Set([...t.rechazo.detalle.matchAll(/\[(\w+)\]/g)].map((m) => m[1]))];
    return motivosCitados.length === 1 ? motivosCitados[0] : t.rechazo.motivo;
}

// ── Helpers internos ─────────────────────────────────────────────────────────

const MAX_EJEMPLOS = 20;

class AcumuladorAvisos {
    private readonly datos = new Map<CodigoAviso, { cantidad: number; ejemplos: string[] }>();

    marcar(codigo: CodigoAviso, ejemplo: string): void {
        const actual = this.datos.get(codigo) ?? { cantidad: 0, ejemplos: [] };
        actual.cantidad++;
        if (actual.ejemplos.length < MAX_EJEMPLOS) actual.ejemplos.push(ejemplo);
        this.datos.set(codigo, actual);
    }

    lista(): AvisoMulticlaves[] {
        return [...this.datos.entries()]
            .filter(([, v]) => v.cantidad > 0)
            .map(([codigo, v]) => ({ codigo, cantidad: v.cantidad, ejemplos: v.ejemplos }));
    }

    porCodigo(): Record<string, number> {
        const out: Record<string, number> = {};
        for (const [codigo, v] of this.datos) out[codigo] = v.cantidad;
        return out;
    }
}

/**
 * Día calendario en Argentina (UTC-3, sin horario de verano desde 2009) de un instante. Se usa
 * para `YA_VENCIDA_AL_CARGAR`: comparar contra el día UTC corría el aviso hasta 3 horas antes de
 * tiempo (con `hoy` después de las 21:00 en Argentina, el día UTC ya cambió mientras acá sigue
 * siendo el día anterior).
 */
function diaArgentina(fecha: Date): string {
    const partes = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Argentina/Buenos_Aires',
        year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(fecha);
    const get = (t: string) => partes.find((p) => p.type === t)?.value ?? '00';
    return `${get('year')}-${get('month')}-${get('day')}`;
}

/** `YYYYMMDD` → `YYYY-MM-DD`, validando que sea una fecha de calendario real. `null` si no. */
function parseFechaYYYYMMDD(v: string): string | null {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec((v ?? '').trim());
    if (!m) return null;
    const [, y, mo, d] = m;
    const mes = Number(mo);
    const dia = Number(d);
    if (mes < 1 || mes > 12) return null;
    // Día 0 del mes siguiente = último día del mes actual (UTC, sin líos de zona horaria).
    const ultimoDiaDelMes = new Date(Date.UTC(Number(y), mes, 0)).getUTCDate();
    if (dia < 1 || dia > ultimoDiaDelMes) return null;
    return `${y}-${mo}-${d}`;
}

interface LineaOk {
    ok: true;
    linea: number;
    archivo: string;
    /** Texto crudo de la línea, tal cual vino en el archivo (para citarlo si el trámite se rechaza). */
    raw: string;
    nroTramite: string;
    data: {
        nroConvenio: string;
        saldoTramiteCentavos: number;
        importeCentavos: number;
        clavePago: string;
        codigoBarras: string;
        fechaVencimiento: string;
        codigoGestor: string;
        marca: string | null;
    };
}

interface LineaError {
    ok: false;
    linea: number;
    archivo: string;
    raw: string;
    /**
     * `null` solo cuando la propia columna 0 no es un número legible — ahí sí la línea queda como
     * grupo propio (`__linea_N`), porque no hay con qué trámite asociarla. Cualquier otro motivo de
     * rechazo (columnas de más/menos, DV roto, lo que sea) SIGUE llevando el trámite si `campos[0]`
     * se pudo leer, aunque el resto de la línea esté destruido — si no, esa línea "desaparece" de su
     * trámite real y el par queda huérfano (hallazgo del auditor sobre la fase 1.1, §20: una TOTAL
     * truncada dejaba a su QUITA entrar sola como si fuera SOLO_TOTAL).
     */
    nroTramite: string | null;
    motivo: MotivoRechazoLinea;
    detalle: string;
}

type ResultadoLinea = LineaOk | LineaError;

/** Valida y parsea una línea de datos, en el orden de motivos de la spec §5.4. */
function validarLinea(
    raw: string,
    linea: number,
    archivo: string,
    cfg: MulticlavesConfig,
    convenioVisto: Set<string>,
): ResultadoLinea {
    const campos = raw.split('|');
    // El trámite (columna 0) se intenta leer ANTES que cualquier otra validación, incluida la de
    // cantidad de columnas: una línea rota más adelante (de menos, de más, DV corrupto) igual tiene
    // que poder asociarse a su trámite real si esa primera columna es legible. Si no, el trámite
    // queda con una línea de menos y la línea que le sobrevive (su par) puede colarse como si fuera
    // un trámite SOLO_TOTAL legítimo — es el hallazgo bloqueante del auditor sobre la fase 1.1.
    const nroTramiteCandidato = (campos[0] ?? '').trim();
    const tramiteLegible = /^\d{1,20}$/.test(nroTramiteCandidato) ? nroTramiteCandidato : null;
    const err = (motivo: MotivoRechazoLinea, detalle: string, nroTramite: string | null = tramiteLegible): LineaError =>
        ({ ok: false, linea, archivo, raw, nroTramite, motivo, detalle });

    if (campos.length < MULTICLAVES_MIN_COLUMNAS || campos.length > MULTICLAVES_MAX_COLUMNAS) {
        return err('COLUMNAS', `la línea trae ${campos.length} columna(s); se esperan 9 o 10`);
    }

    const nroTramite = nroTramiteCandidato;
    if (!tramiteLegible) {
        return err('TRAMITE_INVALIDO', `"${campos[0]}" no es un número de trámite válido`);
    }

    const nroConvenio = (campos[1] ?? '').trim();
    if (!/^\d{8}$/.test(nroConvenio)) {
        return err('CONVENIO_INVALIDO', `"${campos[1]}" no es un número de convenio válido (8 dígitos)`, nroTramite);
    }

    const importeCentavos = centavosDeTexto(campos[3] ?? '');
    if (importeCentavos == null) {
        return err('IMPORTE_INVALIDO', `"${campos[3]}" no es un importe válido`, nroTramite);
    }
    if (importeCentavos <= 0) {
        return err('IMPORTE_NO_POSITIVO', `el importe "${campos[3]}" no es positivo`, nroTramite);
    }

    const saldoTramiteCentavos = centavosDeTexto(campos[2] ?? '');
    if (saldoTramiteCentavos == null) {
        return err('SALDO_INVALIDO', `"${campos[2]}" no es un saldo de trámite válido`, nroTramite);
    }
    if (saldoTramiteCentavos <= 0) {
        return err('SALDO_INVALIDO', `el saldo del trámite "${campos[2]}" no es positivo`, nroTramite);
    }

    const fechaVencimiento = parseFechaYYYYMMDD(campos[5] ?? '');
    if (!fechaVencimiento) {
        return err('FECHA_INVALIDA', `"${campos[5]}" no es una fecha válida (YYYYMMDD)`, nroTramite);
    }

    const codigoGestor = (campos[7] ?? '').trim();
    if (!cfg.codigosGestor.includes(codigoGestor)) {
        return err('GESTOR_AJENO', `código de gestor "${codigoGestor}" no es uno de los propios (${cfg.codigosGestor.join(', ')})`, nroTramite);
    }

    const clavePago = (campos[4] ?? '').trim();
    const decClave = descomponerClave(clavePago);
    if (!decClave) {
        return err('CLAVE_FORMATO', `"${clavePago}" no tiene el formato de clave de pago (22 dígitos, empieza con 00)`, nroTramite);
    }
    const dvClaveCalculado = dvModulo10_31(clavePago.slice(0, 21));
    if (dvClaveCalculado !== decClave.dv) {
        return err(
            'CLAVE_DV',
            `dígito verificador de la clave inválido (calculado ${dvClaveCalculado}, informado ${decClave.dv})`,
            nroTramite,
        );
    }
    if (decClave.convenio !== nroConvenio || decClave.centavos !== importeCentavos) {
        return err(
            'CLAVE_NO_COINCIDE',
            `la clave codifica convenio ${decClave.convenio}/importe ${decClave.centavos}, distinto de ` +
            `las columnas (convenio ${nroConvenio}, importe ${importeCentavos})`,
            nroTramite,
        );
    }

    const codigoBarras = (campos[6] ?? '').trim();
    const decBarra = descomponerCodigoBarras(codigoBarras);
    if (!decBarra) {
        return err('BARRA_FORMATO', `"${codigoBarras}" no tiene el formato del código de barras (50 dígitos, empieza con 498)`, nroTramite);
    }
    const dvBarraCalculado = dvModulo10_31(codigoBarras.slice(0, 49));
    if (dvBarraCalculado !== decBarra.dv) {
        return err(
            'BARRA_DV',
            `dígito verificador del código de barras inválido (calculado ${dvBarraCalculado}, informado ${decBarra.dv})`,
            nroTramite,
        );
    }
    if (
        decBarra.centavos !== importeCentavos ||
        decBarra.vto !== fechaVencimiento ||
        decBarra.convenio !== nroConvenio
    ) {
        return err(
            'BARRA_NO_COINCIDE',
            `el código de barras codifica importe ${decBarra.centavos}/vto ${decBarra.vto}/convenio ` +
            `${decBarra.convenio}, distinto de las columnas`,
            nroTramite,
        );
    }

    if (convenioVisto.has(nroConvenio)) {
        return err('CONVENIO_REPETIDO_EN_ARCHIVO', `el convenio ${nroConvenio} ya apareció antes en esta carga`, nroTramite);
    }
    convenioVisto.add(nroConvenio);

    const marca = campos.length > MULTICLAVES_MIN_COLUMNAS ? ((campos[9] ?? '').trim() || null) : null;

    return {
        ok: true,
        linea,
        archivo,
        raw,
        nroTramite,
        data: {
            nroConvenio,
            saldoTramiteCentavos,
            importeCentavos,
            clavePago,
            codigoBarras,
            fechaVencimiento,
            codigoGestor,
            marca,
        },
    };
}

/** Cita una línea para los mensajes: `archivo.txt:1234` con varios archivos, `1234` con uno solo. */
function citarLinea(e: { archivo: string; linea: number }, variosArchivos: boolean): string {
    return variosArchivos ? `${e.archivo}:${e.linea}` : String(e.linea);
}

// ── Parseo principal ──────────────────────────────────────────────────────────

/**
 * Parsea uno o más archivos de multiclaves y devuelve los trámites agrupados, listos para que el
 * processor los escriba. Función pura: no toca la base ni el disco.
 *
 * @param hoy Inyectable para poder testear el aviso `YA_VENCIDA_AL_CARGAR` con una fecha fija.
 */
export function parseMulticlaves(
    archivos: ArchivoMulticlaves[],
    cfg: MulticlavesConfig,
    hoy: Date,
): ResultadoParseoMulticlaves {
    const variosArchivos = archivos.length > 1;
    const avisos = new AcumuladorAvisos();
    const convenioVisto = new Set<string>();

    // ── Pase 1: leer y validar cada línea, en orden (el orden importa para CONVENIO_REPETIDO). ──
    const entradas: ResultadoLinea[] = [];
    let totalLineas = 0;

    const ESPERADOS = MULTICLAVES_ENCABEZADO.map((s) => s.toUpperCase());

    for (const archivo of archivos) {
        // Un BOM UTF-8 al principio del archivo, leído como latin1, aparece como los tres
        // caracteres "ï»¿" pegados al primer campo — sin sacarlo, "NRO_TRAMITE" nunca matchea y el
        // archivo se rechaza (o peor, se toma como "sin encabezado"). Se saca también el BOM propio
        // de UTF-16/UTF-8 (`﻿`) por si el buffer ya venía decodificado de otro lado.
        const textoCrudo = archivo.buffer.toString('latin1').replace(/^﻿/, '').replace(/^ï»¿/, '');
        const rawLineas = textoCrudo.split(/\r?\n/);

        let offset = 0;
        const primera = rawLineas[0] ?? '';
        const nombresLinea = primera.split('|').slice(0, MULTICLAVES_ENCABEZADO.length).map((s) => s.trim().toUpperCase());
        const coincidencias = ESPERADOS.filter((e, i) => nombresLinea[i] === e).length;
        // Se toma como "intento de encabezado" si coincide la MAYORÍA de las 9 columnas, no solo la
        // primera: un BOM que le come el primer nombre, o un cedente que renombra una sola columna,
        // no tienen que colarse como si fueran datos ni pasar en silencio como "sin encabezado".
        // 3 coincidencias ya alcanzan para tratarla como "intento de encabezado": una línea de datos
        // real (números de trámite, importes, fechas) prácticamente no puede coincidir por
        // casualidad con 3 de los 9 nombres de columna. Con el umbral más laxo (mayoría, 5+) una
        // línea rara con 3-4 coincidencias se colaba como "sin encabezado" en vez de avisar que el
        // encabezado no es el esperado.
        const UMBRAL_COINCIDENCIAS = 3;
        const pareceEncabezado = coincidencias >= UMBRAL_COINCIDENCIAS;

        if (pareceEncabezado) {
            const coincide = coincidencias === ESPERADOS.length && nombresLinea.length === ESPERADOS.length;
            if (!coincide) throw new MulticlavesArchivoInvalidoError(archivo.nombre);
            offset = 1;
        } else if (primera.trim() !== '') {
            const campos = primera.split('|');
            const pareceDatos =
                campos.length >= MULTICLAVES_MIN_COLUMNAS &&
                campos.length <= MULTICLAVES_MAX_COLUMNAS &&
                /^\d+$/.test((campos[0] ?? '').trim());
            if (pareceDatos) avisos.marcar('SIN_ENCABEZADO', archivo.nombre);
        }

        for (let i = offset; i < rawLineas.length; i++) {
            const raw = rawLineas[i];
            if (raw.trim() === '') continue;
            const linea = i + 1;
            totalLineas++;
            entradas.push(validarLinea(raw, linea, archivo.nombre, cfg, convenioVisto));
        }
    }

    // ── Pase 2: agrupar por trámite. Una línea sin trámite legible es su propio grupo. ──────────
    const grupos = new Map<string, ResultadoLinea[]>();
    let aislados = 0;
    for (const e of entradas) {
        const clave = e.nroTramite ?? `__linea_${++aislados}`;
        const lista = grupos.get(clave) ?? [];
        lista.push(e);
        grupos.set(clave, lista);
    }

    // ── Pase 3: resolver cada trámite ────────────────────────────────────────────────────────
    const tramites: TramiteClaves[] = [];
    const porMotivo: Record<string, number> = {};

    for (const [claveGrupo, lista] of grupos) {
        const nroTramiteReal = claveGrupo.startsWith('__linea_') ? (lista[0].nroTramite ?? claveGrupo) : claveGrupo;
        const lineas = lista.map((e) => e.linea);
        const validas = lista.filter((e): e is LineaOk => e.ok);

        // §5.4 (decisión de Ana Maya del 2026-09-14, fase 1.1): el trámite acepta 1 línea válida
        // (SOLO_TOTAL, sin su par de quita) o 2 (TOTAL + QUITA), y TODAS las líneas que trajo tienen
        // que ser válidas. Nunca 3 o más, aunque las tres fueran válidas individualmente — no hay
        // forma de saber cuál de las tres sobra. Una línea de más o inválida (DV roto, gestor ajeno,
        // lo que sea) no puede quedar descartada sin dejar rastro: el trámite entero se rechaza
        // citándola.
        if (lista.length >= 3 || validas.length !== lista.length) {
            const citas = lista
                .map((e) => e.ok
                    ? `línea ${citarLinea(e, variosArchivos)}: OK`
                    : `línea ${citarLinea(e, variosArchivos)}: [${e.motivo}] ${e.detalle}`)
                .join('; ');
            const motivo: MotivoRechazoTramite = 'TRAMITE_INCOMPLETO';
            porMotivo[motivo] = (porMotivo[motivo] ?? 0) + 1;
            tramites.push({
                nroTramite: nroTramiteReal,
                lineas,
                lineasCrudas: lista.map((e) => e.raw),
                rechazo: {
                    motivo,
                    detalle: `se esperaba 1 línea válida (sola, se toma como TOTAL) o 2 (TOTAL + QUITA) ` +
                        `y hay ${lista.length} línea(s) (${validas.length} válida(s)): ${citas}`,
                },
            });
            continue;
        }

        // Trámite con una única línea válida: se acepta como SOLO_TOTAL (D4 no aplica — no hay
        // segunda clave contra la cual comparar importes), pero SOLO si su importe es exactamente
        // el saldo del trámite. Ajuste del auditor sobre la decisión original (fase 1.1, §20): el
        // caso real confirmado (2577727090) tiene importe == saldo; si no coinciden, la línea única
        // puede ser una QUITA cuyo TOTAL se perdió (archivo cortado, trámite del par ilegible,
        // etc.) y cargarla sola inventaría una "TOTAL" que en realidad es una quita. Se rechaza con
        // un motivo propio en vez de con el genérico TRAMITE_INCOMPLETO, para que el operador
        // entienda que la línea en sí es válida — lo que no calza es aceptarla como total.
        if (validas.length === 1) {
            const unica = validas[0];
            const saldoTramiteCentavos = unica.data.saldoTramiteCentavos;

            if (unica.data.importeCentavos !== saldoTramiteCentavos) {
                const motivo: MotivoRechazoTramite = 'CLAVE_UNICA_NO_ES_TOTAL';
                porMotivo[motivo] = (porMotivo[motivo] ?? 0) + 1;
                tramites.push({
                    nroTramite: nroTramiteReal,
                    lineas,
                    lineasCrudas: lista.map((e) => e.raw),
                    rechazo: {
                        motivo,
                        detalle: `trae una sola clave (línea ${citarLinea(unica, variosArchivos)}, ` +
                            `importe ${unica.data.importeCentavos} centavos) y su importe no es el saldo ` +
                            `del trámite (${saldoTramiteCentavos} centavos); puede ser una quita sin su total`,
                    },
                });
                continue;
            }

            avisos.marcar('SOLO_TOTAL', nroTramiteReal);
            if (unica.data.fechaVencimiento < diaArgentina(hoy)) {
                avisos.marcar('YA_VENCIDA_AL_CARGAR', nroTramiteReal);
            }
            if (unica.data.marca !== 'C') {
                avisos.marcar('MARCA_DESCONOCIDA', nroTramiteReal);
            }
            if (nroTramiteReal.length !== 10) {
                avisos.marcar('TRAMITE_LARGO_INESPERADO', nroTramiteReal);
            }

            tramites.push({
                nroTramite: nroTramiteReal,
                lineas,
                saldoTramiteCentavos,
                claves: [{
                    tipo: 'TOTAL',
                    nroConvenio: unica.data.nroConvenio,
                    importeCentavos: unica.data.importeCentavos,
                    clavePago: unica.data.clavePago,
                    codigoBarras: unica.data.codigoBarras,
                    fechaVencimiento: unica.data.fechaVencimiento,
                    codigoGestor: unica.data.codigoGestor,
                    marca: unica.data.marca,
                    linea: unica.linea,
                }],
            });
            continue;
        }

        // A partir de acá, exactamente 2 líneas válidas: el camino TOTAL + QUITA de siempre.
        const [x, y] = validas;
        if (x.data.importeCentavos === y.data.importeCentavos) {
            const motivo: MotivoRechazoTramite = 'IMPORTES_IGUALES';
            porMotivo[motivo] = (porMotivo[motivo] ?? 0) + 1;
            tramites.push({
                nroTramite: nroTramiteReal,
                lineasCrudas: lista.map((e) => e.raw),
                lineas,
                rechazo: {
                    motivo,
                    detalle:
                        `las dos claves informan el mismo importe (${x.data.importeCentavos} centavos); ` +
                        'no se puede determinar cuál es la quita',
                },
            });
            continue;
        }

        // D4: la de menor importe es la QUITA.
        const quitaEntry = x.data.importeCentavos < y.data.importeCentavos ? x : y;
        const totalEntry = quitaEntry === x ? y : x;
        const saldoTramiteCentavos = totalEntry.data.saldoTramiteCentavos;

        if (quitaEntry.data.saldoTramiteCentavos !== totalEntry.data.saldoTramiteCentavos) {
            avisos.marcar('SALDO_DISTINTO_ENTRE_FILAS', nroTramiteReal);
        }
        if (totalEntry.data.importeCentavos !== saldoTramiteCentavos) {
            avisos.marcar('TOTAL_DISTINTO_DE_SALDO', nroTramiteReal);
        }
        const mitadPiso = Math.floor(totalEntry.data.importeCentavos / 2);
        const mitadTecho = Math.ceil(totalEntry.data.importeCentavos / 2);
        if (quitaEntry.data.importeCentavos !== mitadPiso && quitaEntry.data.importeCentavos !== mitadTecho) {
            avisos.marcar('QUITA_NO_ES_MITAD', nroTramiteReal);
        }
        if (quitaEntry.data.fechaVencimiento !== totalEntry.data.fechaVencimiento) {
            avisos.marcar('VTO_DISTINTO_ENTRE_CLAVES', nroTramiteReal);
        }
        if (totalEntry.data.fechaVencimiento < diaArgentina(hoy)) {
            avisos.marcar('YA_VENCIDA_AL_CARGAR', nroTramiteReal);
        }
        if (quitaEntry.data.marca !== 'C' || totalEntry.data.marca !== 'C') {
            avisos.marcar('MARCA_DESCONOCIDA', nroTramiteReal);
        }
        if (nroTramiteReal.length !== 10) {
            avisos.marcar('TRAMITE_LARGO_INESPERADO', nroTramiteReal);
        }

        tramites.push({
            nroTramite: nroTramiteReal,
            lineas,
            saldoTramiteCentavos,
            claves: [
                {
                    tipo: 'TOTAL',
                    nroConvenio: totalEntry.data.nroConvenio,
                    importeCentavos: totalEntry.data.importeCentavos,
                    clavePago: totalEntry.data.clavePago,
                    codigoBarras: totalEntry.data.codigoBarras,
                    fechaVencimiento: totalEntry.data.fechaVencimiento,
                    codigoGestor: totalEntry.data.codigoGestor,
                    marca: totalEntry.data.marca,
                    linea: totalEntry.linea,
                },
                {
                    tipo: 'QUITA',
                    nroConvenio: quitaEntry.data.nroConvenio,
                    importeCentavos: quitaEntry.data.importeCentavos,
                    clavePago: quitaEntry.data.clavePago,
                    codigoBarras: quitaEntry.data.codigoBarras,
                    fechaVencimiento: quitaEntry.data.fechaVencimiento,
                    codigoGestor: quitaEntry.data.codigoGestor,
                    marca: quitaEntry.data.marca,
                    linea: quitaEntry.linea,
                },
            ],
        });
    }

    const clavesValidasPorLinea = entradas.filter((e) => e.ok).length;
    // Solo las de trámites que quedaron ACEPTADOS: una línea puede ser individualmente válida (DV,
    // formato) y el trámite rechazarse igual (IMPORTES_IGUALES) — esas no se cargan y no cuentan acá.
    const clavesAceptadas = tramites.reduce((acc, t) => acc + (t.rechazo ? 0 : (t.claves?.length ?? 0)), 0);
    const clavesRechazadas = clavesValidasPorLinea - clavesAceptadas;
    const rechazados = tramites.filter((t) => t.rechazo).length;

    return {
        tramites,
        avisos: avisos.lista(),
        resumen: {
            lineas: totalLineas,
            claves: clavesAceptadas,
            clavesRechazadas,
            tramites: tramites.length,
            rechazados,
            porMotivo,
            porAviso: avisos.porCodigo(),
        },
    };
}
