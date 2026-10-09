import React, { useEffect, useRef } from "react";
import {
    Alert,
    Box,
    Button,
    Typography,
    LinearProgress,
    Chip,
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import HourglassTopIcon from "@mui/icons-material/HourglassTop";
import { SectionCard } from "../ui";
import AvisosCarga from "./AvisosCarga";
import { useSocket } from "../../context/SocketContext";
import { useEstadoCarga } from "../../hooks/useEstadoCarga";
import type { EstadoCargaDto } from "../../types/importProgreso";
import {
    barraIndeterminada,
    casosActualizados,
    casosNuevos,
    descartadasPorFiltro,
    etiquetaFase,
    formatearNumero,
    lineaDeRitmo,
} from "../../utils/estadoCarga";

interface Props {
    remesaId: number;
    /** Se llama UNA vez, cuando la carga terminó (con el resultado que sea, aunque todo valga 0). */
    onComplete: (estado: EstadoCargaDto) => void;
    /** La `carga` que devolvió el POST de ejecutar: siembra el estado sin esperar un evento ni un GET. */
    estadoInicial?: EstadoCargaDto | null;
    /** La remesa dejó de existir (alguien la borró mientras esperaba). Se llama una vez. */
    onNoExiste?: () => void;
    /** Se llama una vez cuando se ve la carga en curso o terminada: el pedido de ejecutar ya surtió efecto. */
    onSeguimiento?: () => void;
    /** "Nueva importación" de la alerta fija de remesa no encontrada. */
    onNuevaImportacion?: () => void;
}

export const MENSAJE_NO_SEGUIDA =
    "No se pudo seguir la importación: el servidor no encuentra la remesa. Revisá el Historial antes de volver a cargar el archivo, porque puede estar corriendo.";

export default function ImportProgress({
    remesaId,
    onComplete,
    estadoInicial = null,
    onNoExiste,
    onSeguimiento,
    onNuevaImportacion,
}: Props) {
    const navigate = useNavigate();
    const { conectado } = useSocket();
    // Sigue hasta el estado terminal: en este paso la remesa puede figurar todavía como borrador.
    const { estado, noExiste, aplicar } = useEstadoCarga(remesaId, { seguirHastaTerminal: true });

    // onComplete cambia de identidad en cada render del wizard: se lee por ref para no re-disparar el efecto.
    const onCompleteRef = useRef(onComplete);
    onCompleteRef.current = onComplete;
    const disparadoRef = useRef(false);
    const onNoExisteRef = useRef(onNoExiste);
    onNoExisteRef.current = onNoExiste;
    const noExisteAvisadoRef = useRef(false);
    const onSeguimientoRef = useRef(onSeguimiento);
    onSeguimientoRef.current = onSeguimiento;
    const seguimientoAvisadoRef = useRef(false);

    useEffect(() => {
        if (seguimientoAvisadoRef.current || !estado || !(estado.enCurso || estado.terminal)) return;
        seguimientoAvisadoRef.current = true;
        onSeguimientoRef.current?.();
    }, [estado]);

    useEffect(() => {
        if (estadoInicial) aplicar(estadoInicial);
    }, [estadoInicial, aplicar]);

    useEffect(() => {
        if (!noExiste || noExisteAvisadoRef.current) return;
        noExisteAvisadoRef.current = true;
        onNoExisteRef.current?.();
    }, [noExiste]);

    useEffect(() => {
        if (disparadoRef.current || !estado || !estado.terminal) return;
        disparadoRef.current = true;
        onCompleteRef.current(estado);
    }, [estado]);

    const indeterminada = barraIndeterminada(estado);
    const fase = etiquetaFase(estado, "wizard");
    const ritmo = estado ? lineaDeRitmo(estado) : null;

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
                        width: "100%",
                    }}
                >
                    {noExiste && (
                        <Alert
                            severity="error"
                            sx={{ width: "100%", textAlign: "left" }}
                            action={
                                <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                                    <Button color="inherit" size="small" onClick={() => navigate("/historial-importaciones")}>
                                        Ir al historial
                                    </Button>
                                    {onNuevaImportacion && (
                                        <Button color="inherit" size="small" onClick={onNuevaImportacion}>
                                            Nueva importación
                                        </Button>
                                    )}
                                </Box>
                            }
                        >
                            {MENSAJE_NO_SEGUIDA}
                        </Alert>
                    )}

                    {!noExiste && (
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
                    )}

                    {!indeterminada && estado && (
                        <Typography variant="h4" fontWeight={700} color="primary.main">
                            {estado.progreso}%
                        </Typography>
                    )}

                    {!noExiste && (
                    <LinearProgress
                        variant={indeterminada ? "indeterminate" : "determinate"}
                        value={indeterminada ? undefined : estado?.progreso ?? 0}
                        sx={{
                            width: "100%",
                            height: 8,
                            borderRadius: 4,
                        }}
                    />
                    )}

                    {estado && (
                        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", justifyContent: "center" }}>
                            {estado.totalEsperado > 0 && (
                                <Chip label={`Total: ${formatearNumero(estado.totalEsperado)}`} variant="outlined" size="small" />
                            )}
                            <Chip label={`Procesadas: ${formatearNumero(estado.procesadas)}`} variant="outlined" size="small" />
                            <Chip label={`OK: ${formatearNumero(estado.ok)}`} color="success" variant="outlined" size="small" />
                            {estado.err > 0 && (
                                <Chip label={`Errores: ${formatearNumero(estado.err)}`} color="error" variant="outlined" size="small" />
                            )}
                            {descartadasPorFiltro(estado) > 0 && (
                                <Chip
                                    label={`Descartadas: ${formatearNumero(descartadasPorFiltro(estado))}`}
                                    color="warning"
                                    variant="outlined"
                                    size="small"
                                />
                            )}
                            {casosNuevos(estado) !== null && (
                                <Chip label={`Nuevos: ${formatearNumero(casosNuevos(estado) as number)}`} variant="outlined" size="small" />
                            )}
                            {casosActualizados(estado) !== null && (
                                <Chip
                                    label={`Actualizados: ${formatearNumero(casosActualizados(estado) as number)}`}
                                    variant="outlined"
                                    size="small"
                                />
                            )}
                        </Box>
                    )}

                    {ritmo && (
                        <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                            {ritmo}
                        </Typography>
                    )}

                    <Box sx={{ maxWidth: "100%" }}>
                        <Typography variant="body1" fontWeight={600}>
                            {fase.principal}
                        </Typography>
                        {fase.secundario && (
                            <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                                {fase.secundario}
                            </Typography>
                        )}
                    </Box>

                    <AvisosCarga estado={estado} conectado={conectado} />
                </Box>
            </SectionCard>
        </Box>
    );
}
