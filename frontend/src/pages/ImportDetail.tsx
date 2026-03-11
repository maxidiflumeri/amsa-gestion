import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    Box, Typography, Paper, Table, TableBody, TableCell, TableContainer,
    TableHead, TableRow, Button, LinearProgress, Alert, Divider, Chip
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import api from '../api/axios';

interface ImportError {
    id: number;
    rowNumber: number;
    errorMsg: string;
    rawRow: any;
    createdAt: string;
}

export default function ImportDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [remesa, setRemesa] = useState<any>(null);
    const [errors, setErrors] = useState<ImportError[]>([]);
    const [loading, setLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    useEffect(() => {
        const fetchDetails = async () => {
            if (!id) return;
            try {
                setLoading(true);
                // 1. Obtener status de la remesa
                const resStatus = await api.get(`/import/remesas/${id}`);
                setRemesa(resStatus.data);

                // 2. Obtener errores si los hay
                if (resStatus.data?.errFilas > 0) {
                    const resErrors = await api.get(`/import/errores/${id}?pageSize=100`);
                    setErrors(resErrors.data.data);
                }
            } catch (err: any) {
                setErrorMsg(err.response?.data?.message || err.message || 'Error al cargar detalles.');
            } finally {
                setLoading(false);
            }
        };

        fetchDetails();
    }, [id]);

    const getColorForStatus = (status?: string) => {
        switch (status) {
            case 'FINALIZADA': return 'success';
            case 'ERROR': return 'error';
            case 'PROCESANDO': return 'info';
            case 'VALIDANDO': return 'warning';
            default: return 'default';
        }
    };

    return (
        <Box sx={{ maxWidth: 1200, mx: 'auto', mt: 4, px: 2, pb: 6 }}>
            <Box display="flex" alignItems="center" gap={2} mb={3}>
                <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/historial-importaciones')}>
                    Volver
                </Button>
                <Typography variant="h4" fontWeight="bold">
                    Detalle de Importación #{id}
                </Typography>
            </Box>

            {errorMsg && <Alert severity="error" sx={{ mb: 3 }}>{errorMsg}</Alert>}
            {loading && <LinearProgress sx={{ mb: 2 }} />}

            {remesa && (
                <Paper variant="outlined" sx={{ p: 4, mb: 4 }}>
                    <Box display="flex" justifyContent="space-between" mb={2}>
                        <Typography variant="h6">Estado: <Chip size="small" color={getColorForStatus(remesa.estadoProceso) as any} label={remesa.estadoProceso} /></Typography>
                        <Typography variant="body1">Categoría: <b>{remesa.categoria}</b></Typography>
                    </Box>
                    <Divider sx={{ mb: 2 }} />
                    <Box display="flex" gap={4}>
                        <Box>
                            <Typography variant="body2" color="text.secondary">Total Filas</Typography>
                            <Typography variant="h5">{remesa.totalFilas ?? 0}</Typography>
                        </Box>
                        <Box>
                            <Typography variant="body2" color="success.main">Filas OK</Typography>
                            <Typography variant="h5" color="success.main">{remesa.okFilas ?? 0}</Typography>
                        </Box>
                        <Box>
                            <Typography variant="body2" color="error.main">Filas Error</Typography>
                            <Typography variant="h5" color="error.main">{remesa.errFilas ?? 0}</Typography>
                        </Box>
                    </Box>
                </Paper>
            )}

            {remesa?.errFilas > 0 && (
                <>
                    <Typography variant="h6" color="error.main" mb={2}>Errores de fila</Typography>
                    <TableContainer component={Paper} variant="outlined">
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell sx={{ fontWeight: 'bold' }}>Fila #</TableCell>
                                    <TableCell sx={{ fontWeight: 'bold' }}>Mensaje de Error</TableCell>
                                    <TableCell sx={{ fontWeight: 'bold' }}>Fila Orginal (JSON)</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {errors.map(err => (
                                    <TableRow key={err.id}>
                                        <TableCell>{err.rowNumber}</TableCell>
                                        <TableCell sx={{ color: 'error.main', maxWidth: 300, wordWrap: 'break-word' }}>
                                            {err.errorMsg}
                                        </TableCell>
                                        <TableCell sx={{ fontFamily: 'monospace', fontSize: '12px', color: 'text.secondary' }}>
                                            {JSON.stringify(err.rawRow)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </>
            )}
        </Box>
    );
}
