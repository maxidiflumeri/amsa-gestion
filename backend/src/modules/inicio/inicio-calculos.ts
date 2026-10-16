import { diaCalendario, inicioDelDia, sumarDiasYmd, ymdLocal } from '../../common/utils/dia-local';
import { AgendaDto, AgendaItemDto, GestionesDto } from './dto/mi-dia.dto';

/**
 * Cálculos puros de Inicio (docs/inicio-spec.md §5.5). Sin Prisma: reciben filas y un `ahora` inyectable,
 * y agrupan por día en Node (hora de Argentina), no en SQL (§2.4).
 */

export const DIAS_SERIE = 14;
export const LIMITE_AGENDA = 50;
const DIAS_PROMEDIO_MAX = 7;
const MAX_TEXTO_RETOMAR = 120;
const MAX_OBSERVACION = 80;

export interface GestionFila {
    fecha: Date;
    deudorId: number;
}

/** Primer instante (00:00 local) de la serie de gestiones: hoy − 13 días. */
export function inicioSerie(ahora: Date): Date {
    return inicioDelDia(sumarDiasYmd(ymdLocal(ahora), -(DIAS_SERIE - 1)));
}

function minutoDelDia(d: Date): number {
    return d.getHours() * 60 + d.getMinutes();
}

function redondear1(n: number): number {
    return Math.round(n * 10) / 10;
}

interface Dia {
    dia: string;
    filas: GestionFila[];
}

export function calcularGestiones(filas: GestionFila[], ahora: Date, truncado: boolean): GestionesDto {
    const hoy = ymdLocal(ahora);
    const dias: Dia[] = [];
    const porClave = new Map<string, Dia>();
    for (let k = DIAS_SERIE - 1; k >= 0; k--) {
        const d: Dia = { dia: sumarDiasYmd(hoy, -k), filas: [] };
        dias.push(d);
        porClave.set(d.dia, d);
    }
    for (const f of filas) {
        // Un día sin entrada (fuera de la ventana) se descarta: la consulta ya acota el rango.
        porClave.get(ymdLocal(f.fecha))?.filas.push(f);
    }

    const casos = (fs: GestionFila[]) => new Set(fs.map((f) => f.deudorId)).size;
    const hastaAhora = (d: Dia) => d.filas.filter((f) => minutoDelDia(f.fecha) <= minutoDelDia(ahora));

    const hoyDia = dias[dias.length - 1];
    const ayer = dias[dias.length - 2];
    const ayerFilas = hastaAhora(ayer);

    // Promedio a la misma hora: de ayer hacia atrás, los últimos ≤7 días con al menos una gestión en el día completo.
    const base: Dia[] = [];
    for (let i = dias.length - 2; i >= 0 && base.length < DIAS_PROMEDIO_MAX; i--) {
        if (dias[i].filas.length > 0) base.push(dias[i]);
    }
    const promedio =
        base.length === 0 ? null : redondear1(base.reduce((acc, d) => acc + hastaAhora(d).length, 0) / base.length);

    // Semana: desde el lunes de esta semana (domingo = 0 → 6 días atrás).
    const dow = ahora.getDay();
    const desde = sumarDiasYmd(hoy, -(dow === 0 ? 6 : dow - 1));
    const diasSemana = dias.filter((d) => d.dia >= desde);
    const filasSemana = diasSemana.flatMap((d) => d.filas);

    return {
        hoy: hoyDia.filas.length,
        casosHoy: casos(hoyDia.filas),
        ayerALaMismaHora: { gestiones: ayerFilas.length, casos: casos(ayerFilas) },
        promedioALaMismaHora: promedio,
        diasBase: base.length,
        semana: {
            desde,
            gestiones: filasSemana.length,
            casos: casos(filasSemana),
            diasConGestion: diasSemana.filter((d) => d.filas.length > 0).length,
        },
        serie: dias.map((d) => ({ dia: d.dia, gestiones: d.filas.length, casos: casos(d.filas) })),
        truncado,
    };
}

/** Recorta en un límite de palabra y agrega '…'. Los saltos de línea pasan a espacio. */
export function recortarTexto(texto: string | null | undefined, max: number): string {
    const limpio = String(texto ?? '').replace(/\s+/g, ' ').trim();
    if (limpio.length <= max) return limpio;
    const corte = limpio.slice(0, max);
    const ultimoEspacio = corte.lastIndexOf(' ');
    // Si el único espacio está muy al principio, cortar en seco es mejor que dejar casi nada.
    const base = ultimoEspacio > max * 0.5 ? corte.slice(0, ultimoEspacio) : corte;
    return `${base.trimEnd()}…`;
}

export const recortarRetomar = (t: string | null | undefined) => recortarTexto(t, MAX_TEXTO_RETOMAR);

// ─── Agenda ──────────────────────────────────────────────────────────────────

export interface DeudorAgenda {
    nombre: string;
    documento: string;
    empresa: string;
}

export interface PromesaFila {
    id: number;
    deudorId: number;
    fechaPromesa: Date;
    monto: number | null;
    estado: string;
    cerradaEn: Date | null;
    observacion: string | null;
}

export interface CuotaFila {
    id: number;
    deudorId: number;
    fechaVencimiento: Date;
    importe: number;
    estado: string;
    fechaPago: Date | null;
    nroCuota: number;
    cantCuotas: number;
}

const ABIERTOS = ['VIGENTE', 'PENDIENTE'];
const CERRADOS_MAL = ['INCUMPLIDA', 'VENCIDA'];

const montoOrden = (i: AgendaItemDto) => i.monto ?? -1;

export function calcularAgenda(
    promesas: PromesaFila[],
    cuotas: CuotaFila[],
    deudores: Map<number, DeudorAgenda>,
    ahora: Date,
    incluye: { promesas: boolean; cuotas: boolean },
): AgendaDto {
    const hoy = ymdLocal(ahora);
    const manana = sumarDiasYmd(hoy, 1);
    const en7 = sumarDiasYmd(hoy, 7);
    const hace7 = sumarDiasYmd(hoy, -7);
    const sinDeudor: DeudorAgenda = { nombre: '', documento: '', empresa: '' };

    const items: AgendaItemDto[] = [];
    for (const p of promesas) {
        const d = deudores.get(p.deudorId) ?? sinDeudor;
        items.push({
            tipo: 'PROMESA',
            id: p.id,
            deudorId: p.deudorId,
            ...d,
            // Fecha calendario guardada a las 00:00Z: se lee por la parte de fecha del ISO, no en hora local.
            dia: diaCalendario(p.fechaPromesa),
            monto: p.monto ?? null,
            estado: p.estado,
            cerradaEn: p.cerradaEn ? p.cerradaEn.toISOString() : null,
            nroCuota: null,
            cantCuotas: null,
            observacion: p.observacion ? recortarTexto(p.observacion, MAX_OBSERVACION) : null,
        });
    }
    for (const c of cuotas) {
        const d = deudores.get(c.deudorId) ?? sinDeudor;
        items.push({
            tipo: 'CUOTA',
            id: c.id,
            deudorId: c.deudorId,
            ...d,
            dia: diaCalendario(c.fechaVencimiento),
            monto: c.importe,
            estado: c.estado,
            cerradaEn: c.fechaPago ? c.fechaPago.toISOString() : null,
            nroCuota: c.nroCuota,
            cantCuotas: c.cantCuotas,
            observacion: null,
        });
    }

    const abierto = (i: AgendaItemDto) => (ABIERTOS.includes(i.estado) ? 0 : 1);
    const hoyL = items
        .filter((i) => i.dia === hoy)
        .sort((a, b) => abierto(a) - abierto(b) || montoOrden(b) - montoOrden(a));
    const proximos = items
        .filter((i) => i.dia >= manana && i.dia <= en7 && ABIERTOS.includes(i.estado))
        .sort((a, b) => a.dia.localeCompare(b.dia) || montoOrden(b) - montoOrden(a));
    // Un VIGENTE/PENDIENTE con día pasado (el cron no corrió) va acá con su estado real: no se pierde en silencio.
    const sinCumplir = items
        .filter((i) => i.dia < hoy && i.dia >= hace7 && (CERRADOS_MAL.includes(i.estado) || ABIERTOS.includes(i.estado)))
        .sort((a, b) => b.dia.localeCompare(a.dia) || montoOrden(b) - montoOrden(a));

    return {
        hoy: hoyL.slice(0, LIMITE_AGENDA),
        proximos: proximos.slice(0, LIMITE_AGENDA),
        sinCumplir: sinCumplir.slice(0, LIMITE_AGENDA),
        totales: { hoy: hoyL.length, proximos: proximos.length, sinCumplir: sinCumplir.length },
        limite: LIMITE_AGENDA,
        incluye,
    };
}
