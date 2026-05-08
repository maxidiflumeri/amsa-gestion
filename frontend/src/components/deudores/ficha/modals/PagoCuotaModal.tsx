import React, { useEffect, useState } from 'react';
import {
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    TextField,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import api from '../../../../api/axios';
import { useNotify } from '../../../../hooks/useNotify';

interface Props {
    cuota: any | null;
    onClose: () => void;
    onSaved: () => void;
}

const PagoCuotaModal: React.FC<Props> = ({ cuota, onClose, onSaved }) => {
    const notify = useNotify();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));

    const [pagoForm, setPagoForm] = useState({
        fecha: new Date().toISOString().split('T')[0],
        importe: '',
        observacion: '',
    });
    const [saving, setSaving] = useState(false);

    // Reset cuando cambia la cuota
    useEffect(() => {
        if (cuota) {
            setPagoForm({
                fecha: new Date().toISOString().split('T')[0],
                importe: String(cuota.importe),
                observacion: '',
            });
        }
    }, [cuota]);

    const handleConfirmar = async () => {
        if (!cuota) return;
        setSaving(true);
        try {
            await api.put(`/convenios/cuotas/${cuota.id}/pagar`, {
                fecha: pagoForm.fecha,
                importe: parseFloat(pagoForm.importe),
                observacion: pagoForm.observacion || undefined,
            });
            notify.success('Cuota pagada y pago registrado');
            onSaved(); // dispara cargarConvenios + cargarInicial en el orquestador
            onClose();
        } catch (err: any) {
            notify.error(err);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={!!cuota} onClose={onClose} maxWidth="xs" fullWidth fullScreen={isMobile}>
            <DialogTitle>Registrar pago — Cuota {cuota?.nroCuota}</DialogTitle>
            <DialogContent>
                <Box display="flex" flexDirection="column" gap={2} mt={1}>
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
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancelar</Button>
                <Button
                    variant="contained"
                    color="success"
                    onClick={handleConfirmar}
                    disabled={saving || !pagoForm.fecha || !pagoForm.importe}
                >
                    {saving ? 'Registrando...' : 'Confirmar Pago'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default PagoCuotaModal;
