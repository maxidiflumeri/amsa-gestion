import React from 'react';
import {
    Box,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Typography,
} from '@mui/material';

interface Props {
    pagos: any[];
}

const FichaPagosTab: React.FC<Props> = ({ pagos }) => {
    if (!pagos || pagos.length === 0) {
        return (
            <Box sx={{ px: 2, pb: 2 }}>
                <Typography variant="body2" color="text.secondary" align="center" fontStyle="italic" py={4}>
                    No hay pagos registrados para este deudor.
                </Typography>
            </Box>
        );
    }

    return (
        <Box sx={{ px: 2, pb: 2 }}>
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
        </Box>
    );
};

export default FichaPagosTab;
