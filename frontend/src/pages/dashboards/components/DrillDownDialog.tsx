import React, { useEffect, useState } from 'react';
import {
    Box,
    Chip,
    CircularProgress,
    Dialog,
    DialogContent,
    DialogTitle,
    IconButton,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TablePagination,
    TableRow,
    Tooltip,
    Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import {
    dashboardsApi,
    type DimensionDrillDown,
    type DrillDownDeudor,
} from '../../../api/dashboards';
import type { SnapshotFiltros } from '../../../types/dashboards';
import { useNotify } from '../../../hooks/useNotify';
import { fmtMoney } from '../utils';

interface Props {
    open: boolean;
    onClose: () => void;
    filtros: SnapshotFiltros;
    dimension: DimensionDrillDown | null;
    valor: string | null;
    titulo?: string;
}

const PAGE_SIZE = 25;

const DrillDownDialog: React.FC<Props> = ({ open, onClose, filtros, dimension, valor, titulo }) => {
    const notify = useNotify();
    const [page, setPage] = useState(0);
    const [pageSize, setPageSize] = useState(PAGE_SIZE);
    const [items, setItems] = useState<DrillDownDeudor[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (open) {
            setPage(0);
        }
    }, [open, dimension, valor]);

    useEffect(() => {
        if (!open || !dimension || valor == null) return;
        let cancel = false;
        setLoading(true);
        dashboardsApi
            .drillDown({
                ...filtros,
                dimension,
                valor,
                page: page + 1,
                pageSize,
            })
            .then((res) => {
                if (cancel) return;
                setItems(res.items);
                setTotal(res.total);
            })
            .catch((err) => {
                if (cancel) return;
                notify.error(err);
                setItems([]);
                setTotal(0);
            })
            .finally(() => {
                if (!cancel) setLoading(false);
            });
        return () => {
            cancel = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, dimension, valor, page, pageSize, filtros]);

    const irADeudor = (id: number) => {
        window.open(`/deudores/${id}`, '_blank', 'noopener');
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
            <DialogTitle>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Box>
                        <Typography variant="h6">{titulo ?? 'Detalle'}</Typography>
                        <Typography variant="caption" color="text.secondary">
                            {dimension} = {valor} · {total.toLocaleString('es-AR')} casos
                        </Typography>
                    </Box>
                    <IconButton onClick={onClose} size="small">
                        <CloseIcon />
                    </IconButton>
                </Stack>
            </DialogTitle>
            <DialogContent dividers>
                {loading && (
                    <Box display="flex" justifyContent="center" p={3}>
                        <CircularProgress size={28} />
                    </Box>
                )}

                {!loading && items.length === 0 && (
                    <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 3 }}>
                        Sin resultados.
                    </Typography>
                )}

                {!loading && items.length > 0 && (
                    <>
                        <TableContainer>
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell>Nombre</TableCell>
                                        <TableCell>Documento</TableCell>
                                        <TableCell align="right">Deuda</TableCell>
                                        <TableCell>Situación</TableCell>
                                        <TableCell>Gestión</TableCell>
                                        <TableCell>Motivo no pago</TableCell>
                                        <TableCell width={40}></TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {items.map((it) => (
                                        <TableRow key={it.id} hover>
                                            <TableCell>{it.nombreCompleto}</TableCell>
                                            <TableCell>{it.documento}</TableCell>
                                            <TableCell align="right">{fmtMoney(it.montoTotal)}</TableCell>
                                            <TableCell>
                                                {it.estadoSituacion ? (
                                                    <Chip size="small" label={it.estadoSituacion} variant="outlined" />
                                                ) : '—'}
                                            </TableCell>
                                            <TableCell>
                                                {it.estadoGestion ? (
                                                    <Chip size="small" label={it.estadoGestion} variant="outlined" />
                                                ) : '—'}
                                            </TableCell>
                                            <TableCell>{it.motivoNoPago ?? '—'}</TableCell>
                                            <TableCell>
                                                <Tooltip title="Ver ficha">
                                                    <IconButton size="small" onClick={() => irADeudor(it.id)}>
                                                        <OpenInNewIcon fontSize="small" />
                                                    </IconButton>
                                                </Tooltip>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                        <TablePagination
                            component="div"
                            count={total}
                            page={page}
                            onPageChange={(_, p) => setPage(p)}
                            rowsPerPage={pageSize}
                            onRowsPerPageChange={(e) => {
                                setPageSize(parseInt(e.target.value, 10));
                                setPage(0);
                            }}
                            rowsPerPageOptions={[25, 50, 100]}
                            labelRowsPerPage="Por página"
                        />
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
};

export default DrillDownDialog;
