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
    Paper,
    Divider
} from '@mui/material'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import AddIcon from '@mui/icons-material/Add'
import api from '../../api/axios'

interface Empresa {
    id: number;
    nombre: string;
    cuit: string;
}

const AjustesEmpresas: React.FC = () => {
    // ... (rest of the component state)
    const [empresas, setEmpresas] = useState<Empresa[]>([]);
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<Empresa | null>(null);
    const [formData, setFormData] = useState({ nombre: '', cuit: '' });

    const fetchEmpresas = async () => {
        try {
            const res = await api.get('/empresas');
            setEmpresas(res.data);
        } catch (error) {
            console.error('Error fetching empresas:', error);
        }
    };

    useEffect(() => {
        fetchEmpresas();
    }, []);

    const handleOpen = (empresa?: Empresa) => {
        if (empresa) {
            setEditing(empresa);
            setFormData({ nombre: empresa.nombre, cuit: empresa.cuit || '' });
        } else {
            setEditing(null);
            setFormData({ nombre: '', cuit: '' });
        }
        setOpen(true);
    };

    const handleSave = async () => {
        try {
            if (editing) {
                await api.patch(`/empresas/${editing.id}`, formData);
            } else {
                await api.post('/empresas', formData);
            }
            
            setOpen(false);
            fetchEmpresas();
        } catch (error) {
            console.error('Error saving empresa:', error);
        }
    };

    const handleDelete = async (id: number) => {
        if (window.confirm('¿Eliminar esta empresa?')) {
            try {
                await api.delete(`/empresas/${id}`);
                fetchEmpresas();
            } catch (error) {
                console.error('Error deleting empresa:', error);
            }
        }
    };

    return (
        <Box sx={{ p: 3 }}>
            <Box sx={{ mb: 3 }}>
                <Typography variant="h4" gutterBottom sx={{ fontWeight: 'bold' }}>
                    Gestión de Empresas
                </Typography>
                <Typography variant="body1" color="text.secondary">
                    Administre las empresas y sus respectivos CUITs.
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
                    Nueva Empresa
                </Button>
            </Box>

            <TableContainer component={Paper}>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>Nombre</TableCell>
                            <TableCell>CUIT</TableCell>
                            <TableCell align="right">Acciones</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {empresas.map((empresa) => (
                            <TableRow key={empresa.id}>
                                <TableCell>{empresa.nombre}</TableCell>
                                <TableCell>{empresa.cuit}</TableCell>
                                <TableCell align="right">
                                    <IconButton onClick={() => handleOpen(empresa)} color="primary">
                                        <EditIcon />
                                    </IconButton>
                                    <IconButton onClick={() => handleDelete(empresa.id)} color="error">
                                        <DeleteIcon />
                                    </IconButton>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>

            <Dialog open={open} onClose={() => setOpen(false)}>
                <DialogTitle>{editing ? 'Editar Empresa' : 'Nueva Empresa'}</DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus
                        margin="dense"
                        label="Nombre"
                        fullWidth
                        value={formData.nombre}
                        onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                    />
                    <TextField
                        margin="dense"
                        label="CUIT"
                        fullWidth
                        value={formData.cuit}
                        onChange={(e) => setFormData({ ...formData, cuit: e.target.value })}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOpen(false)}>Cancelar</Button>
                    <Button onClick={handleSave} variant="contained">Guardar</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}

export default AjustesEmpresas
