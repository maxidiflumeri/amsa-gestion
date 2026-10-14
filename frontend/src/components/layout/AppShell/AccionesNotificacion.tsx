import React, { useRef, useState } from 'react';
import { Box, Button } from '@mui/material';
import { isAxiosError } from 'axios';
import { useAuth } from '../../../context/AuthContext';
import { useConfirm } from '../../../context/ConfirmContext';
import { useNotificaciones } from '../../../context/NotificacionesContext';
import { useNotify } from '../../../hooks/useNotify';
import type { NotificacionDto } from '../../../api/notificaciones';
import { descargarErroresCsv, obtenerEstadoCarga, retomarRemesa } from '../../../api/imports';
import type { EstadoCargaDto } from '../../../types/importProgreso';
import { accionesDeNotificacion, remesaDeNotificacion } from '../../../utils/campanita';
import { descargarBlob, mensajeDeErrorDeBlob } from '../../../utils/descargas';
import {
    TEXTO_RETOMAR_UNA,
    esRetomable,
    formatearNumero,
    motivoNoRetomablePorCorte,
    puedeGestionarCarga,
} from '../../../utils/estadoCarga';
import { TOPE_CSV } from '../../import/ErroresDeCarga';

interface AccionesNotificacionProps {
    notificacion: NotificacionDto;
}

const REMESA_ELIMINADA = 'Esta importación ya no existe.';

/**
 * Las acciones de una notificación de importación terminada (§16.8): "Descargar errores" y "Retomar".
 * Qué botones se OFRECEN lo decide el `payload` (una foto vieja); qué se HACE lo decide el estado real, que se consulta
 * antes de cada acción: la remesa pudo retomarse, eliminarse o cambiar desde que se creó la notificación.
 * Cada clic hace `stopPropagation`: la fila entera navega al detalle y marca la notificación como leída.
 */
const AccionesNotificacion: React.FC<AccionesNotificacionProps> = ({ notificacion }) => {
    const { usuario, tienePermiso } = useAuth();
    const confirm = useConfirm();
    const notify = useNotify();
    const { refrescar } = useNotificaciones();
    const [descargando, setDescargando] = useState(false);
    const [retomando, setRetomando] = useState(false);
    // Un segundo clic en la misma tarea llega antes de que React deshabilite el botón: la guarda real es esta.
    const enCurso = useRef({ descarga: false, retomar: false });

    const remesaId = remesaDeNotificacion(notificacion);
    const ofrece = accionesDeNotificacion(notificacion, tienePermiso);
    if (remesaId === null || (!ofrece.descargar && !ofrece.retomar)) return null;

    /** El estado real de la remesa, o null si ya no existe (se avisa) o la consulta falló (se avisa). */
    const consultar = async (): Promise<EstadoCargaDto | null> => {
        try {
            return await obtenerEstadoCarga(remesaId);
        } catch (err) {
            if (isAxiosError(err) && err.response?.status === 404) notify.warning(REMESA_ELIMINADA);
            else notify.error(err as Error);
            return null;
        }
    };

    const descargar = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (enCurso.current.descarga) return;
        enCurso.current.descarga = true;
        setDescargando(true);
        try {
            const real = await consultar();
            if (!real) return;
            const cantidad = (real.err ?? 0) + (real.advertencias ?? 0);
            if (cantidad === 0) {
                notify.info('Esta importación no tiene errores ni avisos para descargar.');
                return;
            }
            if (cantidad > TOPE_CSV) {
                const acepta = await confirm({
                    title: 'Descargar CSV',
                    description: `Esta carga tiene ${formatearNumero(cantidad)} errores y avisos. El archivo va a traer los primeros ${formatearNumero(TOPE_CSV)}.`,
                    confirmLabel: 'Descargar',
                });
                if (!acepta) return;
            }
            try {
                const blob = await descargarErroresCsv(remesaId, 'TODOS');
                descargarBlob(blob, `errores-remesa-${real.numeroRemesa}.csv`);
            } catch (err) {
                notify.error(await mensajeDeErrorDeBlob(err));
            }
        } finally {
            enCurso.current.descarga = false;
            setDescargando(false);
        }
    };

    const retomar = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (enCurso.current.retomar) return;
        enCurso.current.retomar = true;
        setRetomando(true);
        try {
            const real = await consultar();
            if (!real) return;
            if (real.enCurso) {
                notify.info('Esta importación ya está en curso.');
                return;
            }
            if (!esRetomable(real)) {
                notify.info(motivoNoRetomablePorCorte(real) ?? 'Esta importación ya no se puede retomar. Mirá su detalle.');
                return;
            }
            if (!puedeGestionarCarga(real, usuario?.id, tienePermiso)) {
                notify.info('Solo quien la cargó puede retomarla.');
                return;
            }
            if (!(await confirm(TEXTO_RETOMAR_UNA))) return;
            try {
                await retomarRemesa(remesaId);
                notify.info('Importación retomada: quedó en la cola.');
            } catch (err) {
                notify.error(err as Error);
            }
            // Haya salido bien o no, la campanita muestra el estado real (el pedido pudo surtir efecto).
            void refrescar();
        } finally {
            enCurso.current.retomar = false;
            setRetomando(false);
        }
    };

    return (
        <Box
            onClick={(e) => e.stopPropagation()}
            sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 0.75 }}
        >
            {ofrece.descargar && (
                <Button size="small" variant="outlined" disabled={descargando} onClick={descargar}>
                    Descargar errores
                </Button>
            )}
            {ofrece.retomar && (
                <Button size="small" variant="outlined" disabled={retomando} onClick={retomar}>
                    Retomar
                </Button>
            )}
        </Box>
    );
};

export default AccionesNotificacion;
