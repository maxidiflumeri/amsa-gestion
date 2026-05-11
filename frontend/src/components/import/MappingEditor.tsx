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
    Chip,
    Tooltip,
    Alert,
    Accordion,
    AccordionSummary,
    AccordionDetails,
    Stack,
    useTheme,
    useMediaQuery,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import api from "../../api/axios";
import { useNotify } from "../../hooks/useNotify";
import { SectionCard } from "../ui";

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
        { value: "fechaEmision", label: "Fecha emisión" },
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
        { value: "observacion", label: "Observación" },
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
        { value: "fechaEmision", label: "Fecha emisión (Factura)" },
        { value: "vencimiento", label: "Vencimiento (Factura)" },
    ],
    ACTUALIZACIONES: [
        { value: "documento", label: "Documento (match / nuevo Deudor)" },
        { value: "nro_cliente", label: "Nro. Cliente (match alternativo)" },
        { value: "nombre", label: "Nombre (para casos nuevos)" },
        { value: "apellido", label: "Apellido (para casos nuevos)" },
        { value: "montoTotal", label: "Monto total nuevo" },
        { value: "fechaVencimiento", label: "Fecha vencimiento (para casos nuevos)" },
    ],
};

const AVAILABLE_TRANSFORMS = [
    { value: "trim", label: "Quitar espacios de los extremos" },
    { value: "removeSpaces", label: "Quitar todos los espacios" },
    { value: "removePrefix:CUIL ", label: 'Quitar prefijo "CUIL "' },
    { value: "upper", label: "MAYÚSCULAS" },
    { value: "title", label: "Título (Primera Letra)" },
    { value: "toNumber:es-AR", label: "Número (coma decimal)" },
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

// ─── Sub-componentes de celdas (reutilizables en desktop y mobile) ────────────

interface DestFieldCellProps {
    field: MappingField;
    destFields: { value: string; label: string }[];
    onChange: (key: keyof MappingField, value: unknown) => void;
}

function DestFieldCell({ field, destFields, onChange }: DestFieldCellProps) {
    if (field.isExtra) {
        return (
            <TextField
                size="small"
                fullWidth
                value={field.destField}
                onChange={(e) => onChange("destField", e.target.value)}
                placeholder="ej: nro_cliente"
                variant="outlined"
            />
        );
    }
    return (
        <FormControl size="small" fullWidth>
            <Select
                value={field.destField}
                onChange={(e) => onChange("destField", e.target.value)}
                displayEmpty
            >
                <MenuItem value="" disabled>
                    Seleccioná un campo
                </MenuItem>
                {destFields.map((df) => (
                    <MenuItem key={df.value} value={df.value}>
                        {df.label}
                    </MenuItem>
                ))}
            </Select>
        </FormControl>
    );
}

interface SourceColCellProps {
    field: MappingField;
    totalColumns: number;
    previewRows: string[][];
    onChange: (key: keyof MappingField, value: unknown) => void;
}

function SourceColCell({ field, totalColumns, previewRows, onChange }: SourceColCellProps) {
    return (
        <FormControl size="small" fullWidth>
            <Select
                value={field.fromIndex}
                onChange={(e) => onChange("fromIndex", Number(e.target.value))}
            >
                {Array.from({ length: Math.max(totalColumns, 30) }).map((_, i) => (
                    <MenuItem key={i} value={i}>
                        Col {i}
                        {previewRows.length > 0 && previewRows[0][i]
                            ? ` — "${String(previewRows[0][i]).substring(0, 25)}"`
                            : ""}
                    </MenuItem>
                ))}
                <MenuItem value={-1} sx={{ fontWeight: "bold", color: "primary.main" }}>
                    Valor Fijo / Estático
                </MenuItem>
            </Select>
        </FormControl>
    );
}

interface TransformCellProps {
    field: MappingField;
    onChange: (key: keyof MappingField, value: unknown) => void;
    // For block fields with CONTACTO tipo special case
    isContactoTipo?: boolean;
}

function TransformCell({ field, onChange, isContactoTipo }: TransformCellProps) {
    if (field.fromIndex === -1) {
        if (isContactoTipo) {
            return (
                <FormControl size="small" fullWidth>
                    <Select
                        value={field.staticValue || ""}
                        onChange={(e) => onChange("staticValue", e.target.value)}
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
            );
        }
        return (
            <TextField
                size="small"
                fullWidth
                value={field.staticValue || ""}
                onChange={(e) => onChange("staticValue", e.target.value)}
                placeholder="Ingresar valor fijo..."
            />
        );
    }

    return (
        <FormControl size="small" fullWidth>
            <Select
                multiple
                value={field.transforms}
                onChange={(e) => onChange("transforms", e.target.value)}
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
                    <MenuItem key={t.value} value={t.value}>
                        {t.label}
                    </MenuItem>
                ))}
            </Select>
        </FormControl>
    );
}

// ─── Componente principal ─────────────────────────────────────────────────────

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
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down("md"));
    const notify = useNotify();

    const destFields = DEST_FIELDS_BY_CATEGORY[categoria] ?? [];
    const [previewRows, setPreviewRows] = useState<string[][]>([]);
    const [totalColumns, setTotalColumns] = useState(0);
    const [previewFile, setPreviewFile] = useState<File | null>(null);
    const [loading, setLoading] = useState(false);

    // Upload sample file for preview
    const handleFileUpload = useCallback(
        async (file: File) => {
            setPreviewFile(file);
            setLoading(true);

            try {
                const formData = new FormData();
                formData.append("file", file);
                formData.append("separador", separador);
                formData.append("tieneHeader", String(tieneHeader));

                const res = await api.post(
                    "/import/plantillas/preview",
                    formData,
                    { headers: { "Content-Type": "multipart/form-data" } }
                );

                setPreviewRows(res.data.rows ?? []);
                setTotalColumns(res.data.totalColumns ?? 0);
            } catch (e: unknown) {
                notify.error(e as Error);
            }

            setLoading(false);
        },
        [separador, tieneHeader, notify]
    );

    // ─── Field handlers ───────────────────────────────────────────────────────

    const handleAddField = (isExtra: boolean) => {
        onChange([
            ...fields,
            { destField: "", fromIndex: 0, transforms: [], isExtra },
        ]);
    };

    const handleRemoveField = (idx: number) => {
        onChange(fields.filter((_, i) => i !== idx));
    };

    const handleFieldChange = (idx: number, key: keyof MappingField, value: unknown) => {
        const updated = [...fields];
        (updated[idx] as Record<string, unknown>)[key] = value;
        onChange(updated);
    };

    // ─── Block handlers ───────────────────────────────────────────────────────

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
        updated[bIdx].fields.push({ destField: "", fromIndex: 0, transforms: [], isExtra: false });
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
        value: unknown
    ) => {
        if (!onBlocksChange) return;
        const updated = [...blocks];
        (updated[bIdx].fields[fIdx] as Record<string, unknown>)[key] = value;
        onBlocksChange(updated);
    };

    // ─── Helpers de label ─────────────────────────────────────────────────────

    const getFieldLabel = (field: MappingField, availableDestFields: { value: string; label: string }[]): string => {
        if (!field.destField) return "(sin campo)";
        const found = availableDestFields.find((df) => df.value === field.destField);
        return found?.label ?? field.destField;
    };

    // ─── Desktop: renderFieldRow ──────────────────────────────────────────────

    const renderFieldRow = (field: MappingField, globalIdx: number) => (
        <TableRow key={globalIdx}>
            <TableCell sx={{ minWidth: 160 }}>
                <DestFieldCell
                    field={field}
                    destFields={destFields}
                    onChange={(key, val) => handleFieldChange(globalIdx, key, val)}
                />
            </TableCell>
            <TableCell sx={{ minWidth: 180 }}>
                <SourceColCell
                    field={field}
                    totalColumns={totalColumns}
                    previewRows={previewRows}
                    onChange={(key, val) => handleFieldChange(globalIdx, key, val)}
                />
            </TableCell>
            <TableCell sx={{ minWidth: 200 }}>
                <TransformCell
                    field={field}
                    onChange={(key, val) => handleFieldChange(globalIdx, key, val)}
                />
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

    // ─── Desktop: renderBlockFieldRow ─────────────────────────────────────────

    const renderBlockFieldRow = (bIdx: number, field: MappingField, fIdx: number) => {
        const entity = blocks[bIdx]?.entity;
        const categoryKey =
            entity === "FACTURA" ? "FACTURAS" : entity === "CONTACTO" ? "CONTACTOS" : entity;
        const blockDestFields = DEST_FIELDS_BY_CATEGORY[categoryKey] ?? [];
        const isContactoTipo = entity === "CONTACTO" && field.destField === "tipo";

        return (
            <TableRow key={fIdx}>
                <TableCell sx={{ minWidth: 160 }}>
                    <DestFieldCell
                        field={field}
                        destFields={blockDestFields}
                        onChange={(key, val) => handleBlockFieldChange(bIdx, fIdx, key, val)}
                    />
                </TableCell>
                <TableCell sx={{ minWidth: 180 }}>
                    <SourceColCell
                        field={field}
                        totalColumns={totalColumns}
                        previewRows={previewRows}
                        onChange={(key, val) => handleBlockFieldChange(bIdx, fIdx, key, val)}
                    />
                </TableCell>
                <TableCell sx={{ minWidth: 200 }}>
                    <TransformCell
                        field={field}
                        onChange={(key, val) => handleBlockFieldChange(bIdx, fIdx, key, val)}
                        isContactoTipo={isContactoTipo}
                    />
                </TableCell>
                <TableCell>
                    <Tooltip title="Eliminar campo">
                        <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleRemoveBlockField(bIdx, fIdx)}
                        >
                            <DeleteIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </TableCell>
            </TableRow>
        );
    };

    // ─── Mobile: Accordion por campo ─────────────────────────────────────────

    const renderFieldAccordion = (field: MappingField, globalIdx: number) => {
        const label = getFieldLabel(field, destFields);
        return (
            <Accordion key={globalIdx} variant="outlined" disableGutters>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%" }}>
                        <Typography variant="body2" sx={{ fontWeight: 600, flexGrow: 1 }}>
                            {field.isExtra ? `Extra: ${label}` : label}
                        </Typography>
                        {field.fromIndex === -1 && (
                            <Chip label="Fijo" size="small" color="info" variant="outlined" />
                        )}
                        {field.transforms.length > 0 && (
                            <Chip
                                label={`${field.transforms.length} transform${field.transforms.length > 1 ? "s" : ""}`}
                                size="small"
                                variant="outlined"
                            />
                        )}
                    </Box>
                </AccordionSummary>
                <AccordionDetails>
                    <Stack spacing={2}>
                        <Box>
                            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
                                {field.isExtra ? "Nombre del campo" : "Campo destino"}
                            </Typography>
                            <DestFieldCell
                                field={field}
                                destFields={destFields}
                                onChange={(key, val) => handleFieldChange(globalIdx, key, val)}
                            />
                        </Box>
                        <Box>
                            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
                                Columna origen
                            </Typography>
                            <SourceColCell
                                field={field}
                                totalColumns={totalColumns}
                                previewRows={previewRows}
                                onChange={(key, val) => handleFieldChange(globalIdx, key, val)}
                            />
                        </Box>
                        <Box>
                            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
                                {field.fromIndex === -1 ? "Valor fijo" : "Transformaciones"}
                            </Typography>
                            <TransformCell
                                field={field}
                                onChange={(key, val) => handleFieldChange(globalIdx, key, val)}
                            />
                        </Box>
                        <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
                            <Button
                                size="small"
                                color="error"
                                startIcon={<DeleteIcon />}
                                onClick={() => handleRemoveField(globalIdx)}
                                disabled={disabled}
                            >
                                Eliminar campo
                            </Button>
                        </Box>
                    </Stack>
                </AccordionDetails>
            </Accordion>
        );
    };

    const renderBlockFieldAccordion = (bIdx: number, field: MappingField, fIdx: number) => {
        const entity = blocks[bIdx]?.entity;
        const categoryKey =
            entity === "FACTURA" ? "FACTURAS" : entity === "CONTACTO" ? "CONTACTOS" : entity;
        const blockDestFields = DEST_FIELDS_BY_CATEGORY[categoryKey] ?? [];
        const isContactoTipo = entity === "CONTACTO" && field.destField === "tipo";
        const label = getFieldLabel(field, blockDestFields);

        return (
            <Accordion key={fIdx} variant="outlined" disableGutters>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%" }}>
                        <Typography variant="body2" sx={{ fontWeight: 600, flexGrow: 1 }}>
                            {label}
                        </Typography>
                        {field.fromIndex === -1 && (
                            <Chip label="Fijo" size="small" color="info" variant="outlined" />
                        )}
                    </Box>
                </AccordionSummary>
                <AccordionDetails>
                    <Stack spacing={2}>
                        <Box>
                            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
                                Campo destino
                            </Typography>
                            <DestFieldCell
                                field={field}
                                destFields={blockDestFields}
                                onChange={(key, val) => handleBlockFieldChange(bIdx, fIdx, key, val)}
                            />
                        </Box>
                        <Box>
                            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
                                Columna origen
                            </Typography>
                            <SourceColCell
                                field={field}
                                totalColumns={totalColumns}
                                previewRows={previewRows}
                                onChange={(key, val) => handleBlockFieldChange(bIdx, fIdx, key, val)}
                            />
                        </Box>
                        <Box>
                            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
                                {field.fromIndex === -1 ? "Valor fijo" : "Transformaciones"}
                            </Typography>
                            <TransformCell
                                field={field}
                                onChange={(key, val) => handleBlockFieldChange(bIdx, fIdx, key, val)}
                                isContactoTipo={isContactoTipo}
                            />
                        </Box>
                        <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
                            <Button
                                size="small"
                                color="error"
                                startIcon={<DeleteIcon />}
                                onClick={() => handleRemoveBlockField(bIdx, fIdx)}
                                disabled={disabled}
                            >
                                Eliminar campo
                            </Button>
                        </Box>
                    </Stack>
                </AccordionDetails>
            </Accordion>
        );
    };

    // ─── Render de una lista de campos (desktop tabla / mobile accordions) ────

    const renderFieldList = (
        fieldList: MappingField[],
        getGlobalIdx: (localIdx: number) => number,
        isExtra: boolean
    ) => {
        if (isMobile) {
            return (
                <Stack spacing={1}>
                    {fieldList.map((f, localIdx) =>
                        renderFieldAccordion(f, getGlobalIdx(localIdx))
                    )}
                    {fieldList.length === 0 && (
                        <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                            Sin campos {isExtra ? "extras" : "principales"} configurados.
                        </Typography>
                    )}
                </Stack>
            );
        }

        return (
            <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell sx={{ fontWeight: 700 }}>
                                {isExtra ? "Nombre campo" : "Campo destino"}
                            </TableCell>
                            <TableCell sx={{ fontWeight: 700 }}>Columna origen</TableCell>
                            <TableCell sx={{ fontWeight: 700 }}>Transformaciones</TableCell>
                            <TableCell sx={{ width: 50 }} />
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {fieldList.map((f, localIdx) =>
                            renderFieldRow(f, getGlobalIdx(localIdx))
                        )}
                    </TableBody>
                </Table>
            </TableContainer>
        );
    };

    // Para pasar el globalIdx correcto, pre-calculamos índices
    const mainFields = fields
        .map((f, i) => ({ field: f, globalIdx: i }))
        .filter(({ field }) => !field.isExtra);

    const extraFields = fields
        .map((f, i) => ({ field: f, globalIdx: i }))
        .filter(({ field }) => field.isExtra);

    // ─── JSX ──────────────────────────────────────────────────────────────────

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
                <CloudUploadIcon sx={{ fontSize: 32, color: "text.secondary", mb: 1 }} />
                <Typography variant="body2" color="text.secondary">
                    {loading
                        ? "Procesando archivo..."
                        : previewFile
                        ? `${previewFile.name} (${totalColumns} columnas detectadas)`
                        : "Subí un archivo de muestra para ver las columnas"}
                </Typography>
            </Paper>

            {/* File preview table */}
            {previewRows.length > 0 && (
                <SectionCard
                    title={`Preview del archivo (${previewRows.length} filas, ${totalColumns} columnas)`}
                    noPadding
                >
                    <TableContainer sx={{ maxHeight: 200, overflowX: "auto" }}>
                        <Table size="small" stickyHeader>
                            <TableHead>
                                <TableRow>
                                    {Array.from({ length: totalColumns }).map((_, i) => (
                                        <TableCell
                                            key={i}
                                            sx={{
                                                fontWeight: 700,
                                                whiteSpace: "nowrap",
                                                fontSize: 12,
                                                bgcolor: theme.palette.action.hover,
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
                                                {cell || "\u2014"}
                                            </TableCell>
                                        ))}
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </SectionCard>
            )}

            {/* Main fields mapping */}
            <SectionCard
                title="Campos principales"
                action={
                    <Button
                        startIcon={<AddIcon />}
                        size="small"
                        onClick={() => handleAddField(false)}
                        disabled={disabled}
                        sx={{ mr: 1 }}
                    >
                        Agregar campo
                    </Button>
                }
            >
                {renderFieldList(
                    mainFields.map(({ field }) => field),
                    (localIdx) => mainFields[localIdx].globalIdx,
                    false
                )}
            </SectionCard>

            {/* Extra fields (camposAdicionales) */}
            <SectionCard
                title="Campos extras (→ camposAdicionales JSON)"
                action={
                    <Button
                        startIcon={<AddIcon />}
                        size="small"
                        onClick={() => handleAddField(true)}
                        disabled={disabled}
                        sx={{ mr: 1 }}
                    >
                        Agregar campo extra
                    </Button>
                }
            >
                {renderFieldList(
                    extraFields.map(({ field }) => field),
                    (localIdx) => extraFields[localIdx].globalIdx,
                    true
                )}
            </SectionCard>

            {/* Repetitive Blocks */}
            <SectionCard
                title="Bloques repetitivos (Mapeo Múltiple N-1)"
                subtitle="¿Tu archivo tiene facturas en columnas horizontales repetidas (ej. Cuota 1, Cuota 2, etc.)? Podés crear un bloque nuevo por cada iteración."
                action={
                    <Button
                        variant="outlined"
                        startIcon={<AddIcon />}
                        size="small"
                        onClick={handleAddBlock}
                        disabled={disabled}
                        sx={{ mr: 1 }}
                    >
                        Nuevo bloque
                    </Button>
                }
            >
                <Stack spacing={2}>
                    {blocks.map((block, bIdx) => (
                        <Paper
                            key={bIdx}
                            variant="outlined"
                            sx={{ p: 2, borderColor: "primary.light" }}
                        >
                            <Box
                                sx={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    mb: 2,
                                    flexWrap: "wrap",
                                    gap: 1,
                                }}
                            >
                                <Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
                                    <Typography
                                        variant="subtitle2"
                                        sx={{ fontWeight: 600, color: "primary.main" }}
                                    >
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
                                <Button
                                    size="small"
                                    color="error"
                                    onClick={() => handleRemoveBlock(bIdx)}
                                    disabled={disabled}
                                >
                                    Eliminar iteración
                                </Button>
                            </Box>

                            {isMobile ? (
                                <Stack spacing={1} sx={{ mb: 1 }}>
                                    {block.fields.map((f, fIdx) =>
                                        renderBlockFieldAccordion(bIdx, f, fIdx)
                                    )}
                                    {block.fields.length === 0 && (
                                        <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                                            Sin campos en esta iteración.
                                        </Typography>
                                    )}
                                </Stack>
                            ) : (
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
                                            {block.fields.map((f, fIdx) =>
                                                renderBlockFieldRow(bIdx, f, fIdx)
                                            )}
                                        </TableBody>
                                    </Table>
                                </TableContainer>
                            )}

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

                    {blocks.length === 0 && (
                        <Typography variant="body2" color="text.secondary">
                            Sin bloques repetitivos configurados.
                        </Typography>
                    )}
                </Stack>
            </SectionCard>
        </Box>
    );
}
