import React, { useEffect, useState } from 'react';
import {
    Box, Typography, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    Chip, Button, LinearProgress, Alert, Tooltip, IconButton, FormControl, InputLabel, Select, MenuItem
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import api from '../api/axios';
import { useEmpresas } from '../hooks/useEmpresas';

interface Remesa {
    id: number;
    nombre: string;
    numeroRemesa: string;
    categoria: string;
    archivoOriginal: string;
    estadoProceso: string;
    totalFilas: number;
    okFilas: number;
    errFilas: number;
    createdAt: string;
}

export default function ImportHistory() {
    const { empresas, loading: loadingEmpresas } = useEmpresas();
    const [empresaId, setEmpresaId] = useState<number | "">(1); 
    const [remesas, setRemesas] = useState<Remesa[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadHistory = async () => {
        try {
            setLoading(true);
            const { data } = await api.get(`/import/remesas/empresa/${empresaId}`);
            setRemesas(data);
            setError(null);
        } catch (err: any) {
            setError(err.response?.data?.message || err.message || 'Error cargando historial');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (empresaId) {
            loadHistory();
        }
    }, [empresaId]);

    const getColorForStatus = (status: string) => {
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
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                <Typography variant="h4" fontWeight="bold">Historial de Importaciones</Typography>
                <Box display="flex" gap={2} alignItems="center">
                    <FormControl size="small" sx={{ minWidth: 200 }}>
                        <InputLabel>Empresa</InputLabel>
                        <Select
                            value={empresaId}
                            label="Empresa"
                            onChange={(e) => setEmpresaId(e.target.value as number)}
                            disabled={loadingEmpresas}
                        >
                            {empresas.map((emp) => (
                                <MenuItem key={emp.id} value={emp.id}>
                                    {emp.nombre}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <Button variant="outlined" onClick={loadHistory} disabled={loading || !empresaId}>
                        Actualizar
                    </Button>
                </Box>
            </Box>

            {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}
            {loading && <LinearProgress sx={{ mb: 2 }} />}

            <TableContainer component={Paper} variant="outlined">
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>ID</TableCell>
                            <TableCell>Nombre / Archivo</TableCell>
                            <TableCell>Categoría</TableCell>
                            <TableCell>Estado</TableCell>
                            <TableCell align="right">Total / OK / Err</TableCell>
                            <TableCell align="right">Fecha</TableCell>
                            <TableCell align="center">Acciones</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {!loading && remesas.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={7} align="center" sx={{ py: 3 }}>
                                    <Typography color="text.secondary">No hay importaciones registradas.</Typography>
                                </TableCell>
                            </TableRow>
                        )}
                        {remesas.map(r => (
                            <TableRow key={r.id}>
                                <TableCell>{r.id}</TableCell>
                                <TableCell>
                                    <Typography variant="body2" fontWeight={500}>{r.nombre}</Typography>
                                    <Box display="flex" gap={1} alignItems="center">
                                        <Typography variant="caption" color="primary" fontWeight="bold">
                                            #{r.numeroRemesa}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {r.archivoOriginal?.split(/(_|\\|\/)/).pop() || 'Archivo desconocido'}
                                        </Typography>
                                    </Box>
                                </TableCell>
                                <TableCell><Chip size="small" label={r.categoria} /></TableCell>
                                <TableCell>
                                    <Chip size="small" color={getColorForStatus(r.estadoProceso) as any} label={r.estadoProceso} />
                                </TableCell>
                                <TableCell align="right">
                                    {r.estadoProceso === 'FINALIZADA' ? (
                                        <Typography variant="body2">
                                            {r.totalFilas} / <Typography component="span" color="success.main" variant="body2">{r.okFilas}</Typography> / <Typography component="span" color="error.main" variant="body2">{r.errFilas}</Typography>
                                        </Typography>
                                    ) : (
                                        <Typography variant="body2" color="text.secondary">-</Typography>
                                    )}
                                </TableCell>
                                <TableCell align="right">
                                    <Typography variant="body2">{new Date(r.createdAt).toLocaleDateString()}</Typography>
                                    <Typography variant="caption" color="text.secondary">{new Date(r.createdAt).toLocaleTimeString()}</Typography>
                                </TableCell>
                                <TableCell align="center">
                                    <Tooltip title={r.errFilas > 0 ? "Ver Detalles y Errores" : "Ver Progreso/Detalles"}>
                                        <IconButton
                                            color="primary"
                                            onClick={() => window.location.href = `/historial-importaciones/${r.id}`}
                                        >
                                            <VisibilityIcon />
                                        </IconButton>
                                    </Tooltip>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
        </Box>
    );
}
