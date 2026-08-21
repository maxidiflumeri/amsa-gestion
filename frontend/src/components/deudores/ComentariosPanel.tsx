import React, { useEffect, useRef, useState } from 'react'
import {
    Avatar,
    Box,
    Chip,
    IconButton,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material'
import SendIcon from '@mui/icons-material/Send'
import CommentIcon from '@mui/icons-material/Comment'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import SettingsSuggestIcon from '@mui/icons-material/SettingsSuggest'
import { EmptyState, SectionCard } from '../ui'
import api from '../../api/axios'
import { useNotify } from '../../hooks/useNotify'
import { useAuth } from '../../context/AuthContext'
import { useConfirm } from '../../context/ConfirmContext'

/** Un comentario sin autor lo dejó un proceso: una acción masiva o una importación. */
const esDeSistema = (c: Comentario) => !c.usuario?.nombre

const ETIQUETAS_ORIGEN: Record<string, string> = {
    accion_masiva: 'Acción masiva',
    import: 'Importación',
    importacion: 'Importación',
    sistema: 'Sistema',
}

const etiquetaOrigen = (origen: string) =>
    ETIQUETAS_ORIGEN[origen] ?? origen.replace(/_/g, ' ')

interface Comentario {
    id: number
    texto: string
    fecha: string
    usuario?: { nombre?: string }
    origen?: string
}

interface ComentariosProps {
    deudorId: number
    comentarios: Comentario[]
    onCreated?: () => void
    disabled?: boolean
}

const ComentariosPanel: React.FC<ComentariosProps> = ({
    deudorId,
    comentarios = [],
    onCreated,
    disabled = false,
}) => {
    const notify = useNotify()
    const confirm = useConfirm()
    const { usuario, tienePermiso } = useAuth()
    const puedeEliminar = tienePermiso('comentarios.eliminar')
    const nombreUsuario = usuario?.nombre
    const [nuevoComentario, setNuevoComentario] = useState('')
    const [sending, setSending] = useState(false)
    const bottomRef = useRef<HTMLDivElement | null>(null)

    /**
     * El endpoint y el permiso existían desde siempre y no había botón: el único camino para borrar
     * un comentario propio era la API.
     */
    const handleEliminar = async (id: number) => {
        const ok = await confirm({
            title: 'Eliminar tu comentario',
            description: 'No se puede deshacer.',
            confirmLabel: 'Eliminar',
            confirmColor: 'error',
        })
        if (!ok) return
        try {
            await api.delete(`/comentarios/${id}`)
            notify.success('Comentario eliminado')
            onCreated?.()
        } catch (err) {
            notify.error(err as Error)
        }
    }

    // Cargar draft del localStorage
    useEffect(() => {
        const draft = localStorage.getItem(`comentario_draft_${deudorId}`)
        if (draft) setNuevoComentario(draft)
    }, [deudorId])

    // Guardar draft al escribir
    useEffect(() => {
        localStorage.setItem(`comentario_draft_${deudorId}`, nuevoComentario)
    }, [nuevoComentario, deudorId])

    const handleSend = async () => {
        if (!nuevoComentario.trim()) return
        try {
            setSending(true)
            await api.post('/comentarios', {
                deudorId,
                texto: nuevoComentario.trim(),
                origen: 'manual',
            })
            setNuevoComentario('')
            localStorage.removeItem(`comentario_draft_${deudorId}`)
            notify.success('Comentario agregado')
            onCreated?.()
        } catch (err) {
            notify.error(err as Error)
        } finally {
            setSending(false)
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSend()
        }
    }

    return (
        <SectionCard>
            <Typography variant="h6" gutterBottom fontWeight="bold">
                <CommentIcon sx={{ mr: 1, verticalAlign: 'middle' }} /> Comentarios
            </Typography>

            {/* Lista de comentarios */}
            <Box sx={{ maxHeight: 280, overflowY: 'auto', mb: 2, pr: 1 }}>
                {comentarios.length === 0 ? (
                    <EmptyState
                        icon={<CommentIcon />}
                        title="Sin comentarios"
                        description="No hay comentarios registrados para este deudor."
                    />
                ) : (
                    comentarios.map((c) => (
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
                            {/*
                              Un comentario sin autor lo dejó un proceso, no una persona. Antes se
                              renderizaba como "Usuario" con la inicial "?", indistinguible de uno
                              escrito a mano, y el `origen` que ya viene del backend no se mostraba.
                            */}
                            <Avatar sx={{ bgcolor: esDeSistema(c) ? 'grey.600' : 'primary.main', mr: 1 }}>
                                {esDeSistema(c) ? (
                                    <SettingsSuggestIcon fontSize="small" />
                                ) : (
                                    c.usuario!.nombre!.charAt(0).toUpperCase()
                                )}
                            </Avatar>
                            <Box sx={{ flex: 1 }}>
                                <Typography variant="subtitle2" component="div">
                                    {esDeSistema(c) ? 'Sistema' : c.usuario!.nombre}{' '}
                                    <Typography component="span" variant="caption" color="text.secondary">
                                        {new Date(c.fecha).toLocaleString()}
                                    </Typography>
                                    {c.origen && c.origen !== 'manual' && (
                                        <Chip
                                            size="small"
                                            variant="outlined"
                                            label={etiquetaOrigen(c.origen)}
                                            sx={{ ml: 1, height: 18, fontSize: 11 }}
                                        />
                                    )}
                                </Typography>
                                <Typography variant="body2">{c.texto}</Typography>
                            </Box>
                            {puedeEliminar && !esDeSistema(c) && c.usuario?.nombre === nombreUsuario && !disabled && (
                                <Tooltip title="Eliminar mi comentario">
                                    <IconButton size="small" onClick={() => handleEliminar(c.id)}>
                                        <DeleteOutlineIcon fontSize="small" />
                                    </IconButton>
                                </Tooltip>
                            )}
                        </Box>
                    ))
                )}
                <div ref={bottomRef} />
            </Box>

            {/* Campo de entrada */}
            {!disabled && (
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 1.5,
                        mt: 1,
                        p: 1.5,
                        borderRadius: 3,
                        bgcolor: 'background.paper',
                        border: (t) => `1px solid ${t.palette.divider}`,
                    }}
                >
                    <TextField
                        placeholder="Escribí un comentario..."
                        multiline
                        fullWidth
                        minRows={3}
                        maxRows={8}
                        variant="outlined"
                        value={nuevoComentario}
                        onChange={(e) => setNuevoComentario(e.target.value)}
                        onKeyDown={handleKeyDown}
                        disabled={sending}
                        InputProps={{
                            sx: {
                                bgcolor: 'background.paper',
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
            )}
        </SectionCard>
    )
}

export default ComentariosPanel
