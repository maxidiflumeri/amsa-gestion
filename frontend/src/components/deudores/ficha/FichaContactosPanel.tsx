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
    Tooltip,
    Typography,
    useTheme,
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
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import SendIcon from '@mui/icons-material/Send';
import { formatearTelefonoParaUI } from '../../../utils/phone';
import { useNotify } from '../../../hooks/useNotify';

interface Props {
    contactos: any[];
    campoExtras: any[];
    camposAdicionales: Record<string, any>;
    onAgregar: (tipo: string) => void;
    onEliminar: (contacto: any) => void;
    onToggleWhatsapp?: (contacto: any) => void;
    onMarcarPrincipal?: (contacto: any) => void;
    onEnviarEmail?: (contacto: any) => void;
    puedeEnviarEmail?: boolean;
    disabled?: boolean;
}

const TOOLTIP_CANCELADA = 'Cuenta cancelada — no se puede modificar';

const FichaContactosPanel: React.FC<Props> = ({
    contactos,
    campoExtras,
    camposAdicionales,
    onAgregar,
    onEliminar,
    onToggleWhatsapp,
    onMarcarPrincipal,
    onEnviarEmail,
    puedeEnviarEmail,
    disabled = false,
}) => {
    const notify = useNotify();
    const theme = useTheme();

    const handleCopy = async (texto: string) => {
        try {
            await navigator.clipboard.writeText(texto);
            notify.success('Copiado al portapapeles');
        } catch {
            notify.error('No se pudo copiar');
        }
    };

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
                    <Tooltip title={disabled ? TOOLTIP_CANCELADA : 'Agregar'} disableHoverListener={!disabled}>
                        <span style={{ marginLeft: 'auto' }}>
                            <IconButton
                                size="small"
                                color="primary"
                                onClick={() => onAgregar(tipo)}
                                disabled={disabled}
                            >
                                <AddCircleOutlineIcon fontSize="small" />
                            </IconButton>
                        </span>
                    </Tooltip>
                </Stack>
                <Box>
                    {contactosFiltrados.length === 0 ? (
                        <Typography variant="body2" color="text.disabled" fontStyle="italic">
                            No hay registros
                        </Typography>
                    ) : (
                        contactosFiltrados.map((c: any) => (
                            <Chip
                                key={c.id}
                                label={
                                    <Stack direction="row" alignItems="center" spacing={0.25}>
                                        <Box component="span" sx={{ mr: 0.5 }}>{c.valor}</Box>
                                        <Tooltip title="Copiar al portapapeles">
                                            <IconButton
                                                size="small"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleCopy(c.valor);
                                                }}
                                                sx={{ p: 0.25 }}
                                            >
                                                <ContentCopyIcon sx={{ fontSize: 16 }} />
                                            </IconButton>
                                        </Tooltip>
                                        {tipo === 'email' && puedeEnviarEmail && onEnviarEmail && (
                                            <Tooltip title="Enviar email">
                                                <IconButton
                                                    size="small"
                                                    color="primary"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onEnviarEmail(c);
                                                    }}
                                                    sx={{ p: 0.25 }}
                                                >
                                                    <SendIcon sx={{ fontSize: 16 }} />
                                                </IconButton>
                                            </Tooltip>
                                        )}
                                    </Stack>
                                }
                                color={color}
                                variant="outlined"
                                onDelete={disabled ? undefined : () => onEliminar(c)}
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
                        ))
                    )}
                </Box>
            </Box>
        );
    };

    const renderTelefonos = () => {
        const telefonos = (contactos?.filter((c: any) => c.tipo === 'telefono' || c.tipo === 'whatsapp') || [])
            .slice()
            .sort((a: any, b: any) => {
                const pa = a.prioridad === 1 ? 0 : 1;
                const pb = b.prioridad === 1 ? 0 : 1;
                if (pa !== pb) return pa - pb;
                return (a.id ?? 0) - (b.id ?? 0);
            });

        return (
            <Box mb={2}>
                <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                    <PhoneIcon color="action" fontSize="small" />
                    <Typography
                        variant="subtitle2"
                        sx={{ fontWeight: 'bold', color: 'text.secondary' }}
                    >
                        Telefonos
                    </Typography>
                    <Tooltip title={disabled ? TOOLTIP_CANCELADA : 'Agregar telefono'} disableHoverListener={!disabled}>
                        <span style={{ marginLeft: 'auto' }}>
                            <IconButton
                                size="small"
                                color="primary"
                                onClick={() => onAgregar('telefono')}
                                disabled={disabled}
                            >
                                <AddCircleOutlineIcon fontSize="small" />
                            </IconButton>
                        </span>
                    </Tooltip>
                </Stack>
                <Box>
                    {telefonos.length === 0 ? (
                        <Typography variant="body2" color="text.disabled" fontStyle="italic">
                            No hay registros
                        </Typography>
                    ) : (
                        telefonos.map((c: any) => {
                            const label = formatearTelefonoParaUI(c.valor);
                            const esWhatsapp = c.whatsapp === true || c.tipo === 'whatsapp';
                            const esPrincipal = c.prioridad === 1;
                            const esAmbos = esWhatsapp && esPrincipal;
                            const validado = c.validado;
                            // El backend clasifica móvil/fijo con los rangos de ENACOM y lo guarda en subtipo.
                            // Solo deshabilitamos cuando es fijo confirmado; ante la duda dejamos marcar (el backend valida).
                            const esFijo = c.subtipo === 'FIXED_LINE';
                            const bloquearWhatsapp = esFijo && !esWhatsapp;
                            const chipColor: any = esPrincipal
                                ? 'warning'
                                : esWhatsapp
                                  ? 'success'
                                  : validado
                                    ? 'primary'
                                    : 'error';
                            const chipVariant: 'outlined' | 'filled' =
                                esPrincipal || esWhatsapp || !validado ? 'filled' : 'outlined';
                            const iconBtnColor = esPrincipal || esWhatsapp ? 'common.white' : undefined;
                            const validIcon = validado
                                ? <CheckCircleIcon fontSize="small" />
                                : <ErrorOutlineIcon fontSize="small" />;
                            const validTooltip = validado ? 'Número verificado' : 'Formato inválido o dudoso';

                            const stopAnd = (fn: () => void) => (e: React.MouseEvent) => {
                                e.stopPropagation();
                                fn();
                            };

                            return (
                                <Chip
                                    key={c.id}
                                    icon={validIcon}
                                    label={
                                        <Stack direction="row" alignItems="center" spacing={0.25}>
                                            <Box component="span" sx={{ mr: 0.5 }}>{label}</Box>
                                            <Tooltip title={disabled ? TOOLTIP_CANCELADA : esPrincipal ? 'Quitar como principal' : 'Marcar como principal'}>
                                                <span>
                                                    <IconButton
                                                        size="small"
                                                        disabled={disabled}
                                                        onClick={stopAnd(() => onMarcarPrincipal?.(c))}
                                                        sx={{ p: 0.25, color: iconBtnColor ?? 'warning.main' }}
                                                    >
                                                        {esPrincipal
                                                            ? <StarIcon sx={{ fontSize: 16 }} />
                                                            : <StarBorderIcon sx={{ fontSize: 16 }} />}
                                                    </IconButton>
                                                </span>
                                            </Tooltip>
                                            <Tooltip title={
                                                disabled
                                                    ? TOOLTIP_CANCELADA
                                                    : bloquearWhatsapp
                                                      ? 'No se puede usar WhatsApp en un telefono fijo'
                                                      : esWhatsapp ? 'Quitar WhatsApp' : 'Marcar como WhatsApp'
                                            }>
                                                <span>
                                                    <IconButton
                                                        size="small"
                                                        disabled={bloquearWhatsapp || disabled}
                                                        onClick={stopAnd(() => onToggleWhatsapp?.(c))}
                                                        sx={{ p: 0.25, color: iconBtnColor ?? 'success.main' }}
                                                    >
                                                        <WhatsAppIcon sx={{ fontSize: 16 }} />
                                                    </IconButton>
                                                </span>
                                            </Tooltip>
                                            <Tooltip title="Copiar al portapapeles">
                                                <IconButton size="small" onClick={stopAnd(() => handleCopy(c.valor))} sx={{ p: 0.25, color: iconBtnColor }}>
                                                    <ContentCopyIcon sx={{ fontSize: 16 }} />
                                                </IconButton>
                                            </Tooltip>
                                        </Stack>
                                    }
                                    color={chipColor}
                                    variant={chipVariant}
                                    title={validTooltip}
                                    onDelete={disabled ? undefined : () => onEliminar(c)}
                                    size="small"
                                    sx={{
                                        mr: 1,
                                        mb: 1,
                                        fontWeight: 500,
                                        height: 'auto',
                                        maxWidth: '100%',
                                        ...(iconBtnColor && {
                                            color: 'common.white',
                                            '& .MuiChip-icon': { color: 'common.white' },
                                            '& .MuiChip-deleteIcon': {
                                                color: 'common.white',
                                                '&:hover': { color: 'rgba(255,255,255,0.85)' },
                                            },
                                        }),
                                        // Principal + WhatsApp: split mitad naranja / mitad verde
                                        ...(esAmbos && {
                                            background: `linear-gradient(135deg, ${theme.palette.warning.main} 0%, ${theme.palette.warning.main} 50%, ${theme.palette.success.main} 50%, ${theme.palette.success.main} 100%)`,
                                        }),
                                        '& .MuiChip-label': {
                                            display: 'block',
                                            whiteSpace: 'normal',
                                            paddingY: 0.5,
                                            wordBreak: 'break-word',
                                            ...(iconBtnColor && { color: 'common.white' }),
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
                    {renderTelefonos()}
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
