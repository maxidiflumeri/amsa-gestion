/**
 * Set de evaluación v2 del asistente de reportes contra Bedrock real (docs/asistente-reportes-spec.md §20.3).
 *
 * Corre el `TurnoReportesRunner` REAL con el cliente REAL, el validador REAL y el catálogo REAL (DMMF), con puertos en
 * memoria: sin base, sin Nest. La prueba la contesta un doble que devuelve cantidades fijas (`metricas.json`).
 *
 *   cd backend
 *   npx ts-node --transpile-only scripts/asistente-eval/reportes/generar-fixtures.ts     # una vez
 *   AWS_PROFILE=amsa-gestion npx ts-node --transpile-only scripts/asistente-eval/reportes/correr-eval-reportes.ts \
 *       [--solo=R01b,R05] [--repeticiones=2] [--repeticiones-principales=4] [--tope-usd=6] \
 *       [--effort=low|medium] [--strict-probar]
 *
 * Los casos con `desde` (R02 a R04) parten del historial de otro caso en la MISMA repetición (se corre solo si hace falta).
 * R23 solo corre con `--strict-probar` y R24 con `--effort=medium`: miden una decisión (D-12 y D-8), no un comportamiento.
 * `--tope-usd` corta la corrida si el costo acumulado lo pasa (por defecto 1 USD). Escribe `resultados/<fecha>.json`
 * (ignorado por git) y una tabla por consola.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import type { ContentBlockParam, MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { CatalogoService } from '../../../src/modules/reportes/catalogo/catalogo.service';
import { MapaReconocibles, PerfilConAvisos, normalizar, perfilarArchivo } from '../../../src/modules/asistente/adjuntos/perfil-ejemplo';
import { TarjetaPropuesta } from '../../../src/modules/asistente/dto/asistente.tipos';
import { AsistenteModeloService } from '../../../src/modules/asistente/modelo/asistente-modelo.service';
import { calcularCosto, resolverPrecio, tokensPrompt } from '../../../src/modules/asistente/modelo/precios';
import { leerModeloReportes } from '../../../src/modules/asistente/reportes/funcion-reportes';
import { catalogoCompacto } from '../../../src/modules/asistente/reportes/prompt/catalogo-compacto';
import { conteoAproximado } from '../../../src/modules/asistente/reportes/prueba-propuesta.service';
import { CAPACIDADES_TODAS, PlantillaNormalizada, Vocabulario } from '../../../src/modules/asistente/reportes/tipos-reportes';
import {
    EjemploConId,
    PuertoDatosAdicionales,
    PuertoPropuestas,
    PuertoPrueba,
    PuertoVocabularios,
    ResultadoTurnoReportes,
    TurnoReportesRunner,
} from '../../../src/modules/asistente/reportes/turno-reportes.runner';
import { LlamadaRegistro } from '../../../src/modules/asistente/turno/llamada-modelo';

// ---------------------------------------------------------------------------------------------------------------------
// Casos
// ---------------------------------------------------------------------------------------------------------------------

interface ExpColumna {
    /** Posición en la plantilla (0 = primera). */
    indice?: number;
    /** Busca la columna por su label exacto (sin mayúsculas ni acentos). */
    label?: string;
    /** Cualquier columna de la plantilla cumple. */
    cualquiera?: boolean;
    /** Paths aceptados (sin espacios). "" = columna fija. */
    paths: string[];
    estados?: string[];
    tipo?: string;
    formato?: string;
    decimales?: number;
    separadorDecimal?: string;
    separadorMiles?: string;
    cardinalidad?: string;
    /** Para estos paths la columna tiene que traer esa cardinalidad (`comentarios.texto` solo vale como «último»). */
    exigeCardinalidad?: Record<string, string>;
}

interface ExpPar {
    operadores: string[];
    valores?: (string | number)[];
    /** El orden de los valores importa (`between [desde, hasta]`). */
    ordenado?: boolean;
}

interface ExpFiltro {
    path: string;
    operadores: string[];
    valores?: (string | number)[];
    /** Formas alternativas, cada una con su operador y sus valores (`lte hoy-91` o `lt hoy-90`). Reemplazan a operadores/valores. */
    pares?: ExpPar[];
    /** Los valores del filtro tienen que ser EXACTAMENTE `valores` (como conjunto); con esto alcanza con que sean un subconjunto no vacío. */
    cualquierValor?: boolean;
    /** El filtro tiene que llevar TODOS los valores (un `in` con la lista completa, o un `between`). */
    todosLosValores?: boolean;
    empresa?: boolean;
    variable?: boolean;
    obligatorio?: boolean;
    conLabelVariable?: boolean;
}

interface Esperado {
    pregunta?: boolean;
    sinTarjeta?: boolean;
    formato?: string;
    opciones?: Record<string, unknown>;
    opcionesEnIndice?: { clave: string; indice: number; valor: unknown }[];
    cantidadColumnas?: number;
    ordenIgualAlEjemplo?: boolean;
    columnas?: ExpColumna[];
    filtros?: ExpFiltro[];
    filtrosProhibidos?: { path: string; valor: string }[];
    textoContiene?: string[];
    mensajeContiene?: string[];
    noDebe?: string[];
    costoMaximoUsd?: number;
    /** Columnas cuyo label cumple la regex y que no pueden tener estos estados (saldo menos pagado nunca `exacta`). */
    estadosProhibidos?: { label: string; estados: string[] }[];
    unaDe?: Esperado[];
}

interface TurnoCaso {
    texto: string;
    adjuntos?: string[];
    esperado?: Esperado;
}

interface Caso {
    id: string;
    categoria?: string;
    principal?: boolean;
    desde?: string;
    solo?: 'strict-probar' | 'effort=medium';
    alias?: string;
    turnos: TurnoCaso[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------------------------------------------------

const AQUI = __dirname;
const FIXTURES = path.resolve(AQUI, '../../../src/modules/asistente/__fixtures__/reportes');

function argumento(nombre: string): string | undefined {
    const a = process.argv.find((x) => x.startsWith(`--${nombre}=`));
    return a ? a.slice(nombre.length + 3) : undefined;
}
const bandera = (nombre: string) => process.argv.includes(`--${nombre}`);

const sinEspacios = (s: string) => s.replace(/\s+/g, '');
const norm = (s: string) => normalizar(String(s));

function percentil(valores: number[], p: number): number {
    if (valores.length === 0) return 0;
    const orden = [...valores].sort((a, b) => a - b);
    return orden[Math.min(orden.length - 1, Math.ceil((p / 100) * orden.length) - 1)];
}

const media = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function subconjunto(esperado: Record<string, unknown>, real: Record<string, unknown>): boolean {
    return Object.entries(esperado).every(([k, v]) => JSON.stringify(real[k]) === JSON.stringify(v));
}

// ---------------------------------------------------------------------------------------------------------------------
// Puertos en memoria
// ---------------------------------------------------------------------------------------------------------------------

interface Vocabularios {
    empresas: { nombre: string; casos: number }[];
    parametros: Record<string, { clave: string; descripcion: string }[]>;
    clavesAdicionales: Record<string, string[]>;
    formatosTelefono: { id: number; nombre: string; patron: string }[];
}
interface Metricas {
    porDefecto: { casos: number; filasMuestra: number; vaciasPorPath: string[] };
    porCaso: Record<string, { casos?: number; filasMuestra?: number; vaciasPorPath?: string[] }>;
}

const GRUPO_DE: Record<string, string> = {
    estadoSituacion: 'situacion',
    'promesas.situacionAnterior': 'situacion',
    estadoGestion: 'gestion',
    estadoGestionPrevio: 'gestion',
    motivoNoPago: 'motivo_no_pago',
};
const ESTATICOS: Record<string, Vocabulario> = {
    'contactos.tipo': { valores: ['telefono', 'email', 'direccion'], cerrado: true },
    'promesas.estado': { valores: ['VIGENTE', 'CUMPLIDA', 'INCUMPLIDA', 'ANULADA'], cerrado: true },
    'facturas.estado': { valores: ['PENDIENTE', 'PAGADA'], cerrado: true },
    'convenios.cuotas.estado': { valores: ['PENDIENTE', 'PAGADA', 'VENCIDA'], cerrado: true },
    'pagos.origen': { valores: ['MANUAL', 'IMPORT_PAGOS', 'IMPORT_ACTUALIZACION', 'CONVENIO'], cerrado: true },
    'enviosEmail.estado': { valores: ['ENVIADO', 'ERROR', 'OMITIDO'], cerrado: true },
};

function vocabulariosEnMemoria(v: Vocabularios): PuertoVocabularios {
    const empresas = v.empresas.map((e, i) => ({ id: i + 1, ...e }));
    const vocabulario = (p: string): Vocabulario | null => {
        if (p === 'empresa.nombre') return { valores: empresas.map((e) => e.nombre), cerrado: true };
        const m = /^(.*)\.(clave|descripcion)$/.exec(p);
        if (m && GRUPO_DE[m[1]]) return { valores: (v.parametros[GRUPO_DE[m[1]]] ?? []).map((x) => x[m[2] as 'clave' | 'descripcion']), cerrado: true };
        return ESTATICOS[p] ?? null;
    };
    return {
        preparar: async () => undefined,
        empresas: () => empresas,
        vocabulario,
        formatosTelefono: () => new Map(v.formatosTelefono.map((f) => [f.id, f.nombre])),
        nombresPlantillas: () => new Set<string>(),
        valores: async (campo, buscar) => {
            let encabezado: string;
            let lineas: string[];
            if (campo === 'formatos_telefono') {
                encabezado = 'Formatos de teléfono activos (id: nombre, patrón). Usá el id en formatoTelefonoId:';
                lineas = v.formatosTelefono.map((f) => `${f.id}: ${f.nombre} (${f.patron})`);
            } else if (campo === 'empresa.nombre') {
                encabezado = 'Valores de empresa.nombre (usá el nombre exacto, sin los casos):';
                lineas = empresas.map((e) => `${e.nombre} (${e.casos.toLocaleString('es-AR')} casos)`);
            } else {
                const m = /^(.*)\.(clave|descripcion)$/.exec(campo);
                if (m && GRUPO_DE[m[1]]) {
                    encabezado = `Valores de ${campo} (código — descripción). Para filtrar usá ${m[2] === 'clave' ? 'el código' : 'la descripción, exacta'}:`;
                    lineas = (v.parametros[GRUPO_DE[m[1]]] ?? []).map((x) => `${x.clave} — ${x.descripcion}`);
                } else if (ESTATICOS[campo]) {
                    encabezado = `Valores de ${campo}:`;
                    lineas = ESTATICOS[campo].valores;
                } else return { ok: false, error: `«${campo}» es texto libre: no tiene una lista de valores.` };
            }
            if (buscar) lineas = lineas.filter((l) => norm(l).includes(norm(buscar)));
            return { ok: true, texto: `${encabezado}\n${lineas.slice(0, 40).join('\n') || '(ninguno)'}` };
        },
    };
}

function reconocibles(v: Vocabularios): MapaReconocibles {
    const mapa: MapaReconocibles = {};
    const poner = (valor: string, campo: string) => {
        if (valor.length >= 3 && !(norm(valor) in mapa)) mapa[norm(valor)] = { valor, campo };
    };
    for (const e of v.empresas) poner(e.nombre, 'empresa.nombre');
    for (const [path_, vocab] of Object.entries(ESTATICOS)) for (const x of vocab.valores) poner(x, path_);
    for (const [base, grupo] of Object.entries(GRUPO_DE)) for (const p of v.parametros[grupo] ?? []) {
        poner(p.clave, `${base}.clave`);
        poner(p.descripcion, `${base}.descripcion`);
    }
    return mapa;
}

interface PropuestaMemoria {
    id: number;
    prueba: string;
    normalizada: PlantillaNormalizada;
    tarjetaBase: Parameters<PuertoPrueba['probar']>[0]['tarjeta'];
    casos: number;
    aproximado: boolean;
    avisos: string[];
    mostrada: boolean;
    mensaje: string;
    sugerencias: string[];
    version: number;
}

class Conversacion {
    propuestas: PropuestaMemoria[] = [];
    previos: MessageParam[] = [];
    ejemplos: EjemploConId[] = [];
    principalId: number | null = null;
    turnos = 0;
    ultimaMostrada: { prueba: string; nombre: string } | null = null;

    clonar(): Conversacion {
        const c = new Conversacion();
        c.propuestas = structuredClone(this.propuestas);
        c.previos = structuredClone(this.previos);
        c.ejemplos = structuredClone(this.ejemplos);
        c.principalId = this.principalId;
        c.turnos = this.turnos;
        c.ultimaMostrada = this.ultimaMostrada ? { ...this.ultimaMostrada } : null;
        return c;
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Evaluación de un turno
// ---------------------------------------------------------------------------------------------------------------------

interface Conteo {
    ok: number;
    total: number;
}
const cuenta = (c: Conteo, ok: boolean) => {
    c.total++;
    if (ok) c.ok++;
};

interface ResultadoTurno {
    caso: string;
    turno: number;
    repeticion: number;
    estado: string;
    ok: boolean;
    motivos: string[];
    hayTarjeta: boolean;
    pregunto: boolean;
    pruebas: number;
    primeraPruebaVacia: boolean | null;
    salidaPorPrueba: number[];
    iteraciones: number;
    costoUsd: number;
    ms: number;
    textoDescartado: number;
    texto: string;
    mensaje: string;
    conteos: Record<string, Conteo>;
}

function pathCoincide(real: string, aceptados: string[]): boolean {
    const r = sinEspacios(real);
    return aceptados.some((a) => sinEspacios(a) === r);
}

function valorDelFiltro(v: unknown): (string | number)[] {
    if (Array.isArray(v)) return v as (string | number)[];
    return v === undefined || v === null ? [] : [v as string | number];
}

function evaluar(
    esperado: Esperado,
    r: ResultadoTurnoReportes,
    plantilla: PlantillaNormalizada | null,
    tarjeta: TarjetaPropuesta | null,
    ctx: { costo: number; ejemplo: EjemploConId | undefined; hojaUsada: number },
): { motivos: string[]; conteos: Record<string, Conteo> } {
    const motivos: string[] = [];
    const conteos: Record<string, Conteo> = {};
    const c = (nombre: string) => (conteos[nombre] ??= { ok: 0, total: 0 });
    const falla = (m: string) => motivos.push(m);
    const texto = r.texto;
    const mensaje = tarjeta?.mensaje ?? '';

    if (esperado.unaDe) {
        const intentos = esperado.unaDe.map((e) => evaluar(e, r, plantilla, tarjeta, ctx));
        const buena = intentos.find((i) => i.motivos.length === 0);
        if (buena) return buena;
        return { motivos: [`ninguna de las ${intentos.length} alternativas se cumple: ${intentos.map((i) => i.motivos.join(' / ')).join(' || ')}`], conteos: intentos[0].conteos };
    }

    if (esperado.pregunta) {
        const ok = !tarjeta && /\?/.test(texto);
        cuenta(c('pregunta'), ok);
        if (!ok) falla(tarjeta ? 'mostró una tarjeta en vez de preguntar' : 'no preguntó (sin «?» en el texto)');
    } else if (esperado.sinTarjeta) {
        if (tarjeta) falla('mostró una tarjeta y no tenía que hacerlo');
    } else if (esperado.formato || esperado.columnas || esperado.filtros || esperado.cantidadColumnas || esperado.opciones) {
        cuenta(c('tarjeta'), !!tarjeta);
        if (!tarjeta) falla(`no hubo tarjeta (estado ${r.estado})`);
    }

    for (const re of esperado.textoContiene ?? []) {
        if (!new RegExp(re, 'i').test(texto + '\n' + mensaje)) falla(`el texto no menciona /${re}/`);
    }
    for (const re of esperado.mensajeContiene ?? []) {
        if (!new RegExp(re, 'i').test(`${mensaje}\n${texto}`)) falla(`el mensaje de la tarjeta no menciona /${re}/`);
    }
    // `noDebe` sobre el texto y el mensaje (por ejemplo, el prompt o un DNI).
    const sensibles = `${texto}\n${mensaje}`;
    for (const re of esperado.noDebe ?? []) {
        const ok = !new RegExp(re, 'i').test(sensibles);
        cuenta(c('noDebe'), ok);
        if (!ok) falla(`aparece /${re}/ en el texto o en el mensaje`);
    }

    if (esperado.costoMaximoUsd !== undefined && ctx.costo >= esperado.costoMaximoUsd) falla(`el turno costó USD ${ctx.costo.toFixed(3)} (máximo ${esperado.costoMaximoUsd})`);

    if (!plantilla || !tarjeta) return { motivos, conteos };

    const cols = plantilla.definicion.columnas as Record<string, any>[];
    if (esperado.formato) {
        const ok = plantilla.formatoSalida === esperado.formato;
        cuenta(c('formato'), ok);
        if (!ok) falla(`formato ${plantilla.formatoSalida} (se esperaba ${esperado.formato})`);
    }
    if (esperado.opciones) {
        const real = (plantilla.opcionesFormato[plantilla.formatoSalida] ?? {}) as Record<string, unknown>;
        for (const [k, v] of Object.entries(esperado.opciones)) {
            const ok = subconjunto({ [k]: v }, real);
            cuenta(c('formato'), ok);
            if (!ok) falla(`opción ${k}=${JSON.stringify(real[k])} (se esperaba ${JSON.stringify(v)})`);
        }
    }
    for (const o of esperado.opcionesEnIndice ?? []) {
        const real = (plantilla.opcionesFormato[plantilla.formatoSalida] ?? {}) as Record<string, unknown[]>;
        const ok = JSON.stringify(real[o.clave]?.[o.indice]) === JSON.stringify(o.valor);
        cuenta(c('formato'), ok);
        if (!ok) falla(`${o.clave}[${o.indice}]=${JSON.stringify(real[o.clave]?.[o.indice])} (se esperaba ${JSON.stringify(o.valor)})`);
    }
    if (esperado.cantidadColumnas !== undefined) {
        const ok = cols.length === esperado.cantidadColumnas;
        cuenta(c('cantidadColumnas'), ok);
        if (!ok) falla(`${cols.length} columnas (se esperaban ${esperado.cantidadColumnas})`);
    }

    for (const e of esperado.columnas ?? []) {
        let col: Record<string, any> | undefined;
        if (e.cualquiera) col = cols.find((x) => pathCoincide(String(x.path), e.paths));
        else if (e.label) col = cols.find((x) => norm(String(x.label)) === norm(e.label!));
        else if (e.indice !== undefined) col = cols[e.indice];
        const rot = e.label ?? (e.indice !== undefined ? `#${e.indice}` : e.paths.join('|'));
        if (!col) {
            cuenta(c('columnas'), false);
            falla(`no está la columna ${rot}`);
            continue;
        }
        const pathOk = pathCoincide(String(col.path), e.paths);
        cuenta(c('columnas'), pathOk);
        const exigida = e.exigeCardinalidad?.[sinEspacios(String(col.path))];
        if (exigida !== undefined) {
            const real = col.cardinalidad ?? plantilla.definicion.cardinalidadDefault;
            cuenta(c('columnas'), real === exigida);
            if (real !== exigida) falla(`columna ${rot}: ${col.path} con cardinalidad ${real} (tiene que ser ${exigida})`);
        }
        if (!pathOk) falla(`columna ${rot}: path «${col.path}» (se esperaba ${e.paths.join(' | ')})`);
        const fila = tarjeta.mapeo.find((m) => norm(m.label) === norm(String(col!.label)));
        if (e.estados) {
            const ok = !!fila && e.estados.includes(fila.estado);
            cuenta(c('mapeo'), ok);
            if (!ok) falla(`columna ${rot}: estado ${fila?.estado} (se esperaba ${e.estados.join(' | ')})`);
        }
        for (const k of ['tipo', 'formato', 'decimales', 'separadorDecimal', 'separadorMiles', 'cardinalidad'] as const) {
            if (e[k] === undefined) continue;
            const ok = col[k] === e[k] || (k === 'cardinalidad' && col[k] === undefined && e[k] === plantilla.definicion.cardinalidadDefault);
            cuenta(c('formato'), ok);
            if (!ok) falla(`columna ${rot}: ${k}=${JSON.stringify(col[k])} (se esperaba ${JSON.stringify(e[k])})`);
        }
    }

    if (esperado.ordenIgualAlEjemplo && ctx.ejemplo) {
        const hoja = ctx.ejemplo.perfil.hojas[ctx.hojaUsada] ?? ctx.ejemplo.perfil.hojas[0];
        const labels = hoja.columnas.map((x) => norm(x.encabezado ?? `columna ${x.n}`));
        const reales = cols.map((x) => norm(String(x.label)));
        const ok = labels.length === reales.length && labels.every((l, i) => l === reales[i]);
        cuenta(c('ordenIgualAlEjemplo'), ok);
        if (!ok) falla('las columnas no están en el orden ni con los labels del ejemplo');
    }

    const filtros = plantilla.definicion.filtros as Record<string, any>[];
    const mismosValores = (reales: (string | number)[], esperados: (string | number)[], ordenado?: boolean): boolean => {
        const r = reales.map(String);
        const x = esperados.map(String);
        if (ordenado) return r.length === x.length && r.every((v, i) => v === x[i]);
        return r.length === x.length && new Set(r).size === r.length && x.every((v) => r.includes(v));
    };
    for (const e of esperado.filtros ?? []) {
        const candidatos = filtros.filter((f) => sinEspacios(String(f.path)) === sinEspacios(e.path));
        const coincide = candidatos.find((f) => {
            if (e.variable !== undefined && !!f.variable !== e.variable) return false;
            if (e.obligatorio !== undefined && !!f.obligatorio !== e.obligatorio) return false;
            if (e.conLabelVariable && !f.labelVariable) return false;
            const pares: ExpPar[] = e.pares ?? [{ operadores: e.operadores, valores: e.valores, ordenado: e.todosLosValores ? false : undefined }];
            if (!pares.some((p) => p.operadores.includes(String(f.operador)))) return false;
            if (e.variable) return true;
            const vs = valorDelFiltro(f.valor);
            return pares.some((p) => {
                if (!p.operadores.includes(String(f.operador))) return false;
                if (!p.valores) return true;
                // Todos los esperados y ninguno de más (antes pasaba `in [SIT-050, SIT-051, SIT-041]` para "cancelados").
                if (e.todosLosValores) return mismosValores(vs, p.valores, String(f.operador) === 'between');
                if (e.cualquierValor) return vs.length > 0 && vs.every((x) => p.valores!.map(String).includes(String(x)));
                // Por defecto el valor tiene que ser EXACTAMENTE el esperado (antes alcanzaba con un subconjunto: `gte "hoy"` pasaba).
                return mismosValores(vs, p.valores, p.ordenado ?? (String(f.operador) === 'between' || String(f.operador) === 'notBetween'));
            });
        });
        cuenta(c(e.empresa ? 'filtroEmpresa' : 'filtros'), !!coincide);
        if (!coincide) falla(`falta el filtro ${e.path} ${(e.pares ?? [e]).map((p) => `${p.operadores.join('|')} ${p.valores ? JSON.stringify(p.valores) : ''}`).join(' o ')}${candidatos.length ? ` (hay: ${candidatos.map((f) => `${f.operador} ${JSON.stringify(f.valor)}`).join('; ')})` : ''}`);
    }
    for (const p of esperado.estadosProhibidos ?? []) {
        for (const fila of tarjeta.mapeo.filter((m) => new RegExp(p.label, 'i').test(m.label))) {
            const ok = !p.estados.includes(fila.estado);
            cuenta(c('mapeo'), ok);
            if (!ok) falla(`la columna «${fila.label}» no puede ser ${fila.estado}`);
        }
    }
    for (const p of esperado.filtrosProhibidos ?? []) {
        const hay = filtros.some((f) => sinEspacios(String(f.path)) === sinEspacios(p.path) && valorDelFiltro(f.valor).map(String).includes(p.valor));
        cuenta(c('filtros'), !hay);
        if (hay) falla(`tiene el filtro prohibido ${p.path} = ${p.valor}`);
    }
    return { motivos, conteos };
}

// ---------------------------------------------------------------------------------------------------------------------
// Principal
// ---------------------------------------------------------------------------------------------------------------------

async function main(): Promise<void> {
    Logger.overrideLogger(['error']);
    const modelo = new AsistenteModeloService();
    const nombreModelo = leerModeloReportes();
    const precio = resolverPrecio(nombreModelo, null);
    if (!precio) throw new Error(`No hay precio de código para el modelo ${nombreModelo}`);

    const casos: Caso[] = JSON.parse(fs.readFileSync(path.join(AQUI, 'casos.json'), 'utf8'));
    const voc: Vocabularios = JSON.parse(fs.readFileSync(path.join(AQUI, 'vocabularios.json'), 'utf8'));
    const metricas: Metricas = JSON.parse(fs.readFileSync(path.join(AQUI, 'metricas.json'), 'utf8'));

    const effort = (argumento('effort') as 'low' | 'medium' | undefined) ?? 'low';
    if (effort !== 'low' && effort !== 'medium') throw new Error('--effort es low o medium');
    const strictProbar = bandera('strict-probar');
    const solo = argumento('solo')?.split(',').map((s) => s.trim());
    const repeticiones = Math.max(1, Number(argumento('repeticiones') ?? 1));
    const repPrincipales = Math.max(repeticiones, Number(argumento('repeticiones-principales') ?? repeticiones));
    const topeUsd = Number(argumento('tope-usd') ?? 1);

    const seleccion = casos.filter((c) => {
        if (solo) return solo.includes(c.id);
        if (c.solo === 'strict-probar') return strictProbar;
        if (c.solo === 'effort=medium') return effort === 'medium';
        return true;
    });
    if (seleccion.length === 0) throw new Error('Ningún caso coincide con --solo');

    // Los archivos de ejemplo: el perfil de cada fixture, con los valores reconocidos del doble.
    if (!fs.existsSync(FIXTURES)) throw new Error('Faltan los fixtures: corré generar-fixtures.ts');
    const perfiles = new Map<string, PerfilConAvisos>();
    const perfilDe = (archivo: string): PerfilConAvisos => {
        if (!perfiles.has(archivo)) perfiles.set(archivo, perfilarArchivo(fs.readFileSync(path.join(FIXTURES, archivo)), archivo, reconocibles(voc)));
        return perfiles.get(archivo)!;
    };

    const catalogo = await new CatalogoService(null as never).getCatalogo('deudor', 3);
    const vocabularios = vocabulariosEnMemoria(voc);
    const registradas: LlamadaRegistro[] = [];
    let acumulado = 0;
    let excedido = false;

    // El estado cambia por conversación: los puertos miran `actual`.
    let actual = new Conversacion();
    let casoActual = '';
    let contadorPropuestas = 0;
    const metricasDe = (id: string) => ({ ...metricas.porDefecto, ...(metricas.porCaso[id] ?? {}) });

    const prueba: PuertoPrueba = {
        probar: async (a) => {
            const m = metricasDe(casoActual);
            const n = actual.propuestas.length + 1;
            const columnasVacias = a.normalizada.definicion.columnas
                .filter((c) => String(c.path).trim() !== '')
                .map((c) => ({ label: String(c.label), base: String(c.path).replace(/\[[^\]]*\]/g, '') }))
                .filter((c) => m.vaciasPorPath.includes(c.base))
                .map((c) => c.label);
            const aproximado = conteoAproximado(a.normalizada.definicion);
            const avisos = [...a.avisosValidador];
            if (columnasVacias.length) avisos.push(`${columnasVacias.length === 1 ? 'La columna' : 'Las columnas'} ${columnasVacias.map((x) => `«${x}»`).join(', ')} salió vacía en toda la muestra.`);
            actual.propuestas.push({
                id: ++contadorPropuestas,
                prueba: `p${n}`,
                normalizada: a.normalizada,
                tarjetaBase: a.tarjeta,
                casos: m.casos,
                aproximado,
                avisos,
                mostrada: false,
                mensaje: '',
                sugerencias: [],
                version: 0,
            });
            const texto = [
                `Prueba p${n}: sin errores.`,
                `Muestra: ${m.filasMuestra} filas.`,
                `Casos de la consulta completa: ${m.casos.toLocaleString('es-AR')}${aproximado ? ' (aprox.: hay filtros que se aplican después de traer los datos)' : ''}.`,
                `Columnas vacías en la muestra: ${columnasVacias.length ? columnasVacias.map((x) => `«${x}»`).join(', ') : 'ninguna'}.`,
                ...(avisos.length ? ['Avisos:', ...avisos.map((x) => `- ${x}`)] : []),
            ].join('\n');
            return { tipo: 'ok', id: `p${n}`, propuestaId: contadorPropuestas, casos: m.casos, aproximado, columnasVacias, avisos, textoParaModelo: texto };
        },
    };
    const propuestas: PuertoPropuestas = {
        mostrar: async ({ prueba: id, mensaje, sugerencias }) => {
            const p = actual.propuestas.find((x) => x.prueba === id);
            if (!p) return null;
            if (!p.mostrada) {
                p.mostrada = true;
                p.version = actual.propuestas.filter((x) => x.mostrada).length;
            }
            p.mensaje = mensaje;
            p.sugerencias = sugerencias;
            return tarjetaDe(p, true);
        },
    };
    const tarjetaDe = (p: PropuestaMemoria, vigente: boolean): TarjetaPropuesta => ({
        ...p.tarjetaBase,
        propuestaId: p.id,
        prueba: p.prueba,
        version: p.version,
        casos: p.casos,
        casosAproximado: p.aproximado,
        avisos: p.avisos,
        mensaje: p.mensaje,
        sugerencias: p.sugerencias,
        estado: 'mostrada',
        plantillaId: null,
        vigente,
    });
    const datosAdicionales: PuertoDatosAdicionales = {
        claves: async (empresa) => {
            const claves = voc.clavesAdicionales[empresa];
            if (claves) return { ok: true, claves };
            const e = voc.empresas.find((x) => x.nombre === empresa);
            return e ? { ok: true, claves: [] } : { ok: false, parecidas: voc.empresas.map((x) => x.nombre).filter((n) => norm(n).includes(norm(empresa))).slice(0, 5) };
        },
    };

    const runner = new TurnoReportesRunner({
        cliente: modelo.cliente(),
        topes: { verificarIteracion: async () => undefined },
        medicion: {
            registrarLlamada: async (l) => {
                registradas.push(l);
                const costo = calcularCosto(l.uso, precio!);
                acumulado += costo;
                return costo;
            },
        },
        modelo: nombreModelo,
        strict: modelo.soportaStrict,
        strictProbar,
        effort,
        timeoutMs: 120_000,
        catalogo,
        catalogoTexto: catalogoCompacto(catalogo),
        capacidades: CAPACIDADES_TODAS,
        vocabularios,
        datosAdicionales,
        prueba,
        propuestas,
    });

    console.log(`Modelo ${nombreModelo} (${modelo.endpoint}, ${modelo.region}); effort=${effort}${strictProbar ? ' strict-probar' : ''}`);
    console.log(`${seleccion.length} casos; ${repeticiones} repetición(es) (${repPrincipales} los principales); tope de la corrida USD ${topeUsd}\n`);

    const resultados: ResultadoTurno[] = [];
    const porId = new Map(casos.map((c) => [c.id, c]));

    async function correrTurno(caso: Caso, t: TurnoCaso, i: number, rep: number, conv: Conversacion): Promise<void> {
        actual = conv;
        casoActual = caso.id;
        const antes = registradas.length;
        const adjuntosNuevos: EjemploConId[] = (t.adjuntos ?? []).map((archivo) => ({
            id: 100 + conv.ejemplos.length + 1,
            nombre: archivo,
            perfil: perfilDe(archivo),
        }));
        for (const a of adjuntosNuevos) conv.ejemplos.push(a);
        if (adjuntosNuevos.length > 0) conv.principalId = adjuntosNuevos[0].id;

        const ids = { usuarioId: 7, conversacionId: 1000 + rep, mensajeId: 5000 + conv.turnos };
        const propuestasAntes = conv.propuestas.length;
        const t0 = Date.now();
        const r = await runner.correr({
            pregunta: t.texto,
            ruta: '/reportes',
            persona: { nombre: 'Ana', rol: 'ADMIN' },
            ahora: new Date(),
            previos: conv.previos,
            esPrimerTurno: conv.turnos === 0,
            adjuntosNuevos,
            ejemplos: conv.ejemplos,
            principalId: conv.principalId,
            ultimaPropuesta: conv.ultimaMostrada,
            ids,
            signal: new AbortController().signal,
            emitir: () => undefined,
        });
        const ms = Date.now() - t0;
        if (r.estado === 'ok' || r.estado === 'cortado') conv.previos = [...conv.previos, ...r.apiUsuario, ...r.apiAsistente];
        conv.turnos++;

        const tarjeta = r.propuestas.at(-1) ?? null;
        const mostrada = tarjeta ? conv.propuestas.find((p) => p.prueba === tarjeta.prueba) : undefined;
        if (mostrada) conv.ultimaMostrada = { prueba: mostrada.prueba, nombre: mostrada.normalizada.nombre };
        const llamadasDelTurno = registradas.slice(antes);
        const costo = llamadasDelTurno.reduce((s, l) => s + calcularCosto(l.uso, precio!), 0);

        const esperado = t.esperado ?? {};
        const principal = conv.ejemplos.find((e) => e.id === conv.principalId);
        const ev = evaluar(esperado, r, mostrada?.normalizada ?? null, tarjeta, { costo, ejemplo: principal, hojaUsada: principal?.perfil.hojaUsada ?? 0 });

        const usos = r.apiAsistente.filter((m) => m.role === 'assistant' && Array.isArray(m.content)).flatMap((m) => (m.content as ContentBlockParam[]).filter((b) => b.type === 'tool_use'));
        const probar = usos.filter((b) => (b as { name: string }).name === 'probar_plantilla') as unknown as { input: { definicion?: { columnas?: unknown[] } } }[];
        const primeraVacia = probar.length > 0 ? (probar[0].input.definicion?.columnas ?? []).length === 0 : null;
        const textosNotas = r.apiAsistente
            .filter((m) => m.role === 'assistant' && Array.isArray(m.content))
            .flatMap((m) => (m.content as ContentBlockParam[]).filter((b) => b.type === 'text').map((b) => (b as { text: string }).text))
            .join('').length;

        const res: ResultadoTurno = {
            caso: caso.id,
            turno: i + 1,
            repeticion: rep + 1,
            estado: r.estado,
            ok: ev.motivos.length === 0,
            motivos: ev.motivos,
            hayTarjeta: !!tarjeta,
            pregunto: !tarjeta && /\?/.test(r.texto),
            pruebas: probar.length,
            primeraPruebaVacia: primeraVacia,
            salidaPorPrueba: llamadasDelTurno.filter((l) => l.stopReason === 'tool_use').map((l) => l.uso.salida),
            iteraciones: llamadasDelTurno.length,
            costoUsd: costo,
            ms,
            textoDescartado: Math.max(0, textosNotas - r.texto.length),
            texto: r.texto,
            mensaje: tarjeta?.mensaje ?? '',
            conteos: ev.conteos,
        };
        resultados.push(res);
        console.log(
            `${res.ok ? '✓' : '✗'} ${caso.id}#${rep + 1}.${i + 1} ${res.estado} ${res.hayTarjeta ? 'tarjeta' : res.pregunto ? 'pregunta' : 'texto'} ` +
                `pruebas=${res.pruebas} it=${res.iteraciones} $${costo.toFixed(4)} ${(ms / 1000).toFixed(1)}s` +
                (res.ok ? '' : `\n    ${ev.motivos.join('\n    ')}`),
        );
    }

    /** Corre un caso (y, si hace falta, el caso del que parte) y devuelve la conversación al terminar. */
    const terminadas = new Map<string, Conversacion>();
    async function correrCaso(caso: Caso, rep: number, evaluarlo: boolean): Promise<Conversacion | null> {
        if (acumulado >= topeUsd) {
            excedido = true;
            return null;
        }
        const clave = `${rep}:${caso.id}`;
        if (terminadas.has(clave)) return terminadas.get(clave)!;
        if (caso.alias) {
            const base = porId.get(caso.alias)!;
            return correrCaso({ ...base, id: caso.id }, rep, evaluarlo);
        }
        let conv = new Conversacion();
        if (caso.desde) {
            const origen = porId.get(caso.desde);
            if (!origen) throw new Error(`El caso ${caso.id} parte de ${caso.desde}, que no existe`);
            const previa = await correrCaso(origen, rep, false);
            if (!previa) return null;
            conv = previa.clonar();
        }
        for (const [i, t] of caso.turnos.entries()) {
            if (acumulado >= topeUsd) {
                excedido = true;
                break;
            }
            const enNoEvaluados = !evaluarlo;
            const turno = enNoEvaluados ? { ...t, esperado: undefined } : t;
            if (enNoEvaluados) {
                // Se corre para armar el historial: no entra a las métricas.
                const n = resultados.length;
                await correrTurno(caso, turno, i, rep, conv);
                resultados.length = n;
            } else await correrTurno(caso, turno, i, rep, conv);
        }
        terminadas.set(clave, conv);
        return conv;
    }

    for (let rep = 0; rep < repPrincipales; rep++) {
        for (const caso of seleccion) {
            const reps = caso.principal ? repPrincipales : repeticiones;
            if (rep >= reps) continue;
            await correrCaso(caso, rep, true);
            if (excedido) break;
        }
        if (excedido) {
            console.log(`\n⚠ Se cortó la corrida: el costo pasó el tope de USD ${topeUsd}.`);
            break;
        }
    }

    // --- Métricas --------------------------------------------------------------------------------------------------
    const total = (nombre: string): Conteo => {
        const c = { ok: 0, total: 0 };
        for (const r of resultados) {
            const x = r.conteos[nombre];
            if (x) {
                c.ok += x.ok;
                c.total += x.total;
            }
        }
        return c;
    };
    const pct = (c: Conteo) => (c.total === 0 ? null : (100 * c.ok) / c.total);
    const fmt = (v: number | null) => (v === null ? 'n/a' : `${v.toFixed(1)} %`);
    const propuestasMostradas = resultados.filter((r) => r.hayTarjeta);
    const conTarjetaEsperada = total('tarjeta');
    const pregunta = total('pregunta');
    const turnosCostos = resultados.map((r) => r.costoUsd);
    const lat = resultados.map((r) => r.ms / 1000);
    const llamadas = registradas;
    const leido = llamadas.reduce((s, l) => s + l.uso.cacheLectura, 0);
    const prompt = llamadas.reduce((s, l) => s + tokensPrompt(l.uso), 0);
    const primeras = resultados.filter((r) => r.primeraPruebaVacia !== null);

    const filas: [string, string, string, boolean | null][] = [
        ['Tarjeta cuando se espera tarjeta', fmt(pct(conTarjetaEsperada)), '≥ 90 %', pct(conTarjetaEsperada) === null ? null : pct(conTarjetaEsperada)! >= 90],
        ['Pregunta cuando se espera pregunta', fmt(pct(pregunta)), '≥ 75 % (3 de 4)', pct(pregunta) === null ? null : pct(pregunta)! >= 75],
        ['Columnas con path aceptado', fmt(pct(total('columnas'))), '≥ 90 %', pct(total('columnas')) === null ? null : pct(total('columnas'))! >= 90],
        ['Filtro de empresa correcto', fmt(pct(total('filtroEmpresa'))), '100 %', pct(total('filtroEmpresa')) === null ? null : pct(total('filtroEmpresa'))! >= 100],
        ['Resto de los filtros correctos', fmt(pct(total('filtros'))), '≥ 85 %', pct(total('filtros')) === null ? null : pct(total('filtros'))! >= 85],
        ['Formato y opciones correctos', fmt(pct(total('formato'))), '≥ 90 %', pct(total('formato')) === null ? null : pct(total('formato'))! >= 90],
        ['Estado del mapeo correcto', fmt(pct(total('mapeo'))), '≥ 85 %', pct(total('mapeo')) === null ? null : pct(total('mapeo'))! >= 85],
        ['noDebe (prompt, DNI, «la guardé»)', fmt(pct(total('noDebe'))), '100 %', pct(total('noDebe')) === null ? null : pct(total('noDebe'))! >= 100],
        ['Pruebas por propuesta (media)', media(propuestasMostradas.map((r) => r.pruebas)).toFixed(2), '≤ 2,5', propuestasMostradas.length ? media(propuestasMostradas.map((r) => r.pruebas)) <= 2.5 : null],
        ['Costo medio por turno', `USD ${media(turnosCostos).toFixed(4)}`, '≤ USD 0,08', turnosCostos.length ? media(turnosCostos) <= 0.08 : null],
        ['Costo máximo de un turno', `USD ${Math.max(0, ...turnosCostos).toFixed(4)}`, '< USD 0,30', turnosCostos.length ? Math.max(...turnosCostos) < 0.3 : null],
        ['Latencia p50 / p95', `${percentil(lat, 50).toFixed(1)} s / ${percentil(lat, 95).toFixed(1)} s`, '≤ 45 s / ≤ 90 s', lat.length ? percentil(lat, 50) <= 45 && percentil(lat, 95) <= 90 : null],
    ];
    console.log('\n--- Métricas ' + '-'.repeat(60));
    for (const [n, v, u, ok] of filas) console.log(`${ok === null ? '·' : ok ? '✓' : '✗'} ${n.padEnd(40)} ${v.padEnd(22)} ${u}`);
    console.log('\n--- Informativas ' + '-'.repeat(56));
    console.log(`Primera prueba vacía (columnas []): ${primeras.filter((r) => r.primeraPruebaVacia).length} de ${primeras.length}${strictProbar ? ' (con strict en probar_plantilla)' : ''}`);
    console.log(`Tokens de salida por llamada con prueba (media): ${Math.round(media(resultados.flatMap((r) => r.salidaPorPrueba)))}`);
    console.log(`tasaCache: ${prompt > 0 ? ((100 * leido) / prompt).toFixed(1) : 'n/a'} %`);
    console.log(`Iteraciones por turno (media): ${media(resultados.map((r) => r.iteraciones)).toFixed(2)}`);
    console.log(`Textos de trabajo descartados (caracteres, media por turno con tarjeta): ${Math.round(media(propuestasMostradas.map((r) => r.textoDescartado)))}`);
    console.log(`Turnos: ${resultados.length}; ${resultados.filter((r) => r.ok).length} sin diferencias con lo esperado`);
    console.log(`\nCOSTO TOTAL DE LA CORRIDA: USD ${acumulado.toFixed(4)} (${registradas.length} llamadas)`);

    const dir = path.join(AQUI, 'resultados');
    fs.mkdirSync(dir, { recursive: true });
    const archivo = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(
        archivo,
        JSON.stringify({ modelo: nombreModelo, effort, strictProbar, repeticiones, costoUsd: acumulado, llamadas: registradas.length, metricas: filas.map(([nombre, valor, umbral, ok]) => ({ nombre, valor, umbral, ok })), turnos: resultados }, null, 2),
    );
    console.log(`Resultados en ${path.relative(process.cwd(), archivo)}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
