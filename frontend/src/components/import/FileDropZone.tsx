import React, { useCallback, useState } from "react";
import { Box, Typography, Paper, List, ListItem, ListItemIcon, ListItemText, IconButton, Chip, Alert } from "@mui/material";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";

interface Props {
    /**
     * Archivos elegidos. La zona acepta **varios**: hay cedentes que parten la cartera en un archivo
     * por sucursal (AYSA manda 31 por bajada) y se importan como una sola remesa. Con uno solo, se
     * comporta exactamente igual que antes.
     */
    files: File[];
    /** Se llama con la lista completa ya actualizada (los nuevos se suman a los que había). */
    onFilesChange: (files: File[]) => void;
    accept?: string;
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Extensión en minúsculas, sin el punto. */
const ext = (nombre: string) => nombre.split(".").pop()?.toLowerCase() ?? "";

export default function FileDropZone({
    files,
    onFilesChange,
    accept = ".csv,.txt,.xls,.xlsx",
}: Props) {
    const [isDragOver, setIsDragOver] = useState(false);

    /**
     * Suma los nuevos a los que ya estaban, salteando los repetidos: el operador que arrastra 31
     * archivos suele hacerlo en varias tandas, y volver a soltar uno ya cargado duplicaría sus filas.
     */
    const agregar = useCallback(
        (nuevos: FileList | null) => {
            if (!nuevos?.length) return;
            const yaEstan = new Set(files.map((f) => f.name));
            const sumar = Array.from(nuevos).filter((f) => !yaEstan.has(f.name));
            if (sumar.length > 0) onFilesChange([...files, ...sumar]);
        },
        [files, onFilesChange]
    );

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
    }, []);

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragOver(false);
            agregar(e.dataTransfer.files);
        },
        [agregar]
    );

    const handleChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            agregar(e.target.files);
            // Permite volver a elegir el mismo archivo después de quitarlo.
            e.target.value = "";
        },
        [agregar]
    );

    const quitar = (nombre: string) => onFilesChange(files.filter((f) => f.name !== nombre));

    const hayArchivos = files.length > 0;
    const varios = files.length > 1;
    const pesoTotal = files.reduce((a, f) => a + f.size, 0);
    // Mezclar una planilla con archivos de texto es siempre un error de selección; el backend lo
    // rechaza, pero avisarlo antes de subir 250 MB es bastante mejor.
    const extensiones = [...new Set(files.map((f) => ext(f.name)))];
    const mezclaExcel =
        extensiones.some((e) => e === "xls" || e === "xlsx") && extensiones.length > 1;

    return (
        <Box>
            <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
                Subir archivo
            </Typography>

            <Paper
                variant="outlined"
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                sx={{
                    p: 4,
                    textAlign: "center",
                    cursor: "pointer",
                    borderStyle: "dashed",
                    borderWidth: 2,
                    borderColor: isDragOver
                        ? "primary.main"
                        : hayArchivos
                        ? "success.main"
                        : "divider",
                    bgcolor: isDragOver
                        ? "action.hover"
                        : hayArchivos
                        ? "success.light"
                        : "background.default",
                    transition: "all 0.2s ease",
                    "&:hover": {
                        borderColor: "primary.main",
                        bgcolor: "action.hover",
                    },
                }}
                onClick={() =>
                    document.getElementById("import-file-input")?.click()
                }
            >
                <input
                    id="import-file-input"
                    type="file"
                    accept={accept}
                    multiple
                    onChange={handleChange}
                    style={{ display: "none" }}
                />

                {hayArchivos ? (
                    <Box
                        sx={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: 1,
                        }}
                    >
                        <CheckCircleIcon
                            sx={{ fontSize: 48, color: "success.main" }}
                        />
                        {varios ? (
                            <>
                                <Typography variant="subtitle1" fontWeight={500}>
                                    {files.length} archivos seleccionados
                                </Typography>
                                <Typography variant="body2" color="text.secondary">
                                    {formatSize(pesoTotal)} en total — se importan como una sola remesa
                                </Typography>
                            </>
                        ) : (
                            <>
                                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                    <InsertDriveFileIcon color="action" />
                                    <Typography variant="subtitle1" fontWeight={500}>
                                        {files[0].name}
                                    </Typography>
                                </Box>
                                <Typography variant="body2" color="text.secondary">
                                    {formatSize(files[0].size)}
                                </Typography>
                            </>
                        )}
                        <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ mt: 1 }}
                        >
                            Hacé clic o arrastrá más archivos para sumarlos
                        </Typography>
                    </Box>
                ) : (
                    <Box
                        sx={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: 1,
                        }}
                    >
                        <CloudUploadIcon
                            sx={{
                                fontSize: 48,
                                color: isDragOver
                                    ? "primary.main"
                                    : "text.secondary",
                                transition: "color 0.2s ease",
                            }}
                        />
                        <Typography variant="subtitle1" color="text.secondary">
                            Arrastrá tus archivos acá o hacé clic para seleccionar
                        </Typography>
                        <Typography variant="caption" color="text.disabled">
                            Formatos soportados: CSV, TXT, XLS, XLSX — podés subir varios juntos
                        </Typography>
                    </Box>
                )}
            </Paper>

            {mezclaExcel && (
                <Alert severity="warning" sx={{ mt: 2 }}>
                    La selección mezcla planillas de Excel con archivos de texto. Todos los archivos
                    de una misma carga tienen que ser del mismo tipo.
                </Alert>
            )}

            {varios && (
                <Paper variant="outlined" sx={{ mt: 2, maxHeight: 260, overflow: "auto" }}>
                    <List dense disablePadding>
                        {files.map((f, i) => (
                            <ListItem
                                key={f.name}
                                divider={i < files.length - 1}
                                secondaryAction={
                                    <IconButton
                                        edge="end"
                                        size="small"
                                        aria-label={`Quitar ${f.name}`}
                                        onClick={() => quitar(f.name)}
                                    >
                                        <DeleteOutlineIcon fontSize="small" />
                                    </IconButton>
                                }
                            >
                                <ListItemIcon sx={{ minWidth: 36 }}>
                                    <InsertDriveFileIcon fontSize="small" color="action" />
                                </ListItemIcon>
                                <ListItemText
                                    primary={f.name}
                                    secondary={formatSize(f.size)}
                                    primaryTypographyProps={{
                                        variant: "body2",
                                        sx: { wordBreak: "break-all" },
                                    }}
                                />
                                <Chip label={ext(f.name) || "?"} size="small" sx={{ ml: 1 }} />
                            </ListItem>
                        ))}
                    </List>
                </Paper>
            )}
        </Box>
    );
}
