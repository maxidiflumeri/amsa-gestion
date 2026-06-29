import React from 'react';
import {
    Box,
    Card,
    CardContent,
    Grid,
    Stack,
    Tooltip,
    Typography,
} from '@mui/material';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import BusinessCenterIcon from '@mui/icons-material/BusinessCenter';
import AssignmentIcon from '@mui/icons-material/Assignment';
import BadgeIcon from '@mui/icons-material/Badge';

interface Props {
    deudor: any;
    deudaActualizada: number;
    totalPagadoConvenios: number;
    tieneConveniosPagados: boolean;
}

const FichaHeader: React.FC<Props> = ({ deudor, deudaActualizada, totalPagadoConvenios, tieneConveniosPagados }) => {
    const { id, nombre, apellido, documento, remesa, empresa, montoTotal, fechaVencimiento, nroCliente, camposAdicionales } = deudor;
    const nroClienteMostrar = nroCliente || camposAdicionales?.nro_cliente || '-';

    return (
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
                                    {' · '}ID deudor: <strong>{id}</strong>
                                </Typography>
                            </Box>
                        </Stack>
                        <Stack direction="row" spacing={3} mt={2} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
                            <Box display="flex" alignItems="center" gap={1}>
                                <BusinessCenterIcon color="action" fontSize="small" />
                                <Typography variant="body2">
                                    <strong>Empresa:</strong> {empresa?.nombre || '-'}
                                </Typography>
                            </Box>
                            <Box display="flex" alignItems="center" gap={1}>
                                <AssignmentIcon color="action" fontSize="small" />
                                <Typography variant="body2">
                                    <strong>Remesa:</strong> {remesa?.numeroRemesa || '-'}
                                </Typography>
                            </Box>
                            <Box display="flex" alignItems="center" gap={1}>
                                <BadgeIcon color="action" fontSize="small" />
                                <Typography variant="body2">
                                    <strong>Nº Cliente:</strong> {nroClienteMostrar}
                                </Typography>
                            </Box>
                        </Stack>
                    </Grid>

                    <Grid item xs={12} md={6} sx={{ textAlign: { xs: 'left', md: 'right' } }}>
                        {tieneConveniosPagados ? (
                            <>
                                <Typography variant="overline" color="text.secondary" fontWeight="bold">
                                    DEUDA ACTUALIZADA
                                </Typography>
                                <Typography variant="h4" fontWeight="bold" color="success.main">
                                    ${deudaActualizada.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                                </Typography>
                                <Tooltip title="Deuda original informada por el cedente">
                                    <Typography
                                        variant="caption"
                                        color="text.disabled"
                                        display="block"
                                        sx={{ textDecoration: 'line-through', cursor: 'default' }}
                                    >
                                        Original: ${montoTotal?.toLocaleString('es-AR', { minimumFractionDigits: 2 }) || '0.00'}
                                    </Typography>
                                </Tooltip>
                                <Typography variant="caption" color="success.main" display="block">
                                    Pagado por convenios: -${totalPagadoConvenios.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                                </Typography>
                            </>
                        ) : (
                            <>
                                <Typography variant="overline" color="text.secondary" fontWeight="bold">
                                    DEUDA TOTAL
                                </Typography>
                                <Typography variant="h4" fontWeight="bold" color="text.primary">
                                    ${montoTotal?.toLocaleString('es-AR', { minimumFractionDigits: 2 }) || '0.00'}
                                </Typography>
                            </>
                        )}
                        {(remesa?.fechaVencimiento || fechaVencimiento) && (
                            <Typography variant="caption" color="text.secondary" display="block">
                                Vencimiento:{' '}
                                {new Date(remesa?.fechaVencimiento || fechaVencimiento).toLocaleDateString()}
                            </Typography>
                        )}
                    </Grid>
                </Grid>
            </CardContent>
        </Card>
    );
};

export default FichaHeader;
