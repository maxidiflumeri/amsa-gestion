export interface DeudorParaMapper {
    id: number;
    documento: string;
    nombre: string;
    apellido: string;
    montoTotal: number | null;
    fechaVencimiento: Date | null;
    camposAdicionales: any;
    empresa?: { nombre?: string | null } | null;
    remesa?: { nombre?: string | null } | null;
    estadoSituacion?: { descripcion?: string | null } | null;
    estadoGestion?: { descripcion?: string | null } | null;
    motivoNoPago?: { descripcion?: string | null } | null;
}

export type VariableOrigen = 'auto' | 'campo_adicional' | 'manual' | 'mapeo_guardado' | 'literal';

export interface VariableSugerida {
    variable: string;
    valor: string | null;
    origen: VariableOrigen;
    fuente?: string;
}

export interface MapeoGuardado {
    variable: string;
    fuenteTipo: 'campo_deudor' | 'campo_adicional' | 'literal';
    fuenteClave: string;
}

const fmtMoney = (n: number | null | undefined) => {
    if (n == null) return null;
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 }).format(n);
};

const fmtDate = (d: Date | string | null | undefined) => {
    if (!d) return null;
    const date = typeof d === 'string' ? new Date(d) : d;
    if (isNaN(date.getTime())) return null;
    return date.toLocaleDateString('es-AR');
};

const diasMora = (vto: Date | null | undefined) => {
    if (!vto) return null;
    const ms = Date.now() - new Date(vto).getTime();
    const dias = Math.floor(ms / (1000 * 60 * 60 * 24));
    return dias > 0 ? String(dias) : '0';
};

interface CatalogEntry {
    canon: string;
    label: string;
    synonyms: string[];
    resolve: (d: DeudorParaMapper) => string | null;
}

export const CATALOG: CatalogEntry[] = [
    { canon: 'nombre', label: 'Nombre', synonyms: ['nombre', 'first_name', 'nombres'], resolve: d => d.nombre || null },
    { canon: 'apellido', label: 'Apellido', synonyms: ['apellido', 'last_name', 'apellidos'], resolve: d => d.apellido || null },
    {
        canon: 'nombre_completo',
        label: 'Nombre completo',
        synonyms: ['nombre_completo', 'full_name', 'nombreapellido', 'apellidonombre'],
        resolve: d => `${d.nombre ?? ''} ${d.apellido ?? ''}`.trim() || null,
    },
    { canon: 'documento', label: 'Documento (CUIT/DNI)', synonyms: ['documento', 'dni', 'cuit', 'cuil', 'identificacion'], resolve: d => d.documento || null },
    { canon: 'empresa', label: 'Empresa', synonyms: ['empresa', 'cliente', 'razon_social'], resolve: d => d.empresa?.nombre ?? null },
    { canon: 'remesa', label: 'Remesa', synonyms: ['remesa', 'cartera'], resolve: d => d.remesa?.nombre ?? null },
    { canon: 'monto_total', label: 'Monto total ($)', synonyms: ['monto_total', 'monto', 'total', 'deuda_total', 'importe'], resolve: d => fmtMoney(d.montoTotal) },
    { canon: 'deuda', label: 'Deuda ($)', synonyms: ['deuda', 'saldo'], resolve: d => fmtMoney(d.montoTotal) },
    {
        canon: 'fecha_vencimiento',
        label: 'Fecha de vencimiento',
        synonyms: ['fecha_vencimiento', 'vencimiento', 'vto', 'fechavencimiento'],
        resolve: d => fmtDate(d.fechaVencimiento),
    },
    { canon: 'dias_mora', label: 'Días de mora', synonyms: ['dias_mora', 'mora', 'diasmora'], resolve: d => diasMora(d.fechaVencimiento) },
    { canon: 'estado_situacion', label: 'Estado situación', synonyms: ['estado_situacion', 'situacion'], resolve: d => d.estadoSituacion?.descripcion ?? null },
    { canon: 'estado_gestion', label: 'Estado gestión', synonyms: ['estado_gestion', 'gestion'], resolve: d => d.estadoGestion?.descripcion ?? null },
    { canon: 'motivo_no_pago', label: 'Motivo no pago', synonyms: ['motivo_no_pago', 'motivo'], resolve: d => d.motivoNoPago?.descripcion ?? null },
];

function normalizar(s: string): string {
    return s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');
}

function buscarEnCatalogo(varName: string): CatalogEntry | null {
    const norm = normalizar(varName);
    for (const entry of CATALOG) {
        if (entry.synonyms.includes(norm)) return entry;
    }
    return null;
}

export function buscarEnCatalogoPorCanon(canon: string): CatalogEntry | null {
    return CATALOG.find(e => e.canon === canon) ?? null;
}

function buscarEnCamposAdicionales(varName: string, camposAdicionales: any): { valor: string; clave: string } | null {
    if (!camposAdicionales || typeof camposAdicionales !== 'object') return null;
    const norm = normalizar(varName);
    for (const [k, v] of Object.entries(camposAdicionales)) {
        if (normalizar(k) === norm && v != null && v !== '') {
            return { valor: String(v), clave: k };
        }
    }
    return null;
}

function leerCampoAdicionalDirecto(clave: string, camposAdicionales: any): string | null {
    if (!camposAdicionales || typeof camposAdicionales !== 'object') return null;
    const directo = camposAdicionales[clave];
    if (directo != null && directo !== '') return String(directo);
    const norm = normalizar(clave);
    for (const [k, v] of Object.entries(camposAdicionales)) {
        if (normalizar(k) === norm && v != null && v !== '') return String(v);
    }
    return null;
}

function resolverMapeoGuardado(mapeo: MapeoGuardado, deudor: DeudorParaMapper): { valor: string | null; fuente: string } {
    if (mapeo.fuenteTipo === 'campo_deudor') {
        const entry = buscarEnCatalogoPorCanon(mapeo.fuenteClave);
        if (!entry) return { valor: null, fuente: mapeo.fuenteClave };
        return { valor: entry.resolve(deudor), fuente: entry.canon };
    }
    if (mapeo.fuenteTipo === 'campo_adicional') {
        return { valor: leerCampoAdicionalDirecto(mapeo.fuenteClave, deudor.camposAdicionales), fuente: mapeo.fuenteClave };
    }
    if (mapeo.fuenteTipo === 'literal') {
        return { valor: mapeo.fuenteClave ?? null, fuente: 'literal' };
    }
    return { valor: null, fuente: mapeo.fuenteClave };
}

export function autoMapearVariables(
    variables: string[],
    deudor: DeudorParaMapper,
    mapeosGuardados: MapeoGuardado[] = [],
): VariableSugerida[] {
    const mapeoPorVar = new Map<string, MapeoGuardado>();
    for (const m of mapeosGuardados) mapeoPorVar.set(m.variable, m);

    return variables.map(variable => {
        const guardado = mapeoPorVar.get(variable);
        if (guardado) {
            const { valor, fuente } = resolverMapeoGuardado(guardado, deudor);
            return {
                variable,
                valor,
                origen: 'mapeo_guardado' as const,
                fuente: `${guardado.fuenteTipo}:${fuente}`,
            };
        }

        const enCatalogo = buscarEnCatalogo(variable);
        if (enCatalogo) {
            const valor = enCatalogo.resolve(deudor);
            if (valor != null && valor !== '') {
                return { variable, valor, origen: 'auto' as const, fuente: enCatalogo.canon };
            }
        }

        const enAdicionales = buscarEnCamposAdicionales(variable, deudor.camposAdicionales);
        if (enAdicionales) {
            return { variable, valor: enAdicionales.valor, origen: 'campo_adicional' as const, fuente: enAdicionales.clave };
        }

        return { variable, valor: null, origen: 'manual' as const };
    });
}

export function listarFuentesCatalogo(): Array<{ tipo: 'campo_deudor'; clave: string; label: string }> {
    return CATALOG.map(e => ({ tipo: 'campo_deudor' as const, clave: e.canon, label: e.label }));
}
