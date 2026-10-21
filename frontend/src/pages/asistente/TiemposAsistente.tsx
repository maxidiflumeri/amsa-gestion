import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, CircularProgress, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { asistenteApi } from '../../api/asistente';
import { SectionCard } from '../../components/ui';
import { etiquetaPaso, formatearEntero, formatearMs } from '../../components/asistente/formatoDetalle';
import type { TiemposAsistente as Tiempos } from '../../types/asistente';

const ERROR_TIEMPOS = 'No se pudieron cargar los tiempos de amaIA. Probá de nuevo en un rato.';

/** El `mensaje` (o `message`) que mandó el backend; si no hay, o es el genérico en inglés de un 500, un texto en castellano. */
function textoDeError(e: unknown): string {
    const datos = (e as { response?: { data?: { mensaje?: string | string[]; message?: string | string[] } } }).response?.data;
    const crudo = datos?.mensaje ?? datos?.message;
    const msg = Array.isArray(crudo) ? crudo[0] : crudo;
    if (typeof msg !== 'string' || msg.trim() === '' || /^internal server error$/i.test(msg.trim())) return ERROR_TIEMPOS;
    return msg;
}

interface Props {
    /** `YYYY-MM`, el del selector de la pantalla. */
    mes: string;
    /** El mes dicho en palabras para el texto de «vacío» («octubre de 2026»). */
    mesLegible: string;
}

/**
 * La tarjeta «Tiempos por paso» de Consumo (docs/asistente-detalle-spec.md §12.4): la mediana y el p95 de cada paso, por función.
 * Se carga sola y aparte del consumo: si falla, el error queda dentro de la tarjeta y el resto de la pantalla sigue.
 */
const TiemposAsistente: React.FC<Props> = ({ mes, mesLegible }) => {
    const [datos, setDatos] = useState<Tiempos | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [cargando, setCargando] = useState(true);

    // Solo cuenta la última respuesta que se pidió (el mes pudo cambiar mientras tanto) y solo si la tarjeta sigue montada.
    const montado = useRef(true);
    const secuencia = useRef(0);
    const mesPedido = useRef<string | null>(null);
    useEffect(() => {
        montado.current = true;
        return () => { montado.current = false; };
    }, []);

    const cargar = useCallback(async (m: string) => {
        const mia = ++secuencia.current;
        const vigente = () => montado.current && mia === secuencia.current;
        setCargando(true);
        setError(null);
        try {
            const r = await asistenteApi.tiemposConsumo(m || undefined);
            if (vigente()) setDatos(r);
        } catch (e) {
            if (vigente()) setError(textoDeError(e));
        } finally {
            if (vigente()) setCargando(false);
        }
    }, []);

    useEffect(() => {
        // Una sola vez por mes: el doble montaje del modo estricto no repite el pedido.
        if (mesPedido.current === mes) return;
        mesPedido.current = mes;
        void cargar(mes);
    }, [mes, cargar]);

    const filasConDatos = (datos?.porFuncion ?? []).filter((f) => f.filas.length > 0);

    return (
        <SectionCard
            title="Tiempos por paso"
            subtitle="Mediana y p95 de cada paso, por función. Salen del detalle de las respuestas, que se borra a los 90 días con su conversación."
        >
            {cargando && <CircularProgress size={20} aria-label="Cargando los tiempos" />}
            {error && (
                <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void cargar(mes)}>Reintentar</Button>}>{error}</Alert>
            )}
            {!cargando && !error && datos && filasConDatos.length === 0 && (
                <Typography variant="body2" color="text.secondary">Todavía no hay respuestas medidas en {mesLegible}.</Typography>
            )}
            {!error && datos && filasConDatos.length > 0 && (
                <Stack spacing={2}>
                    {datos.recortado && <Typography variant="caption" color="text.secondary">Sobre las últimas 5.000 respuestas del mes.</Typography>}
                    {filasConDatos.map((f) => (
                        <div key={f.funcion}>
                            <Typography variant="subtitle2" sx={{ mb: 0.5, overflowWrap: 'anywhere' }}>{f.nombre}</Typography>
                            <TableContainer>
                                <Table size="small" aria-label={`Tiempos por paso de ${f.nombre}`}>
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>Paso</TableCell>
                                            <TableCell align="right">Veces</TableCell>
                                            <TableCell align="right">Mediana</TableCell>
                                            <TableCell align="right">p95</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {f.filas.map((fila) => (
                                            <TableRow key={`${fila.paso}-${fila.herramienta ?? ''}`}>
                                                <TableCell>{etiquetaPaso(fila.paso, fila.herramienta)}</TableCell>
                                                <TableCell align="right">{formatearEntero(fila.muestras)}</TableCell>
                                                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{formatearMs(fila.medianaMs)}</TableCell>
                                                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{formatearMs(fila.p95Ms)}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        </div>
                    ))}
                </Stack>
            )}
        </SectionCard>
    );
};

export default TiemposAsistente;
