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
import type { TopDeudor } from '../../../types/dashboards';
import EmptyState from '../../../components/ui/EmptyState';
import { fmtMoney } from '../utils';

interface Props {
    deudores: TopDeudor[];
}

const TopDeudoresTable: React.FC<Props> = ({ deudores }) => {
    if (!deudores?.length) {
        return <EmptyState title="Sin deudores" />;
    }
    return (
        <TableContainer>
            <Table size="small">
                <TableHead>
                    <TableRow>
                        <TableCell>Deudor</TableCell>
                        <TableCell>Documento</TableCell>
                        <TableCell align="right">Monto</TableCell>
                        <TableCell>Estado</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {deudores.map((d) => (
                        <TableRow key={d.deudorId} hover>
                            <TableCell>
                                <Typography variant="body2" noWrap maxWidth={240}>
                                    {d.nombreCompleto || '—'}
                                </Typography>
                            </TableCell>
                            <TableCell>{d.documento}</TableCell>
                            <TableCell align="right">
                                <Typography variant="body2" fontWeight={600}>
                                    {fmtMoney(d.monto)}
                                </Typography>
                            </TableCell>
                            <TableCell>
                                <Box display="flex" gap={0.5} flexWrap="wrap">
                                    {d.estadoSituacion && <Chip label={d.estadoSituacion} size="small" variant="outlined" />}
                                    {d.estadoGestion && <Chip label={d.estadoGestion} size="small" />}
                                </Box>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </TableContainer>
    );
};

export default TopDeudoresTable;
