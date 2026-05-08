import React, { useEffect, useState } from 'react';
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
import api from '../../../../api/axios';
import { LoadingSkeleton } from '../../../ui';

interface Props {
    deudorId: number;
    documento: string;
    active: boolean;
}

const FichaOtrasCuentasTab: React.FC<Props> = ({ deudorId, documento, active }) => {
    const [otrasCuentas, setOtrasCuentas] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!active || !documento) return;
        const cargar = async () => {
            setLoading(true);
            try {
                const res = await api.get(`/deudores/por-documento/${documento}?excludeId=${deudorId}`);
                setOtrasCuentas(res.data || []);
            } catch {
                // silencioso
            } finally {
                setLoading(false);
            }
        };
        cargar();
    }, [active, documento, deudorId]);

    if (loading) {
        return (
            <Box sx={{ px: 2, pb: 2 }}>
                <LoadingSkeleton variant="list" rows={3} />
            </Box>
        );
    }

    if (otrasCuentas.length === 0) {
        return (
            <Box sx={{ px: 2, pb: 2 }}>
                <Typography variant="body2" color="text.secondary" align="center" fontStyle="italic" py={4}>
                    Este deudor no tiene otras cuentas registradas.
                </Typography>
            </Box>
        );
    }

    return (
        <Box sx={{ px: 2, pb: 2 }}>
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
        </Box>
    );
};

export default FichaOtrasCuentasTab;
