import React, { useEffect, useRef } from "react";
import {
    Box,
    Typography,
    LinearProgress,
    Paper,
    Chip,
} from "@mui/material";
import HourglassTopIcon from "@mui/icons-material/HourglassTop";
import api from "../../api/axios";

interface Props {
    remesaId: number;
    onComplete: (result: { total: number; ok: number; err: number }) => void;
}

export default function ImportProgress({ remesaId, onComplete }: Props) {
    const [progress, setProgress] = React.useState(0);
    const [total, setTotal] = React.useState(0);
    const [ok, setOk] = React.useState(0);
    const [err, setErr] = React.useState(0);
    const [estado, setEstado] = React.useState("PROCESANDO");
    const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        // Polling cada 2 segundos para obtener progreso
        pollingRef.current = setInterval(async () => {
            try {
                const res = await api.get(`/import/remesas/${remesaId}`);
                const data = res.data;

                setTotal(data.totalFilas ?? 0);
                setOk(data.okFilas ?? 0);
                setErr(data.errFilas ?? 0);
                setEstado(data.estadoProceso ?? "PROCESANDO");

                const procesadas = (data.okFilas ?? 0) + (data.errFilas ?? 0);
                const totalFilas = data.totalFilas ?? 1;
                setProgress(
                    Math.min(
                        Math.round((procesadas / totalFilas) * 100),
                        100
                    )
                );

                if (
                    data.estadoProceso === "FINALIZADA" ||
                    data.estadoProceso === "FALLIDA"
                ) {
                    if (pollingRef.current) {
                        clearInterval(pollingRef.current);
                    }
                    onComplete({
                        total: data.totalFilas ?? 0,
                        ok: data.okFilas ?? 0,
                        err: data.errFilas ?? 0,
                    });
                }
            } catch {
                // Silenciar errores de polling
            }
        }, 2000);

        return () => {
            if (pollingRef.current) {
                clearInterval(pollingRef.current);
            }
        };
    }, [remesaId, onComplete]);

    return (
        <Box>
            <Typography variant="h6" sx={{ mb: 3, fontWeight: 600 }}>
                Ejecutando importación
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
                <HourglassTopIcon
                    sx={{
                        fontSize: 48,
                        color: "primary.main",
                        animation: "spin 2s linear infinite",
                        "@keyframes spin": {
                            "0%": { transform: "rotate(0deg)" },
                            "100%": { transform: "rotate(360deg)" },
                        },
                    }}
                />

                <Typography variant="h4" fontWeight={700} color="primary.main">
                    {progress}%
                </Typography>

                <LinearProgress
                    variant="determinate"
                    value={progress}
                    sx={{
                        width: "100%",
                        height: 8,
                        borderRadius: 4,
                    }}
                />

                <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
                    <Chip
                        label={`Total: ${total}`}
                        variant="outlined"
                        size="small"
                    />
                    <Chip
                        label={`OK: ${ok}`}
                        color="success"
                        variant="outlined"
                        size="small"
                    />
                    {err > 0 && (
                        <Chip
                            label={`Errores: ${err}`}
                            color="error"
                            variant="outlined"
                            size="small"
                        />
                    )}
                </Box>

                <Typography variant="body2" color="text.secondary">
                    Estado: {estado}
                </Typography>
            </Paper>
        </Box>
    );
}
