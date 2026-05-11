import React, { useEffect, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    Checkbox,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControlLabel,
    Grid,
    Stack,
    TextField,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import SearchIcon from '@mui/icons-material/Search';
import api from '../../../../api/axios';
import { useNotify } from '../../../../hooks/useNotify';
import { getHelperTextEmail, validarEmailFront } from '../../../../utils/emails';
import {
    DireccionPreview,
    getHelperTextDireccion,
    validarDireccionArgentinaFront,
} from '../../../../utils/direcciones';
import { PreviewTelefono, validarTelefonoArgentinoFront } from '../../../../utils/phone';

interface Props {
    open: boolean;
    tipoSeleccionado: string;
    deudorId: number;
    onClose: () => void;
    onSaved: () => void;
}

const AgregarContactoModal: React.FC<Props> = ({ open, tipoSeleccionado, deudorId, onClose, onSaved }) => {
    const notify = useNotify();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));

    const [nuevoContacto, setNuevoContacto] = useState({ tipo: '', valor: '' });
    const [previewTel, setPreviewTel] = useState<PreviewTelefono | null>(null);
    const [previewEmail, setPreviewEmail] = useState<{ valido: boolean; normalizado?: string } | null>(null);
    const [previewDir, setPreviewDir] = useState<DireccionPreview | null>(null);
    const [validandoDir, setValidandoDir] = useState(false);
    const [esWhatsapp, setEsWhatsapp] = useState(false);
    const [esPrincipal, setEsPrincipal] = useState(false);
    const [nuevaDireccion, setNuevaDireccion] = useState({
        calle: '',
        numero: '',
        cp: '',
        localidad: '',
        provincia: '',
    });

    // Reset al abrir
    useEffect(() => {
        if (open) {
            setNuevoContacto({ tipo: tipoSeleccionado, valor: '' });
            setNuevaDireccion({ calle: '', numero: '', cp: '', localidad: '', provincia: '' });
            setPreviewTel(null);
            setPreviewEmail(null);
            setPreviewDir(null);
            setValidandoDir(false);
            setEsWhatsapp(false);
            setEsPrincipal(false);
        }
    }, [open, tipoSeleccionado]);

    const handleChangeDireccion = (field: string, value: string) => {
        setNuevaDireccion((prev) => ({ ...prev, [field]: value }));
        setPreviewDir(null);
    };

    const handleValidarDireccion = async () => {
        setValidandoDir(true);
        const textoBusqueda = `${nuevaDireccion.calle} ${nuevaDireccion.numero}`;
        const res = await validarDireccionArgentinaFront(textoBusqueda, {
            localidad: nuevaDireccion.localidad,
            provincia: nuevaDireccion.provincia,
        });
        setPreviewDir(res);
        setValidandoDir(false);
    };

    const handleAgregarContacto = async () => {
        try {
            // Unificación: agregar siempre como tipo='telefono' (con flag whatsapp si corresponde).
            const tipoFinal = tipoSeleccionado === 'whatsapp' ? 'telefono' : tipoSeleccionado;
            let payload: any = { ...nuevoContacto, tipo: tipoFinal, deudorId };

            if (tipoFinal === 'telefono') {
                const res = validarTelefonoArgentinoFront(nuevoContacto.valor);
                if (!res.valido || !res.e164) {
                    notify.error('Número inválido para Argentina');
                    return;
                }
                payload = {
                    ...payload,
                    valor: res.e164,
                    whatsapp: esWhatsapp,
                    prioridad: esPrincipal ? 1 : null,
                };
            }

            await api.post('/contactos', payload);
            onSaved();
            onClose();
            notify.success('Contacto agregado correctamente');
        } catch (err: any) {
            if (err.response?.data?.message) {
                notify.error(err.response.data.message);
            } else {
                notify.error(err as Error);
            }
        }
    };

    const handleGuardar = async () => {
        if (tipoSeleccionado === 'direccion') {
            const dirFormateada = previewDir?.valido
                ? `${previewDir.normalizada}, ${previewDir.localidad || nuevaDireccion.localidad}, ${previewDir.provincia || nuevaDireccion.provincia} (CP ${nuevaDireccion.cp || '-'})`
                : `${nuevaDireccion.calle} ${nuevaDireccion.numero}, ${nuevaDireccion.localidad}, ${nuevaDireccion.provincia} (CP ${nuevaDireccion.cp || '-'})`;

            await api.post('/contactos', {
                tipo: 'direccion',
                valor: dirFormateada,
                deudorId,
                direccionLocalidad: nuevaDireccion.localidad,
                direccionProvincia: nuevaDireccion.provincia,
            });
            notify.success(previewDir?.valido ? 'Dirección validada y guardada correctamente' : 'Dirección guardada manualmente');
            onSaved();
            onClose();
        } else {
            handleAgregarContacto();
        }
    };

    const isGuardarDisabled = () => {
        if (tipoSeleccionado === 'direccion') return !previewDir;
        if (tipoSeleccionado === 'telefono' || tipoSeleccionado === 'whatsapp') return !previewTel?.valido;
        if (tipoSeleccionado === 'email') return !previewEmail?.valido;
        return !nuevoContacto.valor?.trim();
    };

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" fullScreen={isMobile}>
            <DialogTitle>Agregar {tipoSeleccionado}</DialogTitle>
            <DialogContent>
                {tipoSeleccionado === 'direccion' ? (
                    <>
                        <Grid container spacing={2} sx={{ mt: 1 }}>
                            <Grid item xs={12} sm={6}>
                                <TextField
                                    label="Calle"
                                    fullWidth
                                    value={nuevaDireccion.calle}
                                    onChange={(e) => handleChangeDireccion('calle', e.target.value)}
                                />
                            </Grid>
                            <Grid item xs={12} sm={3}>
                                <TextField
                                    label="Número"
                                    fullWidth
                                    value={nuevaDireccion.numero}
                                    onChange={(e) => handleChangeDireccion('numero', e.target.value)}
                                />
                            </Grid>
                            <Grid item xs={12} sm={3}>
                                <TextField
                                    label="Código Postal"
                                    fullWidth
                                    value={nuevaDireccion.cp}
                                    onChange={(e) => handleChangeDireccion('cp', e.target.value)}
                                />
                            </Grid>
                            <Grid item xs={12} sm={6}>
                                <TextField
                                    label="Localidad"
                                    fullWidth
                                    value={nuevaDireccion.localidad}
                                    onChange={(e) => handleChangeDireccion('localidad', e.target.value)}
                                />
                            </Grid>
                            <Grid item xs={12} sm={6}>
                                <TextField
                                    label="Provincia"
                                    fullWidth
                                    value={nuevaDireccion.provincia}
                                    onChange={(e) => handleChangeDireccion('provincia', e.target.value)}
                                />
                            </Grid>
                        </Grid>

                        <Box sx={{ mt: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <Button
                                variant="outlined"
                                color="info"
                                startIcon={validandoDir ? <CircularProgress size={20} /> : <SearchIcon />}
                                onClick={handleValidarDireccion}
                                disabled={
                                    validandoDir ||
                                    !nuevaDireccion.calle ||
                                    !nuevaDireccion.numero ||
                                    !nuevaDireccion.localidad ||
                                    !nuevaDireccion.provincia
                                }
                            >
                                {validandoDir ? 'Validando con Georef...' : 'Validar Dirección'}
                            </Button>

                            {previewDir && (
                                <Alert
                                    severity={previewDir.valido ? 'success' : 'warning'}
                                    icon={previewDir.valido ? <CheckCircleIcon /> : <ReportProblemIcon />}
                                >
                                    {previewDir.valido ? (
                                        `Ubicación encontrada: ${previewDir.normalizada} (${previewDir.localidad}, ${previewDir.provincia})`
                                    ) : previewDir.sugerencia ? (
                                        <>
                                            {previewDir.motivoInvalido}
                                            <br />
                                            ¿Querés decir <strong>{previewDir.sugerencia.normalizada}</strong> en{' '}
                                            <strong>{previewDir.sugerencia.localidad}, {previewDir.sugerencia.provincia}</strong>?
                                            Revisá la localidad ingresada.
                                        </>
                                    ) : (
                                        `${previewDir.motivoInvalido || 'No encontrada en Georef'}. Podés guardarla igual como no validada.`
                                    )}
                                </Alert>
                            )}
                        </Box>
                    </>
                ) : (
                    <TextField
                        label={
                            tipoSeleccionado === 'telefono' || tipoSeleccionado === 'whatsapp'
                                ? 'Teléfono (AR)'
                                : tipoSeleccionado === 'email'
                                  ? 'Correo electrónico'
                                  : 'Valor'
                        }
                        fullWidth
                        autoFocus
                        value={nuevoContacto.valor}
                        onChange={(e) => {
                            const valor = e.target.value;
                            setNuevoContacto({ tipo: tipoSeleccionado, valor });
                            if (tipoSeleccionado === 'telefono' || tipoSeleccionado === 'whatsapp') {
                                setPreviewTel(validarTelefonoArgentinoFront(valor));
                            } else if (tipoSeleccionado === 'email') {
                                setPreviewEmail(validarEmailFront(valor));
                            } else {
                                setPreviewTel(null);
                                setPreviewEmail(null);
                            }
                        }}
                        sx={{ mt: 2 }}
                        helperText={
                            tipoSeleccionado === 'telefono' || tipoSeleccionado === 'whatsapp'
                                ? previewTel?.valido
                                    ? `Se guardará como: ${previewTel.internacional} (${previewTel.e164})`
                                    : 'Ingresá un número válido de Argentina'
                                : tipoSeleccionado === 'email'
                                  ? getHelperTextEmail(previewEmail)
                                  : undefined
                        }
                        error={
                            tipoSeleccionado === 'telefono' || tipoSeleccionado === 'whatsapp'
                                ? !!(previewTel && !previewTel.valido)
                                : tipoSeleccionado === 'email'
                                  ? !!(previewEmail && !previewEmail.valido)
                                  : false
                        }
                    />
                )}

                {(tipoSeleccionado === 'telefono' || tipoSeleccionado === 'whatsapp') && (
                    <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
                        <FormControlLabel
                            control={<Checkbox checked={esWhatsapp} onChange={(e) => setEsWhatsapp(e.target.checked)} />}
                            label="Tiene WhatsApp"
                        />
                        <FormControlLabel
                            control={<Checkbox checked={esPrincipal} onChange={(e) => setEsPrincipal(e.target.checked)} />}
                            label="Marcar como principal"
                        />
                    </Stack>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancelar</Button>
                <Button variant="contained" onClick={handleGuardar} disabled={isGuardarDisabled()}>
                    Guardar
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default AgregarContactoModal;
