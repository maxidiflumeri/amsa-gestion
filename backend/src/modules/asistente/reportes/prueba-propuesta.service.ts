import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AsyncExecutorService } from '../../reportes/async/async-executor.service';
import { ExecutorService } from '../../reportes/executor/executor.service';
import { DefinicionPlantillaDto } from '../../reportes/dto/plantilla.dto';
import { PathParser } from '../../reportes/parser/path-parser';
import { hashDefinicion } from './hash-plantilla';
import { SemaforoReportes } from './semaforo';
import { PlantillaNormalizada } from './tipos-reportes';
import { PuertoPrueba, ResultadoPrueba, TarjetaBase } from './turno-reportes.runner';

/**
 * La prueba contra la base (docs/asistente-reportes-spec.md §7.6): corre la preview (100 casos) y cuenta los de la consulta
 * completa. De acá al modelo salen SOLO cantidades. Semáforo de 2 pruebas a la vez y timeouts.
 */

export const TIMEOUT_PREVIEW_MS = 20_000;
export const TIMEOUT_CONTEO_MS = 15_000;
export const ESPERA_SEMAFORO_MS = 30_000;
const UMBRAL_SYNC = Number(process.env.REPORTES_SYNC_THRESHOLD || '5000');
const HARD_LIMIT = Number(process.env.REPORTES_V2_HARD_LIMIT || '200000');

type Medido<T> = { ok: true; valor: T } | { ok: false; timeout: boolean; error?: unknown };

/** `Promise.race` no cancela la consulta en MySQL: termina sola. Es un riesgo aceptado, acotado por el semáforo. */
async function conTimeout<T>(p: Promise<T>, ms: number): Promise<Medido<T>> {
    let timer: NodeJS.Timeout | undefined;
    const vencido = new Promise<'timeout'>((r) => {
        timer = setTimeout(() => r('timeout'), ms);
    });
    try {
        const r = await Promise.race([p, vencido]);
        if (r === 'timeout') {
            p.catch(() => undefined);
            return { ok: false, timeout: true };
        }
        return { ok: true, valor: r as T };
    } catch (error) {
        return { ok: false, timeout: false, error };
    } finally {
        clearTimeout(timer);
    }
}

/** Termina una parte del detalle cuando la promesa se resuelve y deja pasar el resultado tal cual. Sin parte, no toca nada. */
function terminando<T>(p: Promise<T>, fin?: () => void): Promise<T> {
    return fin
        ? p.then((r) => {
              fin();
              return r;
          })
        : p;
}

const parser = new PathParser();

/** Los filtros variables sin valor por defecto no se aplican en la prueba: se sacan para que el conteo no los pida. */
export function definicionParaPrueba(def: PlantillaNormalizada['definicion']): DefinicionPlantillaDto {
    return {
        ...def,
        filtros: def.filtros.filter((f) => !(f.variable && f.valorPorDefecto === undefined)),
    } as unknown as DefinicionPlantillaDto;
}

/**
 * ¿El conteo es del `where` previo, sin los filtros que se aplican después de traer los datos? Pasa con un filtro sobre una
 * rama con selectores, salvo `[count]` contra 0 (que Prisma resuelve con some/none).
 */
export function conteoAproximado(def: PlantillaNormalizada['definicion']): boolean {
    for (const f of definicionParaPrueba(def).filtros ?? []) {
        let ast;
        try {
            ast = parser.parse(f.path);
        } catch {
            continue;
        }
        const mods = ast.segments.flatMap((s) => s.modifiers);
        if (mods.length === 0) continue;
        const esCuenta = mods.some((m) => m.type === 'aggregator' && m.aggregator === 'count');
        const cero = (f.operador === 'gt' || f.operador === 'eq') && Number(f.valor) === 0;
        if (esCuenta && cero) continue;
        return true;
    }
    return false;
}

function vacioEnMuestra(v: unknown): boolean {
    return v === null || v === undefined || v === '';
}

@Injectable()
export class PruebaPropuestaService implements PuertoPrueba {
    private readonly logger = new Logger(PruebaPropuestaService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly executor: ExecutorService,
        private readonly asyncExecutor: AsyncExecutorService,
        private readonly semaforo: SemaforoReportes,
    ) {}

    async probar(a: Parameters<PuertoPrueba['probar']>[0]): Promise<ResultadoPrueba | { tipo: 'ocupada' } | { tipo: 'fallo'; mensaje: string } | { tipo: 'rechazada'; problemas: string[] }> {
        const { normalizada: n, entrada } = a;
        const { conversacionId, usuarioId, mensajeId } = a.ids;
        if (conversacionId === null || usuarioId === null || mensajeId === null) throw new Error('La prueba necesita la conversación, la persona y el mensaje.');
        const t0 = Date.now();

        // Las partes del detalle (docs/asistente-detalle-spec.md §7.4): lo que tarda el semáforo, y la muestra y el conteo, que
        // corren a la vez. Sin `a.traza` no se toca nada.
        const finEspera = a.traza?.parte('espera_base');
        let liberar: (() => void) | null;
        try {
            liberar = await this.semaforo.adquirir(ESPERA_SEMAFORO_MS);
        } finally {
            finEspera?.();
        }
        if (!liberar) {
            this.logger.warn(`Prueba sin lugar en el semáforo (conversación ${conversacionId})`);
            return { tipo: 'ocupada' };
        }
        const def = definicionParaPrueba(n.definicion);
        let preview: Medido<Awaited<ReturnType<ExecutorService['execute']>>>;
        let conteo: Medido<number>;
        try {
            const finMuestra = a.traza?.parte('muestra');
            const finConteo = a.traza?.parte('conteo');
            [preview, conteo] = await Promise.all([
                terminando(conTimeout(this.executor.execute(def, 'deudor', {}, true), TIMEOUT_PREVIEW_MS), finMuestra),
                terminando(conTimeout(this.asyncExecutor.estimarFilas(def, 'deudor', {}), TIMEOUT_CONTEO_MS), finConteo),
            ]);
        } finally {
            liberar();
        }

        if (!preview.ok) {
            if (preview.timeout) {
                this.logger.warn(`Prueba sin respuesta de la base a tiempo (conversación ${conversacionId})`);
                return { tipo: 'ocupada' };
            }
            const err = preview.error as { status?: number; message?: string; stack?: string };
            if (err?.status && err.status >= 400 && err.status < 500) {
                this.logger.warn(`El motor rechazó una plantilla del asistente (conversación ${conversacionId}, ${err.status})`);
                return { tipo: 'fallo', mensaje: String(err.message ?? 'La plantilla no es válida para el motor.').slice(0, 300) };
            }
            this.logger.error(`Falló la prueba contra la base (conversación ${conversacionId}): ${err?.message}`, err?.stack);
            return { tipo: 'fallo', mensaje: 'Falló la consulta de prueba. No vuelvas a probar en esta respuesta; avisale a la persona.' };
        }

        const filas = preview.valor.filas as Record<string, unknown>[];
        const labels = n.definicion.columnas.map((c) => String(c.label));
        // Una columna fija vacía (sin_campo) es vacía a propósito: no se avisa.
        const conDato = n.definicion.columnas.filter((c) => String(c.path ?? '').trim() !== '').map((c) => String(c.label));
        const vacias = filas.length > 0 ? conDato.filter((l) => filas.every((f) => vacioEnMuestra(f[l]))) : [];
        const casos = conteo.ok ? conteo.valor : null;
        const aproximado = conteoAproximado(n.definicion);

        const avisos: string[] = [...a.avisosValidador];
        const problemas: string[] = [];
        if (vacias.length > 0) avisos.push(`${vacias.length === 1 ? 'La columna' : 'Las columnas'} ${vacias.map((v) => `«${v}»`).join(', ')} ${vacias.length === 1 ? 'salió vacía' : 'salieron vacías'} en toda la muestra.`);
        if (filas.length === 0 && (casos ?? 0) > 0) avisos.push('La muestra salió sin filas aunque la consulta completa trae casos: los filtros se aplican después sobre los primeros 100 casos.');
        if (casos === null) avisos.push('No pude contar los casos a tiempo.');
        if (casos !== null && casos > HARD_LIMIT) avisos.push(`Trae ${casos.toLocaleString('es-AR')} casos y el tope es ${HARD_LIMIT.toLocaleString('es-AR')}: va a fallar al ejecutarse.`);
        else if (casos !== null && casos > UMBRAL_SYNC) avisos.push(`Trae ${casos.toLocaleString('es-AR')} casos: va a correr en segundo plano.`);

        // Ancho fijo: lo que no entra se corta (y a la derecha pierde los dígitos más significativos).
        const ancho = (entrada.opciones.anchoFijo ?? []) as number[];
        if (ancho.length === labels.length) {
            labels.forEach((l, i) => {
                const largos = filas.filter((f) => String(f[l] ?? '').length > ancho[i]).length;
                if (largos === 0) return;
                const derecha = entrada.opciones.alineacion?.[i] === 'derecha';
                const texto = `${largos} ${largos === 1 ? 'valor de la muestra no entra' : 'valores de la muestra no entran'} en «${l}» (ancho ${ancho[i]})`;
                (derecha ? problemas : avisos).push(derecha ? `${texto}: a la derecha se pierden los dígitos más significativos; ampliá el ancho.` : `${texto}: se cortan.`);
            });
        }
        // Un número a la derecha que pierde los dígitos significativos es un error (§11.4): no se guarda ni se muestra, y el
        // modelo tiene que corregir el ancho.
        if (problemas.length > 0) {
            this.logger.warn(`Prueba rechazada por el ancho fijo (conversación ${conversacionId}): ${problemas.length} columnas`);
            return { tipo: 'rechazada', problemas };
        }

        const prueba = await this.guardar(a, { casos, aproximado, avisos, filasMuestra: filas.length });
        this.logger.log(`Prueba ${prueba.id} (conversación ${conversacionId}): ok casos=${casos ?? 'sin dato'} vacías=${vacias.length} en ${Date.now() - t0}ms`);

        const texto = [
            `Prueba ${prueba.id}: sin errores.`,
            `Muestra: ${filas.length} ${filas.length === 1 ? 'fila' : 'filas'}.`,
            casos === null ? 'Casos de la consulta completa: no pude contarlos a tiempo.' : `Casos de la consulta completa: ${casos.toLocaleString('es-AR')}${aproximado ? ' (aprox.: hay filtros que se aplican después de traer los datos)' : ''}.`,
            `Columnas vacías en la muestra: ${vacias.length ? vacias.map((v) => `«${v}»`).join(', ') : 'ninguna'}.`,
            ...(avisos.length ? ['Avisos:', ...avisos.map((x) => `- ${x}`)] : []),
        ].join('\n');

        return {
            tipo: 'ok',
            id: prueba.id,
            propuestaId: prueba.propuestaId,
            casos,
            aproximado,
            columnasVacias: vacias,
            avisos,
            textoParaModelo: texto,
        };
    }

    private async guardar(
        a: Parameters<PuertoPrueba['probar']>[0],
        m: { casos: number | null; aproximado: boolean; avisos: string[]; filasMuestra: number },
    ): Promise<{ id: string; propuestaId: number }> {
        const { normalizada: n, entrada, tarjeta, ids } = a;
        const plantilla = {
            nombre: n.nombre,
            descripcion: n.descripcion,
            raiz: n.raiz,
            empresaId: n.empresaId,
            definicion: n.definicion,
            formatoSalida: n.formatoSalida,
            opcionesFormato: n.opcionesFormato,
        };
        const tarjetaGuardada: TarjetaBase & { casos: number | null; casosAproximado: boolean; avisos: string[]; mensaje: string; sugerencias: string[]; version: number } = {
            ...tarjeta,
            casos: m.casos,
            casosAproximado: m.aproximado,
            avisos: m.avisos,
            mensaje: '',
            sugerencias: [],
            version: 0,
        };
        // "p1", "p2"…: correlativo por conversación. Un turno por persona a la vez: sin carrera (el unique lo respalda).
        for (let intento = 0; intento < 2; intento++) {
            const cantidad = await this.prisma.asistente_propuesta.count({ where: { conversacionId: ids.conversacionId! } });
            const id = `p${cantidad + 1 + intento}`;
            try {
                const fila = await this.prisma.asistente_propuesta.create({
                    data: {
                        conversacionId: ids.conversacionId!,
                        mensajeId: ids.mensajeId!,
                        usuarioId: ids.usuarioId!,
                        prueba: id,
                        entrada: entrada as unknown as Prisma.InputJsonValue,
                        plantilla: plantilla as unknown as Prisma.InputJsonValue,
                        tarjeta: tarjetaGuardada as unknown as Prisma.InputJsonValue,
                        hash: hashDefinicion(n.definicion),
                        estado: 'probada',
                    },
                    select: { id: true },
                });
                return { id, propuestaId: fila.id };
            } catch (e: any) {
                if (e?.code !== 'P2002' || intento === 1) throw e;
            }
        }
        throw new Error('No se pudo numerar la prueba.');
    }
}
