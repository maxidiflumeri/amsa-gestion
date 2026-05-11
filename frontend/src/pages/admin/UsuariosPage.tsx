import React, { useCallback, useEffect, useState } from 'react';
import {
    Avatar,
    Box,
    Button,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControl,
    IconButton,
    InputLabel,
    MenuItem,
    Select,
    Stack,
    Switch,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { useNotify } from '../../hooks/useNotify';
import { useConfirm } from '../../context/ConfirmContext';
import { PageContainer, PageHeader, SectionCard, EmptyState } from '../../components/ui';
import api from '../../api/axios';

interface Rol {
    id: number;
    nombre: string;
}

interface Usuario {
    id: number;
    nombre: string;
    email: string;
    avatarUrl?: string | null;
    activo: boolean;
    rolId?: number | null;
    rolObj?: Rol | null;
    createdAt: string;
}

const UsuariosPage: React.FC = () => {
    const notify = useNotify();
    const confirm = useConfirm();

    const [usuarios, setUsuarios] = useState<Usuario[]>([]);
    const [roles, setRoles] = useState<Rol[]>([]);
    const [cargando, setCargando] = useState(true);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editando, setEditando] = useState<Usuario | null>(null);
    const [formNombre, setFormNombre] = useState('');
    const [formEmail, setFormEmail] = useState('');
    const [formRolId, setFormRolId] = useState<number | ''>('');
    const [formActivo, setFormActivo] = useState(true);
    const [guardando, setGuardando] = useState(false);

    const cargarDatos = useCallback(async () => {
        try {
            setCargando(true);
            const [{ data: us }, { data: rs }] = await Promise.all([
                api.get<Usuario[]>('/usuarios'),
                api.get<Rol[]>('/roles'),
            ]);
            setUsuarios(us);
            setRoles(rs);
        } catch {
            notify.error('No se pudieron cargar los datos');
        } finally {
            setCargando(false);
        }
    }, []);

    useEffect(() => {
        cargarDatos();
    }, [cargarDatos]);

    const abrirCrear = () => {
        setEditando(null);
        setFormNombre('');
        setFormEmail('');
        setFormRolId('');
        setFormActivo(true);
        setDialogOpen(true);
    };

    const abrirEditar = (u: Usuario) => {
        setEditando(u);
        setFormNombre(u.nombre);
        setFormEmail(u.email);
        setFormRolId(u.rolId ?? '');
        setFormActivo(u.activo);
        setDialogOpen(true);
    };

    const guardar = async () => {
        setGuardando(true);
        try {
            if (editando) {
                await api.patch(`/usuarios/${editando.id}`, {
                    rolId: formRolId !== '' ? Number(formRolId) : undefined,
                    activo: formActivo,
                });
                notify.success('Usuario actualizado correctamente');
            } else {
                if (!formNombre.trim() || !formEmail.trim()) {
                    notify.warning('Nombre y email son requeridos');
                    setGuardando(false);
                    return;
                }
                await api.post('/usuarios', {
                    nombre: formNombre.trim(),
                    email: formEmail.trim(),
                    rolId: formRolId !== '' ? Number(formRolId) : undefined,
                    activo: formActivo,
                });
                notify.success('Usuario creado correctamente');
            }
            setDialogOpen(false);
            cargarDatos();
        } catch (err: any) {
            notify.error(err?.response?.data?.message || 'Error al guardar el usuario');
        } finally {
            setGuardando(false);
        }
    };

    const eliminar = async (u: Usuario) => {
        const ok = await confirm({
            title: `Eliminar usuario "${u.nombre}"`,
            description: '¿Estás seguro? Esta acción no se puede deshacer.',
            confirmLabel: 'Eliminar',
            confirmColor: 'error',
        });
        if (!ok) return;
        try {
            await api.delete(`/usuarios/${u.id}`);
            notify.success('Usuario eliminado');
            cargarDatos();
        } catch (err: any) {
            notify.error(err?.response?.data?.message || 'No se pudo eliminar el usuario');
        }
    };

    const toggleActivo = async (u: Usuario) => {
        try {
            await api.patch(`/usuarios/${u.id}`, { activo: !u.activo });
            setUsuarios((prev) =>
                prev.map((x) => (x.id === u.id ? { ...x, activo: !x.activo } : x)),
            );
        } catch {
            notify.error('No se pudo cambiar el estado');
        }
    };

    return (
        <PageContainer>
            <PageHeader
                title="Usuarios"
                subtitle="Administrá los usuarios y sus roles"
                actions={[{ label: 'Nuevo usuario', onClick: abrirCrear, startIcon: <AddIcon /> }]}
            />

            <SectionCard>
                {cargando ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress />
                    </Box>
                ) : usuarios.length === 0 ? (
                    <EmptyState title="No hay usuarios" description="Creá el primer usuario para comenzar" />
                ) : (
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Usuario</TableCell>
                                <TableCell>Email</TableCell>
                                <TableCell>Rol</TableCell>
                                <TableCell>Estado</TableCell>
                                <TableCell align="right">Acciones</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {usuarios.map((u) => (
                                <TableRow key={u.id} hover>
                                    <TableCell>
                                        <Stack direction="row" alignItems="center" spacing={1}>
                                            <Avatar
                                                src={u.avatarUrl ?? undefined}
                                                sx={{ width: 28, height: 28, fontSize: 12 }}
                                            >
                                                {u.nombre.charAt(0).toUpperCase()}
                                            </Avatar>
                                            <Typography variant="body2" fontWeight={500}>
                                                {u.nombre}
                                            </Typography>
                                        </Stack>
                                    </TableCell>
                                    <TableCell>
                                        <Typography variant="body2" color="text.secondary">
                                            {u.email}
                                        </Typography>
                                    </TableCell>
                                    <TableCell>
                                        {u.rolObj ? (
                                            <Chip label={u.rolObj.nombre} size="small" variant="outlined" />
                                        ) : (
                                            <Typography variant="body2" color="text.disabled">
                                                Sin rol
                                            </Typography>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Tooltip title={u.activo ? 'Activo — click para suspender' : 'Inactivo — click para activar'}>
                                            <Switch
                                                size="small"
                                                checked={u.activo}
                                                onChange={() => toggleActivo(u)}
                                                color="success"
                                            />
                                        </Tooltip>
                                    </TableCell>
                                    <TableCell align="right">
                                        <Tooltip title="Editar">
                                            <IconButton size="small" onClick={() => abrirEditar(u)}>
                                                <EditIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title="Eliminar">
                                            <IconButton
                                                size="small"
                                                color="error"
                                                onClick={() => eliminar(u)}
                                            >
                                                <DeleteIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </SectionCard>

            <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>
                    {editando ? `Editar usuario: ${editando.nombre}` : 'Nuevo usuario'}
                </DialogTitle>
                <DialogContent>
                    <Stack spacing={3} sx={{ mt: 1 }}>
                        {!editando && (
                            <>
                                <TextField
                                    label="Nombre completo"
                                    value={formNombre}
                                    onChange={(e) => setFormNombre(e.target.value)}
                                    fullWidth
                                    required
                                    autoFocus
                                    inputProps={{ maxLength: 120 }}
                                />
                                <TextField
                                    label="Email (cuenta de Google)"
                                    type="email"
                                    value={formEmail}
                                    onChange={(e) => setFormEmail(e.target.value)}
                                    fullWidth
                                    required
                                    inputProps={{ maxLength: 200 }}
                                    helperText="El usuario deberá usar esta cuenta de Google para ingresar"
                                />
                            </>
                        )}

                        <FormControl fullWidth>
                            <InputLabel>Rol</InputLabel>
                            <Select
                                value={formRolId}
                                onChange={(e) => setFormRolId(e.target.value as number | '')}
                                label="Rol"
                            >
                                <MenuItem value="">
                                    <em>Sin rol</em>
                                </MenuItem>
                                {roles.map((r) => (
                                    <MenuItem key={r.id} value={r.id}>
                                        {r.nombre}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        <Stack direction="row" alignItems="center" spacing={1}>
                            <Switch
                                checked={formActivo}
                                onChange={(e) => setFormActivo(e.target.checked)}
                                color="success"
                            />
                            <Typography variant="body2">
                                {formActivo ? 'Usuario activo' : 'Usuario suspendido'}
                            </Typography>
                        </Stack>
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDialogOpen(false)} disabled={guardando}>
                        Cancelar
                    </Button>
                    <Button
                        variant="contained"
                        onClick={guardar}
                        disabled={guardando}
                        startIcon={guardando ? <CircularProgress size={16} /> : undefined}
                    >
                        {editando ? 'Guardar cambios' : 'Crear usuario'}
                    </Button>
                </DialogActions>
            </Dialog>
        </PageContainer>
    );
};

export default UsuariosPage;
