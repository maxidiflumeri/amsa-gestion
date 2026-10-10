import React, { useCallback, useEffect, useRef, useState } from "react";
import { isAxiosError } from "axios";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import {
    Alert,
    AlertTitle,
    Box,
    Button,
    Chip,
    Step,
    StepLabel,
    Stepper,
    Typography,
    MenuItem,
    Select,
    Checkbox,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    ListItemText,
    FormControl,
    FormControlLabel,
    FormHelperText,
    InputLabel,
    LinearProgress,
    Paper,
    Stack,
    Switch,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TextField,
    useMediaQuery,
    useTheme,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import api from "../api/axios";
import { useEmpresas } from "../hooks/useEmpresas";
import { useNotify } from "../hooks/useNotify";
import { useConfirm } from "../context/ConfirmContext";
import { useGrupoCarga } from "../hooks/useGrupoCarga";
import { PageContainer, PageHeader, SectionCard } from "../components/ui";
import { etiquetaRemesa } from "../utils/remesa";

import CategorySelector from "../components/import/CategorySelector";
import FileDropZone from "../components/import/FileDropZone";
import MultiarchivoDropZone, { paqueteCompleto } from "../components/import/MultiarchivoDropZone";
import PreviewTable from "../components/import/PreviewTable";
import ImportProgress, { MENSAJE_NO_SEGUIDA } from "../components/import/ImportProgress";
import {
    ejecutarGrupo,
    obtenerEstadoCarga,
    retomarGrupo,
    retomarRemesa,
    type CorteYaCargado,
    type RemesaNoEncolada,
} from "../api/imports";
import {
    datosDeGrupo,
    descartadasPorFiltroEnVistaPrevia,
    esEstadoCarga,
    esRetomable,
    estadoEnGrupo,
    formatearNumero,
    grupoTerminado,
    remesaActualDelGrupo,
    textoSubida,
    type ProgresoSubida,
} from "../utils/estadoCarga";
import ImportSummary, { AlertaNoEncoladas } from "../components/import/ImportSummary";
import MulticlavesResumen from "../components/import/MulticlavesResumen";
import PagosConClaveResumen from "../components/import/PagosConClaveResumen";
import type { MulticlavesPreview, MulticlavePagosPreview } from "../api/multiclaves";
import type { EstadoCargaDto } from "../types/importProgreso";

const steps = [
    "Categoría",
    "Plantilla y archivo",
    "Vista previa",
    "Importando",
    "Resultado",
];

/** Un corte del archivo con el número de remesa que le va a tocar (editable por el operador). */
/** Texto del error de un pedido, para mostrarlo en el resumen (el mismo que sale en el toast). */
function mensajeDeError(err: unknown): string {
    if (isAxiosError(err)) {
        const mensaje = (err.response?.data as { message?: string | string[] } | undefined)?.message;
        if (mensaje) return Array.isArray(mensaje) ? mensaje[0] : mensaje;
    }
    return err instanceof Error ? err.message : "Error inesperado";
}

interface CorteEditable {
    valores: Record<string, string>;
    filas: number;
    numeroRemesa: string;
    /** El operador puede sacar un corte de la carga (una nómina que todavía no se gestiona). */
    incluir: boolean;
    /**
     * Las condiciones que aíslan las filas de este corte, tal como las calculó el preview. Viajan
     * de vuelta al crear: un corte que agrupó dos variantes de la misma gestión (`3G` y `3GH`) no
     * se puede reconstruir desde `valores`, que ahí muestra las dos juntas.
     */
    filtros?: unknown[];
    /** Si el archivo ya tiene este corte cargado en otra remesa (§10.5.6). Viene de la vista de cortes. */
    yaCargado?: CorteYaCargado;
}

/** Lo que se sabe de cada remesa de una carga dividida al armar la vista previa (§10.8.2). */
interface RemesaDeVistaPrevia {
    remesaId: number;
    numeroRemesa: string;
    corte: string;
    filas: number;
    /** Filas con error en la muestra de la vista previa. */
    errores: number;
    /** Descartadas por el filtro de la plantilla (sin las de otros cortes). */
    descartadas: number;
    /** Filas del archivo que son de otros cortes de la división. */
    deOtrosCortes: number;
    avisos: string[];
}

/** Un corte ya cargado, en curso o a medias viene destildado; cargarlo de nuevo duplica sus casos. */
function corteBloquea(y?: CorteYaCargado): boolean {
    // Solo "sin cargar" se tilda solo. Una situación que este código no conoce se trata como bloqueada.
    return y != null && y.situacion !== "SIN_CARGAR";
}

/** El corte en una frase corta: "3082 · Gestión 1". */
function etiquetaCorte(valores: Record<string, string>): string {
    return Object.values(valores).filter(Boolean).join(" · ") || "—";
}

/** Texto de la columna "Estado" de la vista de cortes (§10.5.6). */
function textoEstadoCorte(y: CorteYaCargado, categoria: string): string {
    switch (y.situacion) {
        case "EN_CURSO":
            return `Se está cargando en la remesa ${y.numeroRemesa}`;
        case "CARGADA":
            return `Ya está cargado en la remesa ${y.numeroRemesa} (${formatearNumero(y.casos)} casos)`;
        case "A_MEDIAS":
            // Eliminar la remesa solo deshace lo cargado en Deudores y en Deudores y Facturas.
            return categoria === "DEUDORES" || categoria === "DEUDORES_Y_FACTURAS"
                ? `Quedó a medias en la remesa ${y.numeroRemesa}: eliminala antes de volver a cargar este corte`
                : `Quedó a medias en la remesa ${y.numeroRemesa}: avisá a soporte antes de volver a cargar este corte`;
        case "SIN_CARGAR":
            return y.retomable
                ? `No llegó a cargarse en la remesa ${y.numeroRemesa}. Podés retomarla desde su detalle en vez de crear otra`
                : `No llegó a cargarse en la remesa ${y.numeroRemesa}`;
        default:
            return `Este corte figura en la remesa ${y.numeroRemesa}: revisá su detalle antes de cargarlo`;
    }
}

interface PasoImportandoGrupoProps {
    grupoId: string;
    /** Corte de cada remesa, para la lista. */
    cortes: Record<number, string>;
    noEncoladas: RemesaNoEncolada[];
    omitidas: Array<{ remesaId: number; numeroRemesa: string; motivo: string }>;
    /** Se llama UNA vez, cuando todas las remesas del grupo terminaron. */
    onTerminaron: (remesas: EstadoCargaDto[], total: number) => void;
    onNuevaImportacion: () => void;
}

/**
 * Paso "Importando" de una carga dividida (§10.8.3). La pestaña no arranca nada: las N remesas están en la cola del
 * servidor desde que se confirmó. Esto solo las muestra, y se puede cerrar.
 */
function PasoImportandoGrupo({ grupoId, cortes, noEncoladas, omitidas, onTerminaron, onNuevaImportacion }: PasoImportandoGrupoProps) {
    const navigate = useNavigate();
    const { remesas, total, noExiste, refrescar } = useGrupoCarga(grupoId);
    const actual = remesaActualDelGrupo(remesas);
    // `total > 0` = ya llegó la primera respuesta del grupo: antes, "todas terminales" podría ser solo lo que
    // alcanzaron a traer los eventos.
    const terminaron = total > 0 && grupoTerminado(remesas);
    const onTerminaronRef = useRef(onTerminaron);
    onTerminaronRef.current = onTerminaron;
    const avisadoRef = useRef(false);

    useEffect(() => {
        if (avisadoRef.current || !terminaron) return;
        avisadoRef.current = true;
        onTerminaronRef.current(remesas, total);
    }, [terminaron, remesas, total]);

    const eliminadas = Math.max(0, total - remesas.length - noEncoladas.length);

    return (
        <Box>
            {noExiste && (
                <Alert
                    severity="error"
                    sx={{ mb: 2, textAlign: "left" }}
                    action={
                        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                            <Button color="inherit" size="small" onClick={() => navigate("/historial-importaciones")}>
                                Ir al historial
                            </Button>
                            <Button color="inherit" size="small" onClick={onNuevaImportacion}>
                                Nueva importación
                            </Button>
                        </Box>
                    }
                >
                    {MENSAJE_NO_SEGUIDA}
                </Alert>
            )}

            <Alert severity="info" sx={{ mb: 2 }}>
                <AlertTitle>
                    {actual?.grupoOrden != null && total > 0
                        ? `Carga dividida: remesa ${actual.grupoOrden} de ${total}`
                        : "Carga dividida"}
                </AlertTitle>
                Las remesas se cargan una después de la otra en el servidor. Podés cerrar esta pantalla: siguen igual,
                y las ves en la campanita y en el Historial.
            </Alert>

            {noEncoladas.length > 0 && (
                <Box sx={{ mb: 2 }}>
                    <AlertaNoEncoladas noEncoladas={noEncoladas} />
                </Box>
            )}

            {omitidas.length > 0 && (
                <Alert severity="warning" sx={{ mb: 2, overflowWrap: "anywhere" }}>
                    <AlertTitle>No se retomaron</AlertTitle>
                    {omitidas.map((o) => (
                        <Typography key={o.remesaId} variant="body2">
                            Remesa {o.numeroRemesa}: {o.motivo}
                        </Typography>
                    ))}
                </Alert>
            )}

            {remesas.length === 0 && !noExiste && (
                <Box sx={{ mb: 2 }}>
                    <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
                        Enviando a la cola…
                    </Typography>
                    <LinearProgress sx={{ borderRadius: 1 }} />
                </Box>
            )}

            {remesas.length > 0 && (
                <Box sx={{ mb: 2 }}>
                    {remesas.map((r) => {
                        const est = estadoEnGrupo(r);
                        const esActual = actual?.remesaId === r.remesaId;
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
                                <Typography variant="body2" fontWeight={esActual ? 700 : 600}>
                                    Remesa {r.numeroRemesa}
                                </Typography>
                                {cortes[r.remesaId] && (
                                    <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                                        {cortes[r.remesaId]}
                                    </Typography>
                                )}
                                <Box sx={{ flexGrow: 1 }} />
                                <Chip label={est.texto} color={est.color} size="small" variant="outlined" />
                            </Box>
                        );
                    })}
                    {eliminadas > 0 && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                            {eliminadas === 1
                                ? "1 remesa de esta división se eliminó."
                                : `${eliminadas} remesas de esta división se eliminaron.`}
                        </Typography>
                    )}
                </Box>
            )}

            {actual && (
                <ImportProgress key={actual.remesaId} remesaId={actual.remesaId} onGrupoCambio={() => void refrescar()} grupo={remesas} />
            )}
        </Box>
    );
}

export default function ImportWizard() {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down("md"));
    const notify = useNotify();
    const confirm = useConfirm();

    const { empresas, loading: loadingEmpresas } = useEmpresas();
    const [empresaId, setEmpresaId] = useState<number | "">(1);

    const [activeStep, setActiveStep] = useState(0);
    const [loading, setLoading] = useState(false);

    // Paso 0 – categoría
    const [categoria, setCategoria] = useState("");

    // Paso 1 – plantilla + archivo
    const [plantillas, setPlantillas] = useState<any[]>([]);
    const [selectedPlantilla, setSelectedPlantilla] = useState<number | null>(null);
    // Archivos de la carga. Todas las categorías aceptan **varios del mismo formato**, que se
    // importan como una sola remesa: hay cedentes que parten la cartera en un archivo por sucursal
    // (AYSA manda 31 por bajada). Con uno solo el flujo es el de siempre.
    const [archivos, setArchivos] = useState<File[]>([]);
    // MULTIARCHIVO es otra cosa: un paquete de archivos con roles DISTINTOS que se cruzan entre sí
    // (Toyota TCFA). El rol de cada uno se resuelve por su nombre (acá para dar feedback, y en el
    // backend de forma autoritativa).
    const [archivosPaquete, setArchivosPaquete] = useState<File[]>([]);
    const [nombreRemesa, setNombreRemesa] = useState("");
    const [numeroRemesa, setNumeroRemesa] = useState("");
    const [fechaVencimiento, setFechaVencimiento] = useState("");
    const [hojaExcel, setHojaExcel] = useState<string>("");
    const [validarDomicilios, setValidarDomicilios] = useState(false);

    const isExcelFile = archivos[0]?.name?.match(/\.(xls|xlsx)$/i);

    // Remesa de deudores origen
    // MULTIRREGISTRO: resumen del parseo (tipos de línea, casos, facturas, bajas) para el preview.
    const [multiResumen, setMultiResumen] = useState<any | null>(null);
    // MULTIARCHIVO: resumen del cruce de los archivos del paquete para el preview.
    const [paqueteResumen, setPaqueteResumen] = useState<any | null>(null);
    // MULTICLAVES: resumen del cruce contra la cartera (con caso / sin caso / conflictos) para el preview.
    const [multiclavesResumen, setMulticlavesResumen] = useState<MulticlavesPreview | null>(null);
    // PAGOS con `nroConvenio` mapeado (fase 4a de multiclaves): bloque adicional, no reemplaza la tabla.
    const [pagosConClaveResumen, setPagosConClaveResumen] = useState<MulticlavePagosPreview | null>(null);
    // Qué archivos entraron en la remesa y cuántas filas descartó el filtro de la plantilla. Es lo
    // que el operador confirma antes de ejecutar cuando sube una tanda de archivos.
    const [resumenArchivos, setResumenArchivos] = useState<
        { archivos?: string[]; descartadas?: number; fueraDeCorte?: number; filtro?: string } | null
    >(null);
    // Subida de los archivos al crear el borrador (y al previsualizar una división): es un estado de la
    // pantalla, no una fase de la carga. Se limpia en el `finally` del pedido.
    const [subida, setSubida] = useState<ProgresoSubida | null>(null);
    const alSubir = (e: { loaded: number; total?: number }) =>
        setSubida({ enviados: e.loaded, total: e.total ?? 0 });
    const [remesasDeudores, setRemesasDeudores] = useState<any[]>([]);
    // El combo mostraba TODAS las remesas de la empresa —las de facturas, las de pagos, las de
    // acciones— y con 100 remesas encima elegir era imposible. Ahora se piden solo las que
    // cargaron casos y, por defecto, solo las que todavía tienen alguno vivo: son las que se
    // gestionan hoy, que es a las que se les aplica un archivo de cobros.
    const [soloEnGestion, setSoloEnGestion] = useState(true);
    const [remesaOrigenId, setRemesaOrigenId] = useState<number | null>(null);
    // PAGOS, FACTURAS, CONTACTOS y ENRIQUECIMIENTO: se pueden elegir VARIAS remesas origen (el
    // archivo del cedente cubre varias asignaciones), así una sola corrida cubre las N remesas en
    // vez de correr el archivo por cada una.
    const [remesaOrigenIds, setRemesaOrigenIds] = useState<number[]>([]);
    // ACCIONES: la remesa origen es OPCIONAL (sin elegir = toda la base de la empresa).
    const esAcciones = categoria === "ACCIONES";
    // MULTIRREGISTRO trae todo en un mismo archivo: los casos nuevos entran en la remesa de esta
    // importación y los que ya existen se buscan por Nº Cliente en toda la empresa.
    const esMultirregistro = categoria === "MULTIRREGISTRO";
    // MULTIARCHIVO se comporta igual que MULTIRREGISTRO respecto de la remesa origen: los casos
    // nuevos entran en la remesa de esta importación y los que ya existen se buscan por Nº Cliente
    // en toda la empresa.
    const esMultiarchivo = categoria === "MULTIARCHIVO";
    // MULTICLAVES: la clave se guarda por (empresaId, nroTramite), no atada a una remesa de
    // deudores (spec §5.1) — no hay "remesa origen" que elegir.
    const esMulticlaves = categoria === "MULTICLAVES";
    // Patrones de nombre de archivo de la plantilla elegida, para reconocer qué archivo es cuál.
    const patronesArchivos = plantillas.find((p) => p.id === selectedPlantilla)
        ?.mappingJson?.multiarchivo?.archivos as Record<string, string> | undefined;
    // El archivo del cedente cubre varias asignaciones, así que se pueden elegir varias remesas
    // origen y cargarlo una sola vez. ACTUALIZACIONES sigue con una sola: toma la remesa como "la
    // cartera" (ahí crea los casos nuevos y sobre ella calcula los ausentes). ACCIONES también.
    const multiOrigen = ["PAGOS", "FACTURAS", "CONTACTOS", "ENRIQUECIMIENTO"].includes(categoria);
    const needsOrigen =
        categoria !== "" &&
        categoria !== "DEUDORES" &&
        categoria !== "DEUDORES_Y_FACTURAS" &&
        !esAcciones &&
        !esMultirregistro &&
        !esMultiarchivo &&
        !esMulticlaves;

    // Paso 2 – preview
    const [remesaId, setRemesaId] = useState<number | null>(null);
    const [preview, setPreview] = useState<any[]>([]);
    const [previewStats, setPreviewStats] = useState({ total: 0, ok: 0, err: 0 });
    const [accionesImpacto, setAccionesImpacto] = useState<{ matchMode: string; deudoresAfectados: number; contactosAEliminar?: number; valoresDistintos: number; operaciones: string[] } | null>(null);

    // Avisos del preview que no invalidan la carga pero conviene leer antes de ejecutar
    // (importes negativos, cuentas que van a colapsar por la identidad elegida).
    const [advertencias, setAdvertencias] = useState<string[]>([]);

    // ─── División de la carga en varias remesas ───────────────────────────
    // Los archivos de Telecom/Personal traen varias asignaciones juntas porque Deimos exporta
    // filtrando solo por día. Se cuenta cada corte ANTES de crear nada, el operador confirma los
    // números contra lo que le informó el cedente, y recién ahí se crean las N remesas.
    const [cortes, setCortes] = useState<CorteEditable[] | null>(null);
    const [dialogoDivision, setDialogoDivision] = useState(false);
    // Remesas creadas por la división. Se validan todas en la vista previa y se confirman juntas con un solo pedido
    // (`ejecutar-grupo`): el backend las encola en orden y la pestaña ya no arranca nada.
    const [colaRemesas, setColaRemesas] = useState<number[]>([]);
    // Una fila por remesa de la vista previa de una carga dividida (§10.8.2).
    const [remesasPreview, setRemesasPreview] = useState<RemesaDeVistaPrevia[]>([]);
    // "Armando la vista previa: remesa 2 de 5…"
    const [progresoVista, setProgresoVista] = useState<{ actual: number; total: number } | null>(null);
    // Id del grupo en el backend, una vez confirmada una carga dividida.
    const [grupoId, setGrupoId] = useState<string | null>(null);
    const [noEncoladas, setNoEncoladas] = useState<RemesaNoEncolada[]>([]);
    const [omitidas, setOmitidas] = useState<Array<{ remesaId: number; numeroRemesa: string; motivo: string }>>([]);
    const [eliminadas, setEliminadas] = useState(0);
    // Cada vez que se vuelve al paso "Importando" (retomar, cargar las que faltan) se monta de cero.
    const [intentoSeguimiento, setIntentoSeguimiento] = useState(0);
    const [retomando, setRetomando] = useState(false);

    // Paso 4 – resultado final: el estado terminal de cada remesa de la carga.
    const [resultados, setResultados] = useState<EstadoCargaDto[]>([]);
    // Evita el doble clic en "Confirmar e importar".
    const [enviando, setEnviando] = useState(false);
    // La `carga` que devolvió el POST de ejecutar: siembra el paso "Importando" sin esperar un evento.
    const [cargaInicial, setCargaInicial] = useState<EstadoCargaDto | null>(null);
    const [esDivision, setEsDivision] = useState(false);
    // Resultados de corridas anteriores de la misma carga (antes de "Cargar las que faltan"): el resumen final los suma.
    const [resultadosPrevios, setResultadosPrevios] = useState<EstadoCargaDto[]>([]);
    // true cuando el paso "Importando" ya vio la carga en curso o terminada.
    const seguimientoRef = useRef(false);
    // true si la última consulta del estado real, tras un fallo de ejecutar, dijo que la remesa sigue siendo un borrador.
    const borradorConfirmadoRef = useRef(false);

    // ─── Carga de plantillas ─────────────────────────────────
    useEffect(() => {
        if (!categoria || !empresaId) return;
        setPlantillas([]);
        setSelectedPlantilla(null);
        setRemesaOrigenId(null);
        api.get(`/import/plantillas/${empresaId}/${categoria}`)
            .then((res) => setPlantillas(res.data))
            .catch((err) => notify.error(err));
    }, [categoria, empresaId]);

    // ─── Carga de remesas de deudores ────────────────────────
    useEffect(() => {
        if ((!needsOrigen && !esAcciones) || !empresaId) {
            setRemesasDeudores([]);
            return;
        }
        api.get(`/import/remesas/empresa/${empresaId}`, {
            params: { conDeudores: true, ...(soloEnGestion ? { enGestion: true } : {}) },
        })
            .then((res) => setRemesasDeudores(
                res.data.filter((r: any) => r.estadoProceso === "FINALIZADA")
            ))
            .catch((err) => notify.error(err));
    }, [needsOrigen, esAcciones, empresaId, soloEnGestion]);

    // Si al apretar el filtro desaparece una remesa elegida, se saca de la selección: dejarla
    // marcada sin verla llevaba a ejecutar sobre una remesa que el operador creía descartada.
    useEffect(() => {
        const visibles = new Set(remesasDeudores.map((r: any) => r.id));
        setRemesaOrigenIds((prev) => prev.filter((id) => visibles.has(id)));
        setRemesaOrigenId((prev) => (prev != null && !visibles.has(prev) ? null : prev));
    }, [remesasDeudores]);

    // ─── Handlers ────────────────────────────────────────────

    const handleCategorySelect = (cat: string) => {
        setCategoria(cat);
    };

    const handleFilesChange = (fs: File[]) => {
        setArchivos(fs);
        setHojaExcel("");
    };

    const handleNext = () => {
        setActiveStep((prev) => prev + 1);
    };

    const handleBack = () => {
        setActiveStep((prev) => prev - 1);
    };

    /**
     * Config de división de la plantilla elegida, si la declara.
     *
     * Hay **dos formas** guardadas en la base y las dos tienen que activar el paso de cortes: la
     * original (`porNomina` / `porGestion`) y la actual (`cortes[]` + `prefijo`), que existe desde
     * que un mismo CA puede necesitar cortarse también por prebaja/posbaja. El backend ya las
     * resuelve a una sola en `normalizarDivision()`; acá alcanza con reconocer las dos, porque una
     * plantilla guardada con la forma nueva y no reconocida acá se carga como **una sola remesa**
     * sin avisar nada.
     */
    const divisionConfig = plantillas.find((p) => p.id === selectedPlantilla)
        ?.mappingJson?.divisionRemesa as
        | {
              cortes?: { etiqueta: string }[];
              prefijo?: { etiqueta: string };
              porNomina?: { etiqueta: string };
              porGestion?: { etiqueta: string };
          }
        | undefined;
    const plantillaDivide = !!(
        divisionConfig?.cortes?.length ||
        divisionConfig?.prefijo ||
        divisionConfig?.porNomina ||
        divisionConfig?.porGestion
    );

    /** Adjunta los archivos subidos al FormData con la clave que espera el backend. */
    const adjuntarArchivos = (formData: FormData) => {
        if (esMultiarchivo) {
            // El backend acepta `file` (uno) o `files` (varios); el rol de cada archivo del
            // paquete lo resuelve por el nombre, así que el orden en que se agregan no importa.
            for (const f of archivosPaquete) formData.append("files", f);
        } else if (archivos.length === 1) {
            formData.append("file", archivos[0]);
        } else {
            // Varios archivos del mismo formato: se recorren en el orden en que se subieron.
            for (const f of archivos) formData.append("files", f);
        }
    };

    /**
     * Paso previo a crear nada: se lee el archivo y se cuenta cuántos casos tiene cada nómina y
     * cada gestión. Es lo que le permite al operador cotejar contra el mail del cedente ("nómina
     * 3082 por 13.948 casos") antes de cargar.
     */
    const handlePrevisualizarDivision = async (previos?: CorteEditable[]) => {
        setLoading(true);
        try {
            const formData = new FormData();
            formData.append("plantillaId", String(selectedPlantilla));
            formData.append("empresaId", String(empresaId));
            formData.append("numeroRemesa", numeroRemesa.trim());
            if (isExcelFile && hojaExcel.trim() !== "") formData.append("hoja", hojaExcel.trim());
            adjuntarArchivos(formData);

            setSubida({ enviados: 0, total: 0 });
            const res = await api.post("/import/remesas/division-preview", formData, {
                headers: { "Content-Type": "multipart/form-data" },
                onUploadProgress: alSubir,
            });

            setCortes(
                (res.data.cortes ?? []).map((c: any) => {
                    // Si se vuelve a pedir tras un 409, se conserva lo que el operador tocó (tildado y número) y se
                    // aplica solo el estado nuevo: un corte que pasó a estar cargado queda destildado (§10.8.1).
                    const previo = previos?.find((x) => JSON.stringify(x.valores) === JSON.stringify(c.valores));
                    const bloquea = corteBloquea(c.yaCargado);
                    let incluir = !bloquea;
                    if (previo) {
                        incluir = bloquea && !corteBloquea(previo.yaCargado) ? false : previo.incluir;
                    }
                    return {
                        valores: c.valores,
                        filas: c.filas,
                        numeroRemesa: previo ? previo.numeroRemesa : (c.numeroSugerido ?? ""),
                        incluir,
                        filtros: c.filtros,
                        yaCargado: c.yaCargado ?? undefined,
                    };
                }),
            );
            if (previos) notify.warning("Los cortes que se cargaron mientras tanto quedaron destildados.");
            setDialogoDivision(true);
        } catch (err: any) {
            notify.error(err);
        } finally {
            setSubida(null);
            setLoading(false);
        }
    };

    // Paso 1 → 2: Crear remesa + validar
    const handleCrearYValidar = async (divisiones?: CorteEditable[]) => {
        if (!selectedPlantilla || !categoria) {
            notify.warning("Seleccioná categoría y plantilla.");
            return;
        }
        if (esMultiarchivo) {
            if (!paqueteCompleto(archivosPaquete, patronesArchivos)) {
                notify.warning(
                    "Revisá el paquete: falta algún archivo obligatorio o hay uno que no se reconoce.",
                );
                return;
            }
        } else if (archivos.length === 0) {
            notify.warning("Seleccioná el archivo a importar.");
            return;
        }
        // MULTICLAVES: el número no es el correlativo de la empresa (D5). Se valida en el cliente
        // para no hacerle perder el archivo ya elegido al operador con un 400 del servidor.
        if (esMulticlaves && numeroRemesa.trim() && /^\d+$/.test(numeroRemesa.trim())) {
            notify.warning(
                "Las cargas de claves de pago no usan el número correlativo de remesas. Dejá el número vacío o usá uno con letras.",
            );
            return;
        }

        setLoading(true);

        try {
            const formData = new FormData();
            formData.append("empresaId", String(empresaId));
            formData.append("categoria", categoria);
            formData.append("plantillaId", String(selectedPlantilla));
            formData.append(
                "nombre",
                nombreRemesa || `Remesa ${new Date().toLocaleString()}`
            );
            // Si el operador no escribe un número, se manda vacío y el backend genera el
            // correlativo de la empresa (00001, 00002, …). Antes acá se caía a Date.now(), que
            // es el origen de los "números de remesa random" tipo 1784657478166.
            formData.append("numeroRemesa", numeroRemesa.trim());
            if (fechaVencimiento) {
                formData.append("fechaVencimiento", fechaVencimiento);
            }
            adjuntarArchivos(formData);

            // Carga dividida: las N remesas se crean de una, todas apuntando al mismo archivo.
            if (divisiones?.length) {
                formData.append(
                    "divisiones",
                    JSON.stringify(
                        divisiones.map((d) => ({
                            valores: d.valores,
                            numeroRemesa: d.numeroRemesa.trim(),
                            filtros: d.filtros,
                            // Solo viaja si el operador tildó a mano un corte ya cargado y lo confirmó.
                            ...(corteBloquea(d.yaCargado) ? { repetir: true } : {}),
                        })),
                    ),
                );
            }

            if (isExcelFile && hojaExcel.trim() !== "") {
                formData.append("hoja", hojaExcel.trim());
            }

            formData.append("validarDomicilios", String(validarDomicilios));

            setSubida({ enviados: 0, total: 0 });
            const resRemesa = await api.post("/import/remesas", formData, {
                headers: { "Content-Type": "multipart/form-data" },
                onUploadProgress: alSubir,
            });

            // Los archivos ya llegaron (aunque el navegador no haya sabido el total): sigue la validación.
            setSubida((prev) => {
                const total = Math.max(prev?.total ?? 0, prev?.enviados ?? 0, 1);
                return { enviados: total, total };
            });

            const creadas: number[] = resRemesa.data.remesaIds ?? [resRemesa.data.remesaId];
            const newRemesaId = creadas[0];
            setRemesaId(newRemesaId);
            setColaRemesas(creadas);
            setGrupoId(null);
            setNoEncoladas([]);
            setOmitidas([]);
            setEliminadas(0);
            setResultados([]);
            setEsDivision(!!divisiones?.length);
            setResultadosPrevios([]);

            // Se valida cada remesa, en orden: el backend exige la vista previa de todas para confirmarlas juntas, y el
            // operador ve cuántas filas tiene cada una antes de cargar. La muestra y los avisos de abajo son los de la
            // primera. Si una validación falla, se muestra el error y no se avanza (las demás quedan como borradores
            // y las borra el reaper).
            const validaciones: any[] = [];
            for (let i = 0; i < creadas.length; i++) {
                if (creadas.length > 1) setProgresoVista({ actual: i + 1, total: creadas.length });
                const res = await api.post(`/import/validar/${creadas[i]}`);
                validaciones.push(res.data);
            }
            const resValidar = { data: validaciones[0] };

            setRemesasPreview(
                creadas.length > 1
                    ? creadas.map((id, i) => ({
                          remesaId: id,
                          numeroRemesa: divisiones?.[i]?.numeroRemesa.trim() ?? String(id),
                          corte: etiquetaCorte(divisiones?.[i]?.valores ?? {}),
                          filas: validaciones[i].total ?? 0,
                          errores: validaciones[i].err ?? 0,
                          descartadas: descartadasPorFiltroEnVistaPrevia(validaciones[i]),
                          deOtrosCortes: validaciones[i].fueraDeCorte ?? 0,
                          avisos: validaciones[i].advertencias ?? [],
                      }))
                    : [],
            );

            setPreview(resValidar.data.sample ?? []);
            setPreviewStats({
                total: resValidar.data.total ?? 0,
                ok: resValidar.data.ok ?? 0,
                err: resValidar.data.err ?? 0,
            });

            setAdvertencias(resValidar.data.advertencias ?? []);
            setMultiResumen(resValidar.data.multirregistro ?? null);
            setPaqueteResumen(resValidar.data.multiarchivo ?? null);
            setMulticlavesResumen(resValidar.data.multiclaves ?? null);
            setPagosConClaveResumen(resValidar.data.multiclavePagos ?? null);
            setResumenArchivos(
                resValidar.data.archivos || resValidar.data.descartadas
                    ? {
                          archivos: resValidar.data.archivos,
                          descartadas: resValidar.data.descartadas,
                          fueraDeCorte: resValidar.data.fueraDeCorte,
                          filtro: resValidar.data.filtro,
                      }
                    : null,
            );

            if (categoria === "ACCIONES") {
                try {
                    const resImp = await api.get(`/import/remesas/${newRemesaId}/acciones-preview`, {
                        params: remesaOrigenId ? { remesaOrigenId } : undefined,
                    });
                    setAccionesImpacto(resImp.data);
                } catch {
                    setAccionesImpacto(null);
                }
            } else {
                setAccionesImpacto(null);
            }

            setActiveStep(2);
        } catch (err: any) {
            notify.error(err);
            // Otra pestaña cargó un corte mientras tanto: el alta lo rechazó sin crear nada (§10.5.6). Se vuelve a
            // pedir la vista de cortes para que se vea cómo está ahora.
            if (
                divisiones?.length &&
                isAxiosError(err) &&
                err.response?.status === 409 &&
                mensajeDeError(err).includes("cortes cargados")
            ) {
                await handlePrevisualizarDivision(cortes ?? divisiones);
            }
        } finally {
            setSubida(null);
            setProgresoVista(null);
            setLoading(false);
        }
    };

    /** Las remesas de origen con las que se confirma la carga (las mismas para una remesa suelta y para un grupo). */
    const origenParaEjecutar = () => ({
        remesaOrigenId: multiOrigen ? undefined : (remesaOrigenId ?? undefined),
        remesaOrigenIds: multiOrigen && remesaOrigenIds.length ? remesaOrigenIds : undefined,
    });

    /** Confirma una remesa suelta (ya validada en el paso 2). */
    const ejecutarRemesa = async (id: number): Promise<EstadoCargaDto | null> => {
        try {
            const { data } = await api.post<{ carga?: unknown }>(`/import/ejecutar/${id}`, origenParaEjecutar());
            return esEstadoCarga(data?.carga) ? data.carga : null;
        } catch (err) {
            // Ante CUALQUIER fallo se mira el estado real de la remesa: un POST que dio timeout o cuya respuesta se
            // perdió puede haber encolado igual (o la carga ya haber corrido). No se decide por el texto del error.
            try {
                const real = await obtenerEstadoCarga(id);
                if (esEstadoCarga(real) && (real.enCurso || real.terminal)) return real;
                if (esEstadoCarga(real)) borradorConfirmadoRef.current = true;
            } catch {
                // Sin poder consultar, se muestra el error original.
            }
            throw err;
        }
    };

    /**
     * Confirma las remesas: una sola con `ejecutar/:id`; dos o más con un único pedido, `ejecutar-grupo`, que las
     * encola juntas y en orden (§10.8.2). Si el pedido falla, se mira el estado real de la primera: si está en curso o
     * terminó, se sigue al grupo; si es un borrador, se vuelve a la vista previa con el error.
     */
    const confirmarRemesas = async (ids: number[]): Promise<void> => {
        if (ids.length === 1) {
            const carga = await ejecutarRemesa(ids[0]);
            setGrupoId(null);
            setNoEncoladas([]);
            setCargaInicial(carga);
            return;
        }
        try {
            const respuesta = await ejecutarGrupo({ remesaIds: ids, ...origenParaEjecutar() });
            setNoEncoladas(respuesta.noEncoladas ?? []);
            setGrupoId(respuesta.grupoId);
        } catch (err) {
            try {
                const real = await obtenerEstadoCarga(ids[0]);
                if (esEstadoCarga(real)) {
                    const datos = datosDeGrupo(real);
                    if ((real.enCurso || real.terminal) && datos) {
                        setNoEncoladas([]);
                        setGrupoId(datos.grupoId);
                        return;
                    }
                    if (!real.enCurso && !real.terminal) borradorConfirmadoRef.current = true;
                }
            } catch {
                // Sin poder consultar, se muestra el error original.
            }
            throw err;
        }
    };

    // Paso 2 → 3: Confirmar y ejecutar
    const handleEjecutar = async () => {
        if (!remesaId || enviando) return;

        setEnviando(true);
        seguimientoRef.current = false;
        borradorConfirmadoRef.current = false;
        setIntentoSeguimiento((n) => n + 1);
        setActiveStep(3);

        try {
            await confirmarRemesas(colaRemesas.length > 0 ? colaRemesas : [remesaId]);
        } catch (err: any) {
            // Si la carga ya se está siguiendo (en curso o terminada), un fallo tardío del POST no puede volver atrás.
            // Salvo que la consulta del estado real haya dicho que sigue siendo un borrador: esa es la verdad.
            if (seguimientoRef.current && !borradorConfirmadoRef.current) return;
            notify.error(err);
            setEnviando(false);
            setActiveStep(2);
        }
    };

    /** Resultado → Importando: las remesas que el backend no pudo encolar se confirman de nuevo (sin volver a subir nada). */
    const handleCargarFaltantes = async () => {
        if (noEncoladas.length === 0 || retomando) return;
        const ids = noEncoladas.map((n) => n.remesaId).sort((a, b) => a - b);
        setRetomando(true);
        seguimientoRef.current = false;
        borradorConfirmadoRef.current = false;
        try {
            await confirmarRemesas(ids);
            setResultadosPrevios((prev) => [...prev, ...resultados.filter((r) => !prev.some((p) => p.remesaId === r.remesaId))]);
            setColaRemesas(ids);
            setRemesaId(ids[0]);
            setResultados([]);
            setEliminadas(0);
            setOmitidas([]);
            setIntentoSeguimiento((n) => n + 1);
            setActiveStep(3);
        } catch (err) {
            notify.error(err as Error);
        } finally {
            setRetomando(false);
        }
    };

    /**
     * Resultado → Importando: vuelve a encolar las remesas que no cargaron ninguna fila (§10.8.5). Cuáles se pueden
     * retomar lo dice el backend (`retomable`); acá no se deduce.
     */
    const handleRetomar = async () => {
        const retomables = resultados.filter(esRetomable);
        if (retomables.length === 0 || retomando) return;
        const varias = retomables.length > 1;
        const acepta = await confirm({
            title: varias ? "Retomar las remesas" : "Retomar la remesa",
            description: varias
                ? "Se vuelven a encolar las mismas remesas, con el mismo archivo. No se cargó ninguna fila la vez anterior."
                : "Se vuelve a encolar la misma remesa, con el mismo archivo. No se cargó ninguna fila la vez anterior.",
            confirmLabel: "Retomar",
        });
        if (!acepta) return;

        setRetomando(true);
        seguimientoRef.current = false;
        try {
            if (grupoId !== null) {
                const respuesta = await retomarGrupo(grupoId);
                setOmitidas(respuesta.omitidas ?? []);
            } else {
                const respuesta = await retomarRemesa(retomables[0].remesaId);
                setOmitidas([]);
                setCargaInicial(respuesta.carga);
            }
            setResultados([]);
            setEliminadas(0);
            setIntentoSeguimiento((n) => n + 1);
            setActiveStep(3);
        } catch (err) {
            notify.error(err as Error);
        } finally {
            setRetomando(false);
        }
    };

    // Todas las remesas del grupo terminaron: pasa a "Resultado" con las N.
    const handleGrupoTerminado = useCallback(
        (remesas: EstadoCargaDto[], total: number) => {
            setResultados(remesas);
            setEliminadas(Math.max(0, total - remesas.length - noEncoladas.length));
            setActiveStep(4);
        },
        [noEncoladas.length],
    );

    // Carga común: terminó la remesa, con el resultado que sea (también FALLIDA, cancelada o sin filas).
    const handleImportComplete = useCallback((estado: EstadoCargaDto) => {
        setResultados([estado]);
        setActiveStep(4);
    }, []);

    const handleNewImport = () => {
        setActiveStep(0);
        setCategoria("");
        setPlantillas([]);
        setSelectedPlantilla(null);
        setArchivos([]);
        setArchivosPaquete([]);
        setPaqueteResumen(null);
        setResumenArchivos(null);
        setMultiResumen(null);
        setMulticlavesResumen(null);
        setPagosConClaveResumen(null);
        setRemesaId(null);
        setRemesaOrigenId(null);
        setRemesaOrigenIds([]);
        setRemesasDeudores([]);
        setPreview([]);
        setPreviewStats({ total: 0, ok: 0, err: 0 });
        setAccionesImpacto(null);
        setAdvertencias([]);
        setCortes(null);
        setColaRemesas([]);
        setRemesasPreview([]);
        setProgresoVista(null);
        setGrupoId(null);
        setNoEncoladas([]);
        setOmitidas([]);
        setEliminadas(0);
        setIntentoSeguimiento(0);
        setRetomando(false);
        setResultados([]);
        setEnviando(false);
        seguimientoRef.current = false;
        borradorConfirmadoRef.current = false;
        setCargaInicial(null);
        setEsDivision(false);
        setResultadosPrevios([]);
    };

    // Números que chocan entre sí. La combinación 3G / 3GH del archivo real produce el mismo
    // sugerido para las dos, así que el choque hay que mostrarlo, no dejarlo llegar al backend.
    const numerosRepetidos = (() => {
        const usados = (cortes ?? [])
            .filter((c) => c.incluir)
            .map((c) => c.numeroRemesa.trim())
            .filter(Boolean);
        return [...new Set(usados.filter((n, i) => usados.indexOf(n) !== i))];
    })();
    // Cortes que el archivo ya tiene cargados (o en curso, o a medias): vienen destildados, y si el operador los
    // vuelve a tildar, sus casos quedan duplicados (§10.8.1).
    const cortesYaCargados = (cortes ?? []).filter((c) => corteBloquea(c.yaCargado));
    const cortesRepetidos = cortesYaCargados.filter((c) => c.incluir);
    const divisionValida =
        (cortes ?? []).some((c) => c.incluir) &&
        (cortes ?? []).every((c) => !c.incluir || c.numeroRemesa.trim()) &&
        numerosRepetidos.length === 0;

    // ─── Render ──────────────────────────────────────────────

    // Una carga dividida no se puede confirmar con una remesa en cero (§10.8.2).
    const remesasSinFilas = remesasPreview.filter((r) => r.filas === 0);

    const canGoNext = () => {
        switch (activeStep) {
            case 0:
                return !!categoria;
            case 1:
                if (!selectedPlantilla) return false;
                // MULTIARCHIVO no sube un archivo sino un paquete: se habilita cuando están todos
                // los obligatorios y ninguno quedó sin reconocer.
                if (esMultiarchivo) {
                    if (!paqueteCompleto(archivosPaquete, patronesArchivos)) return false;
                } else if (archivos.length === 0) {
                    return false;
                }
                if (!needsOrigen) return true;
                return multiOrigen ? remesaOrigenIds.length > 0 : !!remesaOrigenId;
            default:
                return false;
        }
    };

    return (
        <PageContainer maxWidth={900}>
            <PageHeader
                title="Importación de datos"
                subtitle="Subí tus archivos para cargar deudores, facturas o contactos."
                breadcrumbs={[
                    { label: "Inicio", href: "/" },
                    { label: "Importación" },
                ]}
            />

            {/* Stepper */}
            <Stepper
                activeStep={activeStep}
                alternativeLabel={!isMobile}
                orientation={isMobile ? "vertical" : "horizontal"}
                sx={{ mb: 4 }}
            >
                {steps.map((label) => (
                    <Step key={label}>
                        <StepLabel>{label}</StepLabel>
                    </Step>
                ))}
            </Stepper>

            {/* Contenido por paso */}
            <SectionCard sx={{ minHeight: 300 }}>
                {/* PASO 0 — Categoría */}
                {activeStep === 0 && (
                    <CategorySelector
                        selected={categoria}
                        onSelect={handleCategorySelect}
                    />
                )}

                {/* PASO 1 — Plantilla + Archivo */}
                {activeStep === 1 && (
                    <Stack spacing={3}>
                        <Typography variant="h6" sx={{ fontWeight: 600 }}>
                            Configurar importación
                        </Typography>

                        {/* Selector de empresa */}
                        <FormControl fullWidth>
                            <InputLabel id="empresa-label">Empresa</InputLabel>
                            <Select
                                labelId="empresa-label"
                                value={empresaId}
                                label="Empresa"
                                onChange={(e) => setEmpresaId(e.target.value as number)}
                                disabled={loadingEmpresas}
                            >
                                {empresas.map((emp) => (
                                    <MenuItem key={emp.id} value={emp.id}>
                                        {emp.nombre}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        {/* Campos de Remesa Manual (no aplican a Acciones masivas) */}
                        {!esAcciones && (
                            <>
                                <Stack
                                    direction={{ xs: "column", sm: "row" }}
                                    spacing={2}
                                >
                                    <TextField
                                        label="Nombre de remesa"
                                        variant="outlined"
                                        fullWidth
                                        placeholder="Ej: Asignación Feb-2024"
                                        value={nombreRemesa}
                                        onChange={(e) => setNombreRemesa(e.target.value)}
                                        helperText="Opcional: se generará uno automático si se deja vacío"
                                    />
                                    <TextField
                                        label="Número de remesa"
                                        variant="outlined"
                                        fullWidth
                                        placeholder={esMulticlaves ? "Se genera solo (MC-…)" : "Ej: 00007"}
                                        value={numeroRemesa}
                                        onChange={(e) => setNumeroRemesa(e.target.value)}
                                        helperText={
                                            esMulticlaves
                                                ? "Dejalo vacío: se genera MC-AAAAMMDD-HHmmss. Esta carga no usa el correlativo de remesas de la empresa."
                                                : "Opcional: si se deja vacío sigue el correlativo de la empresa (00001, 00002, …)"
                                        }
                                    />
                                </Stack>

                                <TextField
                                    label="Fecha de vencimiento (Lote)"
                                    type="date"
                                    variant="outlined"
                                    fullWidth
                                    value={fechaVencimiento}
                                    onChange={(e) => setFechaVencimiento(e.target.value)}
                                    InputLabelProps={{ shrink: true }}
                                    helperText="Opcional: se aplicará esta fecha a todos los deudores sin fecha específica"
                                />
                            </>
                        )}

                        {/* Selector de plantilla */}
                        <FormControl fullWidth>
                            <InputLabel id="plantilla-label">
                                Plantilla de mapeo
                            </InputLabel>
                            <Select
                                labelId="plantilla-label"
                                label="Plantilla de mapeo"
                                value={selectedPlantilla ?? ""}
                                onChange={(e) =>
                                    setSelectedPlantilla(Number(e.target.value))
                                }
                            >
                                {plantillas.length === 0 && (
                                    <MenuItem disabled value="">
                                        Sin plantillas para esta categoría
                                    </MenuItem>
                                )}
                                {plantillas.map((p) => (
                                    <MenuItem key={p.id} value={p.id}>
                                        {p.nombre} (v{p.version})
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        {/* Validación de domicilios contra Georef (no aplica a Acciones masivas ni Multiclaves) */}
                        {!esAcciones && !esMulticlaves && (
                            <Box>
                                <FormControlLabel
                                    control={
                                        <Switch
                                            checked={validarDomicilios}
                                            onChange={(e) => setValidarDomicilios(e.target.checked)}
                                        />
                                    }
                                    label="Validar domicilios contra Georef"
                                />
                                <Typography
                                    variant="caption"
                                    color="text.secondary"
                                    sx={{ display: "block", ml: 1 }}
                                >
                                    Más lento. Si está desactivado, los domicilios se cargan con
                                    formato pero sin verificar.
                                </Typography>
                            </Box>
                        )}

                        {/* PAGOS, FACTURAS, CONTACTOS y ENRIQUECIMIENTO: selector MÚLTIPLE de remesas origen */}
                        {multiOrigen && (
                            <FormControl fullWidth>
                                <InputLabel id="remesa-origen-multi-label">
                                    Vincular a remesas de deudores
                                </InputLabel>
                                <Select
                                    labelId="remesa-origen-multi-label"
                                    label="Vincular a remesas de deudores"
                                    multiple
                                    value={remesaOrigenIds}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        setRemesaOrigenIds(
                                            typeof val === "string"
                                                ? val.split(",").map(Number)
                                                : (val as number[])
                                        );
                                    }}
                                    renderValue={(selected) =>
                                        (selected as number[]).length === 1
                                            ? "1 remesa seleccionada"
                                            : `${(selected as number[]).length} remesas seleccionadas`
                                    }
                                >
                                    {remesasDeudores.length === 0 && (
                                        <MenuItem disabled value="">
                                            {soloEnGestion
                                                ? "No hay remesas de deudores en gestión"
                                                : "No hay remesas de deudores finalizadas"}
                                        </MenuItem>
                                    )}
                                    {remesasDeudores.map((r: any) => (
                                        <MenuItem key={r.id} value={r.id}>
                                            <Checkbox checked={remesaOrigenIds.indexOf(r.id) > -1} />
                                            <ListItemText
                                                primary={`${etiquetaRemesa(r)} · [${r.categoria}] — ${r.totalFilas ?? 0} deudores — ${new Date(r.createdAt).toLocaleDateString()}`}
                                            />
                                        </MenuItem>
                                    ))}
                                </Select>

                                <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1, flexWrap: "wrap" }}>
                                    <Button
                                        size="small"
                                        onClick={() => setRemesaOrigenIds(remesasDeudores.map((r: any) => r.id))}
                                        disabled={
                                            remesasDeudores.length === 0 ||
                                            remesaOrigenIds.length === remesasDeudores.length
                                        }
                                    >
                                        Seleccionar todas ({remesasDeudores.length})
                                    </Button>
                                    <Button
                                        size="small"
                                        color="inherit"
                                        onClick={() => setRemesaOrigenIds([])}
                                        disabled={remesaOrigenIds.length === 0}
                                    >
                                        Limpiar
                                    </Button>
                                    <FormControlLabel
                                        sx={{ ml: "auto" }}
                                        control={
                                            <Switch
                                                size="small"
                                                checked={soloEnGestion}
                                                onChange={(e) => setSoloEnGestion(e.target.checked)}
                                            />
                                        }
                                        label="Solo remesas en gestión"
                                    />
                                </Box>

                                <FormHelperText>
                                    {soloEnGestion
                                        ? "Se listan las remesas que todavía tienen casos activos (sin cancelar ni desasignar). \"Seleccionar todas\" alcanza para el archivo del mes."
                                        : "Se listan todas las remesas que cargaron casos, incluidas las ya cerradas."}
                                    {" "}El archivo se aplica a todas las elegidas en una sola corrida: si la carga
                                    se dividió en varias remesas, se cubren todas de una.
                                </FormHelperText>
                            </FormControl>
                        )}

                        {/* Selector de remesa de deudores origen (single) */}
                        {!multiOrigen && (needsOrigen || esAcciones) && (
                            <FormControl fullWidth>
                                <InputLabel id="remesa-origen-label">
                                    {esAcciones ? "Aplicar solo a una remesa (opcional)" : "Vincular a remesa de deudores"}
                                </InputLabel>
                                <Select
                                    labelId="remesa-origen-label"
                                    label={esAcciones ? "Aplicar solo a una remesa (opcional)" : "Vincular a remesa de deudores"}
                                    value={remesaOrigenId ?? ""}
                                    onChange={(e) =>
                                        setRemesaOrigenId(e.target.value === "" ? null : Number(e.target.value))
                                    }
                                >
                                    {esAcciones && (
                                        <MenuItem value="">
                                            Toda la base de la empresa
                                        </MenuItem>
                                    )}
                                    {remesasDeudores.length === 0 && !esAcciones && (
                                        <MenuItem disabled value="">
                                            {soloEnGestion
                                                ? "No hay remesas de deudores en gestión"
                                                : "No hay remesas de deudores finalizadas"}
                                        </MenuItem>
                                    )}
                                    {remesasDeudores.map((r: any) => (
                                        <MenuItem key={r.id} value={r.id}>
                                            {etiquetaRemesa(r)} · [{r.categoria}] — {r.totalFilas ?? 0} deudores —{" "}
                                            {new Date(r.createdAt).toLocaleDateString()}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        )}

                        {/* Drop zone */}
                        {esMultiarchivo ? (
                            <MultiarchivoDropZone
                                archivos={archivosPaquete}
                                onChange={setArchivosPaquete}
                                patrones={patronesArchivos}
                            />
                        ) : (
                            <FileDropZone
                                files={archivos}
                                onFilesChange={handleFilesChange}
                            />
                        )}

                        {/* Excel Sheet Name Input */}
                        {isExcelFile && (
                            <TextField
                                label="Nombre de la hoja (Opcional)"
                                variant="outlined"
                                fullWidth
                                placeholder="Ej: Hoja1"
                                value={hojaExcel}
                                onChange={(e: any) => setHojaExcel(e.target.value)}
                                helperText="Dejar vacío para usar la primera hoja del archivo Excel"
                            />
                        )}
                    </Stack>
                )}

                {/* PASO 2 — Preview */}
                {activeStep === 2 && (
                    <>
                        {/* Lo que el preview detectó y conviene mirar ANTES de ejecutar: cuentas
                            que van a colapsar por la identidad elegida, importes en negativo. */}
                        {advertencias.length > 0 && (
                            <Alert severity="warning" sx={{ mb: 2 }}>
                                <AlertTitle>Revisá esto antes de importar</AlertTitle>
                                <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                                    {advertencias.map((a, i) => (
                                        <li key={i}>
                                            <Typography variant="body2">{a}</Typography>
                                        </li>
                                    ))}
                                </Box>
                            </Alert>
                        )}
                        {remesasPreview.length > 1 && (
                            <Box sx={{ mb: 2 }}>
                                <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
                                    Remesas que se van a cargar
                                </Typography>
                                <TableContainer component={Paper} variant="outlined">
                                    <Table size="small">
                                        <TableHead>
                                            <TableRow>
                                                <TableCell>Remesa</TableCell>
                                                <TableCell>Corte</TableCell>
                                                <TableCell align="right">Filas</TableCell>
                                                <TableCell align="right">Errores en la muestra de 50</TableCell>
                                                <TableCell align="right">Descartadas por el filtro</TableCell>
                                                <TableCell align="right">Avisos</TableCell>
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {remesasPreview.map((r) => (
                                                <TableRow key={r.remesaId} hover>
                                                    <TableCell sx={{ fontWeight: 600 }}>{r.numeroRemesa}</TableCell>
                                                    <TableCell sx={{ overflowWrap: "anywhere" }}>{r.corte}</TableCell>
                                                    <TableCell
                                                        align="right"
                                                        sx={r.filas === 0 ? { color: "error.main", fontWeight: 700 } : undefined}
                                                    >
                                                        {formatearNumero(r.filas)}
                                                    </TableCell>
                                                    <TableCell align="right">{formatearNumero(r.errores)}</TableCell>
                                                    <TableCell align="right">{formatearNumero(r.descartadas)}</TableCell>
                                                    <TableCell align="right">{formatearNumero(r.avisos.length)}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </TableContainer>
                                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                                    Al confirmar se cargan todas, una después de la otra, en el servidor. Arriba están los
                                    avisos de la primera remesa y abajo, su muestra.
                                </Typography>
                                {remesasPreview.slice(1).map(
                                    (r) =>
                                        r.avisos.length > 0 && (
                                            <Alert key={r.remesaId} severity="warning" sx={{ mt: 1 }}>
                                                <AlertTitle>Revisá esto antes de importar (remesa {r.numeroRemesa})</AlertTitle>
                                                <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                                                    {r.avisos.map((a, i) => (
                                                        <li key={i}>
                                                            <Typography variant="body2">{a}</Typography>
                                                        </li>
                                                    ))}
                                                </Box>
                                            </Alert>
                                        ),
                                )}
                                {remesasSinFilas.length > 0 && (
                                    <Alert severity="error" sx={{ mt: 1 }}>
                                        No se puede confirmar: {remesasSinFilas.length === 1 ? "la remesa" : "las remesas"}{" "}
                                        {remesasSinFilas.map((r) => r.numeroRemesa).join(", ")}{" "}
                                        {remesasSinFilas.length === 1 ? "no tiene" : "no tienen"} filas para importar.
                                        {remesasSinFilas.map((r) => (
                                            <Typography key={r.remesaId} variant="body2" sx={{ overflowWrap: "anywhere" }}>
                                                Remesa {r.numeroRemesa}:
                                                {r.descartadas > 0 && ` el filtro de la plantilla descartó las ${formatearNumero(r.descartadas)} filas.`}
                                                {r.deOtrosCortes > 0 && ` ${formatearNumero(r.deOtrosCortes)} filas son de otros cortes de la división.`}
                                                {r.descartadas === 0 && r.deOtrosCortes === 0 && " el archivo no trae filas para este corte."}
                                            </Typography>
                                        ))}
                                    </Alert>
                                )}
                            </Box>
                        )}
                        {esMultirregistro && multiResumen && (
                            <Alert severity={multiResumen.advertencias?.length ? "warning" : "info"} sx={{ mb: 2 }}>
                                <AlertTitle>
                                    {multiResumen.casos} casos · {multiResumen.facturas} avisos · {multiResumen.bajas} bajas
                                </AlertTitle>
                                Se leyeron {multiResumen.lineas} líneas
                                {multiResumen.porTipo &&
                                    ` (${Object.entries(multiResumen.porTipo)
                                        .map(([k, v]) => `${k}: ${v}`)
                                        .join(" · ")})`}
                                {multiResumen.ignoradas > 0 && ` · ${multiResumen.ignoradas} líneas ignoradas`}.
                                {multiResumen.advertencias?.length > 0 && (
                                    <Box component="ul" sx={{ mt: 1, mb: 0, pl: 2.5 }}>
                                        {multiResumen.advertencias.map((a: string, i: number) => (
                                            <li key={i}>
                                                <Typography variant="caption">{a}</Typography>
                                            </li>
                                        ))}
                                    </Box>
                                )}
                            </Alert>
                        )}
                        {esMultiarchivo && paqueteResumen && (
                            <Alert severity={paqueteResumen.advertencias?.length ? "warning" : "info"} sx={{ mb: 2 }}>
                                <AlertTitle>
                                    {paqueteResumen.casos} casos · {paqueteResumen.facturas} cuotas ·{" "}
                                    {paqueteResumen.bajas} bajas · {paqueteResumen.codeudores} codeudores
                                </AlertTitle>
                                Se leyeron{" "}
                                {Object.entries(paqueteResumen.lineas ?? {})
                                    .map(([k, v]) => `${k}: ${v}`)
                                    .join(" · ")}
                                .
                                {paqueteResumen.cuotasDescartadas > 0 && (
                                    <>
                                        {" "}Se descartaron <strong>{paqueteResumen.cuotasDescartadas} cuotas</strong> de
                                        asignaciones que ya no están vigentes.
                                    </>
                                )}
                                {paqueteResumen.casosSinDetalle > 0 && (
                                    <>
                                        {" "}Hay <strong>{paqueteResumen.casosSinDetalle} casos</strong> sin detalle de
                                        cuotas: se cargan con el total que declara el cedente.
                                    </>
                                )}
                                {paqueteResumen.advertencias?.length > 0 && (
                                    <Box component="ul" sx={{ mt: 1, mb: 0, pl: 2.5 }}>
                                        {paqueteResumen.advertencias.map((a: string, i: number) => (
                                            <li key={i}>
                                                <Typography variant="caption">{a}</Typography>
                                            </li>
                                        ))}
                                    </Box>
                                )}
                            </Alert>
                        )}
                        {resumenArchivos && (!!resumenArchivos.archivos || descartadasPorFiltroEnVistaPrevia(resumenArchivos) > 0) && (
                            <Alert severity="info" sx={{ mb: 2 }}>
                                {resumenArchivos.archivos && (
                                    <>
                                        <AlertTitle>
                                            {resumenArchivos.archivos.length} archivos en una sola remesa
                                        </AlertTitle>
                                        <Box component="ul" sx={{ mt: 0, mb: 0, pl: 2.5, maxHeight: 140, overflow: "auto" }}>
                                            {resumenArchivos.archivos.map((a) => (
                                                <li key={a}>
                                                    <Typography variant="caption">{a}</Typography>
                                                </li>
                                            ))}
                                        </Box>
                                    </>
                                )}
                                {descartadasPorFiltroEnVistaPrevia(resumenArchivos) > 0 && (
                                    <Typography variant="body2" sx={{ mt: resumenArchivos.archivos ? 1 : 0 }}>
                                        Se descartaron <strong>{formatearNumero(descartadasPorFiltroEnVistaPrevia(resumenArchivos))} filas</strong> que no
                                        cumplen el filtro de la plantilla
                                        {resumenArchivos.filtro && ` (${resumenArchivos.filtro})`}. No se importan y
                                        no cuentan como error.
                                    </Typography>
                                )}
                            </Alert>
                        )}
                        {categoria === "ACCIONES" && accionesImpacto && (
                            <Alert severity="warning" sx={{ mb: 2 }}>
                                {accionesImpacto.matchMode === "CONTACTO" ? (
                                    <>
                                        <AlertTitle>Vas a eliminar {accionesImpacto.contactosAEliminar ?? 0} contactos</AlertTitle>
                                        {accionesImpacto.valoresDistintos} valores en el archivo. Se borran de toda la base
                                        de la empresa. Se puede deshacer después. Revisá antes de confirmar.
                                    </>
                                ) : (
                                    <>
                                        <AlertTitle>Vas a modificar {accionesImpacto.deudoresAfectados} deudores</AlertTitle>
                                        {accionesImpacto.valoresDistintos} valores de match en el archivo ·
                                        operaciones: {accionesImpacto.operaciones.join(", ")}. Revisá antes de confirmar.
                                    </>
                                )}
                            </Alert>
                        )}
                        {esMulticlaves && multiclavesResumen ? (
                            // Acá "una fila" es un trámite: la tabla de muestra del CSV no dice nada
                            // útil. Lo que importa es el cruce contra la cartera (spec §5.6).
                            <MulticlavesResumen resumen={multiclavesResumen} />
                        ) : (
                            <>
                                {categoria === "PAGOS" && pagosConClaveResumen && (
                                    <PagosConClaveResumen resumen={pagosConClaveResumen} />
                                )}
                                <PreviewTable
                                    preview={preview}
                                    total={previewStats.total}
                                    ok={previewStats.ok}
                                    err={previewStats.err}
                                />
                            </>
                        )}
                    </>
                )}

                {/* PASO 3 — Progreso */}
                {activeStep === 3 && remesaId && (
                    <>
                        {grupoId !== null ? (
                            <PasoImportandoGrupo
                                key={`${grupoId}:${intentoSeguimiento}`}
                                grupoId={grupoId}
                                cortes={Object.fromEntries(remesasPreview.map((r) => [r.remesaId, r.corte]))}
                                noEncoladas={noEncoladas}
                                omitidas={omitidas}
                                onTerminaron={handleGrupoTerminado}
                                onNuevaImportacion={handleNewImport}
                            />
                        ) : colaRemesas.length > 1 ? (
                            // Se confirmó una carga dividida y el pedido todavía no volvió.
                            <Box>
                                <Typography variant="body1" fontWeight={600} sx={{ mb: 1 }}>
                                    Enviando a la cola…
                                </Typography>
                                <LinearProgress sx={{ borderRadius: 1 }} />
                            </Box>
                        ) : (
                            <ImportProgress
                                key={`${colaRemesas[0] ?? remesaId}:${intentoSeguimiento}`}
                                remesaId={colaRemesas[0] ?? remesaId}
                                onComplete={handleImportComplete}
                                estadoInicial={
                                    cargaInicial?.remesaId === (colaRemesas[0] ?? remesaId) ? cargaInicial : null
                                }
                                onSeguimiento={() => { seguimientoRef.current = true; }}
                                onNuevaImportacion={handleNewImport}
                            />
                        )}
                    </>
                )}

                {/* PASO 4 — Resumen */}
                {activeStep === 4 && remesaId && (
                    <ImportSummary
                        resultados={[...resultadosPrevios, ...resultados]}
                        retomables={resultados.filter(esRetomable)}
                        dividida={esDivision || resultadosPrevios.length > 0}
                        eliminadas={eliminadas}
                        noEncoladas={noEncoladas}
                        onCargarFaltantes={handleCargarFaltantes}
                        onRetomar={handleRetomar}
                        ocupado={retomando}
                        onNewImport={handleNewImport}
                    />
                )}
            </SectionCard>

            {activeStep === 2 && previewStats.total === 0 && remesasPreview.length <= 1 && (
                <Alert severity="warning" sx={{ mt: 2 }}>
                    El archivo no tiene filas para importar.
                    {!!resumenArchivos && descartadasPorFiltroEnVistaPrevia(resumenArchivos) > 0 &&
                        ` El filtro de la plantilla descartó las ${formatearNumero(descartadasPorFiltroEnVistaPrevia(resumenArchivos))} filas.`}
                    {!!resumenArchivos?.fueraDeCorte && resumenArchivos.fueraDeCorte > 0 &&
                        ` ${formatearNumero(resumenArchivos.fueraDeCorte)} filas son de otros cortes de la división.`}
                </Alert>
            )}

            {/* Barra de navegación inferior */}
            {activeStep < 3 && (
                <Box
                    sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        mt: 3,
                    }}
                >
                    <Button
                        startIcon={<ArrowBackIcon />}
                        disabled={activeStep === 0}
                        onClick={handleBack}
                    >
                        Atrás
                    </Button>

                    {activeStep === 0 && (
                        <Button
                            variant="contained"
                            endIcon={<ArrowForwardIcon />}
                            disabled={!canGoNext()}
                            onClick={handleNext}
                        >
                            Siguiente
                        </Button>
                    )}

                    {activeStep === 1 && (
                        <Button
                            variant="contained"
                            endIcon={<ArrowForwardIcon />}
                            disabled={!canGoNext() || loading}
                            onClick={() =>
                                plantillaDivide
                                    ? handlePrevisualizarDivision()
                                    : handleCrearYValidar()
                            }
                        >
                            {loading
                                ? "Procesando..."
                                : plantillaDivide
                                    ? "Ver los cortes del archivo"
                                    : "Crear remesa y validar"}
                        </Button>
                    )}

                    {activeStep === 2 && (
                        <Button
                            variant="contained"
                            color="success"
                            disabled={previewStats.total === 0 || remesasSinFilas.length > 0 || enviando}
                            onClick={handleEjecutar}
                        >
                            Confirmar e importar
                        </Button>
                    )}
                </Box>
            )}

            {/* Cortes del archivo: una remesa por nómina/gestión */}
            <Dialog
                open={dialogoDivision}
                onClose={() => setDialogoDivision(false)}
                maxWidth="md"
                fullWidth
            >
                <DialogTitle>El archivo trae varias asignaciones</DialogTitle>
                <DialogContent dividers>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Se va a crear una remesa por cada corte, todas sobre el mismo archivo.
                        Compará la cantidad de casos con la que informó el cedente antes de seguir, y
                        corregí los números de remesa si hace falta.
                    </Typography>

                    {cortesYaCargados.length > 0 && (
                        <Alert severity="info" sx={{ mb: 2 }}>
                            {cortesYaCargados.length === 1
                                ? "1 corte de este archivo ya está cargado y viene destildado."
                                : `${cortesYaCargados.length} cortes de este archivo ya están cargados y vienen destildados.`}
                        </Alert>
                    )}

                    <TableContainer component={Paper} variant="outlined">
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell padding="checkbox" />
                                    {Object.keys(cortes?.[0]?.valores ?? {}).map((k) => (
                                        <TableCell key={k}>{k}</TableCell>
                                    ))}
                                    <TableCell align="right">Casos</TableCell>
                                    <TableCell>Nº de remesa</TableCell>
                                    {(cortes ?? []).some((c) => c.yaCargado) && <TableCell>Estado</TableCell>}
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {(cortes ?? []).map((c, i) => (
                                    <TableRow key={i} hover>
                                        <TableCell padding="checkbox">
                                            <Checkbox
                                                checked={c.incluir}
                                                onChange={(e) =>
                                                    setCortes((prev) =>
                                                        (prev ?? []).map((x, j) =>
                                                            j === i ? { ...x, incluir: e.target.checked } : x,
                                                        ),
                                                    )
                                                }
                                            />
                                        </TableCell>
                                        {Object.keys(cortes?.[0]?.valores ?? {}).map((k) => (
                                            <TableCell key={k}>{c.valores[k] || "—"}</TableCell>
                                        ))}
                                        <TableCell align="right">
                                            {c.filas.toLocaleString("es-AR")}
                                        </TableCell>
                                        <TableCell>
                                            <TextField
                                                size="small"
                                                value={c.numeroRemesa}
                                                disabled={!c.incluir}
                                                error={c.incluir && !c.numeroRemesa.trim()}
                                                onChange={(e) =>
                                                    setCortes((prev) =>
                                                        (prev ?? []).map((x, j) =>
                                                            j === i ? { ...x, numeroRemesa: e.target.value } : x,
                                                        ),
                                                    )
                                                }
                                                sx={{ width: 140 }}
                                            />
                                        </TableCell>
                                        {(cortes ?? []).some((x) => x.yaCargado) && (
                                            <TableCell sx={{ minWidth: 220 }}>
                                                {c.yaCargado && (
                                                    <>
                                                        <Typography
                                                            variant="body2"
                                                            color={corteBloquea(c.yaCargado) ? "warning.main" : "text.secondary"}
                                                            sx={{ overflowWrap: "anywhere" }}
                                                        >
                                                            {textoEstadoCorte(c.yaCargado, categoria)}.
                                                        </Typography>
                                                        <Typography
                                                            component={RouterLink}
                                                            to={`/historial-importaciones/${c.yaCargado.remesaId}`}
                                                            target="_blank"
                                                            rel="noopener"
                                                            variant="caption"
                                                            color="primary.main"
                                                            sx={{ textDecoration: "none", "&:hover": { textDecoration: "underline" } }}
                                                        >
                                                            Ver la remesa {c.yaCargado.numeroRemesa}
                                                        </Typography>
                                                    </>
                                                )}
                                            </TableCell>
                                        )}
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>

                    {cortesRepetidos.length > 0 && (
                        <Alert severity="warning" sx={{ mt: 2 }}>
                            Si lo cargás de nuevo, sus casos quedan duplicados.
                        </Alert>
                    )}

                    {numerosRepetidos.length > 0 && (
                        <Alert severity="error" sx={{ mt: 2 }}>
                            El número {numerosRepetidos.join(", ")} está repetido. Puede pasar cuando
                            dos gestiones distintas empiezan con el mismo dígito (3G y 3GH): cambiá
                            una a mano.
                        </Alert>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDialogoDivision(false)}>Cancelar</Button>
                    <Button
                        variant="contained"
                        disabled={!divisionValida || loading}
                        onClick={async () => {
                            // Un corte ya cargado que se tildó a mano solo viaja con `repetir: true` si el operador lo confirma.
                            if (cortesRepetidos.length > 0) {
                                const acepta = await confirm({
                                    title: "Cargar de nuevo cortes ya cargados",
                                    description: `Estos cortes ya figuran en otras remesas (cargados, en curso o a medias): ${cortesRepetidos
                                        .map((c) => `${etiquetaCorte(c.valores)} (remesa ${c.yaCargado?.numeroRemesa})`)
                                        .join(", ")}. Si los cargás de nuevo, sus casos quedan duplicados.`,
                                    confirmLabel: "Cargarlos de nuevo",
                                    confirmColor: "error",
                                });
                                if (!acepta) return;
                            }
                            setDialogoDivision(false);
                            void handleCrearYValidar((cortes ?? []).filter((c) => c.incluir));
                        }}
                    >
                        Crear {(cortes ?? []).filter((c) => c.incluir).length} remesa(s)
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Loading inline */}
            {loading && subida && (
                <Box sx={{ mt: 2 }}>
                    <LinearProgress
                        variant={textoSubida(subida).porcentaje === null ? "indeterminate" : "determinate"}
                        value={textoSubida(subida).porcentaje ?? undefined}
                        sx={{ borderRadius: 1 }}
                    />
                    <Typography variant="body2" fontWeight={600} sx={{ mt: 1, overflowWrap: "anywhere" }}>
                        {progresoVista
                            ? `Armando la vista previa: remesa ${progresoVista.actual} de ${progresoVista.total}…`
                            : textoSubida(subida).principal}
                    </Typography>
                    {textoSubida(subida).secundario && (
                        <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                            {textoSubida(subida).secundario}
                        </Typography>
                    )}
                </Box>
            )}
            {loading && !subida && <LinearProgress sx={{ mt: 2, borderRadius: 1 }} />}
        </PageContainer>
    );
}
