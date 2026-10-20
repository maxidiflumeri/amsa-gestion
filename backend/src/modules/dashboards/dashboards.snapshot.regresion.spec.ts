// Red de regresión del snapshot del tablero (Fase 1a, paso 1 del analista de cartera).
//
// Se grabó con el código de `DashboardsService` TAL COMO ESTABA antes de extraer las consultas a un
// módulo único de indicadores. Corre contra un doble de Prisma (`PrismaGrabador`): no hace falta base.
//
//   GRABAR_SNAPSHOT=1 npx jest src/modules/dashboards/dashboards.snapshot.regresion.spec.ts
//
// escribe `__fixtures__/snapshot-antes.json`. Sin la variable, el test compara contra ese fixture.
// El fixture NO se regenera para hacer pasar el test: si falla, o se rompió un número del tablero o
// cambió una consulta, y las dos cosas se revisan a mano.

// Las fechas del rango son días locales (`inicioDelDia`/`finDelDia`): la zona la fija el globalSetup de jest
// (`test/tz-global-setup.js`, America/Argentina/Buenos_Aires), así las firmas no dependen de la máquina.

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { DashboardsService } from './dashboards.service';
import { SnapshotDto } from './dtos/snapshot.dto';
import { SnapshotResponse } from './interfaces/snapshot.interface';

const FIXTURE = path.join(__dirname, '__fixtures__', 'snapshot-antes.json');
const GRABAR = process.env.GRABAR_SNAPSHOT === '1';

// ── Firmas ──────────────────────────────────────────────────────────────

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** `Prisma.Sql` no existe como valor en runtime (solo como tipo): se reconoce por forma. */
function esSql(valor: unknown): valor is Prisma.Sql {
    const v = valor as { strings?: unknown; values?: unknown } | null;
    return typeof v === 'object' && v !== null && Array.isArray(v.strings) && Array.isArray(v.values);
}

/** Normaliza un argumento para que dos llamadas equivalentes den la misma firma: claves ordenadas, fechas en ISO. */
function normalizar(valor: unknown): Json {
    if (valor === undefined) return null;
    if (valor === null || typeof valor === 'boolean' || typeof valor === 'string') return valor;
    if (typeof valor === 'number') return valor;
    if (typeof valor === 'bigint') return valor.toString();
    if (valor instanceof Date) return valor.toISOString();
    if (esSql(valor)) return { strings: [...valor.strings], values: valor.values.map(normalizar) };
    if (Array.isArray(valor)) return valor.map(normalizar);
    if (typeof valor === 'object') {
        const salida: { [k: string]: Json } = {};
        for (const k of Object.keys(valor as object).sort()) {
            const v = (valor as Record<string, unknown>)[k];
            if (v !== undefined) salida[k] = normalizar(v);
        }
        return salida;
    }
    return String(valor);
}

export interface Llamada {
    metodo: string;
    argumentos: Json;
}

/** Secuencia determinista de enteros derivada de la firma. */
function semilla(llamada: Llamada, sal = ''): (max: number) => number {
    const digest = createHash('sha1').update(JSON.stringify(llamada) + sal).digest();
    let i = 0;
    return (max: number) => {
        const n = digest.readUInt16BE((i * 2) % 18);
        i++;
        return n % max;
    };
}

// ── Catálogo de parámetros del doble ─────────────────────────────────────

interface ParamFalso { id: number; clave: string; categoria: string | null; descripcion: string }

const CATALOGO: ParamFalso[] = [
    { id: 11, clave: 'SIT-011', categoria: 'CONTACTADO', descripcion: 'Contactado titular' },
    { id: 12, clave: 'SIT-012', categoria: 'CONTACTADO', descripcion: 'Contactado tercero' },
    { id: 20, clave: 'SIT-020', categoria: 'PROMESA', descripcion: 'Promesa vigente' },
    { id: 30, clave: 'GES-030', categoria: 'GESTION', descripcion: 'Promesa de pago' },
    { id: 31, clave: 'GES-010', categoria: 'GESTION', descripcion: 'Llamada sin respuesta' },
    { id: 32, clave: 'GES-020', categoria: 'GESTION', descripcion: 'Mensaje enviado' },
    { id: 41, clave: 'SIT-090', categoria: 'INCOBRABLE', descripcion: 'Incobrable' },
    { id: 42, clave: 'SIT-080', categoria: 'LEGAL', descripcion: 'En instancia legal' },
    { id: 43, clave: 'SIT-013', categoria: 'CONTACTADO', descripcion: 'Contactado sin compromiso' },
    { id: 44, clave: 'SIT-030', categoria: 'PAGANDO', descripcion: 'Pagando en cuotas' },
    { id: 45, clave: 'SIT-040', categoria: 'CANCELADO', descripcion: 'Cancelado' },
    ...[61, 62, 63, 64, 65, 66, 67].map(id => ({
        id, clave: `MOT-0${id - 60}`, categoria: 'MOTIVO', descripcion: `Motivo de no pago ${id - 60}`,
    })),
];

const IDS_SITUACION = [11, 12, 20, 41, 42, 43, 44, 45];
const IDS_GESTION = [30, 31, 32];
const IDS_MOTIVO = [61, 62, 63, 64, 65, 66, 67];

const RANGOS_MORA = ['0-30', '31-60', '61-90', '91-180', '180+', 'Sin fecha'];
const RANGOS_DEUDA = ['$0-10k', '$10k-50k', '$50k-200k', '$200k-1M', '$1M+'];

const EMPRESA_ID = 7;

function dosDecimales(n: number): number {
    return Math.round(n * 100) / 100;
}

function pad(n: number): string {
    return String(n).padStart(2, '0');
}

function fechaLocal(d: Date): string {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Etiquetas de periodo (las que devolvería el DATE_FORMAT de MySQL) entre dos fechas. */
function etiquetasDePeriodo(desde: Date, hasta: Date, granularidad: 'dia' | 'semana' | 'mes'): string[] {
    const etiquetas: string[] = [];
    const cursor = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate());
    if (granularidad === 'semana') cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7));
    if (granularidad === 'mes') cursor.setDate(1);
    while (cursor <= hasta) {
        etiquetas.push(granularidad === 'mes' ? `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}-01` : fechaLocal(cursor));
        if (granularidad === 'dia') cursor.setDate(cursor.getDate() + 1);
        else if (granularidad === 'semana') cursor.setDate(cursor.getDate() + 7);
        else cursor.setMonth(cursor.getMonth() + 1);
    }
    return etiquetas;
}

// ── El doble ─────────────────────────────────────────────────────────────

/**
 * Doble de Prisma que responde cada llamada con un valor determinista derivado de su firma
 * (método + argumentos normalizados; para `$queryRaw`, los `strings` y `values` del `Prisma.Sql`)
 * y graba las firmas en orden de llamada. Mismo pedido, misma respuesta; pedido distinto, otra respuesta:
 * si una extracción cambia un filtro, el número que vuelve cambia y el test lo ve.
 */
export class PrismaGrabador {
    readonly llamadas: Llamada[] = [];

    private registrar(metodo: string, args: unknown): { llamada: Llamada; n: (max: number) => number } {
        const llamada: Llamada = { metodo, argumentos: normalizar(args) };
        this.llamadas.push(llamada);
        return { llamada, n: semilla(llamada) };
    }

    private modelo(nombre: string) {
        return {
            findUnique: async (args: { where: { id: number } }) => {
                this.registrar(`${nombre}.findUnique`, args);
                return nombre === 'remesa'
                    ? { id: args.where.id, empresaId: EMPRESA_ID, nombre: `Remesa ${args.where.id}` }
                    : { id: args.where.id, nombre: `Empresa ${args.where.id}` };
            },
            findMany: async (args: { where?: { OR?: unknown; id?: { in: number[] } } }) => {
                const { n } = this.registrar(`${nombre}.findMany`, args);
                if (nombre === 'parametro') {
                    // Resolución de claves canónicas (where.OR) o de etiquetas por id (where.id.in).
                    if (args.where?.id?.in) {
                        return args.where.id.in.map(id => CATALOGO.find(p => p.id === id)
                            ?? { id, clave: `PAR-${id}`, categoria: null, descripcion: `Parámetro ${id}` });
                    }
                    return CATALOGO.filter(p => p.categoria !== 'MOTIVO' && (p.categoria !== 'GESTION' || p.clave === 'GES-030'));
                }
                // deudor.findMany: top 10 por monto descendente.
                let monto = 4_000_000 + n(2_000_000) + n(100) / 100;
                return Array.from({ length: 10 }, (_, i) => {
                    monto = dosDecimales(monto - 50_000 - n(300_000) - n(100) / 100);
                    return {
                        id: 1000 + n(9000) + i,
                        nombre: `Nombre${i}`,
                        apellido: `Apellido${i}`,
                        documento: String(20_000_000 + n(20_000_000)),
                        montoTotal: monto,
                        estadoGestion: i % 4 === 3 ? null : { descripcion: `Gestión ${i}` },
                        estadoSituacion: { descripcion: `Situación ${i}` },
                    };
                });
            },
            count: async (args: unknown) => {
                const { n } = this.registrar(`${nombre}.count`, args);
                return 100 + n(5000);
            },
            aggregate: async (args: unknown) => {
                const { n } = this.registrar(`${nombre}.aggregate`, args);
                if (nombre === 'deudor') return { _sum: { montoTotal: dosDecimales(8_000_000 + n(9_000_000) + n(100) / 100) } };
                return {
                    _sum: { importe: dosDecimales(300_000 + n(900_000) + n(100) / 100) },
                    _avg: { importe: dosDecimales(15_000 + n(30_000) + n(100) / 100) },
                    _count: 20 + n(300),
                };
            },
            groupBy: async (args: { by: string[] }) => {
                const { n } = this.registrar(`${nombre}.groupBy`, args);
                const campo = args.by[0];
                if (nombre === 'pago') {
                    return Array.from({ length: 30 + n(400) }, (_, i) => ({ deudorId: 5000 + i, _count: { _all: 1 + n(3) } }));
                }
                const ids = campo === 'estadoSituacionId' ? IDS_SITUACION : campo === 'estadoGestionId' ? IDS_GESTION : IDS_MOTIVO;
                return [null, ...ids].map(id => ({ [campo]: id, _count: { _all: 10 + n(900) } }));
            },
        };
    }

    readonly remesa = this.modelo('remesa');
    readonly empresa = this.modelo('empresa');
    readonly parametro = this.modelo('parametro');
    readonly deudor = this.modelo('deudor');
    readonly pago = this.modelo('pago');

    /** `$queryRaw` como template tag: arma el `Prisma.Sql` igual que Prisma (aplana los fragmentos anidados). */
    $queryRaw = async (strings: TemplateStringsArray | Prisma.Sql, ...values: unknown[]): Promise<unknown[]> => {
        const sql = esSql(strings) ? strings : Prisma.sql(strings, ...values);
        const { n } = this.registrar('$queryRaw', sql);
        const texto = sql.strings.join('?');
        const fechas = sql.values.filter((v): v is Date => v instanceof Date);

        if (texto.includes('AVG(DATEDIFF')) return [{ avgMora: dosDecimales(40 + n(300) + n(100) / 100) }];
        if (texto.includes('SUM(COALESCE(d.saldo')) return [{ saldo: dosDecimales(2_000_000 + n(6_000_000) + n(100) / 100) }];
        if (texto.includes("THEN 'Sin fecha'")) {
            return RANGOS_MORA.map(rango => ({ rango, cantidad: BigInt(5 + n(800)) }));
        }
        if (texto.includes("THEN '$0-10k'")) {
            return RANGOS_DEUDA.map(rango => ({ rango, cantidad: BigInt(5 + n(800)), suma: dosDecimales(10_000 + n(900_000) * 3 + n(100) / 100) }));
        }
        if (texto.includes('FROM pago p') || texto.includes('FROM comentario c')) {
            const granularidad = texto.includes('WEEKDAY') ? 'semana' : texto.includes("'%Y-%m-01'") ? 'mes' : 'dia';
            const etiquetas = etiquetasDePeriodo(fechas[0], fechas[1], granularidad);
            // Salteo algunos periodos: las series reales tienen huecos.
            const conDatos = etiquetas.filter((_, i) => i % 5 !== 4);
            return texto.includes('FROM pago p')
                ? conDatos.map(fecha => ({ fecha, importe: dosDecimales(5_000 + n(80_000) + n(100) / 100), cantidad: BigInt(1 + n(40)) }))
                : conDatos.map(fecha => ({ fecha, cantidad: BigInt(1 + n(120)) }));
        }
        throw new Error(`PrismaGrabador: $queryRaw sin respuesta para: ${texto}`);
    };
}

// ── Los cuatro DTOs ──────────────────────────────────────────────────────

const DTOS: Record<string, SnapshotDto> = {
    soloEmpresa: { empresaId: EMPRESA_ID, desde: '2026-07-01', hasta: '2026-07-31' },
    empresaYRemesa: { empresaId: EMPRESA_ID, remesaId: 15, desde: '2026-07-01', hasta: '2026-07-31' },
    conFiltros: {
        empresaId: EMPRESA_ID,
        desde: '2026-07-01',
        hasta: '2026-07-31',
        situacionIds: [11, 12, 20],
        gestionIds: [30, 31],
        motivoIds: [61, 62, 63],
    },
    rango90Semana: { empresaId: EMPRESA_ID, desde: '2026-05-01', hasta: '2026-07-29', granularidad: 'semana' },
};

type SinGeneradoEn = Omit<SnapshotResponse, 'meta'> & { meta: Omit<SnapshotResponse['meta'], 'generadoEn'> };

async function correr(dto: SnapshotDto): Promise<{ llamadas: Llamada[]; respuesta: SinGeneradoEn }> {
    const prisma = new PrismaGrabador();
    const servicio = new DashboardsService(prisma as unknown as PrismaService);
    const { meta, ...resto } = await servicio.snapshot(dto);
    const { generadoEn, ...metaSinFecha } = meta;
    expect(typeof generadoEn).toBe('string');
    return { llamadas: prisma.llamadas, respuesta: { ...resto, meta: metaSinFecha } };
}

/** Las firmas como multiconjunto: el orden de las consultas no importa, sí cuáles y cuántas. */
export function comoMulticonjunto(llamadas: Llamada[]): string[] {
    return llamadas.map(l => JSON.stringify(l)).sort();
}

type Fixture = Record<string, { llamadas: Llamada[]; respuesta: SinGeneradoEn }>;

describe('Snapshot del tablero: regresión contra el código previo a la extracción', () => {
    let obtenido: Fixture;

    beforeAll(async () => {
        obtenido = {};
        for (const [nombre, dto] of Object.entries(DTOS)) obtenido[nombre] = await correr(dto);
        if (GRABAR) {
            fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
            // JSON.stringify no soporta BigInt, pero la respuesta ya trae solo number/string.
            fs.writeFileSync(FIXTURE, JSON.stringify(obtenido, null, 2) + '\n');
        }
    });

    it('el doble ejercita los cálculos: nada en cero, listas con datos', () => {
        for (const nombre of Object.keys(DTOS)) {
            const { kpis, distribuciones, series, top, funnel } = obtenido[nombre].respuesta;
            expect(kpis.cantidadCasos).toBeGreaterThan(0);
            expect(kpis.deudaAsignada).toBeGreaterThan(0);
            expect(kpis.saldoPendiente).toBeGreaterThan(0);
            expect(kpis.recuperoAcumulado).toBeGreaterThan(0);
            expect(kpis.pagosPeriodo).toBeGreaterThan(0);
            expect(kpis.casosConPago).toBeGreaterThan(0);
            expect(kpis.ticketPromedio).toBeGreaterThan(0);
            expect(kpis.moraPromediaDias).not.toBeNull();
            expect(kpis.promesasVigentes).toBeGreaterThan(0);
            expect(kpis.porcentajeCpc).toBeGreaterThan(0);
            expect(kpis.casosIncobrables).toBeGreaterThan(0);
            expect(kpis.casosLegales).toBeGreaterThan(0);
            expect(distribuciones.porSituacion.length).toBeGreaterThan(1);
            expect(distribuciones.porMotivo.length).toBeGreaterThan(1);
            expect(top.motivos).toHaveLength(5);
            expect(top.deudores).toHaveLength(10);
            expect(distribuciones.porMora.some(b => b.cantidad > 0 && b.porcentaje > 0)).toBe(true);
            expect(distribuciones.porDeuda.some(b => (b.suma ?? 0) > 0)).toBe(true);
            expect(series.pagosPorPeriodo.length).toBeGreaterThan(3);
            expect(series.gestionesPorPeriodo.length).toBeGreaterThan(3);
            expect(funnel.asignados).toBe(kpis.cantidadCasos);
        }
    });

    it('el rango de 90 días con granularidad semana arma series semanales (lunes)', () => {
        const { series } = obtenido.rango90Semana.respuesta;
        expect(series.granularidad).toBe('semana');
        for (const p of series.pagosPorPeriodo) expect(new Date(`${p.fecha}T12:00:00`).getDay()).toBe(1);
    });

    describe.each(Object.keys(DTOS))('%s', nombre => {
        it('responde igual que antes (sin generadoEn)', () => {
            if (GRABAR) return;
            const esperado: Fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
            expect(obtenido[nombre].respuesta).toEqual(esperado[nombre].respuesta);
        });

        it('hace las mismas consultas que antes', () => {
            if (GRABAR) return;
            const esperado: Fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
            // Hoy: exactamente las mismas, y en el mismo orden. Los pasos siguientes relajan esto a
            // `comoMulticonjunto` y le suman la consulta nueva (conteo de SIT-011).
            expect(comoMulticonjunto(obtenido[nombre].llamadas)).toEqual(comoMulticonjunto(esperado[nombre].llamadas));
            expect(obtenido[nombre].llamadas).toEqual(esperado[nombre].llamadas);
        });
    });
});
