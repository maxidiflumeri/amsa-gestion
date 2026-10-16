import React from 'react';
import { Chip, IconButton, Tooltip, useMediaQuery, useTheme } from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import { useNavigate } from 'react-router-dom';
import { useNotificaciones } from '../../../context/NotificacionesContext';
import { remesaDelChip, textoChipImportaciones } from '../../../utils/campanita';

/**
 * Lo que está importando, a la vista en la barra superior: "Importando 43 %" / "3 importaciones". No dibuja nada sin
 * cargas en curso. Sale de la misma lista que la campanita. En celular queda solo el ícono, con el texto como etiqueta.
 * Un clic lleva al detalle de la carga que está corriendo (o de la primera de la cola): la campanita ya abre las
 * notificaciones (16/10/2026, a pedido del usuario).
 * Vive dentro de `NotificacionesBell`, que ya consume el contexto: `AppBar` no lo consume, así la barra no se
 * redibuja con cada evento de progreso.
 */
const ChipImportaciones: React.FC = () => {
    const theme = useTheme();
    const celular = useMediaQuery(theme.breakpoints.down('sm'));
    const navigate = useNavigate();
    const { importsEnCurso } = useNotificaciones();
    const texto = textoChipImportaciones(importsEnCurso);
    const remesaId = remesaDelChip(importsEnCurso);
    if (texto === null || remesaId === null) return null;
    const irAlDetalle = () => navigate(`/historial-importaciones/${remesaId}`);

    if (celular) {
        return (
            <Tooltip title="Ver la importación en curso">
                <IconButton size="small" color="info" aria-label={texto} onClick={irAlDetalle}>
                    <CloudUploadIcon />
                </IconButton>
            </Tooltip>
        );
    }
    return (
        <Tooltip title="Ver la importación en curso">
            <Chip
                icon={<CloudUploadIcon />}
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
