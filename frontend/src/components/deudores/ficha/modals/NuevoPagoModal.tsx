import React, { useEffect, useState } from 'react';
import {
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormHelperText,
    TextField,
    ToggleButton,
    ToggleButtonGroup,
    Typography,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import PaymentsIcon from '@mui/icons-material/Payments';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import api from '../../../../api/axios';
import { useNotify } from '../../../../hooks/useNotify';

type Modo = 'pago' | 'promesa';

interface Props {
    open: boolean;
    deudorId: number;
    saldoSugerido?: number;
    /** Máximo de días a futuro para la promesa (default de empresa: 7). */
    maxDiasPromesa?: number;
    puedePromesa?: boolean;
    onClose: () => void;
    onSaved: () => void;
}

const hoyISO = () => new Date().toISOString().split('T')[0];
const isoMasDias = (dias: number) => {
    const d = new Date();
    d.setDate(d.getDate() + dias);
    return d.toISOString().split('T')[0];
};

const NuevoPagoModal: React.FC<Props> = ({
    open,
    deudorId,
    saldoSugerido,
    maxDiasPromesa = 7,
    puedePromesa = true,
    onClose,
    onSaved,
}) => {
    const notify = useNotify();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));

    const [modo, setModo] = useState<Modo>('pago');
    const [pagoForm, setPagoForm] = useState({ fecha: hoyISO(), importe: '', observacion: '' });
    const [promesaForm, setPromesaForm] = useState({ fechaPromesa: '', monto: '', observacion: '' });
    const [saving, setSaving] = useState(false);

    // Reset al abrir
    useEffect(() => {
        if (open) {
            setModo('pago');
            setPagoForm({ fecha: hoyISO(), importe: '', observacion: '' });
            setPromesaForm({
                fechaPromesa: '',
                monto: saldoSugerido ? String(saldoSugerido) : '',
                observacion: '',
            });
        }
    }, [open, saldoSugerido]);

    const handleGuardar = async () => {
        setSaving(true);
        try {
            if (modo === 'pago') {
                await api.post('/pagos', {
                    deudorId,
                    fecha: pagoForm.fecha,
                    importe: parseFloat(pagoForm.importe),
                    observacion: pagoForm.observacion || undefined,
                });
                notify.success('Pago cargado correctamente');
            } else {
                await api.post('/promesas', {
                    deudorId,
                    fechaPromesa: promesaForm.fechaPromesa,
                    monto: promesaForm.monto ? parseFloat(promesaForm.monto) : undefined,
                    observacion: promesaForm.observacion || undefined,
                });
                notify.success('Promesa de pago registrada');
            }
            onSaved();
            onClose();
        } catch (err: any) {
            notify.error(err);
        } finally {
            setSaving(false);
        }
    };

    const pagoValido = !!pagoForm.fecha && !!pagoForm.importe && parseFloat(pagoForm.importe) > 0;
    const promesaValida = !!promesaForm.fechaPromesa;
    const puedeGuardar = modo === 'pago' ? pagoValido : promesaValida;

    return (
        <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth fullScreen={isMobile}>
            <DialogTitle>Cargar {modo === 'pago' ? 'pago' : 'promesa de pago'}</DialogTitle>
            <DialogContent>
                <Box display="flex" flexDirection="column" gap={2} mt={1}>
                    <ToggleButtonGroup
                        value={modo}
                        exclusive
                        fullWidth
                        size="small"
                        color="primary"
                        onChange={(_, val) => val && setModo(val)}
                    >
                        <ToggleButton value="pago">
                            <PaymentsIcon fontSize="small" sx={{ mr: 1 }} />
                            Pago real
                        </ToggleButton>
                        <ToggleButton value="promesa" disabled={!puedePromesa}>
                            <EventAvailableIcon fontSize="small" sx={{ mr: 1 }} />
                            Promesa
                        </ToggleButton>
                    </ToggleButtonGroup>

                    {modo === 'pago' ? (
                        <>
                            <TextField
                                label="Fecha de pago"
                                type="date"
                                size="small"
                                fullWidth
                                InputLabelProps={{ shrink: true }}
                                value={pagoForm.fecha}
                                onChange={(e) => setPagoForm((f) => ({ ...f, fecha: e.target.value }))}
                            />
                            <TextField
                                label="Importe pagado ($)"
                                type="number"
                                size="small"
                                fullWidth
                                value={pagoForm.importe}
                                onChange={(e) => setPagoForm((f) => ({ ...f, importe: e.target.value }))}
                            />
                            <TextField
                                label="Observación (opcional)"
                                size="small"
                                fullWidth
                                value={pagoForm.observacion}
                                onChange={(e) => setPagoForm((f) => ({ ...f, observacion: e.target.value }))}
                            />
                            <FormHelperText>
                                Al cargar el pago se recalcula el saldo y el código de situación del deudor.
                            </FormHelperText>
                        </>
                    ) : (
                        <>
                            <TextField
                                label="Fecha prometida"
                                type="date"
                                size="small"
                                fullWidth
                                InputLabelProps={{ shrink: true }}
                                inputProps={{ min: hoyISO(), max: isoMasDias(30) }}
                                value={promesaForm.fechaPromesa}
                                onChange={(e) => setPromesaForm((f) => ({ ...f, fechaPromesa: e.target.value }))}
                            />
                            <TextField
                                label="Monto prometido ($) — opcional"
                                type="number"
                                size="small"
                                fullWidth
                                value={promesaForm.monto}
                                onChange={(e) => setPromesaForm((f) => ({ ...f, monto: e.target.value }))}
                            />
                            <TextField
                                label="Observación (opcional)"
                                size="small"
                                fullWidth
                                value={promesaForm.observacion}
                                onChange={(e) => setPromesaForm((f) => ({ ...f, observacion: e.target.value }))}
                            />
                            <FormHelperText>
                                Máximo {maxDiasPromesa} días a futuro (configurable por empresa). Si el deudor no
                                tiene pagos, pasa a "Promesa de pago" (SIT-020).
                            </FormHelperText>
                            <Typography variant="caption" color="text.secondary">
                                No mueve el saldo. La promesa se cierra sola cuando entra el pago, o pasa a
                                "incumplida" si vence sin pagar.
                            </Typography>
                        </>
                    )}
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancelar</Button>
                <Button
                    variant="contained"
                    color={modo === 'pago' ? 'success' : 'primary'}
                    onClick={handleGuardar}
                    disabled={saving || !puedeGuardar}
                >
                    {saving ? 'Guardando...' : modo === 'pago' ? 'Cargar pago' : 'Registrar promesa'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default NuevoPagoModal;
