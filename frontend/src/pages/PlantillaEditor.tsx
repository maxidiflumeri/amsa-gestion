import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Box,
    Divider,
    FormControl,
    FormControlLabel,
    FormHelperText,
    FormLabel,
    InputLabel,
    MenuItem,
    Paper,
    Radio,
    RadioGroup,
    Select,
    Stack,
    Switch,
    TextField,
    Typography,
} from '@mui/material'
import SaveIcon from '@mui/icons-material/Save'
import { useNavigate, useParams } from 'react-router-dom'
import api from '../api/axios'
import { useNotify } from '../hooks/useNotify'
import { PageHeader, LoadingSkeleton } from '../components/ui'
import MappingEditor, {
    MappingField,
    MappingBlock,
} from '../components/import/MappingEditor'
import AccionesEditor, { AccionesConfig } from '../components/import/AccionesEditor'
import MultirregistroEditor, { PRESET_TOYOTA_87 } from '../components/import/MultirregistroEditor'
import MultiarchivoEditor, { PRESET_TOYOTA_TCFA } from '../components/import/MultiarchivoEditor'
import AnchoFijoEditor, { layoutATexto, parsearLayout } from '../components/import/AnchoFijoEditor'
import FiltroFilasEditor, { FiltroFila } from '../components/import/FiltroFilasEditor'

// ─── Constantes ──────────────────────────────────────────────────────────────

const CATEGORIAS = [
    'DEUDORES',
    'FACTURAS',
    'ENRIQUECIMIENTO',
    'PAGOS',
    'CONTACTOS',
    'DEUDORES_Y_FACTURAS',
    'ACTUALIZACIONES',
    'ACCIONES',
    'MULTIRREGISTRO',
    'MULTIARCHIVO',
]

const ENTITY_MAP: Record<string, string> = {
    DEUDORES: 'DEUDOR',
    FACTURAS: 'FACTURA',
    ENRIQUECIMIENTO: 'ENRIQ_MIXTO',
    PAGOS: 'PAGO',
    CONTACTOS: 'CONTACTO',
    DEUDORES_Y_FACTURAS: 'MIXTO',
    ACTUALIZACIONES: 'ACTUALIZACION',
    ACCIONES: 'ACCIONES',
    MULTIRREGISTRO: 'MIXTO',
    MULTIARCHIVO: 'MIXTO',
}

// ─── Helpers de mapeo ────────────────────────────────────────────────────────

function mappingJsonToFields(mapping: Record<string, unknown>): MappingField[] {
    const fields: MappingField[] = []

    if (mapping?.columns) {
        for (const [dest, cfg] of Object.entries(mapping.columns as Record<string, unknown>)) {
            const c = cfg as Record<string, unknown>
            fields.push({
                destField: dest,
                fromIndex: (c.fromIndex as number) ?? 0,
                staticValue: c.staticValue as string | undefined,
                transforms: (c.transforms as string[]) ?? [],
                isExtra: false,
            })
        }
    }

    if (mapping?.extras) {
        for (const [dest, cfg] of Object.entries(mapping.extras as Record<string, unknown>)) {
            const c = cfg as Record<string, unknown>
            fields.push({
                destField: dest,
                fromIndex: (c.fromIndex as number) ?? 0,
                staticValue: c.staticValue as string | undefined,
                transforms: (c.transforms as string[]) ?? [],
                isExtra: true,
            })
        }
    }

    return fields
}

function mappingJsonToBlocks(mapping: Record<string, unknown>): MappingBlock[] {
    const blocks: MappingBlock[] = []
    if (mapping?.blocks && Array.isArray(mapping.blocks)) {
        for (const b of mapping.blocks as Array<Record<string, unknown>>) {
            const blockFields: MappingField[] = []
            if (b.columns) {
                for (const [dest, cfg] of Object.entries(b.columns as Record<string, unknown>)) {
                    const c = cfg as Record<string, unknown>
                    blockFields.push({
                        destField: dest,
                        fromIndex: (c.fromIndex as number) ?? 0,
                        staticValue: c.staticValue as string | undefined,
                        transforms: (c.transforms as string[]) ?? [],
                        isExtra: false,
                    })
                }
            }
            blocks.push({ entity: b.entity as string, fields: blockFields })
        }
    }
    return blocks
}

function fieldsToMappingJson(
    fields: MappingField[],
    blocks: MappingBlock[],
    entity: string,
    matchKeys: string[]
): Record<string, unknown> {
    const columns: Record<string, unknown> = {}
    const extras: Record<string, unknown> = {}

    for (const f of fields) {
        if (!f.destField) continue
        const cfg: Record<string, unknown> = {
            transforms: f.transforms.length > 0 ? f.transforms : undefined,
        }
        if (f.fromIndex === -1) {
            cfg.fromIndex = -1
            cfg.staticValue = f.staticValue
        } else {
            cfg.fromIndex = f.fromIndex
        }
        if (f.isExtra) {
            extras[f.destField] = cfg
        } else {
            columns[f.destField] = cfg
        }
    }

    const mappedBlocks: Record<string, unknown>[] = []
    for (const b of blocks) {
        const blkCols: Record<string, unknown> = {}
        for (const f of b.fields) {
            if (!f.destField) continue
            const bCfg: Record<string, unknown> = {
                transforms: f.transforms.length > 0 ? f.transforms : undefined,
            }
            if (f.fromIndex === -1) {
                bCfg.fromIndex = -1
                bCfg.staticValue = f.staticValue
            } else {
                bCfg.fromIndex = f.fromIndex
            }
            blkCols[f.destField] = bCfg
        }
        if (Object.keys(blkCols).length > 0) {
            mappedBlocks.push({ entity: b.entity, columns: blkCols })
        }
    }

    return {
        entity,
        matchKeys,
        columns,
        ...(Object.keys(extras).length > 0 ? { extras } : {}),
        ...(mappedBlocks.length > 0 ? { blocks: mappedBlocks } : {}),
        defaults: {},
    }
}

// ─── Componente ──────────────────────────────────────────────────────────────

interface Parametro {
    id: number
    clave: string
    descripcion: string
    grupo: string
}

/** Valores del combo "Formato / Separador" que NO son personalizados. `'\t'` es un tab real. */
const SEP_ESTANDAR = ['|', ',', ';', '\t', 'EXCEL']

/**
 * Repara el separador guardado por versiones viejas del combo: el tabulador se guardaba
 * como la cadena literal de 2 caracteres "\t" (barra + t) en vez del tab real (0x09), por
 * eso al importar no separaba nada. Espejo del `resolveDelimiter` del backend.
 */
function normalizarSeparador(sep: string): string {
    if (sep === '\\t' || sep === 'tab' || sep === 'TAB') return '\t'
    return sep
}

const PlantillaEditor: React.FC = () => {
    const { id } = useParams<{ id?: string }>()
    const navigate = useNavigate()
    const notify = useNotify()

    const isEdit = Boolean(id)

    // Form state
    const [nombre, setNombre] = useState('')
    const [categoria, setCategoria] = useState('DEUDORES')
    const [version, setVersion] = useState(1)
    const [separador, setSeparador] = useState('|')
    // 'STD' = una opción del combo; 'OTRO' = separador personalizado (no se auto-cambia al
    // tipear una coma). Explícito para no depender de si el valor "parece" estándar.
    const [sepMode, setSepMode] = useState<'STD' | 'OTRO'>('STD')
    const [tieneHeader, setTieneHeader] = useState(false)
    const [matchKeys, setMatchKeys] = useState('empresaId,documento')
    const [fields, setFields] = useState<MappingField[]>([])
    const [blocks, setBlocks] = useState<MappingBlock[]>([])
    const [multiarchivoConfig, setMultiarchivoConfig] = useState(
        JSON.stringify(PRESET_TOYOTA_TCFA, null, 2),
    )
    const [multirregistroConfig, setMultirregistroConfig] = useState(
        JSON.stringify(PRESET_TOYOTA_87, null, 2),
    )
    // Archivos de ancho fijo (exports de SAP): los campos van por posición, no hay separador.
    // El layout se edita como texto `nombre;inicio;largo` (ver AnchoFijoEditor).
    const [anchoFijoLayout, setAnchoFijoLayout] = useState('')
    const [anchoFijoEncoding, setAnchoFijoEncoding] = useState<'latin1' | 'utf8'>('latin1')
    // Qué subconjunto del archivo se importa. Vacío = todas las filas (comportamiento clásico).
    const [filtroFilas, setFiltroFilas] = useState<FiltroFila[]>([])
    const [defaultEstadoSituacionId, setDefaultEstadoSituacionId] = useState<number | ''>('')
    const [defaultEstadoGestionId, setDefaultEstadoGestionId] = useState<number | ''>('')
    const [montoDeudorDesdeFacturas, setMontoDeudorDesdeFacturas] =
        useState<'NO' | 'SI_VACIO' | 'SIEMPRE'>('SI_VACIO')
    const [modoActualizacion, setModoActualizacion] =
        useState<'RECONCILIAR' | 'SOLO_DATOS'>('RECONCILIAR')
    const [comportamientoDeudaMayor, setComportamientoDeudaMayor] =
        useState<'FACTURA_NUEVA' | 'ACTUALIZAR_SALDO'>('FACTURA_NUEVA')
    const [crearNuevosCasos, setCrearNuevosCasos] = useState(true)
    const [accionAusente, setAccionAusente] =
        useState<'PAGO_TODO' | 'DESASIGNAR' | 'IGNORAR'>('PAGO_TODO')
    // Qué identifica a un caso dentro de la remesa. Por documento es lo de siempre; por número de
    // cliente es lo que necesitan las carteras donde un mismo DNI tiene varias cuentas.
    const [identidadDeudor, setIdentidadDeudor] =
        useState<'DOCUMENTO' | 'NRO_CLIENTE'>('DOCUMENTO')
    // División de la carga en una remesa por corte. `-1` = el criterio no se usa.
    const [divNominaIndex, setDivNominaIndex] = useState<number>(-1)
    const [divGestionIndex, setDivGestionIndex] = useState<number>(-1)

    const [accionesConfig, setAccionesConfig] = useState<AccionesConfig>({
        matchMode: 'DEUDOR',
        matchColumn: { field: 'nro_cliente', fromIndex: 0 },
        saltearCanceladas: false,
        operaciones: [],
    })
    const [paramsMotivo, setParamsMotivo] = useState<Parametro[]>([])

    // Flujos donde tiene sentido calcular el importe del deudor desde las facturas
    const esFlujoFacturas = categoria === 'FACTURAS' || categoria === 'DEUDORES_Y_FACTURAS'
    // Categorías que crean casos: son las únicas donde la identidad cambia algo.
    const esFlujoCasos = categoria === 'DEUDORES' || categoria === 'DEUDORES_Y_FACTURAS'
    const esActualizacion = categoria === 'ACTUALIZACIONES'
    const esAcciones = categoria === 'ACCIONES'
    // MULTIRREGISTRO tampoco usa el mapeo columna→campo: el parser arma las filas y acá solo se
    // configura el layout del archivo.
    const esMultirregistro = categoria === 'MULTIRREGISTRO'
    // MULTIARCHIVO: igual que multirregistro, pero el layout se declara por nombre de columna
    // porque los archivos del paquete traen encabezado.
    const esMultiarchivo = categoria === 'MULTIARCHIVO'
    const sinMapeoDeColumnas = esAcciones || esMultirregistro || esMultiarchivo
    // Ancho fijo es una opción del combo de formato, no una categoría: cualquier categoría de "una
    // fila = un registro" puede venir en un archivo sin separador.
    const esAnchoFijo = separador === 'ANCHO_FIJO'
    // Nombres de las columnas del layout, para que el filtro las liste en vez de pedir un índice.
    const columnasAnchoFijo = useMemo(
        () => (esAnchoFijo ? parsearLayout(anchoFijoLayout).columnas.map((c) => c.nombre) : []),
        [esAnchoFijo, anchoFijoLayout],
    )

    // Empresa del editor: para creación la toma de la lista via state o default
    const [empresaId, setEmpresaId] = useState<number | null>(null)

    // Parámetros de situación y gestión
    const [paramsSituacion, setParamsSituacion] = useState<Parametro[]>([])
    const [paramsGestion, setParamsGestion] = useState<Parametro[]>([])
    const [loadingParams, setLoadingParams] = useState(false)

    const [loading, setLoading] = useState(false)
    const [initialLoading, setInitialLoading] = useState(isEdit)

    // Cargar parámetros de situación y gestión según empresaId
    const loadParametros = useCallback(async (eid: number) => {
        setLoadingParams(true)
        try {
            const [resSit, resGest, resMot] = await Promise.all([
                api.get('/parametros', { params: { empresaId: eid, grupo: 'situacion', activo: 'true' } }),
                api.get('/parametros', { params: { empresaId: eid, grupo: 'gestion', activo: 'true' } }),
                api.get('/parametros', { params: { empresaId: eid, grupo: 'motivo_no_pago', activo: 'true' } }),
            ])
            setParamsSituacion(resSit.data ?? [])
            setParamsGestion(resGest.data ?? [])
            setParamsMotivo(resMot.data ?? [])
        } catch {
            setParamsSituacion([])
            setParamsGestion([])
            setParamsMotivo([])
        } finally {
            setLoadingParams(false)
        }
    }, [])

    // Cargar datos cuando es edición
    const loadPlantilla = useCallback(async () => {
        if (!id) return
        setInitialLoading(true)
        try {
            const res = await api.get(`/import/plantilla/${id}`)
            const p = res.data
            setNombre(p.nombre)
            setCategoria(p.categoria)
            setVersion(p.version)
            const sepCargado = normalizarSeparador(p.separador ?? '|')
            setSeparador(sepCargado)
            setSepMode(SEP_ESTANDAR.includes(sepCargado) ? 'STD' : 'OTRO')
            setTieneHeader(p.tieneHeader)
            setMatchKeys(
                (p.mappingJson?.matchKeys ?? ['empresaId', 'documento']).join(',')
            )
            setFields(mappingJsonToFields(p.mappingJson))
            setBlocks(mappingJsonToBlocks(p.mappingJson))
            setEmpresaId(p.empresaId ?? null)
            setDefaultEstadoSituacionId(p.defaultEstadoSituacionId ?? '')
            setDefaultEstadoGestionId(p.defaultEstadoGestionId ?? '')
            setMontoDeudorDesdeFacturas(p.mappingJson?.montoDeudorDesdeFacturas ?? 'SI_VACIO')
            setModoActualizacion(p.mappingJson?.modoActualizacion ?? 'RECONCILIAR')
            setComportamientoDeudaMayor(p.mappingJson?.comportamientoDeudaMayor ?? 'FACTURA_NUEVA')
            setCrearNuevosCasos(p.mappingJson?.crearNuevosCasos !== false)
            setAccionAusente(p.mappingJson?.accionAusente ?? 'PAGO_TODO')
            if (p.mappingJson?.acciones) setAccionesConfig(p.mappingJson.acciones)
            if (p.mappingJson?.multiarchivo) {
                setMultiarchivoConfig(JSON.stringify(p.mappingJson.multiarchivo, null, 2))
            }
            if (p.mappingJson?.multirregistro) {
                setMultirregistroConfig(JSON.stringify(p.mappingJson.multirregistro, null, 2))
            }
            if (p.mappingJson?.formato === 'ANCHO_FIJO') {
                // El formato viaja en el mappingJson, pero en la UI es una opción del combo de
                // separador: es donde el operador espera elegir cómo viene el archivo.
                setSeparador('ANCHO_FIJO')
                setSepMode('STD')
                setAnchoFijoLayout(layoutATexto(p.mappingJson.anchoFijo?.columnas ?? []))
                setAnchoFijoEncoding(p.mappingJson.anchoFijo?.encoding === 'utf8' ? 'utf8' : 'latin1')
            }
            setFiltroFilas(p.mappingJson?.filtroFilas ?? [])
            setIdentidadDeudor(p.mappingJson?.identidadDeudor === 'NRO_CLIENTE' ? 'NRO_CLIENTE' : 'DOCUMENTO')
            setDivNominaIndex(p.mappingJson?.divisionRemesa?.porNomina?.fromIndex ?? -1)
            setDivGestionIndex(p.mappingJson?.divisionRemesa?.porGestion?.fromIndex ?? -1)
        } catch (err) {
            notify.error(err as Error)
            navigate('/plantillas')
        } finally {
            setInitialLoading(false)
        }
    }, [id])

    useEffect(() => {
        if (isEdit) {
            loadPlantilla()
        } else {
            const stored = sessionStorage.getItem('plantillas_empresaId')
            if (stored) setEmpresaId(Number(stored))
        }
    }, [isEdit, loadPlantilla])

    // Al pasar a MULTIRREGISTRO en una plantilla nueva, el separador correcto es ";" (el que usan
    // estos archivos), no el "|" que viene por defecto: evita que el operador tenga que deducirlo.
    useEffect(() => {
        if (!isEdit && (categoria === 'MULTIRREGISTRO' || categoria === 'MULTIARCHIVO') && separador === '|') {
            setSeparador(';')
            setSepMode('STD')
        }
    }, [categoria, isEdit])

    // Guardar empresaId en sessionStorage cuando cambia (modo creación)
    useEffect(() => {
        if (!isEdit && empresaId) {
            sessionStorage.setItem('plantillas_empresaId', String(empresaId))
        }
    }, [empresaId, isEdit])

    // Cuando cambia empresaId: en creación resetea selects, en ambos modos recarga parámetros
    useEffect(() => {
        if (!empresaId) return
        if (!isEdit) {
            setDefaultEstadoSituacionId('')
            setDefaultEstadoGestionId('')
        }
        loadParametros(empresaId)
    }, [empresaId, isEdit, loadParametros])

    const handleSave = async () => {
        if (!nombre.trim()) {
            notify.error('El nombre es obligatorio')
            return
        }
        if (esAcciones) {
            if (accionesConfig.matchMode === 'CONTACTO') {
                if (!accionesConfig.contactoValor) {
                    notify.error('Configurá el tipo y la columna del contacto a eliminar')
                    return
                }
            } else {
                if (!accionesConfig.operaciones.length) {
                    notify.error('Agregá al menos una operación a la acción masiva')
                    return
                }
                if (!accionesConfig.matchColumn) {
                    notify.error('Configurá la columna de match (Nº Cliente, Documento o ID)')
                    return
                }
            }
        } else if (esMultirregistro) {
            try {
                JSON.parse(multirregistroConfig)
            } catch {
                notify.error('El layout del archivo no es un JSON válido')
                return
            }
        } else if (esMultiarchivo) {
            try {
                const cfg = JSON.parse(multiarchivoConfig)
                // Sin los patrones de nombre no hay forma de saber qué archivo es cuál al subirlos.
                if (!cfg?.archivos?.deudores || !cfg?.archivos?.detalle) {
                    notify.error('El layout tiene que declarar los patrones de nombre de deudores y detalle')
                    return
                }
            } catch {
                notify.error('El layout del paquete no es un JSON válido')
                return
            }
        } else if (fields.filter((f) => f.destField).length === 0) {
            notify.error('Agregá al menos un campo de mapeo')
            return
        }
        if (!esAcciones && !defaultEstadoSituacionId) {
            notify.error('Seleccioná el estado de situación inicial')
            return
        }
        if (!esAcciones && !defaultEstadoGestionId) {
            notify.error('Seleccioná el estado de gestión inicial')
            return
        }

        setLoading(true)

        const entity = ENTITY_MAP[categoria] ?? 'DEUDOR'
        const keys = matchKeys
            .split(',')
            .map((k) => k.trim())
            .filter(Boolean)
        const mappingJson = fieldsToMappingJson(fields, blocks, entity, keys)
        if (esFlujoFacturas) {
            ;(mappingJson as Record<string, unknown>).montoDeudorDesdeFacturas = montoDeudorDesdeFacturas
        }
        if (esActualizacion) {
            ;(mappingJson as Record<string, unknown>).modoActualizacion = modoActualizacion
            ;(mappingJson as Record<string, unknown>).comportamientoDeudaMayor = comportamientoDeudaMayor
            ;(mappingJson as Record<string, unknown>).crearNuevosCasos = crearNuevosCasos
            // SOLO_DATOS es incompatible con "pagó todo" (el backend lo rechaza) → coerción a IGNORAR.
            ;(mappingJson as Record<string, unknown>).accionAusente =
                modoActualizacion === 'SOLO_DATOS' && accionAusente === 'PAGO_TODO'
                    ? 'IGNORAR'
                    : accionAusente
        }
        if (esAcciones) {
            ;(mappingJson as Record<string, unknown>).acciones = accionesConfig
        }
        if (esMultirregistro) {
            ;(mappingJson as Record<string, unknown>).multirregistro = JSON.parse(multirregistroConfig)
        }
        if (esMultiarchivo) {
            ;(mappingJson as Record<string, unknown>).multiarchivo = JSON.parse(multiarchivoConfig)
        }
        if (esAnchoFijo) {
            const { columnas, error } = parsearLayout(anchoFijoLayout)
            if (error) {
                notify.error(`Revisá el layout de ancho fijo: ${error}`)
                setLoading(false)
                return
            }
            ;(mappingJson as Record<string, unknown>).formato = 'ANCHO_FIJO'
            ;(mappingJson as Record<string, unknown>).anchoFijo = { encoding: anchoFijoEncoding, columnas }
        }
        if (filtroFilas.length > 0) {
            ;(mappingJson as Record<string, unknown>).filtroFilas = filtroFilas
        }
        if (esFlujoCasos && identidadDeudor === 'NRO_CLIENTE') {
            ;(mappingJson as Record<string, unknown>).identidadDeudor = 'NRO_CLIENTE'
        }
        if (divNominaIndex >= 0 || divGestionIndex >= 0) {
            ;(mappingJson as Record<string, unknown>).divisionRemesa = {
                ...(divNominaIndex >= 0
                    ? { porNomina: { fromIndex: divNominaIndex, etiqueta: 'Nómina' } }
                    : {}),
                ...(divGestionIndex >= 0
                    ? { porGestion: { fromIndex: divGestionIndex, etiqueta: 'Gestión' } }
                    : {}),
            }
        }

        try {
            if (isEdit && id) {
                await api.post(`/import/plantillas/${id}`, {
                    nombre,
                    categoria,
                    version,
                    // En ancho fijo no hay separador: se guarda el default para que, si alguna vez
                    // se saca el layout, la plantilla no quede con un delimitador imposible.
                    separador: esAnchoFijo ? '|' : separador,
                    tieneHeader,
                    mappingJson,
                    defaultEstadoSituacionId: defaultEstadoSituacionId === '' ? null : Number(defaultEstadoSituacionId),
                    defaultEstadoGestionId: defaultEstadoGestionId === '' ? null : Number(defaultEstadoGestionId),
                })
                notify.success('Plantilla actualizada correctamente')
            } else {
                if (!empresaId) {
                    notify.error('No se pudo determinar la empresa. Volvé a la lista y volvé a intentar.')
                    setLoading(false)
                    return
                }
                await api.post('/import/plantillas', {
                    empresaId: Number(empresaId),
                    nombre,
                    categoria,
                    version,
                    // En ancho fijo no hay separador: se guarda el default para que, si alguna vez
                    // se saca el layout, la plantilla no quede con un delimitador imposible.
                    separador: esAnchoFijo ? '|' : separador,
                    tieneHeader,
                    mappingJson,
                    defaultEstadoSituacionId: defaultEstadoSituacionId === '' ? null : Number(defaultEstadoSituacionId),
                    defaultEstadoGestionId: defaultEstadoGestionId === '' ? null : Number(defaultEstadoGestionId),
                })
                notify.success('Plantilla creada correctamente')
            }
            navigate('/plantillas')
        } catch (err) {
            notify.error(err as Error)
        } finally {
            setLoading(false)
        }
    }

    if (initialLoading) {
        return (
            <Box sx={{ p: 3 }}>
                <LoadingSkeleton variant="form" rows={6} />
            </Box>
        )
    }

    return (
        <Box sx={{ p: 3 }}>
            <PageHeader
                title={isEdit ? 'Editar plantilla' : 'Nueva plantilla'}
                breadcrumbs={[
                    { label: 'Plantillas', href: '/plantillas' },
                    { label: isEdit ? 'Editar' : 'Nueva' },
                ]}
                actions={[
                    {
                        label: 'Cancelar',
                        variant: 'text',
                        onClick: () => navigate('/plantillas'),
                        disabled: loading,
                    },
                    {
                        label: loading ? 'Guardando...' : 'Guardar',
                        variant: 'contained',
                        startIcon: <SaveIcon />,
                        onClick: handleSave,
                        disabled: loading,
                    },
                ]}
            />

            <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
                {/* Datos básicos */}
                <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                    Datos básicos
                </Typography>

                <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    flexWrap="wrap"
                    gap={2}
                    sx={{ mb: 3 }}
                >
                    <TextField
                        label="Nombre"
                        value={nombre}
                        onChange={(e) => setNombre(e.target.value)}
                        placeholder='Ej: "Personal - Deudores (CA)"'
                        sx={{ flex: '1 1 240px' }}
                    />
                    <FormControl sx={{ flex: '1 1 240px' }}>
                        <InputLabel>Categoría</InputLabel>
                        <Select
                            value={categoria}
                            label="Categoría"
                            onChange={(e) => setCategoria(e.target.value)}
                        >
                            {CATEGORIAS.map((c) => (
                                <MenuItem key={c} value={c}>
                                    {c}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <FormControl sx={{ flex: '1 1 240px' }}>
                        <InputLabel>Formato / Separador</InputLabel>
                        <Select
                            value={sepMode === 'OTRO' ? 'OTRO' : separador}
                            label="Formato / Separador"
                            onChange={(e) => {
                                const v = e.target.value
                                if (v === 'OTRO') {
                                    setSepMode('OTRO')
                                    setSeparador('') // vacío para tipear el separador
                                } else {
                                    setSepMode('STD')
                                    setSeparador(v)
                                }
                            }}
                        >
                            <MenuItem value="EXCEL">Excel (.xls, .xlsx)</MenuItem>
                            <MenuItem value=",">CSV - Coma (,)</MenuItem>
                            <MenuItem value=";">CSV - Punto y coma (;)</MenuItem>
                            <MenuItem value="|">TXT - Pipe (|)</MenuItem>
                            <MenuItem value={'\t'}>TXT - Tabulador (TAB)</MenuItem>
                            <MenuItem value="ANCHO_FIJO">TXT - Ancho fijo (sin separador)</MenuItem>
                            <MenuItem value="OTRO">Otro personalizado...</MenuItem>
                        </Select>
                    </FormControl>
                    {sepMode === 'OTRO' && (
                        <TextField
                            label="Separador personalizado"
                            value={separador}
                            onChange={(e) => setSeparador(e.target.value)}
                            helperText="Un solo carácter (ej: coma, punto y coma, pipe)"
                            sx={{ flex: '1 1 240px' }}
                        />
                    )}
                    <TextField
                        label="Versión"
                        type="number"
                        value={version}
                        onChange={(e) => setVersion(parseInt(e.target.value, 10) || 1)}
                        sx={{ flex: '1 1 120px' }}
                    />
                    <FormControlLabel
                        control={
                            <Switch
                                checked={tieneHeader}
                                onChange={(e) => setTieneHeader(e.target.checked)}
                            />
                        }
                        label="El archivo tiene encabezado (header)"
                        sx={{ flex: '1 1 240px' }}
                    />
                    <TextField
                        label="Match keys (separados por coma)"
                        value={matchKeys}
                        onChange={(e) => setMatchKeys(e.target.value)}
                        helperText="Campos para identificar duplicados"
                        sx={{ flex: '1 1 240px' }}
                    />
                </Stack>

                {!esAcciones && (
                <>
                <Divider sx={{ my: 3 }} />

                {/* Estados iniciales */}
                <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                    Estados iniciales al importar
                </Typography>

                <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    flexWrap="wrap"
                    gap={2}
                    sx={{ mb: 3 }}
                >
                    {paramsSituacion.length === 0 && !loadingParams ? (
                        <Alert severity="warning" sx={{ flex: '1 1 100%' }}>
                            Esta empresa no tiene códigos de situación cargados. Cargá al menos uno en Parámetros antes de continuar.
                        </Alert>
                    ) : (
                        <FormControl sx={{ flex: '1 1 280px' }} required>
                            <InputLabel>Estado situación inicial</InputLabel>
                            <Select
                                value={defaultEstadoSituacionId}
                                label="Estado situación inicial"
                                onChange={(e) => setDefaultEstadoSituacionId(e.target.value as number)}
                                disabled={loadingParams}
                            >
                                {paramsSituacion.map((p) => (
                                    <MenuItem key={p.id} value={p.id}>
                                        {p.descripcion} ({p.clave})
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    )}

                    {paramsGestion.length === 0 && !loadingParams ? (
                        <Alert severity="warning" sx={{ flex: '1 1 100%' }}>
                            Esta empresa no tiene códigos de gestión cargados. Cargá al menos uno en Parámetros antes de continuar.
                        </Alert>
                    ) : (
                        <FormControl sx={{ flex: '1 1 280px' }} required>
                            <InputLabel>Estado gestión inicial</InputLabel>
                            <Select
                                value={defaultEstadoGestionId}
                                label="Estado gestión inicial"
                                onChange={(e) => setDefaultEstadoGestionId(e.target.value as number)}
                                disabled={loadingParams}
                            >
                                {paramsGestion.map((p) => (
                                    <MenuItem key={p.id} value={p.id}>
                                        {p.descripcion} ({p.clave})
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    )}
                </Stack>
                </>
                )}

                {/* Qué identifica a un caso dentro de la remesa (solo flujos que crean casos) */}
                {esFlujoCasos && (
                    <>
                        <Divider sx={{ my: 3 }} />
                        <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                            Identidad del caso
                        </Typography>
                        <FormControl sx={{ flex: '1 1 360px', maxWidth: 520, mb: 3 }}>
                            <InputLabel>Qué cuenta como un caso distinto</InputLabel>
                            <Select
                                value={identidadDeudor}
                                label="Qué cuenta como un caso distinto"
                                onChange={(e) =>
                                    setIdentidadDeudor(e.target.value as 'DOCUMENTO' | 'NRO_CLIENTE')
                                }
                            >
                                <MenuItem value="DOCUMENTO">
                                    El documento: un DNI es un caso (por defecto)
                                </MenuItem>
                                <MenuItem value="NRO_CLIENTE">
                                    El Nº de cliente: cada cuenta es un caso, aunque el DNI se repita
                                </MenuItem>
                            </Select>
                            <FormHelperText>
                                Elegí "Nº de cliente" cuando el cedente manda varias cuentas por titular
                                (Telecom y Personal: la cuenta madre termina en 0001 y las hijas en 0002,
                                0003). Con "documento", esas cuentas se pisan entre sí: entra una sola y
                                las facturas y pagos de las otras después no encuentran su caso.
                            </FormHelperText>
                        </FormControl>
                    </>
                )}

                {/* División de la carga en varias remesas (un archivo con varias asignaciones) */}
                {!esMultirregistro && !esMultiarchivo && (
                    <>
                        <Divider sx={{ my: 3 }} />
                        <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
                            Dividir la carga en varias remesas
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                            Para los archivos que traen varias asignaciones juntas porque el cedente
                            exporta filtrando solo por día. Al cargar, el sistema cuenta los casos de
                            cada corte y crea una remesa por cada uno, todas sobre el mismo archivo.
                            Dejá los dos en "No dividir" y la carga se comporta como siempre.
                        </Typography>
                        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 3 }}>
                            <TextField
                                label="Columna de la nómina"
                                type="number"
                                sx={{ maxWidth: 280 }}
                                value={divNominaIndex}
                                onChange={(e) => setDivNominaIndex(parseInt(e.target.value, 10))}
                                helperText={
                                    divNominaIndex >= 0
                                        ? 'Se pide un número de remesa para cada nómina.'
                                        : '-1 = no dividir por nómina.'
                                }
                            />
                            <TextField
                                label="Columna de la gestión"
                                type="number"
                                sx={{ maxWidth: 280 }}
                                value={divGestionIndex}
                                onChange={(e) => setDivGestionIndex(parseInt(e.target.value, 10))}
                                helperText={
                                    divGestionIndex >= 0
                                        ? 'El número de remesa se prefija con el dígito de la gestión (3GH sobre la 100 → 30100).'
                                        : '-1 = no dividir por gestión.'
                                }
                            />
                        </Stack>
                    </>
                )}

                {/* Importe del deudor desde facturas (solo flujos con facturas) */}
                {esFlujoFacturas && (
                    <>
                        <Divider sx={{ my: 3 }} />
                        <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                            Importe del deudor
                        </Typography>
                        <FormControl sx={{ flex: '1 1 360px', maxWidth: 520, mb: 3 }}>
                            <InputLabel>Calcular importe desde las facturas</InputLabel>
                            <Select
                                value={montoDeudorDesdeFacturas}
                                label="Calcular importe desde las facturas"
                                onChange={(e) =>
                                    setMontoDeudorDesdeFacturas(
                                        e.target.value as 'NO' | 'SI_VACIO' | 'SIEMPRE'
                                    )
                                }
                            >
                                <MenuItem value="SI_VACIO">
                                    Solo si el deudor vino sin importe (recomendado)
                                </MenuItem>
                                <MenuItem value="SIEMPRE">
                                    Siempre (las facturas son la fuente de verdad)
                                </MenuItem>
                                <MenuItem value="NO">
                                    No calcular (el importe viene en el archivo de deudores)
                                </MenuItem>
                            </Select>
                            <FormHelperText>
                                Al cargar las facturas, el importe del deudor se completa con la suma de
                                sus facturas según esta opción. "Solo si vino sin importe" nunca pisa un
                                valor ya cargado.
                            </FormHelperText>
                        </FormControl>
                    </>
                )}

                {/* Modo de la actualización (solo categoría ACTUALIZACIONES) */}
                {esActualizacion && (
                    <>
                        <Divider sx={{ my: 3 }} />
                        <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
                            Modo de la actualización
                        </Typography>
                        <FormControlLabel
                            control={
                                <Switch
                                    checked={modoActualizacion === 'SOLO_DATOS'}
                                    onChange={(e) => {
                                        const solo = e.target.checked
                                        setModoActualizacion(solo ? 'SOLO_DATOS' : 'RECONCILIAR')
                                        // SOLO_DATOS no admite "pagó todo" → caer a "No hacer nada".
                                        if (solo && accionAusente === 'PAGO_TODO')
                                            setAccionAusente('IGNORAR')
                                    }}
                                />
                            }
                            label="Solo actualizar datos (DNI / adicionales) — no reconciliar deuda"
                        />
                        <FormHelperText sx={{ mb: 2 }}>
                            Activá esta opción para archivos que solo completan el DNI faltante y/o
                            datos adicionales de deudores ya cargados. En este modo NO se generan
                            pagos automáticos ni se reconcilia deuda, y NO se marca a los ausentes
                            como "pagó todo". Los casos nuevos igual se dan de alta si dejás activada
                            la opción "crear casos nuevos" (útil para gestiones sin saldo, ej.
                            atención al cliente). Dejalo desactivado para las actualizaciones
                            normales de deuda.
                        </FormHelperText>

                        {/* Acción para deudores ausentes del archivo (visible en ambos modos). */}
                        <FormControl sx={{ mb: 2 }}>
                            <FormLabel sx={{ fontWeight: 600 }}>
                                Deudores ausentes del archivo
                            </FormLabel>
                            <RadioGroup
                                value={accionAusente}
                                onChange={(_, v) =>
                                    setAccionAusente(v as 'PAGO_TODO' | 'DESASIGNAR' | 'IGNORAR')
                                }
                            >
                                {modoActualizacion === 'RECONCILIAR' && (
                                    <FormControlLabel
                                        value="PAGO_TODO"
                                        control={<Radio />}
                                        label="Marcar como pagó todo (SIT-050) — comportamiento clásico"
                                    />
                                )}
                                <FormControlLabel
                                    value="DESASIGNAR"
                                    control={<Radio />}
                                    label="Desasignar (GES-094) — para archivos de gestión diaria"
                                />
                                <FormControlLabel
                                    value="IGNORAR"
                                    control={<Radio />}
                                    label="No hacer nada con los ausentes"
                                />
                            </RadioGroup>
                            <FormHelperText>
                                Qué hacer con los deudores de la remesa vinculada que NO aparecen en este
                                archivo. En "Desasignar", el deudor vuelve a su estado de gestión anterior
                                si reaparece en un archivo posterior; los deudores cancelados (SIT-050)
                                siempre se ignoran.
                            </FormHelperText>
                        </FormControl>

                        {/* Crear casos nuevos: ortogonal al modo (vale también en SOLO_DATOS). */}
                        <FormControlLabel
                            control={
                                <Switch
                                    checked={!crearNuevosCasos}
                                    onChange={(e) => setCrearNuevosCasos(!e.target.checked)}
                                />
                            }
                            label="No crear casos nuevos — solo actualizar deudores existentes"
                        />
                        <FormHelperText sx={{ mb: 2 }}>
                            Activá esta opción cuando un mismo archivo abarca varias remesas y lo
                            aplicás una por una: los registros que no pertenecen a la remesa elegida
                            se ignoran en vez de cargarse como deudores nuevos. Dejalo desactivado
                            para que los no encontrados se den de alta. Los casos nuevos siempre se
                            suman a la remesa vinculada (la cartera), así no se duplican al día
                            siguiente ni quedan en una remesa aparte.
                        </FormHelperText>

                        {modoActualizacion === 'RECONCILIAR' && (
                            <FormControl sx={{ flex: '1 1 360px', maxWidth: 520, mb: 2 }}>
                                <InputLabel>Si el saldo informado es mayor al actual</InputLabel>
                                <Select
                                    value={comportamientoDeudaMayor}
                                    label="Si el saldo informado es mayor al actual"
                                    onChange={(e) =>
                                        setComportamientoDeudaMayor(
                                            e.target.value as 'FACTURA_NUEVA' | 'ACTUALIZAR_SALDO'
                                        )
                                    }
                                >
                                    <MenuItem value="FACTURA_NUEVA">
                                        Generar una factura nueva por la diferencia
                                    </MenuItem>
                                    <MenuItem value="ACTUALIZAR_SALDO">
                                        Actualizar la factura existente, sin generar nuevas
                                    </MenuItem>
                                </Select>
                                <FormHelperText>
                                    Cuando la deuda crece, el saldo del deudor siempre se actualiza. Elegí cómo
                                    reflejarlo en las facturas: "factura nueva por la diferencia" (deja rastro de
                                    cada aumento) o "actualizar la existente" (para intereses diarios, evita
                                    generar una factura por día si el deudor tiene una sola factura).
                                </FormHelperText>
                            </FormControl>
                        )}
                    </>
                )}

                {esAnchoFijo && !esMultiarchivo && !esMultirregistro && (
                    <>
                        <Divider sx={{ my: 3 }} />
                        <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                            Columnas del archivo de ancho fijo
                        </Typography>
                        <AnchoFijoEditor
                            value={anchoFijoLayout}
                            onChange={setAnchoFijoLayout}
                            encoding={anchoFijoEncoding}
                            onEncodingChange={setAnchoFijoEncoding}
                            tieneHeader={tieneHeader}
                        />
                    </>
                )}

                {!esMultiarchivo && !esMultirregistro && (
                    <>
                        <Divider sx={{ my: 3 }} />
                        <FiltroFilasEditor
                            value={filtroFilas}
                            onChange={setFiltroFilas}
                            columnas={columnasAnchoFijo}
                        />
                    </>
                )}

                <Divider sx={{ my: 3 }} />

                {esMultiarchivo ? (
                    <>
                        <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                            Layout del paquete de archivos
                        </Typography>
                        <MultiarchivoEditor
                            value={multiarchivoConfig}
                            onChange={setMultiarchivoConfig}
                            separador={separador}
                            onSeparadorChange={(v) => {
                                setSeparador(v)
                                setSepMode('STD')
                            }}
                        />
                    </>
                ) : esMultirregistro ? (
                    <>
                        <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                            Layout del archivo multirregistro
                        </Typography>
                        <MultirregistroEditor
                            value={multirregistroConfig}
                            onChange={setMultirregistroConfig}
                            separador={separador}
                            onSeparadorChange={(v) => {
                                setSeparador(v)
                                setSepMode('STD')
                            }}
                        />
                    </>
                ) : esAcciones ? (
                    <>
                        <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                            Acciones masivas
                        </Typography>
                        <AccionesEditor
                            value={accionesConfig}
                            onChange={setAccionesConfig}
                            paramsSituacion={paramsSituacion}
                            paramsGestion={paramsGestion}
                            paramsMotivo={paramsMotivo}
                            separador={separador}
                            tieneHeader={tieneHeader}
                        />
                    </>
                ) : (
                    <>
                        {/* Mapeo de columnas */}
                        <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                            Mapeo de columnas
                        </Typography>

                        <MappingEditor
                            fields={fields}
                            onChange={setFields}
                            blocks={blocks}
                            onBlocksChange={setBlocks}
                            separador={separador}
                            tieneHeader={tieneHeader}
                            categoria={categoria}
                            disabled={false}
                            anchoFijo={
                                esAnchoFijo && columnasAnchoFijo.length
                                    ? {
                                          encoding: anchoFijoEncoding,
                                          columnas: parsearLayout(anchoFijoLayout).columnas,
                                      }
                                    : undefined
                            }
                        />
                    </>
                )}
            </Paper>
        </Box>
    )
}

export default PlantillaEditor
