import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    Chip,
    FormControlLabel,
    Stack,
    Switch,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Tooltip,
    Typography,
} from '@mui/material';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import { multiclavesApi, ClaveDelCaso, ClavesDelCasoRespuesta } from '../../../api/multiclaves';
import { useNotify } from '../../../hooks/useNotify';
import { fechaDelCedente } from '../../../utils/fechas';
import { LoadingSkeleton } from '../../ui';

interface Props {
    deudorId: number;
    /** Sin `convenios.ver` el endpoint rechaza igual, pero ni siquiera vale la pena pedirlo — el
     * padre ya sabe si el usuario tiene el permiso (hallazgo de la auditoría, §11). */
    puedeVerClaves: boolean;
    puedeGenerarCupon: boolean;
    /** Cambia (se incrementa) cada vez que el padre quiere forzar un refetch — p. ej. después de
     * generar un cupón, para que la fila muestre "Cupón emitido" sin recargar toda la ficha. */
    reloadToken?: number;
    onGenerarCupon: (clave: ClaveDelCaso) => void;
    /** Le pasa al padre las claves VIGENTES (badge de la solapa y el toggle TOTAL/QUITA del diálogo). */
    onClavesCargadas?: (vigentes: ClaveDelCaso[]) => void;
    /** El backend cubre TODA la categoría CANCELADO (no solo SIT-050, a diferencia del `cuentaCancelada`
     * que arma la ficha) — se lo pasa al padre para que lo reuse en "Reimprimir cupón" de la lista de
     * convenios (hallazgo de la auditoría, §6). */
    onCuentaCanceladaReal?: (cancelada: boolean) => void;
}

const fmtMonto = (v: string) => Number(v).toLocaleString('es-AR', { minimumFractionDigits: 2 });

const ClavesPagoCard: React.FC<Props> = ({
    deudorId,
    puedeVerClaves,
    puedeGenerarCupon,
    reloadToken,
    onGenerarCupon,
    onClavesCargadas,
    onCuentaCanceladaReal,
}) => {
    const notify = useNotify();
    const [data, setData] = useState<ClavesDelCasoRespuesta | null>(null);
    const [loading, setLoading] = useState(puedeVerClaves);
    const [verReemplazadas, setVerReemplazadas] = useState(false);

    const cargar = useCallback(async () => {
        if (!puedeVerClaves) {
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const res = await multiclavesApi.clavesDelCaso(deudorId, true); // trae todo; se filtra en el render
            setData(res);
        } catch (err) {
            notify.error(err as Error);
        } finally {
            setLoading(false);
        }
    }, [deudorId, puedeVerClaves]);

    useEffect(() => {
        cargar();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cargar, reloadToken]);

    const vigentes = useMemo(() => data?.claves.filter((c) => c.estado === 'VIGENTE') ?? [], [data]);

    useEffect(() => {
        if (!data) return;
        onClavesCargadas?.(vigentes);
        onCuentaCanceladaReal?.(data.avisos.cuentaCancelada);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data]);

    const filas = verReemplazadas ? data?.claves ?? [] : vigentes;

    if (!puedeVerClaves) return null;
    if (loading) return <LoadingSkeleton variant="list" rows={2} />;

    // Sin claves para este trámite (ni siquiera reemplazadas): la mayoría de las carteras. No se
    // muestra nada — D6/§11.1.
    if (!data || data.claves.length === 0) return null;

    const cuentaCancelada = data.avisos.cuentaCancelada;
    const gestionarDesde = data.avisos.gestionarDesde;

    const motivoDeshabilitado = (clave: ClaveDelCaso): string | null => {
        if (cuentaCancelada) return 'La cuenta está cancelada: no se puede generar un cupón.';
        // Desde el caso viejo solo se puede volver a sacar el cupón de un convenio que ya tiene.
        if (gestionarDesde && !clave.convenioActivo?.esEsteCaso) {
            return gestionarDesde.motivo;
        }
        if (clave.vencida) return 'Esta clave está vencida: no se puede generar el cupón.';
        if (clave.estado === 'REEMPLAZADA' && !clave.convenioActivo) {
            return 'Esta clave fue reemplazada por una carga posterior y no tiene convenio: no se puede generar.';
        }
        if (!puedeGenerarCupon) return 'No tenés permiso para generar cupones de pago.';
        return null;
    };

    return (
        <Box sx={{ mb: 3 }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                <Typography variant="subtitle1" fontWeight="bold" display="flex" alignItems="center" gap={1}>
                    <ReceiptLongIcon fontSize="small" /> Claves de pago
                </Typography>
                {data.claves.some((c) => c.estado === 'REEMPLAZADA') && (
                    <FormControlLabel
                        control={<Switch size="small" checked={verReemplazadas} onChange={(e) => setVerReemplazadas(e.target.checked)} />}
                        label={<Typography variant="caption">Ver reemplazadas</Typography>}
                    />
                )}
            </Stack>

            <Stack spacing={1} sx={{ mb: 1.5 }}>
                {data.avisos.saldoDistinto && (
                    <Alert severity="warning" variant="outlined">
                        El saldo del caso ($ {fmtMonto(String(data.avisos.saldoDistinto.saldoCaso))}) difiere del saldo que informó Telecom
                        ($ {fmtMonto(data.avisos.saldoDistinto.saldoTramite)}).
                    </Alert>
                )}
                {gestionarDesde ? (
                    <Alert severity="info" variant="outlined">
                        {gestionarDesde.motivo} Acá quedan solo para consulta.
                    </Alert>
                ) : data.avisos.otrosCasosDelTramite.length > 0 && (
                    <Alert severity="warning" variant="outlined">
                        Este trámite también está en {data.avisos.otrosCasosDelTramite.length === 1 ? 'otro caso' : 'otros casos'}{' '}
                        ({data.avisos.otrosCasosDelTramite.map((c) => `remesa ${c.numeroRemesa}`).join(', ')}). Un pago hecho con una clave
                        va al caso que tiene el cupón emitido.
                    </Alert>
                )}
                {data.avisos.canceladoConQuita && (
                    <Alert severity="success" variant="outlined">
                        Cancelado con quita: pagó $ {fmtMonto(data.avisos.canceladoConQuita.pagado)} con la clave{' '}
                        {data.avisos.canceladoConQuita.nroConvenio} (quita $ {fmtMonto(data.avisos.canceladoConQuita.quita)}).
                    </Alert>
                )}
            </Stack>

            <TableContainer>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell sx={{ bgcolor: 'action.hover' }}>Tipo</TableCell>
                            <TableCell sx={{ bgcolor: 'action.hover' }}>Vencimiento</TableCell>
                            <TableCell align="right" sx={{ bgcolor: 'action.hover' }}>Importe</TableCell>
                            <TableCell sx={{ bgcolor: 'action.hover' }}>Clave de pago</TableCell>
                            <TableCell sx={{ bgcolor: 'action.hover' }}>Convenio Telecom</TableCell>
                            <TableCell sx={{ bgcolor: 'action.hover' }}>Estado</TableCell>
                            <TableCell sx={{ bgcolor: 'action.hover' }}></TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {filas.map((c) => {
                            const disabledMotivo = motivoDeshabilitado(c);
                            const esReemplazada = c.estado === 'REEMPLAZADA';
                            return (
                                <TableRow key={c.id} hover sx={esReemplazada ? { '& td': { color: 'text.disabled' } } : undefined}>
                                    <TableCell>
                                        <Chip
                                            size="small"
                                            label={c.tipo === 'TOTAL' ? 'Saldo total' : 'Con quita 50%'}
                                            color={c.tipo === 'TOTAL' ? 'default' : 'info'}
                                            variant="outlined"
                                        />
                                    </TableCell>
                                    <TableCell>
                                        {fechaDelCedente(c.fechaVencimiento)}
                                        {c.vencida && <Chip size="small" label="Vencida" color="error" sx={{ ml: 1 }} />}
                                        {esReemplazada && <Chip size="small" label="Reemplazada" sx={{ ml: 1 }} />}
                                    </TableCell>
                                    <TableCell align="right">$ {fmtMonto(c.importe)}</TableCell>
                                    <TableCell>
                                        {/* Nunca se muestran los 22 dígitos (D6): alcanzarían para armar un cupón
                                            cobrable por fuera del sistema, sin convenio. Solo los últimos 4. */}
                                        <Typography variant="body2" fontFamily="monospace" color="text.secondary">
                                            •••• {c.clavePagoUltimos4}
                                        </Typography>
                                    </TableCell>
                                    <TableCell>{c.nroConvenio}</TableCell>
                                    <TableCell>
                                        <Stack direction="row" spacing={0.5} flexWrap="wrap">
                                            {c.convenioActivo?.esEsteCaso ? (
                                                <Chip size="small" label="Cupón emitido" color="success" />
                                            ) : c.convenioActivo ? (
                                                <Chip size="small" label="Convenio en otro caso" color="warning" />
                                            ) : null}
                                            {c.pagos?.cubreLaClave && (
                                                <Tooltip title={`Pagó $ ${fmtMonto(c.pagos.pagado)} — ${fechaDelCedente(c.pagos.ultimaFecha)}`}>
                                                    <Chip size="small" label="Pagada" color="success" variant="outlined" />
                                                </Tooltip>
                                            )}
                                            {!c.convenioActivo && !c.pagos?.cubreLaClave && '—'}
                                        </Stack>
                                    </TableCell>
                                    <TableCell>
                                        <Tooltip title={disabledMotivo ?? ''} disableHoverListener={!disabledMotivo}>
                                            <span>
                                                <Button
                                                    size="small"
                                                    variant="outlined"
                                                    disabled={!!disabledMotivo}
                                                    onClick={() => onGenerarCupon(c)}
                                                >
                                                    Generar cupón
                                                </Button>
                                            </span>
                                        </Tooltip>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </TableContainer>
        </Box>
    );
};

export default React.memo(ClavesPagoCard);
