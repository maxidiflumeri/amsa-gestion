import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
    Box,
    Button,
    Checkbox,
    Chip,
    Collapse,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    FormControl,
    FormControlLabel,
    IconButton,
    InputLabel,
    List,
    ListItemButton,
    ListItemText,
    MenuItem,
    Paper,
    Select,
    Stack,
    Switch,
    Tab,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Tabs,
    TextField,
    Tooltip,
    Typography,
    useMediaQuery,
    useTheme,
    Autocomplete,
    Accordion,
    AccordionSummary,
    AccordionDetails,
} from '@mui/material'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import AddIcon from '@mui/icons-material/Add'
import ExpandLess from '@mui/icons-material/ExpandLess'
import ExpandMore from '@mui/icons-material/ExpandMore'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import BusinessIcon from '@mui/icons-material/Business'
import CodeIcon from '@mui/icons-material/Code'
import api from '../../api/axios'
import {
    PageHeader,
    EmptyState,
    LoadingSkeleton,
} from '../../components/ui'
import { useNotify } from '../../hooks/useNotify'
import { useConfirm } from '../../context/ConfirmContext'
import { useAuth } from '../../context/AuthContext'

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface Parametro {
    id: number
    grupo: string
    clave: string
    descripcion: string
    categoria: string | null
    esGlobal: boolean
    activo: boolean
}

interface Empresa {
    id: number
    nombre: string
}

// ── Constantes ────────────────────────────────────────────────────────────────
const GRUPOS = [
    { value: 'gestion', label: 'Gestión' },
    { value: 'situacion', label: 'Situación' },
    { value: 'motivo_no_pago', label: 'Motivo No Pago' },
]

/**
 * Orden preferido de las categorías, para que la pantalla no las liste alfabéticamente.
 *
 * **No es la lista de categorías**: esa se calcula de los códigos que hay en la base. Cuando estaba
 * hardcodeada le faltaban cinco —LEGAL e INCOBRABLE en situación, y OLVIDO, PERSONAL, NEGATIVA y
 * SINIESTRO en motivo de no pago—, así que **15 códigos del catálogo no se podían asignar a ninguna
 * empresa desde acá**: la solapa de asignación itera sobre esta lista y los que no estaban no se
 * renderizaban nunca.
 */
const ORDEN_CATEGORIAS: Record<string, string[]> = {
    gestion: ['CONTACTO', 'SIN_CONTACTO', 'DATO_INCORRECTO', 'PROMESA', 'PAGO', 'CONVENIO', 'NEGATIVA', 'RECLAMO', 'DERIVACION', 'ADMIN'],
    situacion: ['SIN_CONTACTO', 'CONTACTADO', 'PROMESA', 'CONVENIO', 'PAGANDO', 'CANCELADO', 'NEGATIVA', 'LEGAL', 'INCOBRABLE', 'BAJA'],
    motivo_no_pago: ['ECONOMICO', 'OLVIDO', 'PERSONAL', 'DESCONOCE', 'DISPUTA', 'FACTURACION', 'MEDIO_PAGO', 'SINIESTRO', 'NEGATIVA', 'ACUERDO', 'BAJA'],
}

const GRUPO_COLOR: Record<string, 'primary' | 'info' | 'warning'> = {
    gestion: 'primary',
    situacion: 'info',
    motivo_no_pago: 'warning',
}

const GRUPO_LABEL: Record<string, string> = {
    gestion: 'Gestión',
    situacion: 'Situación',
    motivo_no_pago: 'Motivo No Pago',
}

const FORM_VACIO = { grupo: 'gestion', clave: '', descripcion: '', categoria: '', esGlobal: true, activo: true }

// ── Tab Panel helper ──────────────────────────────────────────────────────────
function TabPanel({ children, value, index }: { children: React.ReactNode; value: number; index: number }) {
    return value === index ? <Box sx={{ pt: 2 }}>{children}</Box> : null
}

// ════════════════════════════════════════════════════════════════════════════
const AjustesParametros: React.FC = () => {
    const theme = useTheme()
    const isMobile = useMediaQuery(theme.breakpoints.down('md'))
    const notify = useNotify()
    const confirm = useConfirm()

    const [tab, setTab] = useState(0)
    // Los permisos los verifica el backend igual, pero la pantalla no los miraba: el admin
    // completaba el formulario y el 403 llegaba recién al confirmar.
    const { tienePermiso } = useAuth()
    const puedeCrear = tienePermiso('parametros.crear')
    const puedeEditar = tienePermiso('parametros.editar')
    const puedeEliminar = tienePermiso('parametros.eliminar')

    const [parametros, setParametros] = useState<Parametro[]>([])
    const [loading, setLoading] = useState(true)

    // Pestaña Códigos
    const [grupoSel, setGrupoSel] = useState<string>('gestion')
    const [categoriaSel, setCategoriaSel] = useState<string | null>(null)
    const [filterTexto, setFilterTexto] = useState('')
    const [openCats, setOpenCats] = useState<Record<string, boolean>>({})
    const [open, setOpen] = useState(false)
    const [editing, setEditing] = useState<Parametro | null>(null)
    const [formData, setFormData] = useState(FORM_VACIO)
    const [saving, setSaving] = useState(false)
    const [formError, setFormError] = useState('')

    // Pestaña Asignación
    const [empresas, setEmpresas] = useState<Empresa[]>([])
    const [empresaSel, setEmpresaSel] = useState<number | ''>('')
    const [asignados, setAsignados] = useState<Set<number>>(new Set())
    const [asignadosPrev, setAsignadosPrev] = useState<Set<number>>(new Set())
    const [loadingAsig, setLoadingAsig] = useState(false)
    const [savingAsig, setSavingAsig] = useState(false)
    const [filterAsig, setFilterAsig] = useState('')

    // ── Carga inicial ──────────────────────────────────────────────────────────
    const fetchParametros = useCallback(async () => {
        setLoading(true)
        try {
            const res = await api.get('/parametros')
            setParametros(res.data)
        } catch (e) {
            notify.error(e as Error)
        } finally {
            setLoading(false)
        }
    }, [])

    const fetchEmpresas = useCallback(async () => {
        try {
            const res = await api.get('/empresas')
            setEmpresas(res.data?.data || res.data || [])
        } catch (e) {
            notify.error(e as Error)
        }
    }, [])

    useEffect(() => { fetchParametros() }, [fetchParametros])
    useEffect(() => { if (tab === 1) fetchEmpresas() }, [tab, fetchEmpresas])

    // ── Lógica pestaña Códigos ─────────────────────────────────────────────────
    const toggleCat = (cat: string) => setOpenCats(p => ({ ...p, [cat]: !p[cat] }))

    /**
     * Las categorías que existen de verdad, sacadas de los códigos cargados. Se ordenan por
     * `ORDEN_CATEGORIAS` y lo que no esté ahí va al final, alfabético: una categoría nueva en el
     * seed aparece sola, sin tocar esta pantalla.
     */
    const categoriasPorGrupo = useMemo(() => {
        const porGrupo: Record<string, string[]> = {}
        for (const p of parametros) {
            if (!p.categoria) continue
            ;(porGrupo[p.grupo] ??= []).push(p.categoria)
        }
        for (const grupo of Object.keys(porGrupo)) {
            const orden = ORDEN_CATEGORIAS[grupo] ?? []
            porGrupo[grupo] = [...new Set(porGrupo[grupo])].sort((a, b) => {
                const ia = orden.indexOf(a)
                const ib = orden.indexOf(b)
                if (ia === -1 && ib === -1) return a.localeCompare(b)
                if (ia === -1) return 1
                if (ib === -1) return -1
                return ia - ib
            })
        }
        return porGrupo
    }, [parametros])

    const codigosFiltrados = parametros.filter(p => {
        if (p.grupo !== grupoSel) return false
        if (categoriaSel && p.categoria !== categoriaSel) return false
        if (filterTexto) {
            const t = filterTexto.toLowerCase()
            return p.clave.toLowerCase().includes(t) || p.descripcion.toLowerCase().includes(t)
        }
        return true
    })

    const handleOpenForm = (p?: Parametro) => {
        setFormError('')
        if (p) {
            setEditing(p)
            setFormData({ grupo: p.grupo, clave: p.clave, descripcion: p.descripcion, categoria: p.categoria || '', esGlobal: p.esGlobal, activo: p.activo })
        } else {
            setEditing(null)
            setFormData({ ...FORM_VACIO, grupo: grupoSel, categoria: categoriaSel || '' })
        }
        setOpen(true)
    }

    const handleSave = async () => {
        if (!formData.grupo || !formData.clave || !formData.descripcion) {
            setFormError('Grupo, clave y descripción son obligatorios')
            return
        }
        setSaving(true)
        setFormError('')
        try {
            const payload = { ...formData, categoria: formData.categoria || null }
            if (editing) {
                await api.patch(`/parametros/${editing.id}`, payload)
                notify.success('Código actualizado correctamente')
            } else {
                await api.post('/parametros', payload)
                notify.success('Código creado correctamente')
            }
            setOpen(false)
            fetchParametros()
        } catch (e: any) {
            setFormError(e.response?.data?.message || 'Error al guardar')
        } finally {
            setSaving(false)
        }
    }

    const handleToggleActivo = async (p: Parametro) => {
        try {
            await api.patch(`/parametros/${p.id}/activo`)
            setParametros(prev => prev.map(x => x.id === p.id ? { ...x, activo: !x.activo } : x))
        } catch (e) {
            notify.error(e as Error)
        }
    }

    const handleDelete = async (p: Parametro) => {
        const confirmed = await confirm({
            title: 'Eliminar código',
            description: `¿Confirmás que querés eliminar el código "${p.clave}"? Esta acción no se puede deshacer.`,
            confirmLabel: 'Eliminar',
            cancelLabel: 'Cancelar',
            confirmColor: 'error',
        })
        if (!confirmed) return
        try {
            await api.delete(`/parametros/${p.id}`)
            notify.success('Código eliminado correctamente')
            fetchParametros()
        } catch (e: any) {
            notify.error(e as Error)
        }
    }

    // ── Lógica pestaña Asignación ──────────────────────────────────────────────
    const cargarAsignados = async (empresaId: number) => {
        setLoadingAsig(true)
        try {
            const res = await api.get(`/parametros?empresaId=${empresaId}`)
            const ids = new Set<number>((res.data as Parametro[]).map(p => p.id))
            setAsignados(new Set(ids))
            setAsignadosPrev(new Set(ids))
        } catch (e) {
            notify.error(e as Error)
        } finally {
            setLoadingAsig(false)
        }
    }

    const handleEmpresaChange = (id: number) => {
        setEmpresaSel(id)
        setFilterAsig('')
        cargarAsignados(id)
    }

    const toggleAsignado = (id: number) => {
        setAsignados(prev => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    const toggleGrupoCompleto = (grupo: string, marcar: boolean) => {
        const ids = parametros.filter(p => p.grupo === grupo).map(p => p.id)
        setAsignados(prev => {
            const next = new Set(prev)
            ids.forEach(id => marcar ? next.add(id) : next.delete(id))
            return next
        })
    }

    const toggleCategoriaCompleta = (grupo: string, cat: string, marcar: boolean) => {
        const ids = parametros.filter(p => p.grupo === grupo && p.categoria === cat).map(p => p.id)
        setAsignados(prev => {
            const next = new Set(prev)
            ids.forEach(id => marcar ? next.add(id) : next.delete(id))
            return next
        })
    }

    const hayDiferencias = () => {
        for (const id of asignados) { if (!asignadosPrev.has(id)) return true }
        for (const id of asignadosPrev) { if (!asignados.has(id)) return true }
        return false
    }

    const handleGuardarAsignacion = async () => {
        if (!empresaSel) return
        setSavingAsig(true)
        try {
            const agregados = [...asignados].filter(id => !asignadosPrev.has(id))
            const removidos = [...asignadosPrev].filter(id => !asignados.has(id))
            const paramsCambiados = new Set([...agregados, ...removidos])

            // Una sola llamada por código, tocando **solo la fila de esta empresa**.
            //
            // Antes eran dos: leer el parámetro entero, agregarle o sacarle esta empresa de la lista,
            // y reescribir la lista completa. Eso hacía dos cosas malas: ~224 requests en serie para
            // una empresa nueva con el catálogo completo, y un read-modify-write sobre datos
            // compartidos — dos administradores configurando empresas distintas se pisaban.
            await Promise.all(
                [...paramsCambiados].map(paramId =>
                    api.put(`/parametros/${paramId}/empresas/${empresaSel}`, {
                        asignado: asignados.has(paramId),
                    }),
                ),
            )

            setAsignadosPrev(new Set(asignados))
            notify.success(`Asignación guardada correctamente (${paramsCambiados.size} cambios)`)
        } catch (e) {
            notify.error(e as Error)
        } finally {
            setSavingAsig(false)
        }
    }

    // ── Condiciones de render ──────────────────────────────────────────────────
    const isFirstLoad = loading && parametros.length === 0

    // ── Render ─────────────────────────────────────────────────────────────────
    return (
        <Box sx={{ p: { xs: 2, md: 3 } }}>
            <PageHeader
                title="Parámetros"
                subtitle="Códigos CRM y asignación a empresas"
                actions={tab === 0 && puedeCrear ? [
                    {
                        label: 'Nuevo código',
                        onClick: () => handleOpenForm(),
                        startIcon: <AddIcon />,
                        variant: 'contained',
                    },
                ] : []}
            />

            <Tabs
                value={tab}
                onChange={(_, v) => setTab(v)}
                sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
                variant={isMobile ? 'scrollable' : 'standard'}
                scrollButtons={isMobile ? 'auto' : false}
                allowScrollButtonsMobile
            >
                <Tab
                    label="Catálogo de códigos"
                    icon={<CodeIcon fontSize="small" />}
                    iconPosition="start"
                />
                <Tab
                    label="Asignación por empresa"
                    icon={<BusinessIcon fontSize="small" />}
                    iconPosition="start"
                />
            </Tabs>

            {/* ── TAB 0: Catálogo ── */}
            <TabPanel value={tab} index={0}>
                {isFirstLoad ? (
                    <Paper variant="outlined">
                        <LoadingSkeleton variant="table" rows={8} columns={5} />
                    </Paper>
                ) : isMobile ? (
                    /* ── Mobile: buscador + accordions por grupo/categoría ── */
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <TextField
                            size="small"
                            fullWidth
                            placeholder="Buscar clave o descripción..."
                            value={filterTexto}
                            onChange={e => setFilterTexto(e.target.value)}
                        />
                        {GRUPOS.map(g => (
                            <Accordion key={g.value} defaultExpanded={g.value === grupoSel} variant="outlined">
                                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Chip label={g.label} color={GRUPO_COLOR[g.value]} size="small" />
                                        <Typography variant="body2" color="text.secondary">
                                            {parametros.filter(p => p.grupo === g.value).length} códigos
                                        </Typography>
                                    </Box>
                                </AccordionSummary>
                                <AccordionDetails sx={{ p: 0 }}>
                                    {(categoriasPorGrupo[g.value] || []).map(cat => {
                                        const items = parametros.filter(p => {
                                            if (p.grupo !== g.value || p.categoria !== cat) return false
                                            if (filterTexto) {
                                                const t = filterTexto.toLowerCase()
                                                return p.clave.toLowerCase().includes(t) || p.descripcion.toLowerCase().includes(t)
                                            }
                                            return true
                                        })
                                        if (items.length === 0) return null
                                        return (
                                            <Box key={cat}>
                                                <Typography
                                                    variant="caption"
                                                    fontWeight="bold"
                                                    color="text.secondary"
                                                    sx={{ px: 2, pt: 1.5, pb: 0.5, display: 'block', textTransform: 'uppercase', letterSpacing: 0.5 }}
                                                >
                                                    {cat}
                                                </Typography>
                                                <Divider />
                                                {items.map(p => (
                                                    <Box
                                                        key={p.id}
                                                        sx={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            px: 2,
                                                            py: 1,
                                                            opacity: p.activo ? 1 : 0.4,
                                                            borderBottom: 1,
                                                            borderColor: 'divider',
                                                        }}
                                                    >
                                                        <Box sx={{ flex: 1, minWidth: 0 }}>
                                                            <Typography variant="body2" fontFamily="monospace" fontWeight="bold" noWrap>
                                                                {p.clave}
                                                            </Typography>
                                                            <Typography variant="caption" color="text.secondary" noWrap>
                                                                {p.descripcion}
                                                            </Typography>
                                                        </Box>
                                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                                                            <Switch
                                                                size="small"
                                                                checked={p.activo}
                                                                onChange={() => handleToggleActivo(p)}
                                                                color="success"
                                                            />
                                                            <IconButton size="small" color="primary" disabled={!puedeEditar} onClick={() => handleOpenForm(p)}>
                                                                <EditIcon fontSize="small" />
                                                            </IconButton>
                                                            <IconButton size="small" color="error" disabled={!puedeEliminar} onClick={() => handleDelete(p)}>
                                                                <DeleteIcon fontSize="small" />
                                                            </IconButton>
                                                        </Box>
                                                    </Box>
                                                ))}
                                            </Box>
                                        )
                                    })}
                                </AccordionDetails>
                            </Accordion>
                        ))}
                    </Box>
                ) : (
                    /* ── Desktop: panel izquierdo + tabla ── */
                    <Box sx={{ display: 'flex', gap: 2, height: 'calc(100vh - 280px)', minHeight: 500 }}>
                        {/* Panel de navegación */}
                        <Paper variant="outlined" sx={{ width: 220, flexShrink: 0, overflow: 'auto', p: 1 }}>
                            {GRUPOS.map(g => (
                                <Box key={g.value}>
                                    <ListItemButton
                                        selected={grupoSel === g.value && !categoriaSel}
                                        onClick={() => { setGrupoSel(g.value); setCategoriaSel(null); setFilterTexto('') }}
                                        sx={{ borderRadius: 1, mb: 0.5 }}
                                    >
                                        <ListItemText
                                            primary={<Typography fontWeight="bold" variant="body2">{g.label}</Typography>}
                                            secondary={`${parametros.filter(p => p.grupo === g.value).length} códigos`}
                                        />
                                        <IconButton size="small" onClick={e => { e.stopPropagation(); toggleCat(g.value) }}>
                                            {openCats[g.value] ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                                        </IconButton>
                                    </ListItemButton>
                                    <Collapse in={openCats[g.value] ?? true}>
                                        <List dense disablePadding sx={{ pl: 2 }}>
                                            {(categoriasPorGrupo[g.value] || []).map(cat => (
                                                <ListItemButton
                                                    key={cat}
                                                    selected={grupoSel === g.value && categoriaSel === cat}
                                                    onClick={() => { setGrupoSel(g.value); setCategoriaSel(cat); setFilterTexto('') }}
                                                    sx={{ borderRadius: 1, mb: 0.25 }}
                                                >
                                                    <ListItemText
                                                        primary={<Typography variant="caption">{cat}</Typography>}
                                                        secondary={
                                                            <Typography variant="caption" color="text.disabled">
                                                                {parametros.filter(p => p.grupo === g.value && p.categoria === cat).length}
                                                            </Typography>
                                                        }
                                                    />
                                                </ListItemButton>
                                            ))}
                                        </List>
                                    </Collapse>
                                </Box>
                            ))}
                        </Paper>

                        {/* Panel tabla */}
                        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1, overflow: 'hidden' }}>
                            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                                <TextField
                                    size="small"
                                    placeholder="Buscar clave o descripción..."
                                    value={filterTexto}
                                    onChange={e => setFilterTexto(e.target.value)}
                                    sx={{ flex: 1, maxWidth: 320 }}
                                />
                                <Typography variant="body2" color="text.secondary">
                                    {codigosFiltrados.length} resultado{codigosFiltrados.length !== 1 ? 's' : ''}
                                    {categoriaSel ? ` en ${categoriaSel}` : ` en ${GRUPO_LABEL[grupoSel] || grupoSel}`}
                                </Typography>
                            </Box>

                            <TableContainer component={Paper} variant="outlined" sx={{ flex: 1, overflow: 'auto' }}>
                                <Table size="small" stickyHeader>
                                    <TableHead>
                                        <TableRow>
                                            <TableCell sx={{ fontWeight: 'bold', width: 120 }}>Clave</TableCell>
                                            <TableCell sx={{ fontWeight: 'bold' }}>Descripción</TableCell>
                                            <TableCell sx={{ fontWeight: 'bold', width: 150 }}>Categoría</TableCell>
                                            <TableCell sx={{ fontWeight: 'bold', width: 90 }} align="center">Activo</TableCell>
                                            <TableCell sx={{ fontWeight: 'bold', width: 80 }} align="right">Acciones</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {codigosFiltrados.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={5}>
                                                    <EmptyState
                                                        title="Sin resultados"
                                                        description={`No hay códigos${categoriaSel ? ` en la categoría ${categoriaSel}` : ` para ${GRUPO_LABEL[grupoSel] || grupoSel}`}${filterTexto ? ` que coincidan con "${filterTexto}"` : ''}.`}
                                                        icon={<CodeIcon />}
                                                        action={{
                                                            label: 'Nuevo código',
                                                            onClick: () => handleOpenForm(),
                                                        }}
                                                    />
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            codigosFiltrados.map(p => (
                                                <TableRow key={p.id} sx={{ opacity: p.activo ? 1 : 0.4 }}>
                                                    <TableCell>
                                                        <Typography variant="body2" fontFamily="monospace" fontWeight="bold">
                                                            {p.clave}
                                                        </Typography>
                                                    </TableCell>
                                                    <TableCell>{p.descripcion}</TableCell>
                                                    <TableCell>
                                                        {p.categoria
                                                            ? <Chip label={p.categoria} size="small" variant="outlined" />
                                                            : <Typography variant="body2" color="text.disabled">—</Typography>}
                                                    </TableCell>
                                                    <TableCell align="center">
                                                        <Tooltip title={p.activo ? 'Desactivar' : 'Activar'}>
                                                            <Switch
                                                                size="small"
                                                                checked={p.activo}
                                                                onChange={() => handleToggleActivo(p)}
                                                                color="success"
                                                            />
                                                        </Tooltip>
                                                    </TableCell>
                                                    <TableCell align="right">
                                                        <Tooltip title="Editar código">
                                                            <IconButton size="small" color="primary" disabled={!puedeEditar} onClick={() => handleOpenForm(p)}>
                                                                <EditIcon fontSize="small" />
                                                            </IconButton>
                                                        </Tooltip>
                                                        <Tooltip title="Eliminar código">
                                                            <IconButton size="small" color="error" disabled={!puedeEliminar} onClick={() => handleDelete(p)}>
                                                                <DeleteIcon fontSize="small" />
                                                            </IconButton>
                                                        </Tooltip>
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        </Box>
                    </Box>
                )}
            </TabPanel>

            {/* ── TAB 1: Asignación por empresa ── */}
            <TabPanel value={tab} index={1}>
                {/* Barra de controles */}
                <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={2}
                    alignItems={{ sm: 'center' }}
                    sx={{ mb: 2 }}
                >
                    <Autocomplete
                        sx={{ minWidth: { xs: '100%', sm: 300 } }}
                        size="small"
                        options={empresas}
                        getOptionLabel={e => e.nombre}
                        value={empresas.find(e => e.id === empresaSel) ?? null}
                        onChange={(_, val) => val ? handleEmpresaChange(val.id) : setEmpresaSel('')}
                        renderInput={params => <TextField {...params} label="Buscar empresa..." />}
                        noOptionsText="Sin resultados"
                    />

                    {empresaSel !== '' && (
                        <TextField
                            size="small"
                            placeholder="Filtrar códigos..."
                            value={filterAsig}
                            onChange={e => setFilterAsig(e.target.value)}
                            sx={{ minWidth: { xs: '100%', sm: 220 } }}
                        />
                    )}

                    {empresaSel !== '' && (
                        <Button
                            variant="contained"
                            disabled={!hayDiferencias() || savingAsig}
                            onClick={handleGuardarAsignacion}
                        >
                            {savingAsig ? 'Guardando...' : 'Guardar cambios'}
                        </Button>
                    )}

                    {hayDiferencias() && (
                        <Typography variant="body2" color="warning.main">
                            Hay cambios sin guardar
                        </Typography>
                    )}
                </Stack>

                {/* Estados vacíos */}
                {empresaSel === '' ? (
                    <Paper variant="outlined">
                        <EmptyState
                            title="Seleccioná una empresa"
                            description="Elegí una empresa en el selector de arriba para ver y editar sus códigos asignados."
                            icon={<BusinessIcon />}
                        />
                    </Paper>
                ) : loadingAsig ? (
                    <Paper variant="outlined">
                        <LoadingSkeleton variant="list" rows={6} />
                    </Paper>
                ) : (
                    /* Columnas de grupos */
                    <Box
                        sx={{
                            display: 'flex',
                            gap: 2,
                            flexDirection: { xs: 'column', md: 'row' },
                        }}
                    >
                        {GRUPOS.map(g => {
                            const paramsGrupo = parametros.filter(p => {
                                if (p.grupo !== g.value) return false
                                if (!filterAsig) return true
                                const t = filterAsig.toLowerCase()
                                return p.descripcion.toLowerCase().includes(t) || p.clave.toLowerCase().includes(t)
                            })
                            const todosGrupoMarcados = paramsGrupo.length > 0 && paramsGrupo.every(p => asignados.has(p.id))
                            return (
                                <Paper
                                    key={g.value}
                                    variant="outlined"
                                    sx={{ flex: 1, p: 2, overflow: 'auto', maxHeight: { md: 'calc(100vh - 340px)' } }}
                                >
                                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                                        <Chip label={g.label} color={GRUPO_COLOR[g.value]} size="small" />
                                        <Button
                                            size="small"
                                            onClick={() => toggleGrupoCompleto(g.value, !todosGrupoMarcados)}
                                        >
                                            {todosGrupoMarcados ? 'Desmarcar todos' : 'Marcar todos'}
                                        </Button>
                                    </Box>
                                    <Divider sx={{ mb: 1 }} />
                                    {(categoriasPorGrupo[g.value] || []).map(cat => {
                                        const paramsCat = paramsGrupo.filter(p => p.categoria === cat)
                                        if (paramsCat.length === 0) return null
                                        const todosCatMarcados = paramsCat.every(p => asignados.has(p.id))
                                        return (
                                            <Box key={cat} sx={{ mb: 1.5 }}>
                                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                    <Typography
                                                        variant="caption"
                                                        fontWeight="bold"
                                                        color="text.secondary"
                                                        sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}
                                                    >
                                                        {cat}
                                                    </Typography>
                                                    <Button
                                                        size="small"
                                                        sx={{ py: 0, fontSize: 11 }}
                                                        onClick={() => toggleCategoriaCompleta(g.value, cat, !todosCatMarcados)}
                                                    >
                                                        {todosCatMarcados ? 'Desmarcar' : 'Marcar'}
                                                    </Button>
                                                </Box>
                                                {paramsCat.map(p => (
                                                    <FormControlLabel
                                                        key={p.id}
                                                        sx={{ display: 'flex', ml: 0, mr: 0 }}
                                                        control={
                                                            <Checkbox
                                                                size="small"
                                                                checked={asignados.has(p.id)}
                                                                onChange={() => toggleAsignado(p.id)}
                                                            />
                                                        }
                                                        label={
                                                            <Tooltip title={p.clave} placement="right">
                                                                <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                                                                    {p.descripcion}
                                                                </Typography>
                                                            </Tooltip>
                                                        }
                                                    />
                                                ))}
                                            </Box>
                                        )
                                    })}
                                </Paper>
                            )
                        })}
                    </Box>
                )}
            </TabPanel>

            {/* ── Dialog crear/editar ── */}
            <Dialog
                open={open}
                onClose={() => setOpen(false)}
                fullScreen={isMobile}
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle>{editing ? 'Editar código' : 'Nuevo código'}</DialogTitle>
                <Divider />
                <DialogContent>
                    <Stack spacing={2.5} sx={{ pt: 1 }}>
                        <FormControl fullWidth size="small">
                            <InputLabel>Grupo *</InputLabel>
                            <Select
                                value={formData.grupo}
                                label="Grupo *"
                                onChange={e => setFormData({ ...formData, grupo: e.target.value, categoria: '' })}
                            >
                                {GRUPOS.map(g => <MenuItem key={g.value} value={g.value}>{g.label}</MenuItem>)}
                            </Select>
                        </FormControl>
                        <TextField
                            label="Clave *"
                            fullWidth
                            size="small"
                            value={formData.clave}
                            onChange={e => setFormData({ ...formData, clave: e.target.value.toUpperCase() })}
                            placeholder="Ej: GES-001"
                            helperText="Formato recomendado: GES-XXX / SIT-XXX / MNP-XXX"
                        />
                        <TextField
                            label="Descripción *"
                            fullWidth
                            size="small"
                            value={formData.descripcion}
                            onChange={e => setFormData({ ...formData, descripcion: e.target.value })}
                        />
                        <FormControl fullWidth size="small">
                            <InputLabel>Categoría</InputLabel>
                            <Select
                                value={formData.categoria}
                                label="Categoría"
                                onChange={e => setFormData({ ...formData, categoria: e.target.value })}
                            >
                                <MenuItem value=""><em>Sin categoría</em></MenuItem>
                                {(categoriasPorGrupo[formData.grupo] || []).map(c => (
                                    <MenuItem key={c} value={c}>{c}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        {/*
                          Acá había un check "Global (todas las empresas)". Se sacó porque **no hacía
                          nada**: se persistía en `parametro.esGlobal` y ningún filtro lo leía, así
                          que un código creado como global no aparecía en ninguna cartera hasta que
                          alguien lo asignara a mano. Prometía justo lo contrario de lo que pasaba.
                          La visibilidad depende solo de la asignación por empresa, en la otra solapa.
                        */}
                        <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                            <FormControlLabel
                                control={
                                    <Checkbox
                                        checked={formData.activo}
                                        onChange={e => setFormData({ ...formData, activo: e.target.checked })}
                                    />
                                }
                                label="Activo"
                            />
                        </Box>
                        {formError && (
                            <Typography color="error" variant="body2">{formError}</Typography>
                        )}
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
                    <Button onClick={handleSave} variant="contained" disabled={saving}>
                        {saving ? 'Guardando...' : 'Guardar'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    )
}

export default AjustesParametros
