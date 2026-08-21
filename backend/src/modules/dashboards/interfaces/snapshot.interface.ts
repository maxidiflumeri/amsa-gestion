export interface SnapshotKpis {
    cantidadCasos: number;
    /** Lo que el cedente asignó. No baja al cobrar: es la referencia contra la que se mide. */
    deudaAsignada: number;
    /** Lo que falta cobrar hoy. Sale de `deudor.saldo`, y cae a `montoTotal` si nunca se consolidó. */
    saldoPendiente: number;
    /** Todo lo cobrado sobre lo asignado, desde siempre. Es el número que le importa al cedente. */
    recuperoAcumulado: number;
    /** Cobrado dentro del rango de fechas. */
    pagosPeriodo: number;
    casosConPago: number;
    ticketPromedio: number;
    moraPromediaDias: number | null;
    promesasVigentes: number;
    porcentajeCpc: number;
    /** Casos que nadie tocó nunca: sin un solo comentario. */
    casosSinGestion: number;
    casosIncobrables: number;
    casosLegales: number;
}

export interface DistribucionItem {
    id: number | null;
    clave: string | null;
    label: string;
    categoria: string | null;
    cantidad: number;
    porcentaje: number;
}

export interface BucketItem {
    rango: string;
    cantidad: number;
    porcentaje: number;
    suma?: number;
}

export interface SnapshotDistribuciones {
    porSituacion: DistribucionItem[];
    porGestion: DistribucionItem[];
    porMotivo: DistribucionItem[];
    porMora: BucketItem[];
    porDeuda: BucketItem[];
}

export interface SeriePagoItem {
    fecha: string;
    importe: number;
    cantidad: number;
}

export interface SerieGestionItem {
    fecha: string;
    cantidad: number;
}

export interface SnapshotSeries {
    granularidad: 'dia' | 'semana' | 'mes';
    pagosPorPeriodo: SeriePagoItem[];
    gestionesPorPeriodo: SerieGestionItem[];
}

export interface TopDeudor {
    deudorId: number;
    nombreCompleto: string;
    documento: string;
    monto: number;
    estadoGestion: string | null;
    estadoSituacion: string | null;
}

export interface TopMotivo {
    id: number;
    clave: string;
    label: string;
    cantidad: number;
    porcentaje: number;
}

export interface SnapshotTop {
    deudores: TopDeudor[];
    motivos: TopMotivo[];
}

/**
 * Escalones **anidados por construcción**: cada uno es subconjunto del anterior, así que las barras
 * siempre decrecen y la diferencia entre dos se puede leer como una caída.
 */
export interface SnapshotFunnel {
    asignados: number;
    contactados: number;
    conPromesa: number;
    /** De los que prometieron, cuántos pagaron. Quien pagó sin prometer está en `casosConPago`. */
    promesaCumplida: number;
}

export interface SnapshotMeta {
    empresaId: number | null;
    empresaNombre: string | null;
    remesaId: number | null;
    remesaNombre: string | null;
    desde: string;
    hasta: string;
    generadoEn: string;
    totalDeudoresFiltrados: number;
}

export interface SnapshotResponse {
    kpis: SnapshotKpis;
    distribuciones: SnapshotDistribuciones;
    series: SnapshotSeries;
    top: SnapshotTop;
    funnel: SnapshotFunnel;
    meta: SnapshotMeta;
}
