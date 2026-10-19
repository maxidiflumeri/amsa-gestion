import { Injectable, Logger } from '@nestjs/common';
import { remesa_categoria } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { MapaReconocibles, normalizar } from '../adjuntos/perfil-ejemplo';
import { MAX_VALORES_LISTADOS } from './funcion-reportes';
import { Vocabulario } from './tipos-reportes';
import { PuertoVocabularios } from './turno-reportes.runner';

/**
 * Los valores de los campos de vocabulario cerrado (docs/asistente-reportes-spec.md §7.4): empresas con sus casos, códigos
 * de situación/gestión/motivo, enums y constantes. Se cachean 10 minutos. Los usa el validador (valores exactos), la
 * herramienta `valores_de_campo` y el perfil del ejemplo (valores reconocidos). Sin datos personales.
 */

const TTL_MS = 10 * 60 * 1000;

const GRUPO_DE: Record<string, string> = {
    estadoSituacion: 'situacion',
    'promesas.situacionAnterior': 'situacion',
    estadoGestion: 'gestion',
    estadoGestionPrevio: 'gestion',
    motivoNoPago: 'motivo_no_pago',
};

/** Enums y constantes del sistema (los del código; no inventan valores). */
const ESTATICOS: Record<string, Vocabulario> = {
    'contactos.tipo': { valores: ['telefono', 'email', 'direccion'], cerrado: true },
    'contactos.relacion': { valores: ['(vacío = titular)', 'CODEUDOR'], cerrado: false },
    'promesas.estado': { valores: ['VIGENTE', 'CUMPLIDA', 'INCUMPLIDA', 'ANULADA'], cerrado: true },
    'facturas.estado': { valores: ['PENDIENTE', 'PAGADA'], cerrado: true },
    'convenios.cuotas.estado': { valores: ['PENDIENTE', 'PAGADA', 'VENCIDA'], cerrado: true },
    'convenios.tipo': { valores: ['AUTOMATICO', 'LIBRE'], cerrado: true },
    'convenios.estado': { valores: ['ACTIVO', 'ANULADO'], cerrado: false },
    'pagos.origen': { valores: ['MANUAL', 'IMPORT_PAGOS', 'IMPORT_ACTUALIZACION', 'CONVENIO'], cerrado: true },
    'remesa.categoria': { valores: Object.values(remesa_categoria), cerrado: true },
    'enviosEmail.estado': { valores: ['ENVIADO', 'ERROR', 'OMITIDO'], cerrado: true },
};

interface Cache {
    ts: number;
    empresas: { id: number; nombre: string; casos: number }[];
    parametros: Record<string, { clave: string; descripcion: string }[]>;
    formatos: Map<number, string>;
    formatosPatron: Map<number, string>;
    plantillas: Set<string>;
}

@Injectable()
export class VocabulariosService implements PuertoVocabularios {
    private readonly logger = new Logger(VocabulariosService.name);
    private cache: Cache | null = null;
    private cargando: Promise<void> | null = null;

    constructor(private readonly prisma: PrismaService) {}

    async preparar(): Promise<void> {
        if (this.cache && Date.now() - this.cache.ts < TTL_MS) return;
        if (!this.cargando) {
            this.cargando = this.cargar().finally(() => {
                this.cargando = null;
            });
        }
        await this.cargando;
    }

    private async cargar(): Promise<void> {
        const t0 = Date.now();
        const [empresas, conteo, parametros, formatos, plantillas] = await Promise.all([
            this.prisma.empresa.findMany({ select: { id: true, nombre: true }, orderBy: { nombre: 'asc' } }),
            this.prisma.deudor.groupBy({ by: ['empresaId'], _count: { _all: true } }),
            this.prisma.parametro.findMany({
                where: { activo: true, grupo: { in: ['situacion', 'gestion', 'motivo_no_pago'] } },
                select: { grupo: true, clave: true, descripcion: true },
                orderBy: { clave: 'asc' },
            }),
            this.prisma.formato_telefono.findMany({ where: { activo: true }, select: { id: true, nombre: true, patron: true }, orderBy: { id: 'asc' } }),
            this.prisma.plantilla_reporte.findMany({ where: { activo: true }, select: { nombre: true } }),
        ]);
        const casos = new Map(conteo.map((c) => [c.empresaId, c._count._all]));
        const porGrupo: Cache['parametros'] = {};
        for (const p of parametros) (porGrupo[p.grupo] ??= []).push({ clave: p.clave, descripcion: p.descripcion });
        this.cache = {
            ts: Date.now(),
            empresas: empresas.map((e) => ({ id: e.id, nombre: e.nombre, casos: casos.get(e.id) ?? 0 })),
            parametros: porGrupo,
            formatos: new Map(formatos.map((f) => [f.id, f.nombre])),
            formatosPatron: new Map(formatos.map((f) => [f.id, f.patron])),
            plantillas: new Set(plantillas.map((p) => p.nombre.trim().toLowerCase())),
        };
        this.logger.log(`Vocabularios del asistente cargados: ${empresas.length} empresas, ${parametros.length} parámetros en ${Date.now() - t0}ms`);
    }

    empresas() {
        return this.cache?.empresas ?? [];
    }

    formatosTelefono(): ReadonlyMap<number, string> {
        return this.cache?.formatos ?? new Map();
    }

    nombresPlantillas(): ReadonlySet<string> {
        return this.cache?.plantillas ?? new Set();
    }

    vocabulario(path: string): Vocabulario | null {
        if (path === 'empresa.nombre') return { valores: this.empresas().map((e) => e.nombre), cerrado: true };
        const m = /^(.*)\.(clave|descripcion)$/.exec(path);
        if (m && GRUPO_DE[m[1]]) {
            const filas = this.cache?.parametros[GRUPO_DE[m[1]]] ?? [];
            return { valores: filas.map((f) => f[m[2] as 'clave' | 'descripcion']), cerrado: true };
        }
        return ESTATICOS[path] ?? null;
    }

    /** Valores que coinciden con el vocabulario del sistema: para el perfil de los archivos de ejemplo. */
    reconocibles(): MapaReconocibles {
        const mapa: MapaReconocibles = {};
        const poner = (valor: string, campo: string) => {
            if (valor.length < 3 || valor.startsWith('(')) return;
            const k = normalizar(valor);
            if (!(k in mapa)) mapa[k] = { valor, campo };
        };
        for (const e of this.empresas()) poner(e.nombre, 'empresa.nombre');
        for (const [path, v] of Object.entries(ESTATICOS)) for (const x of v.valores) poner(x, path);
        for (const [base, grupo] of Object.entries(GRUPO_DE)) {
            for (const p of this.cache?.parametros[grupo] ?? []) {
                poner(p.clave, `${base}.clave`);
                poner(p.descripcion, `${base}.descripcion`);
            }
        }
        return mapa;
    }

    private async dinamico(path: string): Promise<string[] | null> {
        const distinct = (xs: { v: string | null }[]) => [...new Set(xs.map((x) => x.v).filter((x): x is string => !!x))].sort();
        switch (path) {
            case 'contactos.subtipo':
                return distinct((await this.prisma.contacto.findMany({ distinct: ['subtipo'], where: { subtipo: { not: null } }, select: { subtipo: true }, take: 40 })).map((x) => ({ v: x.subtipo })));
            case 'llamadas.direccion':
                return distinct((await this.prisma.llamada_neotel.findMany({ distinct: ['direccion'], select: { direccion: true }, take: 40 })).map((x) => ({ v: x.direccion })));
            case 'llamadas.estado':
                return distinct((await this.prisma.llamada_neotel.findMany({ distinct: ['estado'], select: { estado: true }, take: 40 })).map((x) => ({ v: x.estado })));
            default:
                return null;
        }
    }

    async valores(campo: string, buscar?: string): Promise<{ ok: true; texto: string } | { ok: false; error: string }> {
        await this.preparar();
        let encabezado: string;
        let lineas: string[];

        if (campo === 'formatos_telefono') {
            encabezado = 'Formatos de teléfono activos (id: nombre, patrón). Usá el id en formatoTelefonoId:';
            lineas = [...(this.cache?.formatosPatron ?? new Map()).entries()].map(([id, patron]) => `${id}: ${this.cache!.formatos.get(id)} (${patron})`);
        } else if (campo === 'empresa.nombre') {
            encabezado = 'Valores de empresa.nombre (usá el nombre exacto, sin los casos):';
            lineas = this.empresas().map((e) => `${e.nombre} (${e.casos.toLocaleString('es-AR')} casos)`);
        } else {
            const m = /^(.*)\.(clave|descripcion)$/.exec(campo);
            if (m && GRUPO_DE[m[1]]) {
                const filas = this.cache?.parametros[GRUPO_DE[m[1]]] ?? [];
                encabezado = `Valores de ${campo} (código — descripción). Para filtrar usá ${m[2] === 'clave' ? 'el código' : 'la descripción, exacta'}:`;
                lineas = filas.map((f) => `${f.clave} — ${f.descripcion}`);
            } else if (ESTATICOS[campo]) {
                encabezado = `Valores de ${campo}:`;
                lineas = ESTATICOS[campo].valores;
            } else {
                const dyn = await this.dinamico(campo);
                if (dyn === null) return { ok: false, error: `«${campo}» es texto libre: no tiene una lista de valores.` };
                encabezado = `Valores de ${campo} que hay cargados:`;
                lineas = dyn;
            }
        }

        if (buscar && buscar.trim() !== '') {
            const q = normalizar(buscar);
            lineas = lineas.filter((l) => normalizar(l).includes(q));
        }
        if (lineas.length === 0) return { ok: true, texto: `${encabezado}\n(ninguno${buscar ? ` coincide con «${buscar.slice(0, 60)}»` : ''})` };
        const mostrar = lineas.slice(0, MAX_VALORES_LISTADOS);
        const resto = lineas.length - mostrar.length;
        return { ok: true, texto: `${encabezado}\n${mostrar.join('\n')}${resto > 0 ? `\n…y ${resto} más: acotá con «buscar».` : ''}` };
    }
}
