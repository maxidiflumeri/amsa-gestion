import React, { useEffect, useState } from 'react';
import {
    Avatar,
    Box,
    Chip,
    CircularProgress,
    Drawer,
    IconButton,
    List,
    ListItem,
    ListItemAvatar,
    ListItemText,
    Stack,
    Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { auditoriaApi } from '../../api/auditoria';
import type { Transaccion } from '../../types/auditoria';
import AuditDiffView from './AuditDiffView';

const moduloColor: Record<string, any> = {
    GESTION: 'primary',
    IMPORT: 'success',
    REPORTES: 'secondary',
    ADMIN: 'warning',
    AUTH: 'info',
    SISTEMA: 'default',
};

const AuditoriaStream: React.FC = () => {
    const [items, setItems] = useState<Transaccion[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<Transaccion | null>(null);

    const cargar = () => auditoriaApi.listar({ limit: 100, orderDir: 'desc' }).then((r) => { setItems(r.items); setLoading(false); });

    useEffect(() => {
        cargar();
        const id = setInterval(cargar, 30_000);
        return () => clearInterval(id);
    }, []);

    if (loading) return <Box display="flex" justifyContent="center" p={4}><CircularProgress /></Box>;

    return (
        <Box>
            <List dense>
                {items.map((it) => (
                    <ListItem key={it.id} button onClick={() => setSelected(it)} divider>
                        <ListItemAvatar>
                            <Avatar src={it.usuario?.avatarUrl ?? undefined}>{(it.usuario?.nombre ?? 'S').charAt(0)}</Avatar>
                        </ListItemAvatar>
                        <ListItemText
                            primary={
                                <Stack direction="row" spacing={1} alignItems="center">
                                    <Typography variant="body2"><strong>{it.usuario?.nombre ?? 'Sistema'}</strong></Typography>
                                    <Chip size="small" label={it.modulo} color={moduloColor[it.modulo] ?? 'default'} />
                                    <Chip size="small" label={it.tipo} variant="outlined" />
                                    <Chip size="small" label={it.entidad} variant="outlined" />
                                    {it.estado === 'FALLIDO' && <Chip size="small" label="FALLIDO" color="error" />}
                                    {it.severidad === 'WARN' && <Chip size="small" label="WARN" color="warning" />}
                                </Stack>
                            }
                            secondary={
                                <Stack direction="row" spacing={2} flexWrap="wrap">
                                    <span>{it.resumen ?? it.recursoTexto ?? '—'}</span>
                                    {it.deudor && (
                                        <span style={{ color: '#1976d2' }}>
                                            Deudor #{it.deudor.id} · {it.deudor.nombre} {it.deudor.apellido} ({it.deudor.documento})
                                        </span>
                                    )}
                                    <span style={{ color: '#999' }}>{new Date(it.createdAt).toLocaleString()}</span>
                                </Stack>
                            }
                        />
                    </ListItem>
                ))}
            </List>

            <Drawer anchor="right" open={!!selected} onClose={() => setSelected(null)} PaperProps={{ sx: { width: { xs: '100%', md: 640 } } }}>
                {selected && (
                    <Box p={2}>
                        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
                            <Typography variant="h6">Transacción #{selected.id}</Typography>
                            <IconButton onClick={() => setSelected(null)}><CloseIcon /></IconButton>
                        </Stack>
                        <Stack spacing={1} mb={2}>
                            <Typography variant="body2"><strong>Fecha:</strong> {new Date(selected.createdAt).toLocaleString()}</Typography>
                            <Typography variant="body2"><strong>Usuario:</strong> {selected.usuario?.nombre ?? 'Sistema'} ({selected.usuario?.email ?? '—'})</Typography>
                            <Typography variant="body2"><strong>Módulo:</strong> {selected.modulo} / {selected.entidad} / {selected.tipo}</Typography>
                            <Typography variant="body2"><strong>Estado:</strong> {selected.estado} · <strong>Severidad:</strong> {selected.severidad}</Typography>
                            {selected.deudor && <Typography variant="body2"><strong>Deudor:</strong> {selected.deudor.nombre} {selected.deudor.apellido} ({selected.deudor.documento})</Typography>}
                            {selected.empresa && <Typography variant="body2"><strong>Empresa:</strong> {selected.empresa.nombre}</Typography>}
                            {selected.resumen && <Typography variant="body2"><strong>Resumen:</strong> {selected.resumen}</Typography>}
                            {selected.ip && <Typography variant="body2"><strong>IP:</strong> {selected.ip}</Typography>}
                        </Stack>
                        <AuditDiffView
                            before={selected.data?.before}
                            after={selected.data?.after}
                            extra={{ params: selected.data?.params, contexto: selected.data?.contexto }}
                        />
                    </Box>
                )}
            </Drawer>
        </Box>
    );
};

export default AuditoriaStream;
