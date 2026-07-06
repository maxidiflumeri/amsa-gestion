import React, { useCallback, useEffect, useState } from 'react'
import {
    Alert,
    Box,
    Divider,
    FormControl,
    FormControlLabel,
    FormHelperText,
    InputLabel,
    MenuItem,
    Paper,
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
    const [tieneHeader, setTieneHeader] = useState(false)
    const [matchKeys, setMatchKeys] = useState('empresaId,documento')
    const [fields, setFields] = useState<MappingField[]>([])
    const [blocks, setBlocks] = useState<MappingBlock[]>([])
    const [defaultEstadoSituacionId, setDefaultEstadoSituacionId] = useState<number | ''>('')
    const [defaultEstadoGestionId, setDefaultEstadoGestionId] = useState<number | ''>('')
    const [montoDeudorDesdeFacturas, setMontoDeudorDesdeFacturas] =
        useState<'NO' | 'SI_VACIO' | 'SIEMPRE'>('SI_VACIO')
    const [modoActualizacion, setModoActualizacion] =
        useState<'RECONCILIAR' | 'SOLO_DATOS'>('RECONCILIAR')
    const [comportamientoDeudaMayor, setComportamientoDeudaMayor] =
        useState<'FACTURA_NUEVA' | 'ACTUALIZAR_SALDO'>('FACTURA_NUEVA')

    const [accionesConfig, setAccionesConfig] = useState<AccionesConfig>({
        matchMode: 'DEUDOR',
        matchColumn: { field: 'nro_cliente', fromIndex: 0 },
        saltearCanceladas: false,
        operaciones: [],
    })
    const [paramsMotivo, setParamsMotivo] = useState<Parametro[]>([])

    // Flujos donde tiene sentido calcular el importe del deudor desde las facturas
    const esFlujoFacturas = categoria === 'FACTURAS' || categoria === 'DEUDORES_Y_FACTURAS'
    const esActualizacion = categoria === 'ACTUALIZACIONES'
    const esAcciones = categoria === 'ACCIONES'

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
            setSeparador(p.separador)
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
            if (p.mappingJson?.acciones) setAccionesConfig(p.mappingJson.acciones)
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
        }
        if (esAcciones) {
            ;(mappingJson as Record<string, unknown>).acciones = accionesConfig
        }

        try {
            if (isEdit && id) {
                await api.post(`/import/plantillas/${id}`, {
                    nombre,
                    categoria,
                    version,
                    separador,
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
                    separador,
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
                            value={
                                ['|', ',', ';', '\t', 'EXCEL'].includes(separador)
                                    ? separador
                                    : 'OTRO'
                            }
                            label="Formato / Separador"
                            onChange={(e) => {
                                if (e.target.value !== 'OTRO') setSeparador(e.target.value)
                            }}
                        >
                            <MenuItem value="EXCEL">Excel (.xls, .xlsx)</MenuItem>
                            <MenuItem value=",">CSV - Coma (,)</MenuItem>
                            <MenuItem value=";">CSV - Punto y coma (;)</MenuItem>
                            <MenuItem value="|">TXT - Pipe (|)</MenuItem>
                            <MenuItem value="\t">TXT - Tabulador (TAB)</MenuItem>
                            <MenuItem value="OTRO">Otro personalizado...</MenuItem>
                        </Select>
                    </FormControl>
                    {!['|', ',', ';', '\t', 'EXCEL'].includes(separador) &&
                        separador !== 'OTRO' && (
                            <TextField
                                label="Separador personalizado"
                                value={separador}
                                onChange={(e) => setSeparador(e.target.value)}
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
                                    onChange={(e) =>
                                        setModoActualizacion(
                                            e.target.checked ? 'SOLO_DATOS' : 'RECONCILIAR'
                                        )
                                    }
                                />
                            }
                            label="Solo actualizar datos (DNI / adicionales) — no reconciliar deuda"
                        />
                        <FormHelperText sx={{ mb: 2 }}>
                            Activá esta opción para archivos que solo completan el DNI faltante y/o
                            datos adicionales de deudores ya cargados (match por Nº Cliente). En este
                            modo NO se generan pagos automáticos, NO se marca a los ausentes como
                            "pagó todo" y NO se crean deudores nuevos. Dejalo desactivado para las
                            actualizaciones normales de deuda.
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

                <Divider sx={{ my: 3 }} />

                {esAcciones ? (
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
                        />
                    </>
                )}
            </Paper>
        </Box>
    )
}

export default PlantillaEditor
