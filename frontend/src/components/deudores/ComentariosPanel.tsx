import React, { useEffect, useRef, useState } from 'react';
import {
    Box,
    Typography,    
    Avatar,
    TextField,
    IconButton,    
    Paper,    
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import CommentIcon from '@mui/icons-material/Comment';
import api from '../../api/axios';

interface Comentario {
    id: number;
    texto: string;
    fecha: string;
    usuario?: { nombre?: string };
    origen?: string;
}

interface ComentariosProps {
    deudorId: number;
    comentarios: Comentario[];
    onComentarioAgregado?: (status: 'success' | 'error') => void;
}

const ComentariosPanel: React.FC<ComentariosProps> = ({
    deudorId,
    comentarios,
    onComentarioAgregado,
}) => {
    const [nuevoComentario, setNuevoComentario] = useState('');
    const [sending, setSending] = useState(false);
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
    const bottomRef = useRef<HTMLDivElement | null>(null);

    // Cargar draft del localStorage
    useEffect(() => {
        const draft = localStorage.getItem(`comentario_draft_${deudorId}`);
        if (draft) setNuevoComentario(draft);
    }, [deudorId]);

    // Guardar draft al escribir
    useEffect(() => {
        localStorage.setItem(`comentario_draft_${deudorId}`, nuevoComentario);
    }, [nuevoComentario, deudorId]);

    // Scroll automático al final
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [comentarios]);

    const handleSend = async () => {
        if (!nuevoComentario.trim()) return;
        try {
            setSending(true);
            await api.post('/comentarios', {
                deudorId,
                texto: nuevoComentario.trim(),
                origen: 'manual',
            });
            setNuevoComentario('');
            localStorage.removeItem(`comentario_draft_${deudorId}`);
            onComentarioAgregado?.('success'); // 👈 ahora pasamos el estado de éxito
        } catch (err) {
            console.error(err);
            onComentarioAgregado?.('error'); // 👈 y el de error
        } finally {
            setSending(false);
        }
    };


    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleCloseSnackbar = () => setSnackbar({ ...snackbar, open: false });

    return (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 4, mt: 2, boxShadow: 2 }}>
            <Typography variant="h6" gutterBottom fontWeight="bold">
                <CommentIcon sx={{ mr: 1, verticalAlign: 'middle' }} /> Comentarios
            </Typography>

            {/* Lista de comentarios */}
            <Box sx={{ maxHeight: 280, overflowY: 'auto', mb: 2, pr: 1 }}>
                {comentarios.length === 0 && (
                    <Typography color="text.secondary" sx={{ textAlign: 'center', mt: 4 }}>
                        No hay comentarios aún.
                    </Typography>
                )}
                {comentarios.map((c) => (
                    <Box
                        key={c.id}
                        sx={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            mb: 2,
                            bgcolor: 'action.hover',
                            p: 1.5,
                            borderRadius: 2,
                        }}
                    >
                        <Avatar sx={{ bgcolor: 'primary.main', mr: 1 }}>
                            {c.usuario?.nombre ? c.usuario.nombre.charAt(0).toUpperCase() : '?'}
                        </Avatar>
                        <Box sx={{ flex: 1 }}>
                            <Typography variant="subtitle2">
                                {c.usuario?.nombre || 'Usuario'}{' '}
                                <Typography component="span" variant="caption" color="text.secondary">
                                    {new Date(c.fecha).toLocaleString()}
                                </Typography>
                            </Typography>
                            <Typography variant="body2">{c.texto}</Typography>
                        </Box>
                    </Box>
                ))}
                <div ref={bottomRef} />
            </Box>

            {/* Campo de entrada */}
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 1.5,
                    mt: 1,
                    p: 1.5,
                    borderRadius: 3,
                    bgcolor: (theme) =>
                        theme.palette.mode === 'dark' ? 'background.paper' : 'grey.50',
                    border: (theme) =>
                        `1px solid ${theme.palette.divider}`,
                }}
            >
                <TextField
                    placeholder="Escribí un comentario..."
                    multiline
                    fullWidth
                    minRows={3}       // 👈 altura inicial mayor
                    maxRows={8}       // 👈 expansión suave
                    variant="outlined"
                    value={nuevoComentario}
                    onChange={(e) => setNuevoComentario(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={sending}
                    InputProps={{
                        sx: {
                            backgroundColor: 'background.paper',
                            borderRadius: 2,
                            '& .MuiInputBase-input': {
                                fontSize: 15,
                                lineHeight: 1.5,
                                py: 1.2,
                            },
                        },
                    }}
                />
                <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                    <IconButton
                        color="primary"
                        onClick={handleSend}
                        disabled={!nuevoComentario.trim() || sending}
                        sx={{
                            bgcolor: 'primary.main',
                            color: 'white',
                            '&:hover': { bgcolor: 'primary.dark' },
                            boxShadow: 2,
                        }}
                    >
                        <SendIcon />
                    </IconButton>
                </Box>
            </Box>
        </Paper>
    );
};

export default ComentariosPanel;