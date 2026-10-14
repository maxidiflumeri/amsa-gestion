import React from 'react';
import { Box, Typography, useTheme } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import type { EstadoCargaDto } from '../../../types/importProgreso';
import { BotonCancelarCarga } from '../../import/ImportProgress';
import TarjetaProgreso from '../../import/progreso/TarjetaProgreso';

interface ImportEnCursoItemProps {
    carga: EstadoCargaDto;
    /** Las cargas en curso de la misma división (para «Cancelar todo lo que falta»). Sin ellas, solo se ofrece cancelar esta. */
    hermanasEnCurso?: EstadoCargaDto[];
    /** Se llama al terminar de cancelar, para que la lista de la campanita se ponga al día. */
    onRefrescar?: () => void;
    /** Se llama al ir al detalle (la campanita se cierra). */
    onNavegar?: () => void;
    conectado?: boolean;
}

/** Una carga en curso dentro de la campanita: la tarjeta compacta con «Ver detalle» y cancelar. */
const ImportEnCursoItem: React.FC<ImportEnCursoItemProps> = ({ carga, hermanasEnCurso, onRefrescar, onNavegar, conectado = true }) => {
    const theme = useTheme();

    return (
        <Box
            sx={{
                px: 2,
                py: 1.5,
                borderBottom: `1px solid ${theme.palette.divider}`,
                '&:last-child': { borderBottom: 'none' },
            }}
        >
            <TarjetaProgreso
                variante="compacta"
                carga={carga}
                conectado={conectado}
                acciones={
                    <>
                        <Typography
                            component={RouterLink}
                            to={`/historial-importaciones/${carga.remesaId}`}
                            onClick={onNavegar}
                            variant="caption"
                            color="primary.main"
                            sx={{ textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
                        >
                            Ver detalle
                        </Typography>
                        <BotonCancelarCarga carga={carga} variante="icono" onGrupoCambio={onRefrescar} grupo={hermanasEnCurso} />
                    </>
                }
            />
        </Box>
    );
};

export default ImportEnCursoItem;
