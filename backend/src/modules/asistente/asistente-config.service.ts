import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditoriaHelper } from '../transacciones/auditoria.helper';
import { AuditEstado, AuditModulo, AuditTipo } from '../transacciones/audit.enums';
import { ActualizarConfigDto } from './dto/actualizar-config.dto';
import { ActualizarFuncionDto } from './dto/actualizar-funcion.dto';
import { ConfigAsistente, FuncionAsistente, PrecioModelo } from './dto/asistente.tipos';
import { AsistenteModeloService } from './modelo/asistente-modelo.service';
import { PRECIOS_DEFAULT, resolverPrecio } from './modelo/precios';
import { DEFAULTS_REPORTES, FUNCION_REPORTES } from './reportes/funcion-reportes';

/** Lo que vale una función mientras su columna esté en null (el tope por turno global cortaría reportes en la primera llamada). */
export const DEFAULTS_POR_FUNCION: Record<string, { topeTurnoUsd?: number; limiteDiarioUsuario?: number }> = {
    [FUNCION_REPORTES]: { topeTurnoUsd: DEFAULTS_REPORTES.topeTurnoUsd, limiteDiarioUsuario: DEFAULTS_REPORTES.limiteDiarioUsuario },
};

/** La configuración tal como la usa el código (los Decimal ya son number). */
export interface ConfigInterna {
    habilitado: boolean;
    topeMensualUsd: number;
    avisoPorcentaje: number;
    limiteDiarioUsuario: number;
    topeTurnoUsd: number;
    precios: Record<string, PrecioModelo> | null;
}

export const FUNCIONES_INICIALES: { clave: string; nombre: string; habilitada: boolean }[] = [
    { clave: 'ayuda', nombre: 'Ayuda y navegación', habilitada: true },
    // El constructor de reportes es la Fase B: nace apagada.
    { clave: 'reportes', nombre: 'Constructor de reportes', habilitada: false },
];

/** Cuánto se reutiliza la configuración leída: cada pregunta la consulta varias veces. Un PATCH la invalida. */
const TTL_CONFIG_MS = 5_000;

/** Que `precios` tenga la forma de `PrecioModelo` para cada modelo. Lanza `BadRequestException`. */
export function validarPrecios(precios: unknown): Record<string, PrecioModelo> {
    if (!precios || typeof precios !== 'object' || Array.isArray(precios)) {
        throw new BadRequestException('Los precios tienen que ser un objeto con un precio por modelo.');
    }
    const num = (v: unknown, campo: string, modelo: string): number => {
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 10_000) {
            throw new BadRequestException(`Precio inválido: ${modelo}.${campo} tiene que ser un número entre 0 y 10000.`);
        }
        return v;
    };
    const tarifa = (o: any, modelo: string) => ({
        entrada: num(o?.entrada, 'entrada', modelo),
        salida: num(o?.salida, 'salida', modelo),
        cacheEscritura5m: num(o?.cacheEscritura5m, 'cacheEscritura5m', modelo),
        cacheEscritura1h: num(o?.cacheEscritura1h, 'cacheEscritura1h', modelo),
        cacheLectura: num(o?.cacheLectura, 'cacheLectura', modelo),
    });
    const out: Record<string, PrecioModelo> = {};
    for (const [modelo, p] of Object.entries(precios as Record<string, any>)) {
        if (!modelo || modelo.length > 80) throw new BadRequestException('Nombre de modelo inválido en los precios.');
        const base: PrecioModelo = tarifa(p, modelo);
        if (p?.umbralLargo !== undefined || p?.largo !== undefined) {
            if (!Number.isInteger(p.umbralLargo) || p.umbralLargo < 1 || p.umbralLargo > 10_000_000) {
                throw new BadRequestException(`Precio inválido: ${modelo}.umbralLargo tiene que ser un entero de tokens.`);
            }
            base.umbralLargo = p.umbralLargo;
            base.largo = tarifa(p.largo, `${modelo}.largo`);
        }
        out[modelo] = base;
    }
    return out;
}

@Injectable()
export class AsistenteConfigService {
    private readonly logger = new Logger(AsistenteConfigService.name);
    private cache: { valor: ConfigInterna; ts: number } | null = null;
    private funcionesSembradas = false;

    constructor(
        private readonly prisma: PrismaService,
        private readonly modelo: AsistenteModeloService,
        private readonly auditoria: AuditoriaHelper,
    ) {}

    invalidar(): void {
        this.cache = null;
    }

    private aInterna(f: {
        habilitado: boolean;
        topeMensualUsd: Prisma.Decimal;
        avisoPorcentaje: number;
        limiteDiarioUsuario: number;
        topeTurnoUsd: Prisma.Decimal;
        precios: Prisma.JsonValue | null;
    }): ConfigInterna {
        return {
            habilitado: f.habilitado,
            topeMensualUsd: Number(f.topeMensualUsd),
            avisoPorcentaje: f.avisoPorcentaje,
            limiteDiarioUsuario: f.limiteDiarioUsuario,
            topeTurnoUsd: Number(f.topeTurnoUsd),
            precios: f.precios && typeof f.precios === 'object' && !Array.isArray(f.precios)
                ? (f.precios as unknown as Record<string, PrecioModelo>)
                : null,
        };
    }

    /** La fila única (id = 1). Se crea sola la primera vez. */
    async leer(): Promise<ConfigInterna> {
        if (this.cache && Date.now() - this.cache.ts < TTL_CONFIG_MS) return this.cache.valor;
        const fila = await this.conReintentoDuplicado(() =>
            this.prisma.asistente_config.upsert({ where: { id: 1 }, update: {}, create: {} }),
        );
        await this.sembrarFunciones();
        const valor = this.aInterna(fila);
        this.cache = { valor, ts: Date.now() };
        return valor;
    }

    private async sembrarFunciones(): Promise<void> {
        if (this.funcionesSembradas) return;
        for (const f of FUNCIONES_INICIALES) {
            await this.conReintentoDuplicado(() =>
                this.prisma.asistente_funcion.upsert({ where: { clave: f.clave }, update: {}, create: f }),
            );
        }
        this.funcionesSembradas = true;
    }

    /**
     * Dos `upsert` simultáneos sobre una tabla vacía hacen los dos el INSERT y el segundo falla con P2002 (la primera
     * apertura después del deploy pide el estado en paralelo). El reintento ya encuentra la fila y no inserta.
     */
    private async conReintentoDuplicado<T>(fn: () => Promise<T>): Promise<T> {
        try {
            return await fn();
        } catch (e: any) {
            if (e?.code !== 'P2002') throw e;
            return fn();
        }
    }

    private aFuncion(f: {
        clave: string;
        nombre: string;
        habilitada: boolean;
        topeMensualUsd: Prisma.Decimal | null;
        topeTurnoUsd: Prisma.Decimal | null;
        limiteDiarioUsuario: number | null;
    }): FuncionAsistente {
        const d = DEFAULTS_POR_FUNCION[f.clave] ?? {};
        return {
            clave: f.clave,
            nombre: f.nombre,
            habilitada: f.habilitada,
            topeMensualUsd: f.topeMensualUsd === null ? null : Number(f.topeMensualUsd),
            modelo: this.modelo.modeloPara(f.clave),
            // Lo que vale de verdad: lo configurado o, si no hay, el de código de la función.
            topeTurnoUsd: f.topeTurnoUsd === null ? (d.topeTurnoUsd ?? null) : Number(f.topeTurnoUsd),
            limiteDiarioUsuario: f.limiteDiarioUsuario ?? d.limiteDiarioUsuario ?? null,
        };
    }

    async funciones(): Promise<FuncionAsistente[]> {
        await this.leer();
        const filas = await this.prisma.asistente_funcion.findMany({ orderBy: { clave: 'asc' } });
        return filas.map((f) => this.aFuncion(f));
    }

    async funcion(clave: string): Promise<FuncionAsistente | null> {
        return (await this.funciones()).find((f) => f.clave === clave) ?? null;
    }

    /** El precio de un modelo (por defecto, el de la ayuda): el configurado o el de código. `null` = no se llama. */
    async precioVigente(modelo: string = this.modelo.modelo): Promise<PrecioModelo | null> {
        const c = await this.leer();
        return resolverPrecio(modelo, c.precios);
    }

    /** Ids de los usuarios activos que pueden administrar el asistente (reciben los avisos de tope). */
    async administradoresActivos(): Promise<number[]> {
        const usuarios = await this.prisma.usuario.findMany({
            where: { activo: true },
            select: { id: true, rolObj: { select: { permisos: true } } },
        });
        return usuarios
            .filter((u) => Array.isArray(u.rolObj?.permisos) && (u.rolObj!.permisos as string[]).includes('asistente.administrar'))
            .map((u) => u.id);
    }

    async configPublica(): Promise<ConfigAsistente> {
        const c = await this.leer();
        const [funciones, admins] = await Promise.all([this.funciones(), this.administradoresActivos()]);
        return {
            habilitado: c.habilitado,
            topeMensualUsd: c.topeMensualUsd,
            avisoPorcentaje: c.avisoPorcentaje,
            limiteDiarioUsuario: c.limiteDiarioUsuario,
            topeTurnoUsd: c.topeTurnoUsd,
            modelo: this.modelo.modelo,
            precios: { ...PRECIOS_DEFAULT, ...(c.precios ?? {}) },
            funciones,
            sinAdministradores: admins.length === 0,
        };
    }

    async actualizar(dto: ActualizarConfigDto, usuarioId: number): Promise<ConfigAsistente> {
        const antes = await this.leer();
        const data: Prisma.asistente_configUpdateInput = { actualizadoPorId: usuarioId };
        const cambios: Record<string, { antes: unknown; despues: unknown }> = {};
        const poner = <K extends keyof ConfigInterna>(campo: K, valor: ConfigInterna[K] | undefined) => {
            if (valor === undefined || valor === antes[campo]) return;
            (data as Record<string, unknown>)[campo] = valor;
            cambios[campo] = { antes: antes[campo], despues: valor };
        };
        poner('habilitado', dto.habilitado);
        poner('topeMensualUsd', dto.topeMensualUsd);
        poner('avisoPorcentaje', dto.avisoPorcentaje);
        poner('limiteDiarioUsuario', dto.limiteDiarioUsuario);
        poner('topeTurnoUsd', dto.topeTurnoUsd);
        if (dto.precios !== undefined) {
            const precios = validarPrecios(dto.precios);
            data.precios = precios as unknown as Prisma.InputJsonValue;
            cambios.precios = { antes: Object.keys(antes.precios ?? {}), despues: Object.keys(precios) };
        }

        const t0 = Date.now();
        this.logger.log(`Actualizando la configuración del asistente (usuario=${usuarioId}, campos=${Object.keys(cambios).join(',') || 'ninguno'})`);
        await this.prisma.asistente_config.upsert({ where: { id: 1 }, update: data, create: {} });
        this.invalidar();
        this.logger.log(`Configuración del asistente actualizada en ${Date.now() - t0}ms`);
        await this.auditoria.log({
            modulo: AuditModulo.ADMIN,
            entidad: 'AsistenteConfig',
            entidadId: 1,
            tipo: AuditTipo.UPDATE,
            estado: AuditEstado.OK,
            usuarioId,
            resumen: `Configuración del asistente: ${Object.keys(cambios).join(', ') || 'sin cambios'}`,
            data: { params: cambios as any },
        });
        return this.configPublica();
    }

    async actualizarFuncion(clave: string, dto: ActualizarFuncionDto, usuarioId: number): Promise<FuncionAsistente> {
        await this.leer();
        const existente = await this.prisma.asistente_funcion.findUnique({ where: { clave } });
        if (!existente) {
            this.logger.warn(`Función del asistente inexistente: ${clave}`);
            throw new NotFoundException('No existe esa función del asistente.');
        }
        const data: Prisma.asistente_funcionUpdateInput = {};
        if (dto.habilitada !== undefined) data.habilitada = dto.habilitada;
        if (dto.topeMensualUsd !== undefined) data.topeMensualUsd = dto.topeMensualUsd;
        if (dto.topeTurnoUsd !== undefined) data.topeTurnoUsd = dto.topeTurnoUsd;
        if (dto.limiteDiarioUsuario !== undefined) data.limiteDiarioUsuario = dto.limiteDiarioUsuario;

        const t0 = Date.now();
        this.logger.log(`Actualizando la función del asistente ${clave} (usuario=${usuarioId})`);
        const fila = await this.prisma.asistente_funcion.update({ where: { clave }, data });
        this.logger.log(`Función del asistente ${clave} actualizada en ${Date.now() - t0}ms`);
        await this.auditoria.log({
            modulo: AuditModulo.ADMIN,
            entidad: 'AsistenteFuncion',
            entidadId: clave,
            tipo: AuditTipo.UPDATE,
            estado: AuditEstado.OK,
            usuarioId,
            resumen: `Función del asistente ${clave}`,
            data: {
                params: {
                    habilitada: { antes: existente.habilitada, despues: fila.habilitada },
                    topeMensualUsd: {
                        antes: existente.topeMensualUsd === null ? null : Number(existente.topeMensualUsd),
                        despues: fila.topeMensualUsd === null ? null : Number(fila.topeMensualUsd),
                    },
                    topeTurnoUsd: {
                        antes: existente.topeTurnoUsd === null ? null : Number(existente.topeTurnoUsd),
                        despues: fila.topeTurnoUsd === null ? null : Number(fila.topeTurnoUsd),
                    },
                    limiteDiarioUsuario: { antes: existente.limiteDiarioUsuario, despues: fila.limiteDiarioUsuario },
                } as any,
            },
        });
        return this.aFuncion(fila);
    }
}
