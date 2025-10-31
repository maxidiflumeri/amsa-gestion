import React, { useEffect, useState } from 'react';
import {
    Box,
    Grid,
    Typography,
    Paper,
    Divider,
    CircularProgress,
    Chip,
    Button,
    TextField,
    MenuItem,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    IconButton,
    Snackbar,
    Alert,
} from '@mui/material';
import EmailIcon from '@mui/icons-material/Email';
import PhoneIcon from '@mui/icons-material/Phone';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import LanguageIcon from '@mui/icons-material/Language';
import HomeIcon from '@mui/icons-material/Home';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import DeleteIcon from '@mui/icons-material/Delete';
import api from '../../api/axios';

interface Props {
    deudorId: number;
}

const FichaDeudor: React.FC<Props> = ({ deudorId }) => {
    const [deudor, setDeudor] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [estadoSituacion, setEstadoSituacion] = useState('');
    const [estadoGestion, setEstadoGestion] = useState('');
    const [estadosSituacion, setEstadosSituacion] = useState<any>(null);
    const [estadosGestion, setEstadosGestion] = useState<any>(null);

    // 👇 Modales y feedback
    const [openModalAgregar, setOpenModalAgregar] = useState(false);
    const [openModalConfirmar, setOpenModalConfirmar] = useState(false);
    const [contactoAEliminar, setContactoAEliminar] = useState<any>(null);

    const [nuevoContacto, setNuevoContacto] = useState({ tipo: '', valor: '' });
    const [tipoSeleccionado, setTipoSeleccionado] = useState<string>('');

    // Snackbar
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

    const cargarInicial = async () => {
        try {
            setLoading(true);
            const deu = await api.get(`/deudores/${deudorId}`);
            setDeudor(deu.data || []);
            setEstadoSituacion(deu.data.estadoSituacion?.clave || '');
            setEstadoGestion(deu.data.estadoGestion?.clave || '');
            const es = await api.get('/parametros?grupo=estadoSituacion');
            setEstadosSituacion(es.data || []);
            const eg = await api.get('/parametros?grupo=estadoGestion');
            setEstadosGestion(eg.data || []);
        } catch (e) {
            setSnackbar({ open: true, message: 'Error al cargar datos', severity: 'error' });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        cargarInicial();
    }, [deudorId]);

    const handleOpenModalAgregar = (tipo: string) => {
        setTipoSeleccionado(tipo);
        setNuevoContacto({ tipo, valor: '' });
        setOpenModalAgregar(true);
    };

    const handleCloseModalAgregar = () => setOpenModalAgregar(false);

    const handleAgregarContacto = async () => {
        try {
            await api.post('/contactos', { ...nuevoContacto, deudorId });
            await cargarInicial();
            setOpenModalAgregar(false);
            setSnackbar({ open: true, message: `Contacto agregado correctamente`, severity: 'success' });
        } catch (err) {
            setSnackbar({ open: true, message: 'Error al agregar contacto', severity: 'error' });
        }
    };

    const handleConfirmarEliminar = (contacto: any) => {
        setContactoAEliminar(contacto);
        setOpenModalConfirmar(true);
    };

    const handleEliminarContacto = async () => {
        if (!contactoAEliminar) return;
        try {
            await api.delete(`/contactos/${contactoAEliminar.id}`, { params: { deudorId } });
            await cargarInicial();
            setSnackbar({ open: true, message: `Contacto eliminado correctamente`, severity: 'success' });
        } catch (err) {
            setSnackbar({ open: true, message: 'Error al eliminar contacto', severity: 'error' });
        } finally {
            setOpenModalConfirmar(false);
            setContactoAEliminar(null);
        }
    };

    const handleCloseSnackbar = () => setSnackbar({ ...snackbar, open: false });

    if (loading || !deudor) return <CircularProgress />;

    const { nombre, apellido, documento, remesa, empresa, comentarios, contactos, camposAdicionales, montoTotal, fechaVencimiento } = deudor;

    // Renderizador de chips por tipo
    const renderContactos = (tipo: string, icono: React.ReactElement, color?: string) => {
        const contactosFiltrados = contactos?.filter((c: any) => c.tipo === tipo) || [];
        const sinContactos = contactosFiltrados.length === 0;

        return (
            <Box sx={{ mt: 1 }}>
                {sinContactos ? (
                    <Chip label={`Sin ${tipo}`} variant="outlined" color="info" sx={{ mt: 1 }} />
                ) : (
                    contactosFiltrados.map((c: any) => (
                        <Chip
                            key={c.id}
                            icon={icono}
                            label={c.valor}
                            color={color as any}
                            onDelete={() => handleConfirmarEliminar(c)}
                            deleteIcon={<DeleteIcon />}
                            sx={{
                                mr: 1,
                                mt: 1,
                                transition: 'all 0.2s',
                                '&:hover': { opacity: 0.8, boxShadow: 1 },
                            }}
                        />
                    ))
                )}
                <IconButton
                    size="small"
                    color="primary"
                    onClick={() => handleOpenModalAgregar(tipo)}
                    sx={{ ml: 1, mt: 1 }}
                >
                    <AddCircleOutlineIcon />
                </IconButton>
            </Box>
        );
    };

    return (
        <Box>
            <Typography variant="h5" gutterBottom fontWeight="bold">
                Ficha del Deudor
            </Typography>

            <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 4 }}>
                <Grid container spacing={2}>
                    {/* IZQUIERDA */}
                    <Grid item xs={12} sm={6}>
                        <Typography variant="subtitle2" fontWeight="bold">Nombre</Typography>
                        <Typography>{nombre} {apellido}</Typography>

                        <Typography variant="subtitle2" fontWeight="bold" mt={2}>DNI / CUIL</Typography>
                        <Typography>{documento}</Typography>

                        <Typography variant="subtitle2" fontWeight="bold" mt={2}>Remesa</Typography>
                        <Typography>{remesa?.numeroRemesa || '-'}</Typography>

                        <Typography variant="subtitle2" fontWeight="bold" mt={2}>Empresa</Typography>
                        <Typography>{empresa?.nombre || '-'}</Typography>

                        <Typography variant="subtitle2" fontWeight="bold" mt={2}>Domicilios</Typography>
                        {renderContactos('direccion', <HomeIcon />)}

                        <Typography variant="subtitle2" fontWeight="bold" mt={2}>Deuda histórica</Typography>
                        <Typography>${montoTotal?.toFixed(2) || '0.00'}</Typography>
                    </Grid>

                    {/* DERECHA */}
                    <Grid item xs={12} sm={6}>
                        <Typography variant="subtitle2" fontWeight="bold">Teléfonos</Typography>
                        {renderContactos('telefono', <PhoneIcon />)}

                        <Typography variant="subtitle2" fontWeight="bold" mt={2}>Emails</Typography>
                        {renderContactos('email', <EmailIcon />)}

                        <Typography variant="subtitle2" fontWeight="bold" mt={2}>WhatsApp</Typography>
                        {renderContactos('whatsapp', <WhatsAppIcon />, 'success')}

                        <Typography variant="subtitle2" fontWeight="bold" mt={2}>Redes Sociales</Typography>
                        {renderContactos('red_social', <LanguageIcon />)}

                        <Typography variant="subtitle2" fontWeight="bold" mt={2}>Fecha de Vencimiento</Typography>
                        <Typography>{fechaVencimiento ? new Date(fechaVencimiento).toLocaleDateString() : '-'}</Typography>
                    </Grid>
                </Grid>
            </Paper>

            {/* MODAL AGREGAR CONTACTO */}
            <Dialog open={openModalAgregar} onClose={handleCloseModalAgregar} fullWidth maxWidth="xs">
                <DialogTitle>Agregar {tipoSeleccionado}</DialogTitle>
                <DialogContent>
                    <TextField
                        label="Valor"
                        fullWidth
                        autoFocus
                        value={nuevoContacto.valor}
                        onChange={(e) => setNuevoContacto({ ...nuevoContacto, valor: e.target.value })}
                        sx={{ mt: 2 }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseModalAgregar}>Cancelar</Button>
                    <Button variant="contained" onClick={handleAgregarContacto}>Guardar</Button>
                </DialogActions>
            </Dialog>

            {/* MODAL CONFIRMAR ELIMINACIÓN */}
            <Dialog open={openModalConfirmar} onClose={() => setOpenModalConfirmar(false)} maxWidth="xs" fullWidth>
                <DialogTitle>Eliminar contacto</DialogTitle>
                <DialogContent>
                    <Typography>
                        ¿Estás seguro que querés eliminar <strong>{contactoAEliminar?.valor}</strong>?
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOpenModalConfirmar(false)}>Cancelar</Button>
                    <Button color="error" variant="contained" onClick={handleEliminarContacto}>
                        Eliminar
                    </Button>
                </DialogActions>
            </Dialog>

            {/* SNACKBAR GLOBAL */}
            <Snackbar
                open={snackbar.open}
                autoHideDuration={3000}
                onClose={handleCloseSnackbar}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            >
                <Alert onClose={handleCloseSnackbar} severity={snackbar.severity as any} variant="filled">
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default FichaDeudor;