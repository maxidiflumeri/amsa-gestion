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
    Card,
    CardContent,
    CardHeader,
    Divider,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Stack,
    Tabs,
    Tab
} from '@mui/material';
import EmailIcon from '@mui/icons-material/Email';
import PhoneIcon from '@mui/icons-material/Phone';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import LanguageIcon from '@mui/icons-material/Language';
import HomeIcon from '@mui/icons-material/Home';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import DeleteIcon from '@mui/icons-material/Delete';
import SaveIcon from '@mui/icons-material/Save';
import BusinessCenterIcon from '@mui/icons-material/BusinessCenter';
import AssignmentIcon from '@mui/icons-material/Assignment';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import ReceiptIcon from '@mui/icons-material/Receipt';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ChatIcon from '@mui/icons-material/Chat';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import InfoIcon from '@mui/icons-material/Info';

import api from '../../api/axios';
import ComentariosPanel from './ComentariosPanel';
import { getHelperTextEmail, validarEmailFront } from '../../utils/emails';
import { formatearTelefonoParaUI, PreviewTelefono, validarTelefonoArgentinoFront } from '../../utils/phone';
import { DireccionPreview, getHelperTextDireccion, validarDireccionArgentinaFront } from '../../utils/direcciones';

// Helper visual para Tabs
interface TabPanelProps {
    children?: React.ReactNode;
    index: number;
    value: number;
}
function TabPanel(props: TabPanelProps) {
    const { children, value, index, ...other } = props;
    return (
        <div role="tabpanel" hidden={value !== index} id={`fichatabpanel-${index}`} aria-labelledby={`fichatab-${index}`} {...other}>
            {value === index && (<Box sx={{ pt: 2 }}>{children}</Box>)}
        </div>
    );
}

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
    
    // Estado Pestañas centrales
    const [tabVal, setTabVal] = useState(0);

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
            cargarInicial();
        } catch (err) {
            console.error(err);
            setSnackbar({ open: true, message: 'Error al actualizar los estados', severity: 'error' });
        }
    };

    const handleCloseModalAgregar = () => setOpenModalAgregar(false);

    const handleAgregarContacto = async () => {
        try {
            let payload = { ...nuevoContacto, deudorId };

            if (nuevoContacto.tipo === 'telefono' || nuevoContacto.tipo === 'whatsapp') {
                const res = validarTelefonoArgentinoFront(nuevoContacto.valor);
                if (!res.valido || !res.e164) {
                    setSnackbar({ open: true, message: 'Número inválido para Argentina', severity: 'error' });
                    return;
                }
                payload = { ...payload, valor: res.e164 };
            }

            await api.post('/contactos', payload);
            await cargarInicial();
            setOpenModalAgregar(false);
            setSnackbar({ open: true, message: `Contacto agregado correctamente`, severity: 'success' });
        } catch (err: any) {
            if (err.response?.data?.message) {
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

    if (loading || !deudor) return (
        <Box display="flex" justifyContent="center" alignItems="center" height="200px">
            <CircularProgress />
        </Box>
    );

    const { nombre, apellido, documento, remesa, empresa, comentarios, contactos, facturas, pagos, campoExtras, camposAdicionales, montoTotal, fechaVencimiento } = deudor;

    // Contactos UI Helper
    const renderContactosList = (tipo: string, icono: React.ReactElement, color: "default" | "primary" | "secondary" | "error" | "info" | "success" | "warning" = "default") => {
        const contactosFiltrados = contactos?.filter((c: any) => c.tipo === tipo) || [];
        
        return (
            <Box mb={2}>
                <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                    {React.cloneElement(icono, { color: "action", fontSize: "small" })}
                    <Typography variant="subtitle2" sx={{ textTransform: 'capitalize', fontWeight: 'bold', color: 'text.secondary' }}>
                        {tipo === 'red_social' ? 'Redes Sociales' : tipo === 'direccion' ? 'Direcciones' : tipo + 's'}
                    </Typography>
                    <IconButton size="small" color="primary" onClick={() => handleOpenModalAgregar(tipo)} sx={{ ml: 'auto' }}>
                        <AddCircleOutlineIcon fontSize="small" />
                    </IconButton>
                </Stack>
                <Box>
                    {contactosFiltrados.length === 0 ? (
                        <Typography variant="body2" color="text.disabled" fontStyle="italic">No hay registros</Typography>
                    ) : (
                        contactosFiltrados.map((c: any) => {
                            const label = (tipo === 'telefono' || tipo === 'whatsapp') ? formatearTelefonoParaUI(c.valor) : c.valor;
                            return (
                                <Chip
                                    key={c.id}
                                    label={label}
                                    color={color}
                                    variant="outlined"
                                    onDelete={() => handleConfirmarEliminar(c)}
                                    size="small"
                                    sx={{ mr: 1, mb: 1, fontWeight: 500 }}
                                />
                            );
                        })
                    )}
                </Box>
            </Box>
        );
    };

    // Datos Adicionales Helper
    const hasExtras = (campoExtras && campoExtras.length > 0) || (camposAdicionales && Object.keys(camposAdicionales).length > 0);

    return (
        <Box sx={{ pb: 4 }}>
            {/* CABECERA PRINCIPAL */}
            <Card elevation={3} sx={{ mb: 3, borderRadius: 3, backgroundImage: 'linear-gradient(to right, #f8f9fa, #ffffff)' }}>
                <CardContent>
                    <Grid container spacing={2} alignItems="center">
                        <Grid item xs={12} md={6}>
                            <Stack direction="row" alignItems="center" spacing={2} mb={1}>
                                <AccountCircleIcon color="primary" sx={{ fontSize: 40 }} />
                                <Box>
                                    <Typography variant="h5" fontWeight="900" color="primary.main">
                                        {nombre} {apellido}
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        DNI/CUIL: <strong>{documento}</strong>
                                    </Typography>
                                </Box>
                            </Stack>
                            <Stack direction="row" spacing={3} mt={2}>
                                <Box display="flex" alignItems="center" gap={1}>
                                    <BusinessCenterIcon color="action" fontSize="small" />
                                    <Typography variant="body2"><strong>Empresa:</strong> {empresa?.nombre || '-'}</Typography>
                                </Box>
                                <Box display="flex" alignItems="center" gap={1}>
                                    <AssignmentIcon color="action" fontSize="small" />
                                    <Typography variant="body2"><strong>Remesa:</strong> {remesa?.numeroRemesa || '-'}</Typography>
                                </Box>
                            </Stack>
                        </Grid>
                        
                        <Grid item xs={12} md={6} sx={{ textAlign: { xs: 'left', md: 'right' } }}>
                            <Typography variant="overline" color="text.secondary" fontWeight="bold">DEUDA TOTAL</Typography>
                            <Typography variant="h4" fontWeight="bold" color="text.primary">
                                ${montoTotal?.toLocaleString('es-AR', { minimumFractionDigits: 2 }) || '0.00'}
                            </Typography>
                            {fechaVencimiento && (
                                <Typography variant="caption" color="text.secondary" display="block">
                                    Vencimiento: {new Date(fechaVencimiento).toLocaleDateString()}
                                </Typography>
                            )}
                        </Grid>
                    </Grid>
                </CardContent>
            </Card>

            <Grid container spacing={3}>
                
                {/* COLUMNA IZQUIERDA */}
                <Grid item xs={12} md={7}>
                    
                    {/* ACCIONES Y ESTADOS */}
                    <Card elevation={2} sx={{ mb: 3, borderRadius: 3 }}>
                        <CardHeader title="Gestión y Estado" titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }} sx={{ pb: 0 }} />
                        <CardContent>
                            <Grid container spacing={2} alignItems="center">
                                <Grid item xs={12} sm={5}>
                                    <TextField
                                        select
                                        fullWidth
                                        label="Situación del cliente"
                                        size="small"
                                        value={estadoSituacion}
                                        onChange={(e) => handleEstadoChange('situacion', e.target.value)}
                                        variant="outlined"
                                    >
                                        {estadosSituacion?.map((est: any) => (
                                            <MenuItem key={est.clave} value={est.clave}>{est.descripcion}</MenuItem>
                                        ))}
                                    </TextField>
                                </Grid>
                                <Grid item xs={12} sm={5}>
                                    <TextField
                                        select
                                        fullWidth
                                        label="Estado de Gestión"
                                        size="small"
                                        value={estadoGestion}
                                        onChange={(e) => handleEstadoChange('gestion', e.target.value)}
                                        variant="outlined"
                                    >
                                        {estadosGestion?.map((est: any) => (
                                            <MenuItem key={est.clave} value={est.clave}>{est.descripcion}</MenuItem>
                                        ))}
                                    </TextField>
                                </Grid>
                                <Grid item xs={12} sm={2}>
                                    <Button
                                        fullWidth
                                        variant="contained"
                                        color={cambiosPendientes ? "primary" : "inherit"}
                                        startIcon={cambiosPendientes ? <SaveIcon /> : <CheckCircleIcon />}
                                        onClick={handleGuardarEstados}
                                        disabled={!cambiosPendientes}
                                        sx={{ height: '40px' }}
                                    >
                                        {cambiosPendientes ? "Guardar" : "OK"}
                                    </Button>
                                </Grid>
                            </Grid>
                        </CardContent>
                    </Card>

                    {/* DASHBOARD PRINCIPAL (TABS) */}
                    <Card elevation={2} sx={{ borderRadius: 3, minHeight: 400 }}>
                        <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: '#fbfbfb' }}>
                            <Tabs 
                                value={tabVal} 
                                onChange={(e, val) => setTabVal(val)} 
                                variant="fullWidth"
                                textColor="primary"
                                indicatorColor="primary"
                            >
                                <Tab icon={<ChatIcon fontSize="small"/>} iconPosition="start" label="Comentarios" />
                                <Tab icon={<ReceiptIcon fontSize="small"/>} iconPosition="start" label={`Facturas (${facturas?.length || 0})`} />
                                <Tab icon={<AccountBalanceWalletIcon fontSize="small"/>} iconPosition="start" label={`Pagos (${pagos?.length || 0})`} />
                            </Tabs>
                        </Box>

                        {/* TAB 0 - COMENTARIOS */}
                        <TabPanel value={tabVal} index={0}>
                            <Box sx={{ px: 2, pb: 2 }}>
                                <ComentariosPanel
                                    deudorId={deudorId}
                                    comentarios={comentarios}
                                    onComentarioAgregado={(status?: 'success' | 'error') => {
                                        if (status === 'success') {
                                            setSnackbar({ open: true, message: 'Comentario agregado', severity: 'success' });
                                            cargarInicial();
                                        } else {
                                            setSnackbar({ open: true, message: 'Error al agregar', severity: 'error' });
                                        }
                                    }}
                                />
                            </Box>
                        </TabPanel>

                        {/* TAB 1 - FACTURAS */}
                        <TabPanel value={tabVal} index={1}>
                            <Box sx={{ px: 2, pb: 2 }}>
                                {facturas && facturas.length > 0 ? (
                                    <TableContainer sx={{ maxHeight: 300 }}>
                                        <Table stickyHeader size="small">
                                            <TableHead>
                                                <TableRow>
                                                    <TableCell sx={{ bgcolor: '#f5f5f5' }}>Factura</TableCell>
                                                    <TableCell sx={{ bgcolor: '#f5f5f5' }}>Emisión</TableCell>
                                                    <TableCell sx={{ bgcolor: '#f5f5f5' }}>Vencimiento</TableCell>
                                                    <TableCell align="right" sx={{ bgcolor: '#f5f5f5' }}>Importe</TableCell>
                                                    <TableCell sx={{ bgcolor: '#f5f5f5' }}>Estado</TableCell>
                                                </TableRow>
                                            </TableHead>
                                            <TableBody>
                                                {facturas.map((fac: any) => {
                                                    const vto = new Date(fac.vencimiento);
                                                    const esVencida = vto < new Date() && fac.estado !== 'PAGADA';
                                                    return (
                                                        <TableRow key={fac.id} hover>
                                                            <TableCell sx={{ fontWeight: 500 }}>{fac.nroFactura}</TableCell>
                                                            <TableCell>{new Date(fac.fechaEmision).toLocaleDateString()}</TableCell>
                                                            <TableCell sx={{ color: esVencida ? 'error.main' : 'inherit', fontWeight: esVencida ? 'bold' : 'normal' }}>
                                                                {vto.toLocaleDateString()}
                                                            </TableCell>
                                                            <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                                                                ${fac.importe.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                                                            </TableCell>
                                                            <TableCell>
                                                                <Chip 
                                                                    label={fac.estado || 'PENDIENTE'} 
                                                                    size="small" 
                                                                    color={fac.estado === 'PAGADA' ? 'success' : esVencida ? 'error' : 'warning'} 
                                                                    variant="outlined" 
                                                                />
                                                            </TableCell>
                                                        </TableRow>
                                                    );
                                                })}
                                            </TableBody>
                                        </Table>
                                    </TableContainer>
                                ) : (
                                    <Typography variant="body2" color="text.secondary" align="center" fontStyle="italic" py={4}>
                                        No hay facturas registradas para este deudor.
                                    </Typography>
                                )}
                            </Box>
                        </TabPanel>

                        {/* TAB 2 - PAGOS */}
                        <TabPanel value={tabVal} index={2}>
                            <Box sx={{ px: 2, pb: 2 }}>
                                {pagos && pagos.length > 0 ? (
                                    <TableContainer sx={{ maxHeight: 300 }}>
                                        <Table stickyHeader size="small">
                                            <TableHead>
                                                <TableRow>
                                                    <TableCell sx={{ bgcolor: '#f5f5f5' }}>Fecha Pago</TableCell>
                                                    <TableCell sx={{ bgcolor: '#f5f5f5' }}>Origen</TableCell>
                                                    <TableCell sx={{ bgcolor: '#f5f5f5' }}>Observación</TableCell>
                                                    <TableCell align="right" sx={{ bgcolor: '#f5f5f5' }}>Importe</TableCell>
                                                </TableRow>
                                            </TableHead>
                                            <TableBody>
                                                {pagos.map((pago: any) => (
                                                    <TableRow key={pago.id} hover>
                                                        <TableCell>{new Date(pago.fecha).toLocaleDateString()}</TableCell>
                                                        <TableCell>{pago.origenArchivo || '-'}</TableCell>
                                                        <TableCell>{pago.observacion || '-'}</TableCell>
                                                        <TableCell align="right" sx={{ fontWeight: 'bold', color: 'success.main' }}>
                                                            +${pago.importe.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </TableContainer>
                                ) : (
                                    <Typography variant="body2" color="text.secondary" align="center" fontStyle="italic" py={4}>
                                        No hay pagos registrados para este deudor.
                                    </Typography>
                                )}
                            </Box>
                        </TabPanel>
                    </Card>
                </Grid>

                {/* COLUMNA DERECHA */}
                <Grid item xs={12} md={5}>
                    <Card elevation={2} sx={{ mb: 3, borderRadius: 3 }}>
                        <CardHeader title="Información de Contacto" titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }} />
                        <Divider sx={{ mb: 2 }} />
                        <CardContent sx={{ pt: 0 }}>
                            {renderContactosList('telefono', <PhoneIcon />, 'primary')}
                            {renderContactosList('whatsapp', <WhatsAppIcon />, 'success')}
                            {renderContactosList('email', <EmailIcon />, 'default')}
                            {renderContactosList('direccion', <HomeIcon />, 'default')}
                            {renderContactosList('red_social', <LanguageIcon />, 'info')}
                        </CardContent>
                    </Card>

                    {/* DATOS ADICIONALES */}
                    {hasExtras && (
                        <Card elevation={2} sx={{ borderRadius: 3 }}>
                            <CardHeader 
                                title="Datos Adicionales" 
                                titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }} 
                                avatar={<InfoIcon color="primary" />} 
                            />
                            <Divider />
                            <CardContent>
                                <Grid container spacing={2}>
                                    {/* Mapeo de JSON camposAdicionales */}
                                    {camposAdicionales && Object.keys(camposAdicionales).map((key) => {
                                        const valor = camposAdicionales[key];
                                        if(!valor) return null;
                                        return (
                                            <Grid item xs={6} key={key}>
                                                <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', display: 'block' }}>
                                                    {key.replace(/_/g, ' ')}
                                                </Typography>
                                                <Typography variant="body2" fontWeight="500">
                                                    {typeof valor === 'object' ? JSON.stringify(valor) : valor}
                                                </Typography>
                                            </Grid>
                                        );
                                    })}
                                    {/* Mapeo de la tabla campoExtras */}
                                    {campoExtras && campoExtras.map((extra: any) => (
                                        <Grid item xs={6} key={extra.id}>
                                            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', display: 'block' }}>
                                                {extra.clave.replace(/_/g, ' ')}
                                            </Typography>
                                            <Typography variant="body2" fontWeight="500">
                                                {extra.valor}
                                            </Typography>
                                        </Grid>
                                    ))}
                                </Grid>
                            </CardContent>
                        </Card>
                    )}
                </Grid>
                
            </Grid>

            {/* MODALES REUTILIZADOS (Igual a la lógica original) */}
            <Dialog open={openModalAgregar} onClose={handleCloseModalAgregar} fullWidth maxWidth="sm">
                <DialogTitle>Agregar {tipoSeleccionado}</DialogTitle>
                <DialogContent>
                    {tipoSeleccionado === 'direccion' ? (
                        <>
                            <Grid container spacing={2} sx={{ mt: 1 }}>
                                <Grid item xs={12} sm={6}>
                                    <TextField label="Calle" fullWidth value={nuevaDireccion.calle} onChange={(e) => setNuevaDireccion({ ...nuevaDireccion, calle: e.target.value })} />
                                </Grid>
                                <Grid item xs={12} sm={3}>
                                    <TextField label="Número" fullWidth value={nuevaDireccion.numero} onChange={(e) => setNuevaDireccion({ ...nuevaDireccion, numero: e.target.value })} />
                                </Grid>
                                <Grid item xs={12} sm={3}>
                                    <TextField label="Código Postal" fullWidth value={nuevaDireccion.cp} onChange={(e) => setNuevaDireccion({ ...nuevaDireccion, cp: e.target.value })} />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <TextField label="Localidad" fullWidth value={nuevaDireccion.localidad} onChange={(e) => setNuevaDireccion({ ...nuevaDireccion, localidad: e.target.value })} />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <TextField label="Provincia" fullWidth value={nuevaDireccion.provincia} onChange={(e) => setNuevaDireccion({ ...nuevaDireccion, provincia: e.target.value })} />
                                </Grid>
                            </Grid>
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                                {previewDir ? getHelperTextDireccion(previewDir) : 'Completá los campos y se validará automáticamente'}
                            </Typography>
                        </>
                    ) : (
                        <TextField
                            label={tipoSeleccionado === 'telefono' || tipoSeleccionado === 'whatsapp' ? 'Teléfono (AR)' : tipoSeleccionado === 'email' ? 'Correo electrónico' : 'Valor'}
                            fullWidth
                            autoFocus
                            value={nuevoContacto.valor}
                            onChange={(e) => {
                                const valor = e.target.value;
                                setNuevoContacto({ ...nuevoContacto, valor });
                                if (tipoSeleccionado === 'telefono' || tipoSeleccionado === 'whatsapp') {
                                    setPreviewTel(validarTelefonoArgentinoFront(valor));
                                } else if (tipoSeleccionado === 'email') {
                                    setPreviewEmail(validarEmailFront(valor));
                                } else {
                                    setPreviewTel(null);
                                    setPreviewEmail(null);
                                }
                            }}
                            sx={{ mt: 2 }}
                            helperText={
                                tipoSeleccionado === 'telefono' || tipoSeleccionado === 'whatsapp'
                                    ? previewTel?.valido ? `Se guardará como: ${previewTel.internacional} (${previewTel.e164})` : 'Ingresá un número válido de Argentina'
                                    : tipoSeleccionado === 'email' ? getHelperTextEmail(previewEmail) : undefined
                            }
                            error={
                                tipoSeleccionado === 'telefono' || tipoSeleccionado === 'whatsapp' ? !!(previewTel && !previewTel.valido)
                                    : tipoSeleccionado === 'email' ? !!(previewEmail && !previewEmail.valido) : false
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
                                    setSnackbar({ open: true, message: 'Dirección inválida o no reconocida', severity: 'error' });
                                    return;
                                }
                                await api.post('/contactos', { tipo: 'direccion', valor: textoCompleto, deudorId });
                                setSnackbar({ open: true, message: 'Dirección agregada correctamente', severity: 'success' });
                                await cargarInicial();
                                setOpenModalAgregar(false);
                            } else {
                                handleAgregarContacto();
                            }
                        }}
                        disabled={
                            tipoSeleccionado === 'direccion'
                                ? !(nuevaDireccion.calle && nuevaDireccion.numero && nuevaDireccion.localidad && nuevaDireccion.provincia)
                                : tipoSeleccionado === 'telefono' || tipoSeleccionado === 'whatsapp' ? !previewTel?.valido
                                    : tipoSeleccionado === 'email' ? !previewEmail?.valido : !nuevoContacto.valor?.trim()
                        }
                    >
                        Guardar
                    </Button>
                </DialogActions>
            </Dialog>

            {/* MODAL CONFIRMAR */}
            <Dialog open={openModalConfirmar} onClose={() => setOpenModalConfirmar(false)} maxWidth="xs" fullWidth>
                <DialogTitle>Eliminar contacto</DialogTitle>
                <DialogContent>
                    <Typography>¿Estás seguro que querés eliminar <strong>{contactoAEliminar?.valor}</strong>?</Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOpenModalConfirmar(false)}>Cancelar</Button>
                    <Button color="error" variant="contained" onClick={handleEliminarContacto}>Eliminar</Button>
                </DialogActions>
            </Dialog>

            <Snackbar open={snackbar.open} autoHideDuration={3000} onClose={handleCloseSnackbar} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
                <Alert onClose={handleCloseSnackbar} severity={snackbar.severity} variant="filled">{snackbar.message}</Alert>
            </Snackbar>
        </Box>
    );
};

export default FichaDeudor;