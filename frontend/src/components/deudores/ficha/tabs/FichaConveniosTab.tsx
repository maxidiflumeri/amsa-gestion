import React from 'react';
import {
    Accordion,
    AccordionDetails,
    AccordionSummary,
    Box,
    Button,
    Chip,
    IconButton,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Tooltip,
    Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HandshakeIcon from '@mui/icons-material/Handshake';
import BlockIcon from '@mui/icons-material/Block';
import PaymentIcon from '@mui/icons-material/Payment';
import { LoadingSkeleton } from '../../../ui';
import { estadoConvenioColor, estadoCuotaColor } from '../shared/estadoColors';

interface Props {
    convenios: any[];
    loading: boolean;
    onNuevoConvenio: () => void;
    onAnular: (id: number) => void;
    onPagarCuota: (cuota: any) => void;
}

const FichaConveniosTab: React.FC<Props> = ({ convenios, loading, onNuevoConvenio, onAnular, onPagarCuota }) => {
    return (
        <Box sx={{ px: 2, pb: 2 }}>
            <Box display="flex" justifyContent="flex-end" mb={2}>
                <Button variant="contained" size="small" startIcon={<HandshakeIcon />} onClick={onNuevoConvenio}>
                    Nuevo Convenio
                </Button>
            </Box>

            {loading ? (
                <LoadingSkeleton variant="list" rows={3} />
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
                                    {conv.cantCuotas} cuotas de $
                                    {conv.montoCuota?.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
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
                                            <TableCell align="right" sx={{ bgcolor: 'action.hover' }}>
                                                Importe
                                            </TableCell>
                                            <TableCell sx={{ bgcolor: 'action.hover' }}>Estado</TableCell>
                                            <TableCell sx={{ bgcolor: 'action.hover' }}>Fecha Pago</TableCell>
                                            <TableCell sx={{ bgcolor: 'action.hover' }}></TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {conv.cuotas?.map((cuota: any) => (
                                            <TableRow key={cuota.id} hover>
                                                <TableCell>{cuota.nroCuota}</TableCell>
                                                <TableCell>
                                                    {new Date(cuota.fechaVencimiento).toLocaleDateString('es-AR')}
                                                </TableCell>
                                                <TableCell align="right">
                                                    ${cuota.importe?.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                                                </TableCell>
                                                <TableCell>
                                                    <Chip
                                                        label={cuota.estado}
                                                        color={estadoCuotaColor(cuota.estado)}
                                                        size="small"
                                                        variant="outlined"
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    {cuota.fechaPago
                                                        ? new Date(cuota.fechaPago).toLocaleDateString('es-AR')
                                                        : '-'}
                                                </TableCell>
                                                <TableCell>
                                                    {cuota.estado === 'PENDIENTE' && conv.estado === 'ACTIVO' && (
                                                        <Tooltip title="Registrar pago">
                                                            <IconButton
                                                                size="small"
                                                                color="success"
                                                                onClick={() => onPagarCuota(cuota)}
                                                            >
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
                                        onClick={() => onAnular(conv.id)}
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
    );
};

export default React.memo(FichaConveniosTab);
