import React, { useState, useEffect } from 'react'
import {
    Accordion,
    AccordionDetails,
    AccordionSummary,
    Box,
    Button,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    IconButton,
    MenuItem,
    Paper,
    Stack,
    TextField,
    Tooltip,
    Typography,
    useMediaQuery,
    useTheme,
} from '@mui/material'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import AddIcon from '@mui/icons-material/Add'
import BusinessIcon from '@mui/icons-material/Business'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import api from '../../api/axios'
import { emailApi } from '../../api/email'
import type { SmtpAccount, EmailTemplateListItem } from '../../types/email'
import { multiclavesApi, ConfigMulticlaves } from '../../api/multiclaves'
import {
    PageHeader,
    DataTableResponsive,
    EmptyState,
    LoadingSkeleton,
} from '../../components/ui'
import type { DataTableColumn } from '../../components/ui'
import { useNotify } from '../../hooks/useNotify'
import { useConfirm } from '../../context/ConfirmContext'
import { useAuth } from '../../context/AuthContext'

interface Empresa {
    id: number
    nombre: string
    cuit: string
    cuentaSmtpId?: number | null
    configuracion?: any
}

const DEFAULT_MAX_DIAS_PROMESA = 7

type EmpresaRow = Empresa & Record<string, unknown>

const AjustesEmpresas: React.FC = () => {
    const theme = useTheme()
    const isMobile = useMediaQuery(theme.breakpoints.down('md'))
    const notify = useNotify()
    const confirm = useConfirm()
    const { tienePermiso } = useAuth()
    const puedeAdministrarEmail = tienePermiso('email.administrar')
    const puedeEnviarEmail = tienePermiso('email.enviar')

    const [empresas, setEmpresas] = useState<Empresa[]>([])
    const [loading, setLoading] = useState(true)
    const [open, setOpen] = useState(false)
    const [editing, setEditing] = useState<Empresa | null>(null)
    const [saving, setSaving] = useState(false)
    const [formData, setFormData] = useState<{ nombre: string; cuit: string; cuentaSmtpId: number | null; maxDiasPromesa: number }>({ nombre: '', cuit: '', cuentaSmtpId: null, maxDiasPromesa: DEFAULT_MAX_DIAS_PROMESA })
    const [smtps, setSmtps] = useState<SmtpAccount[]>([])
    const [smtpsLoaded, setSmtpsLoaded] = useState(false)

    // Claves de pago (multiclaves fase 3, §11.4): plantilla preseleccionada + gestión al generar +
    // leyenda del talón + medios de pago. Solo tiene sentido para una empresa ya creada.
    const puedeEditarEmpresa = tienePermiso('empresas.editar')
    type CuponForm = { templateCuponId: number | null; gestionAlGenerar: string; leyendaTalonCedente: string; mediosDePago: string }
    const [cuponForm, setCuponForm] = useState<CuponForm | null>(null)
    // Snapshot de lo que vino del backend, para no escribir `configuracion.multiclaves` si el
    // operador no tocó nada de esta sección — ni en la empresa que sea (hallazgo de la auditoría,
    // §9): antes se mandaba el PATCH siempre que se guardaba CUALQUIER campo de la empresa, así que
    // renombrar AYSA (que nunca usó multiclaves) igual le agregaba un bloque `multiclaves` con los
    // defaults a su `configuracion`.
    const [cuponFormOriginal, setCuponFormOriginal] = useState<CuponForm | null>(null)
    const [cuponTemplates, setCuponTemplates] = useState<EmailTemplateListItem[]>([])
    const [loadingCupon, setLoadingCupon] = useState(false)

    const fetchEmpresas = async () => {
        try {
            const res = await api.get('/empresas')
            setEmpresas(res.data)
        } catch (error) {
            notify.error(error as Error)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchEmpresas()
    }, [])

    const handleOpen = async (empresa?: Empresa) => {
        if (empresa) {
            setEditing(empresa)
            setFormData({
                nombre: empresa.nombre,
                cuit: empresa.cuit || '',
                cuentaSmtpId: empresa.cuentaSmtpId ?? null,
                maxDiasPromesa: empresa.configuracion?.promesa_pago?.maxDias ?? DEFAULT_MAX_DIAS_PROMESA,
            })
        } else {
            setEditing(null)
            setFormData({ nombre: '', cuit: '', cuentaSmtpId: null, maxDiasPromesa: DEFAULT_MAX_DIAS_PROMESA })
        }
        setOpen(true)
        if (puedeAdministrarEmail && !smtpsLoaded) {
            try {
                const list = await emailApi.listarSmtps()
                setSmtps(list)
                setSmtpsLoaded(true)
            } catch (error) {
                notify.error(error as Error)
            }
        }

        setCuponForm(null)
        setCuponFormOriginal(null)
        setCuponTemplates([])
        if (empresa && puedeEditarEmpresa) {
            setLoadingCupon(true)
            try {
                const cfg = await multiclavesApi.obtenerConfig(empresa.id)
                const form: CuponForm = {
                    templateCuponId: cfg.templateCuponId,
                    gestionAlGenerar: cfg.gestionAlGenerar,
                    leyendaTalonCedente: cfg.leyendaTalonCedente,
                    mediosDePago: cfg.mediosDePago.join(', '),
                }
                setCuponForm(form)
                setCuponFormOriginal(form)
                // Sin el permiso de enviar emails no tiene sentido pedirle a Sender la lista de
                // plantillas (hallazgo de la auditoría, §9) — el resto de la sección (gestión,
                // leyenda, medios de pago) no depende de mail y se puede seguir editando igual.
                if (empresa.cuentaSmtpId != null && puedeEnviarEmail) {
                    const tplRes = await emailApi.templatesDeEmpresa(empresa.id)
                    setCuponTemplates(tplRes.templates)
                }
            } catch (error) {
                notify.error(error as Error)
            } finally {
                setLoadingCupon(false)
            }
        }
    }

    const handleClose = () => {
        setOpen(false)
    }

    const handleSave = async () => {
        setSaving(true)
        try {
            const cfgPrevio = (editing?.configuracion as any) || {}
            const configuracion = {
                ...cfgPrevio,
                promesa_pago: { ...(cfgPrevio.promesa_pago || {}), maxDias: formData.maxDiasPromesa },
            }
            const datosEmpresa = { nombre: formData.nombre, cuit: formData.cuit, configuracion }
            let empresaId: number
            if (editing) {
                await api.patch(`/empresas/${editing.id}`, datosEmpresa)
                empresaId = editing.id
            } else {
                const { data } = await api.post('/empresas', datosEmpresa)
                empresaId = data.id
            }

            if (puedeAdministrarEmail) {
                const previo = editing?.cuentaSmtpId ?? null
                if (formData.cuentaSmtpId !== previo) {
                    await emailApi.asignarSmtp(empresaId, formData.cuentaSmtpId)
                }
            }

            // Solo se manda el PATCH de "Claves de pago" si algo cambió de verdad — nunca por editar
            // otro campo de la empresa (hallazgo de la auditoría, §9). Si falla, no se pierde el resto
            // de lo ya guardado arriba: se avisa por separado en vez de decir "Empresa actualizada
            // correctamente" como si todo hubiera salido bien.
            let configCuponFallo: string | null = null
            if (editing && puedeEditarEmpresa && cuponForm && cuponFormOriginal) {
                // Cada campo se manda SOLO si cambió respecto de lo cargado (hallazgo de la
                // auditoría): antes, tocar nada más que "medios de pago" igual reenviaba
                // `templateCuponId` sin cambios — y el backend lo revalida contra Sender en cada
                // `PATCH` (§9.4), así que guardar algo que no tiene nada que ver con la plantilla
                // podía fallar porque Sender está caído, o porque esa plantilla vieja ya no existe.
                const patch: Partial<ConfigMulticlaves> = {}
                if (cuponForm.templateCuponId !== cuponFormOriginal.templateCuponId) {
                    patch.templateCuponId = cuponForm.templateCuponId
                }
                if (cuponForm.gestionAlGenerar !== cuponFormOriginal.gestionAlGenerar) {
                    patch.gestionAlGenerar = cuponForm.gestionAlGenerar
                }
                if (cuponForm.leyendaTalonCedente !== cuponFormOriginal.leyendaTalonCedente) {
                    patch.leyendaTalonCedente = cuponForm.leyendaTalonCedente
                }
                if (cuponForm.mediosDePago !== cuponFormOriginal.mediosDePago) {
                    const mediosDePago = cuponForm.mediosDePago
                        .split(',')
                        .map((m) => m.trim())
                        .filter(Boolean)
                    if (mediosDePago.length > 0) patch.mediosDePago = mediosDePago
                }
                if (Object.keys(patch).length > 0) {
                    try {
                        await multiclavesApi.actualizarConfig(empresaId, patch)
                    } catch (error) {
                        configCuponFallo = (error as any)?.response?.data?.message || (error as Error).message
                    }
                }
            }

            setOpen(false)
            await fetchEmpresas()

            if (configCuponFallo) {
                notify.warning(
                    `${editing ? 'Empresa actualizada' : 'Empresa creada'}, pero no se pudo guardar "Claves de pago": ${configCuponFallo}`,
                )
            } else {
                notify.success(editing ? 'Empresa actualizada correctamente' : 'Empresa creada correctamente')
            }
        } catch (error) {
            notify.error(error as Error)
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async (empresa: Empresa) => {
        const confirmed = await confirm({
            title: 'Eliminar empresa',
            description: `¿Confirmás que querés eliminar la empresa "${empresa.nombre}"? Esta acción no se puede deshacer.`,
            confirmLabel: 'Eliminar',
            cancelLabel: 'Cancelar',
            confirmColor: 'error',
        })

        if (!confirmed) return

        try {
            await api.delete(`/empresas/${empresa.id}`)
            notify.success('Empresa eliminada correctamente')
            await fetchEmpresas()
        } catch (error) {
            notify.error(error as Error)
        }
    }

    const columns: DataTableColumn<EmpresaRow>[] = [
        {
            key: 'nombre',
            label: 'Nombre',
            primary: true,
        },
        {
            key: 'cuit',
            label: 'CUIT',
            secondary: true,
        },
        {
            key: 'acciones',
            label: 'Acciones',
            align: 'right',
            hideInCard: false,
            render: (row) => (
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
                    <Tooltip title="Editar empresa">
                        <IconButton
                            size="small"
                            onClick={(e) => {
                                e.stopPropagation()
                                handleOpen(row as unknown as Empresa)
                            }}
                            color="primary"
                        >
                            <EditIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Eliminar empresa">
                        <IconButton
                            size="small"
                            onClick={(e) => {
                                e.stopPropagation()
                                handleDelete(row as unknown as Empresa)
                            }}
                            color="error"
                        >
                            <DeleteIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Box>
            ),
        },
    ]

    const rows: EmpresaRow[] = empresas.map((e) => ({ ...e } as EmpresaRow))

    const isFirstLoad = loading && empresas.length === 0
    const isEmpty = !loading && empresas.length === 0

    return (
        <Box sx={{ p: 3 }}>
            <PageHeader
                title="Empresas"
                subtitle="Administre las empresas y sus respectivos CUITs"
                actions={[
                    {
                        label: 'Nueva empresa',
                        onClick: () => handleOpen(),
                        startIcon: <AddIcon />,
                        variant: 'contained',
                    },
                ]}
            />

            <Paper variant="outlined">
                {isFirstLoad && <LoadingSkeleton variant="table" rows={5} columns={3} />}

                {isEmpty && (
                    <EmptyState
                        title="No hay empresas registradas"
                        description="Creá la primera empresa para comenzar a gestionar CUITs y asociar políticas."
                        icon={<BusinessIcon />}
                        action={{
                            label: 'Nueva empresa',
                            onClick: () => handleOpen(),
                        }}
                    />
                )}

                {!isFirstLoad && !isEmpty && (
                    <DataTableResponsive<EmpresaRow>
                        columns={columns}
                        rows={rows}
                        rowKey={(row) => String(row.id)}
                    />
                )}
            </Paper>

            <Dialog
                open={open}
                onClose={handleClose}
                fullScreen={isMobile}
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle>
                    {editing ? 'Editar empresa' : 'Nueva empresa'}
                </DialogTitle>
                <DialogContent>
                    <Stack spacing={2.5} sx={{ pt: 1 }}>
                        <TextField
                            autoFocus
                            label="Nombre"
                            fullWidth
                            value={formData.nombre}
                            onChange={(e) =>
                                setFormData({ ...formData, nombre: e.target.value })
                            }
                        />
                        <TextField
                            label="CUIT"
                            fullWidth
                            value={formData.cuit}
                            onChange={(e) =>
                                setFormData({ ...formData, cuit: e.target.value })
                            }
                            placeholder="XX-XXXXXXXX-X"
                        />
                        <TextField
                            label="Máx. días para promesas de pago"
                            type="number"
                            fullWidth
                            value={formData.maxDiasPromesa}
                            inputProps={{ min: 1, max: 30 }}
                            helperText="Tope de días a futuro al cargar una promesa de pago (default 7, rango 1–30)"
                            onChange={(e) => {
                                const n = parseInt(e.target.value, 10)
                                setFormData({
                                    ...formData,
                                    maxDiasPromesa: isNaN(n) ? DEFAULT_MAX_DIAS_PROMESA : Math.min(30, Math.max(1, n)),
                                })
                            }}
                        />
                        {puedeAdministrarEmail && (
                            <TextField
                                select
                                label="Cuenta SMTP"
                                fullWidth
                                value={formData.cuentaSmtpId ?? ''}
                                helperText="Cuenta de envío de Sender que usará esta empresa para emails"
                                onChange={(e) =>
                                    setFormData({
                                        ...formData,
                                        cuentaSmtpId: e.target.value === '' ? null : Number(e.target.value),
                                    })
                                }
                            >
                                <MenuItem value="">
                                    <em>Sin asignar</em>
                                </MenuItem>
                                {smtps.map((s) => (
                                    <MenuItem key={s.id} value={s.id}>
                                        {s.nombre} — {s.emailFrom}
                                    </MenuItem>
                                ))}
                            </TextField>
                        )}

                        {editing && puedeEditarEmpresa && cuponForm && (
                            <Accordion variant="outlined" disableGutters>
                                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                    <Typography variant="subtitle2">Claves de pago (cupón de Telecom/Personal)</Typography>
                                </AccordionSummary>
                                <AccordionDetails>
                                    {loadingCupon ? (
                                        <LoadingSkeleton variant="detail" />
                                    ) : (
                                        <Stack spacing={2}>
                                            <TextField
                                                select
                                                label="Plantilla de mail preseleccionada (opcional)"
                                                fullWidth
                                                size="small"
                                                value={cuponForm.templateCuponId ?? ''}
                                                helperText={
                                                    editing.cuentaSmtpId == null
                                                        ? 'La empresa no tiene cuenta de mail asignada: asignala arriba para poder elegir una plantilla.'
                                                        : !puedeEnviarEmail
                                                          ? 'Necesitás el permiso "Enviar emails a deudores" para ver y elegir plantillas.'
                                                          : 'El operador igual puede elegir otra plantilla, o ninguna, al generar cada cupón.'
                                                }
                                                disabled={editing.cuentaSmtpId == null || !puedeEnviarEmail}
                                                onChange={(e) =>
                                                    setCuponForm({
                                                        ...cuponForm,
                                                        templateCuponId: e.target.value === '' ? null : Number(e.target.value),
                                                    })
                                                }
                                            >
                                                <MenuItem value="">
                                                    <em>Ninguna — mensaje por defecto</em>
                                                </MenuItem>
                                                {cuponTemplates.map((t) => (
                                                    <MenuItem key={t.id} value={t.id}>
                                                        {t.nombre}
                                                    </MenuItem>
                                                ))}
                                            </TextField>
                                            <TextField
                                                label="Código de gestión al generar el cupón"
                                                fullWidth
                                                size="small"
                                                value={cuponForm.gestionAlGenerar}
                                                helperText='Clave del catálogo de gestión, formato "GES-050"'
                                                onChange={(e) => setCuponForm({ ...cuponForm, gestionAlGenerar: e.target.value })}
                                            />
                                            <TextField
                                                label="Leyenda del talón para el cedente"
                                                fullWidth
                                                size="small"
                                                value={cuponForm.leyendaTalonCedente}
                                                onChange={(e) => setCuponForm({ ...cuponForm, leyendaTalonCedente: e.target.value })}
                                            />
                                            <TextField
                                                label="Medios de pago (separados por coma)"
                                                fullWidth
                                                size="small"
                                                value={cuponForm.mediosDePago}
                                                helperText="Se muestran en el cupón y en el mensaje por defecto del mail"
                                                onChange={(e) => setCuponForm({ ...cuponForm, mediosDePago: e.target.value })}
                                            />
                                        </Stack>
                                    )}
                                </AccordionDetails>
                            </Accordion>
                        )}
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleClose} disabled={saving}>
                        Cancelar
                    </Button>
                    <Button
                        onClick={handleSave}
                        variant="contained"
                        disabled={saving || !formData.nombre.trim()}
                    >
                        {saving ? 'Guardando...' : 'Guardar'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    )
}

export default AjustesEmpresas
