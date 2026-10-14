import React, { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import { isAxiosError } from 'axios';
import { getReversion, pedirReversion } from '../../../api/imports';
import { useNotify } from '../../../hooks/useNotify';
import type { ReversionAccionDto } from '../../../types/reversionAccion';
import { TEXTO_REVERSION_SIN_RESPUESTA, codigoDeError, respuestaPerdida } from '../../../utils/estadoCarga';
import { lineasDeCobertura, reversionActiva, TEXTO_REVERSION_PEDIDA, TEXTO_YA_REVERTIDA, textoDeMotivo } from '../../../utils/reversionAccion';

/** Texto con `**negrita**`. */
function conNegrita(texto: string): React.ReactNode[] {
    return texto.split('**').map((parte, i) => (i % 2 === 1 ? <strong key={i}>{parte}</strong> : <React.Fragment key={i}>{parte}</React.Fragment>));
}

interface Props {
    /** La remesa a revertir. null = cerrado. */
    remesaId: number | null;
    onCerrar: () => void;
    /** Lo que devolvió el pedido (202 o 200): quien llama actualiza su pantalla. */
    onPedida: (dto: ReversionAccionDto) => void;
    /** El pedido falló: quien llama vuelve a leer lo que muestra, porque pudo haber surtido efecto. */
    onFallo: () => void;
}

/**
 * Revertir una acción masiva (docs/imports-progreso-c3-spec.md §17.6 y §17.8): antes de confirmar, dice cuántos casos cubre.
 * Confirmar pone la reversión en la cola y cierra; el avance se ve en el Historial y en el detalle.
 */
export default function DialogoRevertirAccion({ remesaId, onCerrar, onPedida, onFallo }: Props) {
    const notify = useNotify();
    const [dto, setDto] = useState<ReversionAccionDto | null>(null);
    const [cargando, setCargando] = useState(false);
    const [falloLectura, setFalloLectura] = useState<string | null>(null);
    const [enviando, setEnviando] = useState(false);
    const enviandoRef = useRef(false);
    const idRef = useRef(remesaId);
    idRef.current = remesaId;

    const leer = async (id: number) => {
        setCargando(true);
        setFalloLectura(null);
        try {
            const r = await getReversion(id);
            if (idRef.current === id) setDto(r);
        } catch (err) {
            if (idRef.current !== id) return;
            const msg = isAxiosError(err) ? (err.response?.data as { message?: unknown } | undefined)?.message : null;
            setFalloLectura(typeof msg === 'string' && msg !== '' ? msg : 'No se pudo calcular qué cubre la reversión. Probá de nuevo.');
        } finally {
            if (idRef.current === id) setCargando(false);
        }
    };

    useEffect(() => {
        setDto(null);
        setFalloLectura(null);
        enviandoRef.current = false;
        setEnviando(false);
        if (remesaId !== null) void leer(remesaId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [remesaId]);

    const confirmar = async () => {
        if (remesaId === null || enviandoRef.current || !dto?.revertible) return;
        enviandoRef.current = true;
        setEnviando(true);
        try {
            const r = await pedirReversion(remesaId);
            onPedida(r);
            if (r.reversion?.estado === 'TERMINADA') notify.success(TEXTO_YA_REVERTIDA);
            else notify.success(TEXTO_REVERSION_PEDIDA);
            onCerrar();
        } catch (err) {
            // Un código que la pantalla conoce trae su texto (también un 503 REVERSION_NO_ENCOLADA); sin respuesta, la
            // reversión puede haber quedado en la cola: no se ofrece reintentar a ciegas.
            notify.error(codigoDeError(err) === null && respuestaPerdida(err) ? TEXTO_REVERSION_SIN_RESPUESTA : (err as Error));
            onFallo();
            onCerrar();
        } finally {
            enviandoRef.current = false;
            setEnviando(false);
        }
    };

    const motivo = dto ? textoDeMotivo(dto.motivo) : null;
    const puedeConfirmar = dto !== null && dto.revertible && !cargando && !enviando && !reversionActiva(dto.reversion);
    const errorDeIntentoAnterior = dto?.reversion && (dto.reversion.estado === 'FALLIDA' || dto.reversion.estado === 'INTERRUMPIDA') ? dto.reversion.error : null;

    return (
        <Dialog open={remesaId !== null} onClose={() => !enviando && onCerrar()} maxWidth="sm" fullWidth>
            <DialogTitle>Revertir acción masiva</DialogTitle>
            <DialogContent dividers sx={{ textAlign: 'left' }}>
                {cargando && (
                    <Box display="flex" alignItems="center" gap={1.5}>
                        <CircularProgress size={18} />
                        <Typography variant="body2">Calculando qué se va a deshacer…</Typography>
                    </Box>
                )}
                {falloLectura !== null && (
                    <Alert
                        severity="error"
                        sx={{ overflowWrap: 'anywhere' }}
                        action={remesaId !== null ? <Button color="inherit" size="small" onClick={() => void leer(remesaId)}>Reintentar</Button> : undefined}
                    >
                        {falloLectura}
                    </Alert>
                )}
                {!cargando && dto !== null && !dto.revertible && (
                    <Alert severity="warning" sx={{ overflowWrap: 'anywhere' }}>{motivo ?? 'Esta acción masiva no se puede revertir.'}</Alert>
                )}
                {!cargando && dto !== null && dto.revertible && (
                    <>
                        {errorDeIntentoAnterior != null && errorDeIntentoAnterior !== '' && (
                            <Alert severity="warning" sx={{ mb: 1.5, overflowWrap: 'anywhere' }}>
                                La reversión anterior no terminó: {errorDeIntentoAnterior}
                            </Alert>
                        )}
                        {lineasDeCobertura(dto.cobertura).map((linea, i) => (
                            <Typography key={i} variant="body2" sx={{ mb: 1, overflowWrap: 'anywhere' }}>
                                {conNegrita(linea)}
                            </Typography>
                        ))}
                    </>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onCerrar} disabled={enviando}>{dto !== null && !dto.revertible ? 'Cerrar' : 'Cancelar'}</Button>
                <Button onClick={() => void confirmar()} color="warning" variant="contained" disabled={!puedeConfirmar}>
                    {enviando ? 'Revirtiendo...' : 'Revertir'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
