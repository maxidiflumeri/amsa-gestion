import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ConversacionesService } from './conversaciones.service';
import { PreguntarDto } from './dto/preguntar.dto';
import { EventoSse } from './dto/asistente.tipos';
import { MedicionService } from './medicion.service';
import { AsistenteModeloService } from './modelo/asistente-modelo.service';
import { MENSAJE_INTERNO } from './turno/errores';
import { LlamadaRegistro, PuertoMedicion, ResultadoTurno, TurnoRunner } from './turno/turno-runner';
import { TopesService } from './topes.service';
import { TurnosActivos } from './turnos-activos';
import { WikiIndiceService } from './wiki/wiki-indice.service';
import { CLIENTE_MODELO } from './modelo/cliente-modelo';
import type { ClienteModelo } from './modelo/cliente-modelo';

export const FUNCION_AYUDA = 'ayuda';
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

    constructor(
        private readonly prisma: PrismaService,
        private readonly topes: TopesService,
        private readonly medicion: MedicionService,
        private readonly conversaciones: ConversacionesService,
        private readonly wiki: WikiIndiceService,
        private readonly modelo: AsistenteModeloService,
        private readonly turnos: TurnosActivos,
        @Inject(CLIENTE_MODELO) cliente: ClienteModelo,
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

    async preparar(u: UsuarioJwt, dto: PreguntarDto): Promise<TurnoPreparado> {
        const ac = this.turnos.tomar(u.sub);
        if (!ac) {
            this.logger.warn(`Pregunta rechazada: ya hay un turno en curso (usuario=${u.sub})`);
            throw new ConflictException({
                codigo: 'TURNO_EN_CURSO',
                mensaje: 'Ya tenés una pregunta en curso. Esperá a que termine.',
            });
        }
        try {
            const limite = await this.topes.verificarInicio(u.sub, FUNCION_AYUDA);
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
                funcion: FUNCION_AYUDA,
            });
            const permisos = Array.isArray(u.permisos) ? u.permisos : [];
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
                        creado,
                        emitir,
                        entrada: { pregunta: dto.pregunta, ruta: dto.ruta, persona: { nombre, rol, permisos } },
                    }),
            };
        } catch (e) {
            this.turnos.liberar(u.sub, ac);
            throw e;
        }
    }

    private async ejecutar(p: {
        ac: AbortController;
        usuarioId: number;
        creado: Awaited<ReturnType<ConversacionesService['crearTurno']>>;
        emitir: (e: EventoSse) => void;
        entrada: { pregunta: string; ruta: string; persona: { nombre: string; rol: string; permisos: string[] } };
    }): Promise<void> {
        const { creado, emitir } = p;
        const t0 = Date.now();
        // Nunca se loguea el texto de la pregunta ni de la respuesta: pueden traer datos personales.
        this.logger.log(
            `Turno asistente iniciado: usuario=${p.usuarioId} conversacion=${creado.conversacionId} mensaje=${creado.mensajeId}`,
        );
        try {
            const resultado: ResultadoTurno = await this.runner.correr({
                funcion: FUNCION_AYUDA,
                pregunta: p.entrada.pregunta,
                ruta: p.entrada.ruta,
                persona: p.entrada.persona,
                ahora: new Date(),
                historial: creado.historial,
                ultimoPromptTokens: creado.ultimoPromptTokens,
                ids: { usuarioId: p.usuarioId, conversacionId: creado.conversacionId, mensajeId: creado.mensajeId },
                signal: p.ac.signal,
                emitir,
            });
            await this.conversaciones.finalizarTurno({
                conversacionId: creado.conversacionId,
                mensajeUsuarioId: creado.mensajeUsuarioId,
                mensajeId: creado.mensajeId,
                resultado,
            });
            this.logger.log(
                `Turno asistente ${creado.mensajeId} terminado estado=${resultado.estado} llamadas=${resultado.llamadas} ` +
                    `costo=$${resultado.costoUsd.toFixed(4)} en ${Date.now() - t0}ms`,
            );
            if (resultado.estado === 'error') {
                emitir({
                    evento: 'error',
                    data: {
                        codigo: resultado.error?.codigo ?? 'INTERNO',
                        mensaje: resultado.error?.mensaje ?? MENSAJE_INTERNO,
                        mensajeId: creado.mensajeId,
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
                        ms: resultado.ms,
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
            emitir({ evento: 'error', data: { codigo: 'INTERNO', mensaje: MENSAJE_INTERNO, mensajeId: creado.mensajeId } });
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
