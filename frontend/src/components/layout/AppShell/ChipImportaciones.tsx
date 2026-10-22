import React from 'react';
import { Chip, IconButton, Tooltip, useMediaQuery, useTheme } from '@mui/material';
import { CloudUpload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import { useNotificaciones } from '../../../context/NotificacionesContext';
import { remesaDelChip, textoChipImportaciones } from '../../../utils/campanita';

/**
 * Lo que está importando, a la vista en la barra superior: "Importando 43 %" / "3 importaciones". No dibuja nada sin
 * cargas en curso. Sale de la misma lista que la campanita. En celular queda solo el ícono, con el texto como etiqueta.
 * Un clic abre el paso "Importando" del asistente con la carga que está corriendo (o la primera de la cola), y si es
 * una división, con todas sus remesas (`/carga?seguir=<remesaId>`). Sin permiso para importar, lleva al detalle de
 * esa remesa. La campanita ya abre las notificaciones (16/10/2026, a pedido del usuario).
 * Vive dentro de `NotificacionesBell`, que ya consume el contexto: `AppBar` no lo consume, así la barra no se
 * redibuja con cada evento de progreso.
 */
const ChipImportaciones: React.FC = () => {
    const theme = useTheme();
    const celular = useMediaQuery(theme.breakpoints.down('sm'));
    const navigate = useNavigate();
    const { tienePermiso } = useAuth();
    const { importsEnCurso } = useNotificaciones();
    const texto = textoChipImportaciones(importsEnCurso);
    const remesaId = remesaDelChip(importsEnCurso);
    if (texto === null || remesaId === null) return null;
    const irAlDetalle = () =>
        navigate(tienePermiso('importacion.ejecutar') ? `/carga?seguir=${remesaId}` : `/historial-importaciones/${remesaId}`);

    if (celular) {
        return (
            <Tooltip title="Ver la importación en curso">
                <IconButton size="small" color="info" aria-label={texto} onClick={irAlDetalle}>
                    <CloudUpload size={20} strokeWidth={1.75} aria-hidden />
                </IconButton>
            </Tooltip>
        );
    }
    return (
        <Tooltip title="Ver la importación en curso">
            <Chip
                icon={<CloudUpload size={16} strokeWidth={1.75} aria-hidden />}
                label={texto}
                size="small"
                color="info"
                variant="outlined"
                onClick={irAlDetalle}
                sx={{ mr: 0.5 }}
            />
        </Tooltip>
    );
};

export default ChipImportaciones;
