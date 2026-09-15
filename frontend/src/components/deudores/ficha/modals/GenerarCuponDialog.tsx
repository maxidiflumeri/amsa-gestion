import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    Checkbox,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    FormControlLabel,
    MenuItem,
    Stack,
    TextField,
    ToggleButton,
    ToggleButtonGroup,
    Typography,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import SendIcon from '@mui/icons-material/Send';
import { multiclavesApi, ClaveDelCaso, PreviewCuponRespuesta, AccionCupon, GenerarCuponRespuesta } from '../../../../api/multiclaves';
import { emailApi } from '../../../../api/email';
import type { EmailTemplateListItem } from '../../../../types/email';
import { useNotify } from '../../../../hooks/useNotify';
import { LoadingSkeleton } from '../../../ui';

interface Props {
    open: boolean;
    deudorId: number;
    empresaId: number;
    /** Claves vigentes del trámite (1 si SOLO_TOTAL, hasta 2 si trae TOTAL y QUITA). */
    claves: ClaveDelCaso[];
    claveInicialId: number;
    puedeCancelarConvenios: boolean;
    /** Sin este permiso, "Enviar" y "Descargar y enviar" quedan deshabilitados (el backend igual
     * responde 403 — esto es solo para no ofrecer una acción que va a fallar). */
    puedeEnviarEmail: boolean;
    onClose: () => void;
    /** Se dispara después de generar (con éxito o no: el convenio se crea igual): el padre recarga
     * claves, convenios, comentarios y el caso. */
    onGenerado: () => void;
}

const fmtMonto = (v: string | number) => Number(v).toLocaleString('es-AR', { minimumFractionDigits: 2 });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Resultado de un envío, ya clasificado — mismo criterio que `clasificarEnvio` del backend
 * (cupon.service.ts), para no repetir la lógica de "ok:true pero enviados:0 no es un éxito". */
type ClasificacionEnvio =
    | { tipo: 'enviado'; enviados: number }
    | { tipo: 'parcial'; enviados: number; omitidos: number }
    | { tipo: 'omitido'; omitidos: number }
    | { tipo: 'fallo'; motivo: string };

function clasificarEnvio(envio: NonNullable<GenerarCuponRespuesta['envio']>): ClasificacionEnvio {
    if (!envio.ok) return { tipo: 'fallo', motivo: envio.errores?.[0]?.error ?? 'motivo desconocido' };
    const omitidos = envio.omitidos?.length ?? 0;
    if (envio.enviados === 0 && omitidos > 0) return { tipo: 'omitido', omitidos };
    if (omitidos > 0) return { tipo: 'parcial', enviados: envio.enviados, omitidos };
    return { tipo: 'enviado', enviados: envio.enviados };
}

const GenerarCuponDialog: React.FC<Props> = ({
    open,
    deudorId,
    empresaId,
    claves,
    claveInicialId,
    puedeCancelarConvenios,
    puedeEnviarEmail,
    onClose,
    onGenerado,
}) => {
    const notify = useNotify();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

    const [claveId, setClaveId] = useState(claveInicialId);
    const [preview, setPreview] = useState<PreviewCuponRespuesta | null>(null);
    const [loadingPreview, setLoadingPreview] = useState(false);
    const [errorPreview, setErrorPreview] = useState<string | null>(null);
    const [pdfUrl, setPdfUrl] = useState<string | null>(null);
    const [confirmaAnular, setConfirmaAnular] = useState(false);
    const [generando, setGenerando] = useState<AccionCupon | null>(null);

    /** Resultado del último intento de envío, si no fue un éxito completo — el diálogo se queda
     * abierto mostrándolo (hallazgo de la auditoría, §4): antes se cerraba igual que si hubiera
     * salido todo bien, con un aviso de 4 segundos como única pista de que algo falló. */
    const [resultadoEnvio, setResultadoEnvio] = useState<{ clasificacion: ClasificacionEnvio; convenioId: number } | null>(null);

    // ─── Envío por mail (fase 3) ────────────────────────────────────────────────
    // La cuenta SMTP de la empresa se resuelve igual que en `EnviarEmailDialog`: sin selector, es la
    // que tenga asignada la empresa (`empresa.cuentaSmtpId`, ajustes > Empresas). Sin ella no hay
    // forma de mandar nada — el diálogo lo dice y deja Descargar.
    const [smtpConfigurado, setSmtpConfigurado] = useState<boolean | null>(null);
    /** Distinto de "sin cuenta configurada" (hallazgo de la auditoría, §10): si Sender no responde,
     * no sabemos si la empresa tiene cuenta o no — no podemos decir "no tiene cuenta configurada". */
    const [smtpError, setSmtpError] = useState<string | null>(null);
    // Falló solo la lista de plantillas: la cuenta existe y se puede mandar el mensaje por defecto.
    const [templatesError, setTemplatesError] = useState<string | null>(null);
    // La plantilla preseleccionada por la empresa, para distinguir su falla de la de una elegida a mano.
    const preseleccionRef = useRef<number | null>(null);
    const [templates, setTemplates] = useState<EmailTemplateListItem[]>([]);
    const [loadingTemplates, setLoadingTemplates] = useState(false);
    /** `true` recién cuando terminó de intentarse cargar `templates` (haya salido bien o mal) — para
     * no reconciliar `templateId` contra una lista todavía vacía por no haber terminado de pedirse
     * (hallazgo de la auditoría, §2: la carrera entre este pedido y el de `cargarPreview`, que trae
     * la preselección, es real). */
    const [templatesListo, setTemplatesListo] = useState(false);
    const [templateId, setTemplateId] = useState<number | ''>('');
    const [destinatarios, setDestinatarios] = useState<string[]>([]);
    const [destInput, setDestInput] = useState('');
    const [guardarComoContacto, setGuardarComoContacto] = useState(false);
    const [cargandoVariables, setCargandoVariables] = useState(false);
    /** Info de la plantilla elegida, recalculada cada vez que cambia `templateId` O `claveId` — por
     * eso vive aparte de `preview` (hallazgo de la auditoría, §3): antes colgaba de `preview`, que se
     * pisaba entero al cambiar de clave (TOTAL/QUITA) sin volver a pedir las variables de la plantilla
     * todavía elegida, y al volver a "sin plantilla" el aviso de variables faltantes quedaba pegado. */
    const [plantillaInfo, setPlantillaInfo] = useState<{
        plantilla: PreviewCuponRespuesta['plantilla'];
        variablesSinValor: string[];
        avisosPlantilla: string[];
        plantillaError: string | null;
    }>({ plantilla: null, variablesSinValor: [], avisosPlantilla: [], plantillaError: null });
    /** Aviso persistente cuando la plantilla PRESELECCIONADA (`cfg.templateCuponId`) resultó
     * inválida y se resetea sola a "Sin plantilla" (hallazgo de la auditoría, §2): separado de
     * `plantillaInfo.plantillaError` porque ese campo se limpia en cuanto `templateId` vuelve a
     * `''` — sin este aviso aparte, el operador no se enteraba de por qué el Select "ya no tenía
     * nada seleccionado". */
    const [preseleccionInvalidaMsg, setPreseleccionInvalidaMsg] = useState<string | null>(null);

    /** Para no pisar destinatarios tipeados a mano al cambiar de clave (hallazgo de la auditoría,
     * §10): la lista de sugeridos/principales solo se aplica la PRIMERA vez que carga el preview. */
    const destinatariosInicializados = useRef(false);

    useEffect(() => {
        if (open) {
            setClaveId(claveInicialId);
            setConfirmaAnular(false);
            setTemplateId('');
            setDestinatarios([]);
            setDestInput('');
            setGuardarComoContacto(false);
            setSmtpConfigurado(null);
            setSmtpError(null);
            setTemplates([]);
            setTemplatesListo(false);
            setResultadoEnvio(null);
            setPlantillaInfo({ plantilla: null, variablesSinValor: [], avisosPlantilla: [], plantillaError: null });
            setPreseleccionInvalidaMsg(null);
            destinatariosInicializados.current = false;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, claveInicialId]);

    const extraerMensaje = (err: unknown): string => {
        const data = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data;
        if (data?.message) return Array.isArray(data.message) ? data.message[0] : data.message;
        return (err as Error)?.message || 'No se pudo completar la operación.';
    };

    // La cuenta SMTP y las plantillas se piden una sola vez por apertura (no dependen de la clave
    // elegida) — solo si el usuario tiene el permiso, para no gastar un pedido que va a 403.
    const cargarSmtpYPlantillas = useCallback(async () => {
        if (!puedeEnviarEmail) return;
        setSmtpError(null);
        setTemplatesError(null);
        setTemplatesListo(false);
        try {
            const res = await emailApi.smtpDeEmpresa(empresaId);
            setSmtpConfigurado(!!res.smtp);
            if (!res.smtp) {
                setTemplatesListo(true); // sin cuenta no hay plantillas que traer — "terminado" igual
                return;
            }
            setLoadingTemplates(true);
            try {
                const tplRes = await emailApi.templatesDeEmpresa(empresaId);
                setTemplates(tplRes.templates);
            } catch (err) {
                // Tiene cuenta, pero no se pudo traer la lista de plantillas — se puede seguir sin
                // plantilla (mensaje por defecto): el formulario queda visible con un aviso propio, no
                // con el error de "no se pudo comprobar la cuenta".
                setTemplatesError(extraerMensaje(err));
            } finally {
                setLoadingTemplates(false);
                setTemplatesListo(true);
            }
        } catch (err) {
            // Hallazgo de la auditoría (§10): esto puede ser "la empresa no tiene cuenta" (200 con
            // `smtp:null`, ya cubierto arriba) o "Sender no respondió" (esto, un error de verdad) — no
            // son lo mismo, y decir "no tiene cuenta configurada" cuando en realidad no se pudo
            // comprobar nada es engañoso.
            setSmtpConfigurado(null);
            setSmtpError(extraerMensaje(err));
            setTemplatesListo(true);
        }
    }, [puedeEnviarEmail, empresaId]);

    useEffect(() => {
        if (!open) return;
        cargarSmtpYPlantillas();
    }, [open, cargarSmtpYPlantillas]);

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
            // Los destinatarios ya cargados como contacto arrancan tildados — igual criterio que
            // `EnviarEmailDialog` (el principal, o todos si ninguno es principal) — pero solo la
            // primera vez: cambiar de clave (TOTAL/QUITA) no puede pisar lo que el operador ya tipeó.
            if (!destinatariosInicializados.current) {
                destinatariosInicializados.current = true;
                if (datos.destinatariosDisponibles.length > 0) {
                    const principales = datos.destinatariosDisponibles.filter((d) => d.principal).map((d) => d.valor);
                    if (principales.length > 0) setDestinatarios(principales);
                }
                // La plantilla preseleccionada de la empresa (`cfg.templateCuponId`) solo se aplica
                // en la primera carga — el Select mismo la descarta si no aparece en `templates`.
                if (datos.cfg.templateCuponId != null) {
                    preseleccionRef.current = datos.cfg.templateCuponId;
                    setTemplateId(datos.cfg.templateCuponId);
                }
            }
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

    // Se recalcula cada vez que cambia la plantilla elegida O la clave (hallazgo de la auditoría,
    // §3): sin plantilla, se limpia enseguida (nunca queda un aviso viejo pegado); con plantilla, se
    // vuelve a pedir el preview con `templateId` para la clave ACTUAL — el backend es la fuente de
    // verdad (mismo mapeo que usaría el envío real).
    useEffect(() => {
        if (!open) return;
        if (!templateId) {
            setPlantillaInfo({ plantilla: null, variablesSinValor: [], avisosPlantilla: [], plantillaError: null });
            // Si se sale de una plantilla con el preview todavía en vuelo, el cleanup cancela ese
            // `finally` y nadie más apaga el spinner: Enviar quedaba deshabilitado para siempre.
            setCargandoVariables(false);
            return;
        }
        let cancel = false;
        setCargandoVariables(true);
        multiclavesApi
            .previewCupon(claveId, deudorId, Number(templateId))
            .then((res) => {
                if (cancel) return;
                if (res.plantillaError) {
                    // La plantilla (elegida a mano, o preseleccionada por `cfg.templateCuponId`) no
                    // se pudo resolver en Sender — hallazgo de la auditoría, §2: antes el `<Select>`
                    // quedaba MOSTRANDO "Sin plantilla" (por `templateIdMostrado`, que descarta lo que
                    // no está en `templates`) mientras el estado real (`templateId`) seguía apuntando
                    // al id inválido, así que "Enviar" quedaba deshabilitado para siempre sin que
                    // hubiera nada que el operador pudiera cambiar en la UI para arreglarlo. Ahora se
                    // resetea el estado de verdad — Select y estado quedan iguales — y el aviso queda
                    // aparte (`preseleccionInvalidaMsg`) para no perderse cuando `templateId` vuelve a
                    // `''` y limpia `plantillaInfo`.
                    setPreseleccionInvalidaMsg(
                        Number(templateId) === preseleccionRef.current
                            ? res.plantillaError
                            : 'La plantilla elegida no se pudo usar (ya no existe en Sender, o Sender no respondió): elegí otra o mandalo sin plantilla.',
                    );
                    setTemplateId('');
                    return;
                }
                setPreseleccionInvalidaMsg(null);
                setPlantillaInfo({
                    plantilla: res.plantilla,
                    variablesSinValor: res.variablesSinValor,
                    avisosPlantilla: res.avisosPlantilla,
                    plantillaError: null,
                });
            })
            .catch((err) => {
                if (cancel) return;
                notify.error(err as Error);
                setPlantillaInfo({ plantilla: null, variablesSinValor: [], avisosPlantilla: [], plantillaError: 'No se pudo comprobar esta plantilla.' });
            })
            .finally(() => {
                if (!cancel) setCargandoVariables(false);
            });
        return () => {
            cancel = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, templateId, claveId, deudorId]);

    // Reconciliación extra (hallazgo de la auditoría, §2): si la plantilla preseleccionada
    // (`cfg.templateCuponId`) ya no aparece en `templates` — cambió de cuenta SMTP, se archivó, lo que
    // sea — pero Sender la sigue resolviendo sin `plantillaError` (por eso el efecto de arriba no la
    // agarra), igual hay que resetear: si no, el `<Select>` muestra "Sin plantilla" (por
    // `templateIdMostrado`, que ya descarta lo que no está en `templates`) mientras el estado real
    // sigue apuntando a una plantilla que `ejecutar()` de todos modos no va a mandar — y los avisos de
    // variables quedan describiendo una plantilla que nunca se va a usar. Se espera a `templatesListo`
    // para no disparar en falso mientras la lista todavía se está pidiendo.
    useEffect(() => {
        if (!open || templateId === '' || !templatesListo) return;
        if (!templates.some((t) => t.id === templateId)) {
            setPreseleccionInvalidaMsg('La plantilla configurada para esta empresa ya no está disponible: se arma el mensaje por defecto.');
            setTemplateId('');
        }
    }, [open, templateId, templates, templatesListo]);

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

    const addDestinatario = (valor: string) => {
        const trimmed = valor.trim().replace(/,$/, '').trim();
        if (!trimmed) return;
        if (!EMAIL_RE.test(trimmed)) {
            notify.error(`"${trimmed}" no es un email válido`);
            return;
        }
        if (destinatarios.includes(trimmed)) return;
        setDestinatarios([...destinatarios, trimmed]);
        setDestInput('');
    };

    const removeDestinatario = (valor: string) => {
        setDestinatarios(destinatarios.filter((d) => d !== valor));
    };

    // La plantilla elegida en el Select nunca puede apuntar a un id que no está en `templates` — si
    // la preselección de la empresa (`cfg.templateCuponId`) ya no existe ahí, el `<Select>` de MUI
    // rompería con un value fuera de rango en vez de mostrar limpio "Sin plantilla" (hallazgo de la
    // auditoría, §5).
    const templateIdValido = templateId !== '' && templates.some((t) => t.id === templateId);
    const templateIdMostrado = templateIdValido ? templateId : '';

    const puedeEnviar =
        puedeEnviarEmail === true &&
        smtpConfigurado === true &&
        smtpError === null &&
        destinatarios.length > 0 &&
        !cargandoVariables &&
        plantillaInfo.plantillaError === null &&
        plantillaInfo.variablesSinValor.length === 0;

    const descargarBlob = async (convenioId: number) => {
        const pdf = await multiclavesApi.descargarCupon(convenioId);
        const url = window.URL.createObjectURL(new Blob([pdf.data], { type: 'application/pdf' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `cupon-${claveActual?.tipo === 'TOTAL' ? 'saldo-total' : 'quita'}-${convenioId}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
    };

    const ejecutar = useCallback(
        async (accion: AccionCupon) => {
            setGenerando(accion);
            setResultadoEnvio(null);
            try {
                const res = await multiclavesApi.generarCupon(claveId, {
                    deudorId,
                    accion,
                    reemplazarConvenioActivo: necesitaConfirmarAnulacion ? true : undefined,
                    destinatarios: accion !== 'DESCARGAR' ? destinatarios : undefined,
                    templateId: accion !== 'DESCARGAR' && templateIdValido ? Number(templateId) : undefined,
                    guardarEmailComoContacto: accion !== 'DESCARGAR' ? guardarComoContacto : undefined,
                });

                if (res.descargaUrl) {
                    await descargarBlob(res.convenioId);
                }

                // El convenio se creó (o se reusó) pase lo que pase con el mail — el padre tiene que
                // refrescar la ficha en los dos casos, no solo cuando todo salió perfecto.
                onGenerado();

                const clasificacion = res.envio ? clasificarEnvio(res.envio) : null;

                if (!clasificacion || clasificacion.tipo === 'enviado') {
                    // Sin envío (DESCARGAR) o envío 100% exitoso: el flujo de siempre, se cierra solo.
                    const partes: string[] = [
                        res.convenioReusado ? 'El cupón ya estaba generado.' : res.convenioAnuladoId ? 'Cupón generado. Se anuló el convenio de la otra clave.' : 'Cupón generado.',
                    ];
                    if (res.descargaUrl) partes.push('Descargado.');
                    if (clasificacion) partes.push(`Enviado a ${clasificacion.enviados} destinatario${clasificacion.enviados === 1 ? '' : 's'}.`);
                    notify.success(partes.join(' '));
                    onClose();
                    return;
                }

                // Envío parcial, omitido o fallido: el convenio quedó bien, pero el diálogo se queda
                // abierto con el detalle — nunca se cierra como si no hubiera pasado nada (hallazgo de
                // la auditoría, §4). Se ofrece reintentar Enviar (reusa el convenio) y seguir
                // teniendo Descargar a mano.
                setResultadoEnvio({ clasificacion, convenioId: res.convenioId });
                if (clasificacion.tipo === 'fallo') {
                    notify.error(`El envío por mail falló: ${clasificacion.motivo}. El cupón quedó generado — podés descargarlo o reintentar el envío.`);
                } else if (clasificacion.tipo === 'omitido') {
                    notify.warning('No se envió a nadie: todos los destinatarios están dados de baja. El cupón quedó generado.');
                } else {
                    notify.warning(`Enviado a ${clasificacion.enviados}, pero ${clasificacion.omitidos} destinatario(s) están dados de baja.`);
                }
            } catch (err) {
                notify.error(err as Error);
            } finally {
                setGenerando(null);
            }
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [claveId, deudorId, necesitaConfirmarAnulacion, destinatarios, templateId, templateIdValido, guardarComoContacto, claveActual, notify, onGenerado, onClose],
    );

    const templateSeleccionado = useMemo(
        () => templates.find((t) => t.id === templateId) ?? null,
        [templates, templateId],
    );

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
                                height: { xs: 260, sm: 360 },
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

                        {resultadoEnvio && (
                            <Alert
                                severity={resultadoEnvio.clasificacion.tipo === 'fallo' ? 'error' : 'warning'}
                                onClose={() => setResultadoEnvio(null)}
                            >
                                {resultadoEnvio.clasificacion.tipo === 'fallo' && (
                                    <>El envío por mail <strong>FALLÓ</strong>: {resultadoEnvio.clasificacion.motivo}. El cupón ya está generado — descargalo o reintentá el envío.</>
                                )}
                                {resultadoEnvio.clasificacion.tipo === 'omitido' && (
                                    <>No se envió a nadie: todos los destinatarios están dados de baja. El cupón ya está generado.</>
                                )}
                                {resultadoEnvio.clasificacion.tipo === 'parcial' && (
                                    <>
                                        Enviado a {resultadoEnvio.clasificacion.enviados}; {resultadoEnvio.clasificacion.omitidos} destinatario
                                        {resultadoEnvio.clasificacion.omitidos === 1 ? '' : 's'} dado{resultadoEnvio.clasificacion.omitidos === 1 ? '' : 's'} de baja.
                                    </>
                                )}
                            </Alert>
                        )}

                        {puedeEnviarEmail && (
                            <>
                                <Divider />
                                <Typography variant="subtitle2">Enviar por mail</Typography>

                                {smtpError ? (
                                    <Alert
                                        severity="error"
                                        action={
                                            <Button color="inherit" size="small" onClick={cargarSmtpYPlantillas}>
                                                Reintentar
                                            </Button>
                                        }
                                    >
                                        No se pudo comprobar la cuenta de mail de la empresa (Sender no respondió): {smtpError}
                                    </Alert>
                                ) : smtpConfigurado === null ? (
                                    <Stack direction="row" alignItems="center" spacing={1}>
                                        <CircularProgress size={16} />
                                        <Typography variant="caption" color="text.secondary">
                                            Comprobando la cuenta de mail de la empresa…
                                        </Typography>
                                    </Stack>
                                ) : smtpConfigurado === false ? (
                                    <Alert severity="info">
                                        La empresa no tiene una cuenta de mail configurada (Ajustes → Empresas). Por
                                        ahora solo se puede descargar.
                                    </Alert>
                                ) : (
                                    <Stack spacing={1.5}>
                                        <Box>
                                            {preview.destinatariosDisponibles.length > 0 && (
                                                <Stack direction="row" spacing={0.5} flexWrap="wrap" mb={1}>
                                                    {preview.destinatariosDisponibles.map((d) => {
                                                        const ya = destinatarios.includes(d.valor);
                                                        return (
                                                            <Chip
                                                                key={d.id}
                                                                label={`${d.valor}${d.principal ? ' (principal)' : ''}`}
                                                                size="small"
                                                                color={ya ? 'primary' : 'default'}
                                                                onClick={() => (ya ? removeDestinatario(d.valor) : addDestinatario(d.valor))}
                                                                sx={{ mb: 0.5 }}
                                                            />
                                                        );
                                                    })}
                                                </Stack>
                                            )}
                                            <Stack direction="row" spacing={1} flexWrap="wrap" mb={1}>
                                                {destinatarios
                                                    .filter((d) => !preview.destinatariosDisponibles.some((x) => x.valor === d))
                                                    .map((d) => (
                                                        <Chip key={d} label={d} size="small" onDelete={() => removeDestinatario(d)} sx={{ mb: 0.5 }} />
                                                    ))}
                                            </Stack>
                                            <TextField
                                                label="Agregar destinatario"
                                                placeholder="email@ejemplo.com (Enter o coma para confirmar)"
                                                value={destInput}
                                                onChange={(e) => setDestInput(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter' || e.key === ',') {
                                                        e.preventDefault();
                                                        addDestinatario(destInput);
                                                    }
                                                }}
                                                onBlur={() => destInput.trim() && addDestinatario(destInput)}
                                                size="small"
                                                fullWidth
                                            />
                                            <FormControlLabel
                                                sx={{ mt: 0.5 }}
                                                control={
                                                    <Checkbox
                                                        size="small"
                                                        checked={guardarComoContacto}
                                                        onChange={(e) => setGuardarComoContacto(e.target.checked)}
                                                    />
                                                }
                                                label={<Typography variant="caption">Guardar el destinatario tipeado como contacto del caso</Typography>}
                                            />
                                        </Box>

                                        {templatesError && (
                                            <Alert
                                                severity="warning"
                                                sx={{ py: 0.5 }}
                                                action={
                                                    <Button color="inherit" size="small" onClick={cargarSmtpYPlantillas}>
                                                        Reintentar
                                                    </Button>
                                                }
                                            >
                                                No se pudo traer la lista de plantillas ({templatesError}). Podés mandar el mensaje por defecto.
                                            </Alert>
                                        )}

                                        {preseleccionInvalidaMsg && (
                                            <Alert severity="warning" sx={{ py: 0.5 }} onClose={() => setPreseleccionInvalidaMsg(null)}>
                                                {preseleccionInvalidaMsg}
                                            </Alert>
                                        )}

                                        <TextField
                                            select
                                            label="Plantilla de mail (opcional)"
                                            size="small"
                                            fullWidth
                                            value={templateIdMostrado}
                                            disabled={loadingTemplates}
                                            helperText={
                                                templateIdMostrado
                                                    ? 'Las variables del cupón (importe, vencimiento, tipo, trámite, cliente) se completan solas.'
                                                    : 'Sin plantilla se manda un mensaje simple con el PDF adjunto.'
                                            }
                                            onChange={(e) => setTemplateId(e.target.value === '' ? '' : Number(e.target.value))}
                                        >
                                            <MenuItem value="">
                                                <em>Sin plantilla — mensaje por defecto</em>
                                            </MenuItem>
                                            {templates.map((t) => (
                                                <MenuItem key={t.id} value={t.id}>
                                                    {t.nombre}
                                                </MenuItem>
                                            ))}
                                        </TextField>

                                        {cargandoVariables && (
                                            <Stack direction="row" alignItems="center" spacing={1}>
                                                <CircularProgress size={14} />
                                                <Typography variant="caption" color="text.secondary">
                                                    Comprobando las variables de "{templateSeleccionado?.nombre}"…
                                                </Typography>
                                            </Stack>
                                        )}

                                        {!cargandoVariables && plantillaInfo.plantillaError && (
                                            <Alert severity="error" sx={{ py: 0.5 }}>
                                                {plantillaInfo.plantillaError}
                                            </Alert>
                                        )}

                                        {!cargandoVariables && !plantillaInfo.plantillaError && plantillaInfo.variablesSinValor.length > 0 && (
                                            <Alert severity="warning" sx={{ py: 0.5 }}>
                                                Faltan datos para esta plantilla: {plantillaInfo.variablesSinValor.map((v) => `{{${v}}}`).join(', ')}.
                                                Elegí otra plantilla o mandalo sin plantilla.
                                            </Alert>
                                        )}

                                        {!cargandoVariables && plantillaInfo.avisosPlantilla.length > 0 && (
                                            <Alert severity="warning" sx={{ py: 0.5 }}>
                                                {plantillaInfo.avisosPlantilla.map((a, i) => (
                                                    <Typography key={i} variant="body2">
                                                        {a}
                                                    </Typography>
                                                ))}
                                            </Alert>
                                        )}
                                    </Stack>
                                )}
                            </>
                        )}
                    </Stack>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancelar</Button>
                <Button
                    variant={puedeEnviarEmail && smtpConfigurado === true ? 'text' : 'contained'}
                    startIcon={<DownloadIcon />}
                    disabled={!puedeConfirmar || generando !== null}
                    onClick={() => ejecutar('DESCARGAR')}
                >
                    {generando === 'DESCARGAR' ? 'Generando…' : 'Descargar'}
                </Button>
                {puedeEnviarEmail && smtpConfigurado === true && (
                    <>
                        <Button
                            startIcon={<SendIcon />}
                            disabled={!puedeConfirmar || !puedeEnviar || generando !== null}
                            onClick={() => ejecutar('ENVIAR')}
                        >
                            {generando === 'ENVIAR' ? 'Enviando…' : resultadoEnvio ? 'Reintentar envío' : 'Enviar'}
                        </Button>
                        <Button
                            variant="contained"
                            startIcon={<SendIcon />}
                            disabled={!puedeConfirmar || !puedeEnviar || generando !== null}
                            onClick={() => ejecutar('DESCARGAR_Y_ENVIAR')}
                        >
                            {generando === 'DESCARGAR_Y_ENVIAR' ? 'Enviando…' : 'Enviar y descargar'}
                        </Button>
                    </>
                )}
            </DialogActions>
        </Dialog>
    );
};

export default GenerarCuponDialog;
