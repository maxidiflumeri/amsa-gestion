export type Columna = {
  id: string
  /** Vacío = columna fija: no sale de los datos, imprime `valorFijo` (vacío si no hay). */
  path: string
  label: string
  /** Solo en columnas fijas: el texto que va en todas las filas. */
  valorFijo?: string
  tipo?: 'texto' | 'numero' | 'fecha' | 'boolean' | 'moneda' | 'telefono' | 'dias'
  formato?: string
  ancho?: number
  cardinalidad?: 'expandir' | 'concatenar' | 'primero' | 'ultimo'
  separadorConcat?: string
  formatoTelefonoId?: number
  /** Solo en columnas de tipo número: cantidad de decimales (0 a 4). Con alguna de las tres propiedades el número se arma con estos separadores (coma decimal y punto de miles por defecto). */
  decimales?: number
  separadorDecimal?: ',' | '.'
  separadorMiles?: '.' | ',' | ''
}

export type FormatoTelefono = {
  id: number
  nombre: string
  descripcion?: string
  patron: string
  activo: boolean
}

export type Filtro = {
  id: string
  path: string
  operador: 'eq' | 'neq' | 'in' | 'notIn' | 'contains' | 'startsWith' | 'endsWith' |
            'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'notBetween' | 'isNull' | 'isNotNull'
  valor?: any
  variable?: boolean
  labelVariable?: string
  valorPorDefecto?: any
  obligatorio?: boolean
  tipoEscalar?: string
  enumValues?: string[]
}

export type Ordenamiento = {
  path: string
  direccion: 'asc' | 'desc'
}

export type Agrupacion = {
  path: string
  mostrarSubtotales?: boolean
  saltoPagina?: boolean
}

export type Total = {
  path: string
  /** La columna a la que está atado (su `id`). Sin él, el backend usa la única columna con ese campo; con dos, da 400 por ambiguo. */
  columnaId?: string
  funcion: 'sum' | 'avg' | 'count' | 'min' | 'max'
  label?: string
}

export type Definicion = {
  columnas: Columna[]
  filtros: Filtro[]
  ordenamientos: Ordenamiento[]
  agrupaciones?: Agrupacion[]
  totales?: Total[]
  cardinalidadDefault: 'expandir' | 'concatenar' | 'primero' | 'ultimo'
  limiteFilas?: number
}

export type OpcionesXlsx = {
  headerColor?: string
  freezeRow?: boolean
  autoWidth?: boolean
  brandingEmpresa?: {
    nombreEmpresa?: string
    nombreReporte?: string
    fechaGeneracion?: string
    filtrosAplicados?: string
  }
}

export type OpcionesPdf = {
  landscape?: boolean
  pageSize?: 'A4' | 'LETTER'
  header?: string
  footer?: boolean
  brandingEmpresa?: {
    nombreEmpresa?: string
    nombreReporte?: string
    fechaGeneracion?: string
    filtrosAplicados?: string
  }
}

export type OpcionesCsv = {
  separador?: string
  encoding?: 'utf8' | 'latin1'
  bom?: boolean
  quoting?: boolean
  lineEnding?: '\r\n' | '\n'
  incluirHeader?: boolean
}

export type OpcionesTxt = {
  separador?: string
  encoding?: 'utf8' | 'latin1'
  lineEnding?: '\r\n' | '\n'
  incluirHeader?: boolean
  anchoFijo?: number[]
  /** Una por columna de ancho fijo; por defecto, izquierda. */
  alineacion?: ('izquierda' | 'derecha')[]
  /** Una por columna de ancho fijo; por defecto, espacio. */
  relleno?: (' ' | '0')[]
}

export type OpcionesFormato = {
  xlsx?: OpcionesXlsx
  pdf?: OpcionesPdf
  csv?: OpcionesCsv
  txt?: OpcionesTxt
}

export type Plantilla = {
  id?: number
  nombre: string
  descripcion?: string
  raiz: string
  empresaId?: number | null
  activo?: boolean
  definicion: Definicion
  formatoSalida: 'xlsx' | 'csv' | 'txt' | 'pdf'
  opcionesFormato?: OpcionesFormato
  /** Solo al crear: la propuesta del asistente de la que sale (se vincula al guardar). */
  asistentePropuestaId?: number
  createdAt?: string
  updatedAt?: string
  empresa?: { id: number; nombre: string } | null
  _count?: { ejecuciones?: number }
}

export type NodoCatalogo = {
  path: string
  nombre: string
  label: string
  descripcion?: string
  tipo: 'escalar' | 'relacion-1-1' | 'relacion-1-n' | 'json'
  tipoEscalar?: 'texto' | 'numero' | 'fecha' | 'boolean' | 'enum'
  enumValues?: string[]
  cardinalidad?: '1-1' | '1-N' | 'opcional'
  agregadoresPermitidos?: string[]
  filtrosPermitidos?: string[]
  hijos?: NodoCatalogo[]
  oculto?: boolean
}

