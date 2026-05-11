import React, { useEffect, useState } from "react";
import {
    Box,
    Typography,
    LinearProgress,
    Chip,
} from "@mui/material";
import HourglassTopIcon from "@mui/icons-material/HourglassTop";
import api from "../../api/axios";
import { SectionCard } from "../ui";
import { useImportacionesEnCurso } from "../../hooks/useImportacionesEnCurso";

interface Props {
    remesaId: number;
    onComplete: (result: { total: number; ok: number; err: number }) => void;
}

interface EstadoFinal {
    total: number;
    ok: number;
    err: number;
    estado: string;
    progreso: number;
}

export default function ImportProgress({ remesaId, onComplete }: Props) {
    const importsEnCurso = useImportacionesEnCurso();
    const [estadoFinal, setEstadoFinal] = useState<EstadoFinal | null>(null);
    const [completadoRef] = React.useState({ disparado: false });

    const importActual = importsEnCurso.find((i) => i.remesaId === remesaId) ?? null;

    const progreso = importActual?.progreso ?? estadoFinal?.progreso ?? 0;
    const total = importActual?.totalFilas ?? estadoFinal?.total ?? 0;
    const ok = importActual?.okFilas ?? estadoFinal?.ok ?? 0;
    const err = importActual?.errFilas ?? estadoFinal?.err ?? 0;
    const estado = importActual?.estadoProceso ?? estadoFinal?.estado ?? 'PROCESANDO';

    useEffect(() => {
        if (importActual) return;

        // La remesa no aparece en el contexto — buscar estado final via REST
        let cancelado = false;

        async function fetchEstadoFinal() {
            try {
                const res = await api.get(`/import/remesas/${remesaId}`);
                const data = res.data;

                if (cancelado) return;

                const procesadas = (data.okFilas ?? 0) + (data.errFilas ?? 0);
                const totalFilas = data.totalFilas ?? 1;
                const porcentaje = Math.min(Math.round((procesadas / totalFilas) * 100), 100);

                setEstadoFinal({
                    total: data.totalFilas ?? 0,
                    ok: data.okFilas ?? 0,
                    err: data.errFilas ?? 0,
                    estado: data.estadoProceso ?? 'PROCESANDO',
                    progreso: porcentaje,
                });
            } catch {
                // Error silencioso
            }
        }

        fetchEstadoFinal();
        return () => { cancelado = true; };
    }, [remesaId, importActual]);

    // Llamar onComplete cuando la remesa finaliza
    useEffect(() => {
        if (completadoRef.disparado) return;

        const esTerminal = estado === 'FINALIZADA' || estado === 'FALLIDA';
        if (!esTerminal) return;

        // Solo si ya tenemos datos consistentes
        if (total === 0 && ok === 0 && err === 0) return;

        completadoRef.disparado = true;
        onComplete({ total, ok, err });
    }, [estado, total, ok, err, onComplete, completadoRef]);

    return (
        <Box>
            <Typography variant="h6" sx={{ mb: 3, fontWeight: 600 }}>
                Ejecutando importación
            </Typography>

            <SectionCard
                sx={{
                    textAlign: "center",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                }}
            >
                <Box
                    sx={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 2,
                        py: 2,
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
                        {progreso}%
                    </Typography>

                    <LinearProgress
                        variant="determinate"
                        value={progreso}
                        sx={{
                            width: "100%",
                            height: 8,
                            borderRadius: 4,
                        }}
                    />

                    <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", justifyContent: "center" }}>
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
                </Box>
            </SectionCard>
        </Box>
    );
}
