// Contrato de GET /api/inicio/mi-dia (docs/inicio-spec.md §5.3). El frontend copia este archivo tal cual a src/api/inicio.ts.
/** GET /api/inicio/mi-dia. Fechas `dia`: 'YYYY-MM-DD' en hora de Argentina. Instantes: ISO 8601 UTC. */
export interface MiDiaDto {
    generadoEn: string;                 // ISO del momento del cálculo
    hoy: string;                        // 'YYYY-MM-DD' local
    /** Bloques que el backend intentó calcular y fallaron. El frontend muestra el aviso en ese bloque. */
    errores: Array<'gestiones' | 'retomar' | 'agenda' | 'promesas' | 'importacionesHoy' | 'reportes'>;
    gestiones: GestionesDto | null;              // comentarios.ver || comentarios.crear
    retomar: RetomarItemDto[] | null;            // comentarios.ver && deudores.ver
    agenda: AgendaDto | null;                    // promesas.ver || convenios.crear
    promesas: IndicadoresPromesasDto | null;     // promesas.ver
    importacionesHoy: ImportacionTerminadaDto[] | null; // importacion.ver_historial
    reportes: EjecucionResumenDto[] | null;      // reportes.ver
}

export interface GestionesDto {
    hoy: number;                        // comentarios manuales míos con fecha >= hoy 00:00 local
    casosHoy: number;                   // deudorId distintos de esos
    ayerALaMismaHora: { gestiones: number; casos: number };
    /** Promedio de gestiones hasta esta misma hora del día, en los últimos ≤7 días con al menos una gestión
     *  (buscados entre los 13 días anteriores a hoy). null si no hay ninguno. */
    promedioALaMismaHora: number | null;
    diasBase: number;                   // cuántos días entraron en ese promedio (0..7)
    semana: { desde: string; gestiones: number; casos: number; diasConGestion: number }; // desde = lunes 'YYYY-MM-DD'
    /** 14 entradas sin huecos, de hace 13 días a hoy (incluido), en orden. */
    serie: Array<{ dia: string; gestiones: number; casos: number }>;
    /** true si se alcanzó el tope de filas leídas (§5.4 G1). Los números son un piso. */
    truncado: boolean;
}

export interface RetomarItemDto {
    deudorId: number;
    nombre: string;                     // `${nombre} ${apellido}` recortado
    documento: string;                  // completo: el usuario tiene deudores.ver
    empresa: string;                    // empresa.nombre
    ultimaGestion: string;              // ISO de mi último comentario manual en el caso
    ultimoTexto: string;                // ese texto, máx. 120 caracteres + '…'
    gestionesMias30d: number;
    estadoGestion: string | null;       // parametro.descripcion del estado de gestión actual del caso
    estadoSituacion: string | null;     // parametro.descripcion del estado de situación actual
}

export type AgendaTipo = 'PROMESA' | 'CUOTA';
export interface AgendaItemDto {
    tipo: AgendaTipo;
    id: number;                         // promesa_pago.id o cuota_convenio.id
    deudorId: number;
    nombre: string;
    documento: string;
    empresa: string;
    dia: string;                        // fecha calendario de la promesa o del vencimiento de la cuota
    monto: number | null;               // promesa.monto (puede ser null) o cuota.importe
    /** PROMESA: VIGENTE | CUMPLIDA | INCUMPLIDA. CUOTA: PENDIENTE | PAGADA | VENCIDA. */
    estado: string;
    cerradaEn: string | null;           // PROMESA: cerradaEn. CUOTA: fechaPago
    nroCuota: number | null;            // solo CUOTA
    cantCuotas: number | null;          // solo CUOTA
    observacion: string | null;         // PROMESA: observacion recortada a 80
}
export interface AgendaDto {
    hoy: AgendaItemDto[];               // dia = hoy (cualquier estado salvo ANULADA)
    proximos: AgendaItemDto[];          // hoy < dia <= hoy+7, PROMESA VIGENTE / CUOTA PENDIENTE
    sinCumplir: AgendaItemDto[];        // hoy-7 <= dia < hoy, PROMESA INCUMPLIDA / CUOTA VENCIDA
    totales: { hoy: number; proximos: number; sinCumplir: number }; // antes del recorte
    limite: number;                     // 50: tope por lista
    incluye: { promesas: boolean; cuotas: boolean };                // qué tipos entraron según permisos
}

export interface IndicadoresPromesasDto {
    tomadas7d: number;                  // mías con createdAt >= hoy-6 00:00 local
    /** Mías con dia en [hoy-30, hoy) ya cerradas como CUMPLIDA o INCUMPLIDA (las ANULADA no cuentan). */
    vencidas30d: { total: number; cumplidas: number };
    vencenHoy: { cantidad: number; monto: number }; // mías VIGENTE con dia = hoy; monto suma los no nulos
}

export interface ImportacionTerminadaDto {
    remesaId: number;
    empresa: string;
    nombre: string;                     // remesa.nombre
    numeroRemesa: string;
    resultado: string | null;           // import_progreso.resultado: OK | CON_ERRORES | CON_ADVERTENCIAS | SIN_FILAS | FALLIDA | CANCELADA
    terminadaEn: string;                // import_progreso.finishedAt
    ok: number;
    err: number;
}

export interface EjecucionResumenDto {
    id: number;
    plantilla: string;                  // plantilla_reporte.nombre
    estado: 'PENDIENTE' | 'EJECUTANDO' | 'FINALIZADA' | 'FALLIDA' | 'CANCELADA';
    progreso: number;                   // 0..100
    formato: string | null;
    totalFilas: number | null;
    creadaEn: string;
    terminadaEn: string | null;
    descargable: boolean;               // estado FINALIZADA && archivoPath != null
}
