import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CatalogoService } from '../reportes/catalogo/catalogo.service';
import { AdjuntosService } from './adjuntos/adjuntos.service';
import { DatosAdicionalesService } from './reportes/datos-adicionales.service';
import { FUNCION_REPORTES, MENSAJE_SIN_PERMISO_FUNCION, PERMISOS_REPORTES, mensajeFuncionDistinta } from './reportes/funcion-reportes';
import { catalogoCompacto, nodosVisibles } from './reportes/prompt/catalogo-compacto';
import { PropuestasService } from './reportes/propuestas.service';
import { PruebaPropuestaService } from './reportes/prueba-propuesta.service';
import { CAPACIDADES_TODAS } from './reportes/tipos-reportes';
import { TurnoReportesRunner } from './reportes/turno-reportes.runner';
import { VocabulariosService } from './reportes/vocabularios.service';
import { ConversacionesService } from './conversaciones.service';
import { PreguntarDto } from './dto/preguntar.dto';
import { DetalleRespuesta, EventoSse, FuncionClave, PERMISO_VER_DETALLE, Paso, PrecioModelo, TarjetaPropuesta } from './dto/asistente.tipos';
import { MedicionService } from './medicion.service';
import { AsistenteModeloService } from './modelo/asistente-modelo.service';
import { recortarDetalle, resumenParaLog } from './turno/detalle';
import { MENSAJE_INTERNO } from './turno/errores';
import { TrazaTurno } from './turno/traza';
import { LlamadaRegistro, PuertoMedicion, ResultadoTurno, TurnoRunner } from './turno/turno-runner';
import { TopesService } from './topes.service';
import { TurnosActivos } from './turnos-activos';
import { WikiIndiceService } from './wiki/wiki-indice.service';
import { CLIENTE_MODELO } from './modelo/cliente-modelo';
import type { ClienteModelo } from './modelo/cliente-modelo';

export const FUNCION_AYUDA = 'ayuda';
/** La lista cerrada de herramientas de cada función: el detalle guarda 'otra' para cualquier nombre que no esté. */
const HERRAMIENTAS_AYUDA = ['leer_pagina', 'buscar_en_wiki', 'ofrecer_ir_a'] as const;
const HERRAMIENTAS_REPORTES = ['valores_de_campo', 'datos_adicionales', 'ver_otra_hoja', 'probar_plantilla', 'mostrar_propuesta'] as const;
export const MAX_TOKENS_CONTEXTO_DEFAULT = 60_000;

export interface UsuarioJwt {
    sub: number;
    permisos?: string[];
}

/** Un turno aceptado: ya está guardado y tiene el turno de la persona tomado. */
export interface TurnoPreparado {
    inicio: Extract<EventoSse, { evento: 'inicio' }>['data'];
    /** Corta el stream de Bedrock (el cliente cerró la conexión o tocó "Detener"). */
    abortar(): void;
    /** Corre el turno y emite `fin` o `error`. Nunca rechaza y siempre libera el turno de la persona. */
    correr(emitir: (e: EventoSse) => void): Promise<void>;
}

/** Orquesta un turno: topes → guardar la pregunta → `TurnoRunner` → guardar la respuesta (docs/asistente-spec.md §3 y §7.4). */
@Injectable()
export class AsistenteService {
    private readonly logger = new Logger(AsistenteService.name);
    private readonly runner: TurnoRunner;
    private readonly medicionConAvisos: PuertoMedicion;
    /** El de la función de reportes se arma en el primer turno (necesita el catálogo). */
    private runnerReportes: Promise<TurnoReportesRunner> | null = null;

    constructor(
        private readonly prisma: PrismaService,
        private readonly topes: TopesService,
        private readonly medicion: MedicionService,
        private readonly conversaciones: ConversacionesService,
        private readonly wiki: WikiIndiceService,
        private readonly modelo: AsistenteModeloService,
        private readonly turnos: TurnosActivos,
        @Inject(CLIENTE_MODELO) private readonly cliente: ClienteModelo,
        // Fase B. Opcionales solo para que los tests de la ayuda no tengan que armarlos.
        @Optional() private readonly adjuntos?: AdjuntosService,
        @Optional() private readonly propuestas?: PropuestasService,
        @Optional() private readonly vocabularios?: VocabulariosService,
        @Optional() private readonly datosAdicionales?: DatosAdicionalesService,
        @Optional() private readonly prueba?: PruebaPropuestaService,
        @Optional() private readonly catalogo?: CatalogoService,
    ) {
        const medicionConAvisos: PuertoMedicion = {
            registrarLlamada: async (l: LlamadaRegistro) => {
                const costo = await this.medicion.registrarLlamada(l);
                try {
                    await this.topes.evaluarAvisos();
                } catch (e: any) {
                    this.logger.warn(`No se pudieron evaluar los avisos de tope: ${e?.message}`);
                }
                return costo;
            },
        };
        this.medicionConAvisos = medicionConAvisos;
        this.runner = new TurnoRunner({
            cliente,
            wiki: this.wiki,
            topes: this.topes,
            medicion: medicionConAvisos,
            modelo: this.modelo.modelo,
            strict: this.modelo.soportaStrict,
            maxTokensContexto: leerMaxTokensContexto(),
        });
    }

    /** El runner de la función de reportes: catálogo entero, compacto, en el `system` cacheado. */
    private armarRunnerReportes(): Promise<TurnoReportesRunner> {
        if (!this.runnerReportes) {
            const p = (async () => {
                if (!this.catalogo || !this.vocabularios || !this.datosAdicionales || !this.prueba || !this.propuestas) {
                    throw new Error('La función de reportes del asistente no está configurada.');
                }
                const catalogo = await this.catalogo.getCatalogo('deudor', 3);
                const texto = catalogoCompacto(catalogo);
                const runner = new TurnoReportesRunner({
                    cliente: this.cliente,
                    topes: this.topes,
                    medicion: this.medicionConAvisos,
                    modelo: this.modelo.modeloPara(FUNCION_REPORTES),
                    strict: this.modelo.soportaStrict,
                    timeoutMs: this.modelo.timeoutReportesMs,
                    catalogo,
                    catalogoTexto: texto,
                    capacidades: CAPACIDADES_TODAS,
                    vocabularios: this.vocabularios,
                    datosAdicionales: this.datosAdicionales,
                    prueba: this.prueba,
                    propuestas: this.propuestas,
                });
                this.logger.log(
                    `Asistente reportes: system=${texto.length} caracteres, catálogo=${nodosVisibles(catalogo).length} campos, sha1=${createHash('sha1').update(texto).digest('hex').slice(0, 8)}`,
                );
                return runner;
            })();
            // Si falla (catálogo, configuración), el próximo turno lo reintenta.
            p.catch(() => {
                this.runnerReportes = null;
            });
            this.runnerReportes = p;
        }
        return this.runnerReportes;
    }

    async preparar(u: UsuarioJwt, dto: PreguntarDto): Promise<TurnoPreparado> {
        const ac = this.turnos.tomar(u.sub);
        // El turno se mide desde que llega el pedido (docs/asistente-detalle-spec.md §7.1). La función y el precio se completan
        // enseguida: el reloj no se toca.
        const traza = new TrazaTurno({ funcion: dto.funcion ?? FUNCION_AYUDA, modelo: this.modelo.modelo });
        if (!ac) {
            this.logger.warn(`Pregunta rechazada: ya hay un turno en curso (usuario=${u.sub})`);
            throw new ConflictException({
                codigo: 'TURNO_EN_CURSO',
                mensaje: 'Ya tenés una pregunta en curso. Esperá a que termine.',
            });
        }
        try {
            const funcion = await this.resolverFuncion(u.sub, dto);
            const permisos = Array.isArray(u.permisos) ? u.permisos : [];
            const modeloFuncion = this.modelo.modeloPara(funcion);
            traza.definir({
                funcion,
                modelo: modeloFuncion,
                precio: await this.precioParaDetalle(modeloFuncion),
                herramientas: funcion === FUNCION_REPORTES ? HERRAMIENTAS_REPORTES : HERRAMIENTAS_AYUDA,
            });
            if (funcion === FUNCION_REPORTES && !PERMISOS_REPORTES.every((p) => permisos.includes(p))) {
                const mensaje = MENSAJE_SIN_PERMISO_FUNCION;
                this.logger.warn(`Función de reportes sin permisos (usuario=${u.sub})`);
                throw new ForbiddenException({ codigo: 'SIN_PERMISO_FUNCION', mensaje, message: mensaje });
            }
            if (funcion === 'ayuda' && dto.adjuntos && dto.adjuntos.length > 0) {
                throw new BadRequestException({ codigo: 'ADJUNTO_INVALIDO', mensaje: 'Los archivos de ejemplo son del modo «Armar un reporte».', message: 'Los archivos de ejemplo son del modo «Armar un reporte».' });
            }
            const finTopes = traza.parte('topes');
            const limite = await this.topes.verificarInicio(u.sub, funcion);
            finTopes();
            const finHistorial = traza.parte('historial');
            const persona = await this.prisma.usuario.findUnique({
                where: { id: u.sub },
                select: { nombre: true, rol: true, rolObj: { select: { nombre: true } } },
            });
            const creado = await this.conversaciones.crearTurno({
                usuarioId: u.sub,
                conversacionId: dto.conversacionId,
                pregunta: dto.pregunta,
                ruta: dto.ruta,
                versionWiki: this.wiki.version,
                funcion,
                ...(funcion === FUNCION_REPORTES ? { adjuntoIds: dto.adjuntos ?? [] } : {}),
            });
            finHistorial();
            traza.mensajeId = creado.mensajeId;
            const nombre = (persona?.nombre ?? '').trim().split(/\s+/)[0] || 'Usuario';
            const rol = persona?.rolObj?.nombre ?? persona?.rol ?? 'usuario';

            return {
                inicio: {
                    conversacionId: creado.conversacionId,
                    mensajeUsuarioId: creado.mensajeUsuarioId,
                    mensajeId: creado.mensajeId,
                    limiteDiario: limite,
                },
                abortar: () => ac.abort(),
                correr: (emitir) =>
                    this.ejecutar({
                        ac,
                        usuarioId: u.sub,
                        funcion,
                        creado,
                        emitir,
                        traza,
                        verDetalle: permisos.includes(PERMISO_VER_DETALLE),
                        entrada: { pregunta: dto.pregunta, ruta: dto.ruta, persona: { nombre, rol, permisos } },
                    }),
            };
        } catch (e) {
            this.turnos.liberar(u.sub, ac);
            throw e;
        }
    }

    /** El precio para repartir el costo en el detalle. Si no se puede leer, el detalle va sin costos adentro (nunca falla el turno). */
    private async precioParaDetalle(modelo: string): Promise<PrecioModelo | null> {
        try {
            return await this.medicion.precioDe(modelo);
        } catch (e: any) {
            this.logger.warn(`No se pudo leer el precio de ${modelo} para el detalle: ${e?.message}`);
            return null;
        }
    }

    /** `dto.funcion ?? la de la conversación ?? 'ayuda'`; una conversación es de una sola función. */
    private async resolverFuncion(usuarioId: number, dto: PreguntarDto): Promise<FuncionClave> {
        if (dto.conversacionId != null) {
            const deLaConversacion = await this.conversaciones.funcionDe(usuarioId, dto.conversacionId);
            if (deLaConversacion !== null) {
                if (dto.funcion && dto.funcion !== deLaConversacion) {
                    this.logger.warn(`Función distinta (conversación ${dto.conversacionId} es de ${deLaConversacion}, se pidió ${dto.funcion})`);
                    {
                        const mensaje = mensajeFuncionDistinta(deLaConversacion);
                        throw new ConflictException({ codigo: 'FUNCION_DISTINTA', mensaje, message: mensaje });
                    }
                }
                return deLaConversacion;
            }
        }
        return dto.funcion ?? 'ayuda';
    }

    private async correrReportes(
        p: { ac: AbortController; usuarioId: number; creado: Awaited<ReturnType<ConversacionesService['crearTurno']>>; emitir: (e: EventoSse) => void; traza: TrazaTurno; entrada: { pregunta: string; ruta: string; persona: { nombre: string; rol: string } } },
        ids: { usuarioId: number; conversacionId: number; mensajeId: number },
    ) {
        const runner = await this.armarRunnerReportes();
        const { creado } = p;
        const [ejemplos, ultima] = await Promise.all([
            this.adjuntos!.paraTurno(creado.conversacionId, creado.mensajeUsuarioId),
            this.propuestas!.ultimaMostrada(creado.conversacionId),
        ]);
        return runner.correr({
            pregunta: p.entrada.pregunta,
            ruta: p.entrada.ruta,
            persona: { nombre: p.entrada.persona.nombre, rol: p.entrada.persona.rol },
            ahora: new Date(),
            // Con los bloques de thinking tal cual: recortar invalidaría las firmas.
            previos: creado.historial.flatMap((t) => t.mensajes),
            esPrimerTurno: creado.esPrimerTurno,
            adjuntosNuevos: ejemplos.nuevos,
            ejemplos: ejemplos.ejemplos,
            principalId: ejemplos.principalId,
            ultimaPropuesta: ultima,
            ids,
            signal: p.ac.signal,
            emitir: p.emitir,
            traza: p.traza,
        });
    }

    /** Arma el detalle y lo guarda. Nunca lanza: medir y guardar el detalle no pueden romper una respuesta. */
    private async guardarDetalle(traza: TrazaTurno, mensajeId: number, estado: DetalleRespuesta['estado']): Promise<DetalleRespuesta | undefined> {
        let detalle: DetalleRespuesta;
        try {
            detalle = recortarDetalle(traza.armar({ estado }));
        } catch (e: any) {
            this.logger.warn(`No se pudo armar el detalle del mensaje ${mensajeId}: ${e?.message}`);
            return undefined;
        }
        const t = Date.now();
        try {
            await this.conversaciones.guardarTraza(mensajeId, detalle);
            this.logger.debug(`Detalle del mensaje ${mensajeId} guardado: ${JSON.stringify(detalle).length} bytes en ${Date.now() - t}ms`);
        } catch (e: any) {
            this.logger.warn(`No se pudo guardar el detalle del mensaje ${mensajeId}: ${e?.message}`);
        }
        return detalle;
    }

    private async ejecutar(p: {
        ac: AbortController;
        usuarioId: number;
        funcion: FuncionClave;
        creado: Awaited<ReturnType<ConversacionesService['crearTurno']>>;
        emitir: (e: EventoSse) => void;
        traza: TrazaTurno;
        verDetalle: boolean;
        entrada: { pregunta: string; ruta: string; persona: { nombre: string; rol: string; permisos: string[] } };
    }): Promise<void> {
        const { creado, traza } = p;
        const emitir = p.emitir;
        // El primer texto que sale al navegador (en reportes sale una sola vez, al final).
        const emitirMedido = (e: EventoSse) => {
            if (e.evento === 'texto') traza.marcarPrimerTexto();
            emitir(e);
        };
        const t0 = Date.now();
        const finContexto = traza.parte('contexto');
        // Nunca se loguea el texto de la pregunta ni de la respuesta: pueden traer datos personales.
        this.logger.log(
            `Turno asistente iniciado: usuario=${p.usuarioId} conversacion=${creado.conversacionId} mensaje=${creado.mensajeId}`,
        );
        try {
            const ids = { usuarioId: p.usuarioId, conversacionId: creado.conversacionId, mensajeId: creado.mensajeId };
            const resultado: ResultadoTurno & { pasos?: Paso[]; propuestas?: TarjetaPropuesta[] } =
                p.funcion === FUNCION_REPORTES
                    ? await this.correrReportes({ ...p, emitir: emitirMedido }, ids)
                    : await this.runner.correr({
                          funcion: FUNCION_AYUDA,
                          pregunta: p.entrada.pregunta,
                          ruta: p.entrada.ruta,
                          persona: p.entrada.persona,
                          ahora: new Date(),
                          historial: creado.historial,
                          ultimoPromptTokens: creado.ultimoPromptTokens,
                          ids,
                          signal: p.ac.signal,
                          emitir: emitirMedido,
                          traza,
                      });
            finContexto();
            const finGuardar = traza.parte('guardar');
            try {
                await this.conversaciones.finalizarTurno({
                    conversacionId: creado.conversacionId,
                    mensajeUsuarioId: creado.mensajeUsuarioId,
                    mensajeId: creado.mensajeId,
                    resultado,
                });
                if (resultado.propuestas && resultado.propuestas.length > 0 && this.propuestas) {
                    try {
                        await this.propuestas.asignarCosto(creado.mensajeId, resultado.costoUsd);
                    } catch (e: any) {
                        this.logger.warn(`No se pudo guardar el costo de la propuesta del mensaje ${creado.mensajeId}: ${e?.message}`);
                    }
                }
            } finally {
                finGuardar();
            }
            // El detalle se arma y se guarda SIEMPRE, tenga o no el permiso quien preguntó (Consumo mide a todos). Guardarlo es
            // una escritura aparte: si falla, la respuesta sale igual.
            const detalle = await this.guardarDetalle(traza, creado.mensajeId, resultado.estado);
            this.logger.log(
                `Turno asistente ${creado.mensajeId} terminado estado=${resultado.estado} llamadas=${resultado.llamadas} ` +
                    `costo=$${resultado.costoUsd.toFixed(4)} en ${Date.now() - t0}ms` +
                    (detalle ? ` ${resumenParaLog(detalle)}` : ''),
            );
            const conDetalle = p.verDetalle && detalle ? { detalle } : {};
            if (resultado.estado === 'error') {
                emitir({
                    evento: 'error',
                    data: {
                        codigo: resultado.error?.codigo ?? 'INTERNO',
                        mensaje: resultado.error?.mensaje ?? MENSAJE_INTERNO,
                        mensajeId: creado.mensajeId,
                        ...conDetalle,
                    },
                });
            } else {
                emitir({
                    evento: 'fin',
                    data: {
                        mensajeId: creado.mensajeId,
                        estado: resultado.estado,
                        texto: resultado.texto,
                        fuentes: resultado.fuentes,
                        acciones: resultado.acciones,
                        pasos: resultado.pasos ?? [],
                        propuestas: resultado.propuestas ?? [],
                        ms: resultado.ms,
                        ...conDetalle,
                    },
                });
            }
        } catch (e: any) {
            this.logger.error(`Turno asistente ${creado.mensajeId} falló: ${e?.message}`, e?.stack);
            try {
                await this.conversaciones.marcarError(creado.mensajeId);
            } catch (e2: any) {
                this.logger.error(`No se pudo marcar el mensaje ${creado.mensajeId} como error: ${e2?.message}`, e2?.stack);
            }
            traza.motivo('interno');
            const detalle = await this.guardarDetalle(traza, creado.mensajeId, 'error');
            emitir({
                evento: 'error',
                data: { codigo: 'INTERNO', mensaje: MENSAJE_INTERNO, mensajeId: creado.mensajeId, ...(p.verDetalle && detalle ? { detalle } : {}) },
            });
        } finally {
            this.turnos.liberar(p.usuarioId, p.ac);
        }
    }
}

function leerMaxTokensContexto(): number {
    const raw = process.env.ASISTENTE_MAX_TOKENS_CONTEXTO;
    const n = raw !== undefined && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
    return Number.isInteger(n) && n >= 5_000 ? n : MAX_TOKENS_CONTEXTO_DEFAULT;
}
