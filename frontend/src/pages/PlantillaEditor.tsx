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

// ─── Constantes ──────────────────────────────────────────────────────────────

const CATEGORIAS = [
    'DEUDORES',
    'FACTURAS',
    'ENRIQUECIMIENTO',
    'PAGOS',
    'CONTACTOS',
    'DEUDORES_Y_FACTURAS',
    'ACTUALIZACIONES',
]

const ENTITY_MAP: Record<string, string> = {
    DEUDORES: 'DEUDOR',
    FACTURAS: 'FACTURA',
    ENRIQUECIMIENTO: 'ENRIQ_MIXTO',
    PAGOS: 'PAGO',
    CONTACTOS: 'CONTACTO',
    DEUDORES_Y_FACTURAS: 'MIXTO',
    ACTUALIZACIONES: 'ACTUALIZACION',
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

    // Flujos donde tiene sentido calcular el importe del deudor desde las facturas
    const esFlujoFacturas = categoria === 'FACTURAS' || categoria === 'DEUDORES_Y_FACTURAS'

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
            const [resSit, resGest] = await Promise.all([
                api.get('/parametros', { params: { empresaId: eid, grupo: 'situacion', activo: 'true' } }),
                api.get('/parametros', { params: { empresaId: eid, grupo: 'gestion', activo: 'true' } }),
            ])
            setParamsSituacion(resSit.data ?? [])
            setParamsGestion(resGest.data ?? [])
        } catch {
            setParamsSituacion([])
            setParamsGestion([])
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
        if (fields.filter((f) => f.destField).length === 0) {
            notify.error('Agregá al menos un campo de mapeo')
            return
        }
        if (!defaultEstadoSituacionId) {
            notify.error('Seleccioná el estado de situación inicial')
            return
        }
        if (!defaultEstadoGestionId) {
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

        try {
            if (isEdit && id) {
                await api.post(`/import/plantillas/${id}`, {
                    nombre,
                    categoria,
                    version,
                    separador,
                    tieneHeader,
                    mappingJson,
                    defaultEstadoSituacionId: Number(defaultEstadoSituacionId),
                    defaultEstadoGestionId: Number(defaultEstadoGestionId),
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
                    defaultEstadoSituacionId: Number(defaultEstadoSituacionId),
                    defaultEstadoGestionId: Number(defaultEstadoGestionId),
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

                <Divider sx={{ my: 3 }} />

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
            </Paper>
        </Box>
    )
}

export default PlantillaEditor
