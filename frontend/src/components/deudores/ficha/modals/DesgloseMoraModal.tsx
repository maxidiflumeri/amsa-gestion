import React, { useEffect, useState } from 'react';
import {
    Alert,
    Box,
    Chip,
    CircularProgress,
    Dialog,
    DialogContent,
    DialogTitle,
    Divider,
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
import CloseIcon from '@mui/icons-material/Close';
import { moraApi, MoraDeudor } from '../../../../api/mora';

/**
 * Desglose del recargo por mora, factura por factura.
 *
 * Replica la estructura del **estado de deuda de la oficina virtual de AYSA** —mismos conceptos y
 * mismo orden de columnas— para que el gestor pueda cotejar línea por línea contra lo que ve el
 * deudor cuando consulta. Ver docs/mora-aysa-spec.md §1.
 */

const money = (n: number) => `$${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface Props {
    open: boolean;
    onClose: () => void;
    deudorId: number;
    nombre?: string;
}

const DesgloseMoraModal: React.FC<Props> = ({ open, onClose, deudorId, nombre }) => {
    const [data, setData] = useState<MoraDeudor | null>(null);
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setCargando(true);
        setError(null);
        moraApi
            .deudor(deudorId)
            .then(setData)
            .catch((e) => setError(e?.response?.data?.message ?? 'No se pudo calcular el recargo por mora'))
            .finally(() => setCargando(false));
    }, [open, deudorId]);

    return (
        <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
            <DialogTitle sx={{ pr: 6 }}>
                <Stack direction="row" alignItems="baseline" spacing={1} flexWrap="wrap">
                    <Typography variant="h6" component="span" fontWeight={800}>
                        Deuda actualizada
                    </Typography>
                    {nombre && (
                        <Typography variant="body2" color="text.secondary">
                            · {nombre}
                        </Typography>
                    )}
                    {data && (
                        <Typography variant="body2" color="text.secondary">
                            · recargos e intereses calculados hasta el{' '}
                            {new Date(`${data.fechaCalculo}T00:00:00`).toLocaleDateString('es-AR')}
                        </Typography>
                    )}
                </Stack>
                <IconButton onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }} size="small">
                    <CloseIcon />
                </IconButton>
            </DialogTitle>

            <DialogContent dividers>
                {cargando && (
                    <Box display="flex" justifyContent="center" py={6}>
                        <CircularProgress />
                    </Box>
                )}

                {error && <Alert severity="error">{error}</Alert>}

                {data && !cargando && (
                    <>
                        {data.advertencias.map((a, i) => (
                            <Alert key={i} severity="warning" sx={{ mb: 2 }}>
                                {a}
                            </Alert>
                        ))}

                        <TableContainer sx={{ overflowX: 'auto' }}>
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell>Factura</TableCell>
                                        <TableCell>1er vto.</TableCell>
                                        <TableCell align="right">Días</TableCell>
                                        <TableCell align="right">Coef.</TableCell>
                                        <TableCell align="right">Importe original</TableCell>
                                        <Tooltip title="Interés desde el vencimiento más el recargo fijo del 5%">
                                            <TableCell align="right">Int/Rec</TableCell>
                                        </Tooltip>
                                        <Tooltip title="Recargo por gestión de cobranza: 10% de capital + interés">
                                            <TableCell align="right">Rec AJ/EJ</TableCell>
                                        </Tooltip>
                                        <Tooltip title="21% sobre los recargos. No grava el capital, que ya salió facturado con IVA">
                                            <TableCell align="right">IVA</TableCell>
                                        </Tooltip>
                                        <TableCell align="right">Total</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {data.facturas.map((f) => (
                                        <TableRow key={f.facturaId} hover>
                                            <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                                {f.nroFactura}
                                                {f.nota === 'NO_VENCIDA' && (
                                                    <Chip label="no vencida" size="small" sx={{ ml: 1 }} />
                                                )}
                                                {f.nota === 'SIN_INDICE' && (
                                                    <Chip label="sin índice" size="small" color="warning" sx={{ ml: 1 }} />
                                                )}
                                            </TableCell>
                                            <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                                {new Date(`${f.vencimiento}T00:00:00`).toLocaleDateString('es-AR')}
                                            </TableCell>
                                            <TableCell align="right">{f.diasMora || '—'}</TableCell>
                                            <TableCell align="right">
                                                {f.nota ? '—' : f.coeficiente.toFixed(6)}
                                            </TableCell>
                                            <TableCell align="right">{money(f.capital)}</TableCell>
                                            <TableCell align="right">{f.intRec ? money(f.intRec) : '—'}</TableCell>
                                            <TableCell align="right">{f.recAjEj ? money(f.recAjEj) : '—'}</TableCell>
                                            <TableCell align="right">{f.iva ? money(f.iva) : '—'}</TableCell>
                                            <TableCell align="right" sx={{ fontWeight: 700 }}>
                                                {money(f.total)}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>

                        <Divider sx={{ my: 2 }} />

                        <Stack
                            direction={{ xs: 'column', sm: 'row' }}
                            spacing={3}
                            justifyContent="flex-end"
                            sx={{ textAlign: 'right' }}
                        >
                            <Total label="Original" valor={data.capital} />
                            <Total label="Int/Rec" valor={data.intRec} />
                            <Total label="Rec AJ/EJ" valor={data.recAjEj} />
                            <Total label="IVA" valor={data.iva} />
                            <Total label="Deuda actualizada" valor={data.total} destacado />
                        </Stack>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
};

const Total: React.FC<{ label: string; valor: number; destacado?: boolean }> = ({ label, valor, destacado }) => (
    <Box>
        <Typography variant="overline" color="text.secondary" display="block" lineHeight={1.2}>
            {label}
        </Typography>
        <Typography
            variant={destacado ? 'h6' : 'body1'}
            fontWeight={destacado ? 900 : 600}
            color={destacado ? 'primary.main' : 'text.primary'}
        >
            {money(valor)}
        </Typography>
    </Box>
);

export default DesgloseMoraModal;
