import React, { useEffect, useState } from 'react';
import { Box, Grid, Typography, Paper, Divider, CircularProgress, Chip, Avatar, Button, TextField, MenuItem } from '@mui/material';
import EmailIcon from '@mui/icons-material/Email';
import PhoneIcon from '@mui/icons-material/Phone';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import CommentIcon from '@mui/icons-material/Comment';
import LanguageIcon from '@mui/icons-material/Language';
import HomeIcon from '@mui/icons-material/Home';
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
            //setFeedback({ open: true, type: 'error', message: 'No se pudieron cargar las sesiones' });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        cargarInicial()
    }, [deudorId]);

    if (loading || !deudor) return <CircularProgress />;

    const { nombre, apellido, documento, remesa, empresa, comentarios, contactos, camposAdicionales, montoTotal, fechaVencimiento } = deudor;

    return (
        <Box>
            <Typography variant="h5" gutterBottom fontWeight="bold">
                Ficha del Deudor
            </Typography>

            <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 4 }}>
                <Grid container spacing={2}>
                    <Grid item xs={12} sm={6}>
                        <Typography variant="subtitle2" fontWeight="bold">Nombre</Typography>
                        <Typography>{nombre} {apellido}</Typography>

                        <Typography variant="subtitle2" fontWeight="bold" mt={2}>DNI / CUIL</Typography>
                        <Typography>{documento}</Typography>

                        <Typography variant="subtitle2" fontWeight="bold" mt={2}>Remesa</Typography>
                        <Typography>{remesa?.numeroRemesa || '-'}</Typography>

                        <Typography variant="subtitle2" fontWeight="bold" mt={2}>Empresa</Typography>
                        <Typography>{empresa?.nombre || '-'}</Typography>

                        <Typography variant="subtitle2" fontWeight="bold" mt={2}>Redes Sociales</Typography>
                        {contactos?.some((c: any) => c.tipo === 'direccion') ? (
                            contactos.filter((c: any) => c.tipo === 'direccion').map((c: any) => (
                                <Chip key={c.id} icon={<HomeIcon />} label={c.valor} sx={{ mr: 1, mt: 1 }} />
                            ))
                        ) : (
                            <Chip label="Sin direcciones" variant="outlined" color="info" sx={{ mt: 1 }} />
                        )}

                        <Typography variant="subtitle2" fontWeight="bold" mt={2}>Deuda histórica</Typography>
                        <Typography>${montoTotal?.toFixed(2) || '0.00'}</Typography>
                        <Grid container spacing={2}>
                            <Grid item xs={12} sm={6} xl={6}>
                                <Typography variant="subtitle2" fontWeight="bold" mt={2}>Estado de Situación</Typography>
                                <TextField
                                    select
                                    size="small"
                                    fullWidth
                                    value={estadoSituacion}
                                    onChange={(e) => setEstadoSituacion(e.target.value)}
                                    sx={{ mt: 1 }}
                                >
                                    {estadosSituacion.map((estado: any) => (
                                        <MenuItem key={estado.clave} value={estado.clave}>
                                            {estado.descripcion}
                                        </MenuItem>
                                    ))}
                                </TextField>
                            </Grid>
                            <Grid item xs={12} sm={6} xl={6}>
                                <Typography variant="subtitle2" fontWeight="bold" mt={2}>Estado de Gestión</Typography>
                                <TextField
                                    select
                                    size="small"
                                    fullWidth
                                    value={estadoGestion}
                                    onChange={(e) => setEstadoGestion(e.target.value)}
                                    sx={{ mt: 1 }}
                                >
                                    {estadosGestion.map((estado: any) => (
                                        <MenuItem key={estado.clave} value={estado.clave}>
                                            {estado.descripcion}
                                        </MenuItem>
                                    ))}
                                </TextField>
                            </Grid>
                        </Grid>
                    </Grid>

                    <Grid item xs={12} sm={6}>
                        <Typography variant="subtitle2" fontWeight="bold">Teléfonos</Typography>
                        {contactos?.some((c: any) => c.tipo === 'telefono') ? (
                            contactos
                                .filter((c: any) => c.tipo === 'telefono')
                                .map((c: any) => (
                                    <Chip key={c.id} icon={<PhoneIcon />} label={c.valor} sx={{ mr: 1, mt: 1 }} />
                                ))
                        ) : (
                            <Chip label="Sin teléfonos" variant="outlined" color="info" sx={{ mt: 1 }} />
                        )}

                        <Typography variant="subtitle2" fontWeight="bold" mt={2}>Emails</Typography>
                        {contactos?.some((c: any) => c.tipo === 'email') ? (
                            contactos.filter((c: any) => c.tipo === 'email').map((c: any) => (
                                <Chip key={c.id} icon={<EmailIcon />} label={c.valor} sx={{ mr: 1, mt: 1 }} />
                            ))
                        ) : (
                            <Chip label="Sin emails" variant="outlined" color="info" sx={{ mt: 1 }} />
                        )}

                        <Typography variant="subtitle2" fontWeight="bold" mt={2}>WhatsApp</Typography>
                        {contactos?.some((c: any) => c.tipo === 'whatsapp') ? (
                            contactos.filter((c: any) => c.tipo === 'whatsapp').map((c: any) => (
                                <Chip key={c.id} icon={<WhatsAppIcon />} label={c.valor} sx={{ mr: 1, mt: 1 }} color="success" />
                            ))
                        ) : (
                            <Chip label="Sin WhatsApp" variant="outlined" color="success" sx={{ mt: 1 }} />
                        )}

                        <Typography variant="subtitle2" fontWeight="bold" mt={2}>Redes Sociales</Typography>
                        {contactos?.some((c: any) => c.tipo === 'red_social') ? (
                            contactos.filter((c: any) => c.tipo === 'red_social').map((c: any) => (
                                <Chip key={c.id} icon={<LanguageIcon />} label={c.valor} sx={{ mr: 1, mt: 1 }} />
                            ))
                        ) : (
                            <Chip label="Sin redes sociales" variant="outlined" color="info" sx={{ mt: 1 }} />
                        )}

                        <Typography variant="subtitle2" fontWeight="bold" mt={2}>Fecha de Vencimiento</Typography>
                        <Typography>{fechaVencimiento ? new Date(fechaVencimiento).toLocaleDateString() : '-'}</Typography>
                    </Grid>
                </Grid>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 4 }}>
                <Typography variant="h6" gutterBottom>
                    Comentarios
                </Typography>
                {comentarios?.length === 0 && <Typography>No hay comentarios.</Typography>}
                {comentarios?.map((c: any) => (
                    <Box key={c.id} sx={{ mb: 1 }}>
                        <Typography variant="body2" color="text.secondary">
                            {new Date(c.fecha).toLocaleString()} - {c.usuario?.nombre || 'Usuario desconocido'} ({c.origen || 'origen no especificado'})
                        </Typography>
                        <Typography variant="body1">{c.texto}</Typography>
                        <Divider sx={{ my: 1 }} />
                    </Box>
                ))}
            </Paper>

            <Paper variant="outlined" sx={{ p: 2, borderRadius: 4 }}>
                <Typography variant="h6" gutterBottom>
                    Datos Adicionales
                </Typography>
                {Object.entries(camposAdicionales || {}).map(([k, v]) => (
                    <Typography key={k}><strong>{k}:</strong> {String(v)}</Typography>
                ))}
            </Paper>
        </Box>
    );
};

export default FichaDeudor;