import React, { useState, useEffect } from 'react'
import { 
    Box, 
    Button, 
    Typography,
    Paper,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    FormGroup,
    FormControlLabel,
    Checkbox,
    Grid,
    Divider,
    Alert,
    CircularProgress,
    Snackbar,
    Stack
} from '@mui/material'
import api from '../../api/axios'

interface Empresa {
    id: number;
    nombre: string;
}

interface Parametro {
    id: number;
    grupo: string;
    descripcion: string;
    empresas?: { empresaId: number }[];
}

const AjustesAsignaciones: React.FC = () => {
    const [empresas, setEmpresas] = useState<Empresa[]>([]);
    const [parametros, setParametros] = useState<Parametro[]>([]);
    const [selectedEmpresa, setSelectedEmpresa] = useState<number | ''>('');
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [assignedIds, setAssignedIds] = useState<number[]>([]);
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' });

    const fetchData = async () => {
        setLoading(true);
        try {
            const [resEmp, resPar] = await Promise.all([
                api.get('/empresas'),
                api.get('/parametros')
            ]);
            setEmpresas(resEmp.data);
            setParametros(resPar.data);
        } catch (error) {
            console.error('Error fetching data:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    useEffect(() => {
        if (selectedEmpresa) {
            // Filtrar los IDs de parámetros que ya tiene asignada esta empresa
            const alreadyAssigned = parametros
                .filter(p => p.empresas?.some(e => e.empresaId === selectedEmpresa))
                .map(p => p.id);
            setAssignedIds(alreadyAssigned);
        } else {
            setAssignedIds([]);
        }
    }, [selectedEmpresa, parametros]);

    const handleToggle = (paramId: number) => {
        setAssignedIds(prev => 
            prev.includes(paramId) 
                ? prev.filter(id => id !== paramId) 
                : [...prev, paramId]
        );
    };

    const handleSelectGroup = (grupo: string, select: boolean) => {
        const groupParamIds = parametros.filter(p => p.grupo === grupo).map(p => p.id);
        if (select) {
            setAssignedIds(prev => Array.from(new Set([...prev, ...groupParamIds])));
        } else {
            setAssignedIds(prev => prev.filter(id => !groupParamIds.includes(id)));
        }
    };

    const handleSave = async () => {
        if (!selectedEmpresa) return;
        setSaving(true);
        try {
            await api.post(`/empresas/${selectedEmpresa}/parametros`, { parametroIds: assignedIds });
            setSnackbar({ open: true, message: 'Asignaciones guardadas correctamente', severity: 'success' });
            fetchData();
        } catch (error) {
            console.error(error);
            setSnackbar({ open: true, message: 'Error al ahorrar asignaciones', severity: 'error' });
        } finally {
            setSaving(false);
        }
    };


    return (
        <Box sx={{ p: 3 }}>
            <Box sx={{ mb: 3 }}>
                <Typography variant="h4" gutterBottom sx={{ fontWeight: 'bold' }}>
                    Asignaciones
                </Typography>
                <Typography variant="body1" color="text.secondary">
                    Vincule parámetros y estados a empresas específicas.
                </Typography>
                <Divider sx={{ mt: 2 }} />
            </Box>

            {loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 5 }}>
                    <CircularProgress />
                </Box>
            ) : (
                <Grid container spacing={4}>
                    {/* Selector de Empresa */}
                    <Grid item xs={12} md={4}>
                        <Paper sx={{ p: 3, height: '100%', borderRadius: 2 }} variant="outlined">
                            <Typography variant="h6" gutterBottom color="primary">
                                1. Seleccione Empresa
                            </Typography>
                            <FormControl fullWidth sx={{ mt: 2 }}>
                                <InputLabel>Empresa</InputLabel>
                                <Select
                                    value={selectedEmpresa}
                                    label="Empresa"
                                    onChange={(e) => setSelectedEmpresa(e.target.value as number)}
                                >
                                    {empresas.map(e => (
                                        <MenuItem key={e.id} value={e.id}>{e.nombre}</MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            
                            <Box sx={{ mt: 4 }}>
                                <Button 
                                    variant="contained" 
                                    fullWidth 
                                    size="large"
                                    onClick={handleSave}
                                    disabled={!selectedEmpresa || saving}
                                    startIcon={saving ? <CircularProgress size={20} /> : null}
                                >
                                    {saving ? 'Guardando...' : 'Guardar Cambios'}
                                </Button>
                            </Box>
                        </Paper>
                    </Grid>

                    {/* Lista de Parámetros */}
                    <Grid item xs={12} md={8}>
                        {selectedEmpresa ? (
                            <Box>
                                <Alert severity="info" sx={{ mb: 2 }}>
                                    Seleccione los parámetros que desea habilitar para esta empresa.
                                </Alert>
                                
                                <Grid container spacing={2}>
                                    {Array.from(new Set(parametros.map(p => p.grupo))).map(grupo => (
                                        <Grid item xs={12} key={grupo}>
                                            <Paper sx={{ p: 2, borderRadius: 2 }} variant="outlined">
                                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                                    <Typography variant="subtitle1" sx={{ fontWeight: 'bold', color: 'text.secondary', textTransform: 'uppercase' }}>
                                                        {grupo}
                                                    </Typography>
                                                    <Stack direction="row" spacing={1}>
                                                        <Button size="small" onClick={() => handleSelectGroup(grupo, true)}>Todo</Button>
                                                        <Button size="small" color="inherit" onClick={() => handleSelectGroup(grupo, false)}>Nada</Button>
                                                    </Stack>
                                                </Box>
                                                <Divider sx={{ mb: 2 }} />
                                                <FormGroup sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
                                                    {parametros.filter(p => p.grupo === grupo).map(p => (
                                                        <FormControlLabel
                                                            key={p.id}
                                                            control={
                                                                <Checkbox 
                                                                    checked={assignedIds.includes(p.id)} 
                                                                    onChange={() => handleToggle(p.id)} 
                                                                />
                                                            }
                                                            label={p.descripcion}
                                                        />
                                                    ))}
                                                </FormGroup>
                                            </Paper>
                                        </Grid>
                                    ))}
                                </Grid>
                            </Box>
                        ) : (
                            <Paper sx={{ p: 5, textAlign: 'center', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }} variant="outlined">
                                <Typography color="text.secondary">
                                    Seleccione primero una empresa para gestionar sus parámetros.
                                </Typography>
                            </Paper>
                        )}
                    </Grid>
                </Grid>
            )}

            <Snackbar 
                open={snackbar.open} 
                autoHideDuration={4000} 
                onClose={() => setSnackbar({ ...snackbar, open: false })}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            >
                <Alert severity={snackbar.severity} variant="filled" sx={{ width: '100%' }}>
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
}

export default AjustesAsignaciones
