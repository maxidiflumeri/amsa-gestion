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
import PrintIcon from '@mui/icons-material/Print';
import { LoadingSkeleton } from '../../../ui';
import { estadoConvenioColor, estadoCuotaColor } from '../shared/estadoColors';
import ClavesPagoCard from '../ClavesPagoCard';
import type { ClaveDelCaso } from '../../../../api/multiclaves';

const TOOLTIP_CANCELADA = 'Cuenta cancelada — no se puede modificar';

interface Props {
    deudorId: number;
    convenios: any[];
    loading: boolean;
    onNuevoConvenio: () => void;
    onAnular: (id: number) => void;
    onPagarCuota: (cuota: any) => void;
    onReimprimirCupon: (convenioId: number) => void;
    disabled?: boolean;
    puedeVerClaves?: boolean;
    puedeGenerarCupon?: boolean;
    reloadTokenClaves?: number;
    onGenerarCupon: (clave: ClaveDelCaso) => void;
    onClavesCargadas?: (vigentes: ClaveDelCaso[]) => void;
    /** Categoría CANCELADO completa (no solo SIT-050 como `disabled`), calculada por el backend
     * (`avisos.cuentaCancelada`) y reportada hacia arriba por `ClavesPagoCard`. Se usa puntualmente
     * para "Reimprimir cupón" (hallazgo de la auditoría, §6); el resto de la solapa sigue con
     * `disabled`. `undefined` mientras todavía no se reportó ningún valor. */
    cuentaCanceladaReal?: boolean;
    onCuentaCanceladaReal?: (cancelada: boolean) => void;
}

const montoConvenioTexto = (n: number | null | undefined) =>
    (n ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 2 });

const FichaConveniosTab: React.FC<Props> = ({
    deudorId,
    convenios,
    loading,
    onNuevoConvenio,
    onAnular,
    onPagarCuota,
    onReimprimirCupon,
    disabled = false,
    puedeVerClaves = false,
    puedeGenerarCupon = false,
    reloadTokenClaves,
    onGenerarCupon,
    onClavesCargadas,
    cuentaCanceladaReal,
    onCuentaCanceladaReal,
}) => {
    // Mientras `ClavesPagoCard` no reportó el valor real (categoría CANCELADO completa), se usa el
    // `disabled` de siempre (solo SIT-050) como piso — nunca queda MENOS restringido de lo que ya
    // estaba.
    const reimprimirDeshabilitado = cuentaCanceladaReal ?? disabled;

    return (
        <Box sx={{ px: 2, pb: 2 }}>
            <ClavesPagoCard
                deudorId={deudorId}
                puedeVerClaves={puedeVerClaves}
                puedeGenerarCupon={puedeGenerarCupon}
                reloadToken={reloadTokenClaves}
                onGenerarCupon={onGenerarCupon}
                onClavesCargadas={onClavesCargadas}
                onCuentaCanceladaReal={onCuentaCanceladaReal}
            />

            <Box display="flex" justifyContent="flex-end" mb={2}>
                <Tooltip title={disabled ? TOOLTIP_CANCELADA : ''} disableHoverListener={!disabled}>
                    <span>
                        <Button
                            variant="contained"
                            size="small"
                            startIcon={<HandshakeIcon />}
                            onClick={onNuevoConvenio}
                            disabled={disabled}
                        >
                            Nuevo Convenio
                        </Button>
                    </span>
                </Tooltip>
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
                            <Stack direction="row" spacing={2} alignItems="center" width="100%" flexWrap="wrap">
                                <Chip label={conv.estado} color={estadoConvenioColor(conv.estado)} size="small" />
                                {conv.origen === 'CLAVE_PAGO' && conv.clavePago ? (
                                    <Chip
                                        label={`Clave · ${conv.clavePago.tipo === 'TOTAL' ? 'Saldo total' : 'Con quita'}`}
                                        color="info"
                                        variant="outlined"
                                        size="small"
                                    />
                                ) : (
                                    <Chip label={conv.tipo} variant="outlined" size="small" />
                                )}
                                <Typography variant="body2" fontWeight="bold">
                                    ${conv.montoTotal?.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                                </Typography>
                                <Typography variant="body2" color="text.secondary">
                                    {conv.cantCuotas} cuotas de $
                                    {conv.montoCuota?.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                                </Typography>
                                {conv.origen === 'CLAVE_PAGO' && conv.importeQuita > 0 && (
                                    <Typography variant="caption" color="text.secondary">
                                        Quita: ${montoConvenioTexto(conv.importeQuita)}
                                    </Typography>
                                )}
                                <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                                    {new Date(conv.fechaInicio).toLocaleDateString('es-AR')}
                                </Typography>
                            </Stack>
                        </AccordionSummary>
                        <AccordionDetails>
                            {conv.origen === 'CLAVE_PAGO' && conv.estado === 'ACTIVO' && (
                                <Box display="flex" justifyContent="flex-end" mb={1}>
                                    <Tooltip title={reimprimirDeshabilitado ? TOOLTIP_CANCELADA : ''} disableHoverListener={!reimprimirDeshabilitado}>
                                        <span>
                                            <Button
                                                size="small"
                                                startIcon={<PrintIcon />}
                                                disabled={reimprimirDeshabilitado}
                                                onClick={() => onReimprimirCupon(conv.id)}
                                            >
                                                Reimprimir cupón
                                            </Button>
                                        </span>
                                    </Tooltip>
                                </Box>
                            )}
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
                                                        <Tooltip title={disabled ? TOOLTIP_CANCELADA : 'Registrar pago'}>
                                                            <span>
                                                                <IconButton
                                                                    size="small"
                                                                    color="success"
                                                                    disabled={disabled}
                                                                    onClick={() => onPagarCuota(cuota)}
                                                                >
                                                                    <PaymentIcon fontSize="small" />
                                                                </IconButton>
                                                            </span>
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
                                    <Tooltip title={disabled ? TOOLTIP_CANCELADA : ''} disableHoverListener={!disabled}>
                                        <span>
                                            <Button
                                                size="small"
                                                color="error"
                                                startIcon={<BlockIcon />}
                                                onClick={() => onAnular(conv.id)}
                                                disabled={disabled}
                                            >
                                                Anular convenio
                                            </Button>
                                        </span>
                                    </Tooltip>
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
