import React, { useRef } from 'react';
import { Alert, Stack } from '@mui/material';
import type { EstadoCargaDto } from '../../types/importProgreso';
import {
    EN_COLA_SIN_TOMAR_MIN,
    SIN_CAMBIOS_MIN,
    SIN_SENAL_AVISAR_MIN,
    SIN_SENAL_MIN,
    firmaDeAvance,
    minutosEnColaSinTomar,
    minutosSinSenal,
} from '../../utils/estadoCarga';
import { useAhora } from '../../hooks/useAhora';

interface Props {
    estado: EstadoCargaDto | null;
    conectado: boolean;
    /** Texto del aviso de falta de conexión; cambia según quién consulta y cada cuánto. */
    textoSinConexion?: string;
}

/**
 * Avisos de una carga en vivo, compartidos por el paso "Importando" del wizard y el detalle:
 * sin conexión en tiempo real, sin señal del servidor, en cola y nadie la toma, sin cambios y carga reiniciada
 * (docs/imports-progreso-realtime-spec.md §9.8.3).
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

    // "Sin cambios" se mide en este navegador: desde cuándo vio la misma fase, subfase y contadores.
    const firma = estado ? firmaDeAvance(estado) : '';
    const cambioRef = useRef<{ firma: string; desde: number }>({ firma: '', desde: Date.now() });
    if (cambioRef.current.firma !== firma) cambioRef.current = { firma, desde: Date.now() };

    const minutos =
        estado && enCurso
            ? minutosSinSenal(estado, medidaRef.current.recibidoEn, medidaRef.current.vistoEn, ahora)
            : null;
    const hayAvisoSinSenal = minutos !== null && minutos >= SIN_SENAL_MIN;

    // "La próxima" se mide desde que ESTA pantalla la vio como la próxima, no desde que se encoló.
    const esProxima = !!estado && enCurso && estado.fase === 'EN_COLA' && estado.enColaDelante === 0;
    const claveProxima = esProxima && estado ? `${estado.remesaId}` : '';
    const proximaRef = useRef<{ clave: string; desde: number }>({ clave: '', desde: Date.now() });
    if (proximaRef.current.clave !== claveProxima) proximaRef.current = { clave: claveProxima, desde: Date.now() };
    const minutosEnCola =
        estado && esProxima ? minutosEnColaSinTomar(estado, proximaRef.current.desde, ahora) : null;
    const hayAvisoEnCola = minutosEnCola !== null && minutosEnCola >= EN_COLA_SIN_TOMAR_MIN;

    // Con señal, y solo en PROCESANDO o POST_PROCESO. Sin señal no se sabe si avanza: se excluyen.
    const minutosSinCambios =
        estado && enCurso && (estado.fase === 'PROCESANDO' || estado.fase === 'POST_PROCESO') && !hayAvisoSinSenal
            ? Math.max(0, Math.floor((ahora - cambioRef.current.desde) / 60_000))
            : null;
    const hayAvisoSinCambios = minutosSinCambios !== null && minutosSinCambios >= SIN_CAMBIOS_MIN;

    // Sin conexión importa mientras la carga no terminó (o todavía no se sabe), también si aún no empezó.
    const mostrarSinConexion = !conectado && (estado === null || !estado.terminal);
    const hayReinicio = !!estado && estado.intentos > 1;
    // Una remesa heredada (sin fila de progreso, rev 0) no la ve el cierre automático.
    const esHeredada = !!estado && estado.rev === 0;

    if (!mostrarSinConexion && !hayAvisoSinSenal && !hayAvisoEnCola && !hayAvisoSinCambios && !hayReinicio) {
        return null;
    }

    return (
        <Stack spacing={1} sx={{ width: '100%', textAlign: 'left' }}>
            {mostrarSinConexion && <Alert severity="warning">{textoSinConexion}</Alert>}
            {hayAvisoSinSenal && (
                <Alert severity="warning" sx={{ overflowWrap: 'anywhere' }}>
                    {esHeredada
                        ? `El servidor no da señales de esta carga hace ${minutos} min. Puede estar en un paso largo o haberse interrumpido. Es una carga anterior al seguimiento automático y no se va a marcar como fallida sola: avisá a soporte.`
                        : minutos !== null && minutos >= SIN_SENAL_AVISAR_MIN
                        ? `El servidor no da señales de esta carga hace ${minutos} min y todavía no se marcó como fallida. Avisá a soporte.`
                        : `El servidor no da señales de esta carga hace ${minutos} min. Si no se recupera, en unos minutos se marca sola como fallida y vas a poder hacer otras importaciones; el motivo va a decir qué hacer con esta.`}
                </Alert>
            )}
            {hayAvisoEnCola && (
                <Alert severity="warning" sx={{ overflowWrap: 'anywhere' }}>
                    Esta carga es la próxima de la cola y el servidor no la tomó hace {minutosEnCola} min. Si sigue
                    así, avisá a soporte. Mientras no arranque, la podés eliminar desde el Historial.
                </Alert>
            )}
            {hayAvisoSinCambios && (
                <Alert severity="info" sx={{ overflowWrap: 'anywhere' }}>
                    El servidor sigue trabajando, pero esta carga no muestra avances hace {minutosSinCambios} min
                    (contados desde que abriste esta pantalla). Puede ser un paso largo. Si sigue así, avisá a soporte:
                    no se va a marcar como fallida sola.
                </Alert>
            )}
            {estado && hayReinicio && (
                <Alert severity="info">Esta carga se reinició (intento {estado.intentos}).</Alert>
            )}
        </Stack>
    );
};

export default AvisosCarga;
