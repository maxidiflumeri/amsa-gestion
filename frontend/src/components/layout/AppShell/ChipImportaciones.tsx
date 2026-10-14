import React from 'react';
import { Chip, IconButton, useMediaQuery, useTheme } from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import { useNotificaciones } from '../../../context/NotificacionesContext';
import { textoChipImportaciones } from '../../../utils/campanita';

interface ChipImportacionesProps {
    /** Abre la campanita (el estado de apertura es de `NotificacionesBell`). */
    onAbrir: () => void;
}

/**
 * Lo que está importando, a la vista en la barra superior: "Importando 43 %" / "3 importaciones". No dibuja nada sin
 * cargas en curso. Sale de la misma lista que la campanita. En celular queda solo el ícono, con el texto como etiqueta.
 * Vive dentro de `NotificacionesBell`, que ya consume el contexto: `AppBar` no lo consume, así la barra no se
 * redibuja con cada evento de progreso.
 */
const ChipImportaciones: React.FC<ChipImportacionesProps> = ({ onAbrir }) => {
    const theme = useTheme();
    const celular = useMediaQuery(theme.breakpoints.down('sm'));
    const { importsEnCurso } = useNotificaciones();
    const texto = textoChipImportaciones(importsEnCurso);
    if (texto === null) return null;

    if (celular) {
        return (
            <IconButton size="small" color="info" aria-label={texto} onClick={onAbrir}>
                <CloudUploadIcon />
            </IconButton>
        );
    }
    return (
        <Chip
            icon={<CloudUploadIcon />}
            label={texto}
            size="small"
            color="info"
            variant="outlined"
            onClick={onAbrir}
            sx={{ mr: 0.5 }}
        />
    );
};

export default ChipImportaciones;
