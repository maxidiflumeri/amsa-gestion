import React, { useCallback, useEffect, useState } from 'react';
import {
    Box,
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    LinearProgress,
    Snackbar,
    Alert,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableRow,
    Typography,
    useTheme,
} from '@mui/material';
import MergeIcon from '@mui/icons-material/Merge';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { consolidacionApi, ConsolidacionResult, ConsolidacionScopeDto } from '../../api/consolidacion';
import { useSocket } from '../../context/SocketContext';
import { useNotify } from '../../hooks/useNotify';

interface Props {
    open: boolean;
    scope: ConsolidacionScopeDto;
    onClose: () => void;
}

type Paso = 'idle' | 'preview-cargando' | 'preview-listo' | 'aplicando' | 'finalizado';

interface ProgresoPayload {
    jobId: string;
    progreso: number;
    evaluados: number;
}

interface FinalizadaPayload {
    jobId: string;
    result: ConsolidacionResult | null;
    dryRun?: boolean;
    error?: string;
}

const fmt = (n: number) => n.toLocaleString('es-AR');

const ConsolidacionModal: React.FC<Props> = ({ open, scope, onClose }) => {
    const theme = useTheme();
    const notify = useNotify();
    const { socket } = useSocket();

    const [paso, setPaso] = useState<Paso>('idle');
    const [jobId, setJobId] = useState<string | null>(null);
    const [progreso, setProgreso] = useState(0);
    const [resultado, setResultado] = useState<ConsolidacionResult | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [enCursoSnack, setEnCursoSnack] = useState(false);
    const [botonDeshabilitado, setBotonDeshabilitado] = useState(false);

    // Resetear al cerrar/abrir
    useEffect(() => {
        if (!open) {
            setPaso('idle');
            setJobId(null);
            setProgreso(0);
            setResultado(null);
            setErrorMsg(null);
            setBotonDeshabilitado(false);
        }
    }, [open]);

    // Suscripción a eventos socket
    useEffect(() => {
        if (!socket || !jobId) return;

        const onProgreso = (p: ProgresoPayload) => {
            if (p.jobId !== jobId) return;
            setProgreso(p.progreso ?? 0);
        };

        const onFinalizada = (p: FinalizadaPayload) => {
            if (p.jobId !== jobId) return;
            if (p.error) {
                setErrorMsg(p.error);
                setPaso('idle');
                setBotonDeshabilitado(false);
                return;
            }
            if (p.result) {
                setResultado(p.result);
            }
            if (paso === 'preview-cargando') {
                setPaso('preview-listo');
            } else if (paso === 'aplicando') {
                setPaso('finalizado');
                notify.success('Consolidación aplicada correctamente');
            }
        };

        socket.on('consolidacion:progreso', onProgreso);
        socket.on('consolidacion:finalizada', onFinalizada);

        return () => {
            socket.off('consolidacion:progreso', onProgreso);
            socket.off('consolidacion:finalizada', onFinalizada);
        };
    }, [socket, jobId, paso, notify]);

    const handlePreview = useCallback(async () => {
        setErrorMsg(null);
        setProgreso(0);
        setPaso('preview-cargando');
        try {
            const resp = await consolidacionApi.preview(scope);
            setJobId(String(resp.jobId));
        } catch (err: any) {
            if (err?.response?.status === 409) {
                setEnCursoSnack(true);
                setBotonDeshabilitado(true);
                setPaso('idle');
                return;
            }
            setErrorMsg(err?.response?.data?.message ?? 'Error al iniciar el preview');
            setPaso('idle');
        }
    }, [scope]);

    const handleAplicar = useCallback(async () => {
        setErrorMsg(null);
        setProgreso(0);
        setPaso('aplicando');
        setJobId(null);
        try {
            const resp = await consolidacionApi.aplicar(scope);
            setJobId(String(resp.jobId));
        } catch (err: any) {
            if (err?.response?.status === 409) {
                setEnCursoSnack(true);
                setBotonDeshabilitado(true);
                setPaso('preview-listo');
                return;
            }
            setErrorMsg(err?.response?.data?.message ?? 'Error al iniciar la consolidación');
            setPaso('preview-listo');
        }
    }, [scope]);

    const scopeLabel =
        'tipo' in scope && scope.tipo === 'REMESA'
            ? `Remesa #${(scope as { tipo: 'REMESA'; remesaId: number }).remesaId}`
            : 'tipo' in scope && scope.tipo === 'EMPRESA'
              ? `Empresa #${(scope as { tipo: 'EMPRESA'; empresaId: number }).empresaId}`
              : 'Todas las empresas';

    const mostrarProgreso = paso === 'preview-cargando' || paso === 'aplicando';
    const mostrarTabla = (paso === 'preview-listo' || paso === 'finalizado') && resultado != null;

    return (
        <>
            <Dialog
                open={open}
                onClose={paso === 'idle' || paso === 'preview-listo' || paso === 'finalizado' ? onClose : undefined}
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <MergeIcon color="primary" />
                    Consolidar situacion — {scopeLabel}
                </DialogTitle>

                <DialogContent>
                    {errorMsg && (
                        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErrorMsg(null)}>
                            {errorMsg}
                        </Alert>
                    )}

                    {paso === 'idle' && (
                        <Typography variant="body2" color="text.secondary">
                            Esta operacion recalcula el <strong>saldo</strong> y el{' '}
                            <strong>codigo de situacion</strong> de cada deudor de la seleccion segun los
                            pagos cargados. Primero se ejecuta un <strong>preview</strong> para revisar los
                            cambios antes de aplicarlos.
                        </Typography>
                    )}

                    {mostrarProgreso && (
                        <Box sx={{ mt: 1 }}>
                            <Typography variant="body2" color="text.secondary" gutterBottom>
                                {paso === 'preview-cargando'
                                    ? 'Calculando preview...'
                                    : 'Aplicando consolidacion...'}
                            </Typography>
                            <LinearProgress
                                variant={progreso > 0 ? 'determinate' : 'indeterminate'}
                                value={progreso}
                                sx={{ borderRadius: 1, height: 8 }}
                            />
                            {progreso > 0 && (
                                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                                    {progreso}%
                                </Typography>
                            )}
                        </Box>
                    )}

                    {mostrarTabla && (
                        <Box>
                            <Typography
                                variant="subtitle2"
                                fontWeight="bold"
                                sx={{ mb: 1, color: theme.palette.text.primary }}
                            >
                                {paso === 'finalizado' ? 'Resultado aplicado' : 'Resultado del preview'}
                            </Typography>
                            <TableContainer
                                sx={{
                                    border: `1px solid ${theme.palette.divider}`,
                                    borderRadius: 1,
                                }}
                            >
                                <Table size="small">
                                    <TableBody>
                                        <TableRow hover>
                                            <TableCell sx={{ color: theme.palette.text.secondary }}>
                                                Deudores evaluados
                                            </TableCell>
                                            <TableCell align="right" sx={{ fontWeight: 600 }}>
                                                {fmt(resultado.evaluados)}
                                            </TableCell>
                                        </TableRow>
                                        <TableRow hover>
                                            <TableCell sx={{ color: theme.palette.text.secondary }}>
                                                Con pagos
                                            </TableCell>
                                            <TableCell align="right" sx={{ fontWeight: 600 }}>
                                                {fmt(resultado.conPagos)}
                                            </TableCell>
                                        </TableRow>
                                        <TableRow hover>
                                            <TableCell sx={{ color: theme.palette.success.main }}>
                                                {paso === 'finalizado' ? 'Pasaron' : 'Pasaran'} a SIT-050 (Cancelado)
                                            </TableCell>
                                            <TableCell
                                                align="right"
                                                sx={{ fontWeight: 700, color: theme.palette.success.main }}
                                            >
                                                {fmt(resultado.aSIT050)}
                                            </TableCell>
                                        </TableRow>
                                        <TableRow hover>
                                            <TableCell sx={{ color: theme.palette.warning.main }}>
                                                {paso === 'finalizado' ? 'Pasaron' : 'Pasaran'} a SIT-041 (Pago parcial)
                                            </TableCell>
                                            <TableCell
                                                align="right"
                                                sx={{ fontWeight: 700, color: theme.palette.warning.main }}
                                            >
                                                {fmt(resultado.aSIT041)}
                                            </TableCell>
                                        </TableRow>
                                        <TableRow>
                                            <TableCell sx={{ color: theme.palette.text.secondary }}>
                                                Sin cambios
                                            </TableCell>
                                            <TableCell align="right" sx={{ fontWeight: 600 }}>
                                                {fmt(resultado.sinCambios)}
                                            </TableCell>
                                        </TableRow>
                                        <TableRow>
                                            <TableCell sx={{ color: theme.palette.text.secondary }}>
                                                Tiempo
                                            </TableCell>
                                            <TableCell align="right">
                                                {(resultado.durationMs / 1000).toFixed(1)}s
                                            </TableCell>
                                        </TableRow>
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        </Box>
                    )}

                    {paso === 'finalizado' && (
                        <Box
                            sx={{
                                mt: 2,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 1,
                                color: theme.palette.success.main,
                            }}
                        >
                            <CheckCircleOutlineIcon />
                            <Typography variant="body2" fontWeight={600}>
                                Consolidacion completada correctamente.
                            </Typography>
                        </Box>
                    )}
                </DialogContent>

                <DialogActions>
                    <Button
                        onClick={onClose}
                        disabled={mostrarProgreso}
                        color="inherit"
                    >
                        {paso === 'finalizado' ? 'Cerrar' : 'Cancelar'}
                    </Button>

                    {paso === 'idle' && (
                        <Button
                            variant="contained"
                            onClick={handlePreview}
                            disabled={botonDeshabilitado}
                            startIcon={<MergeIcon />}
                        >
                            Calcular preview
                        </Button>
                    )}

                    {paso === 'preview-cargando' && (
                        <Button variant="contained" disabled startIcon={<CircularProgress size={16} />}>
                            Calculando...
                        </Button>
                    )}

                    {paso === 'preview-listo' && (
                        <Button
                            variant="contained"
                            color="warning"
                            onClick={handleAplicar}
                            disabled={botonDeshabilitado}
                            startIcon={<MergeIcon />}
                        >
                            Aplicar consolidacion
                        </Button>
                    )}

                    {paso === 'aplicando' && (
                        <Button variant="contained" disabled startIcon={<CircularProgress size={16} />}>
                            Aplicando...
                        </Button>
                    )}
                </DialogActions>
            </Dialog>

            <Snackbar
                open={enCursoSnack}
                autoHideDuration={6000}
                onClose={() => setEnCursoSnack(false)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert severity="warning" onClose={() => setEnCursoSnack(false)}>
                    Ya hay una consolidacion en curso. Esperá a que termine.
                </Alert>
            </Snackbar>
        </>
    );
};

export default ConsolidacionModal;
