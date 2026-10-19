import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ExecutorService } from '../../reportes/executor/executor.service';
import { DefinicionPlantillaDto } from '../../reportes/dto/plantilla.dto';
import { PlantillaDesdeAsistente, TarjetaPropuesta, VistaPreviaPropuesta } from '../dto/asistente.tipos';
import { enmascararCelda } from './enmascarar';
import { hashDefinicion } from './hash-plantilla';
import { definicionParaPrueba, TIMEOUT_PREVIEW_MS, ESPERA_SEMAFORO_MS } from './prueba-propuesta.service';
import { SemaforoReportes } from './semaforo';
import { PuertoPropuestas } from './turno-reportes.runner';

type TarjetaGuardada = Omit<TarjetaPropuesta, 'propuestaId' | 'prueba' | 'estado' | 'plantillaId' | 'vigente'>;

interface FilaPropuesta {
    id: number;
    mensajeId: number;
    prueba: string;
    estado: string;
    plantillaId: number | null;
    tarjeta: Prisma.JsonValue;
}

/** Las propuestas del asistente: mostrarlas, abrirlas en el editor, la vista previa enmascarada y el vínculo al guardar. */
@Injectable()
export class PropuestasService implements PuertoPropuestas {
    private readonly logger = new Logger(PropuestasService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly executor: ExecutorService,
        private readonly semaforo: SemaforoReportes,
    ) {}

    private aTarjeta(f: FilaPropuesta, vigenteId: number | null): TarjetaPropuesta {
        const t = f.tarjeta as unknown as TarjetaGuardada;
        return {
            ...t,
            propuestaId: f.id,
            prueba: f.prueba,
            estado: f.estado as TarjetaPropuesta['estado'],
            plantillaId: f.plantillaId,
            vigente: vigenteId === f.id,
        };
    }

    async mostrar(a: { conversacionId: number | null; prueba: string; mensaje: string; sugerencias: string[] }): Promise<TarjetaPropuesta | null> {
        if (a.conversacionId === null) return null;
        const fila = await this.prisma.asistente_propuesta.findUnique({
            where: { conversacionId_prueba: { conversacionId: a.conversacionId, prueba: a.prueba } },
        });
        if (!fila) return null;
        // La versión es correlativa entre las propuestas mostradas de la conversación.
        const previas = await this.prisma.asistente_propuesta.count({ where: { conversacionId: a.conversacionId, estado: { not: 'probada' } } });
        const t = fila.tarjeta as unknown as TarjetaGuardada;
        const tarjeta: TarjetaGuardada = { ...t, version: t.version > 0 ? t.version : previas + 1, mensaje: a.mensaje, sugerencias: a.sugerencias };
        const actualizada = await this.prisma.asistente_propuesta.update({
            where: { id: fila.id },
            data: { tarjeta: tarjeta as unknown as Prisma.InputJsonValue, estado: fila.estado === 'probada' ? 'mostrada' : fila.estado },
        });
        return this.aTarjeta(actualizada, actualizada.id);
    }

    /** Las tarjetas de una conversación (todas las mostradas), agrupadas por mensaje, con cuál es la vigente. */
    async tarjetasDeConversacion(conversacionId: number): Promise<Map<number, TarjetaPropuesta[]>> {
        const filas = await this.prisma.asistente_propuesta.findMany({
            where: { conversacionId, estado: { not: 'probada' } },
            orderBy: { id: 'asc' },
            select: { id: true, mensajeId: true, prueba: true, estado: true, plantillaId: true, tarjeta: true },
        });
        const vigenteId = filas.length ? filas[filas.length - 1].id : null;
        const porMensaje = new Map<number, TarjetaPropuesta[]>();
        for (const f of filas) {
            const lista = porMensaje.get(f.mensajeId) ?? [];
            lista.push(this.aTarjeta(f, vigenteId));
            porMensaje.set(f.mensajeId, lista);
        }
        return porMensaje;
    }

    /** La última propuesta mostrada: el modelo parte de ella para un ajuste. */
    async ultimaMostrada(conversacionId: number): Promise<{ prueba: string; nombre: string } | null> {
        const f = await this.prisma.asistente_propuesta.findFirst({
            where: { conversacionId, estado: { not: 'probada' } },
            orderBy: { id: 'desc' },
            select: { prueba: true, tarjeta: true },
        });
        return f ? { prueba: f.prueba, nombre: String((f.tarjeta as unknown as TarjetaGuardada).nombre ?? '') } : null;
    }

    /** Al terminar el turno: el costo de la propuesta mostrada (para "costo por guardada"). */
    async asignarCosto(mensajeId: number, costoUsd: number): Promise<void> {
        await this.prisma.asistente_propuesta.updateMany({ where: { mensajeId, estado: { not: 'probada' } }, data: { costoUsd } });
    }

    private async propia(usuarioId: number, id: number, mostrada = true) {
        const f = await this.prisma.asistente_propuesta.findFirst({
            where: { id, usuarioId, ...(mostrada ? { estado: { in: ['mostrada', 'abierta', 'guardada'] } } : {}) },
        });
        if (!f) {
            this.logger.warn(`Propuesta ${id} inexistente, ajena o nunca mostrada (usuario=${usuarioId})`);
            throw new NotFoundException('No encontramos esa propuesta.');
        }
        return f;
    }

    /** `GET /asistente/propuestas/:id/plantilla`: lo que carga el editor. Marca `abierta` si estaba `mostrada`. */
    async plantillaDe(usuarioId: number, id: number): Promise<PlantillaDesdeAsistente> {
        const f = await this.propia(usuarioId, id);
        if (f.estado === 'mostrada') {
            await this.prisma.asistente_propuesta.update({ where: { id }, data: { estado: 'abierta' } });
            this.logger.log(`Propuesta ${id} abierta en el editor (usuario=${usuarioId})`);
        }
        const p = f.plantilla as unknown as Omit<PlantillaDesdeAsistente, 'asistentePropuestaId'>;
        return { ...p, asistentePropuestaId: id };
    }

    /** `GET /asistente/propuestas/:id/vista-previa`: las primeras filas, enmascaradas. NO se guardan. */
    async vistaPrevia(usuarioId: number, id: number, filas = 5): Promise<VistaPreviaPropuesta> {
        const f = await this.propia(usuarioId, id);
        const plantilla = f.plantilla as unknown as { definicion: { columnas: { label: string; path: string; tipo?: string; separadorConcat?: string }[] } & Record<string, unknown> };
        const casos = (f.tarjeta as unknown as TarjetaGuardada).casos ?? null;
        const columnas = plantilla.definicion.columnas;
        const vacia = (error: 'TIMEOUT' | 'FALLO'): VistaPreviaPropuesta => ({ columnas: columnas.map((c) => c.label), filas: [], casos, error });

        const liberar = await this.semaforo.adquirir(ESPERA_SEMAFORO_MS);
        if (!liberar) return vacia('TIMEOUT');
        const t0 = Date.now();
        try {
            const def = definicionParaPrueba(plantilla.definicion as never) as DefinicionPlantillaDto;
            let timer: NodeJS.Timeout | undefined;
            const espera = new Promise<'timeout'>((r) => {
                timer = setTimeout(() => r('timeout'), TIMEOUT_PREVIEW_MS);
            });
            const ejecucion = this.executor.execute(def, 'deudor', {}, true);
            const r = await Promise.race([ejecucion, espera]).finally(() => clearTimeout(timer));
            if (r === 'timeout') {
                ejecucion.catch(() => undefined);
                return vacia('TIMEOUT');
            }
            const n = Math.min(Math.max(filas, 1), 10);
            const salida = (r.filas as Record<string, unknown>[]).slice(0, n).map((fila) => {
                const o: Record<string, string> = {};
                for (const c of columnas) o[c.label] = enmascararCelda(c.path, fila[c.label], c.tipo, c.separadorConcat);
                return o;
            });
            this.logger.log(`Vista previa de la propuesta ${id}: ${salida.length} filas en ${Date.now() - t0}ms`);
            return { columnas: columnas.map((c) => c.label), filas: salida, casos };
        } catch (e: any) {
            this.logger.error(`Falló la vista previa de la propuesta ${id}: ${e?.message}`, e?.stack);
            return vacia('FALLO');
        } finally {
            liberar();
        }
    }

    /**
     * Al guardar desde el editor con `asistentePropuestaId`: marca la propuesta `guardada` y compara el hash. Nunca falla el
     * alta: un id ajeno o inexistente es un `warn` y la plantilla queda creada igual.
     */
    async vincularGuardada(usuarioId: number, propuestaId: number | undefined, plantilla: { id: number; definicion: unknown }): Promise<void> {
        if (propuestaId === undefined || propuestaId === null) return;
        try {
            const f = await this.prisma.asistente_propuesta.findFirst({ where: { id: propuestaId, usuarioId } });
            if (!f) {
                this.logger.warn(`La plantilla ${plantilla.id} vino con una propuesta ajena o inexistente (${propuestaId}): no se vincula`);
                return;
            }
            const sinCambios = hashDefinicion(plantilla.definicion as Record<string, unknown>) === f.hash;
            await this.prisma.asistente_propuesta.update({
                where: { id: f.id },
                data: { estado: 'guardada', plantillaId: plantilla.id, guardadaSinCambios: sinCambios },
            });
            this.logger.log(`Propuesta ${f.id} guardada como plantilla ${plantilla.id} (sin cambios=${sinCambios})`);
        } catch (e: any) {
            this.logger.warn(`No se pudo vincular la propuesta ${propuestaId} con la plantilla ${plantilla.id}: ${e?.message}`);
        }
    }
}
