import React, { useCallback, useEffect, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    Checkbox,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControlLabel,
    Stack,
    ToggleButton,
    ToggleButtonGroup,
    Typography,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import { multiclavesApi, ClaveDelCaso, PreviewCuponRespuesta } from '../../../../api/multiclaves';
import { useNotify } from '../../../../hooks/useNotify';
import { LoadingSkeleton } from '../../../ui';

interface Props {
    open: boolean;
    deudorId: number;
    /** Claves vigentes del trámite (1 si SOLO_TOTAL, hasta 2 si trae TOTAL y QUITA). */
    claves: ClaveDelCaso[];
    claveInicialId: number;
    puedeCancelarConvenios: boolean;
    onClose: () => void;
    /** Se dispara después de generar con éxito: el padre recarga claves, convenios, comentarios y el caso. */
    onGenerado: () => void;
}

const fmtMonto = (v: string | number) => Number(v).toLocaleString('es-AR', { minimumFractionDigits: 2 });

const GenerarCuponDialog: React.FC<Props> = ({ open, deudorId, claves, claveInicialId, puedeCancelarConvenios, onClose, onGenerado }) => {
    const notify = useNotify();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

    const [claveId, setClaveId] = useState(claveInicialId);
    const [preview, setPreview] = useState<PreviewCuponRespuesta | null>(null);
    const [loadingPreview, setLoadingPreview] = useState(false);
    const [errorPreview, setErrorPreview] = useState<string | null>(null);
    const [pdfUrl, setPdfUrl] = useState<string | null>(null);
    const [confirmaAnular, setConfirmaAnular] = useState(false);
    const [generando, setGenerando] = useState(false);

    useEffect(() => {
        if (open) {
            setClaveId(claveInicialId);
            setConfirmaAnular(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, claveInicialId]);

    const extraerMensaje = (err: unknown): string => {
        const data = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data;
        if (data?.message) return Array.isArray(data.message) ? data.message[0] : data.message;
        return (err as Error)?.message || 'No se pudo cargar la vista previa del cupón.';
    };

    const cargarPreview = useCallback(async () => {
        setLoadingPreview(true);
        setErrorPreview(null);
        setPreview(null);
        try {
            const [datos, pdfRes] = await Promise.all([
                multiclavesApi.previewCupon(claveId, deudorId),
                multiclavesApi.previewCuponPdf(claveId, deudorId),
            ]);
            setPreview(datos);
            setPdfUrl(window.URL.createObjectURL(new Blob([pdfRes.data], { type: 'application/pdf' })));
        } catch (err) {
            // Antes esto dejaba el diálogo con el esqueleto de carga para siempre: `loadingPreview`
            // se apagaba en el `finally`, pero como `preview` seguía en `null`, la condición de
            // render (`loadingPreview || !preview`) igual mostraba el esqueleto — sin ningún error
            // visible ni forma de reintentar (hallazgo de la auditoría, §11).
            setErrorPreview(extraerMensaje(err));
        } finally {
            setLoadingPreview(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [claveId, deudorId]);

    useEffect(() => {
        if (open) cargarPreview();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, cargarPreview]);

    // Revoca el blob URL anterior en cada refetch (cambio de clave) y también al cerrar/desmontar el
    // diálogo — con el cleanup atado a `pdfUrl` (no a un array vacío) siempre revoca la URL que
    // efectivamente estaba viva, nunca una del primer render que ya no existe.
    useEffect(() => {
        return () => {
            if (pdfUrl) window.URL.revokeObjectURL(pdfUrl);
        };
    }, [pdfUrl]);

    const claveActual = claves.find((c) => c.id === claveId);
    const necesitaConfirmarAnulacion = !!preview?.otroConvenioActivo && preview.otroConvenioActivo.deudorId === deudorId;
    const puedeConfirmar =
        !!preview?.puedeGenerar && (!necesitaConfirmarAnulacion || (confirmaAnular && puedeCancelarConvenios));

    // Esta MISMA clave ya tiene un convenio activo en otro caso (§11.2.5): no hay forma de generar
    // acá, solo queda ir a ver ese otro caso. La pantalla de Gestión no tiene una URL propia por
    // caso (`selectedDeudorId` vive en `localStorage` + estado de React, no en la ruta), así que
    // "abrir el otro caso" es dejar el id guardado y recargar `/gestion` — no un `<Link>` común.
    const otroCasoId =
        preview?.convenioActivo && !preview.convenioActivo.esEsteCaso ? preview.convenioActivo.deudorId : null;

    const handleAbrirOtroCaso = useCallback(() => {
        if (otroCasoId == null) return;
        localStorage.setItem('last_deudor_id', String(otroCasoId));
        window.location.assign('/gestion');
    }, [otroCasoId]);

    const handleDescargar = useCallback(async () => {
        setGenerando(true);
        try {
            const res = await multiclavesApi.generarCupon(claveId, {
                deudorId,
                accion: 'DESCARGAR',
                reemplazarConvenioActivo: necesitaConfirmarAnulacion ? true : undefined,
            });

            const pdf = await multiclavesApi.descargarCupon(res.convenioId);
            const url = window.URL.createObjectURL(new Blob([pdf.data], { type: 'application/pdf' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = `cupon-${claveActual?.tipo === 'TOTAL' ? 'saldo-total' : 'quita'}-${res.convenioId}.pdf`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);

            notify.success(
                res.convenioReusado
                    ? 'El cupón ya estaba generado: se descargó de nuevo.'
                    : res.convenioAnuladoId
                        ? 'Cupón generado. Se anuló el convenio de la otra clave.'
                        : 'Cupón generado y descargado.',
            );
            onGenerado();
            onClose();
        } catch (err) {
            notify.error(err as Error);
        } finally {
            setGenerando(false);
        }
    }, [claveId, deudorId, necesitaConfirmarAnulacion, claveActual, notify, onGenerado, onClose]);

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" fullScreen={isMobile}>
            <DialogTitle>Generar cupón de pago</DialogTitle>
            <DialogContent>
                {claves.length > 1 && (
                    <Box mb={2}>
                        <ToggleButtonGroup
                            exclusive
                            size="small"
                            value={claveId}
                            onChange={(_, val) => val && setClaveId(val)}
                        >
                            {claves.map((c) => (
                                <ToggleButton key={c.id} value={c.id}>
                                    {c.tipo === 'TOTAL' ? 'Saldo total' : 'Con quita 50%'} — $ {fmtMonto(c.importe)}
                                </ToggleButton>
                            ))}
                        </ToggleButtonGroup>
                    </Box>
                )}

                {errorPreview ? (
                    <Alert
                        severity="error"
                        action={
                            <Button color="inherit" size="small" onClick={cargarPreview}>
                                Reintentar
                            </Button>
                        }
                    >
                        {errorPreview}
                    </Alert>
                ) : loadingPreview || !preview ? (
                    <LoadingSkeleton variant="detail" />
                ) : (
                    <Stack spacing={2}>
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                            <Typography variant="body2">
                                <strong>Importe:</strong> $ {fmtMonto(preview.clave.importe)}
                            </Typography>
                            <Typography variant="body2">
                                <strong>Vencimiento impreso:</strong> {preview.vtoImpreso}
                            </Typography>
                            <Typography variant="body2">
                                <strong>Convenio Telecom:</strong> {preview.clave.nroConvenio}
                            </Typography>
                        </Stack>

                        {preview.avisos.map((a, i) => (
                            <Alert
                                key={i}
                                severity={preview.puedeGenerar ? 'warning' : 'error'}
                                variant="outlined"
                                action={
                                    otroCasoId != null && i === 0 ? (
                                        <Button color="inherit" size="small" onClick={handleAbrirOtroCaso}>
                                            Abrir ese caso
                                        </Button>
                                    ) : undefined
                                }
                            >
                                {a}
                            </Alert>
                        ))}

                        {necesitaConfirmarAnulacion && (
                            <FormControlLabel
                                control={
                                    <Checkbox
                                        checked={confirmaAnular}
                                        disabled={!puedeCancelarConvenios}
                                        onChange={(e) => setConfirmaAnular(e.target.checked)}
                                    />
                                }
                                label={
                                    puedeCancelarConvenios
                                        ? 'Anular el convenio de la otra clave y generar este cupón'
                                        : 'Anular el convenio anterior (necesitás el permiso "Cancelar convenios")'
                                }
                            />
                        )}

                        <Box
                            sx={{
                                border: 1,
                                borderColor: 'divider',
                                borderRadius: 1,
                                overflow: 'hidden',
                                height: { xs: 320, sm: 480 },
                            }}
                        >
                            {pdfUrl && (
                                <iframe
                                    title="Vista previa del cupón"
                                    src={pdfUrl}
                                    style={{ width: '100%', height: '100%', border: 'none' }}
                                />
                            )}
                        </Box>
                        <Typography variant="caption" color="text.secondary">
                            Vista previa con marca de agua, sin código de barras. El PDF final se genera al confirmar.
                        </Typography>
                    </Stack>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancelar</Button>
                <Button
                    variant="contained"
                    startIcon={<DownloadIcon />}
                    disabled={!puedeConfirmar || generando}
                    onClick={handleDescargar}
                >
                    {generando ? 'Generando…' : 'Descargar'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default GenerarCuponDialog;
