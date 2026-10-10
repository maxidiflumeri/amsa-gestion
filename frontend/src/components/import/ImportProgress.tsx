import React, { useEffect, useRef, useState } from "react";
import {
    Alert,
    Box,
    Button,
    Typography,
    LinearProgress,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import HourglassTopIcon from "@mui/icons-material/HourglassTop";
import CancelOutlinedIcon from "@mui/icons-material/CancelOutlined";
import { SectionCard } from "../ui";
import AvisosCarga from "./AvisosCarga";
import { cancelarCarga, cancelarGrupo, obtenerGrupo } from "../../api/imports";
import { useAuth } from "../../context/AuthContext";
import { useSocket } from "../../context/SocketContext";
import { useEstadoCarga } from "../../hooks/useEstadoCarga";
import { useNotify } from "../../hooks/useNotify";
import type { EstadoCargaDto } from "../../types/importProgreso";
import {
    barraIndeterminada,
    cancelacionPedidaAt,
    casosActualizados,
    casosNuevos,
    datosDeGrupo,
    descartadasPorFiltro,
    esCancelable,
    etiquetaFase,
    formatearNumero,
    lineaCancelarPorCategoria,
    lineaDeRitmo,
    motivoNoCancelable,
    puedeGestionarCarga,
} from "../../utils/estadoCarga";

interface Props {
    remesaId: number;
    /** Se llama UNA vez, cuando la carga terminó (con el resultado que sea, aunque todo valga 0). Una carga dividida
     *  la decide el grupo entero y no la usa. */
    onComplete?: (estado: EstadoCargaDto) => void;
    /** La `carga` que devolvió el POST de ejecutar: siembra el estado sin esperar un evento ni un GET. */
    estadoInicial?: EstadoCargaDto | null;
    /** La remesa dejó de existir (alguien la borró mientras esperaba). Se llama una vez. */
    onNoExiste?: () => void;
    /** Se llama una vez cuando se ve la carga en curso o terminada: el pedido de ejecutar ya surtió efecto. */
    onSeguimiento?: () => void;
    /** "Nueva importación" de la alerta fija de remesa no encontrada. */
    onNuevaImportacion?: () => void;
    /** Se canceló algo de una carga dividida: quien muestra el grupo lo vuelve a pedir. */
    onGrupoCambio?: () => void;
    /** Las remesas de la división, si se muestra una (para ofrecer "Cancelar todo lo que falta"). */
    grupo?: EstadoCargaDto[];
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
    onGrupoCambio,
    grupo,
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
        onCompleteRef.current?.(estado);
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

                    <BotonCancelarCarga carga={estado} onResultado={aplicar} onGrupoCambio={onGrupoCambio} grupo={grupo} />
                </Box>
            </SectionCard>
        </Box>
    );
}

interface BotonCancelarCargaProps {
    carga: EstadoCargaDto | null;
    /** Aplica la `carga` que devolvió el pedido al hook de quien lo usa (no hace falta esperar el evento). */
    onResultado?: (carga: EstadoCargaDto) => void;
    /** Se canceló algo de una carga dividida: quien muestra el grupo lo vuelve a pedir. */
    onGrupoCambio?: () => void;
    /** Alineación del botón y del motivo cuando va deshabilitado. En el paso "Importando" es centrado; en el detalle, a la izquierda. */
    alineacion?: "center" | "flex-start";
    /** Las remesas de la división, si quien lo usa ya las tiene: sirve para saber si alguna se puede cancelar aunque la actual no. */
    grupo?: EstadoCargaDto[];
}

/** Remesas de un grupo con el número a la vista: "3, 4 y 5". */
function listarNumeros(remesas: EstadoCargaDto[]): string {
    const numeros = remesas.map((r) => r.numeroRemesa);
    if (numeros.length <= 1) return numeros.join("");
    return `${numeros.slice(0, -1).join(", ")} y ${numeros[numeros.length - 1]}`;
}

/** Por qué la remesa en curso no se corta, para el diálogo de una división. */
function explicarNoCancelable(carga: EstadoCargaDto): string {
    if (carga.fase === "POST_PROCESO") return `La remesa en curso (${carga.numeroRemesa}) ya está cerrando y no se cancela: va a terminar.`;
    if (cancelacionPedidaAt(carga) != null) return `La cancelación de la remesa en curso (${carga.numeroRemesa}) ya está pedida.`;
    const motivo = motivoNoCancelable(carga) ?? "No se puede cancelar en este momento.";
    return `La remesa en curso (${carga.numeroRemesa}) no se cancela: ${motivo}`;
}

/**
 * "Cancelar importación" (docs/imports-progreso-realtime-spec.md §10.8.4). Lo comparten el paso "Importando" y el
 * detalle. Se muestra solo con `importacion.ejecutar` y siendo el dueño (o con `importacion.ver_progreso_otros`) y si
 * el backend informa `cancelable`; si la carga está en curso y nada se puede cancelar, va deshabilitado con el motivo.
 * En una división, mientras alguna remesa sea cancelable se ofrece "Cancelar todo lo que falta", aunque la que está
 * en curso no se pueda cortar. Cancelar no se deshace: el diálogo dice qué va a pasar y pide confirmar.
 */
export function BotonCancelarCarga({ carga, onResultado, onGrupoCambio, alineacion = "center", grupo: grupoProp }: BotonCancelarCargaProps) {
    const { usuario, tienePermiso } = useAuth();
    const notify = useNotify();
    const [abierto, setAbierto] = useState(false);
    const [enviando, setEnviando] = useState(false);
    const [grupoLeido, setGrupoLeido] = useState<EstadoCargaDto[] | null>(null);
    const [cargandoGrupo, setCargandoGrupo] = useState(false);

    // `cancelable` ausente = un backend sin esta función: no hay nada que ofrecer.
    if (!carga || !carga.enCurso || carga.cancelable == null) return null;
    if (!puedeGestionarCarga(carga, usuario?.id, tienePermiso)) return null;

    const datos = datosDeGrupo(carga);
    // Las del diálogo son las leídas al abrirlo; si no se pudieron leer, las que ya tenía quien lo usa.
    const grupo = grupoLeido ?? grupoProp ?? null;
    const hermanasCancelables = (grupoProp ?? []).filter((r) => r.enCurso && r.remesaId !== carga.remesaId && esCancelable(r));
    const puede = esCancelable(carga) || (datos !== null && hermanasCancelables.length > 0);
    const motivo = motivoNoCancelable(carga) ?? "No se puede cancelar en este momento.";

    const abrir = async () => {
        setAbierto(true);
        setGrupoLeido(null);
        if (!datos) return;
        // Las hermanas del momento: cuáles faltan y cuáles no empezaron.
        setCargandoGrupo(true);
        try {
            setGrupoLeido((await obtenerGrupo(datos.grupoId)).remesas);
        } catch {
            setGrupoLeido(null);
        } finally {
            setCargandoGrupo(false);
        }
    };

    const cancelarSoloEsta = async () => {
        setEnviando(true);
        try {
            const r = await cancelarCarga(carga.remesaId);
            onResultado?.(r.carga);
            onGrupoCambio?.();
            if (r.efecto === "CANCELADA") notify.info("Importación cancelada.");
            setAbierto(false);
        } catch (err) {
            notify.error(err as Error);
            onGrupoCambio?.();
        } finally {
            setEnviando(false);
        }
    };

    const cancelarTodoLoQueFalta = async () => {
        if (!datos) return;
        setEnviando(true);
        try {
            const { resultados } = await cancelarGrupo(datos.grupoId);
            const propia = resultados.find((x) => x.remesaId === carga.remesaId);
            if (propia?.carga) onResultado?.(propia.carga);
            for (const x of resultados) {
                if (x.efecto === "RECHAZADA") notify.warning(`Remesa ${x.numeroRemesa}: ${x.motivo ?? "no se pudo cancelar"}`);
            }
            onGrupoCambio?.();
            setAbierto(false);
        } catch (err) {
            notify.error(err as Error);
            onGrupoCambio?.();
        } finally {
            setEnviando(false);
        }
    };

    const propiaCancelable = esCancelable(carga);
    const enCola = carga.fase === "EN_COLA";
    const leyendo = carga.fase === "LEYENDO";
    const pendientes = (grupo ?? []).filter((r) => r.enCurso);
    const otras = pendientes.filter((r) => r.remesaId !== carga.remesaId);
    const otrasCancelables = otras.filter(esCancelable);
    const enProceso = otrasCancelables.filter((r) => r.fase !== "EN_COLA");
    const sinEmpezar = otrasCancelables.filter((r) => r.fase === "EN_COLA");
    const conOpciones = datos !== null && otrasCancelables.length > 0;
    // Lo que corta "Cancelar todo lo que falta" incluye a esta remesa cuando es cancelable: el cartel la nombra.
    const porOrden = (a: EstadoCargaDto, b: EstadoCargaDto) => (a.grupoOrden ?? 0) - (b.grupoOrden ?? 0);
    const enProcesoTodas = [...(propiaCancelable && !enCola ? [carga] : []), ...enProceso].sort(porOrden);
    const sinEmpezarTodas = [...(propiaCancelable && enCola ? [carga] : []), ...sinEmpezar].sort(porOrden);
    // La división no se pudo leer: lo único que se puede hacer es cortar esta remesa, y hay que decirlo.
    const grupoIlegible = datos !== null && grupo === null && !cargandoGrupo;

    return (
        <>
            <Box sx={{ display: "flex", flexDirection: "column", alignItems: alineacion, gap: 0.5, maxWidth: "100%" }}>
                <Button
                    color="error"
                    variant="outlined"
                    size="small"
                    startIcon={<CancelOutlinedIcon />}
                    disabled={!puede}
                    onClick={() => void abrir()}
                >
                    {datos !== null && !esCancelable(carga) ? "Cancelar todo lo que falta" : "Cancelar importación"}
                </Button>
                {!puede && (
                    <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                        {motivo}
                    </Typography>
                )}
            </Box>

            <Dialog open={abierto} onClose={() => !enviando && setAbierto(false)} maxWidth="sm" fullWidth>
                <DialogTitle>{propiaCancelable ? "Cancelar importación" : "Cancelar todo lo que falta"}</DialogTitle>
                <DialogContent dividers sx={{ textAlign: "left" }}>
                    {!propiaCancelable ? (
                        <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
                            {explicarNoCancelable(carga)}
                            {sinEmpezar.length > 0 &&
                                ` ${sinEmpezar.length === 1 ? "Se cancela la que no empezó" : `Se cancelan las ${sinEmpezar.length} que no empezaron`} (${listarNumeros(sinEmpezar)}).`}
                        </Typography>
                    ) : enCola ? (
                        <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
                            Esta importación todavía no empezó. Si la cancelás no se carga ninguna fila, y después la
                            podés retomar desde su detalle.
                        </Typography>
                    ) : leyendo ? (
                        <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
                            Todavía está leyendo el archivo y no se procesó ninguna fila. Si la cancelás ahora no
                            debería cargarse ninguna; el resultado lo dice con el número exacto y, si no se cargó
                            ninguna, la podés retomar desde su detalle.
                        </Typography>
                    ) : (
                        <>
                            <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
                                {carga.totalEsperado > 0
                                    ? `Lleva ${formatearNumero(carga.procesadas)} de ${formatearNumero(carga.totalEsperado)} filas.`
                                    : `Lleva ${formatearNumero(carga.procesadas)} filas.`}{" "}
                                Si la cancelás, <strong>las filas ya procesadas quedan cargadas</strong> —no se
                                deshacen— y el cierre de la carga no corre. Se corta al terminar la fila o el lote en
                                curso.
                            </Typography>
                            <Typography variant="body2" sx={{ mt: 1, overflowWrap: "anywhere" }}>
                                {lineaCancelarPorCategoria(carga.tipo)}
                            </Typography>
                        </>
                    )}

                    {datos && cargandoGrupo && (
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 2 }}>
                            <CircularProgress size={16} />
                            <Typography variant="caption" color="text.secondary">
                                Buscando las otras remesas de la división…
                            </Typography>
                        </Box>
                    )}

                    {conOpciones && propiaCancelable && (
                        <Alert severity="info" sx={{ mt: 2 }}>
                            Esta remesa es parte de una carga dividida. «Cancelar todo lo que falta» cancela
                            {enProcesoTodas.length > 0 && ` la remesa en curso (${listarNumeros(enProcesoTodas)})`}
                            {enProcesoTodas.length > 0 && sinEmpezarTodas.length > 0 && " y"}
                            {sinEmpezarTodas.length > 0 &&
                                ` ${sinEmpezarTodas.length === 1 ? "la que no empezó" : `las ${sinEmpezarTodas.length} que no empezaron`} (${listarNumeros(sinEmpezarTodas)})`}
                            .
                        </Alert>
                    )}

                    {grupoIlegible && (
                        <Alert severity="warning" sx={{ mt: 2 }}>
                            Es una carga dividida en {datos?.total ?? "varias"} remesas y no se pudieron leer las
                            demás: esto cancela solo esta remesa; las otras siguen.
                        </Alert>
                    )}
                </DialogContent>
                <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
                    <Button color="inherit" onClick={() => setAbierto(false)} disabled={enviando}>
                        Volver
                    </Button>
                    {conOpciones ? (
                        <>
                            {propiaCancelable && (
                                <Button color="warning" variant="outlined" onClick={() => void cancelarSoloEsta()} disabled={enviando}>
                                    Cancelar solo esta remesa
                                </Button>
                            )}
                            <Button color="error" variant="contained" onClick={() => void cancelarTodoLoQueFalta()} disabled={enviando}>
                                Cancelar todo lo que falta
                            </Button>
                        </>
                    ) : (
                        <Button
                            color="error"
                            variant="contained"
                            onClick={() => void cancelarSoloEsta()}
                            disabled={enviando || cargandoGrupo || !propiaCancelable}
                        >
                            Cancelar importación
                        </Button>
                    )}
                </DialogActions>
            </Dialog>
        </>
    );
}
