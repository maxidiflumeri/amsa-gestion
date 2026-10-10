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
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import ReplayIcon from "@mui/icons-material/Replay";
import ListAltIcon from "@mui/icons-material/ListAlt";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { useNavigate } from "react-router-dom";
import type { RemesaNoEncolada } from "../../api/imports";
import type { EstadoCargaDto } from "../../types/importProgreso";
import {
    casosActualizados,
    cancelacionLlegoTarde,
    casosNuevos,
    descartadasPorFiltro,
    esRetomable,
    estaCancelada,
    formatearNumero,
    peorResultado,
    presentarResultado,
    textoCancelacionTardia,
    type SeveridadResultado,
} from "../../utils/estadoCarga";

interface Props {
    /** Estado terminal de cada remesa de la carga (una sola, o las de la división). */
    resultados: EstadoCargaDto[];
    /** Carga dividida: cada remesa lee el archivo entero, así que las descartadas no se suman. */
    dividida?: boolean;
    onNewImport: () => void;
    /** Remesas de la división que se eliminaron mientras se cargaba (el grupo trae menos que su total). */
    eliminadas?: number;
    /** Remesas que el backend no pudo encolar y quedaron sin confirmar. */
    noEncoladas?: RemesaNoEncolada[];
    /** "Cargar las que faltan": confirma las `noEncoladas`. */
    onCargarFaltantes?: () => void;
    /** Las remesas que el botón "Retomar" va a volver a encolar (las de la corrida actual). Si no se pasa, las retomables de `resultados`. */
    retomables?: EstadoCargaDto[];
    /** "Retomar": vuelve a encolar las remesas retomables de `resultados` y vuelve al paso "Importando". */
    onRetomar?: () => void;
    /** Hay un pedido de retomar o de cargar las que faltan en vuelo. */
    ocupado?: boolean;
}

/** Alerta fija de las remesas que el backend no pudo encolar (§10.8.3). */
export function AlertaNoEncoladas({ noEncoladas }: { noEncoladas: RemesaNoEncolada[] }) {
    if (noEncoladas.length === 0) return null;
    const numeros = noEncoladas.map((n) => n.numeroRemesa).join(", ");
    return (
        <Alert severity="error" sx={{ width: "100%", textAlign: "left", overflowWrap: "anywhere" }}>
            <AlertTitle>
                {noEncoladas.length === 1
                    ? "1 remesa no se pudo encolar y quedó sin confirmar"
                    : `${noEncoladas.length} remesas no se pudieron encolar y quedaron sin confirmar`}
            </AlertTitle>
            Remesa{noEncoladas.length === 1 ? "" : "s"}: {numeros}.
        </Alert>
    );
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

export default function ImportSummary({
    resultados,
    dividida = false,
    onNewImport,
    eliminadas = 0,
    noEncoladas = [],
    onCargarFaltantes,
    onRetomar,
    retomables: retomablesProp,
    ocupado = false,
}: Props) {
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
    // Con remesas que el backend no pudo encolar el encabezado no puede ser de éxito, aunque las que corrieron hayan salido bien.
    const presentado =
        noEncoladas.length > 0 && (presentadoResultados === null || presentadoResultados.severidad === "success")
            ? {
                  severidad: "warning" as SeveridadResultado,
                  titulo: "La importación quedó incompleta",
                  detalle: "Hay remesas que no se pudieron encolar y quedaron sin confirmar.",
              }
            : presentadoResultados;

    // Una división con remesas que no se cargaron (falló, se canceló o se puede retomar) quedó incompleta: se decide con
    // los resultados de cada remesa, no con las que no llegaron a correr.
    const retomables = retomablesProp ?? resultados.filter(esRetomable);
    const tardias = resultados.filter(cancelacionLlegoTarde);
    const hayNoCargadas = resultados.some((r) => r.resultado === "FALLIDA" || estaCancelada(r) || esRetomable(r));
    const incompleta = dividida && resultados.length > 1 && hayNoCargadas;

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

                {incompleta && (
                    <Alert severity="warning" sx={{ width: "100%", textAlign: "left" }}>
                        <AlertTitle>La importación quedó incompleta</AlertTitle>
                        Algunas remesas de la división no se cargaron. Las demás terminaron como se detalla abajo.
                    </Alert>
                )}

                {tardias.map((r) => (
                    <Alert key={r.remesaId} severity="info" sx={{ width: "100%", textAlign: "left" }}>
                        {resultados.length > 1 ? `Remesa ${r.numeroRemesa}: ` : ""}
                        {textoCancelacionTardia(r.resultado)}
                    </Alert>
                ))}

                {eliminadas > 0 && (
                    <Alert severity="info" sx={{ width: "100%", textAlign: "left" }}>
                        {eliminadas === 1
                            ? "1 remesa de esta división se eliminó."
                            : `${eliminadas} remesas de esta división se eliminaron.`}
                    </Alert>
                )}

                <AlertaNoEncoladas noEncoladas={noEncoladas} />

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
                                    {esRetomable(r) && <Chip label="Se puede retomar" size="small" variant="outlined" />}
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

                    {onRetomar && retomables.length > 0 && (
                        <Button variant="contained" color="warning" startIcon={<PlayArrowIcon />} onClick={onRetomar} disabled={ocupado}>
                            {!(dividida && resultados.length > 1)
                                ? "Retomar"
                                : retomables.length === 1
                                ? "Retomar la que no se cargó"
                                : `Retomar las ${retomables.length} que no se cargaron`}
                        </Button>
                    )}

                    {onCargarFaltantes && noEncoladas.length > 0 && (
                        <Button variant="contained" color="warning" onClick={onCargarFaltantes} disabled={ocupado}>
                            Cargar las que faltan
                        </Button>
                    )}

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
