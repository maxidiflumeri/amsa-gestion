import React, { useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Box,
    Button,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    IconButton,
    InputAdornment,
    List,
    ListItemButton,
    ListItemText,
    ListSubheader,
    MenuItem,
    Stack,
    Step,
    StepLabel,
    Stepper,
    TextField,
    Tooltip,
    Typography,
    useMediaQuery,
    useTheme,
} from '@mui/material'
import VisibilityIcon from '@mui/icons-material/Visibility'
import AttachFileIcon from '@mui/icons-material/AttachFile'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import { emailApi } from '../../api/email'
import type {
    EmailTemplateDetalle,
    EmailTemplateListItem,
    DestinatarioDisponible,
    VariableSugerida,
    FuenteVariable,
    FuenteTipo,
    MapeoVariable,
    MapeoVariableInput,
} from '../../types/email'
import { useNotify } from '../../hooks/useNotify'

interface Props {
    open: boolean
    onClose: () => void
    deudorId: number
    empresaId: number
    destinatarioInicial?: string
    onEnviado?: () => void
}

const MAX_MB = 10
const MAX_FILES = 10
/** Tope del tamaño sumado. Sin esto se podían armar 100 MB que el SMTP rechaza recién al final. */
const MAX_TOTAL_MB = 20

interface MapeoLocal {
    fuenteTipo: FuenteTipo | null
    fuenteClave: string
}

const fuenteIdentifier = (tipo: FuenteTipo, clave: string) => `${tipo}:${clave}`

/**
 * Reemplaza las variables **con la misma regla que usa AMSA Sender al enviar**.
 *
 * Antes acá se hacía `split('{{'+clave+'}}')`, coincidencia exacta, y Sender usa
 * `/{{\s*(\w+)\s*}}/g`. Las dos diferencias importaban:
 *
 *  - `{{ nombre }}` con espacios se veía con el hueco literal en la previsualización y salía bien.
 *  - `{{monto-total}}` o `{{deudor.nombre}}` —que `\w+` no acepta— se veían bien en la
 *    previsualización y salían con el `{{}}` literal en el mail del deudor.
 *
 * O sea: la pantalla mostraba algo distinto de lo que iba a llegar, en los dos sentidos.
 */
const renderComoSender = (texto: string, variables: Record<string, string>) =>
    texto.replace(/{{\s*(\w+)\s*}}/g, (_m, clave: string) => variables[clave] ?? '')

const EnviarEmailDialog: React.FC<Props> = ({
    open,
    onClose,
    deudorId,
    empresaId,
    destinatarioInicial,
    onEnviado,
}) => {
    const theme = useTheme()
    const fullScreen = useMediaQuery(theme.breakpoints.down('md'))
    const notify = useNotify()

    const [activeStep, setActiveStep] = useState(0)
    const [loadingTemplates, setLoadingTemplates] = useState(false)
    const [templates, setTemplates] = useState<EmailTemplateListItem[]>([])
    const [smtpId, setSmtpId] = useState<number | null>(null)
    const [errorCargaTemplates, setErrorCargaTemplates] = useState<string | null>(null)

    const [templateSeleccionado, setTemplateSeleccionado] = useState<EmailTemplateListItem | null>(null)
    const [previewBase, setPreviewBase] = useState<EmailTemplateDetalle | null>(null)
    /**
     * La plantilla que se está espiando con la lupa del paso 1.
     *
     * Va aparte de `previewBase` a propósito: antes la lupa pisaba `previewBase` sin tocar
     * `templateSeleccionado`, así que espiar una segunda plantilla cambiaba lo que mostraban los
     * pasos 2 y 4 pero no lo que se enviaba. Se leía una y se mandaba otra.
     */
    const [templateEspiado, setTemplateEspiado] = useState<EmailTemplateDetalle | null>(null)

    const [loadingVars, setLoadingVars] = useState(false)
    const [variables, setVariables] = useState<Record<string, string>>({})
    const [sugerencias, setSugerencias] = useState<VariableSugerida[]>([])
    const [destinatariosDisp, setDestinatariosDisp] = useState<DestinatarioDisponible[]>([])
    const [fuentes, setFuentes] = useState<FuenteVariable[]>([])
    const [mapeos, setMapeos] = useState<Record<string, MapeoLocal>>({})
    const [mapeosOriginales, setMapeosOriginales] = useState<Record<string, MapeoLocal>>({})

    const [destinatarios, setDestinatarios] = useState<string[]>([])
    const [destInput, setDestInput] = useState('')
    const [asunto, setAsunto] = useState<string>('')
    const [archivos, setArchivos] = useState<File[]>([])
    const [enviando, setEnviando] = useState(false)

    const stepNames = ['Plantilla', 'Variables', 'Destino y adjuntos', 'Previsualizar y enviar']

    useEffect(() => {
        if (!open) return
        let cancel = false
        setActiveStep(0)
        setTemplateSeleccionado(null)
        setPreviewBase(null)
        setTemplateEspiado(null)
        setVariables({})
        setSugerencias([])
        setDestinatariosDisp([])
        setFuentes([])
        setMapeos({})
        setMapeosOriginales({})
        setDestinatarios(destinatarioInicial ? [destinatarioInicial] : [])
        setDestInput('')
        setAsunto('')
        setArchivos([])
        setErrorCargaTemplates(null)
        setLoadingTemplates(true)

        Promise.all([emailApi.templatesDeEmpresa(empresaId), emailApi.fuentesDeEmpresa(empresaId)])
            .then(([tplRes, fuentesRes]) => {
                if (cancel) return
                setSmtpId(tplRes.smtpId)
                setTemplates(tplRes.templates)
                setFuentes(fuentesRes)
            })
            .catch((err: any) => {
                if (cancel) return
                const msg = err?.response?.data?.message || err?.message || 'No se pudieron cargar las plantillas'
                setErrorCargaTemplates(msg)
            })
            .finally(() => {
                if (!cancel) setLoadingTemplates(false)
            })

        return () => {
            cancel = true
        }
    }, [open, empresaId, destinatarioInicial])

    const handleSeleccionarTemplate = async (t: EmailTemplateListItem) => {
        setTemplateSeleccionado(t)
        setLoadingVars(true)
        try {
            const [previewRes, mapeosRes] = await Promise.all([
                emailApi.previewVariables(deudorId, t.id),
                emailApi.mapeosDeTemplate(t.id),
            ])
            setPreviewBase(previewRes.template)
            setAsunto(previewRes.template.asunto)
            const initialVars: Record<string, string> = {}
            previewRes.sugerencias.forEach((s) => {
                initialVars[s.variable] = s.valor ?? ''
            })
            setVariables(initialVars)
            setSugerencias(previewRes.sugerencias)
            setDestinatariosDisp(previewRes.destinatariosDisponibles)

            const mapsLocal: Record<string, MapeoLocal> = {}
            mapeosRes.forEach((m: MapeoVariable) => {
                mapsLocal[m.variable] = { fuenteTipo: m.fuenteTipo, fuenteClave: m.fuenteClave }
            })
            setMapeos(mapsLocal)
            setMapeosOriginales(mapsLocal)

            if (!destinatarioInicial && destinatarios.length === 0) {
                const principales = previewRes.destinatariosDisponibles.filter((d) => d.principal).map((d) => d.valor)
                setDestinatarios(principales)
            }
            setActiveStep(1)
        } catch (err) {
            notify.error(err as Error)
        } finally {
            setLoadingVars(false)
        }
    }

    const handlePreview = async (templateId: number) => {
        try {
            setTemplateEspiado(await emailApi.previewTemplate(templateId))
        } catch (err) {
            notify.error(err as Error)
        }
    }

    const handleCambiarFuente = async (variable: string, valor: string) => {
        if (!valor) {
            setMapeos((prev) => {
                const next = { ...prev }
                delete next[variable]
                return next
            })
            return
        }
        const [tipo, clave] = valor.split(':') as [FuenteTipo, string]
        setMapeos((prev) => ({ ...prev, [variable]: { fuenteTipo: tipo, fuenteClave: clave } }))
        await reSugerirConMapeoLocal(variable, tipo, clave)
    }

    const reSugerirConMapeoLocal = async (variable: string, tipo: FuenteTipo, clave: string) => {
        if (!templateSeleccionado) return
        try {
            await emailApi.guardarMapeosTemplate(templateSeleccionado.id, [
                { variable, fuenteTipo: tipo, fuenteClave: clave },
            ])
            const res = await emailApi.previewVariables(deudorId, templateSeleccionado.id)
            setSugerencias(res.sugerencias)
            const sug = res.sugerencias.find((s) => s.variable === variable)
            setVariables((prev) => ({ ...prev, [variable]: sug?.valor ?? '' }))
            setMapeosOriginales((prev) => ({ ...prev, [variable]: { fuenteTipo: tipo, fuenteClave: clave } }))
        } catch (err) {
            notify.error(err as Error)
        }
    }

    const handleAttachClick = () => {
        const input = document.getElementById('email-archivos-input') as HTMLInputElement | null
        input?.click()
    }

    const handleArchivosChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || [])
        const allowed: File[] = []
        for (const f of files) {
            if (f.size > MAX_MB * 1024 * 1024) {
                notify.error(`"${f.name}" supera ${MAX_MB}MB`)
                continue
            }
            allowed.push(f)
        }
        const next = [...archivos, ...allowed].slice(0, MAX_FILES)
        // El `.slice` descartaba los sobrantes **en silencio**: se arrastraban quince archivos, se
        // quedaban diez y nadie se enteraba de cuáles faltaban.
        const descartados = archivos.length + allowed.length - next.length
        if (descartados > 0) {
            notify.warning(
                `Solo se pueden adjuntar ${MAX_FILES} archivos: se descartaron los últimos ${descartados}.`,
            )
        }

        // Y no había tope de tamaño **total**: diez de 10 MB son 100 MB que el SMTP va a rechazar
        // recién al final, y el error vuelve como un fallo genérico.
        const totalMb = next.reduce((acc, f) => acc + f.size, 0) / (1024 * 1024)
        if (totalMb > MAX_TOTAL_MB) {
            notify.error(
                `Los adjuntos suman ${totalMb.toFixed(1)}MB y el máximo es ${MAX_TOTAL_MB}MB. Sacá alguno.`,
            )
            return
        }

        setArchivos(next)
        e.target.value = ''
    }

    const removeArchivo = (idx: number) => {
        setArchivos(archivos.filter((_, i) => i !== idx))
    }

    const addDestinatario = (valor: string) => {
        const trimmed = valor.trim().replace(/,$/, '').trim()
        if (!trimmed) return
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
            notify.error(`"${trimmed}" no es un email válido`)
            return
        }
        if (destinatarios.includes(trimmed)) return
        setDestinatarios([...destinatarios, trimmed])
        setDestInput('')
    }

    const removeDestinatario = (valor: string) => {
        setDestinatarios(destinatarios.filter((d) => d !== valor))
    }

    const persistirMapeosPendientes = async () => {
        if (!templateSeleccionado) return
        const pending: MapeoVariableInput[] = []
        const allVars = new Set([...Object.keys(mapeos), ...Object.keys(mapeosOriginales)])
        for (const v of allVars) {
            const actual = mapeos[v]
            const original = mapeosOriginales[v]
            if (!actual && original) {
                pending.push({ variable: v, fuenteTipo: null })
            } else if (actual && (!original || original.fuenteTipo !== actual.fuenteTipo || original.fuenteClave !== actual.fuenteClave)) {
                pending.push({ variable: v, fuenteTipo: actual.fuenteTipo, fuenteClave: actual.fuenteClave })
            }
        }
        if (pending.length > 0) {
            try {
                await emailApi.guardarMapeosTemplate(templateSeleccionado.id, pending)
            } catch (err) {
                notify.error(err as Error)
            }
        }
    }

    const handleEnviar = async () => {
        if (destinatarios.length === 0) {
            notify.error('Agregá al menos un destinatario')
            return
        }
        if (!templateSeleccionado) return
        setEnviando(true)
        try {
            await persistirMapeosPendientes()
            const res = await emailApi.enviar({
                deudorId,
                templateId: templateSeleccionado.id,
                destinatarios,
                asunto: asunto || undefined,
                variables,
                archivos,
            })
            // Un destinatario dado de baja no es un error del envío: el resto sí sale. Se avisa aparte
            // para que el gestor sepa que a esa dirección no le llegó y busque otro canal.
            if (res.omitidos?.length) {
                notify.warning(
                    `No se envió a ${res.omitidos.map((o) => o.email).join(', ')}: se dio de baja de los envíos.`,
                )
            }
            if (res.ok) {
                if (res.enviados > 0) {
                    notify.success(`Email enviado a ${res.enviados} destinatario${res.enviados === 1 ? '' : 's'}`)
                }
                onEnviado?.()
                onClose()
            } else {
                const detalle = res.errores?.[0]?.error || 'Error al enviar'
                notify.error(detalle)
            }
        } catch (err) {
            notify.error(err as Error)
        } finally {
            setEnviando(false)
        }
    }

    const previewRendered = useMemo(
        () => (previewBase ? renderComoSender(previewBase.html || '', variables) : null),
        [previewBase, variables],
    )

    const asuntoRendered = useMemo(() => renderComoSender(asunto || '', variables), [asunto, variables])

    const fuentesCatalogo = fuentes.filter((f) => f.tipo === 'campo_deudor')
    const fuentesAdicionales = fuentes.filter((f) => f.tipo === 'campo_adicional')

    const variablesSinValor = useMemo(() => {
        if (!previewBase) return [] as string[]
        return (previewBase.variables || []).filter((v) => !(variables[v] ?? '').trim())
    }, [previewBase, variables])

    const renderStep0 = () => (
        <Box>
            {loadingTemplates && (
                <Stack alignItems="center" py={4}>
                    <CircularProgress size={28} />
                    <Typography variant="caption" mt={1}>Cargando plantillas...</Typography>
                </Stack>
            )}
            {errorCargaTemplates && <Alert severity="warning">{errorCargaTemplates}</Alert>}
            {!loadingTemplates && !errorCargaTemplates && templates.length === 0 && (
                <Alert severity="info">No hay plantillas disponibles para esta empresa.</Alert>
            )}
            {!loadingTemplates && smtpId != null && templates.length > 0 && (
                <List dense>
                    {templates.map((t) => (
                        <ListItemButton key={t.id} onClick={() => handleSeleccionarTemplate(t)}>
                            <ListItemText
                                primary={t.nombre}
                                secondary={t.asunto}
                                primaryTypographyProps={{ fontWeight: 600 }}
                            />
                            <Tooltip title="Vista previa">
                                <IconButton
                                    edge="end"
                                    size="small"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        handlePreview(t.id)
                                    }}
                                >
                                    <VisibilityIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        </ListItemButton>
                    ))}
                </List>
            )}
        </Box>
    )

    const renderHelperParaVariable = (v: string): string => {
        const sug = sugerencias.find((s) => s.variable === v)
        if (!sug) return ''
        if (sug.origen === 'mapeo_guardado') return `Mapeado a ${sug.fuente ?? 'fuente'}`
        if (sug.origen === 'auto') return `Auto desde ${sug.fuente ?? 'catálogo'}`
        if (sug.origen === 'campo_adicional') return `Detectado en datos adicionales (${sug.fuente})`
        return 'Elegí una fuente o completalo manualmente'
    }

    const renderFuenteSelect = (v: string) => {
        const m = mapeos[v]
        const value = m ? fuenteIdentifier(m.fuenteTipo!, m.fuenteClave) : ''
        return (
            <TextField
                select
                size="small"
                label="Mapear desde…"
                value={value}
                onChange={(e) => handleCambiarFuente(v, e.target.value)}
                sx={{ minWidth: 240 }}
            >
                <MenuItem value=""><em>(sin mapeo guardado)</em></MenuItem>
                <ListSubheader>Campos del deudor</ListSubheader>
                {fuentesCatalogo.map((f) => (
                    <MenuItem key={`d-${f.clave}`} value={fuenteIdentifier(f.tipo, f.clave)}>
                        {f.label}
                    </MenuItem>
                ))}
                {fuentesAdicionales.length > 0 && <ListSubheader>Campos adicionales</ListSubheader>}
                {fuentesAdicionales.map((f) => (
                    <MenuItem key={`a-${f.clave}`} value={fuenteIdentifier(f.tipo, f.clave)}>
                        {f.label}
                    </MenuItem>
                ))}
            </TextField>
        )
    }

    const renderStep1 = () => {
        if (loadingVars || !previewBase) {
            return (
                <Stack alignItems="center" py={4}>
                    <CircularProgress size={28} />
                </Stack>
            )
        }
        const vars = previewBase.variables || []
        return (
            <Stack spacing={2}>
                {vars.length === 0 ? (
                    <Alert severity="info">Esta plantilla no usa variables. Pasá al siguiente paso.</Alert>
                ) : (
                    <>
                        <Alert severity="info" sx={{ py: 0.5 }}>
                            Si una variable no se mapea sola, elegí <strong>"Mapear desde…"</strong> y queda guardada para futuros envíos con este template.
                        </Alert>
                        {vars.map((v) => {
                            const sug = sugerencias.find((s) => s.variable === v)
                            const mapeoActual = mapeos[v]
                            return (
                                <Box key={v}>
                                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'flex-start' }}>
                                        <TextField
                                            label={`{{${v}}}`}
                                            value={variables[v] ?? ''}
                                            onChange={(e) => setVariables({ ...variables, [v]: e.target.value })}
                                            helperText={renderHelperParaVariable(v)}
                                            size="small"
                                            fullWidth
                                            InputProps={{
                                                endAdornment: mapeoActual ? (
                                                    <InputAdornment position="end">
                                                        <Tooltip title={`Mapeado: ${mapeoActual.fuenteTipo} → ${mapeoActual.fuenteClave}`}>
                                                            <CheckCircleIcon color="success" fontSize="small" />
                                                        </Tooltip>
                                                    </InputAdornment>
                                                ) : sug?.origen === 'auto' || sug?.origen === 'campo_adicional' ? (
                                                    <InputAdornment position="end">
                                                        <Tooltip title="Resuelta automáticamente">
                                                            <CheckCircleIcon color="action" fontSize="small" />
                                                        </Tooltip>
                                                    </InputAdornment>
                                                ) : null,
                                            }}
                                        />
                                        {renderFuenteSelect(v)}
                                    </Stack>
                                </Box>
                            )
                        })}
                    </>
                )}
            </Stack>
        )
    }

    const renderStep2 = () => (
        <Stack spacing={2}>
            <Box>
                <Typography variant="subtitle2" mb={0.5}>Destinatarios</Typography>
                {destinatariosDisp.length > 0 && (
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" mb={1}>
                        {destinatariosDisp.map((d) => {
                            const ya = destinatarios.includes(d.valor)
                            return (
                                <Chip
                                    key={d.id}
                                    label={`${d.valor}${d.principal ? ' (principal)' : ''}`}
                                    size="small"
                                    color={ya ? 'primary' : 'default'}
                                    onClick={() => (ya ? removeDestinatario(d.valor) : addDestinatario(d.valor))}
                                    sx={{ mb: 0.5 }}
                                />
                            )
                        })}
                    </Stack>
                )}
                <Stack direction="row" spacing={1} flexWrap="wrap" mb={1}>
                    {destinatarios.map((d) => (
                        <Chip key={d} label={d} size="small" onDelete={() => removeDestinatario(d)} sx={{ mb: 0.5 }} />
                    ))}
                </Stack>
                <TextField
                    label="Agregar destinatario"
                    placeholder="email@ejemplo.com (Enter o coma para confirmar)"
                    value={destInput}
                    onChange={(e) => setDestInput(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ',') {
                            e.preventDefault()
                            addDestinatario(destInput)
                        }
                    }}
                    onBlur={() => destInput.trim() && addDestinatario(destInput)}
                    size="small"
                    fullWidth
                />
            </Box>

            <TextField
                label="Asunto"
                value={asunto}
                onChange={(e) => setAsunto(e.target.value)}
                size="small"
                fullWidth
            />

            <Box>
                <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                    <Typography variant="subtitle2">Adjuntos</Typography>
                    <Typography variant="caption" color="text.secondary">
                        máx {MAX_FILES} archivos, {MAX_MB}MB c/u y {MAX_TOTAL_MB}MB en total
                    </Typography>
                    <Box flexGrow={1} />
                    <Button size="small" startIcon={<AttachFileIcon />} onClick={handleAttachClick} disabled={archivos.length >= MAX_FILES}>
                        Adjuntar
                    </Button>
                    <input
                        id="email-archivos-input"
                        type="file"
                        hidden
                        multiple
                        onChange={handleArchivosChange}
                    />
                </Stack>
                <Stack spacing={0.5}>
                    {archivos.length === 0 && (
                        <Typography variant="caption" color="text.disabled">Sin adjuntos</Typography>
                    )}
                    {archivos.map((f, i) => (
                        <Stack key={`${f.name}-${i}`} direction="row" alignItems="center" spacing={1}>
                            <AttachFileIcon fontSize="small" color="action" />
                            <Typography variant="body2" sx={{ flexGrow: 1, wordBreak: 'break-all' }}>
                                {f.name} <Typography component="span" variant="caption" color="text.secondary">({(f.size / 1024).toFixed(0)} KB)</Typography>
                            </Typography>
                            <IconButton size="small" onClick={() => removeArchivo(i)}>
                                <DeleteIcon fontSize="small" />
                            </IconButton>
                        </Stack>
                    ))}
                </Stack>
            </Box>
        </Stack>
    )

    const renderStep3 = () => (
        <Stack spacing={2}>
            {variablesSinValor.length > 0 && (
                <Alert severity="warning" sx={{ py: 0.5 }}>
                    Hay variables sin valor: {variablesSinValor.map((v) => `{{${v}}}`).join(', ')}. Quedarán vacías en el email.
                </Alert>
            )}
            <Box>
                <Typography variant="caption" color="text.secondary">Para</Typography>
                <Stack direction="row" spacing={0.5} flexWrap="wrap">
                    {destinatarios.map((d) => (
                        <Chip key={d} label={d} size="small" sx={{ mb: 0.5 }} />
                    ))}
                </Stack>
            </Box>
            <Box>
                <Typography variant="caption" color="text.secondary">Asunto</Typography>
                <Typography variant="body1" fontWeight={600}>{asuntoRendered || <em>(sin asunto)</em>}</Typography>
            </Box>
            <Box>
                <Typography variant="caption" color="text.secondary">Contenido</Typography>
                <Box
                    sx={{
                        mt: 0.5,
                        p: 1.5,
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1,
                        maxHeight: 360,
                        overflow: 'auto',
                        bgcolor: 'background.default',
                    }}
                    dangerouslySetInnerHTML={{ __html: previewRendered || '' }}
                />
            </Box>
            {archivos.length > 0 && (
                <Box>
                    <Typography variant="caption" color="text.secondary">Adjuntos</Typography>
                    <Stack spacing={0.25}>
                        {archivos.map((f, i) => (
                            <Typography key={`${f.name}-${i}`} variant="body2">
                                <AttachFileIcon fontSize="inherit" sx={{ verticalAlign: 'middle', mr: 0.5 }} />
                                {f.name} <Typography component="span" variant="caption" color="text.secondary">({(f.size / 1024).toFixed(0)} KB)</Typography>
                            </Typography>
                        ))}
                    </Stack>
                </Box>
            )}
            <Divider />
            <Typography variant="caption" color="text.disabled">
                Verificá los datos. Al confirmar se envía el email y se guardan los mapeos de variables.
            </Typography>
        </Stack>
    )

    const puedeAvanzar =
        activeStep === 0
            ? !!templateSeleccionado
            : activeStep === 1
              ? !!previewBase
              : activeStep === 2
                ? destinatarios.length > 0
                : true

    return (
        <>
            <Dialog open={open} onClose={enviando ? undefined : onClose} fullScreen={fullScreen} maxWidth="md" fullWidth>
                <DialogTitle>Enviar email</DialogTitle>
                <DialogContent>
                    <Stepper activeStep={activeStep} sx={{ mb: 3 }}>
                        {stepNames.map((s) => (
                            <Step key={s}>
                                <StepLabel>{s}</StepLabel>
                            </Step>
                        ))}
                    </Stepper>
                    {activeStep === 0 && renderStep0()}
                    {activeStep === 1 && renderStep1()}
                    {activeStep === 2 && renderStep2()}
                    {activeStep === 3 && renderStep3()}
                </DialogContent>
                <DialogActions>
                    <Button onClick={onClose} disabled={enviando}>Cancelar</Button>
                    {activeStep > 0 && (
                        <Button onClick={() => setActiveStep(activeStep - 1)} disabled={enviando}>
                            Anterior
                        </Button>
                    )}
                    {activeStep < 3 && (
                        <Button
                            variant="contained"
                            disabled={!puedeAvanzar}
                            onClick={() => setActiveStep(activeStep + 1)}
                        >
                            Siguiente
                        </Button>
                    )}
                    {activeStep === 3 && (
                        <Button variant="contained" onClick={handleEnviar} disabled={enviando || destinatarios.length === 0}>
                            {enviando ? 'Enviando...' : 'Enviar'}
                        </Button>
                    )}
                </DialogActions>
            </Dialog>

            <Dialog open={!!templateEspiado} onClose={() => setTemplateEspiado(null)} maxWidth="md" fullWidth>
                <DialogTitle>{templateEspiado?.nombre}</DialogTitle>
                <DialogContent>
                    <Typography variant="caption" color="text.secondary">Asunto</Typography>
                    <Typography variant="body2" mb={2} fontWeight={600}>{templateEspiado?.asunto}</Typography>
                    <Box
                        sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'background.default' }}
                        dangerouslySetInnerHTML={{ __html: templateEspiado?.html || '' }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setTemplateEspiado(null)}>Cerrar</Button>
                    {templateEspiado && templateEspiado.id !== templateSeleccionado?.id && (
                        <Button
                            variant="contained"
                            onClick={() => {
                                const t = templateEspiado
                                setTemplateEspiado(null)
                                handleSeleccionarTemplate({ id: t.id, nombre: t.nombre } as EmailTemplateListItem)
                            }}
                        >
                            Usar esta plantilla
                        </Button>
                    )}
                </DialogActions>
            </Dialog>
        </>
    )
}

export default EnviarEmailDialog
