import React from "react";
import {
    Box,
    Typography,
    Paper,
    Button,
    Chip,
    Divider,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import DownloadIcon from "@mui/icons-material/Download";
import ReplayIcon from "@mui/icons-material/Replay";
import ListAltIcon from "@mui/icons-material/ListAlt";

interface Props {
    total: number;
    ok: number;
    err: number;
    remesaId: number;
    onNewImport: () => void;
    onViewRemesas: () => void;
}

export default function ImportSummary({
    total,
    ok,
    err,
    remesaId,
    onNewImport,
    onViewRemesas,
}: Props) {
    const successRate = total > 0 ? Math.round((ok / total) * 100) : 0;
    const hasErrors = err > 0;

    return (
        <Box>
            <Typography variant="h6" sx={{ mb: 3, fontWeight: 600 }}>
                Importación finalizada
            </Typography>

            <Paper
                variant="outlined"
                sx={{
                    p: 4,
                    textAlign: "center",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 2,
                }}
            >
                <CheckCircleIcon
                    sx={{
                        fontSize: 64,
                        color: hasErrors ? "warning.main" : "success.main",
                    }}
                />

                <Typography variant="h5" fontWeight={700}>
                    {hasErrors
                        ? "Importación completada con advertencias"
                        : "¡Importación exitosa!"}
                </Typography>

                {/* Métricas */}
                <Box sx={{ display: "flex", gap: 2, my: 2, flexWrap: "wrap", justifyContent: "center" }}>
                    <Paper
                        elevation={0}
                        sx={{
                            p: 2,
                            bgcolor: "grey.50",
                            borderRadius: 2,
                            minWidth: 100,
                        }}
                    >
                        <Typography variant="h4" fontWeight={700}>
                            {total}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                            Total filas
                        </Typography>
                    </Paper>

                    <Paper
                        elevation={0}
                        sx={{
                            p: 2,
                            bgcolor: "success.main",
                            color: "white",
                            borderRadius: 2,
                            minWidth: 100,
                        }}
                    >
                        <Typography variant="h4" fontWeight={700}>
                            {ok}
                        </Typography>
                        <Typography variant="caption" sx={{ opacity: 0.9 }}>
                            Exitosas
                        </Typography>
                    </Paper>

                    {hasErrors && (
                        <Paper
                            elevation={0}
                            sx={{
                                p: 2,
                                bgcolor: "error.main",
                                color: "white",
                                borderRadius: 2,
                                minWidth: 100,
                            }}
                        >
                            <Typography variant="h4" fontWeight={700}>
                                {err}
                            </Typography>
                            <Typography
                                variant="caption"
                                sx={{ opacity: 0.9 }}
                            >
                                Con error
                            </Typography>
                        </Paper>
                    )}
                </Box>

                <Chip
                    label={`Tasa de éxito: ${successRate}%`}
                    color={successRate >= 90 ? "success" : "warning"}
                    sx={{ fontWeight: 600, fontSize: 14 }}
                />

                <Divider sx={{ width: "100%", my: 1 }} />

                {/* Acciones */}
                <Box
                    sx={{
                        display: "flex",
                        gap: 2,
                        flexWrap: "wrap",
                        justifyContent: "center",
                    }}
                >
                    {hasErrors && (
                        <Button
                            variant="outlined"
                            color="error"
                            startIcon={<ErrorOutlineIcon />}
                            onClick={async () => {
                                try {
                                    const baseUrl =
                                        (import.meta as any).env
                                            ?.VITE_API_URL ||
                                        "http://localhost:3001/api";
                                    window.open(
                                        `${baseUrl}/import/errores/${remesaId}`,
                                        "_blank"
                                    );
                                } catch {
                                    alert(
                                        "No se pudieron obtener los errores"
                                    );
                                }
                            }}
                        >
                            Ver errores
                        </Button>
                    )}

                    <Button
                        variant="outlined"
                        startIcon={<ReplayIcon />}
                        onClick={onNewImport}
                    >
                        Nueva importación
                    </Button>

                    <Button
                        variant="contained"
                        startIcon={<ListAltIcon />}
                        onClick={onViewRemesas}
                    >
                        Ver remesas
                    </Button>
                </Box>
            </Paper>
        </Box>
    );
}
