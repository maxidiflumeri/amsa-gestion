import React, { useState, useEffect } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Grid,
    TextField,
    Typography,
    Box,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
    CircularProgress,
    IconButton,
    InputAdornment,
    FormControl,
    InputLabel,
    Select,
    MenuItem
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import ClearIcon from '@mui/icons-material/Clear';
import api from '../../api/axios';

interface BuscadorAvanzadoModalProps {
    open: boolean;
    onClose: () => void;
    onSelectDeudor: (id: number) => void;
}

interface SearchParams {
    id: string;
    nombre: string;
    apellido: string;
    documento: string;
    empresa: string;
    nroCliente: string;
    email: string;
    telefono: string;
}

const initialParams: SearchParams = {
    id: '',
    nombre: '',
    apellido: '',
    documento: '',
    empresa: '',
    nroCliente: '',
    email: '',
    telefono: '',
};

const BuscadorAvanzadoModal: React.FC<BuscadorAvanzadoModalProps> = ({ open, onClose, onSelectDeudor }) => {
    const [params, setParams] = useState<SearchParams>(initialParams);
    const [resultados, setResultados] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [searched, setSearched] = useState(false);
    const [empresas, setEmpresas] = useState<any[]>([]);

    useEffect(() => {
        if (open && empresas.length === 0) {
            api.get('/deudores/empresas')
                .then(res => setEmpresas(res.data))
                .catch(err => console.error('Error cargando empresas:', err));
        }
    }, [open]);

    const handleChange = (e: any) => {
        setParams({ ...params, [e.target.name]: e.target.value });
    };

    const handleClear = () => {
        setParams(initialParams);
        setResultados([]);
        setSearched(false);
    };

    const handleSearch = async () => {
        // Prepare payload, drop empty strings
        const payload: any = {};
        if (params.id) payload.id = Number(params.id);
        if (params.nombre) payload.nombre = params.nombre;
        if (params.apellido) payload.apellido = params.apellido;
        if (params.documento) payload.documento = params.documento;
        if (params.empresa) payload.empresa = params.empresa;
        if (params.nroCliente) payload.nroCliente = params.nroCliente;
        if (params.email) payload.email = params.email;
        if (params.telefono) payload.telefono = params.telefono;

        // If payload is empty, do not search
        if (Object.keys(payload).length === 0) return;

        setLoading(true);
        setSearched(true);
        try {
            const res = await api.post('/deudores/advanced-search', payload);
            setResultados(res.data);
        } catch (error) {
            console.error('Error en búsqueda avanzada:', error);
            setResultados([]);
        } finally {
            setLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSearch();
        }
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle sx={{ backgroundColor: 'primary.main', color: 'primary.contrastText', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box display="flex" alignItems="center" gap={1}>
                    <SearchIcon />
                    Búsqueda Avanzada de Deudores
                </Box>
                <IconButton onClick={onClose} sx={{ color: 'white' }}>
                    <CloseIcon />
                </IconButton>
            </DialogTitle>
            
            <DialogContent dividers>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    Ingresá uno o más criterios para buscar simultáneamente en toda la base de datos.
                </Typography>
                <Grid container spacing={2} sx={{ mt: 1, mb: 3 }}>
                    <Grid item xs={12} sm={6} md={3}>
                        <TextField fullWidth size="small" label="ID Deudor" name="id" value={params.id} onChange={handleChange} onKeyDown={handleKeyDown} autoComplete="off" />
                    </Grid>
                    <Grid item xs={12} sm={6} md={3}>
                        <TextField fullWidth size="small" label="Documento" name="documento" value={params.documento} onChange={handleChange} onKeyDown={handleKeyDown} autoComplete="off" />
                    </Grid>
                    <Grid item xs={12} sm={6} md={3}>
                        <TextField fullWidth size="small" label="Nombre" name="nombre" value={params.nombre} onChange={handleChange} onKeyDown={handleKeyDown} autoComplete="off" />
                    </Grid>
                    <Grid item xs={12} sm={6} md={3}>
                        <TextField fullWidth size="small" label="Apellido" name="apellido" value={params.apellido} onChange={handleChange} onKeyDown={handleKeyDown} autoComplete="off" />
                    </Grid>
                    
                    <Grid item xs={12} sm={6} md={3}>
                        <TextField fullWidth size="small" label="Nº Cliente" name="nroCliente" value={params.nroCliente} onChange={handleChange} onKeyDown={handleKeyDown} autoComplete="off" />
                    </Grid>
                    <Grid item xs={12} sm={6} md={3}>
                        <FormControl fullWidth size="small">
                            <InputLabel id="empresa-search-label">Empresa</InputLabel>
                            <Select
                                labelId="empresa-search-label"
                                name="empresa"
                                value={params.empresa}
                                onChange={handleChange}
                                label="Empresa"
                            >
                                <MenuItem value=""><em>Todas</em></MenuItem>
                                {empresas.map((emp) => (
                                    <MenuItem key={emp.id} value={emp.nombre}>{emp.nombre}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6} md={3}>
                        <TextField fullWidth size="small" label="Teléfono" name="telefono" value={params.telefono} onChange={handleChange} onKeyDown={handleKeyDown} autoComplete="off" />
                    </Grid>
                    <Grid item xs={12} sm={6} md={3}>
                        <TextField fullWidth size="small" label="Email" name="email" value={params.email} onChange={handleChange} onKeyDown={handleKeyDown} autoComplete="off" />
                    </Grid>
                </Grid>

                {/* Zona de Resultados */}
                <Box>
                    {loading ? (
                        <Box display="flex" justifyContent="center" my={4}>
                            <CircularProgress />
                        </Box>
                    ) : searched ? (
                        resultados.length > 0 ? (
                            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 300 }}>
                                <Table stickyHeader size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>ID</TableCell>
                                            <TableCell>Documento</TableCell>
                                            <TableCell>Cliente</TableCell>
                                            <TableCell>Empresa</TableCell>
                                            <TableCell>Nº Cli.</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {resultados.map((row) => (
                                            <TableRow 
                                                key={row.id} 
                                                hover 
                                                onClick={() => {
                                                    onSelectDeudor(row.id);
                                                    onClose();
                                                }}
                                                sx={{ cursor: 'pointer', '&:last-child td, &:last-child th': { border: 0 } }}
                                            >
                                                <TableCell>{row.id}</TableCell>
                                                <TableCell>{row.documento}</TableCell>
                                                <TableCell>{row.nombre} {row.apellido}</TableCell>
                                                <TableCell>{row.empresa?.nombre}</TableCell>
                                                <TableCell>{row.camposAdicionales?.nro_cliente || '-'}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        ) : (
                            <Typography variant="body1" color="text.secondary" align="center" sx={{ py: 3 }}>
                                No se encontraron deudores con esos criterios.
                            </Typography>
                        )
                    ) : null}
                </Box>
            </DialogContent>
            <DialogActions sx={{ p: 2 }}>
                <Button onClick={handleClear} color="inherit" startIcon={<ClearIcon />}>
                    Limpiar
                </Button>
                <Box flexGrow={1} />
                <Button onClick={onClose} color="inherit">
                    Cancelar
                </Button>
                <Button 
                    onClick={handleSearch} 
                    variant="contained" 
                    color="primary" 
                    startIcon={<SearchIcon />}
                    disabled={loading || Object.values(params).every(v => v.trim() === '')}
                >
                    Buscar
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default BuscadorAvanzadoModal;
