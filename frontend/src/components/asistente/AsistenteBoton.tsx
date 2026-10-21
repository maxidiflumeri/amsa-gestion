import React from 'react';
import { Button, IconButton, Tooltip, useMediaQuery, useTheme } from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { useAsistente } from '../../context/AsistenteContext';

/** El botón «Asistente» de la barra superior. Sin el permiso `asistente.usar` no se dibuja nada. */
const AsistenteBoton: React.FC = () => {
    const theme = useTheme();
    const { disponible, abierto, alternar } = useAsistente();
    const conTexto = useMediaQuery(theme.breakpoints.up('sm'));

    if (!disponible) return null;

    if (!conTexto) {
        return (
            <Tooltip title="amaIA">
                <IconButton color="secondary" onClick={alternar} aria-label="amaIA" aria-pressed={abierto}>
                    <AutoAwesomeIcon />
                </IconButton>
            </Tooltip>
        );
    }
    return (
        <Button
            variant={abierto ? 'contained' : 'outlined'}
            color="secondary"
            size="small"
            startIcon={<AutoAwesomeIcon />}
            onClick={alternar}
            aria-pressed={abierto}
            sx={{ borderRadius: 999, flex: 'none' }}
        >
            amaIA
        </Button>
    );
};

export default AsistenteBoton;
