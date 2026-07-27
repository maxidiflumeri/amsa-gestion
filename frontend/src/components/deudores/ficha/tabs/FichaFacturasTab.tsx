import React, { useState } from 'react';
import {
    Box,
    Chip,
    Collapse,
    IconButton,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Tooltip,
    Typography,
} from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';

interface Props {
    facturas: any[];
}

/**
 * Fila de factura. El desglose (`detalle`) se despliega en una sub-fila: lo cargan los imports
 * multirregistro (Toyota) con los conceptos que componen el importe, y puede ser largo.
 */
const FilaFactura: React.FC<{ fac: any; mostrarContrato: boolean }> = ({ fac, mostrarContrato }) => {
    const [abierta, setAbierta] = useState(false);
    const vto = new Date(fac.vencimiento);
    const esVencida = vto < new Date() && fac.estado !== 'PAGADA';
    const tieneDesglose = !!fac.detalle;

    return (
        <>
            <TableRow hover>
                <TableCell sx={{ width: 40, p: 0.5 }}>
                    {tieneDesglose && (
                        <Tooltip title={abierta ? 'Ocultar desglose' : 'Ver desglose'}>
                            <IconButton size="small" onClick={() => setAbierta((v) => !v)}>
                                {abierta ? <KeyboardArrowUpIcon fontSize="small" /> : <KeyboardArrowDownIcon fontSize="small" />}
                            </IconButton>
                        </Tooltip>
                    )}
                </TableCell>
                <TableCell sx={{ fontWeight: 500 }}>{fac.nroFactura}</TableCell>
                {mostrarContrato && (
                    <TableCell sx={{ color: 'text.secondary' }}>{fac.externalId || '-'}</TableCell>
                )}
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

            {tieneDesglose && (
                <TableRow>
                    <TableCell sx={{ py: 0, border: 0 }} colSpan={mostrarContrato ? 7 : 6}>
                        <Collapse in={abierta} timeout="auto" unmountOnExit>
                            <Box sx={{ py: 1.5, px: 2, my: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
                                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                                    Desglose del importe
                                </Typography>
                                <Box sx={{ mt: 0.5, display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                                    {String(fac.detalle)
                                        .split('|')
                                        .map((parte: string, i: number) => (
                                            <Chip key={i} label={parte.trim()} size="small" variant="outlined" />
                                        ))}
                                </Box>
                            </Box>
                        </Collapse>
                    </TableCell>
                </TableRow>
            )}
        </>
    );
};

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

    // La columna de contrato solo aparece si alguna factura lo trae (hoy solo los imports
    // multirregistro lo cargan), para no sumar una columna vacía al resto de las carteras.
    const mostrarContrato = facturas.some((f: any) => !!f.externalId);

    return (
        <Box sx={{ px: 2, pb: 2 }}>
            <TableContainer sx={{ maxHeight: 300 }}>
                <Table stickyHeader size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell sx={{ bgcolor: 'action.hover', width: 40 }} />
                            <TableCell sx={{ bgcolor: 'action.hover' }}>Factura</TableCell>
                            {mostrarContrato && <TableCell sx={{ bgcolor: 'action.hover' }}>Contrato</TableCell>}
                            <TableCell sx={{ bgcolor: 'action.hover' }}>Emisión</TableCell>
                            <TableCell sx={{ bgcolor: 'action.hover' }}>Vencimiento</TableCell>
                            <TableCell align="right" sx={{ bgcolor: 'action.hover' }}>Importe</TableCell>
                            <TableCell sx={{ bgcolor: 'action.hover' }}>Estado</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {facturas.map((fac: any) => (
                            <FilaFactura key={fac.id} fac={fac} mostrarContrato={mostrarContrato} />
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
        </Box>
    );
};

export default React.memo(FichaFacturasTab);
