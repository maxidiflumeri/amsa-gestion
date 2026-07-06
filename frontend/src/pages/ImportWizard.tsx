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
    FormControl,
    FormControlLabel,
    InputLabel,
    LinearProgress,
    Stack,
    Switch,
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

import CategorySelector from "../components/import/CategorySelector";
import FileDropZone from "../components/import/FileDropZone";
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
    const [file, setFile] = useState<File | null>(null);
    const [nombreRemesa, setNombreRemesa] = useState("");
    const [numeroRemesa, setNumeroRemesa] = useState("");
    const [fechaVencimiento, setFechaVencimiento] = useState("");
    const [hojaExcel, setHojaExcel] = useState<string>("");
    const [validarDomicilios, setValidarDomicilios] = useState(false);

    const isExcelFile = file?.name?.match(/\.(xls|xlsx)$/i);

    // Remesa de deudores origen
    const [remesasDeudores, setRemesasDeudores] = useState<any[]>([]);
    const [remesaOrigenId, setRemesaOrigenId] = useState<number | null>(null);
    // ACCIONES: la remesa origen es OPCIONAL (sin elegir = toda la base de la empresa).
    const esAcciones = categoria === "ACCIONES";
    const needsOrigen = categoria !== "" && categoria !== "DEUDORES" && categoria !== "DEUDORES_Y_FACTURAS" && !esAcciones;

    // Paso 2 – preview
    const [remesaId, setRemesaId] = useState<number | null>(null);
    const [preview, setPreview] = useState<any[]>([]);
    const [previewStats, setPreviewStats] = useState({ total: 0, ok: 0, err: 0 });
    const [accionesImpacto, setAccionesImpacto] = useState<{ deudoresAfectados: number; valoresDistintos: number; operaciones: string[] } | null>(null);

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
        api.get(`/import/remesas/empresa/${empresaId}`)
            .then((res) => setRemesasDeudores(
                res.data.filter((r: any) => r.estadoProceso === "FINALIZADA")
            ))
            .catch((err) => notify.error(err));
    }, [needsOrigen, esAcciones, empresaId]);

    // ─── Handlers ────────────────────────────────────────────

    const handleCategorySelect = (cat: string) => {
        setCategoria(cat);
    };

    const handleFileSelect = (f: File) => {
        setFile(f);
        setHojaExcel("");
    };

    const handleNext = () => {
        setActiveStep((prev) => prev + 1);
    };

    const handleBack = () => {
        setActiveStep((prev) => prev - 1);
    };

    // Paso 1 → 2: Crear remesa + validar
    const handleCrearYValidar = async () => {
        if (!file || !selectedPlantilla || !categoria) {
            notify.warning("Seleccioná categoría, plantilla y archivo.");
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
            formData.append("numeroRemesa", numeroRemesa || String(Date.now()));
            if (fechaVencimiento) {
                formData.append("fechaVencimiento", fechaVencimiento);
            }
            formData.append("file", file);

            if (isExcelFile && hojaExcel.trim() !== "") {
                formData.append("hoja", hojaExcel.trim());
            }

            formData.append("validarDomicilios", String(validarDomicilios));

            const resRemesa = await api.post("/import/remesas", formData, {
                headers: { "Content-Type": "multipart/form-data" },
            });

            const newRemesaId = resRemesa.data.remesaId;
            setRemesaId(newRemesaId);

            const resValidar = await api.post(`/import/validar/${newRemesaId}`);

            setPreview(resValidar.data.sample ?? []);
            setPreviewStats({
                total: resValidar.data.total ?? 0,
                ok: resValidar.data.ok ?? 0,
                err: resValidar.data.err ?? 0,
            });

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

    // Paso 2 → 3: Confirmar y ejecutar
    const handleEjecutar = async () => {
        if (!remesaId) return;

        setActiveStep(3);

        try {
            await api.post(`/import/ejecutar/${remesaId}`, {
                remesaOrigenId: remesaOrigenId ?? undefined,
            });
        } catch (err: any) {
            notify.error(err);
            setActiveStep(2);
        }
    };

    const handleImportComplete = useCallback(
        (result: { total: number; ok: number; err: number }) => {
            setFinalResult(result);
            setActiveStep(4);
        },
        []
    );

    const handleNewImport = () => {
        setActiveStep(0);
        setCategoria("");
        setPlantillas([]);
        setSelectedPlantilla(null);
        setFile(null);
        setRemesaId(null);
        setRemesaOrigenId(null);
        setRemesasDeudores([]);
        setPreview([]);
        setPreviewStats({ total: 0, ok: 0, err: 0 });
        setAccionesImpacto(null);
        setFinalResult({ total: 0, ok: 0, err: 0 });
    };

    // ─── Render ──────────────────────────────────────────────

    const canGoNext = () => {
        switch (activeStep) {
            case 0:
                return !!categoria;
            case 1:
                return !!file && !!selectedPlantilla && (!needsOrigen || !!remesaOrigenId);
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
                                        placeholder="Ej: REM-123"
                                        value={numeroRemesa}
                                        onChange={(e) => setNumeroRemesa(e.target.value)}
                                        helperText="Opcional: se generará uno automático si se deja vacío"
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

                        {/* Selector de remesa de deudores origen */}
                        {(needsOrigen || esAcciones) && (
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
                                            No hay remesas de deudores finalizadas
                                        </MenuItem>
                                    )}
                                    {remesasDeudores.map((r: any) => (
                                        <MenuItem key={r.id} value={r.id}>
                                            [{r.categoria}] {r.nombre} — {r.totalFilas ?? 0} deudores —{" "}
                                            {new Date(r.createdAt).toLocaleDateString()}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        )}

                        {/* Drop zone */}
                        <FileDropZone
                            file={file}
                            onFileSelect={handleFileSelect}
                        />

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
                        {categoria === "ACCIONES" && accionesImpacto && (
                            <Alert severity="warning" sx={{ mb: 2 }}>
                                <AlertTitle>Vas a modificar {accionesImpacto.deudoresAfectados} deudores</AlertTitle>
                                {accionesImpacto.valoresDistintos} valores de match en el archivo ·
                                operaciones: {accionesImpacto.operaciones.join(", ")}. Revisá antes de confirmar —
                                el cambio se aplica sobre toda la base de la empresa.
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
                    <ImportProgress
                        remesaId={remesaId}
                        onComplete={handleImportComplete}
                    />
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
                            onClick={handleCrearYValidar}
                        >
                            {loading ? "Procesando..." : "Crear remesa y validar"}
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

            {/* Loading inline */}
            {loading && <LinearProgress sx={{ mt: 2, borderRadius: 1 }} />}
        </PageContainer>
    );
}
