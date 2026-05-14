import React, { useCallback, useEffect, useState } from 'react';
import {
    Accordion,
    AccordionDetails,
    AccordionSummary,
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
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useNotify } from '../../hooks/useNotify';
import { useConfirm } from '../../context/ConfirmContext';
import {
    EmptyState,
    PageContainer,
    PageHeader,
    PasswordField,
    SectionCard,
} from '../../components/ui';
import api from '../../api/axios';

interface Rol {
    id: number;
    nombre: string;
}

interface AgenteTelefonia {
    id: number;
    usuarioNeotel: string;
    device: string;
    sipAuthUser: string;
    sipDisplayName: string | null;
    habilitado: boolean;
}

interface Usuario {
    id: number;
    nombre: string;
    email: string;
    legajo?: string | null;
    dni?: string | null;
    avatarUrl?: string | null;
    activo: boolean;
    rolId?: number | null;
    rolObj?: Rol | null;
    esAgente: boolean;
    agente?: AgenteTelefonia | null;
    createdAt: string;
}

/** Regex para validar DNI (7-8 dígitos) o CUIL (11 dígitos, con o sin guiones). */
const DNI_CUIL_REGEX = /^\d{7,8}$|^\d{2}-?\d{8}-?\d$/;

const UsuariosPage: React.FC = () => {
    const notify = useNotify();
    const confirm = useConfirm();

    const [usuarios, setUsuarios] = useState<Usuario[]>([]);
    const [roles, setRoles] = useState<Rol[]>([]);
    const [cargando, setCargando] = useState(true);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editando, setEditando] = useState<Usuario | null>(null);
    const [guardando, setGuardando] = useState(false);

    // Datos personales
    const [formNombre, setFormNombre] = useState('');
    const [formEmail, setFormEmail] = useState('');
    const [formLegajo, setFormLegajo] = useState('');
    const [formDni, setFormDni] = useState('');
    const [dniError, setDniError] = useState('');

    // Acceso
    const [formRolId, setFormRolId] = useState<number | ''>('');
    const [formActivo, setFormActivo] = useState(true);

    // Telefonía
    const [formEsAgente, setFormEsAgente] = useState(false);
    const [formUsuarioNeotel, setFormUsuarioNeotel] = useState('');
    const [formDevice, setFormDevice] = useState('');
    const [formSipAuthUser, setFormSipAuthUser] = useState('');
    const [formSipDisplayName, setFormSipDisplayName] = useState('');
    const [formHabilitadoAgente, setFormHabilitadoAgente] = useState(true);

    // Passwords
    const [formClaveNeotel, setFormClaveNeotel] = useState('');
    const [formSipPassword, setFormSipPassword] = useState('');
    const [editandoClaveNeotel, setEditandoClaveNeotel] = useState(false);
    const [editandoSipPassword, setEditandoSipPassword] = useState(false);
    const [mostrarClaveNeotel, setMostrarClaveNeotel] = useState(false);
    const [mostrarSipPassword, setMostrarSipPassword] = useState(false);

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

    const resetForm = () => {
        setFormNombre('');
        setFormEmail('');
        setFormLegajo('');
        setFormDni('');
        setDniError('');
        setFormRolId('');
        setFormActivo(true);
        setFormEsAgente(false);
        setFormUsuarioNeotel('');
        setFormDevice('');
        setFormSipAuthUser('');
        setFormSipDisplayName('');
        setFormHabilitadoAgente(true);
        setFormClaveNeotel('');
        setFormSipPassword('');
        setEditandoClaveNeotel(false);
        setEditandoSipPassword(false);
        setMostrarClaveNeotel(false);
        setMostrarSipPassword(false);
    };

    const abrirCrear = () => {
        setEditando(null);
        resetForm();
        setDialogOpen(true);
    };

    const abrirEditar = (u: Usuario) => {
        setEditando(u);
        setFormNombre(u.nombre);
        setFormEmail(u.email);
        setFormLegajo(u.legajo ?? '');
        setFormDni(u.dni ?? '');
        setDniError('');
        setFormRolId(u.rolId ?? '');
        setFormActivo(u.activo);
        setFormEsAgente(u.esAgente);
        if (u.agente) {
            setFormUsuarioNeotel(u.agente.usuarioNeotel);
            setFormDevice(u.agente.device);
            setFormSipAuthUser(u.agente.sipAuthUser);
            setFormSipDisplayName(u.agente.sipDisplayName ?? '');
            setFormHabilitadoAgente(u.agente.habilitado);
        } else {
            setFormUsuarioNeotel('');
            setFormDevice('');
            setFormSipAuthUser('');
            setFormSipDisplayName('');
            setFormHabilitadoAgente(true);
        }
        setFormClaveNeotel('');
        setFormSipPassword('');
        setEditandoClaveNeotel(false);
        setEditandoSipPassword(false);
        setMostrarClaveNeotel(false);
        setMostrarSipPassword(false);
        setDialogOpen(true);
    };

    const validarDni = (value: string): boolean => {
        if (!value) return true; // opcional
        if (!DNI_CUIL_REGEX.test(value)) {
            setDniError('Debe ser DNI (7-8 dígitos) o CUIL (11 dígitos)');
            return false;
        }
        setDniError('');
        return true;
    };

    const guardar = async () => {
        // Validaciones
        if (!editando && (!formNombre.trim() || !formEmail.trim())) {
            notify.warning('Nombre y email son requeridos');
            return;
        }

        if (formDni && !validarDni(formDni)) {
            notify.warning('El DNI/CUIL ingresado no es válido');
            return;
        }

        if (formEsAgente && !editando) {
            if (!formUsuarioNeotel.trim() || !formDevice.trim() || !formSipAuthUser.trim()) {
                notify.warning('Usuario Neotel, Device y SIP Auth User son requeridos para el agente');
                return;
            }
            if (!formClaveNeotel.trim() || !formSipPassword.trim()) {
                notify.warning('Clave Neotel y SIP Password son requeridas al crear el agente');
                return;
            }
        }

        setGuardando(true);
        try {
            if (editando) {
                const payload: Record<string, unknown> = {
                    nombre: formNombre.trim(),
                    rolId: formRolId !== '' ? Number(formRolId) : null,
                    activo: formActivo,
                    legajo: formLegajo.trim() || null,
                    dni: formDni.trim() || null,
                    esAgente: formEsAgente,
                };

                if (formEsAgente) {
                    const agentePayload: Record<string, unknown> = {
                        usuarioNeotel: formUsuarioNeotel.trim(),
                        device: formDevice.trim(),
                        sipAuthUser: formSipAuthUser.trim(),
                        sipDisplayName: formSipDisplayName.trim() || undefined,
                        habilitado: formHabilitadoAgente,
                    };
                    if (editandoClaveNeotel && formClaveNeotel.trim()) {
                        agentePayload.claveNeotel = formClaveNeotel;
                    }
                    if (editandoSipPassword && formSipPassword.trim()) {
                        agentePayload.sipPassword = formSipPassword;
                    }
                    payload.agente = agentePayload;
                }

                await api.patch(`/usuarios/${editando.id}`, payload);
                notify.success('Usuario actualizado correctamente');
            } else {
                const payload: Record<string, unknown> = {
                    nombre: formNombre.trim(),
                    email: formEmail.trim(),
                    rolId: formRolId !== '' ? Number(formRolId) : undefined,
                    activo: formActivo,
                    legajo: formLegajo.trim() || undefined,
                    dni: formDni.trim() || undefined,
                    esAgente: formEsAgente,
                };

                if (formEsAgente) {
                    payload.agente = {
                        usuarioNeotel: formUsuarioNeotel.trim(),
                        claveNeotel: formClaveNeotel,
                        device: formDevice.trim(),
                        sipAuthUser: formSipAuthUser.trim(),
                        sipPassword: formSipPassword,
                        sipDisplayName: formSipDisplayName.trim() || undefined,
                        habilitado: formHabilitadoAgente,
                    };
                }

                await api.post('/usuarios', payload);
                notify.success('Usuario creado correctamente');
            }
            setDialogOpen(false);
            cargarDatos();
        } catch (err: unknown) {
            const message =
                (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
            notify.error(message || 'Error al guardar el usuario');
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
        } catch (err: unknown) {
            const message =
                (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
            notify.error(message || 'No se pudo eliminar el usuario');
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
                subtitle="Administrá los usuarios, sus roles y configuracion de telefonía"
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
                                <TableCell>Legajo</TableCell>
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
                                            {u.esAgente && (
                                                <Chip
                                                    size="small"
                                                    label="Agente"
                                                    color="info"
                                                    variant="outlined"
                                                />
                                            )}
                                        </Stack>
                                    </TableCell>
                                    <TableCell>
                                        <Typography variant="body2" color="text.secondary">
                                            {u.legajo ?? '—'}
                                        </Typography>
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
                                        <Tooltip
                                            title={
                                                u.activo
                                                    ? 'Activo — click para suspender'
                                                    : 'Inactivo — click para activar'
                                            }
                                        >
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

            <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
                <DialogTitle>
                    {editando ? `Editar: ${editando.nombre}` : 'Nuevo usuario'}
                </DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ mt: 1 }}>
                        {/* ── Datos personales ── */}
                        <Accordion defaultExpanded>
                            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                <Typography fontWeight={600}>Datos personales</Typography>
                            </AccordionSummary>
                            <AccordionDetails>
                                <Stack spacing={2}>
                                    <TextField
                                        label="Nombre completo"
                                        value={formNombre}
                                        onChange={(e) => setFormNombre(e.target.value)}
                                        fullWidth
                                        required
                                        autoFocus={!editando}
                                        inputProps={{ maxLength: 120 }}
                                    />
                                    <TextField
                                        label="Email (cuenta de Google)"
                                        type="email"
                                        value={formEmail}
                                        onChange={(e) => setFormEmail(e.target.value)}
                                        fullWidth
                                        required={!editando}
                                        disabled={!!editando}
                                        inputProps={{ maxLength: 200 }}
                                        helperText={
                                            !editando
                                                ? 'El usuario deberá usar esta cuenta de Google para ingresar'
                                                : undefined
                                        }
                                    />
                                    <Stack direction="row" spacing={2}>
                                        <TextField
                                            label="Legajo"
                                            value={formLegajo}
                                            onChange={(e) => setFormLegajo(e.target.value)}
                                            sx={{ flex: 1 }}
                                            inputProps={{ maxLength: 50 }}
                                        />
                                        <TextField
                                            label="DNI o CUIL"
                                            value={formDni}
                                            onChange={(e) => {
                                                setFormDni(e.target.value);
                                                if (dniError) validarDni(e.target.value);
                                            }}
                                            onBlur={() => formDni && validarDni(formDni)}
                                            sx={{ flex: 1 }}
                                            error={!!dniError}
                                            helperText={dniError || 'DNI (7-8 dígitos) o CUIL (11 dígitos)'}
                                            inputProps={{ maxLength: 14 }}
                                        />
                                    </Stack>
                                </Stack>
                            </AccordionDetails>
                        </Accordion>

                        {/* ── Acceso ── */}
                        <Accordion>
                            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                <Typography fontWeight={600}>Acceso</Typography>
                            </AccordionSummary>
                            <AccordionDetails>
                                <Stack spacing={2}>
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
                            </AccordionDetails>
                        </Accordion>

                        {/* ── Telefonía ── */}
                        <Accordion>
                            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                <Stack direction="row" alignItems="center" spacing={1}>
                                    <Typography fontWeight={600}>Telefonía</Typography>
                                    {formEsAgente && (
                                        <Chip label="Agente activo" size="small" color="success" />
                                    )}
                                </Stack>
                            </AccordionSummary>
                            <AccordionDetails>
                                <Stack spacing={2}>
                                    <Stack direction="row" alignItems="center" spacing={1}>
                                        <Switch
                                            checked={formEsAgente}
                                            onChange={(e) => setFormEsAgente(e.target.checked)}
                                        />
                                        <Typography variant="body2">
                                            Es agente de telefonía Neotel
                                        </Typography>
                                    </Stack>

                                    {formEsAgente && (
                                        <>
                                            <Stack direction="row" spacing={2}>
                                                <TextField
                                                    label="Usuario Neotel"
                                                    value={formUsuarioNeotel}
                                                    onChange={(e) => setFormUsuarioNeotel(e.target.value)}
                                                    required
                                                    sx={{ flex: 1 }}
                                                    helperText="Ej. Externo6001"
                                                    inputProps={{ maxLength: 100 }}
                                                />
                                                <TextField
                                                    label="Device"
                                                    value={formDevice}
                                                    onChange={(e) => setFormDevice(e.target.value)}
                                                    required
                                                    sx={{ flex: 1 }}
                                                    inputProps={{ maxLength: 100 }}
                                                />
                                            </Stack>
                                            <Stack direction="row" spacing={2}>
                                                <TextField
                                                    label="SIP Auth User"
                                                    value={formSipAuthUser}
                                                    onChange={(e) => setFormSipAuthUser(e.target.value)}
                                                    required
                                                    sx={{ flex: 1 }}
                                                    inputProps={{ maxLength: 100 }}
                                                />
                                                <TextField
                                                    label="Display Name (opcional)"
                                                    value={formSipDisplayName}
                                                    onChange={(e) => setFormSipDisplayName(e.target.value)}
                                                    sx={{ flex: 1 }}
                                                    inputProps={{ maxLength: 120 }}
                                                />
                                            </Stack>

                                            <PasswordField
                                                label="Clave Neotel (API)"
                                                value={formClaveNeotel}
                                                onChange={setFormClaveNeotel}
                                                show={mostrarClaveNeotel}
                                                onToggleShow={() => setMostrarClaveNeotel((v) => !v)}
                                                editando={editandoClaveNeotel}
                                                onActivarEdicion={() => setEditandoClaveNeotel(true)}
                                                esAlta={!editando}
                                                required={!editando}
                                            />

                                            <PasswordField
                                                label="SIP Password"
                                                value={formSipPassword}
                                                onChange={setFormSipPassword}
                                                show={mostrarSipPassword}
                                                onToggleShow={() => setMostrarSipPassword((v) => !v)}
                                                editando={editandoSipPassword}
                                                onActivarEdicion={() => setEditandoSipPassword(true)}
                                                esAlta={!editando}
                                                required={!editando}
                                            />

                                            <Stack direction="row" alignItems="center" spacing={1}>
                                                <Switch
                                                    checked={formHabilitadoAgente}
                                                    onChange={(e) =>
                                                        setFormHabilitadoAgente(e.target.checked)
                                                    }
                                                    color="success"
                                                />
                                                <Typography variant="body2">
                                                    {formHabilitadoAgente
                                                        ? 'Agente habilitado'
                                                        : 'Agente deshabilitado'}
                                                </Typography>
                                            </Stack>
                                        </>
                                    )}
                                </Stack>
                            </AccordionDetails>
                        </Accordion>
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
