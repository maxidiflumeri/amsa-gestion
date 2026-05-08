import React from 'react';
import {
    Box,
    Chip,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Typography,
} from '@mui/material';

interface Props {
    facturas: any[];
}

const FichaFacturasTab: React.FC<Props> = ({ facturas }) => {
    if (!facturas || facturas.length === 0) {
        return (
            <Box sx={{ px: 2, pb: 2 }}>
                <Typography variant="body2" color="text.secondary" align="center" fontStyle="italic" py={4}>
                    No hay facturas registradas para este deudor.
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
                                    <TableCell
                                        sx={{
                                            color: esVencida ? 'error.main' : 'inherit',
                                            fontWeight: esVencida ? 'bold' : 'normal',
                                        }}
                                    >
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
        </Box>
    );
};

export default React.memo(FichaFacturasTab);
