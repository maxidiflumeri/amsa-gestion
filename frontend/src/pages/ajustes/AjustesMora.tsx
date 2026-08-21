import React, { useCallback, useEffect, useState } from 'react'
import {
    Alert,
    Box,
    Button,
    Chip,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    InputAdornment,
    MenuItem,
    Paper,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import CalculateIcon from '@mui/icons-material/Calculate'
import api from '../../api/axios'
import { moraApi, EstadoTasa } from '../../api/mora'
import { PageHeader } from '../../components/ui'
import { useNotify } from '../../hooks/useNotify'
import { useConfirm } from '../../context/ConfirmContext'
import { useAuth } from '../../context/AuthContext'

/**
 * Ajustes → Recargo por mora.
 *
 * Todos los meses el cedente manda por mail la tasa activa del BNA. Acá se carga **un solo número**
 * —tal cual lo informa, sin dividir por 100— y el sistema genera el índice diario de los tres tipos.
 * En el CRM viejo el operador hacía las tres multiplicaciones a mano y se equivocó 6 veces en 3 años.
 *
 * Ver docs/mora-aysa-spec.md.
 */

interface Empresa {
    id: number
    nombre: string
}

const periodoActual = () => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const nombrePeriodo = (p: string) => {
    const [a, m] = p.split('-')
    const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
    return `${meses[parseInt(m, 10) - 1]} ${a}`
}

const AjustesMora: React.FC = () => {
    const notify = useNotify()
    const confirm = useConfirm()
    const { tienePermiso } = useAuth()

    const [empresas, setEmpresas] = useState<Empresa[]>([])
    const [empresaId, setEmpresaId] = useState<number | ''>('')
    const [tasas, setTasas] = useState<EstadoTasa[]>([])
    /** Multiplicadores configurados de la empresa. Antes las columnas asumían ×1,5 y ×2 fijos. */
    const [multiplicadores, setMultiplicadores] = useState<Record<string, number>>({ '1': 1, '2': 1.5, '3': 2 })
    const multTipo = (tipo: number) => multiplicadores[String(tipo)] ?? (tipo === 2 ? 1.5 : 2)
    const [faltantes, setFaltantes] = useState<string[]>([])
    const [cargando, setCargando] = useState(false)

    const [dialogAbierto, setDialogAbierto] = useState(false)
    const [periodo, setPeriodo] = useState(periodoActual())
    const [tasaBase, setTasaBase] = useState('')
    const [observacion, setObservacion] = useState('')
    const [guardando, setGuardando] = useState(false)
    const [recalculando, setRecalculando] = useState(false)

    const puedeGestionar = tienePermiso('mora.gestionar_tasas')
    const puedeRecalcular = tienePermiso('mora.recalcular')

    useEffect(() => {
        api.get('/empresas')
            .then((r) => {
                const lista: Empresa[] = r.data ?? []
                setEmpresas(lista)
                if (lista.length) setEmpresaId(lista[0].id)
            })
            .catch(notify.error)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const cargar = useCallback(async (id: number) => {
        setCargando(true)
        try {
            const [t, f] = await Promise.all([moraApi.tasas(id, 24), moraApi.faltantes(id)])
            setTasas(t.tasas)
            setMultiplicadores(t.multiplicadores)
            setFaltantes(f.faltantes)
        } catch (e) {
            notify.error(e as Error)
        } finally {
            setCargando(false)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        if (typeof empresaId === 'number') cargar(empresaId)
    }, [empresaId, cargar])

    const guardar = async () => {
        if (typeof empresaId !== 'number') return
        const valor = parseFloat(tasaBase.replace(',', '.'))
        if (!(valor > 0)) {
            notify.warning('La tasa tiene que ser un número mayor a cero')
            return
        }
        // El error clásico es cargarla ya dividida por 100: 0,02169 en vez de 2,169.
        if (valor < 0.5) {
            const ok = await confirm({
                title: 'La tasa parece muy baja',
                description: `Ingresaste ${valor}. La tasa se carga como la informa el cedente: 2.169 para 2,169% mensual, sin dividir por 100. ¿Seguro que es correcta?`,
            })
            if (!ok) return
        }

        // Qué va a pasar realmente se lo pregunta al backend, no se deduce de las filas que hay en
        // pantalla: la tabla trae solo 24 meses, y recargar uno más viejo regeneraba cientos sin
        // avisar nada.
        const previo = await moraApi.previo(empresaId, periodo).catch((e) => {
            notify.error(e as Error)
            return null
        })
        if (!previo) return

        // Empresa sin ningún índice: este mes sería el arranque de la cadena. El backend lo rechaza
        // salvo que se lo pidan explícito, justamente para que no pase por accidente.
        let permitirInicioDeCadena = false
        if (previo.cadenaVacia) {
            const ok = await confirm({
                title: 'Iniciar la cadena de esta cartera',
                description:
                    `Esta cartera no tiene ningún índice todavía, así que ${nombrePeriodo(periodo)} va a ser su punto de partida. ` +
                    `Las facturas que hayan vencido antes de ese mes van a quedar sin recargo, y no hay forma de calcularlas después. ` +
                    `Si la cartera tiene deuda más vieja, cargá primero el mes más antiguo que necesites.`,
                confirmLabel: 'Iniciar la cadena',
            })
            if (!ok) return
            permitirInicioDeCadena = true
        }

        // Recargar un mes ya cargado obliga a regenerar todos los posteriores.
        if (previo.yaHayTasa || previo.periodosPosteriores.length) {
            const n = previo.periodosPosteriores.length
            const ok = await confirm({
                title: `Ya hay índice para ${nombrePeriodo(periodo)}`,
                description: n
                    ? `Se va a reemplazar, y además se van a regenerar los ${n} mes(es) posterior(es), porque la cadena es acumulativa.`
                    : 'Se va a reemplazar el índice de ese mes.',
            })
            if (!ok) return
        }

        // Pisar índice migrado es una degradación, no una corrección: el dato del cedente es más
        // fiel que lo que se reconstruye desde una tasa mensual única.
        let permitirPisarMigrado = false
        if (previo.periodosMigrados.length) {
            const n = previo.periodosMigrados.length
            const ok = await confirm({
                title: `Vas a pisar ${n} mes(es) de índice del cedente`,
                description:
                    `${previo.periodosMigrados.slice(0, 8).join(', ')}${n > 8 ? ` y ${n - 8} más` : ''} tienen el índice tal como lo informó el cedente. ` +
                    `Regenerarlos lo reemplaza por uno reconstruido desde la tasa mensual, que es menos fiel: hubo meses con más de una tasa vigente. ` +
                    `Salvo que sepas que la tasa cargada está mal, no lo hagas.`,
                confirmLabel: 'Pisar igual',
                confirmColor: 'error',
            })
            if (!ok) return
            permitirPisarMigrado = true
        }

        setGuardando(true)
        try {
            const r = await moraApi.cargarTasa({
                empresaId,
                periodo,
                tasaBase: valor,
                observacion: observacion || undefined,
                ...(permitirInicioDeCadena && { permitirInicioDeCadena }),
                ...(permitirPisarMigrado && { permitirPisarMigrado }),
            })
            notify.success(
                `Índice de ${nombrePeriodo(periodo)} generado: ${r.diasGenerados} días` +
                (r.periodosRegenerados.length ? ` · ${r.periodosRegenerados.length} mes(es) posterior(es) regenerado(s)` : ''),
            )
            setDialogAbierto(false)
            setTasaBase('')
            setObservacion('')
            cargar(empresaId)
        } catch (e) {
            notify.error(e as Error)
        } finally {
            setGuardando(false)
        }
    }

    const recalcular = async () => {
        if (typeof empresaId !== 'number') return
        const previo = await moraApi.recalcular({ empresaId, dryRun: true }).catch((e) => {
            notify.error(e as Error)
            return null
        })
        if (!previo) return

        const ok = await confirm({
            title: 'Recalcular el recargo de toda la cartera',
            description:
                `Se van a revaluar ${previo.deudoresEvaluados.toLocaleString('es-AR')} casos a la fecha de hoy.` +
                (previo.facturasSinIndice
                    ? ` Atención: ${previo.facturasSinIndice.toLocaleString('es-AR')} factura(s) no tienen índice para su vencimiento y van a quedar sin recargo.`
                    : ''),
        })
        if (!ok) return

        setRecalculando(true)
        try {
            const r = await moraApi.recalcular({ empresaId })
            notify.success(
                `${r.deudoresActualizados.toLocaleString('es-AR')} casos actualizados en ${(r.durationMs / 1000).toFixed(1)}s`,
            )
        } catch (e) {
            notify.error(e as Error)
        } finally {
            setRecalculando(false)
        }
    }

    return (
        <Box>
            <PageHeader
                title="Recargo por mora"
                subtitle="Tasa mensual del régimen de recargos e índice diario"
            />

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} mb={2} alignItems={{ sm: 'center' }}>
                <TextField
                    select
                    label="Empresa"
                    size="small"
                    value={empresaId}
                    onChange={(e) => setEmpresaId(Number(e.target.value))}
                    sx={{ minWidth: 260 }}
                >
                    {empresas.map((e) => (
                        <MenuItem key={e.id} value={e.id}>{e.nombre}</MenuItem>
                    ))}
                </TextField>
                <Box flexGrow={1} />
                {puedeRecalcular && (
                    <Button
                        variant="outlined"
                        startIcon={<CalculateIcon />}
                        onClick={recalcular}
                        disabled={recalculando || typeof empresaId !== 'number'}
                    >
                        {recalculando ? 'Recalculando…' : 'Recalcular cartera'}
                    </Button>
                )}
                {puedeGestionar && (
                    <Button
                        variant="contained"
                        startIcon={<AddIcon />}
                        onClick={() => { setPeriodo(periodoActual()); setDialogAbierto(true) }}
                        disabled={typeof empresaId !== 'number'}
                    >
                        Cargar tasa del mes
                    </Button>
                )}
            </Stack>

            {faltantes.length > 0 && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                    <strong>Falta el índice de {faltantes.length} mes(es):</strong>{' '}
                    {faltantes.slice(0, 12).map(nombrePeriodo).join(', ')}
                    {faltantes.length > 12 && ` y ${faltantes.length - 12} más`}.
                    {/*
                      Decía "cualquier deuda cuyo período de mora cruce esos meses se valúa mal", que
                      no es cierto: el cálculo mira el índice del **vencimiento** y el del día de
                      corte, no el tramo intermedio.
                    */}
                    {' '}Toda factura que venza en esos meses queda sin recargo.
                </Alert>
            )}

            <Paper variant="outlined">
                <TableContainer sx={{ overflowX: 'auto' }}>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Período</TableCell>
                                <TableCell align="right">Tasa informada</TableCell>
                                <TableCell align="right">Tipo 2 (×{multTipo(2)})</TableCell>
                                <TableCell align="right">Tipo 3 (×{multTipo(3)})</TableCell>
                                <TableCell>Fuente</TableCell>
                                <TableCell align="right">Días de índice</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {!cargando && tasas.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={6}>
                                        <Typography variant="body2" color="text.secondary" py={2}>
                                            Esta empresa no tiene tasas cargadas todavía.
                                        </Typography>
                                    </TableCell>
                                </TableRow>
                            )}
                            {tasas.map((t) => (
                                <TableRow key={t.periodo} hover>
                                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{nombrePeriodo(t.periodo)}</TableCell>
                                    <TableCell align="right">
                                        {t.tasaBase != null ? `${t.tasaBase.toLocaleString('es-AR', { minimumFractionDigits: 3 })} %` : '—'}
                                    </TableCell>
                                    <TableCell align="right" sx={{ color: 'text.secondary' }}>
                                        {t.tasaBase != null ? `${(t.tasaBase * multTipo(2)).toLocaleString('es-AR', { minimumFractionDigits: 4 })} %` : '—'}
                                    </TableCell>
                                    <TableCell align="right" sx={{ color: 'text.secondary' }}>
                                        {t.tasaBase != null ? `${(t.tasaBase * multTipo(3)).toLocaleString('es-AR', { minimumFractionDigits: 3 })} %` : '—'}
                                    </TableCell>
                                    <TableCell>
                                        <FuenteChip fuente={t.fuente} />
                                    </TableCell>
                                    <TableCell align="right">
                                        {t.completo ? (
                                            t.diasIndice
                                        ) : (
                                            <Tooltip title="El índice de este mes está incompleto: hay días sin generar">
                                                <Chip label={`${t.diasIndice} incompleto`} size="small" color="warning" />
                                            </Tooltip>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            </Paper>

            <Dialog open={dialogAbierto} onClose={() => setDialogAbierto(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Cargar la tasa del mes</DialogTitle>
                <DialogContent>
                    <Alert severity="info" sx={{ mb: 2 }}>
                        Cargá la tasa <strong>tal cual la informa el cedente</strong>: <code>2.169</code> para
                        2,169% mensual. Sin dividir por 100 y sin multiplicar por nada — los tres tipos los
                        deriva el sistema.
                    </Alert>
                    <Stack spacing={2} mt={1}>
                        <TextField
                            label="Período"
                            type="month"
                            value={periodo}
                            onChange={(e) => setPeriodo(e.target.value)}
                            InputLabelProps={{ shrink: true }}
                            fullWidth
                        />
                        <TextField
                            label="Tasa mensual"
                            value={tasaBase}
                            onChange={(e) => setTasaBase(e.target.value)}
                            placeholder="2.169"
                            InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }}
                            fullWidth
                            autoFocus
                        />
                        <TextField
                            label="Observación (opcional)"
                            value={observacion}
                            onChange={(e) => setObservacion(e.target.value)}
                            placeholder="Mail del cedente del 01/09"
                            fullWidth
                        />
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDialogAbierto(false)}>Cancelar</Button>
                    <Button variant="contained" onClick={guardar} disabled={guardando}>
                        {guardando ? 'Generando…' : 'Generar índice'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    )
}

const FuenteChip: React.FC<{ fuente: string | null }> = ({ fuente }) => {
    if (!fuente) return <Chip label="sin tasa" size="small" variant="outlined" />
    const mapa: Record<string, { label: string; color: 'success' | 'default' | 'info'; tip: string }> = {
        MAIL_AYSA: { label: 'mail del cedente', color: 'success', tip: 'La fuente de verdad' },
        MIGRACION_UD60: { label: 'migrada del CRM viejo', color: 'default', tip: 'Puede tener tipeos del operador' },
        CALIBRADA: { label: 'calibrada', color: 'info', tip: 'Corregida contra un estado de deuda de la oficina virtual' },
    }
    const m = mapa[fuente] ?? { label: fuente, color: 'default' as const, tip: '' }
    return (
        <Tooltip title={m.tip}>
            <Chip label={m.label} size="small" color={m.color} variant={m.color === 'default' ? 'outlined' : 'filled'} />
        </Tooltip>
    )
}

export default AjustesMora
