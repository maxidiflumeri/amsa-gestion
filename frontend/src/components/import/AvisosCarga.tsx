import React, { useRef } from 'react';
import { Alert, Stack } from '@mui/material';
import type { EstadoCargaDto } from '../../types/importProgreso';
import { SIN_NOVEDADES_MIN, minutosSinNovedades } from '../../utils/estadoCarga';
import { useAhora } from '../../hooks/useAhora';

interface Props {
    estado: EstadoCargaDto | null;
    conectado: boolean;
    /** Texto del aviso de falta de conexión; cambia según quién consulta y cada cuánto. */
    textoSinConexion?: string;
}

/**
 * Avisos de una carga en vivo, compartidos por el paso "Importando" del wizard y el detalle:
 * sin conexión en tiempo real, sin novedades del servidor y carga reiniciada.
 */
const AvisosCarga: React.FC<Props> = ({
    estado,
    conectado,
    textoSinConexion = 'Sin conexión en tiempo real. El estado se actualiza cada 10 segundos.',
}) => {
    const enCurso = estado?.enCurso === true;
    const ahora = useAhora(enCurso);

    // Edad del último latido: con la hora del servidor que trae el DTO (más lo que pasó desde que llegó), o,
    // si no la trae, desde que ESTE navegador vio cambiar `rev` o `heartbeatAt`. Cada DTO nuevo es un objeto nuevo.
    const claveNovedad = estado ? `${estado.remesaId}:${estado.rev}:${estado.heartbeatAt ?? ''}` : '';
    const medidaRef = useRef<{ dto: unknown; recibidoEn: number; clave: string; vistoEn: number }>({
        dto: null,
        recibidoEn: Date.now(),
        clave: '',
        vistoEn: Date.now(),
    });
    if (medidaRef.current.dto !== estado) {
        const ahoraReal = Date.now();
        medidaRef.current = {
            dto: estado,
            recibidoEn: ahoraReal,
            clave: claveNovedad,
            vistoEn: medidaRef.current.clave === claveNovedad ? medidaRef.current.vistoEn : ahoraReal,
        };
    }

    const minutos =
        estado && enCurso
            ? minutosSinNovedades(estado, medidaRef.current.recibidoEn, medidaRef.current.vistoEn, ahora)
            : null;
    // Sin conexión importa mientras la carga no terminó (o todavía no se sabe), también si aún no empezó.
    const mostrarSinConexion = !conectado && (estado === null || !estado.terminal);

    if (!mostrarSinConexion && (minutos === null || minutos < SIN_NOVEDADES_MIN) && !(estado && estado.intentos > 1)) {
        return null;
    }

    return (
        <Stack spacing={1} sx={{ width: '100%', textAlign: 'left' }}>
            {mostrarSinConexion && <Alert severity="warning">{textoSinConexion}</Alert>}
            {minutos !== null && minutos >= SIN_NOVEDADES_MIN && (
                <Alert severity="warning">
                    Sin novedades del servidor hace {minutos} min. La carga puede estar en un paso largo o
                    haberse interrumpido.
                </Alert>
            )}
            {estado && estado.intentos > 1 && (
                <Alert severity="info">Esta carga se reinició (intento {estado.intentos}).</Alert>
            )}
        </Stack>
    );
};

export default AvisosCarga;
