import React from 'react';
import { Box } from '@mui/material';
import ComentariosPanel from '../../ComentariosPanel';

interface Props {
    deudorId: number;
    comentarios: any[];
    onCreated: () => void;
    disabled?: boolean;
}

const FichaComentariosTab: React.FC<Props> = ({ deudorId, comentarios, onCreated, disabled = false }) => {
    return (
        <Box sx={{ px: 2, pb: 2 }}>
            <ComentariosPanel
                deudorId={deudorId}
                comentarios={comentarios}
                onCreated={onCreated}
                disabled={disabled}
            />
        </Box>
    );
};

export default FichaComentariosTab;
