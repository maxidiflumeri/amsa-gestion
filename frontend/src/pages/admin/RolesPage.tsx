import React, { useCallback, useEffect, useState } from 'react';
import {
    Box,
    Button,
    Checkbox,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControlLabel,
    FormGroup,
    IconButton,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    TextField,
    Tooltip,
    Typography,
    useTheme,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { useNotify } from '../../hooks/useNotify';
import { useConfirm } from '../../context/ConfirmContext';
import { PageContainer, PageHeader, SectionCard, EmptyState } from '../../components/ui';
import { TODOS_LOS_PERMISOS } from '../../utils/permisosCatalogo';
import api from '../../api/axios';

interface Rol {
    id: number;
    nombre: string;
    permisos: string[];
    creadoAt: string;
    _count?: { usuarios: number };
}

const RolesPage: React.FC = () => {
    const theme = useTheme();
    const notify = useNotify();
    const confirm = useConfirm();

    const [roles, setRoles] = useState<Rol[]>([]);
    const [cargando, setCargando] = useState(true);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editando, setEditando] = useState<Rol | null>(null);
    const [nombre, setNombre] = useState('');
    const [permisosSeleccionados, setPermisosSeleccionados] = useState<string[]>([]);
    const [guardando, setGuardando] = useState(false);

    const cargarRoles = useCallback(async () => {
        try {
            setCargando(true);
            const { data } = await api.get<Rol[]>('/roles');
            setRoles(data);
        } catch {
            notify.error('No se pudieron cargar los roles');
        } finally {
            setCargando(false);
        }
    }, []);

    useEffect(() => {
        cargarRoles();
    }, [cargarRoles]);

    const abrirCrear = () => {
        setEditando(null);
        setNombre('');
        setPermisosSeleccionados([]);
        setDialogOpen(true);
    };

    const abrirEditar = (rol: Rol) => {
        setEditando(rol);
        setNombre(rol.nombre);
        setPermisosSeleccionados([...rol.permisos]);
        setDialogOpen(true);
    };

    const togglePermiso = (key: string) => {
        setPermisosSeleccionados((prev) =>
            prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key],
        );
    };

    const toggleSeccion = (keys: string[]) => {
        const todosSeleccionados = keys.every((k) => permisosSeleccionados.includes(k));
        if (todosSeleccionados) {
            setPermisosSeleccionados((prev) => prev.filter((p) => !keys.includes(p)));
        } else {
            setPermisosSeleccionados((prev) => [...new Set([...prev, ...keys])]);
        }
    };

    const guardar = async () => {
        if (!nombre.trim()) {
            notify.warning('El nombre del rol es requerido');
            return;
        }
        setGuardando(true);
        try {
            if (editando) {
                await api.patch(`/roles/${editando.id}`, { nombre: nombre.trim(), permisos: permisosSeleccionados });
                notify.success('Rol actualizado correctamente');
            } else {
                await api.post('/roles', { nombre: nombre.trim(), permisos: permisosSeleccionados });
                notify.success('Rol creado correctamente');
            }
            setDialogOpen(false);
            cargarRoles();
        } catch (err: any) {
            notify.error(err?.response?.data?.message || 'Error al guardar el rol');
        } finally {
            setGuardando(false);
        }
    };

    const eliminar = async (rol: Rol) => {
        const ok = await confirm({
            title: `Eliminar rol "${rol.nombre}"`,
            description: '¿Estás seguro? Esta acción no se puede deshacer.',
            confirmLabel: 'Eliminar',
            confirmColor: 'error',
        });
        if (!ok) return;
        try {
            await api.delete(`/roles/${rol.id}`);
            notify.success('Rol eliminado');
            cargarRoles();
        } catch (err: any) {
            notify.error(err?.response?.data?.message || 'No se pudo eliminar el rol');
        }
    };

    return (
        <PageContainer>
            <PageHeader
                title="Roles"
                subtitle="Administrá los roles y sus permisos"
                actions={[{ label: 'Nuevo rol', onClick: abrirCrear, startIcon: <AddIcon /> }]}
            />

            <SectionCard>
                {cargando ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress />
                    </Box>
                ) : roles.length === 0 ? (
                    <EmptyState title="No hay roles" description="Creá el primer rol para comenzar" />
                ) : (
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Nombre</TableCell>
                                <TableCell>Permisos</TableCell>
                                <TableCell>Usuarios</TableCell>
                                <TableCell align="right">Acciones</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {roles.map((rol) => (
                                <TableRow key={rol.id} hover>
                                    <TableCell>
                                        <Typography variant="body2" fontWeight={600}>
                                            {rol.nombre}
                                        </Typography>
                                    </TableCell>
                                    <TableCell>
                                        <Chip
                                            label={`${rol.permisos.length} permisos`}
                                            size="small"
                                            color="primary"
                                            variant="outlined"
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <Typography variant="body2" color="text.secondary">
                                            {rol._count?.usuarios ?? 0} usuario(s)
                                        </Typography>
                                    </TableCell>
                                    <TableCell align="right">
                                        <Tooltip title="Editar">
                                            <IconButton size="small" onClick={() => abrirEditar(rol)}>
                                                <EditIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title="Eliminar">
                                            <IconButton
                                                size="small"
                                                color="error"
                                                onClick={() => eliminar(rol)}
                                                disabled={(rol._count?.usuarios ?? 0) > 0}
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

            <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
                <DialogTitle>{editando ? `Editar rol: ${editando.nombre}` : 'Nuevo rol'}</DialogTitle>
                <DialogContent>
                    <Stack spacing={3} sx={{ mt: 1 }}>
                        <TextField
                            label="Nombre del rol"
                            value={nombre}
                            onChange={(e) => setNombre(e.target.value)}
                            fullWidth
                            required
                            autoFocus
                            inputProps={{ maxLength: 60 }}
                        />

                        <Box>
                            <Typography variant="subtitle2" gutterBottom fontWeight={600}>
                                Permisos ({permisosSeleccionados.length} seleccionados)
                            </Typography>

                            <Stack spacing={2}>
                                {TODOS_LOS_PERMISOS.map((seccion) => {
                                    const keys = seccion.permisos.map((p) => p.key);
                                    const todosSeleccionados = keys.every((k) =>
                                        permisosSeleccionados.includes(k),
                                    );
                                    const algunoSeleccionado = keys.some((k) =>
                                        permisosSeleccionados.includes(k),
                                    );

                                    return (
                                        <Box
                                            key={seccion.seccion}
                                            sx={{
                                                border: 1,
                                                borderColor: 'divider',
                                                borderRadius: 1,
                                                p: 2,
                                            }}
                                        >
                                            <FormControlLabel
                                                control={
                                                    <Checkbox
                                                        checked={todosSeleccionados}
                                                        indeterminate={algunoSeleccionado && !todosSeleccionados}
                                                        onChange={() => toggleSeccion(keys)}
                                                        size="small"
                                                    />
                                                }
                                                label={
                                                    <Typography variant="subtitle2" fontWeight={600}>
                                                        {seccion.seccion}
                                                    </Typography>
                                                }
                                            />
                                            <FormGroup row sx={{ pl: 3, gap: 0 }}>
                                                {seccion.permisos.map((permiso) => (
                                                    <FormControlLabel
                                                        key={permiso.key}
                                                        control={
                                                            <Checkbox
                                                                checked={permisosSeleccionados.includes(permiso.key)}
                                                                onChange={() => togglePermiso(permiso.key)}
                                                                size="small"
                                                            />
                                                        }
                                                        label={
                                                            <Tooltip
                                                                title={permiso.descripcion ?? ''}
                                                                placement="top"
                                                                arrow
                                                            >
                                                                <Typography variant="body2">
                                                                    {permiso.label}
                                                                </Typography>
                                                            </Tooltip>
                                                        }
                                                        sx={{ minWidth: 280 }}
                                                    />
                                                ))}
                                            </FormGroup>
                                        </Box>
                                    );
                                })}
                            </Stack>
                        </Box>
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDialogOpen(false)} disabled={guardando}>
                        Cancelar
                    </Button>
                    <Button
                        variant="contained"
                        onClick={guardar}
                        disabled={guardando || !nombre.trim()}
                        startIcon={guardando ? <CircularProgress size={16} /> : undefined}
                    >
                        {editando ? 'Guardar cambios' : 'Crear rol'}
                    </Button>
                </DialogActions>
            </Dialog>
        </PageContainer>
    );
};

export default RolesPage;
