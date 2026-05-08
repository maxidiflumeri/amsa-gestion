export const REPORTES_V2_QUEUE_NAME = 'reportes-v2';
export const REPORTES_V2_JOB_EJECUTAR = 'ejecutar-reporte';

export interface EjecutarReporteJobData {
  ejecucionId: number;
  plantillaId: number;
  usuarioId: number;
  empresaId: number | null;
  filtrosVars: Record<string, any>;
  formato: string;
}

export interface EjecutarReporteJobResult {
  ejecucionId: number;
  totalFilas: number;
  archivoTamano: number;
  duracionMs: number;
}
