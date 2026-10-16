// Qué bloques de Inicio se dibujan y en qué columna (docs/inicio-spec.md §1 y §6.2). Puro: decide solo por permisos.
// Un bloque sin permiso no se dibuja. Un bloque con permiso y sin datos muestra su vacío. La única excepción es B8.

export type BloqueId = 'B4' | 'B5' | 'B6' | 'B7' | 'B8' | 'B9' | 'B10';
export type Tiene = (permiso: string) => boolean;

export interface Entorno {
    /** B8 es el único que depende de los datos: sin cargas propias en curso ni terminadas hoy, no se dibuja. */
    hayImportaciones: boolean;
}

const alguno = (tiene: Tiene, ...p: string[]) => p.some((x) => tiene(x));

export const puedeBuscar = (tiene: Tiene) => tiene('deudores.ver');

export function bloquesVisibles(tiene: Tiene, { hayImportaciones }: Entorno): Record<BloqueId, boolean> {
    const gestiones = alguno(tiene, 'comentarios.ver', 'comentarios.crear');
    return {
        B4: gestiones,
        B5: gestiones,
        B6: tiene('comentarios.ver') && tiene('deudores.ver'),
        // Las cuotas son de los convenios que armé: hace falta poder armarlos y verlos. Con solo "Ver convenios" (el operador)
        // la agenda estaría siempre vacía.
        B7: tiene('promesas.ver') || (tiene('convenios.crear') && tiene('convenios.ver')),
        B8: tiene('importacion.ver_historial') && hayImportaciones,
        B9: tiene('auditoria.ver'),
        B10: tiene('reportes.ver'),
    };
}

export interface Distribucion {
    principal: BloqueId[];
    lateral: BloqueId[];
    /** `dos`: principal 8/12 y lateral 4/12. `solo-principal`: 12/12. `solo-lateral`: todo el lateral en una grilla de 2 columnas. */
    modo: 'dos' | 'solo-principal' | 'solo-lateral' | 'vacio';
}

/** Fila 3. B4 va aparte, en su propia fila. */
export function distribuir(visibles: Record<BloqueId, boolean>): Distribucion {
    const principal = (['B7', 'B6'] as const).filter((b) => visibles[b]);
    const lateral = (['B5', 'B8', 'B9', 'B10'] as const).filter((b) => visibles[b]);
    if (principal.length === 0 && lateral.length === 0) return { principal, lateral, modo: 'vacio' };
    if (principal.length === 0) return { principal, lateral, modo: 'solo-lateral' };
    if (lateral.length === 0) return { principal, lateral, modo: 'solo-principal' };
    return { principal, lateral, modo: 'dos' };
}

/** Los dos últimos indicadores de B4: con `promesas.ver` los de promesas, sin él los de la semana. */
export const conIndicadoresDePromesas = (tiene: Tiene) => tiene('promesas.ver');

export interface Acceso {
    id: 'gestion' | 'importar' | 'historial' | 'reportes' | 'tableros';
    etiqueta: string;
    ruta: string;
}

/** Hasta 4, en orden de prioridad. El historial solo aparece si no puede importar. */
export function accesosRapidos(tiene: Tiene): Acceso[] {
    const lista: Acceso[] = [];
    if (tiene('deudores.ver')) lista.push({ id: 'gestion', etiqueta: 'Gestión', ruta: '/gestion' });
    if (tiene('importacion.ejecutar')) lista.push({ id: 'importar', etiqueta: 'Nueva importación', ruta: '/carga' });
    else if (tiene('importacion.ver_historial')) lista.push({ id: 'historial', etiqueta: 'Historial de importaciones', ruta: '/historial-importaciones' });
    if (tiene('reportes.ver')) lista.push({ id: 'reportes', etiqueta: 'Reportes', ruta: '/reportes' });
    if (tiene('dashboards.ver')) lista.push({ id: 'tableros', etiqueta: 'Tableros', ruta: '/dashboards' });
    return lista.slice(0, 4);
}
