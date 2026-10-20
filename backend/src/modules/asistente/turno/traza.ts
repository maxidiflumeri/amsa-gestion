import { Logger } from '@nestjs/common';
import { DetalleRespuesta, MotivoFin, PrecioModelo, RecursoHerramienta } from '../dto/asistente.tipos';
import type { EventoStreamModelo } from '../modelo/cliente-modelo';
import {
    BloqueRegistro,
    CierreLlamada,
    RegistroHerramienta,
    RegistroLlamada,
    RegistroParte,
    armarDetalle,
} from './detalle';

/**
 * El medidor de un turno (docs/asistente-detalle-spec.md §3, §7). Vive lo que dura un turno: se crea en el servicio con el
 * reloj y el precio de ese turno, y se pasa a los runners como un puerto opcional más (como `emitir`). Un runner sin traza
 * usa `TRAZA_NULA`.
 *
 * Reglas:
 * - NUNCA lanza. Cada método público está envuelto; ante una excepción interna marca `incompleto`, loguea UNA vez por turno
 *   y sigue. Medir no puede romper una respuesta.
 * - NUNCA recibe contenido: solo nombres de tipo, instantes, tokens, costos y largos.
 */

/** Dónde corre cada herramienta: lo que explica su tiempo (§7.4). Una herramienta que no está queda sin recurso. */
export const RECURSO_HERRAMIENTA: Readonly<Record<string, RecursoHerramienta>> = {
    leer_pagina: 'wiki',
    buscar_en_wiki: 'wiki',
    ofrecer_ir_a: 'memoria',
    ver_otra_hoja: 'memoria',
    valores_de_campo: 'base',
    datos_adicionales: 'base',
    probar_plantilla: 'base',
    mostrar_propuesta: 'base',
};

/** `performance.now()`: monotónico y con fracción de milisegundo. `Date.now()` puede saltar con un ajuste de hora. */
export const relojMonotonico = (): number => performance.now();

export type ParteServicio = 'topes' | 'historial' | 'contexto' | 'guardar';
export type ParteHerramienta = 'validacion' | 'espera_base' | 'muestra' | 'conteo';

/** Una llamada al modelo, medida. Todo lo que recibe son eventos sin contenido. */
export interface TrazaLlamada {
    /** Después de los topes: se abre el stream. */
    stream(): void;
    evento(e: EventoStreamModelo): void;
    /** `finalMessage` resolvió o rechazó: ese es el fin de la llamada, antes de registrarla. */
    finStream(): void;
    cerrar(c: CierreLlamada): void;
    /** El control de topes cortó antes de llamar: la llamada «no se hizo». */
    cortadaPorTope(codigo: string): void;
}

export interface TrazaHerramienta {
    /** Abre una parte de la herramienta (p. ej. `muestra`); devuelve quien la termina. Se puede llamar más de una vez. */
    parte(tipo: ParteHerramienta): () => void;
    /** El texto del paso que emitió la herramienta: lo arma el backend, nunca lleva argumentos ni resultados. */
    describir(p: { texto: string; estado: 'ok' | 'aviso' | 'error' }): void;
    cerrar(r: { esError: boolean; caracteresResultado: number }): void;
}

/** Lo que un runner necesita del medidor. */
export interface PuertoTraza {
    llamada(iteracion: number): TrazaLlamada;
    herramienta(nombre: string, recurso?: RecursoHerramienta): TrazaHerramienta;
    motivo(m: MotivoFin | null): void;
}

const LLAMADA_NULA: TrazaLlamada = {
    stream: () => undefined,
    evento: () => undefined,
    finStream: () => undefined,
    cerrar: () => undefined,
    cortadaPorTope: () => undefined,
};
const PARTE_NULA = (): void => undefined;
const HERRAMIENTA_NULA: TrazaHerramienta = {
    parte: () => PARTE_NULA,
    describir: () => undefined,
    cerrar: () => undefined,
};

/** No mide nada. Es lo que usa un runner sin traza (los tests de hoy y el set de evaluación). */
export const TRAZA_NULA: PuertoTraza = {
    llamada: () => LLAMADA_NULA,
    herramienta: () => HERRAMIENTA_NULA,
    motivo: () => undefined,
};

export interface OpcionesTraza {
    funcion: string;
    modelo: string;
    /** Sin precio los hijos de una llamada van sin costo (no debería pasar: sin precio no se llama). */
    precio?: PrecioModelo | null;
    /** Inyectable en los tests. */
    reloj?: () => number;
    /** Para el log del medidor. */
    mensajeId?: number | null;
    /** La lista cerrada de herramientas de la función: un nombre que no está se guarda como 'otra'. */
    herramientas?: readonly string[];
}

export class TrazaTurno implements PuertoTraza {
    private readonly logger = new Logger(TrazaTurno.name);
    private readonly reloj: () => number;
    private readonly t0: number;
    private conocidas: ReadonlySet<string>;
    private readonly partes: RegistroParte[] = [];
    private readonly llamadas: RegistroLlamada[] = [];
    private readonly herramientas: RegistroHerramienta[] = [];
    private orden = 0;
    private motivoFin: MotivoFin | null = null;
    private primerTexto: number | null = null;
    private incompleto = false;
    private avisado = false;
    /** El mensaje del asistente al que pertenece: se completa cuando el servicio lo crea. */
    mensajeId: number | null;

    private o: OpcionesTraza;

    constructor(o: OpcionesTraza) {
        this.o = o;
        this.reloj = o.reloj ?? relojMonotonico;
        this.conocidas = new Set(o.herramientas ?? Object.keys(RECURSO_HERRAMIENTA));
        this.mensajeId = o.mensajeId ?? null;
        let t0 = 0;
        try {
            t0 = this.reloj();
        } catch (e) {
            this.fallo(e);
        }
        this.t0 = t0;
    }

    /**
     * Completa lo que se supo después de empezar: la función, el modelo, el precio y la lista de herramientas. El reloj no se
     * toca: el turno empieza cuando llega el pedido, no cuando se resuelve de qué función es.
     */
    definir(o: Pick<OpcionesTraza, 'funcion' | 'modelo' | 'precio' | 'herramientas'>): void {
        this.seguro(() => {
            this.o = { ...this.o, ...o };
            if (o.herramientas) this.conocidas = new Set(o.herramientas);
        }, undefined);
    }

    // ---------------------------------------------------------------- internos

    /** Instante entero en ms desde el inicio del turno. Puede lanzar si el reloj lanza: lo llaman métodos ya envueltos. */
    private ahora(): number {
        return Math.max(0, Math.round(this.reloj() - this.t0));
    }

    private fallo(e: unknown): void {
        this.incompleto = true;
        if (this.avisado) return;
        this.avisado = true;
        const motivo = e instanceof Error ? e.message : String(e);
        this.logger.warn(`No se pudo medir el turno ${this.mensajeId ?? 'sin mensaje'}: ${motivo}`);
    }

    private seguro<T>(f: () => T, porDefecto: T): T {
        try {
            return f();
        } catch (e) {
            this.fallo(e);
            return porDefecto;
        }
    }

    private nombre(n: string): string {
        return this.conocidas.has(n) ? n : 'otra';
    }

    // ---------------------------------------------------------------- servicio

    /** Marca una parte del servicio (`topes`, `historial`, `contexto`, `guardar`) y devuelve quien la termina. */
    parte(tipo: ParteServicio): () => void {
        return this.seguro(() => this.abrirParte(this.partes, tipo), PARTE_NULA);
    }

    private abrirParte(destino: RegistroParte[], tipo: string): () => void {
        const p: RegistroParte = { tipo, desde: this.ahora(), hasta: null };
        destino.push(p);
        return () =>
            this.seguro(() => {
                if (p.hasta === null) p.hasta = Math.max(p.desde, this.ahora());
            }, undefined);
    }

    /** Marca el primer texto que sale al navegador (la primera vez; las siguientes no cambian nada). */
    marcarPrimerTexto(): void {
        this.seguro(() => {
            if (this.primerTexto === null) this.primerTexto = this.ahora();
        }, undefined);
    }

    motivo(m: MotivoFin | null): void {
        this.seguro(() => {
            this.motivoFin = m;
        }, undefined);
    }

    // ---------------------------------------------------------------- llamadas

    llamada(iteracion: number): TrazaLlamada {
        return this.seguro(() => {
            const ahora = this.ahora();
            // La preparación termina donde empieza la primera llamada: el armado del contexto se cierra acá.
            for (const p of this.partes) if (p.tipo === 'contexto' && p.hasta === null) p.hasta = Math.max(p.desde, ahora);
            const r: RegistroLlamada = {
                orden: this.orden++,
                numero: iteracion + 1,
                desde: ahora,
                tStream: null,
                tConexion: null,
                tPrimerEvento: null,
                bloques: [],
                hasta: null,
                cierre: null,
                tope: null,
            };
            this.llamadas.push(r);
            return this.medidorDeLlamada(r);
        }, LLAMADA_NULA);
    }

    private medidorDeLlamada(r: RegistroLlamada): TrazaLlamada {
        const cerrada = () => r.cierre !== null || r.tope !== null;
        const primerEvento = () => {
            if (r.tPrimerEvento === null) r.tPrimerEvento = this.ahora();
        };
        return {
            stream: () =>
                this.seguro(() => {
                    if (r.tStream === null) r.tStream = this.ahora();
                }, undefined),
            evento: (e) =>
                this.seguro(() => {
                    if (cerrada()) return;
                    switch (e.tipo) {
                        case 'conexion':
                            if (r.tConexion === null) r.tConexion = this.ahora();
                            return;
                        case 'inicio_mensaje':
                        case 'fin_mensaje':
                            return primerEvento();
                        case 'inicio_bloque': {
                            primerEvento();
                            const b: BloqueRegistro = {
                                indice: e.indice,
                                tipo: e.bloque,
                                inicio: this.ahora(),
                                fin: null,
                                ...(e.bloque === 'tool_use' ? { herramienta: this.nombre(e.herramienta ?? '') } : {}),
                            };
                            r.bloques.push(b);
                            return;
                        }
                        case 'fin_bloque': {
                            const b = [...r.bloques].reverse().find((x) => x.indice === e.indice && x.fin === null);
                            if (b) b.fin = this.ahora();
                            return;
                        }
                    }
                }, undefined),
            finStream: () =>
                this.seguro(() => {
                    if (r.hasta === null) r.hasta = Math.max(r.desde, this.ahora());
                }, undefined),
            cerrar: (c) =>
                this.seguro(() => {
                    if (cerrada()) return;
                    if (r.hasta === null) r.hasta = Math.max(r.desde, this.ahora());
                    r.cierre = c;
                }, undefined),
            cortadaPorTope: (codigo) =>
                this.seguro(() => {
                    if (cerrada()) return;
                    r.hasta = Math.max(r.desde, this.ahora());
                    r.tope = codigo;
                }, undefined),
        };
    }

    // ---------------------------------------------------------------- herramientas

    herramienta(nombre: string, recurso?: RecursoHerramienta): TrazaHerramienta {
        return this.seguro(() => {
            const nombreSeguro = this.nombre(nombre);
            const rec = recurso ?? RECURSO_HERRAMIENTA[nombreSeguro];
            const h: RegistroHerramienta = {
                orden: this.orden++,
                nombre: nombreSeguro,
                ...(rec ? { recurso: rec } : {}),
                desde: this.ahora(),
                hasta: null,
                cierre: null,
                partes: [],
            };
            this.herramientas.push(h);
            return this.medidorDeHerramienta(h);
        }, HERRAMIENTA_NULA);
    }

    private medidorDeHerramienta(h: RegistroHerramienta): TrazaHerramienta {
        return {
            parte: (tipo) => this.seguro(() => this.abrirParte(h.partes, tipo), PARTE_NULA),
            describir: (p) =>
                this.seguro(() => {
                    // 160 caracteres por code points, como el título de la Fase A.
                    h.descripcion = Array.from(String(p.texto)).slice(0, 160).join('');
                    h.estado = p.estado;
                }, undefined),
            cerrar: (r) =>
                this.seguro(() => {
                    if (h.hasta !== null) return;
                    h.hasta = Math.max(h.desde, this.ahora());
                    h.cierre = { esError: r.esError, caracteres: Number.isFinite(r.caracteresResultado) ? Math.max(0, Math.floor(r.caracteresResultado)) : 0 };
                }, undefined),
        };
    }

    // ---------------------------------------------------------------- armado

    /**
     * El detalle del turno. Puro respecto del turno (no cambia el estado) y nunca lanza: ante un fallo devuelve un detalle
     * mínimo con `incompleto: true`. Lo que haya quedado abierto se cierra acá con `cortado`.
     */
    armar(a: { estado: DetalleRespuesta['estado'] }): DetalleRespuesta {
        try {
            return armarDetalle({
                funcion: this.o.funcion,
                modelo: this.o.modelo,
                precio: this.o.precio ?? null,
                ahora: this.ahora(),
                estado: a.estado,
                motivo: this.motivoFin,
                primerTextoMs: this.primerTexto,
                incompleto: this.incompleto,
                partes: this.partes,
                llamadas: this.llamadas,
                herramientas: this.herramientas,
            });
        } catch (e) {
            this.fallo(e);
            return {
                version: 1,
                funcion: this.o.funcion,
                modelo: this.o.modelo,
                estado: a.estado,
                motivo: this.motivoFin,
                totalMs: 0,
                primerTextoMs: this.primerTexto,
                costoUsd: 0,
                llamadas: 0,
                nodos: [],
                parcial: false,
                incompleto: true,
                recortado: false,
                navegador: null,
            };
        }
    }
}
