import React, { useCallback, useState } from "react";
import { Box, Typography, Paper } from "@mui/material";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";

interface Props {
    file: File | null;
    onFileSelect: (file: File) => void;
    accept?: string;
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FileDropZone({
    file,
    onFileSelect,
    accept = ".csv,.txt,.xls,.xlsx",
}: Props) {
    const [isDragOver, setIsDragOver] = useState(false);

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

            const droppedFile = e.dataTransfer.files?.[0];
            if (droppedFile) {
                onFileSelect(droppedFile);
            }
        },
        [onFileSelect]
    );

    const handleChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const selectedFile = e.target.files?.[0];
            if (selectedFile) {
                onFileSelect(selectedFile);
            }
        },
        [onFileSelect]
    );

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
                        : file
                        ? "success.main"
                        : "divider",
                    bgcolor: isDragOver
                        ? "action.hover"
                        : file
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
                    onChange={handleChange}
                    style={{ display: "none" }}
                />

                {file ? (
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
                        <Box
                            sx={{
                                display: "flex",
                                alignItems: "center",
                                gap: 1,
                            }}
                        >
                            <InsertDriveFileIcon color="action" />
                            <Typography variant="subtitle1" fontWeight={500}>
                                {file.name}
                            </Typography>
                        </Box>
                        <Typography variant="body2" color="text.secondary">
                            {formatSize(file.size)}
                        </Typography>
                        <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ mt: 1 }}
                        >
                            Hacé clic o arrastrá otro archivo para reemplazar
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
                            Arrastrá tu archivo acá o hacé clic para seleccionar
                        </Typography>
                        <Typography variant="caption" color="text.disabled">
                            Formatos soportados: CSV, TXT, XLS, XLSX
                        </Typography>
                    </Box>
                )}
            </Paper>
        </Box>
    );
}
