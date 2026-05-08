export type ColumnaV2 = {
  id: string
  path: string
  label: string
  tipo?: 'texto' | 'numero' | 'fecha' | 'boolean' | 'moneda'
  formato?: string
  ancho?: number
  cardinalidad?: 'expandir' | 'concatenar' | 'primero' | 'ultimo'
  separadorConcat?: string
}

export type FiltroV2 = {
  id: string
  path: string
  operador: 'eq' | 'neq' | 'in' | 'notIn' | 'contains' | 'startsWith' | 'endsWith' |
            'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'isNull' | 'isNotNull' | 'rangoClaves'
  valor?: any
  variable?: boolean
  labelVariable?: string
  valorPorDefecto?: any
}

export type OrdenamientoV2 = {
  path: string
  direccion: 'asc' | 'desc'
}

export type AgrupacionV2 = {
  path: string
  mostrarSubtotales?: boolean
  saltoPagina?: boolean
}

export type TotalV2 = {
  path: string
  funcion: 'sum' | 'avg' | 'count' | 'min' | 'max'
  label?: string
}

export type DefinicionV2 = {
  columnas: ColumnaV2[]
  filtros: FiltroV2[]
  ordenamientos: OrdenamientoV2[]
  agrupaciones?: AgrupacionV2[]
  totales?: TotalV2[]
  cardinalidadDefault: 'expandir' | 'concatenar' | 'primero' | 'ultimo'
  limiteFilas?: number
}

export type PlantillaV2 = {
  id?: number
  nombre: string
  descripcion?: string
  raiz: string
  empresaId?: number | null
  activo?: boolean
  definicion: DefinicionV2
  formatoSalida: 'xlsx' | 'csv' | 'txt' | 'pdf'
  opcionesFormato?: any
  createdAt?: string
  updatedAt?: string
}

export type NodoCatalogo = {
  path: string
  nombre: string
  label: string
  tipo: 'escalar' | 'relacion-1-1' | 'relacion-1-n' | 'json'
  tipoEscalar?: 'texto' | 'numero' | 'fecha' | 'boolean' | 'enum'
  enumValues?: string[]
  cardinalidad?: '1-1' | '1-N' | 'opcional'
  agregadoresPermitidos?: string[]
  filtrosPermitidos?: string[]
  hijos?: NodoCatalogo[]
  oculto?: boolean
}

export type PlantillaV1 = {
  id: number
  nombre: string
  descripcion?: string
  empresaId?: number
  _version: 'v1'
}

export type PlantillaUnificada = (PlantillaV2 & { _version: 'v2' }) | PlantillaV1
