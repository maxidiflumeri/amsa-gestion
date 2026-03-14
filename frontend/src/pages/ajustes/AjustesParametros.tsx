import React, { useState, useEffect } from 'react'
import { 
    Box, 
    Button, 
    Table, 
    TableBody, 
    TableCell, 
    TableContainer, 
    TableHead, 
    TableRow, 
    IconButton, 
    TextField, 
    Dialog, 
    DialogTitle, 
    DialogContent, 
    DialogActions,
    Typography,
    Divider,
    Select,
    MenuItem,
    FormControl,
    InputLabel,
    Chip,
    Paper
} from '@mui/material'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import AddIcon from '@mui/icons-material/Add'
import api from '../../api/axios'

interface Parametro {
    id: number;
    grupo: string;
    clave: string;
    descripcion: string;
    padreId: number | null;
    parametroPadre?: Parametro;
}

const AjustesParametros: React.FC = () => {
    const [parametros, setParametros] = useState<Parametro[]>([]);
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<Parametro | null>(null);
    const [formData, setFormData] = useState({ 
        grupo: 'estadoGestion', 
        clave: '', 
        descripcion: '', 
        padreId: '' 
    });
    const [filterGrupo, setFilterGrupo] = useState('');

    const fetchParametros = async () => {
        try {
            const res = await api.get('/parametros');
            setParametros(res.data);
        } catch (error) {
            console.error('Error fetching parametros:', error);
        }
    };

    useEffect(() => {
        fetchParametros();
    }, []);

    const handleOpen = (p?: Parametro) => {
        if (p) {
            setEditing(p);
            setFormData({ 
                grupo: p.grupo, 
                clave: p.clave, 
                descripcion: p.descripcion, 
                padreId: p.padreId?.toString() || '' 
            });
        } else {
            setEditing(null);
            setFormData({ grupo: 'estadoGestion', clave: '', descripcion: '', padreId: '' });
        }
        setOpen(true);
    };

    const handleSave = async () => {
        const payload = {
            ...formData,
            padreId: formData.padreId ? parseInt(formData.padreId) : null
        };

        try {
            if (editing) {
                await api.patch(`/parametros/${editing.id}`, payload);
            } else {
                await api.post('/parametros', payload);
            }
            
            setOpen(false);
            fetchParametros();
        } catch (error) {
            console.error('Error saving parametro:', error);
        }
    };

    const handleDelete = async (id: number) => {
        if (window.confirm('¿Eliminar este parámetro?')) {
            try {
                await api.delete(`/parametros/${id}`);
                fetchParametros();
            } catch (error) {
                console.error('Error deleting parametro:', error);
            }
        }
    };

    return (
        <Box sx={{ p: 3 }}>
            <Box sx={{ mb: 3 }}>
                <Typography variant="h4" gutterBottom sx={{ fontWeight: 'bold' }}>
                    Parámetros / Códigos
                </Typography>
                <Typography variant="body1" color="text.secondary">
                    Administre estados de gestión, códigos de situación y agrupadores.
                </Typography>
                <Divider sx={{ mt: 2 }} />
            </Box>

            <Box sx={{ mb: 2, display: 'flex', gap: 2 }}>
                <Button 
                    variant="contained" 
                    startIcon={<AddIcon />}
                    onClick={() => handleOpen()}
                    color="primary"
                >
                    Nuevo Parámetro
                </Button>
                <TextField 
                    size="small"
                    placeholder="Filtrar por grupo..."
                    value={filterGrupo}
                    onChange={(e) => setFilterGrupo(e.target.value)}
                />
            </Box>

            <TableContainer component={Paper}>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>Grupo</TableCell>
                            <TableCell>Clave</TableCell>
                            <TableCell>Descripción</TableCell>
                            <TableCell>Padre</TableCell>
                            <TableCell align="right">Acciones</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {parametros
                            .filter(p => !filterGrupo || p.grupo.toLowerCase().includes(filterGrupo.toLowerCase()))
                            .map((parametro) => (
                            <TableRow key={parametro.id}>
                                <TableCell>
                                    <Chip label={parametro.grupo} size="small" color="primary" variant="outlined" />
                                </TableCell>
                                <TableCell><strong>{parametro.clave}</strong></TableCell>
                                <TableCell>{parametro.descripcion}</TableCell>
                                <TableCell>{parametro.parametroPadre?.descripcion || '-'}</TableCell>
                                <TableCell align="right">
                                    <IconButton onClick={() => handleOpen(parametro)} color="primary" size="small">
                                        <EditIcon fontSize="small" />
                                    </IconButton>
                                    <IconButton onClick={() => handleDelete(parametro.id)} color="error" size="small">
                                        <DeleteIcon fontSize="small" />
                                    </IconButton>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>

            <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>{editing ? 'Editar Parámetro' : 'Nuevo Parámetro'}</DialogTitle>
                <DialogContent>
                    <Box sx={{ display: 'grid', gap: 2, pt: 1 }}>
                        <TextField
                            label="Grupo"
                            fullWidth
                            value={formData.grupo}
                            onChange={(e) => setFormData({ ...formData, grupo: e.target.value })}
                            placeholder="Ej: ESTADO_GESTION"
                        />
                        <TextField
                            label="Clave"
                            fullWidth
                            value={formData.clave}
                            onChange={(e) => setFormData({ ...formData, clave: e.target.value })}
                        />
                        <TextField
                            label="Descripción"
                            fullWidth
                            value={formData.descripcion}
                            onChange={(e) => setFormData({ ...formData, descripcion: e.target.value })}
                        />
                        <FormControl fullWidth>
                            <InputLabel>Parámetro Padre</InputLabel>
                            <Select
                                value={formData.padreId || ''}
                                label="Parámetro Padre"
                                onChange={(e) => setFormData({ ...formData, padreId: e.target.value })}
                            >
                                <MenuItem value=""><em>Ninguno</em></MenuItem>
                                {parametros
                                    .filter(p => !editing || p.id !== editing.id)
                                    .map(p => (
                                        <MenuItem key={p.id} value={p.id.toString()}>
                                            {p.grupo}: {p.descripcion}
                                        </MenuItem>
                                    ))
                                }
                            </Select>
                        </FormControl>
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOpen(false)}>Cancelar</Button>
                    <Button onClick={handleSave} variant="contained">Guardar</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}

export default AjustesParametros
