import React, { useCallback, useEffect, useState } from "react";
import {
    Box,
    Typography,
    Button,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    IconButton,
    Chip,
    TextField,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    FormControlLabel,
    Switch,
    Alert,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Tooltip,
    Divider,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SaveIcon from "@mui/icons-material/Save";
import api from "../api/axios";
import MappingEditor, {
    MappingField,
} from "../components/import/MappingEditor";

const CATEGORIAS = ["DEUDORES", "FACTURAS", "ENRIQUECIMIENTO", "PAGOS", "CONTACTOS"];

interface Plantilla {
    id: number;
    nombre: string;
    categoria: string;
    version: number;
    activo: boolean;
    separador: string;
    tieneHeader: boolean;
    mappingJson: any;
    createdAt: string;
}

// Convert MappingJson → MappingField[] for the editor
function mappingJsonToFields(mapping: any): MappingField[] {
    const fields: MappingField[] = [];

    if (mapping?.columns) {
        for (const [dest, cfg] of Object.entries(mapping.columns) as any) {
            fields.push({
                destField: dest,
                fromIndex: cfg.fromIndex ?? 0,
                transforms: cfg.transforms ?? [],
                isExtra: false,
            });
        }
    }

    if (mapping?.extras) {
        for (const [dest, cfg] of Object.entries(mapping.extras) as any) {
            fields.push({
                destField: dest,
                fromIndex: cfg.fromIndex ?? 0,
                transforms: cfg.transforms ?? [],
                isExtra: true,
            });
        }
    }

    return fields;
}

// Convert MappingField[] → MappingJson for the backend
function fieldsToMappingJson(
    fields: MappingField[],
    entity: string,
    matchKeys: string[]
): any {
    const columns: Record<string, any> = {};
    const extras: Record<string, any> = {};

    for (const f of fields) {
        if (!f.destField) continue;
        const cfg = {
            fromIndex: f.fromIndex,
            transforms: f.transforms.length > 0 ? f.transforms : undefined,
        };
        if (f.isExtra) {
            extras[f.destField] = cfg;
        } else {
            columns[f.destField] = cfg;
        }
    }

    return {
        entity,
        matchKeys,
        columns,
        ...(Object.keys(extras).length > 0 ? { extras } : {}),
        defaults: {},
    };
}

const ENTITY_MAP: Record<string, string> = {
    DEUDORES: "DEUDOR",
    FACTURAS: "FACTURA",
    ENRIQUECIMIENTO: "ENRIQ_MIXTO",
    PAGOS: "PAGO",
    CONTACTOS: "CONTACTO",
};

export default function PlantillaManager() {
    const empresaId = 1; // luego auth

    const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    // Editor state
    const [editing, setEditing] = useState(false);
    const [editId, setEditId] = useState<number | null>(null);

    // Form state
    const [nombre, setNombre] = useState("");
    const [categoria, setCategoria] = useState("DEUDORES");
    const [version, setVersion] = useState(1);
    const [separador, setSeparador] = useState("|");
    const [tieneHeader, setTieneHeader] = useState(false);
    const [matchKeys, setMatchKeys] = useState("empresaId,documento");
    const [fields, setFields] = useState<MappingField[]>([]);

    // Delete dialog
    const [deleteTarget, setDeleteTarget] = useState<Plantilla | null>(null);

    // Load plantillas
    const loadPlantillas = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get(
                `/import/plantillas/${empresaId}`
            );
            setPlantillas(res.data);
        } catch {
            setError("Error cargando plantillas");
        }
        setLoading(false);
    }, [empresaId]);

    useEffect(() => {
        loadPlantillas();
    }, [loadPlantillas]);

    // Open editor for new
    const handleNew = () => {
        setEditId(null);
        setNombre("");
        setCategoria("DEUDORES");
        setVersion(1);
        setSeparador("|");
        setTieneHeader(false);
        setMatchKeys("empresaId,documento");
        setFields([]);
        setEditing(true);
        setError(null);
        setSuccess(null);
    };

    // Open editor for existing
    const handleEdit = (p: Plantilla) => {
        setEditId(p.id);
        setNombre(p.nombre);
        setCategoria(p.categoria);
        setVersion(p.version);
        setSeparador(p.separador);
        setTieneHeader(p.tieneHeader);
        setMatchKeys(
            (p.mappingJson?.matchKeys ?? ["empresaId", "documento"]).join(",")
        );
        setFields(mappingJsonToFields(p.mappingJson));
        setEditing(true);
        setError(null);
        setSuccess(null);
    };

    // Save
    const handleSave = async () => {
        if (!nombre.trim()) {
            setError("El nombre es obligatorio");
            return;
        }
        if (fields.filter((f) => f.destField).length === 0) {
            setError("Agregá al menos un campo de mapeo");
            return;
        }

        setLoading(true);
        setError(null);

        const entity = ENTITY_MAP[categoria] ?? "DEUDOR";
        const keys = matchKeys
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean);
        const mappingJson = fieldsToMappingJson(fields, entity, keys);

        try {
            if (editId) {
                await api.post(`/import/plantillas/${editId}`, {
                    nombre,
                    categoria,
                    version,
                    separador,
                    tieneHeader,
                    mappingJson,
                });
                setSuccess("Plantilla actualizada correctamente");
            } else {
                await api.post("/import/plantillas", {
                    empresaId,
                    nombre,
                    categoria,
                    version,
                    separador,
                    tieneHeader,
                    mappingJson,
                });
                setSuccess("Plantilla creada correctamente");
            }
            await loadPlantillas();
            setEditing(false);
        } catch (e: any) {
            setError(
                e.response?.data?.message ||
                    e.message ||
                    "Error guardando plantilla"
            );
        }

        setLoading(false);
    };

    // Delete
    const handleDelete = async () => {
        if (!deleteTarget) return;
        setLoading(true);
        setError(null);

        try {
            await api.post(`/import/plantillas/${deleteTarget.id}/delete`);
            setSuccess("Plantilla eliminada");
            await loadPlantillas();
        } catch (e: any) {
            setError(
                e.response?.data?.message ||
                    "Error eliminando plantilla"
            );
        }
        setDeleteTarget(null);
        setLoading(false);
    };

    // ─── LIST VIEW ───────────────────────────────────────────
    if (!editing) {
        return (
            <Box sx={{ maxWidth: 1000, mx: "auto", mt: 4, px: 2, pb: 6 }}>
                <Box
                    sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        mb: 3,
                    }}
                >
                    <Box>
                        <Typography variant="h4" sx={{ fontWeight: 700 }}>
                            Plantillas de importación
                        </Typography>
                        <Typography
                            variant="body1"
                            color="text.secondary"
                        >
                            Configurá cómo se mapean los archivos a la base de
                            datos
                        </Typography>
                    </Box>
                    <Button
                        variant="contained"
                        startIcon={<AddIcon />}
                        onClick={handleNew}
                    >
                        Nueva plantilla
                    </Button>
                </Box>

                {error && (
                    <Alert
                        severity="error"
                        onClose={() => setError(null)}
                        sx={{ mb: 2 }}
                    >
                        {error}
                    </Alert>
                )}
                {success && (
                    <Alert
                        severity="success"
                        onClose={() => setSuccess(null)}
                        sx={{ mb: 2 }}
                    >
                        {success}
                    </Alert>
                )}

                <TableContainer component={Paper} variant="outlined">
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableCell sx={{ fontWeight: 700 }}>
                                    Nombre
                                </TableCell>
                                <TableCell sx={{ fontWeight: 700 }}>
                                    Categoría
                                </TableCell>
                                <TableCell sx={{ fontWeight: 700 }}>
                                    Versión
                                </TableCell>
                                <TableCell sx={{ fontWeight: 700 }}>
                                    Separador
                                </TableCell>
                                <TableCell sx={{ fontWeight: 700 }}>
                                    Campos
                                </TableCell>
                                <TableCell sx={{ fontWeight: 700 }}>
                                    Fecha
                                </TableCell>
                                <TableCell sx={{ width: 100 }} />
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {plantillas.length === 0 && (
                                <TableRow>
                                    <TableCell
                                        colSpan={7}
                                        sx={{ textAlign: "center", py: 4 }}
                                    >
                                        <Typography color="text.secondary">
                                            No hay plantillas todavía
                                        </Typography>
                                    </TableCell>
                                </TableRow>
                            )}
                            {plantillas.map((p) => {
                                const colCount = p.mappingJson?.columns
                                    ? Object.keys(p.mappingJson.columns).length
                                    : 0;
                                const extraCount = p.mappingJson?.extras
                                    ? Object.keys(p.mappingJson.extras).length
                                    : 0;

                                return (
                                    <TableRow key={p.id} hover>
                                        <TableCell>
                                            <Typography fontWeight={500}>
                                                {p.nombre}
                                            </Typography>
                                        </TableCell>
                                        <TableCell>
                                            <Chip
                                                label={p.categoria}
                                                size="small"
                                                color="primary"
                                                variant="outlined"
                                            />
                                        </TableCell>
                                        <TableCell>v{p.version}</TableCell>
                                        <TableCell>
                                            <code>{p.separador}</code>
                                        </TableCell>
                                        <TableCell>
                                            {colCount}
                                            {extraCount > 0 &&
                                                ` + ${extraCount} extras`}
                                        </TableCell>
                                        <TableCell>
                                            {new Date(
                                                p.createdAt
                                            ).toLocaleDateString()}
                                        </TableCell>
                                        <TableCell>
                                            <Tooltip title="Editar">
                                                <IconButton
                                                    size="small"
                                                    onClick={() =>
                                                        handleEdit(p)
                                                    }
                                                >
                                                    <EditIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                            <Tooltip title="Eliminar">
                                                <IconButton
                                                    size="small"
                                                    color="error"
                                                    onClick={() =>
                                                        setDeleteTarget(p)
                                                    }
                                                >
                                                    <DeleteIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </TableContainer>

                {/* Delete dialog */}
                <Dialog
                    open={!!deleteTarget}
                    onClose={() => setDeleteTarget(null)}
                >
                    <DialogTitle>Eliminar plantilla</DialogTitle>
                    <DialogContent>
                        ¿Seguro que querés eliminar la plantilla "
                        {deleteTarget?.nombre}"? Esta acción no se puede
                        deshacer.
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setDeleteTarget(null)}>
                            Cancelar
                        </Button>
                        <Button
                            color="error"
                            variant="contained"
                            onClick={handleDelete}
                        >
                            Eliminar
                        </Button>
                    </DialogActions>
                </Dialog>
            </Box>
        );
    }

    // ─── EDITOR VIEW ─────────────────────────────────────────
    return (
        <Box sx={{ maxWidth: 1000, mx: "auto", mt: 4, px: 2, pb: 6 }}>
            {/* Header */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 3 }}>
                <Button
                    startIcon={<ArrowBackIcon />}
                    onClick={() => setEditing(false)}
                >
                    Volver
                </Button>
                <Typography variant="h4" sx={{ fontWeight: 700, flex: 1 }}>
                    {editId ? "Editar plantilla" : "Nueva plantilla"}
                </Typography>
            </Box>

            {error && (
                <Alert
                    severity="error"
                    onClose={() => setError(null)}
                    sx={{ mb: 2 }}
                >
                    {error}
                </Alert>
            )}

            <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
                {/* Basic info */}
                <Typography
                    variant="h6"
                    sx={{ fontWeight: 600, mb: 2 }}
                >
                    Datos básicos
                </Typography>

                <Box
                    sx={{
                        display: "grid",
                        gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                        gap: 2,
                        mb: 3,
                    }}
                >
                    <TextField
                        label="Nombre"
                        fullWidth
                        value={nombre}
                        onChange={(e) => setNombre(e.target.value)}
                        placeholder='Ej: "Personal - Deudores (CA)"'
                    />
                    <FormControl fullWidth>
                        <InputLabel>Categoría</InputLabel>
                        <Select
                            value={categoria}
                            label="Categoría"
                            onChange={(e) =>
                                setCategoria(e.target.value)
                            }
                        >
                            {CATEGORIAS.map((c) => (
                                <MenuItem key={c} value={c}>
                                    {c}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <TextField
                        label="Separador"
                        fullWidth
                        value={separador}
                        onChange={(e) => setSeparador(e.target.value)}
                    />
                    <TextField
                        label="Versión"
                        type="number"
                        fullWidth
                        value={version}
                        onChange={(e) =>
                            setVersion(parseInt(e.target.value, 10) || 1)
                        }
                    />
                    <FormControlLabel
                        control={
                            <Switch
                                checked={tieneHeader}
                                onChange={(e) =>
                                    setTieneHeader(e.target.checked)
                                }
                            />
                        }
                        label="El archivo tiene encabezado (header)"
                    />
                    <TextField
                        label="Match keys (separados por coma)"
                        fullWidth
                        value={matchKeys}
                        onChange={(e) => setMatchKeys(e.target.value)}
                        helperText="Campos para identificar duplicados"
                    />
                </Box>

                <Divider sx={{ my: 3 }} />

                {/* Mapping editor */}
                <Typography
                    variant="h6"
                    sx={{ fontWeight: 600, mb: 2 }}
                >
                    Mapeo de columnas
                </Typography>

                <MappingEditor
                    fields={fields}
                    onChange={setFields}
                    separador={separador}
                    tieneHeader={tieneHeader}
                    categoria={categoria}
                />

                <Divider sx={{ my: 3 }} />

                {/* Actions */}
                <Box
                    sx={{
                        display: "flex",
                        justifyContent: "flex-end",
                        gap: 2,
                    }}
                >
                    <Button onClick={() => setEditing(false)}>
                        Cancelar
                    </Button>
                    <Button
                        variant="contained"
                        startIcon={<SaveIcon />}
                        onClick={handleSave}
                        disabled={loading}
                    >
                        {loading ? "Guardando..." : "Guardar plantilla"}
                    </Button>
                </Box>
            </Paper>
        </Box>
    );
}
