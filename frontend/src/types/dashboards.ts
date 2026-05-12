export interface SnapshotKpis {
    cantidadCasos: number;
    deudaTotal: number;
    pagosPeriodo: number;
    porcentajeRecupero: number;
    casosConPago: number;
    ticketPromedio: number;
    moraPromediaDias: number | null;
    promesasVigentes: number;
    porcentajeCpc: number;
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

export type Granularidad = 'dia' | 'semana' | 'mes';

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
    granularidad: Granularidad;
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

export interface SnapshotFunnel {
    asignados: number;
    contactados: number;
    conPromesa: number;
    conPago: number;
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

export interface SnapshotFiltros {
    empresaId?: number | null;
    remesaId?: number | null;
    desde: string;
    hasta: string;
    situacionIds?: number[];
    gestionIds?: number[];
    motivoIds?: number[];
    granularidad?: Granularidad;
}
