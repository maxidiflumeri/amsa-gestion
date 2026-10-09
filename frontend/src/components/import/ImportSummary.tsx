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
    casosActualizados,
    casosNuevos,
    descartadasPorFiltro,
    formatearNumero,
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
    /** Carga dividida: cada remesa lee el archivo entero, así que las descartadas no se suman. */
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
                {formatearNumero(valor)}
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
    const suma = (campo: "procesadas" | "ok" | "err" | "advertencias") =>
        resultados.reduce((acc, r) => acc + r[campo], 0);
    const procesadas = suma("procesadas");
    const ok = suma("ok");
    const err = suma("err");
    const advertencias = suma("advertencias");

    // Descartadas por el filtro de la plantilla. En una carga dividida cada remesa lee el archivo entero: sumar
    // multiplicaría el número por la cantidad de remesas. Se muestra el valor común; si las remesas no coinciden,
    // no hay total y cada fila de remesa lleva el suyo.
    const descartadasDeCadaUna = resultados.map((r) => descartadasPorFiltro(r));
    const descartadasComunes = descartadasDeCadaUna.every((d) => d === descartadasDeCadaUna[0]);
    const descartadas = !dividida
        ? descartadasDeCadaUna.reduce((acc, d) => acc + d, 0)
        : descartadasComunes
        ? (descartadasDeCadaUna[0] ?? 0)
        : 0;

    // Casos nuevos y actualizados: sumados, solo si todas las remesas del resumen los informan.
    const todasInformanNuevos = resultados.length > 0 && resultados.every((r) => casosNuevos(r) !== null);
    const todasInformanActualizados = resultados.length > 0 && resultados.every((r) => casosActualizados(r) !== null);
    const nuevos = todasInformanNuevos ? resultados.reduce((acc, r) => acc + (casosNuevos(r) ?? 0), 0) : null;
    const actualizados = todasInformanActualizados
        ? resultados.reduce((acc, r) => acc + (casosActualizados(r) ?? 0), 0)
        : null;

    // Con varias remesas, los números del texto son los de la suma, no solo los de la peor.
    // FALLIDA, CON_ADVERTENCIAS y SIN_FILAS hablan de esa remesa en particular: llevan sus propios números
    // (en SIN_FILAS, las descartadas y las de otros cortes son las de esa remesa, no una suma).
    const sumar = peor?.resultado === "CON_ERRORES";
    const presentadoResultados = peor
        ? presentarResultado(sumar ? { ...peor, procesadas, ok, err } : peor)
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
                                sx={{ maxWidth: 640, width: "100%", overflowWrap: "anywhere", whiteSpace: "pre-line" }}
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
                    {nuevos !== null && <Metrica valor={nuevos} etiqueta="Casos nuevos" />}
                    {actualizados !== null && <Metrica valor={actualizados} etiqueta="Casos actualizados" />}
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
                        {formatearNumero(advertencias)} {advertencias === 1 ? "aviso" : "avisos"} del archivo — ver el detalle
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
                                        {formatearNumero(r.procesadas)} procesadas · {formatearNumero(r.ok)} OK ·{" "}
                                        {formatearNumero(r.err)} con error
                                        {dividida && !descartadasComunes && descartadasPorFiltro(r) > 0
                                            ? ` · ${formatearNumero(descartadasPorFiltro(r))} descartadas`
                                            : ""}
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
