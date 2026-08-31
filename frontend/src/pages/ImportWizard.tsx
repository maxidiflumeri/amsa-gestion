import React, { useCallback, useEffect, useState } from "react";
import {
    Alert,
    AlertTitle,
    Box,
    Button,
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
import { PageContainer, PageHeader, SectionCard } from "../components/ui";
import { etiquetaRemesa } from "../utils/remesa";

import CategorySelector from "../components/import/CategorySelector";
import FileDropZone from "../components/import/FileDropZone";
import MultiarchivoDropZone, { paqueteCompleto } from "../components/import/MultiarchivoDropZone";
import PreviewTable from "../components/import/PreviewTable";
import ImportProgress from "../components/import/ImportProgress";
import ImportSummary from "../components/import/ImportSummary";

const steps = [
    "Categoría",
    "Plantilla y archivo",
    "Vista previa",
    "Importando",
    "Resultado",
];

/** Un corte del archivo con el número de remesa que le va a tocar (editable por el operador). */
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
}

export default function ImportWizard() {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down("md"));
    const notify = useNotify();

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
    // Qué archivos entraron en la remesa y cuántas filas descartó el filtro de la plantilla. Es lo
    // que el operador confirma antes de ejecutar cuando sube una tanda de archivos.
    const [resumenArchivos, setResumenArchivos] = useState<
        { archivos?: string[]; descartadas?: number; filtro?: string } | null
    >(null);
    const [remesasDeudores, setRemesasDeudores] = useState<any[]>([]);
    // El combo mostraba TODAS las remesas de la empresa —las de facturas, las de pagos, las de
    // acciones— y con 100 remesas encima elegir era imposible. Ahora se piden solo las que
    // cargaron casos y, por defecto, solo las que todavía tienen alguno vivo: son las que se
    // gestionan hoy, que es a las que se les aplica un archivo de cobros.
    const [soloEnGestion, setSoloEnGestion] = useState(true);
    const [remesaOrigenId, setRemesaOrigenId] = useState<number | null>(null);
    // PAGOS: se pueden elegir VARIAS remesas origen (archivo de pagos para toda la empresa),
    // así una sola corrida cubre las N remesas en vez de correr el archivo una vez por cada una.
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
    // Patrones de nombre de archivo de la plantilla elegida, para reconocer qué archivo es cuál.
    const patronesArchivos = plantillas.find((p) => p.id === selectedPlantilla)
        ?.mappingJson?.multiarchivo?.archivos as Record<string, string> | undefined;
    const multiOrigen = categoria === "PAGOS";
    const needsOrigen =
        categoria !== "" &&
        categoria !== "DEUDORES" &&
        categoria !== "DEUDORES_Y_FACTURAS" &&
        !esAcciones &&
        !esMultirregistro &&
        !esMultiarchivo;

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
    // Remesas creadas por la división, que se validan y ejecutan una atrás de la otra.
    const [colaRemesas, setColaRemesas] = useState<number[]>([]);
    const [indiceCola, setIndiceCola] = useState(0);

    // Paso 4 – resultado final
    const [finalResult, setFinalResult] = useState({ total: 0, ok: 0, err: 0 });

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
    const handlePrevisualizarDivision = async () => {
        setLoading(true);
        try {
            const formData = new FormData();
            formData.append("plantillaId", String(selectedPlantilla));
            formData.append("empresaId", String(empresaId));
            formData.append("numeroRemesa", numeroRemesa.trim());
            if (isExcelFile && hojaExcel.trim() !== "") formData.append("hoja", hojaExcel.trim());
            adjuntarArchivos(formData);

            const res = await api.post("/import/remesas/division-preview", formData, {
                headers: { "Content-Type": "multipart/form-data" },
            });

            setCortes(
                (res.data.cortes ?? []).map((c: any) => ({
                    valores: c.valores,
                    filas: c.filas,
                    numeroRemesa: c.numeroSugerido ?? "",
                    incluir: true,
                    filtros: c.filtros,
                })),
            );
            setDialogoDivision(true);
        } catch (err: any) {
            notify.error(err);
        } finally {
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
                        })),
                    ),
                );
            }

            if (isExcelFile && hojaExcel.trim() !== "") {
                formData.append("hoja", hojaExcel.trim());
            }

            formData.append("validarDomicilios", String(validarDomicilios));

            const resRemesa = await api.post("/import/remesas", formData, {
                headers: { "Content-Type": "multipart/form-data" },
            });

            const creadas: number[] = resRemesa.data.remesaIds ?? [resRemesa.data.remesaId];
            const newRemesaId = creadas[0];
            setRemesaId(newRemesaId);
            setColaRemesas(creadas);
            setIndiceCola(0);

            // Con la carga dividida se valida la primera para mostrar el preview del mapeo; las
            // demás se validan justo antes de ejecutarse, para que cada una tenga su total y la
            // barra de progreso no arranque clavada en 0.
            const resValidar = await api.post(`/import/validar/${newRemesaId}`);

            setPreview(resValidar.data.sample ?? []);
            setPreviewStats({
                total: resValidar.data.total ?? 0,
                ok: resValidar.data.ok ?? 0,
                err: resValidar.data.err ?? 0,
            });

            setAdvertencias(resValidar.data.advertencias ?? []);
            setMultiResumen(resValidar.data.multirregistro ?? null);
            setPaqueteResumen(resValidar.data.multiarchivo ?? null);
            setResumenArchivos(
                resValidar.data.archivos || resValidar.data.descartadas
                    ? {
                          archivos: resValidar.data.archivos,
                          descartadas: resValidar.data.descartadas,
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
        } finally {
            setLoading(false);
        }
    };

    /** Dispara una remesa de la cola. La primera ya viene validada del paso 2. */
    const ejecutarRemesa = async (id: number, yaValidada: boolean) => {
        if (!yaValidada) await api.post(`/import/validar/${id}`);
        await api.post(`/import/ejecutar/${id}`, {
            remesaOrigenId: multiOrigen ? undefined : (remesaOrigenId ?? undefined),
            remesaOrigenIds: multiOrigen && remesaOrigenIds.length ? remesaOrigenIds : undefined,
        });
    };

    // Paso 2 → 3: Confirmar y ejecutar
    const handleEjecutar = async () => {
        if (!remesaId) return;

        setActiveStep(3);

        try {
            await ejecutarRemesa(remesaId, true);
        } catch (err: any) {
            notify.error(err);
            setActiveStep(2);
        }
    };

    const handleImportComplete = useCallback(
        (result: { total: number; ok: number; err: number }) => {
            // Carga dividida: los totales se van sumando y se arranca la remesa siguiente. Van una
            // atrás de la otra y no en paralelo a propósito: comparten el archivo y el worker, y
            // lanzarlas juntas solo haría que se peleen por la base sin terminar antes.
            const siguiente = indiceCola + 1;
            const quedan = siguiente < colaRemesas.length;

            setFinalResult((prev) =>
                colaRemesas.length > 1
                    ? {
                          total: prev.total + result.total,
                          ok: prev.ok + result.ok,
                          err: prev.err + result.err,
                      }
                    : result,
            );

            if (!quedan) {
                setActiveStep(4);
                return;
            }

            const id = colaRemesas[siguiente];
            setIndiceCola(siguiente);
            ejecutarRemesa(id, false).catch((err) => {
                notify.error(err);
                setActiveStep(4);
            });
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [indiceCola, colaRemesas, multiOrigen, remesaOrigenId, remesaOrigenIds]
    );

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
        setIndiceCola(0);
        setFinalResult({ total: 0, ok: 0, err: 0 });
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
    const divisionValida =
        (cortes ?? []).some((c) => c.incluir) &&
        (cortes ?? []).every((c) => !c.incluir || c.numeroRemesa.trim()) &&
        numerosRepetidos.length === 0;

    // ─── Render ──────────────────────────────────────────────

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
                                        placeholder="Ej: 00007"
                                        value={numeroRemesa}
                                        onChange={(e) => setNumeroRemesa(e.target.value)}
                                        helperText="Opcional: si se deja vacío sigue el correlativo de la empresa (00001, 00002, …)"
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

                        {/* Validación de domicilios contra Georef (no aplica a Acciones masivas) */}
                        {!esAcciones && (
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

                        {/* PAGOS: selector MÚLTIPLE de remesas origen (archivo para toda la empresa) */}
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
                                        ? "Se listan las remesas que todavía tienen casos activos (sin cancelar ni desasignar). \"Seleccionar todas\" alcanza para el archivo de cobros del mes."
                                        : "Se listan todas las remesas que cargaron casos, incluidas las ya cerradas."}
                                    {" "}El archivo de pagos se aplica a todas las elegidas en una sola corrida.
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
                        {colaRemesas.length > 1 && (
                            <Alert severity="info" sx={{ mb: 2 }}>
                                <AlertTitle>
                                    Se crearon {colaRemesas.length} remesas a partir de este archivo
                                </AlertTitle>
                                Abajo se ve el preview de la primera. Al confirmar se importan todas,
                                una después de la otra.
                            </Alert>
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
                        {resumenArchivos && (
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
                                {!!resumenArchivos.descartadas && (
                                    <Typography variant="body2" sx={{ mt: resumenArchivos.archivos ? 1 : 0 }}>
                                        Se descartaron <strong>{resumenArchivos.descartadas} filas</strong> que no
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
                        <PreviewTable
                            preview={preview}
                            total={previewStats.total}
                            ok={previewStats.ok}
                            err={previewStats.err}
                        />
                    </>
                )}

                {/* PASO 3 — Progreso */}
                {activeStep === 3 && remesaId && (
                    <>
                        {colaRemesas.length > 1 && (
                            <Alert severity="info" sx={{ mb: 2 }}>
                                Procesando la remesa {indiceCola + 1} de {colaRemesas.length}. Las
                                remesas de la división se cargan una después de la otra; no cierres
                                la pantalla.
                            </Alert>
                        )}
                        <ImportProgress
                            key={colaRemesas[indiceCola] ?? remesaId}
                            remesaId={colaRemesas[indiceCola] ?? remesaId}
                            onComplete={handleImportComplete}
                        />
                    </>
                )}

                {/* PASO 4 — Resumen */}
                {activeStep === 4 && remesaId && (
                    <ImportSummary
                        total={finalResult.total}
                        ok={finalResult.ok}
                        err={finalResult.err}
                        remesaId={remesaId}
                        onNewImport={handleNewImport}
                        onViewRemesas={() =>
                            (window.location.href = "/remesas")
                        }
                    />
                )}
            </SectionCard>

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
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>

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
                        onClick={() => {
                            setDialogoDivision(false);
                            handleCrearYValidar((cortes ?? []).filter((c) => c.incluir));
                        }}
                    >
                        Crear {(cortes ?? []).filter((c) => c.incluir).length} remesa(s)
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Loading inline */}
            {loading && <LinearProgress sx={{ mt: 2, borderRadius: 1 }} />}
        </PageContainer>
    );
}
