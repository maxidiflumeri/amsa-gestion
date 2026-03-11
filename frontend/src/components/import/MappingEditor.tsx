import React, { useCallback, useState } from "react";
import {
    Box,
    Typography,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
    Button,
    IconButton,
    TextField,
    MenuItem,
    Select,
    FormControl,
    InputLabel,
    Chip,
    Tooltip,
    Alert,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import api from "../../api/axios";

const DEST_FIELDS_BY_CATEGORY: Record<string, { value: string; label: string }[]> = {
    DEUDORES: [
        { value: "nombre", label: "Nombre" },
        { value: "apellido", label: "Apellido" },
        { value: "documento", label: "Documento" },
        { value: "montoTotal", label: "Monto total" },
        { value: "fechaVencimiento", label: "Fecha vencimiento" },
    ],
    FACTURAS: [
        { value: "nroFactura", label: "Nro. Factura" },
        { value: "importe", label: "Importe" },
        { value: "fechaEmision", label: "Fecha emisi\u00f3n" },
        { value: "vencimiento", label: "Vencimiento" },
        { value: "nro_cliente", label: "Nro. Cliente (match)" },
    ],
    CONTACTOS: [
        { value: "nro_cliente", label: "Nro. Cliente (match)" },
        { value: "documento", label: "Documento (match)" },
        { value: "valor", label: "Valor (tel/email)" },
        { value: "tipo", label: "Tipo" },
        { value: "subtipo", label: "Subtipo" },
        { value: "prioridad", label: "Prioridad" },
    ],
    PAGOS: [
        { value: "nro_cliente", label: "Nro. Cliente (match)" },
        { value: "documento", label: "Documento (match)" },
        { value: "monto", label: "Monto" },
        { value: "fechaPago", label: "Fecha pago" },
        { value: "medioPago", label: "Medio de pago" },
        { value: "observacion", label: "Observaci\u00f3n" },
    ],
    ENRIQUECIMIENTO: [
        { value: "nro_cliente", label: "Nro. Cliente (match)" },
        { value: "documento", label: "Documento (match)" },
        { value: "valor", label: "Valor" },
        { value: "tipo", label: "Tipo" },
    ],
    DEUDORES_Y_FACTURAS: [
        { value: "documento", label: "Documento (Deudor)" },
        { value: "nombre", label: "Nombre (Deudor)" },
        { value: "apellido", label: "Apellido (Deudor)" },
        { value: "montoTotal", label: "Monto total (Deudor)" },
        { value: "fechaVencimiento", label: "Vencimiento (Deudor)" },
        { value: "nroFactura", label: "Nro. Factura (Factura)" },
        { value: "importe", label: "Importe (Factura)" },
        { value: "fechaEmision", label: "Fecha emisi\u00f3n (Factura)" },
        { value: "vencimiento", label: "Vencimiento (Factura)" },
    ],
};

const AVAILABLE_TRANSFORMS = [
    { value: "trim", label: "Quitar espacios de los extremos" },
    { value: "removeSpaces", label: "Quitar todos los espacios" },
    { value: "removePrefix:CUIL ", label: 'Quitar prefijo "CUIL "' },
    { value: "upper", label: "MAY\u00daSCULAS" },
    { value: "title", label: "T\u00edtulo (Primera Letra)" },
    { value: "toNumber:es-AR", label: "N\u00famero (coma decimal)" },
    { value: "toDate:auto", label: "Fecha (auto text)" },
    { value: "toDate:excel", label: "Fecha (serial nativo de Excel)" },
    { value: "splitComma:0", label: "Separar por coma (parte 1)" },
    { value: "splitComma:1", label: "Separar por coma (parte 2)" },
];

export interface MappingField {
    destField: string;
    fromIndex: number;
    transforms: string[];
    isExtra: boolean; // true = va a camposAdicionales
    staticValue?: string;
}

export interface MappingBlock {
    entity: string;
    fields: MappingField[];
}

interface Props {
    fields: MappingField[];
    onChange: (fields: MappingField[]) => void;
    blocks?: MappingBlock[];
    onBlocksChange?: (blocks: MappingBlock[]) => void;
    separador: string;
    tieneHeader: boolean;
    categoria: string;
    disabled?: boolean;
}

export default function MappingEditor({
    fields,
    onChange,
    blocks = [],
    onBlocksChange,
    separador,
    tieneHeader,
    categoria,
    disabled = false,
}: Props) {
    const destFields = DEST_FIELDS_BY_CATEGORY[categoria] ?? [];
    const [previewRows, setPreviewRows] = useState<string[][]>([]);
    const [totalColumns, setTotalColumns] = useState(0);
    const [previewFile, setPreviewFile] = useState<File | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Upload sample file for preview
    const handleFileUpload = useCallback(
        async (file: File) => {
            setPreviewFile(file);
            setLoading(true);
            setError(null);

            try {
                const formData = new FormData();
                formData.append("file", file);
                formData.append("separador", separador);
                formData.append("tieneHeader", String(tieneHeader));

                const res = await api.post(
                    "/import/plantillas/preview",
                    formData,
                    {
                        headers: { "Content-Type": "multipart/form-data" },
                    }
                );

                setPreviewRows(res.data.rows ?? []);
                setTotalColumns(res.data.totalColumns ?? 0);
            } catch (e: any) {
                setError(
                    e.response?.data?.message || "Error parseando archivo"
                );
            }

            setLoading(false);
        },
        [separador, tieneHeader]
    );

    const handleAddField = (isExtra: boolean) => {
        onChange([
            ...fields,
            {
                destField: "",
                fromIndex: 0,
                transforms: [],
                isExtra,
            },
        ]);
    };

    const handleRemoveField = (idx: number) => {
        onChange(fields.filter((_, i) => i !== idx));
    };

    const handleFieldChange = (
        idx: number,
        key: keyof MappingField,
        value: any
    ) => {
        const updated = [...fields];
        (updated[idx] as any)[key] = value;
        onChange(updated);
    };

    // --- Block Handlers ---
    const handleAddBlock = () => {
        if (!onBlocksChange) return;
        onBlocksChange([...blocks, { entity: "FACTURA", fields: [] }]);
    };
    
    const handleRemoveBlock = (bIdx: number) => {
        if (!onBlocksChange) return;
        onBlocksChange(blocks.filter((_, i) => i !== bIdx));
    };

    const handleBlockEntityChange = (bIdx: number, val: string) => {
        if (!onBlocksChange) return;
        const updated = [...blocks];
        updated[bIdx].entity = val;
        onBlocksChange(updated);
    };

    const handleAddBlockField = (bIdx: number) => {
        if (!onBlocksChange) return;
        const updated = [...blocks];
        updated[bIdx].fields.push({
            destField: "",
            fromIndex: 0,
            transforms: [],
            isExtra: false,
        });
        onBlocksChange(updated);
    };

    const handleRemoveBlockField = (bIdx: number, fIdx: number) => {
        if (!onBlocksChange) return;
        const updated = [...blocks];
        updated[bIdx].fields = updated[bIdx].fields.filter((_, i) => i !== fIdx);
        onBlocksChange(updated);
    };

    const handleBlockFieldChange = (
        bIdx: number,
        fIdx: number,
        key: keyof MappingField,
        value: any
    ) => {
        if (!onBlocksChange) return;
        const updated = [...blocks];
        (updated[bIdx].fields[fIdx] as any)[key] = value;
        onBlocksChange(updated);
    };

    const mainFields = fields.filter((f) => !f.isExtra);
    const extraFields = fields.filter((f) => f.isExtra);

    const renderFieldRow = (field: MappingField, globalIdx: number) => (
        <TableRow key={globalIdx}>
            <TableCell sx={{ minWidth: 160 }}>
                {field.isExtra ? (
                    <TextField
                        size="small"
                        fullWidth
                        value={field.destField}
                        onChange={(e) =>
                            handleFieldChange(
                                globalIdx,
                                "destField",
                                e.target.value
                            )
                        }
                        placeholder="ej: nro_cliente"
                        variant="outlined"
                    />
                ) : (
                    <FormControl size="small" fullWidth>
                        <Select
                            value={field.destField}
                            onChange={(e) =>
                                handleFieldChange(
                                    globalIdx,
                                    "destField",
                                    e.target.value
                                )
                            }
                            displayEmpty
                        >
                            <MenuItem value="" disabled>
                                Seleccion\u00e1 un campo
                            </MenuItem>
                            {destFields.map((df) => (
                                <MenuItem key={df.value} value={df.value}>
                                    {df.label}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                )}
            </TableCell>
            <TableCell sx={{ minWidth: 180 }}>
                <FormControl size="small" fullWidth>
                    <Select
                        value={field.fromIndex}
                        onChange={(e) =>
                            handleFieldChange(
                                globalIdx,
                                "fromIndex",
                                Number(e.target.value)
                            )
                        }
                    >
                        {Array.from({ length: Math.max(totalColumns, 30) }).map(
                            (_, i) => (
                                <MenuItem key={i} value={i}>
                                    Col {i}
                                    {previewRows.length > 0 && previewRows[0][i]
                                        ? ` — "${String(previewRows[0][i]).substring(0, 25)}"`
                                        : ""}
                                </MenuItem>
                            )
                        )}
                        <MenuItem value={-1} sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                            Valor Fijo / Estático
                        </MenuItem>
                    </Select>
                </FormControl>
            </TableCell>
            <TableCell sx={{ minWidth: 200 }}>
                {field.fromIndex === -1 ? (
                    <TextField
                        size="small"
                        fullWidth
                        value={field.staticValue || ""}
                        onChange={(e) =>
                            handleFieldChange(
                                globalIdx,
                                "staticValue",
                                e.target.value
                            )
                        }
                        placeholder="Ingresar valor fijo..."
                    />
                ) : (
                    <FormControl size="small" fullWidth>
                        <Select
                            multiple
                        value={field.transforms}
                        onChange={(e) =>
                            handleFieldChange(
                                globalIdx,
                                "transforms",
                                e.target.value
                            )
                        }
                        renderValue={(selected) => (
                            <Box
                                sx={{
                                    display: "flex",
                                    flexWrap: "wrap",
                                    gap: 0.5,
                                }}
                            >
                                {(selected as string[]).map((val) => {
                                    const t = AVAILABLE_TRANSFORMS.find(
                                        (tr) => tr.value === val
                                    );
                                    return (
                                        <Chip
                                            key={val}
                                            label={t?.label ?? val}
                                            size="small"
                                        />
                                    );
                                })}
                            </Box>
                        )}
                    >
                        {AVAILABLE_TRANSFORMS.map((t) => (
                            <MenuItem key={t.value} value={t.value}>
                                {t.label}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
                )}
            </TableCell>
            <TableCell>
                <Tooltip title="Eliminar campo">
                    <IconButton
                        size="small"
                        color="error"
                        onClick={() => handleRemoveField(globalIdx)}
                    >
                        <DeleteIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
            </TableCell>
        </TableRow>
    );

    const renderBlockFieldRow = (bIdx: number, field: MappingField, fIdx: number) => {
        const entity = blocks[bIdx]?.entity;
        // Mapear entidad singular a clave plural de DEST_FIELDS_BY_CATEGORY
        const categoryKey = entity === "FACTURA" ? "FACTURAS" : (entity === "CONTACTO" ? "CONTACTOS" : entity);
        const blockDestFields = DEST_FIELDS_BY_CATEGORY[categoryKey] ?? [];

        return (
            <TableRow key={fIdx}>
                <TableCell sx={{ minWidth: 160 }}>
                    <FormControl size="small" fullWidth>
                        <Select
                            value={field.destField}
                            onChange={(e) => handleBlockFieldChange(bIdx, fIdx, "destField", e.target.value)}
                            displayEmpty
                        >
                            <MenuItem value="" disabled>Seleccioná un campo</MenuItem>
                            {blockDestFields.map((df) => (
                                <MenuItem key={df.value} value={df.value}>
                                    {df.label}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                </TableCell>
                <TableCell sx={{ minWidth: 180 }}>
                    <FormControl size="small" fullWidth>
                        <Select
                            value={field.fromIndex}
                            onChange={(e) => handleBlockFieldChange(bIdx, fIdx, "fromIndex", Number(e.target.value))}
                        >
                            {Array.from({ length: Math.max(totalColumns, 30) }).map((_, i) => (
                                <MenuItem key={i} value={i}>
                                    Col {i} {previewRows.length > 0 && previewRows[0][i] ? ` — "${String(previewRows[0][i]).substring(0, 25)}"` : ""}
                                </MenuItem>
                            ))}
                            <MenuItem value={-1} sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                                Valor Fijo / Estático
                            </MenuItem>
                        </Select>
                    </FormControl>
                </TableCell>
                <TableCell sx={{ minWidth: 200 }}>
                    {field.fromIndex === -1 ? (
                        (entity === "CONTACTO" && field.destField === "tipo") ? (
                            <FormControl size="small" fullWidth>
                                <Select
                                    value={field.staticValue || ""}
                                    onChange={(e) => handleBlockFieldChange(bIdx, fIdx, "staticValue", e.target.value)}
                                    displayEmpty
                                >
                                    <MenuItem value="" disabled>Elegir tipo...</MenuItem>
                                    <MenuItem value="TELEFONO">Teléfono</MenuItem>
                                    <MenuItem value="EMAIL">Email</MenuItem>
                                    <MenuItem value="DIRECCION">Dirección</MenuItem>
                                    <MenuItem value="RED_SOCIAL">Red Social</MenuItem>
                                    <MenuItem value="OTRO">Otro</MenuItem>
                                </Select>
                            </FormControl>
                        ) : (
                            <TextField
                                size="small"
                                fullWidth
                                value={field.staticValue || ""}
                                onChange={(e) => handleBlockFieldChange(bIdx, fIdx, "staticValue", e.target.value)}
                                placeholder="Ingresar valor fijo..."
                            />
                        )
                    ) : (
                        <FormControl size="small" fullWidth>
                            <Select
                                multiple
                            value={field.transforms}
                            onChange={(e) => handleBlockFieldChange(bIdx, fIdx, "transforms", e.target.value)}
                            renderValue={(selected) => (
                                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                                    {(selected as string[]).map((val) => {
                                        const t = AVAILABLE_TRANSFORMS.find((tr) => tr.value === val);
                                        return <Chip key={val} label={t?.label ?? val} size="small" />;
                                    })}
                                </Box>
                            )}
                        >
                            {AVAILABLE_TRANSFORMS.map((t) => (
                                <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    )}
                </TableCell>
                <TableCell>
                    <Tooltip title="Eliminar campo">
                        <IconButton size="small" color="error" onClick={() => handleRemoveBlockField(bIdx, fIdx)}>
                            <DeleteIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </TableCell>
            </TableRow>
        );
    };

    return (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {/* File upload for preview */}
            <Paper
                variant="outlined"
                onClick={() =>
                    !disabled && document.getElementById("mapping-preview-file")?.click()
                }
                sx={{
                    p: 2,
                    textAlign: "center",
                    cursor: disabled ? "not-allowed" : "pointer",
                    borderStyle: "dashed",
                    borderColor: previewFile ? "success.main" : "divider",
                    bgcolor: disabled ? "action.hover" : "transparent",
                    "&:hover": { borderColor: disabled ? "divider" : "primary.main" },
                }}
            >
                <input
                    id="mapping-preview-file"
                    type="file"
                    accept=".csv,.txt,.xls,.xlsx"
                    style={{ display: "none" }}
                    onChange={(e) => {
                        if (e.target.files?.[0]) {
                            handleFileUpload(e.target.files[0]);
                        }
                    }}
                />
                <CloudUploadIcon
                    sx={{ fontSize: 32, color: "text.secondary", mb: 1 }}
                />
                <Typography variant="body2" color="text.secondary">
                    {previewFile
                        ? `📎 ${previewFile.name} (${totalColumns} columnas detectadas)`
                        : "Subí un archivo de muestra para ver las columnas"}
                </Typography>
            </Paper>

            {error && <Alert severity="error">{error}</Alert>}

            {/* File preview table */}
            {previewRows.length > 0 && (
                <Box>
                    <Typography
                        variant="subtitle2"
                        sx={{ mb: 1, fontWeight: 600 }}
                    >
                        Preview del archivo ({previewRows.length} filas,{" "}
                        {totalColumns} columnas)
                    </Typography>
                    <TableContainer
                        component={Paper}
                        variant="outlined"
                        sx={{ maxHeight: 200, overflowX: "auto" }}
                    >
                        <Table size="small" stickyHeader>
                            <TableHead>
                                <TableRow>
                                    {Array.from({
                                        length: totalColumns,
                                    }).map((_, i) => (
                                        <TableCell
                                            key={i}
                                            sx={{
                                                fontWeight: 700,
                                                whiteSpace: "nowrap",
                                                fontSize: 12,
                                                bgcolor: "grey.100",
                                            }}
                                        >
                                            Col {i}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {previewRows.map((row, ri) => (
                                    <TableRow key={ri}>
                                        {row.map((cell, ci) => (
                                            <TableCell
                                                key={ci}
                                                sx={{
                                                    whiteSpace: "nowrap",
                                                    fontSize: 12,
                                                    maxWidth: 150,
                                                    overflow: "hidden",
                                                    textOverflow: "ellipsis",
                                                }}
                                            >
                                                {cell || "—"}
                                            </TableCell>
                                        ))}
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </Box>
            )}

            {/* Main fields mapping */}
            <Box>
                <Typography
                    variant="subtitle1"
                    sx={{ fontWeight: 600, mb: 1 }}
                >
                    Campos principales
                </Typography>
                <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell sx={{ fontWeight: 700 }}>
                                    Campo destino
                                </TableCell>
                                <TableCell sx={{ fontWeight: 700 }}>
                                    Columna origen
                                </TableCell>
                                <TableCell sx={{ fontWeight: 700 }}>
                                    Transformaciones
                                </TableCell>
                                <TableCell sx={{ width: 50 }} />
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {fields.map(
                                (f, i) =>
                                    !f.isExtra && renderFieldRow(f, i)
                            )}
                        </TableBody>
                    </Table>
                </TableContainer>
                <Button
                    startIcon={<AddIcon />}
                    size="small"
                    sx={{ mt: 1 }}
                    onClick={() => handleAddField(false)}
                    disabled={disabled}
                >
                    Agregar campo
                </Button>
            </Box>

            {/* Extra fields (camposAdicionales) */}
            <Box>
                <Typography
                    variant="subtitle1"
                    sx={{ fontWeight: 600, mb: 1 }}
                >
                    Campos extras (→ camposAdicionales JSON)
                </Typography>
                <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell sx={{ fontWeight: 700 }}>
                                    Nombre campo
                                </TableCell>
                                <TableCell sx={{ fontWeight: 700 }}>
                                    Columna origen
                                </TableCell>
                                <TableCell sx={{ fontWeight: 700 }}>
                                    Transformaciones
                                </TableCell>
                                <TableCell sx={{ width: 50 }} />
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {fields.map(
                                (f, i) =>
                                    f.isExtra && renderFieldRow(f, i)
                            )}
                        </TableBody>
                    </Table>
                </TableContainer>
                <Button
                    startIcon={<AddIcon />}
                    size="small"
                    sx={{ mt: 1 }}
                    onClick={() => handleAddField(true)}
                    disabled={disabled}
                >
                    Agregar campo extra
                </Button>
            </Box>

            {/* Repetitive Blocks */}
            <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                    Bloques repetitivos (Mapeo Múltiple N-1)
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    ¿Tu archivo tiene facturas en columnas horizontales repetidas (ej. Cuota 1, Cuota 2, etc.)?
                    Podés crear un bloque nuevo por cada iteración.
                </Typography>
                
                {blocks.map((block, bIdx) => (
                    <Paper key={bIdx} variant="outlined" sx={{ p: 2, mb: 2, borderColor: "primary.light" }}>
                        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
                            <Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
                                <Typography variant="subtitle2" sx={{ fontWeight: 600, color: "primary.main" }}>
                                    Iteración {bIdx + 1}
                                </Typography>
                                <FormControl size="small" sx={{ minWidth: 150 }}>
                                    <Select
                                        value={block.entity}
                                        onChange={(e) => handleBlockEntityChange(bIdx, e.target.value)}
                                    >
                                        <MenuItem value="FACTURA">Factura</MenuItem>
                                        <MenuItem value="CONTACTO">Contacto</MenuItem>
                                    </Select>
                                </FormControl>
                            </Box>
                            <Button size="small" color="error" onClick={() => handleRemoveBlock(bIdx)} disabled={disabled}>
                                Eliminar iteración
                            </Button>
                        </Box>
                        
                        <TableContainer component={Paper} variant="outlined" sx={{ mb: 1 }}>
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell sx={{ fontWeight: 700 }}>Campo destino</TableCell>
                                        <TableCell sx={{ fontWeight: 700 }}>Columna origen</TableCell>
                                        <TableCell sx={{ fontWeight: 700 }}>Transformaciones</TableCell>
                                        <TableCell sx={{ width: 50 }} />
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {block.fields.map((f, fIdx) => renderBlockFieldRow(bIdx, f, fIdx))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                        <Button
                            startIcon={<AddIcon />}
                            size="small"
                            onClick={() => handleAddBlockField(bIdx)}
                            disabled={disabled}
                        >
                            Agregar campo a iteración
                        </Button>
                    </Paper>
                ))}

                <Button
                    variant="outlined"
                    startIcon={<AddIcon />}
                    size="small"
                    onClick={handleAddBlock}
                    sx={{ mt: 1 }}
                    disabled={disabled}
                >
                    Agregar nuevo bloque repetitivo
                </Button>
            </Box>
        </Box>
    );
}
