import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { EntidadTipo, TipoNotificacion } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { inicioDelDia, ymdLocal } from '../../common/utils/dia-local';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { AsistenteConfigService } from './asistente-config.service';
import { CodigoPausa, EstadoAsistente } from './dto/asistente.tipos';
import { MedicionService, mesLocal } from './medicion.service';
import { AsistenteModeloService } from './modelo/asistente-modelo.service';
import {
    MENSAJE_PAUSADO,
    MENSAJE_TOPE_FUNCION,
    MENSAJE_TOPE_MENSUAL,
    TopeError,
} from './turno/errores';
import { PuertoTopes } from './turno/turno-runner';
import { WikiIndiceService } from './wiki/wiki-indice.service';

type Pausa = { codigo: CodigoPausa; mensaje: string };

/** Interruptor, topes de gasto, límite diario y avisos al 80 y al 100 % (docs/asistente-spec.md §11.2 y §11.3). */
@Injectable()
export class TopesService implements PuertoTopes {
    private readonly logger = new Logger(TopesService.name);
    /** Avisos ya resueltos en este proceso (`2026-10:parcial`): evita un `updateMany` por llamada una vez cruzado el umbral. */
    private readonly avisosResueltos = new Set<string>();

    constructor(
        private readonly prisma: PrismaService,
        private readonly config: AsistenteConfigService,
        private readonly medicion: MedicionService,
        private readonly wiki: WikiIndiceService,
        private readonly modelo: AsistenteModeloService,
        private readonly notificaciones: NotificacionesService,
    ) {}

    /** El motivo por el que el asistente no puede responder ahora, o null. */
    async pausa(funcion: string): Promise<Pausa | null> {
        if (!this.wiki.disponible) {
            return { codigo: 'SIN_WIKI', mensaje: 'amaIA no tiene la documentación cargada. Avisale a un administrador.' };
        }
        const cfg = await this.config.leer();
        if (!cfg.habilitado) return { codigo: 'PAUSADO', mensaje: MENSAJE_PAUSADO };
        const fn = await this.config.funcion(funcion);
        if (!fn || !fn.habilitada) return { codigo: 'PAUSADO', mensaje: MENSAJE_PAUSADO };
        const modeloFuncion = this.modelo.modeloPara(funcion);
        if (!(await this.config.precioVigente(modeloFuncion))) {
            this.logger.error(`No hay precio configurado para el modelo ${modeloFuncion} (función ${funcion}): queda en pausa SIN_PRECIO`);
            return { codigo: 'SIN_PRECIO', mensaje: 'amaIA no tiene el precio del modelo cargado. Avisale a un administrador.' };
        }
        const gasto = await this.medicion.gastoDelMes();
        if (gasto.total >= cfg.topeMensualUsd) return { codigo: 'TOPE_MENSUAL', mensaje: MENSAJE_TOPE_MENSUAL };
        if (fn.topeMensualUsd !== null && (gasto.porFuncion[funcion] ?? 0) >= fn.topeMensualUsd) {
            return { codigo: 'TOPE_FUNCION', mensaje: MENSAJE_TOPE_FUNCION };
        }
        return null;
    }

    /** Preguntas que la persona ya hizo hoy (hora de Argentina), en todas las funciones o en una. */
    async preguntasDeHoy(usuarioId: number, funcion?: string): Promise<number> {
        return this.prisma.asistente_mensaje.count({
            where: {
                usuarioId,
                rol: 'usuario',
                createdAt: { gte: inicioDelDia(ymdLocal()) },
                ...(funcion ? { conversacion: { funcion } } : {}),
            },
        });
    }

    /** El límite diario propio de la función (lo configurado o el de código), o null si no tiene. */
    private async limiteDeLaFuncion(funcion: string): Promise<number | null> {
        return (await this.config.funcion(funcion))?.limiteDiarioUsuario ?? null;
    }

    async estado(usuarioId: number, funcion = 'ayuda'): Promise<EstadoAsistente> {
        const [pausa, cfg, propio] = await Promise.all([this.pausa(funcion), this.config.leer(), this.limiteDeLaFuncion(funcion)]);
        const usadas = await this.preguntasDeHoy(usuarioId, propio !== null ? funcion : undefined);
        return { habilitado: pausa === null, pausa, limiteDiario: { usadas, limite: propio ?? cfg.limiteDiarioUsuario } };
    }

    /**
     * Antes de aceptar una pregunta. Lanza 429 con el `codigo` (PAUSADO, TOPE_FUNCION, TOPE_MENSUAL o LIMITE_DIARIO), o 503 si
     * falta configuración (SIN_WIKI, SIN_PRECIO). Devuelve cuántas preguntas
     * lleva hoy, contando la que entra.
     */
    async verificarInicio(usuarioId: number, funcion: string): Promise<{ usadas: number; limite: number }> {
        const pausa = await this.pausa(funcion);
        if (pausa) {
            this.logger.warn(`Pregunta rechazada por pausa ${pausa.codigo} (usuario=${usuarioId})`);
            // Si el tope se bajó por debajo de lo gastado, ninguna llamada va a disparar el aviso: lo dispara este rechazo.
            if (pausa.codigo === 'TOPE_MENSUAL') await this.evaluarAvisosSinRomper();
            // `message` además de `mensaje`: es lo que muestra el LoggingInterceptor en el log (sin él dice "Http Exception").
            // 429 y no 503: es una decisión de negocio, no una falla del servidor. Con 503 cada rechazo se logueaba como
            // error con stack y sumaba a la alarma de 5xx del ALB. El frontend decide por `codigo`.
            // SIN_WIKI y SIN_PRECIO sí son fallas de configuración: siguen en 503 y tienen que alarmar.
            const deNegocio = pausa.codigo === 'PAUSADO' || pausa.codigo === 'TOPE_MENSUAL' || pausa.codigo === 'TOPE_FUNCION';
            throw new HttpException(
                { codigo: pausa.codigo, mensaje: pausa.mensaje, message: pausa.mensaje },
                deNegocio ? HttpStatus.TOO_MANY_REQUESTS : HttpStatus.SERVICE_UNAVAILABLE,
            );
        }
        const cfg = await this.config.leer();
        const propio = await this.limiteDeLaFuncion(funcion);
        if (propio !== null) {
            const deLaFuncion = await this.preguntasDeHoy(usuarioId, funcion);
            if (deLaFuncion >= propio) {
                this.logger.warn(`Límite diario de la función ${funcion} alcanzado (usuario=${usuarioId}, ${deLaFuncion}/${propio})`);
                const mensaje =
                    funcion === 'reportes'
                        ? `Llegaste al límite de ${propio} pedidos de reportes de hoy. Mañana se renueva.`
                        : `Llegaste al límite de ${propio} preguntas de hoy. Mañana se renueva.`;
                // `LIMITE_FUNCION` y no `LIMITE_DIARIO`: el panel tiene que poder decir cuál de los dos se alcanzó.
                throw new HttpException(
                    { codigo: 'LIMITE_FUNCION', mensaje, message: mensaje, usadas: deLaFuncion, limite: propio, funcion },
                    HttpStatus.TOO_MANY_REQUESTS,
                );
            }
        }
        const hechas = await this.preguntasDeHoy(usuarioId);
        if (hechas >= cfg.limiteDiarioUsuario) {
            this.logger.warn(`Límite diario alcanzado (usuario=${usuarioId}, ${hechas}/${cfg.limiteDiarioUsuario})`);
            throw new HttpException(
                {
                    codigo: 'LIMITE_DIARIO',
                    mensaje: `Llegaste al límite de ${cfg.limiteDiarioUsuario} preguntas de hoy. Mañana se renueva.`,
                    message: `Llegaste al límite de ${cfg.limiteDiarioUsuario} preguntas de hoy. Mañana se renueva.`,
                    usadas: hechas,
                    limite: cfg.limiteDiarioUsuario,
                },
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }
        if (propio !== null) return { usadas: (await this.preguntasDeHoy(usuarioId, funcion)) + 1, limite: propio };
        return { usadas: hechas + 1, limite: cfg.limiteDiarioUsuario };
    }

    /** Antes de cada llamada al modelo de un turno. */
    async verificarIteracion(funcion: string, costoTurno: number): Promise<void> {
        const cfg = await this.config.leer();
        const gasto = await this.medicion.gastoDelMes();
        if (gasto.total >= cfg.topeMensualUsd) throw new TopeError('TOPE_MENSUAL', MENSAJE_TOPE_MENSUAL);
        const fn = await this.config.funcion(funcion);
        if (fn?.topeMensualUsd != null && (gasto.porFuncion[funcion] ?? 0) >= fn.topeMensualUsd) {
            throw new TopeError('TOPE_FUNCION', MENSAJE_TOPE_FUNCION);
        }
        // El tope por turno de la función (reportes: USD 0,30); si no tiene, el global.
        const topeTurno = fn?.topeTurnoUsd ?? cfg.topeTurnoUsd;
        if (costoTurno > 0 && costoTurno >= topeTurno) {
            throw new TopeError('TOPE_TURNO', 'El turno llegó a su tope de gasto.');
        }
    }

    /** Para quien ya está respondiendo otra cosa: un aviso que falla no tiene que romperlo. */
    async evaluarAvisosSinRomper(): Promise<void> {
        try {
            await this.evaluarAvisos();
        } catch (e: any) {
            this.logger.warn(`No se pudieron evaluar los avisos de tope: ${e?.message}`);
        }
    }

    /**
     * Después de cada llamada registrada: avisa al 80 % y al 100 % del tope, una vez por mes. El `updateMany`
     * condicional hace que gane un solo proceso aunque haya llamadas simultáneas.
     */
    async evaluarAvisos(): Promise<void> {
        const cfg = await this.config.leer();
        if (cfg.topeMensualUsd <= 0) return;
        const gasto = await this.medicion.gastoDelMes();
        const mes = mesLocal();

        if (gasto.total >= (cfg.topeMensualUsd * cfg.avisoPorcentaje) / 100 && !this.avisosResueltos.has(`${mes}:parcial`)) {
            const r = await this.prisma.asistente_config.updateMany({
                where: { id: 1, OR: [{ avisoParcialMes: null }, { avisoParcialMes: { not: mes } }] },
                data: { avisoParcialMes: mes },
            });
            this.avisosResueltos.add(`${mes}:parcial`);
            if (r.count === 1) {
                await this.notificar(
                    `amaIA usó el ${cfg.avisoPorcentaje} % del tope del mes`,
                    `Gastó USD ${gasto.total.toFixed(2)} de USD ${cfg.topeMensualUsd.toFixed(2)}. Al llegar al tope se pausa para todos.`,
                    cfg.avisoPorcentaje,
                );
            }
        }
        if (gasto.total >= cfg.topeMensualUsd && !this.avisosResueltos.has(`${mes}:tope`)) {
            const r = await this.prisma.asistente_config.updateMany({
                where: { id: 1, OR: [{ avisoTopeMes: null }, { avisoTopeMes: { not: mes } }] },
                data: { avisoTopeMes: mes },
            });
            this.avisosResueltos.add(`${mes}:tope`);
            if (r.count === 1) {
                await this.notificar(
                    'amaIA llegó al tope del mes y se pausó',
                    `Gastó USD ${gasto.total.toFixed(2)} y el tope es USD ${cfg.topeMensualUsd.toFixed(2)}. Vuelve el 1.º o cuando subas el tope.`,
                    100,
                );
            }
        }
    }

    private async notificar(titulo: string, mensaje: string, porcentaje: number): Promise<void> {
        const admins = await this.config.administradoresActivos();
        if (admins.length === 0) {
            this.logger.warn(`Nadie activo tiene asistente.administrar: el aviso del ${porcentaje} % no le llega a nadie`);
            return;
        }
        this.logger.log(`Aviso del ${porcentaje} % del tope del asistente a ${admins.length} administradores`);
        // Una vez por destinatario: así a todos les sale el aviso emergente (las copias por permiso no lo generan).
        for (const id of admins) {
            await this.notificaciones.crear({
                tipo: TipoNotificacion.SISTEMA,
                entidadTipo: EntidadTipo.GENERICO,
                titulo,
                mensaje,
                rutaAccion: '/asistente/consumo',
                destinatarioPrincipalId: id,
            });
        }
    }
}
