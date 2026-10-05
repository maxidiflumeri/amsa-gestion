import React from "react";
import {
    Alert,
    AlertTitle,
    Box,
    Typography,
    Paper,
    Button,
    Chip,
    Divider,
    Link,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import ReplayIcon from "@mui/icons-material/Replay";
import ListAltIcon from "@mui/icons-material/ListAlt";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { useNavigate } from "react-router-dom";
import type { EstadoCargaDto } from "../../types/importProgreso";
import {
    peorResultado,
    presentarResultado,
    type SeveridadResultado,
} from "../../utils/estadoCarga";

export interface RemesaNoEjecutada {
    remesaId: number;
    /** Número de remesa que ve el operador; si no se conoce, se muestra el id interno. */
    numeroRemesa?: string;
    motivo: string;
    /** true si no se sabe si corrió (no se pudo seguir, o ni se intentó por eso): no se afirma que no se ejecutó. */
    noSeguida?: boolean;
}

interface Props {
    /** Estado terminal de cada remesa que llegó a correr (una sola, o varias si la carga se dividió). */
    resultados: EstadoCargaDto[];
    /** Remesas de la división que no llegaron a ejecutarse, con el motivo. */
    noEjecutadas: RemesaNoEjecutada[];
    /** Carga dividida: "descartadas" incluye las filas fuera del corte de cada remesa, así que no se muestra. */
    dividida?: boolean;
    onNewImport: () => void;
}

function IconoSeveridad({ severidad }: { severidad: SeveridadResultado }) {
    const sx = { fontSize: 64, color: `${severidad}.main` } as const;
    switch (severidad) {
        case "success":
            return <CheckCircleIcon sx={sx} />;
        case "warning":
            return <WarningAmberIcon sx={sx} />;
        case "error":
            return <ErrorOutlineIcon sx={sx} />;
        default:
            return <InfoOutlinedIcon sx={sx} />;
    }
}

function Metrica({
    valor,
    etiqueta,
    color,
}: {
    valor: number;
    etiqueta: string;
    color?: "success" | "error" | "warning";
}) {
    return (
        <Paper
            elevation={0}
            sx={{
                p: 2,
                bgcolor: color ? `${color}.main` : "action.hover",
                color: color ? `${color}.contrastText` : undefined,
                borderRadius: 2,
                minWidth: 100,
                textAlign: "center",
            }}
        >
            <Typography variant="h4" fontWeight={700}>
                {valor}
            </Typography>
            <Typography
                variant="caption"
                color={color ? undefined : "text.secondary"}
                sx={color ? { opacity: 0.9 } : undefined}
            >
                {etiqueta}
            </Typography>
        </Paper>
    );
}

export default function ImportSummary({ resultados, noEjecutadas, dividida = false, onNewImport }: Props) {
    const navigate = useNavigate();

    const peor = peorResultado(resultados);
    const suma = (campo: "procesadas" | "ok" | "err" | "descartadas" | "advertencias") =>
        resultados.reduce((acc, r) => acc + r[campo], 0);
    const procesadas = suma("procesadas");
    const ok = suma("ok");
    const err = suma("err");
    const descartadas = dividida ? 0 : suma("descartadas");
    const advertencias = suma("advertencias");

    // Con varias remesas, los números del texto son los de la suma, no solo los de la peor.
    // FALLIDA y CON_ADVERTENCIAS hablan de esa remesa en particular: llevan sus propios números.
    const sumar = peor?.resultado === "CON_ERRORES" || peor?.resultado === "SIN_FILAS";
    const presentadoResultados = peor
        ? presentarResultado(
              sumar
                  ? { ...peor, procesadas, ok, err, descartadas }
                  : { ...peor, descartadas: dividida ? 0 : peor.descartadas },
          )
        : null;
    // Con remesas sin ejecutar el encabezado no puede ser de éxito, aunque las que corrieron hayan salido bien.
    const hayNoSeguida = noEjecutadas.some((n) => n.noSeguida);
    const presentado =
        hayNoSeguida && (presentadoResultados === null || presentadoResultados.severidad === "success")
            ? {
                  severidad: "warning" as SeveridadResultado,
                  titulo: "No se pudo seguir la importación",
                  detalle:
                      "No se pudo confirmar cómo terminaron algunas remesas de la división: pueden estar corriendo. Revisá el Historial antes de volver a cargar el archivo.",
              }
            : noEjecutadas.length > 0 && (presentadoResultados === null || presentadoResultados.severidad === "success")
            ? {
                  severidad: "warning" as SeveridadResultado,
                  titulo: "La importación quedó incompleta",
                  detalle:
                      resultados.length > 0
                          ? "Algunas remesas de la división no se ejecutaron. Las que corrieron terminaron como se detalla abajo."
                          : "Ninguna remesa de la división llegó a ejecutarse.",
              }
            : presentadoResultados;

    // En una FALLIDA un 100% verde al lado de "La importación falló" confunde.
    const hayFallida = resultados.some((r) => r.resultado === "FALLIDA");
    const tasaExito = procesadas > 0 && !hayFallida ? Math.round((ok / procesadas) * 100) : null;
    const varias = resultados.length > 1;

    return (
        <Box>
            <Typography variant="h6" sx={{ mb: 3, fontWeight: 600 }}>
                Resultado de la importación
            </Typography>

            <Box
                sx={{
                    textAlign: "center",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 2,
                }}
            >
                {presentado && (
                    <>
                        <IconoSeveridad severidad={presentado.severidad} />
                        <Typography variant="h5" fontWeight={700}>
                            {presentado.titulo}
                        </Typography>
                        {presentado.detalle && (
                            <Typography
                                variant="body1"
                                color="text.secondary"
                                sx={{ maxWidth: 640, width: "100%", overflowWrap: "anywhere" }}
                            >
                                {presentado.detalle}
                            </Typography>
                        )}
                    </>
                )}

                {noEjecutadas.length > 0 && (
                    <Alert severity="error" sx={{ width: "100%", textAlign: "left" }}>
                        <AlertTitle>
                            {noEjecutadas.length === 1
                                ? "1 remesa de la división "
                                : `${noEjecutadas.length} remesas de la división `}
                            <strong>
                                {hayNoSeguida
                                    ? (noEjecutadas.length === 1 ? "no se pudo seguir" : "no se pudieron seguir")
                                    : (noEjecutadas.length === 1 ? "no se ejecutó" : "no se ejecutaron")}
                            </strong>
                        </AlertTitle>
                        {hayNoSeguida && (
                            <Typography variant="body2" sx={{ mb: 1 }}>
                                Revisá el Historial antes de volver a cargar el archivo.
                            </Typography>
                        )}
                        {noEjecutadas.map((n) => (
                            <Typography key={n.remesaId} variant="body2" sx={{ overflowWrap: "anywhere" }}>
                                Remesa {n.numeroRemesa ?? n.remesaId}: {n.motivo}{" "}
                                <Link
                                    component="button"
                                    type="button"
                                    variant="body2"
                                    onClick={() => navigate(`/historial-importaciones/${n.remesaId}`)}
                                    sx={{ verticalAlign: "baseline" }}
                                >
                                    Ver detalle
                                </Link>
                            </Typography>
                        ))}
                    </Alert>
                )}

                {/* Métricas */}
                <Box
                    sx={{
                        display: "flex",
                        gap: 2,
                        my: 1,
                        flexWrap: "wrap",
                        justifyContent: "center",
                    }}
                >
                    <Metrica valor={procesadas} etiqueta="Filas procesadas" />
                    <Metrica valor={ok} etiqueta="Exitosas" color="success" />
                    {err > 0 && <Metrica valor={err} etiqueta="Con error" color="error" />}
                    {descartadas > 0 && <Metrica valor={descartadas} etiqueta="Descartadas" color="warning" />}
                </Box>

                {tasaExito !== null && (
                    <Chip
                        label={`Tasa de éxito: ${tasaExito}%`}
                        color={tasaExito >= 90 ? "success" : "warning"}
                        sx={{ fontWeight: 600, fontSize: 14 }}
                    />
                )}

                {advertencias > 0 && (
                    <Typography variant="body2" color="text.secondary">
                        {advertencias} {advertencias === 1 ? "aviso" : "avisos"} del archivo — ver el detalle
                    </Typography>
                )}

                {varias && (
                    <Box sx={{ width: "100%", textAlign: "left" }}>
                        {resultados.map((r) => {
                            const p = presentarResultado(r);
                            return (
                                <Box
                                    key={r.remesaId}
                                    sx={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 1,
                                        flexWrap: "wrap",
                                        py: 1,
                                        borderTop: 1,
                                        borderColor: "divider",
                                    }}
                                >
                                    <Typography variant="body2" fontWeight={600}>
                                        Remesa {r.numeroRemesa}
                                    </Typography>
                                    <Chip label={p.titulo} color={p.severidad} size="small" variant="outlined" />
                                    <Typography variant="caption" color="text.secondary">
                                        {r.procesadas} procesadas · {r.ok} OK · {r.err} con error
                                    </Typography>
                                </Box>
                            );
                        })}
                    </Box>
                )}

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
                    {resultados.map((r) => (
                        <Button
                            key={r.remesaId}
                            variant="outlined"
                            startIcon={<VisibilityIcon />}
                            onClick={() => navigate(`/historial-importaciones/${r.remesaId}`)}
                        >
                            {varias ? `Ver detalle (remesa ${r.numeroRemesa})` : "Ver detalle"}
                        </Button>
                    ))}

                    <Button variant="outlined" startIcon={<ReplayIcon />} onClick={onNewImport}>
                        Nueva importación
                    </Button>

                    <Button
                        variant="contained"
                        startIcon={<ListAltIcon />}
                        onClick={() => navigate("/historial-importaciones")}
                    >
                        Ir al historial
                    </Button>
                </Box>
            </Box>
        </Box>
    );
}
