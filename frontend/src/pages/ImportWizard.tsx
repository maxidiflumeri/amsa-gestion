import React, { useCallback, useEffect, useState } from "react";
import {
    Box,
    Button,
    Step,
    StepLabel,
    Stepper,
    Typography,
    MenuItem,
    Select,
    FormControl,
    InputLabel,
    LinearProgress,
    Alert,
    Paper,
    IconButton,
    Tooltip,
    TextField,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import api from "../api/axios";
import { useEmpresas } from "../hooks/useEmpresas";

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
    const { empresas, loading: loadingEmpresas } = useEmpresas();
    const [empresaId, setEmpresaId] = useState<number | "">(1); // default 1

    const [activeStep, setActiveStep] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Paso 0 – categoría
    const [categoria, setCategoria] = useState("");

    // Paso 1 – plantilla + archivo
    const [plantillas, setPlantillas] = useState<any[]>([]);
    const [selectedPlantilla, setSelectedPlantilla] = useState<number | null>(null);
    const [file, setFile] = useState<File | null>(null);
    const [hojaExcel, setHojaExcel] = useState<string>("");

    const isExcelFile = file?.name?.match(/\.(xls|xlsx)$/i);

    // Remesa de deudores origen (para FACTURAS, CONTACTOS, PAGOS)
    const [remesasDeudores, setRemesasDeudores] = useState<any[]>([]);
    const [remesaOrigenId, setRemesaOrigenId] = useState<number | null>(null);
    const needsOrigen = categoria !== "" && categoria !== "DEUDORES" && categoria !== "DEUDORES_Y_FACTURAS";

    // Paso 2 – preview
    const [remesaId, setRemesaId] = useState<number | null>(null);
    const [preview, setPreview] = useState<any[]>([]);
    const [previewStats, setPreviewStats] = useState({
        total: 0,
        ok: 0,
        err: 0,
    });

    // Paso 4 – resultado final
    const [finalResult, setFinalResult] = useState({
        total: 0,
        ok: 0,
        err: 0,
    });

    // ─── Carga de plantillas ─────────────────────────────────
    useEffect(() => {
        if (!categoria || !empresaId) return;
        setPlantillas([]);
        setSelectedPlantilla(null);
        setRemesaOrigenId(null);
        api.get(`/import/plantillas/${empresaId}/${categoria}`)
            .then((res) => setPlantillas(res.data))
            .catch(() => setError("Error obteniendo plantillas"));
    }, [categoria, empresaId]);

    // ─── Carga de remesas de deudores (para vincular) ────────
    useEffect(() => {
        if (!needsOrigen || !empresaId) {
            setRemesasDeudores([]);
            return;
        }
        api.get(`/import/remesas/empresa/${empresaId}?categoria=DEUDORES`)
            .then((res) => setRemesasDeudores(
                res.data.filter((r: any) => r.estadoProceso === 'FINALIZADA')
            ))
            .catch(() => setError("Error obteniendo remesas de deudores"));
    }, [needsOrigen, empresaId]);

    // ─── Handlers ────────────────────────────────────────────

    const handleCategorySelect = (cat: string) => {
        setCategoria(cat);
        setError(null);
    };

    const handleFileSelect = (f: File) => {
        setFile(f);
        setHojaExcel(""); // Resetear la hoja on new file
        setError(null);
    };

    const handleNext = () => {
        setError(null);
        setActiveStep((prev) => prev + 1);
    };

    const handleBack = () => {
        setError(null);
        setActiveStep((prev) => prev - 1);
    };

    // Paso 1 → 2: Crear remesa + validar
    const handleCrearYValidar = async () => {
        if (!file || !selectedPlantilla || !categoria) {
            setError("Seleccioná categoría, plantilla y archivo.");
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const formData = new FormData();
            formData.append("empresaId", String(empresaId));
            formData.append("categoria", categoria);
            formData.append("plantillaId", String(selectedPlantilla));
            formData.append(
                "nombre",
                `Remesa ${new Date().toLocaleString()}`
            );
            formData.append("numeroRemesa", String(Date.now()));
            formData.append("file", file);

            if (isExcelFile && hojaExcel.trim() !== '') {
                formData.append("hoja", hojaExcel.trim());
            }

            // 1) Crear remesa
            const resRemesa = await api.post("/import/remesas", formData, {
                headers: { "Content-Type": "multipart/form-data" },
            });

            const newRemesaId = resRemesa.data.remesaId;
            setRemesaId(newRemesaId);

            // 2) Validar
            const resValidar = await api.post(
                `/import/validar/${newRemesaId}`
            );

            setPreview(resValidar.data.sample ?? []);
            setPreviewStats({
                total: resValidar.data.total ?? 0,
                ok: resValidar.data.ok ?? 0,
                err: resValidar.data.err ?? 0,
            });

            setActiveStep(2); // ir a preview
        } catch (err: any) {
            console.error(err);
            setError(
                err.response?.data?.message ||
                    err.message ||
                    "Error creando remesa"
            );
        }

        setLoading(false);
    };

    // Paso 2 → 3: Confirmar y ejecutar
    const handleEjecutar = async () => {
        if (!remesaId) return;

        setActiveStep(3); // ir al paso de progreso
        setError(null);

        try {
            await api.post(`/import/ejecutar/${remesaId}`, {
                remesaOrigenId: remesaOrigenId ?? undefined,
            });
            // El componente ImportProgress se encarga del poleo
        } catch (err: any) {
            console.error(err);
            setError(
                err.response?.data?.message ||
                    err.message ||
                    "Error ejecutando importación"
            );
            setActiveStep(2); // volver al preview
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
        setFinalResult({ total: 0, ok: 0, err: 0 });
        setError(null);
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
        <Box sx={{ maxWidth: 900, mx: "auto", mt: 4, px: 2, pb: 6 }}>
            {/* Header */}
            <Box sx={{ mb: 4 }}>
                <Typography variant="h4" sx={{ mb: 1, fontWeight: 700 }}>
                    Importación de datos
                </Typography>
                <Typography
                    variant="body1"
                    color="text.secondary"
                >
                    Subí tus archivos para cargar deudores, facturas o contactos.
                </Typography>
            </Box>

            {/* Stepper */}
            <Stepper
                activeStep={activeStep}
                alternativeLabel
                sx={{ mb: 4 }}
            >
                {steps.map((label) => (
                    <Step key={label}>
                        <StepLabel>{label}</StepLabel>
                    </Step>
                ))}
            </Stepper>

            {/* Error global */}
            {error && (
                <Alert
                    severity="error"
                    onClose={() => setError(null)}
                    sx={{ mb: 3 }}
                >
                    {error}
                </Alert>
            )}

            {/* Contenido por paso */}
            <Paper
                variant="outlined"
                sx={{ p: { xs: 2, sm: 4 }, borderRadius: 2, minHeight: 300 }}
            >
                {/* PASO 0 — Categoría */}
                {activeStep === 0 && (
                    <CategorySelector
                        selected={categoria}
                        onSelect={handleCategorySelect}
                    />
                )}

                {/* PASO 1 — Plantilla + Archivo */}
                {activeStep === 1 && (
                    <Box
                        sx={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 3,
                        }}
                    >
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
                                    setSelectedPlantilla(
                                        Number(e.target.value)
                                    )
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

                        {/* Selector de remesa de deudores origen */}
                        {needsOrigen && (
                            <FormControl fullWidth>
                                <InputLabel id="remesa-origen-label">
                                    Vincular a remesa de deudores
                                </InputLabel>
                                <Select
                                    labelId="remesa-origen-label"
                                    label="Vincular a remesa de deudores"
                                    value={remesaOrigenId ?? ""}
                                    onChange={(e) =>
                                        setRemesaOrigenId(
                                            Number(e.target.value)
                                        )
                                    }
                                >
                                    {remesasDeudores.length === 0 && (
                                        <MenuItem disabled value="">
                                            No hay remesas de deudores finalizadas
                                        </MenuItem>
                                    )}
                                    {remesasDeudores.map((r: any) => (
                                        <MenuItem key={r.id} value={r.id}>
                                            {r.nombre} — {r.totalFilas ?? 0} deudores —{" "}
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
                    </Box>
                )}

                {/* PASO 2 — Preview */}
                {activeStep === 2 && (
                    <PreviewTable
                        preview={preview}
                        total={previewStats.total}
                        ok={previewStats.ok}
                        err={previewStats.err}
                    />
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
            </Paper>

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
                            {loading
                                ? "Procesando..."
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

            {/* Loading inferior */}
            {loading && <LinearProgress sx={{ mt: 2, borderRadius: 1 }} />}
        </Box>
    );
}