import React from 'react';
import { Box } from '@mui/material';
import ComentariosPanel from '../../ComentariosPanel';

interface Props {
    deudorId: number;
    comentarios: any[];
    onCreated: () => void;
}

const FichaComentariosTab: React.FC<Props> = ({ deudorId, comentarios, onCreated }) => {
    return (
        <Box sx={{ px: 2, pb: 2 }}>
            <ComentariosPanel
                deudorId={deudorId}
                comentarios={comentarios}
                onCreated={onCreated}
            />
        </Box>
    );
};

export default FichaComentariosTab;
