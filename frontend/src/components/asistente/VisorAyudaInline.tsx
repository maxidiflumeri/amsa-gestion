import React from 'react';
import { Box, Button, Divider, Stack, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import { buscarPagina } from '../../pages/ayuda/contenido';
import Markdown from '../../pages/ayuda/Markdown';

interface Props {
    slug: string;
    onVolver: () => void;
    /** Otro enlace `/ayuda/<slug>` dentro de la página: se sigue mirando acá. */
    onCambiar: (slug: string) => void;
    onAbrirDocumentacion: (slug: string) => void;
}

/** Una página de la Documentación dentro del panel: la persona no sale de la pantalla en la que estaba. */
const VisorAyudaInline: React.FC<Props> = ({ slug, onVolver, onCambiar, onAbrirDocumentacion }) => {
    const pagina = buscarPagina(slug);
    return (
        <Stack sx={{ flex: 1, minHeight: 0 }} data-testid="visor-ayuda">
            <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1, py: 0.5 }}>
                <Button size="small" startIcon={<ArrowBackIcon />} onClick={onVolver}>Volver al chat</Button>
            </Stack>
            <Divider />
            <Box sx={{ px: 2, py: 1.5, overflowY: 'auto', flex: 1, minHeight: 0, minWidth: 0 }}>
                {pagina ? (
                    <Markdown texto={pagina.cuerpo} compacto onNavegarInterno={onCambiar} />
                ) : (
                    <Typography variant="body2" color="text.secondary">No encontré esa página de la Documentación.</Typography>
                )}
            </Box>
            {pagina && (
                <>
                    <Divider />
                    <Box sx={{ px: 1, py: 0.5 }}>
                        <Button size="small" startIcon={<MenuBookIcon />} onClick={() => onAbrirDocumentacion(pagina.slug)}>Abrir en Documentación</Button>
                    </Box>
                </>
            )}
        </Stack>
    );
};

export default VisorAyudaInline;
