import React from 'react';
import {
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
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';

interface Props {
    pagos: any[];
    promesas?: any[];
    onCargar?: () => void;
    onEliminar?: (pago: any) => void;
    puedeCargar?: boolean;
    puedeEliminar?: boolean;
    disabled?: boolean;
}

const ORIGEN_LABEL: Record<string, string> = {
    MANUAL: 'Manual',
    IMPORT_PAGOS: 'Bajada pagos',
    IMPORT_ACTUALIZACION: 'Actualización',
    CONVENIO: 'Convenio',
};

const PROMESA_COLOR: Record<string, 'warning' | 'success' | 'error' | 'default'> = {
    VIGENTE: 'warning',
    CUMPLIDA: 'success',
    INCUMPLIDA: 'error',
    ANULADA: 'default',
};

const fmtMonto = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2 });

const FichaPagosTab: React.FC<Props> = ({
    pagos,
    promesas = [],
    onCargar,
    onEliminar,
    puedeCargar = false,
    puedeEliminar = false,
    disabled = false,
}) => {
    const promesasVisibles = promesas.filter((p) => p.estado !== 'ANULADA');

    return (
        <Box sx={{ px: 2, pb: 2 }}>
            {puedeCargar && (
                <Stack direction="row" justifyContent="flex-end" sx={{ pt: 1, pb: 1.5 }}>
                    <Button
                        size="small"
                        variant="contained"
                        startIcon={<AddIcon />}
                        onClick={onCargar}
                        disabled={disabled}
                    >
                        Cargar
                    </Button>
                </Stack>
            )}

            {/* Promesas de pago */}
            {promesasVisibles.length > 0 && (
                <Box sx={{ mb: 2 }}>
                    <Typography variant="overline" color="text.secondary">
                        Promesas de pago
                    </Typography>
                    <Stack spacing={0.75} sx={{ mt: 0.5 }}>
                        {promesasVisibles.map((p: any) => (
                            <Stack
                                key={p.id}
                                direction="row"
                                alignItems="center"
                                spacing={1}
                                flexWrap="wrap"
                                sx={{ rowGap: 0.5 }}
                            >
                                <Chip
                                    size="small"
                                    label={p.estado}
                                    color={PROMESA_COLOR[p.estado] ?? 'default'}
                                    variant={p.estado === 'VIGENTE' ? 'filled' : 'outlined'}
                                />
                                <Typography variant="body2">
                                    Prometió pagar el <strong>{new Date(p.fechaPromesa).toLocaleDateString()}</strong>
                                    {p.monto != null ? ` · $${fmtMonto(p.monto)}` : ''}
                                </Typography>
                                {p.observacion && (
                                    <Typography variant="caption" color="text.secondary">
                                        — {p.observacion}
                                    </Typography>
                                )}
                            </Stack>
                        ))}
                    </Stack>
                </Box>
            )}

            {!pagos || pagos.length === 0 ? (
                <Typography
                    variant="body2"
                    color="text.secondary"
                    align="center"
                    fontStyle="italic"
                    py={4}
                >
                    No hay pagos registrados para este deudor.
                </Typography>
            ) : (
                <TableContainer sx={{ maxHeight: 300 }}>
                    <Table stickyHeader size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell sx={{ bgcolor: 'action.hover' }}>Fecha Pago</TableCell>
                                <TableCell sx={{ bgcolor: 'action.hover' }}>Origen</TableCell>
                                <TableCell sx={{ bgcolor: 'action.hover' }}>Observación</TableCell>
                                <TableCell align="right" sx={{ bgcolor: 'action.hover' }}>Importe</TableCell>
                                {puedeEliminar && <TableCell sx={{ bgcolor: 'action.hover' }} />}
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {pagos.map((pago: any) => {
                                const origen = pago.origen
                                    ? ORIGEN_LABEL[pago.origen] ?? pago.origen
                                    : pago.origenArchivo || '-';
                                const esManual = pago.origen === 'MANUAL';
                                return (
                                    <TableRow key={pago.id} hover>
                                        <TableCell>{new Date(pago.fecha).toLocaleDateString()}</TableCell>
                                        <TableCell>
                                            <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap">
                                                <span>{origen}</span>
                                                {pago.confirmadoImport && (
                                                    <Chip size="small" label="Confirmado" color="success" variant="outlined" />
                                                )}
                                            </Stack>
                                        </TableCell>
                                        <TableCell>{pago.observacion || '-'}</TableCell>
                                        <TableCell align="right" sx={{ fontWeight: 'bold', color: 'success.main' }}>
                                            +${fmtMonto(pago.importe)}
                                        </TableCell>
                                        {puedeEliminar && (
                                            <TableCell padding="none" align="center">
                                                <Tooltip
                                                    title={
                                                        esManual
                                                            ? 'Eliminar pago'
                                                            : 'Solo se pueden eliminar pagos manuales'
                                                    }
                                                >
                                                    <span>
                                                        <IconButton
                                                            size="small"
                                                            color="error"
                                                            disabled={disabled || !esManual}
                                                            onClick={() => onEliminar?.(pago)}
                                                        >
                                                            <DeleteIcon fontSize="small" />
                                                        </IconButton>
                                                    </span>
                                                </Tooltip>
                                            </TableCell>
                                        )}
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}
        </Box>
    );
};

export default FichaPagosTab;
