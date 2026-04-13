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
    Tab,
    Accordion,
    AccordionSummary,
    AccordionDetails,
    Tooltip,
} from '@mui/material';
import EmailIcon from '@mui/icons-material/Email';
import PhoneIcon from '@mui/icons-material/Phone';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import LanguageIcon from '@mui/icons-material/Language';
import HomeIcon from '@mui/icons-material/Home';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import DeleteIcon from '@mui/icons-material/Delete';
import SaveIcon from '@mui/icons-material/Save';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import BusinessCenterIcon from '@mui/icons-material/BusinessCenter';
import AssignmentIcon from '@mui/icons-material/Assignment';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import ReceiptIcon from '@mui/icons-material/Receipt';
import ChatIcon from '@mui/icons-material/Chat';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import InfoIcon from '@mui/icons-material/Info';
import SearchIcon from '@mui/icons-material/Search';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HandshakeIcon from '@mui/icons-material/Handshake';
import PeopleAltIcon from '@mui/icons-material/PeopleAlt';
import BlockIcon from '@mui/icons-material/Block';
import PaymentIcon from '@mui/icons-material/Payment';

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
    const [motivoNoPago, setMotivoNoPago] = useState('');
    const [estadosSituacion, setEstadosSituacion] = useState<any>(null);
    const [estadosGestion, setEstadosGestion] = useState<any>(null);
    const [motivosNoPago, setMotivosNoPago] = useState<any[]>([]);
    const [cambiosPendientes, setCambiosPendientes] = useState(false);
    
    // Estado Pestañas centrales
    const [tabVal, setTabVal] = useState(0);

    // Convenios
    const [convenios, setConvenios] = useState<any[]>([]);
    const [loadingConvenios, setLoadingConvenios] = useState(false);
    const [openModalConvenio, setOpenModalConvenio] = useState(false);
    const [convenioTipo, setConvenioTipo] = useState<'AUTOMATICO' | 'LIBRE'>('AUTOMATICO');
    const [convenioForm, setConvenioForm] = useState({ montoTotal: '', cantCuotas: '', fechaInicio: '', observaciones: '' });
    const [cuotasLibres, setCuotasLibres] = useState<{ nroCuota: number; fechaVencimiento: string; importe: string }[]>([]);
    const [savingConvenio, setSavingConvenio] = useState(false);

    // Modal pago de cuota
    const [cuotaAPagar, setCuotaAPagar] = useState<any>(null);
    const [pagoForm, setPagoForm] = useState({ fecha: new Date().toISOString().split('T')[0], importe: '', observacion: '' });
    const [savingPago, setSavingPago] = useState(false);

    // Otras cuentas
    const [otrasCuentas, setOtrasCuentas] = useState<any[]>([]);
    const [loadingOtrasCuentas, setLoadingOtrasCuentas] = useState(false);

    // Modales y feedback
    const [openModalAgregar, setOpenModalAgregar] = useState(false);
    const [openModalConfirmar, setOpenModalConfirmar] = useState(false);
    const [contactoAEliminar, setContactoAEliminar] = useState<any>(null);

    const [nuevoContacto, setNuevoContacto] = useState({ tipo: '', valor: '' });
    const [tipoSeleccionado, setTipoSeleccionado] = useState<string>('');
    const [previewTel, setPreviewTel] = useState<PreviewTelefono | null>(null);
    const [previewEmail, setPreviewEmail] = useState<{ valido: boolean; normalizado?: string } | null>(null);
    const [previewDir, setPreviewDir] = useState<DireccionPreview | null>(null);
    const [validandoDir, setValidandoDir] = useState(false);
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
            setMotivoNoPago(deu.data.motivoNoPago?.clave || '');
            const es = await api.get(`/parametros?grupo=situacion&empresaId=${deu.data.empresaId}&activo=true`);
            setEstadosSituacion(es.data || []);
            const eg = await api.get(`/parametros?grupo=gestion&empresaId=${deu.data.empresaId}&activo=true`);
            setEstadosGestion(eg.data || []);
            const mnp = await api.get(`/parametros?grupo=motivo_no_pago&empresaId=${deu.data.empresaId}&activo=true`);
            setMotivosNoPago(mnp.data || []);
        } catch (e) {
            setSnackbar({ open: true, message: 'Error al cargar datos', severity: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const cargarConvenios = async () => {
        setLoadingConvenios(true);
        try {
            const res = await api.get(`/convenios?deudorId=${deudorId}`);
            setConvenios(res.data || []);
        } catch {
            // silencioso
        } finally {
            setLoadingConvenios(false);
        }
    };

    const cargarOtrasCuentas = async (documento: string) => {
        setLoadingOtrasCuentas(true);
        try {
            const res = await api.get(`/deudores/por-documento/${documento}?excludeId=${deudorId}`);
            setOtrasCuentas(res.data || []);
        } catch {
            // silencioso
        } finally {
            setLoadingOtrasCuentas(false);
        }
    };

    useEffect(() => {
        cargarInicial();
        cargarConvenios();
    }, [deudorId]);

    const handleTabChange = (_: any, val: number) => {
        setTabVal(val);
        if (val === 4 && deudor?.documento) {
            cargarOtrasCuentas(deudor.documento);
        }
    };

    const handleOpenModalAgregar = (tipo: string) => {
        setTipoSeleccionado(tipo);
        setNuevoContacto({ tipo, valor: '' });
        setNuevaDireccion({ calle: '', numero: '', cp: '', localidad: '', provincia: '' });
        setPreviewTel(null);
        setPreviewEmail(null);
        setPreviewDir(null);
        setValidandoDir(false);
        setOpenModalAgregar(true);
    };

    const handleChangeDireccion = (field: string, value: string) => {
        setNuevaDireccion(prev => ({ ...prev, [field]: value }));
        setPreviewDir(null);
    };

    const handleValidarDireccion = async () => {
        setValidandoDir(true);
        const textoBusqueda = `${nuevaDireccion.calle} ${nuevaDireccion.numero}, ${nuevaDireccion.localidad}, ${nuevaDireccion.provincia}`;
        const res = await validarDireccionArgentinaFront(textoBusqueda);
        setPreviewDir(res);
        setValidandoDir(false);
    };

    const handleEstadoChange = (type: 'situacion' | 'gestion' | 'motivoNoPago', value: string) => {
        if (type === 'situacion') setEstadoSituacion(value);
        else if (type === 'gestion') setEstadoGestion(value);
        else setMotivoNoPago(value);
        setCambiosPendientes(true);
    };

    const handleGuardarEstados = async () => {
        try {
            await api.put(`/deudores/${deudorId}`, {
                estadoSituacionClave: estadoSituacion,
                estadoGestionClave: estadoGestion,
                motivoNoPagoClave: motivoNoPago || undefined,
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

    // ── Convenios helpers ──────────────────────────────────────────────────────
    const calcCuotasAutomatico = () => {
        const monto = parseFloat(convenioForm.montoTotal) || 0;
        const cant = parseInt(convenioForm.cantCuotas) || 0;
        if (!monto || !cant || !convenioForm.fechaInicio) return [];
        const cuotaImporte = monto / cant;
        return Array.from({ length: cant }, (_, i) => {
            const fecha = new Date(convenioForm.fechaInicio);
            fecha.setDate(fecha.getDate() + 30 * i);
            return { nroCuota: i + 1, fechaVencimiento: fecha.toLocaleDateString('es-AR'), importe: cuotaImporte };
        });
    };

    const handleCantCuotasChange = (val: string) => {
        const cant = parseInt(val) || 0;
        setConvenioForm(f => ({ ...f, cantCuotas: val }));
        if (convenioTipo === 'LIBRE' && cant > 0) {
            setCuotasLibres(Array.from({ length: cant }, (_, i) => ({
                nroCuota: i + 1,
                fechaVencimiento: '',
                importe: '',
            })));
        }
    };

    const handleGuardarConvenio = async () => {
        setSavingConvenio(true);
        try {
            const payload: any = {
                deudorId,
                tipo: convenioTipo,
                montoTotal: parseFloat(convenioForm.montoTotal),
                cantCuotas: parseInt(convenioForm.cantCuotas),
                fechaInicio: convenioForm.fechaInicio,
                observaciones: convenioForm.observaciones || undefined,
            };
            if (convenioTipo === 'LIBRE') {
                payload.cuotas = cuotasLibres.map(c => ({
                    nroCuota: c.nroCuota,
                    fechaVencimiento: c.fechaVencimiento,
                    importe: parseFloat(c.importe),
                }));
            }
            await api.post('/convenios', payload);
            setSnackbar({ open: true, message: 'Convenio creado correctamente', severity: 'success' });
            setOpenModalConvenio(false);
            cargarConvenios();
        } catch (err: any) {
            setSnackbar({ open: true, message: err.response?.data?.message || 'Error al crear convenio', severity: 'error' });
        } finally {
            setSavingConvenio(false);
        }
    };

    const handleAnularConvenio = async (convenioId: number) => {
        try {
            await api.put(`/convenios/${convenioId}/anular`);
            setSnackbar({ open: true, message: 'Convenio anulado', severity: 'success' });
            cargarConvenios();
        } catch (err: any) {
            setSnackbar({ open: true, message: err.response?.data?.message || 'Error al anular convenio', severity: 'error' });
        }
    };

    const handleAbrirPagarCuota = (cuota: any) => {
        setCuotaAPagar(cuota);
        setPagoForm({
            fecha: new Date().toISOString().split('T')[0],
            importe: String(cuota.importe),
            observacion: '',
        });
    };

    const handleConfirmarPagoCuota = async () => {
        if (!cuotaAPagar) return;
        setSavingPago(true);
        try {
            await api.put(`/convenios/cuotas/${cuotaAPagar.id}/pagar`, {
                fecha: pagoForm.fecha,
                importe: parseFloat(pagoForm.importe),
                observacion: pagoForm.observacion || undefined,
            });
            setSnackbar({ open: true, message: 'Cuota pagada y pago registrado', severity: 'success' });
            setCuotaAPagar(null);
            cargarConvenios();
            cargarInicial(); // refresca la tab de pagos también
        } catch (err: any) {
            setSnackbar({ open: true, message: err.response?.data?.message || 'Error al registrar pago', severity: 'error' });
        } finally {
            setSavingPago(false);
        }
    };

    const estadoConvenioColor = (estado: string): 'success' | 'warning' | 'default' | 'error' => {
        if (estado === 'ACTIVO') return 'success';
        if (estado === 'INCUMPLIDO') return 'warning';
        if (estado === 'ANULADO') return 'error';
        return 'default';
    };

    const estadoCuotaColor = (estado: string): 'success' | 'warning' | 'default' | 'error' => {
        if (estado === 'PAGADA') return 'success';
        if (estado === 'VENCIDA') return 'error';
        if (estado === 'PENDIENTE') return 'warning';
        return 'default';
    };

    if (loading || !deudor) return (
        <Box display="flex" justifyContent="center" alignItems="center" height="200px">
            <CircularProgress />
        </Box>
    );

    const { nombre, apellido, documento, remesa, empresa, comentarios, contactos, facturas, pagos, campoExtras, camposAdicionales, montoTotal, fechaVencimiento } = deudor;

    // Deuda actualizada: montoTotal - suma de cuotas PAGADAS en convenios activos/finalizados
    const totalPagadoConvenios = convenios
        .filter(c => c.estado === 'ACTIVO' || c.estado === 'FINALIZADO')
        .flatMap((c: any) => c.cuotas || [])
        .filter((q: any) => q.estado === 'PAGADA')
        .reduce((sum: number, q: any) => sum + (q.importe || 0), 0);
    const deudaActualizada = (montoTotal || 0) - totalPagadoConvenios;
    const tieneConveniosPagados = totalPagadoConvenios > 0;

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
                            const isPhone = tipo === 'telefono' || tipo === 'whatsapp' || tipo === 'celular';
                            const label = isPhone ? formatearTelefonoParaUI(c.valor) : c.valor;
                            
                            // Visuals for validation
                            let chipColor = color;
                            let icon = undefined;
                            let tooltipTitle = "";

                            if (isPhone) {
                                if (c.validado) {
                                    icon = <CheckCircleIcon fontSize="small" />;
                                    tooltipTitle = "Número verificado";
                                    // Keep original color (primary/success) but it's verified
                                } else {
                                    icon = <ErrorOutlineIcon fontSize="small" />;
                                    chipColor = "error"; // Force error color for invalid ones
                                    tooltipTitle = "Formato inválido o dudoso";
                                }
                            }

                            return (
                                <Chip
                                    key={c.id}
                                    icon={icon}
                                    label={label}
                                    color={chipColor}
                                    variant={isPhone && !c.validado ? "filled" : "outlined"}
                                    title={tooltipTitle}
                                    onDelete={() => handleConfirmarEliminar(c)}
                                    size="small"
                                    sx={{ 
                                        mr: 1, 
                                        mb: 1, 
                                        fontWeight: 500,
                                        height: 'auto',
                                        maxWidth: '100%',
                                        '& .MuiChip-label': {
                                            display: 'block',
                                            whiteSpace: 'normal',
                                            paddingY: 0.5,
                                            wordBreak: 'break-word'
                                        }
                                    }}
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
            <Card elevation={3} sx={{ mb: 3, borderRadius: 3 }}>
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
                            {tieneConveniosPagados ? (
                                <>
                                    <Typography variant="overline" color="text.secondary" fontWeight="bold">DEUDA ACTUALIZADA</Typography>
                                    <Typography variant="h4" fontWeight="bold" color="success.main">
                                        ${deudaActualizada.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                                    </Typography>
                                    <Tooltip title="Deuda original informada por el cedente">
                                        <Typography variant="caption" color="text.disabled" display="block" sx={{ textDecoration: 'line-through', cursor: 'default' }}>
                                            Original: ${montoTotal?.toLocaleString('es-AR', { minimumFractionDigits: 2 }) || '0.00'}
                                        </Typography>
                                    </Tooltip>
                                    <Typography variant="caption" color="success.main" display="block">
                                        Pagado por convenios: -${totalPagadoConvenios.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                                    </Typography>
                                </>
                            ) : (
                                <>
                                    <Typography variant="overline" color="text.secondary" fontWeight="bold">DEUDA TOTAL</Typography>
                                    <Typography variant="h4" fontWeight="bold" color="text.primary">
                                        ${montoTotal?.toLocaleString('es-AR', { minimumFractionDigits: 2 }) || '0.00'}
                                    </Typography>
                                </>
                            )}
                            {(remesa?.fechaVencimiento || fechaVencimiento) && (
                                <Typography variant="caption" color="text.secondary" display="block">
                                    Vencimiento: {new Date(remesa?.fechaVencimiento || fechaVencimiento).toLocaleDateString()}
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
                                <Grid item xs={12} sm={4}>
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
                                <Grid item xs={12} sm={4}>
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
                                <Grid item xs={12} sm={4}>
                                    <TextField
                                        select
                                        fullWidth
                                        label="Motivo No Pago"
                                        size="small"
                                        value={motivoNoPago}
                                        onChange={(e) => handleEstadoChange('motivoNoPago', e.target.value)}
                                        variant="outlined"
                                    >
                                        <MenuItem value=""><em>Sin motivo</em></MenuItem>
                                        {motivosNoPago.map((p: any) => (
                                            <MenuItem key={p.id} value={p.clave}>
                                                {p.descripcion}
                                            </MenuItem>
                                        ))}
                                    </TextField>
                                </Grid>
                                <Grid item xs={12}>
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
                        <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.default' }}>
                            <Tabs
                                value={tabVal}
                                onChange={handleTabChange}
                                variant="scrollable"
                                scrollButtons="auto"
                                textColor="primary"
                                indicatorColor="primary"
                            >
                                <Tab icon={<ChatIcon fontSize="small"/>} iconPosition="start" label="Comentarios" />
                                <Tab icon={<ReceiptIcon fontSize="small"/>} iconPosition="start" label={`Facturas (${facturas?.length || 0})`} />
                                <Tab icon={<AccountBalanceWalletIcon fontSize="small"/>} iconPosition="start" label={`Pagos (${pagos?.length || 0})`} />
                                <Tab icon={<HandshakeIcon fontSize="small"/>} iconPosition="start" label={`Convenios (${convenios.length})`} />
                                <Tab icon={<PeopleAltIcon fontSize="small"/>} iconPosition="start" label="Otras Cuentas" />
                            </Tabs>
                        </Box>

                        {/* TAB 0 - COMENTARIOS */}
                        <TabPanel value={tabVal} index={0}>
                            <Box sx={{ px: 2, pb: 2 }}>
                                <ComentariosPanel
                                    deudorId={deudorId}
                                    comentarios={comentarios || []}
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
                                                    <TableCell sx={{ bgcolor: 'action.hover' }}>Factura</TableCell>
                                                    <TableCell sx={{ bgcolor: 'action.hover' }}>Emisión</TableCell>
                                                    <TableCell sx={{ bgcolor: 'action.hover' }}>Vencimiento</TableCell>
                                                    <TableCell align="right" sx={{ bgcolor: 'action.hover' }}>Importe</TableCell>
                                                    <TableCell sx={{ bgcolor: 'action.hover' }}>Estado</TableCell>
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
                                                    <TableCell sx={{ bgcolor: 'action.hover' }}>Fecha Pago</TableCell>
                                                    <TableCell sx={{ bgcolor: 'action.hover' }}>Origen</TableCell>
                                                    <TableCell sx={{ bgcolor: 'action.hover' }}>Observación</TableCell>
                                                    <TableCell align="right" sx={{ bgcolor: 'action.hover' }}>Importe</TableCell>
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

                        {/* TAB 3 - CONVENIOS */}
                        <TabPanel value={tabVal} index={3}>
                            <Box sx={{ px: 2, pb: 2 }}>
                                <Box display="flex" justifyContent="flex-end" mb={2}>
                                    <Button
                                        variant="contained"
                                        size="small"
                                        startIcon={<HandshakeIcon />}
                                        onClick={() => {
                                            setConvenioTipo('AUTOMATICO');
                                            setConvenioForm({ montoTotal: String(deudor.montoTotal || ''), cantCuotas: '', fechaInicio: '', observaciones: '' });
                                            setCuotasLibres([]);
                                            setOpenModalConvenio(true);
                                        }}
                                    >
                                        Nuevo Convenio
                                    </Button>
                                </Box>
                                {loadingConvenios ? (
                                    <Box display="flex" justifyContent="center" py={4}><CircularProgress size={24} /></Box>
                                ) : convenios.length === 0 ? (
                                    <Typography variant="body2" color="text.secondary" align="center" fontStyle="italic" py={4}>
                                        No hay convenios registrados para este deudor.
                                    </Typography>
                                ) : (
                                    convenios.map((conv: any) => (
                                        <Accordion key={conv.id} sx={{ mb: 1 }} elevation={1}>
                                            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                                <Stack direction="row" spacing={2} alignItems="center" width="100%">
                                                    <Chip label={conv.estado} color={estadoConvenioColor(conv.estado)} size="small" />
                                                    <Chip label={conv.tipo} variant="outlined" size="small" />
                                                    <Typography variant="body2" fontWeight="bold">
                                                        ${conv.montoTotal?.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                                                    </Typography>
                                                    <Typography variant="body2" color="text.secondary">
                                                        {conv.cantCuotas} cuotas de ${conv.montoCuota?.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                                                    </Typography>
                                                    <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                                                        {new Date(conv.fechaInicio).toLocaleDateString('es-AR')}
                                                    </Typography>
                                                </Stack>
                                            </AccordionSummary>
                                            <AccordionDetails>
                                                {conv.observaciones && (
                                                    <Typography variant="body2" color="text.secondary" mb={2} fontStyle="italic">
                                                        {conv.observaciones}
                                                    </Typography>
                                                )}
                                                <TableContainer>
                                                    <Table size="small">
                                                        <TableHead>
                                                            <TableRow>
                                                                <TableCell sx={{ bgcolor: 'action.hover' }}>#</TableCell>
                                                                <TableCell sx={{ bgcolor: 'action.hover' }}>Vencimiento</TableCell>
                                                                <TableCell align="right" sx={{ bgcolor: 'action.hover' }}>Importe</TableCell>
                                                                <TableCell sx={{ bgcolor: 'action.hover' }}>Estado</TableCell>
                                                                <TableCell sx={{ bgcolor: 'action.hover' }}>Fecha Pago</TableCell>
                                                                <TableCell sx={{ bgcolor: 'action.hover' }}></TableCell>
                                                            </TableRow>
                                                        </TableHead>
                                                        <TableBody>
                                                            {conv.cuotas?.map((cuota: any) => (
                                                                <TableRow key={cuota.id} hover>
                                                                    <TableCell>{cuota.nroCuota}</TableCell>
                                                                    <TableCell>{new Date(cuota.fechaVencimiento).toLocaleDateString('es-AR')}</TableCell>
                                                                    <TableCell align="right">${cuota.importe?.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</TableCell>
                                                                    <TableCell>
                                                                        <Chip label={cuota.estado} color={estadoCuotaColor(cuota.estado)} size="small" variant="outlined" />
                                                                    </TableCell>
                                                                    <TableCell>{cuota.fechaPago ? new Date(cuota.fechaPago).toLocaleDateString('es-AR') : '-'}</TableCell>
                                                                    <TableCell>
                                                                        {cuota.estado === 'PENDIENTE' && conv.estado === 'ACTIVO' && (
                                                                            <Tooltip title="Registrar pago">
                                                                                <IconButton size="small" color="success" onClick={() => handleAbrirPagarCuota(cuota)}>
                                                                                    <PaymentIcon fontSize="small" />
                                                                                </IconButton>
                                                                            </Tooltip>
                                                                        )}
                                                                    </TableCell>
                                                                </TableRow>
                                                            ))}
                                                        </TableBody>
                                                    </Table>
                                                </TableContainer>
                                                {conv.estado === 'ACTIVO' && (
                                                    <Box display="flex" justifyContent="flex-end" mt={1}>
                                                        <Button
                                                            size="small"
                                                            color="error"
                                                            startIcon={<BlockIcon />}
                                                            onClick={() => handleAnularConvenio(conv.id)}
                                                        >
                                                            Anular convenio
                                                        </Button>
                                                    </Box>
                                                )}
                                            </AccordionDetails>
                                        </Accordion>
                                    ))
                                )}
                            </Box>
                        </TabPanel>

                        {/* TAB 4 - OTRAS CUENTAS */}
                        <TabPanel value={tabVal} index={4}>
                            <Box sx={{ px: 2, pb: 2 }}>
                                {loadingOtrasCuentas ? (
                                    <Box display="flex" justifyContent="center" py={4}><CircularProgress size={24} /></Box>
                                ) : otrasCuentas.length === 0 ? (
                                    <Typography variant="body2" color="text.secondary" align="center" fontStyle="italic" py={4}>
                                        Este deudor no tiene otras cuentas registradas.
                                    </Typography>
                                ) : (
                                    <TableContainer>
                                        <Table size="small">
                                            <TableHead>
                                                <TableRow>
                                                    <TableCell sx={{ bgcolor: 'action.hover' }}>Empresa</TableCell>
                                                    <TableCell sx={{ bgcolor: 'action.hover' }}>Remesa</TableCell>
                                                    <TableCell align="right" sx={{ bgcolor: 'action.hover' }}>Deuda</TableCell>
                                                    <TableCell sx={{ bgcolor: 'action.hover' }}>Situación</TableCell>
                                                    <TableCell sx={{ bgcolor: 'action.hover' }}>Gestión</TableCell>
                                                </TableRow>
                                            </TableHead>
                                            <TableBody>
                                                {otrasCuentas.map((oc: any) => (
                                                    <TableRow key={oc.id} hover>
                                                        <TableCell>{oc.empresa?.nombre || '-'}</TableCell>
                                                        <TableCell>{oc.remesa?.numeroRemesa || '-'}</TableCell>
                                                        <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                                                            ${oc.montoTotal?.toLocaleString('es-AR', { minimumFractionDigits: 2 }) || '0.00'}
                                                        </TableCell>
                                                        <TableCell>
                                                            <Chip label={oc.estadoSituacion?.descripcion || '-'} size="small" variant="outlined" />
                                                        </TableCell>
                                                        <TableCell>
                                                            <Chip label={oc.estadoGestion?.descripcion || '-'} size="small" variant="outlined" />
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </TableContainer>
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
                                    <TextField label="Calle" fullWidth value={nuevaDireccion.calle} onChange={(e) => handleChangeDireccion('calle', e.target.value)} />
                                </Grid>
                                <Grid item xs={12} sm={3}>
                                    <TextField label="Número" fullWidth value={nuevaDireccion.numero} onChange={(e) => handleChangeDireccion('numero', e.target.value)} />
                                </Grid>
                                <Grid item xs={12} sm={3}>
                                    <TextField label="Código Postal" fullWidth value={nuevaDireccion.cp} onChange={(e) => handleChangeDireccion('cp', e.target.value)} />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <TextField label="Localidad" fullWidth value={nuevaDireccion.localidad} onChange={(e) => handleChangeDireccion('localidad', e.target.value)} />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <TextField label="Provincia" fullWidth value={nuevaDireccion.provincia} onChange={(e) => handleChangeDireccion('provincia', e.target.value)} />
                                </Grid>
                            </Grid>
                            
                            <Box sx={{ mt: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <Button 
                                    variant="outlined" 
                                    color="info" 
                                    startIcon={validandoDir ? <CircularProgress size={20} /> : <SearchIcon />}
                                    onClick={handleValidarDireccion}
                                    disabled={validandoDir || !nuevaDireccion.calle || !nuevaDireccion.numero || !nuevaDireccion.localidad || !nuevaDireccion.provincia}
                                >
                                    {validandoDir ? 'Validando con Georef...' : 'Validar Dirección'}
                                </Button>

                                {previewDir && (
                                    <Alert 
                                        severity={previewDir.valido ? "success" : "warning"} 
                                        icon={previewDir.valido ? <CheckCircleIcon /> : <ReportProblemIcon />}
                                    >
                                        {previewDir.valido 
                                            ? `Ubicación encontrada: ${previewDir.normalizada} (${previewDir.localidad}, ${previewDir.provincia})`
                                            : `No encontrada en Georef. Podés guardarla igual bajo tu confirmación manual.`}
                                    </Alert>
                                )}
                            </Box>
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
                                const dirFormateada = previewDir?.valido 
                                    ? `${previewDir.normalizada}, ${previewDir.localidad || nuevaDireccion.localidad}, ${previewDir.provincia || nuevaDireccion.provincia} (CP ${nuevaDireccion.cp || '-'})`
                                    : `${nuevaDireccion.calle} ${nuevaDireccion.numero}, ${nuevaDireccion.localidad}, ${nuevaDireccion.provincia} (CP ${nuevaDireccion.cp || '-'})`;
                                
                                await api.post('/contactos', { tipo: 'direccion', valor: dirFormateada, deudorId });
                                setSnackbar({ open: true, message: previewDir?.valido ? 'Dirección validada y guardada correctamente' : 'Dirección guardada manualmente', severity: 'success' });
                                await cargarInicial();
                                setOpenModalAgregar(false);
                            } else {
                                handleAgregarContacto();
                            }
                        }}
                        disabled={
                            tipoSeleccionado === 'direccion'
                                ? (!previewDir) // Solo habilita si hay un previewDir
                                : tipoSeleccionado === 'telefono' || tipoSeleccionado === 'whatsapp' ? !previewTel?.valido
                                    : tipoSeleccionado === 'email' ? !previewEmail?.valido : !nuevoContacto.valor?.trim()
                        }
                    >
                        Guardar
                    </Button>
                </DialogActions>
            </Dialog>

            {/* MODAL NUEVO CONVENIO */}
            <Dialog open={openModalConvenio} onClose={() => setOpenModalConvenio(false)} fullWidth maxWidth="md">
                <DialogTitle>Nuevo Convenio</DialogTitle>
                <DialogContent>
                    <Grid container spacing={2} sx={{ mt: 0.5 }}>
                        <Grid item xs={12} sm={6}>
                            <TextField
                                select fullWidth label="Tipo de convenio" size="small"
                                value={convenioTipo}
                                onChange={e => { setConvenioTipo(e.target.value as any); setCuotasLibres([]); }}
                            >
                                <MenuItem value="AUTOMATICO">Automático</MenuItem>
                                <MenuItem value="LIBRE">Libre</MenuItem>
                            </TextField>
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField
                                fullWidth label="Monto total ($)" size="small" type="number"
                                value={convenioForm.montoTotal}
                                onChange={e => setConvenioForm(f => ({ ...f, montoTotal: e.target.value }))}
                            />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField
                                fullWidth label="Cantidad de cuotas" size="small" type="number"
                                value={convenioForm.cantCuotas}
                                onChange={e => handleCantCuotasChange(e.target.value)}
                            />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField
                                fullWidth label="Fecha primer vencimiento" size="small" type="date"
                                InputLabelProps={{ shrink: true }}
                                value={convenioForm.fechaInicio}
                                onChange={e => setConvenioForm(f => ({ ...f, fechaInicio: e.target.value }))}
                            />
                        </Grid>
                        <Grid item xs={12}>
                            <TextField
                                fullWidth label="Observaciones" size="small" multiline rows={2}
                                value={convenioForm.observaciones}
                                onChange={e => setConvenioForm(f => ({ ...f, observaciones: e.target.value }))}
                            />
                        </Grid>
                    </Grid>

                    {/* Preview automático */}
                    {convenioTipo === 'AUTOMATICO' && convenioForm.montoTotal && convenioForm.cantCuotas && convenioForm.fechaInicio && (
                        <Box mt={2}>
                            <Typography variant="subtitle2" fontWeight="bold" mb={1}>Preview de cuotas:</Typography>
                            <TableContainer sx={{ maxHeight: 200 }}>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell sx={{ bgcolor: 'action.hover' }}>#</TableCell>
                                            <TableCell sx={{ bgcolor: 'action.hover' }}>Vencimiento</TableCell>
                                            <TableCell align="right" sx={{ bgcolor: 'action.hover' }}>Importe</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {calcCuotasAutomatico().map(c => (
                                            <TableRow key={c.nroCuota}>
                                                <TableCell>{c.nroCuota}</TableCell>
                                                <TableCell>{c.fechaVencimiento}</TableCell>
                                                <TableCell align="right">${c.importe.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        </Box>
                    )}

                    {/* Cuotas libres */}
                    {convenioTipo === 'LIBRE' && cuotasLibres.length > 0 && (
                        <Box mt={2}>
                            <Typography variant="subtitle2" fontWeight="bold" mb={1}>Cargá cada cuota:</Typography>
                            <TableContainer sx={{ maxHeight: 250 }}>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell sx={{ bgcolor: 'action.hover' }}>#</TableCell>
                                            <TableCell sx={{ bgcolor: 'action.hover' }}>Vencimiento</TableCell>
                                            <TableCell sx={{ bgcolor: 'action.hover' }}>Importe ($)</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {cuotasLibres.map((c, i) => (
                                            <TableRow key={c.nroCuota}>
                                                <TableCell>{c.nroCuota}</TableCell>
                                                <TableCell>
                                                    <TextField
                                                        type="date" size="small" value={c.fechaVencimiento}
                                                        onChange={e => setCuotasLibres(prev => prev.map((x, j) => j === i ? { ...x, fechaVencimiento: e.target.value } : x))}
                                                        InputLabelProps={{ shrink: true }}
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    <TextField
                                                        type="number" size="small" value={c.importe}
                                                        onChange={e => setCuotasLibres(prev => prev.map((x, j) => j === i ? { ...x, importe: e.target.value } : x))}
                                                    />
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        </Box>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOpenModalConvenio(false)}>Cancelar</Button>
                    <Button
                        variant="contained"
                        onClick={handleGuardarConvenio}
                        disabled={
                            savingConvenio ||
                            !convenioForm.montoTotal || !convenioForm.cantCuotas || !convenioForm.fechaInicio ||
                            (convenioTipo === 'LIBRE' && (cuotasLibres.length === 0 || cuotasLibres.some(c => !c.fechaVencimiento || !c.importe)))
                        }
                    >
                        {savingConvenio ? 'Guardando...' : 'Guardar Convenio'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* MODAL PAGO DE CUOTA */}
            <Dialog open={!!cuotaAPagar} onClose={() => setCuotaAPagar(null)} maxWidth="xs" fullWidth>
                <DialogTitle>Registrar pago — Cuota {cuotaAPagar?.nroCuota}</DialogTitle>
                <DialogContent>
                    <Box display="flex" flexDirection="column" gap={2} mt={1}>
                        <TextField
                            label="Fecha de pago" type="date" size="small" fullWidth
                            InputLabelProps={{ shrink: true }}
                            value={pagoForm.fecha}
                            onChange={e => setPagoForm(f => ({ ...f, fecha: e.target.value }))}
                        />
                        <TextField
                            label="Importe pagado ($)" type="number" size="small" fullWidth
                            value={pagoForm.importe}
                            onChange={e => setPagoForm(f => ({ ...f, importe: e.target.value }))}
                        />
                        <TextField
                            label="Observación (opcional)" size="small" fullWidth
                            value={pagoForm.observacion}
                            onChange={e => setPagoForm(f => ({ ...f, observacion: e.target.value }))}
                        />
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setCuotaAPagar(null)}>Cancelar</Button>
                    <Button
                        variant="contained"
                        color="success"
                        onClick={handleConfirmarPagoCuota}
                        disabled={savingPago || !pagoForm.fecha || !pagoForm.importe}
                    >
                        {savingPago ? 'Registrando...' : 'Confirmar Pago'}
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