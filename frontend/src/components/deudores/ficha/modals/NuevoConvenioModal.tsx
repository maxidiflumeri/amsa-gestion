import React, { useEffect, useState } from 'react';
import {
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Grid,
    MenuItem,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TextField,
    Typography,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import api from '../../../../api/axios';
import { useNotify } from '../../../../hooks/useNotify';

interface Props {
    open: boolean;
    deudorId: number;
    montoSugerido: number;
    onClose: () => void;
    onSaved: () => void;
}

const NuevoConvenioModal: React.FC<Props> = ({ open, deudorId, montoSugerido, onClose, onSaved }) => {
    const notify = useNotify();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));

    const [convenioTipo, setConvenioTipo] = useState<'AUTOMATICO' | 'LIBRE'>('AUTOMATICO');
    const [convenioForm, setConvenioForm] = useState({
        montoTotal: '',
        cantCuotas: '',
        fechaInicio: '',
        observaciones: '',
    });
    const [cuotasLibres, setCuotasLibres] = useState<
        { nroCuota: number; fechaVencimiento: string; importe: string }[]
    >([]);
    const [saving, setSaving] = useState(false);

    // Reset al abrir
    useEffect(() => {
        if (open) {
            setConvenioTipo('AUTOMATICO');
            setConvenioForm({
                montoTotal: String(montoSugerido || ''),
                cantCuotas: '',
                fechaInicio: '',
                observaciones: '',
            });
            setCuotasLibres([]);
        }
    }, [open, montoSugerido]);

    const calcCuotasAutomatico = () => {
        const monto = parseFloat(convenioForm.montoTotal) || 0;
        const cant = parseInt(convenioForm.cantCuotas) || 0;
        if (!monto || !cant || !convenioForm.fechaInicio) return [];
        const cuotaImporte = monto / cant;
        return Array.from({ length: cant }, (_, i) => {
            const fecha = new Date(convenioForm.fechaInicio);
            fecha.setDate(fecha.getDate() + 30 * i);
            return {
                nroCuota: i + 1,
                fechaVencimiento: fecha.toLocaleDateString('es-AR'),
                importe: cuotaImporte,
            };
        });
    };

    const handleCantCuotasChange = (val: string) => {
        const cant = parseInt(val) || 0;
        setConvenioForm((f) => ({ ...f, cantCuotas: val }));
        if (convenioTipo === 'LIBRE' && cant > 0) {
            setCuotasLibres(
                Array.from({ length: cant }, (_, i) => ({
                    nroCuota: i + 1,
                    fechaVencimiento: '',
                    importe: '',
                })),
            );
        }
    };

    const handleGuardar = async () => {
        setSaving(true);
        try {
            const payload: any = {
                deudorId,
                tipo: convenioTipo,
                montoTotal: parseFloat(convenioForm.montoTotal),
                cantCuotas: parseInt(convenioForm.cantCuotas),
                fechaInicio: convenioForm.fechaInicio,
                observaciones: convenioForm.observaciones || undefined,
            };
            if (convenioTipo === 'LIBRE') {
                payload.cuotas = cuotasLibres.map((c) => ({
                    nroCuota: c.nroCuota,
                    fechaVencimiento: c.fechaVencimiento,
                    importe: parseFloat(c.importe),
                }));
            }
            await api.post('/convenios', payload);
            notify.success('Convenio creado correctamente');
            onSaved();
            onClose();
        } catch (err: any) {
            notify.error(err);
        } finally {
            setSaving(false);
        }
    };

    const isGuardarDisabled =
        saving ||
        !convenioForm.montoTotal ||
        !convenioForm.cantCuotas ||
        !convenioForm.fechaInicio ||
        (convenioTipo === 'LIBRE' &&
            (cuotasLibres.length === 0 || cuotasLibres.some((c) => !c.fechaVencimiento || !c.importe)));

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" fullScreen={isMobile}>
            <DialogTitle>Nuevo Convenio</DialogTitle>
            <DialogContent>
                <Grid container spacing={2} sx={{ mt: 0.5 }}>
                    <Grid item xs={12} sm={6}>
                        <TextField
                            select
                            fullWidth
                            label="Tipo de convenio"
                            size="small"
                            value={convenioTipo}
                            onChange={(e) => {
                                setConvenioTipo(e.target.value as 'AUTOMATICO' | 'LIBRE');
                                setCuotasLibres([]);
                            }}
                        >
                            <MenuItem value="AUTOMATICO">Automático</MenuItem>
                            <MenuItem value="LIBRE">Libre</MenuItem>
                        </TextField>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth
                            label="Monto total ($)"
                            size="small"
                            type="number"
                            value={convenioForm.montoTotal}
                            onChange={(e) => setConvenioForm((f) => ({ ...f, montoTotal: e.target.value }))}
                        />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth
                            label="Cantidad de cuotas"
                            size="small"
                            type="number"
                            value={convenioForm.cantCuotas}
                            onChange={(e) => handleCantCuotasChange(e.target.value)}
                        />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth
                            label="Fecha primer vencimiento"
                            size="small"
                            type="date"
                            InputLabelProps={{ shrink: true }}
                            value={convenioForm.fechaInicio}
                            onChange={(e) => setConvenioForm((f) => ({ ...f, fechaInicio: e.target.value }))}
                        />
                    </Grid>
                    <Grid item xs={12}>
                        <TextField
                            fullWidth
                            label="Observaciones"
                            size="small"
                            multiline
                            rows={2}
                            value={convenioForm.observaciones}
                            onChange={(e) => setConvenioForm((f) => ({ ...f, observaciones: e.target.value }))}
                        />
                    </Grid>
                </Grid>

                {/* Preview automático */}
                {convenioTipo === 'AUTOMATICO' &&
                    convenioForm.montoTotal &&
                    convenioForm.cantCuotas &&
                    convenioForm.fechaInicio && (
                        <Box mt={2}>
                            <Typography variant="subtitle2" fontWeight="bold" mb={1}>
                                Preview de cuotas:
                            </Typography>
                            <TableContainer sx={{ maxHeight: 200 }}>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell sx={{ bgcolor: 'action.hover' }}>#</TableCell>
                                            <TableCell sx={{ bgcolor: 'action.hover' }}>Vencimiento</TableCell>
                                            <TableCell align="right" sx={{ bgcolor: 'action.hover' }}>
                                                Importe
                                            </TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {calcCuotasAutomatico().map((c) => (
                                            <TableRow key={c.nroCuota}>
                                                <TableCell>{c.nroCuota}</TableCell>
                                                <TableCell>{c.fechaVencimiento}</TableCell>
                                                <TableCell align="right">
                                                    ${c.importe.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        </Box>
                    )}

                {/* Cuotas libres */}
                {convenioTipo === 'LIBRE' && cuotasLibres.length > 0 && (
                    <Box mt={2}>
                        <Typography variant="subtitle2" fontWeight="bold" mb={1}>
                            Cargá cada cuota:
                        </Typography>
                        <TableContainer sx={{ maxHeight: 250 }}>
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell sx={{ bgcolor: 'action.hover' }}>#</TableCell>
                                        <TableCell sx={{ bgcolor: 'action.hover' }}>Vencimiento</TableCell>
                                        <TableCell sx={{ bgcolor: 'action.hover' }}>Importe ($)</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {cuotasLibres.map((c, i) => (
                                        <TableRow key={c.nroCuota}>
                                            <TableCell>{c.nroCuota}</TableCell>
                                            <TableCell>
                                                <TextField
                                                    type="date"
                                                    size="small"
                                                    value={c.fechaVencimiento}
                                                    onChange={(e) =>
                                                        setCuotasLibres((prev) =>
                                                            prev.map((x, j) =>
                                                                j === i
                                                                    ? { ...x, fechaVencimiento: e.target.value }
                                                                    : x,
                                                            ),
                                                        )
                                                    }
                                                    InputLabelProps={{ shrink: true }}
                                                />
                                            </TableCell>
                                            <TableCell>
                                                <TextField
                                                    type="number"
                                                    size="small"
                                                    value={c.importe}
                                                    onChange={(e) =>
                                                        setCuotasLibres((prev) =>
                                                            prev.map((x, j) =>
                                                                j === i ? { ...x, importe: e.target.value } : x,
                                                            ),
                                                        )
                                                    }
                                                />
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    </Box>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancelar</Button>
                <Button variant="contained" onClick={handleGuardar} disabled={isGuardarDisabled}>
                    {saving ? 'Guardando...' : 'Guardar Convenio'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default NuevoConvenioModal;
