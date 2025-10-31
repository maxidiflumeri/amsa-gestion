import React, { useEffect, useState } from 'react';
import {
    Box,
    Grid,
    Typography,
    Paper,
    CircularProgress,
    Chip,
    Button,
    TextField,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    IconButton,
    Snackbar,
    Alert,
    MenuItem,
} from '@mui/material';
import EmailIcon from '@mui/icons-material/Email';
import PhoneIcon from '@mui/icons-material/Phone';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import LanguageIcon from '@mui/icons-material/Language';
import HomeIcon from '@mui/icons-material/Home';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import DeleteIcon from '@mui/icons-material/Delete';
import SaveIcon from '@mui/icons-material/Save';
import api from '../../api/axios';
import ComentariosPanel from './ComentariosPanel';
import { getHelperTextEmail, validarEmailFront } from '../../utils/emails';
import { formatearTelefonoParaUI, PreviewTelefono, validarTelefonoArgentinoFront } from '../../utils/phone';
import { DireccionPreview, getHelperTextDireccion, validarDireccionArgentinaFront } from '../../utils/direcciones';

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
    const [cambiosPendientes, setCambiosPendientes] = useState(false);

    // Modales y feedback
    const [openModalAgregar, setOpenModalAgregar] = useState(false);
    const [openModalConfirmar, setOpenModalConfirmar] = useState(false);
    const [contactoAEliminar, setContactoAEliminar] = useState<any>(null);

    const [nuevoContacto, setNuevoContacto] = useState({ tipo: '', valor: '' });
    const [tipoSeleccionado, setTipoSeleccionado] = useState<string>('');
    const [previewTel, setPreviewTel] = useState<PreviewTelefono | null>(null);
    const [previewEmail, setPreviewEmail] = useState<{ valido: boolean; normalizado?: string } | null>(null);
    const [previewDir, setPreviewDir] = useState<DireccionPreview | null>(null);
    const [nuevaDireccion, setNuevaDireccion] = useState({
        calle: '',
        numero: '',
        cp: '',
        localidad: '',
        provincia: '',
    });

    // Snackbar
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' });

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
        setPreviewTel(null);
        setOpenModalAgregar(true);
    };

    const handleEstadoChange = (type: 'situacion' | 'gestion', value: string) => {
        if (type === 'situacion') setEstadoSituacion(value);
        else setEstadoGestion(value);
        setCambiosPendientes(true);
    };

    const handleGuardarEstados = async () => {
        try {
            await api.put(`/deudores/${deudorId}`, {
                estadoSituacionClave: estadoSituacion,
                estadoGestionClave: estadoGestion,
            });
            setCambiosPendientes(false);
            setSnackbar({ open: true, message: 'Estados actualizados correctamente', severity: 'success' });
            cargarInicial(); // refresca los datos
        } catch (err) {
            console.error(err);
            setSnackbar({ open: true, message: 'Error al actualizar los estados', severity: 'error' });
        }
    };

    const handleCloseModalAgregar = () => setOpenModalAgregar(false);

    // Normaliza teléfono/whatsapp antes de enviar. Para otros tipos, envía tal cual.
    const handleAgregarContacto = async () => {
        try {
            let payload = { ...nuevoContacto, deudorId };

            if (nuevoContacto.tipo === 'telefono' || nuevoContacto.tipo === 'whatsapp') {
                const res = validarTelefonoArgentinoFront(nuevoContacto.valor);
                if (!res.valido || !res.e164) {
                    setSnackbar({ open: true, message: 'Número inválido para Argentina', severity: 'error' });
                    return;
                }
                payload = { ...payload, valor: res.e164 }; // guardamos E.164
            }

            await api.post('/contactos', payload);
            await cargarInicial();
            setOpenModalAgregar(false);
            setSnackbar({ open: true, message: `Contacto agregado correctamente`, severity: 'success' });
        } catch (err: any) {
            if (err.response.data?.message) {
                setSnackbar({ open: true, message: err.response.data.message, severity: 'error' });
            } else {
                setSnackbar({ open: true, message: 'Error al agregar contacto', severity: 'error' });
            }
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

    // Renderizador de chips por tipo (formatea tel/wa para UI)
    const renderContactos = (tipo: string, icono: React.ReactElement, color?: string) => {
        const contactosFiltrados = contactos?.filter((c: any) => c.tipo === tipo) || [];
        const sinContactos = contactosFiltrados.length === 0;

        return (
            <Box sx={{ mt: 1 }}>
                {sinContactos ? (
                    <Chip label={`Sin ${tipo}`} variant="outlined" color="info" sx={{ mt: 1 }} />
                ) : (
                    contactosFiltrados.map((c: any) => {
                        const label =
                            tipo === 'telefono' || tipo === 'whatsapp'
                                ? formatearTelefonoParaUI(c.valor)
                                : c.valor;

                        return (
                            <Chip
                                key={c.id}
                                icon={icono}
                                label={label}
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
                        );
                    })
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

            <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 4, boxShadow: 2 }}>
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

                        {/* ESTADOS + GUARDAR */}
                        <Grid
                            container
                            spacing={2}
                            alignItems="flex-end"
                            sx={{
                                mt: 1,
                                flexWrap: 'wrap',
                                rowGap: 2,
                            }}
                        >
                            <Grid item xs={12} md={5}>
                                <Typography variant="subtitle2" fontWeight="bold" mt={2}>
                                    Estado de Situación
                                </Typography>
                                <TextField
                                    select
                                    size="small"
                                    fullWidth
                                    value={estadoSituacion}
                                    onChange={(e) => handleEstadoChange('situacion', e.target.value)}
                                    sx={{
                                        mt: 1,
                                        '& .MuiSelect-select': { py: 1.2 },
                                    }}
                                >
                                    {estadosSituacion.map((estado: any) => (
                                        <MenuItem key={estado.clave} value={estado.clave}>
                                            {estado.descripcion}
                                        </MenuItem>
                                    ))}
                                </TextField>
                            </Grid>

                            <Grid item xs={12} md={5}>
                                <Typography variant="subtitle2" fontWeight="bold" mt={2}>
                                    Estado de Gestión
                                </Typography>
                                <TextField
                                    select
                                    size="small"
                                    fullWidth
                                    value={estadoGestion}
                                    onChange={(e) => handleEstadoChange('gestion', e.target.value)}
                                    sx={{
                                        mt: 1,
                                        '& .MuiSelect-select': { py: 1.2 },
                                    }}
                                >
                                    {estadosGestion.map((estado: any) => (
                                        <MenuItem key={estado.clave} value={estado.clave}>
                                            {estado.descripcion}
                                        </MenuItem>
                                    ))}
                                </TextField>
                            </Grid>

                            <Grid
                                item
                                xs={12}
                                md={2}
                                sx={{
                                    textAlign: { xs: 'center', md: 'right' },
                                    mt: { xs: 1, md: 3 },
                                }}
                            >
                                <Button
                                    variant="contained"
                                    color="primary"
                                    startIcon={<SaveIcon />}
                                    onClick={handleGuardarEstados}
                                    disabled={!cambiosPendientes}
                                    sx={{
                                        borderRadius: 3,
                                        px: 2.5,
                                        py: 1,
                                        width: { xs: '100%', sm: 'auto' },
                                        transition: 'all 0.2s ease-in-out',
                                        bgcolor: cambiosPendientes ? 'primary.main' : 'grey.400',
                                        '&:hover': cambiosPendientes
                                            ? { bgcolor: 'primary.dark', transform: 'scale(1.03)' }
                                            : undefined,
                                    }}
                                >
                                    Guardar
                                </Button>
                            </Grid>
                        </Grid>
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

            {/* PANEL DE COMENTARIOS */}
            <ComentariosPanel
                deudorId={deudorId}
                comentarios={comentarios}
                onComentarioAgregado={(status?: 'success' | 'error') => {
                    if (status === 'success') {
                        setSnackbar({ open: true, message: 'Comentario agregado correctamente', severity: 'success' });
                        cargarInicial(); // refrescar comentarios
                    } else {
                        setSnackbar({ open: true, message: 'Error al agregar comentario', severity: 'error' });
                    }
                }}
            />

            {/* MODAL AGREGAR CONTACTO */}
            <Dialog open={openModalAgregar} onClose={handleCloseModalAgregar} fullWidth maxWidth="sm">
                <DialogTitle>Agregar {tipoSeleccionado}</DialogTitle>
                <DialogContent>
                    {tipoSeleccionado === 'direccion' ? (
                        <>
                            <Grid container spacing={2} sx={{ mt: 1 }}>
                                <Grid item xs={12} sm={6}>
                                    <TextField
                                        label="Calle"
                                        fullWidth
                                        value={nuevaDireccion.calle}
                                        onChange={(e) =>
                                            setNuevaDireccion({ ...nuevaDireccion, calle: e.target.value })
                                        }
                                    />
                                </Grid>
                                <Grid item xs={12} sm={3}>
                                    <TextField
                                        label="Número"
                                        fullWidth
                                        value={nuevaDireccion.numero}
                                        onChange={(e) =>
                                            setNuevaDireccion({ ...nuevaDireccion, numero: e.target.value })
                                        }
                                    />
                                </Grid>
                                <Grid item xs={12} sm={3}>
                                    <TextField
                                        label="Código Postal"
                                        fullWidth
                                        value={nuevaDireccion.cp}
                                        onChange={(e) =>
                                            setNuevaDireccion({ ...nuevaDireccion, cp: e.target.value })
                                        }
                                    />
                                </Grid>

                                <Grid item xs={12} sm={6}>
                                    <TextField
                                        label="Localidad"
                                        fullWidth
                                        value={nuevaDireccion.localidad}
                                        onChange={(e) =>
                                            setNuevaDireccion({ ...nuevaDireccion, localidad: e.target.value })
                                        }
                                    />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <TextField
                                        label="Provincia"
                                        fullWidth
                                        value={nuevaDireccion.provincia}
                                        onChange={(e) =>
                                            setNuevaDireccion({ ...nuevaDireccion, provincia: e.target.value })
                                        }
                                    />
                                </Grid>
                            </Grid>

                            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                                {previewDir
                                    ? getHelperTextDireccion(previewDir)
                                    : 'Completá los campos y se validará automáticamente'}
                            </Typography>
                        </>
                    ) : (
                        // 👇 se mantiene el campo único para los otros tipos
                        <TextField
                            label={
                                tipoSeleccionado === 'telefono' || tipoSeleccionado === 'whatsapp'
                                    ? 'Teléfono (AR)'
                                    : tipoSeleccionado === 'email'
                                        ? 'Correo electrónico'
                                        : 'Valor'
                            }
                            fullWidth
                            autoFocus
                            value={nuevoContacto.valor}
                            onChange={(e) => {
                                const valor = e.target.value;
                                setNuevoContacto({ ...nuevoContacto, valor });

                                if (tipoSeleccionado === 'telefono' || tipoSeleccionado === 'whatsapp') {
                                    const res = validarTelefonoArgentinoFront(valor);
                                    setPreviewTel(res);
                                } else if (tipoSeleccionado === 'email') {
                                    const res = validarEmailFront(valor);
                                    setPreviewEmail(res);
                                } else {
                                    setPreviewTel(null);
                                    setPreviewEmail(null);
                                }
                            }}
                            sx={{ mt: 2 }}
                            helperText={
                                tipoSeleccionado === 'telefono' || tipoSeleccionado === 'whatsapp'
                                    ? previewTel?.valido
                                        ? `Se guardará como: ${previewTel.internacional} (${previewTel.e164})`
                                        : 'Ingresá un número válido de Argentina'
                                    : tipoSeleccionado === 'email'
                                        ? getHelperTextEmail(previewEmail)
                                        : undefined
                            }
                            error={
                                tipoSeleccionado === 'telefono' || tipoSeleccionado === 'whatsapp'
                                    ? !!(previewTel && !previewTel.valido)
                                    : tipoSeleccionado === 'email'
                                        ? !!(previewEmail && !previewEmail.valido)
                                        : false
                            }
                        />
                    )}
                </DialogContent>

                <DialogActions>
                    <Button onClick={handleCloseModalAgregar}>Cancelar</Button>
                    <Button
                        variant="contained"
                        onClick={async () => {
                            if (tipoSeleccionado === 'direccion') {
                                const textoCompleto = `${nuevaDireccion.calle} - ${nuevaDireccion.numero} - ${nuevaDireccion.localidad} - ${nuevaDireccion.provincia} - ${nuevaDireccion.cp}`;
                                const res = await validarDireccionArgentinaFront(textoCompleto);
                                setPreviewDir(res);

                                if (!res.valido) {
                                    setSnackbar({
                                        open: true,
                                        message: 'Dirección inválida o no reconocida',
                                        severity: 'error',
                                    });
                                    return;
                                }

                                await api.post('/contactos', {
                                    tipo: 'direccion',
                                    valor: textoCompleto,
                                    deudorId,
                                });

                                setSnackbar({
                                    open: true,
                                    message: 'Dirección agregada correctamente',
                                    severity: 'success',
                                });
                                await cargarInicial();
                                setOpenModalAgregar(false);
                            } else {
                                handleAgregarContacto();
                            }
                        }}
                        disabled={
                            tipoSeleccionado === 'direccion'
                                ? !(
                                    nuevaDireccion.calle &&
                                    nuevaDireccion.numero &&
                                    nuevaDireccion.localidad &&
                                    nuevaDireccion.provincia
                                )
                                : tipoSeleccionado === 'telefono' || tipoSeleccionado === 'whatsapp'
                                    ? !previewTel?.valido
                                    : tipoSeleccionado === 'email'
                                        ? !previewEmail?.valido
                                        : !nuevoContacto.valor?.trim()
                        }
                    >
                        Guardar
                    </Button>
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
                <Alert onClose={handleCloseSnackbar} severity={snackbar.severity} variant="filled">
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default FichaDeudor;