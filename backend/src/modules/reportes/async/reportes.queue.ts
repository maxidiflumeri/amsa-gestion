export const REPORTES_QUEUE_NAME = 'reportes';
export const REPORTES_JOB_EJECUTAR = 'ejecutar-reporte';

export interface EjecutarReporteJobData {
  ejecucionId: number;
  plantillaId: number;
  usuarioId: number;
  empresaId: number | null;
  filtrosVars: Record<string, any>;
  formato: string;
  _ctx?: { requestId?: string; usuarioId?: number };
}

export interface EjecutarReporteJobResult {
  ejecucionId: number;
  totalFilas: number;
  archivoTamano: number;
  duracionMs: number;
}
