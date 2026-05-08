import React, { useMemo } from 'react';
import {
    Box,
    Card,
    CardContent,
    CardHeader,
    Chip,
    Divider,
    Grid,
    IconButton,
    Stack,
    Typography,
} from '@mui/material';
import EmailIcon from '@mui/icons-material/Email';
import PhoneIcon from '@mui/icons-material/Phone';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import LanguageIcon from '@mui/icons-material/Language';
import HomeIcon from '@mui/icons-material/Home';
import InfoIcon from '@mui/icons-material/Info';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { formatearTelefonoParaUI } from '../../../utils/phone';

interface Props {
    contactos: any[];
    campoExtras: any[];
    camposAdicionales: Record<string, any>;
    onAgregar: (tipo: string) => void;
    onEliminar: (contacto: any) => void;
}

const FichaContactosPanel: React.FC<Props> = ({
    contactos,
    campoExtras,
    camposAdicionales,
    onAgregar,
    onEliminar,
}) => {
    const hasExtras = useMemo(
        () =>
            (campoExtras && campoExtras.length > 0) ||
            (camposAdicionales && Object.keys(camposAdicionales).length > 0),
        [campoExtras, camposAdicionales],
    );

    const renderContactosList = (
        tipo: string,
        icono: React.ReactElement,
        color: 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' = 'default',
    ) => {
        const contactosFiltrados = contactos?.filter((c: any) => c.tipo === tipo) || [];

        return (
            <Box mb={2}>
                <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                    {React.cloneElement(icono, { color: 'action', fontSize: 'small' })}
                    <Typography
                        variant="subtitle2"
                        sx={{ textTransform: 'capitalize', fontWeight: 'bold', color: 'text.secondary' }}
                    >
                        {tipo === 'red_social'
                            ? 'Redes Sociales'
                            : tipo === 'direccion'
                              ? 'Direcciones'
                              : tipo + 's'}
                    </Typography>
                    <IconButton size="small" color="primary" onClick={() => onAgregar(tipo)} sx={{ ml: 'auto' }}>
                        <AddCircleOutlineIcon fontSize="small" />
                    </IconButton>
                </Stack>
                <Box>
                    {contactosFiltrados.length === 0 ? (
                        <Typography variant="body2" color="text.disabled" fontStyle="italic">
                            No hay registros
                        </Typography>
                    ) : (
                        contactosFiltrados.map((c: any) => {
                            const isPhone = tipo === 'telefono' || tipo === 'whatsapp' || tipo === 'celular';
                            const label = isPhone ? formatearTelefonoParaUI(c.valor) : c.valor;

                            let chipColor = color;
                            let icon: React.ReactElement | undefined = undefined;
                            let tooltipTitle = '';

                            if (isPhone) {
                                if (c.validado) {
                                    icon = <CheckCircleIcon fontSize="small" />;
                                    tooltipTitle = 'Número verificado';
                                } else {
                                    icon = <ErrorOutlineIcon fontSize="small" />;
                                    chipColor = 'error';
                                    tooltipTitle = 'Formato inválido o dudoso';
                                }
                            }

                            return (
                                <Chip
                                    key={c.id}
                                    icon={icon}
                                    label={label}
                                    color={chipColor}
                                    variant={isPhone && !c.validado ? 'filled' : 'outlined'}
                                    title={tooltipTitle}
                                    onDelete={() => onEliminar(c)}
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
                                            wordBreak: 'break-word',
                                        },
                                    }}
                                />
                            );
                        })
                    )}
                </Box>
            </Box>
        );
    };

    return (
        <>
            <Card elevation={2} sx={{ mb: 3, borderRadius: 3 }}>
                <CardHeader
                    title="Información de Contacto"
                    titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                />
                <Divider sx={{ mb: 2 }} />
                <CardContent sx={{ pt: 0 }}>
                    {renderContactosList('telefono', <PhoneIcon />, 'primary')}
                    {renderContactosList('whatsapp', <WhatsAppIcon />, 'success')}
                    {renderContactosList('email', <EmailIcon />, 'default')}
                    {renderContactosList('direccion', <HomeIcon />, 'default')}
                    {renderContactosList('red_social', <LanguageIcon />, 'info')}
                </CardContent>
            </Card>

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
                            {camposAdicionales &&
                                Object.keys(camposAdicionales).map((key) => {
                                    const valor = camposAdicionales[key];
                                    if (!valor) return null;
                                    return (
                                        <Grid item xs={6} key={key}>
                                            <Typography
                                                variant="caption"
                                                color="text.secondary"
                                                sx={{ textTransform: 'uppercase', display: 'block' }}
                                            >
                                                {key.replace(/_/g, ' ')}
                                            </Typography>
                                            <Typography variant="body2" fontWeight="500">
                                                {typeof valor === 'object' ? JSON.stringify(valor) : valor}
                                            </Typography>
                                        </Grid>
                                    );
                                })}
                            {campoExtras &&
                                campoExtras.map((extra: any) => (
                                    <Grid item xs={6} key={extra.id}>
                                        <Typography
                                            variant="caption"
                                            color="text.secondary"
                                            sx={{ textTransform: 'uppercase', display: 'block' }}
                                        >
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
        </>
    );
};

export default FichaContactosPanel;
