import React, { useEffect, useState } from "react";
import {
    Box,
    Button,
    Step,
    StepLabel,
    Stepper,
    Typography,
    MenuItem,
    Select,
    LinearProgress,
    Card,
    CardContent,
} from "@mui/material";
import api from "../api/axios";

const steps = ["Seleccionar Plantilla", "Subir Archivo", "Validar", "Ejecutar", "Finalizado"];

export default function ImportWizard() {
    const empresaId = 1; // luego se reemplaza con auth real

    const [activeStep, setActiveStep] = useState(0);
    const [loading, setLoading] = useState(false);

    // data
    const [plantillas, setPlantillas] = useState<any[]>([]);
    const [categoria, setCategoria] = useState("");
    const [selectedPlantilla, setSelectedPlantilla] = useState<number | null>(null);
    const [csvFile, setCsvFile] = useState<File | null>(null);

    // backend estado
    const [estadoBackend, setEstadoBackend] = useState<{
        estado?: string;
        total?: number;
        ok?: number;
        err?: number;
        preview?: any[];
    }>({});

    // flujo mejorado
    const [remesaId, setRemesaId] = useState<number | null>(null);
    const [validationDone, setValidationDone] = useState(false);

    // cargar plantillas al cambiar categoría
    useEffect(() => {
        if (!categoria) return;
        api.get(`/import/plantillas/${empresaId}/${categoria}`)
            .then(res => setPlantillas(res.data))
            .catch(() => alert("Error obteniendo plantillas"));
    }, [categoria]);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.length) setCsvFile(e.target.files[0]);
    };

    // ------------------------------------------
    // 1) CREAR REMESA (solo crea la remesa)
    // ------------------------------------------
    const handleCrearRemesa = async () => {
        if (!csvFile || !selectedPlantilla || !categoria) {
            alert("Seleccioná categoría, plantilla y archivo.");
            return;
        }

        setLoading(true);

        try {
            const formData = new FormData();
            formData.append("empresaId", String(empresaId));
            formData.append("categoria", categoria);
            formData.append("plantillaId", String(selectedPlantilla));
            formData.append("nombre", `Remesa ${new Date().toLocaleString()}`);
            formData.append("numeroRemesa", String(Date.now()));
            formData.append("file", csvFile);

            const res = await api.post("/import/remesas", formData, {
                headers: { "Content-Type": "multipart/form-data" },
            });

            setRemesaId(res.data.remesaId);
            setActiveStep(2); // paso a VALIDAR
        } catch (err: any) {
            console.error(err);
            alert("Error creando remesa: " + (err.response?.data?.message || err.message));
        }

        setLoading(false);
    };

    // ------------------------------------------
    // 2) VALIDAR (y mostrar preview)
    // ------------------------------------------
    const handleValidar = async () => {
        if (!remesaId) return;

        setLoading(true);

        try {
            const res = await api.post(`/import/validar/${remesaId}`);
            setEstadoBackend({
                estado: "VALIDANDO",
                total: res.data.total,
                ok: res.data.ok,
                err: res.data.err,
                preview: res.data.sample || [],
            });

            setValidationDone(true);
            // NO pasamos al paso 3 hasta que el usuario confirme
        } catch (err: any) {
            console.error(err);
            alert("Error validando: " + (err.response?.data?.message || err.message));
        }

        setLoading(false);
    };

    // ------------------------------------------
    // 3) EJECUTAR (solo si usuario confirma)
    // ------------------------------------------
    const handleEjecutar = async () => {
        if (!remesaId) return;

        setActiveStep(3); // muestro pantalla “Ejecutando”
        setLoading(true);

        try {
            const res = await api.post(`/import/ejecutar/${remesaId}`);

            setEstadoBackend({
                estado: "FINALIZADA",
                total: res.data.total,
                ok: res.data.ok,
                err: res.data.err,
            });

            setActiveStep(4);
        } catch (err: any) {
            console.error(err);
            alert("Error ejecutando: " + (err.response?.data?.message || err.message));
        }

        setLoading(false);
    };

    const getProgress = () => {
        if (!estadoBackend.total) return 0;
        const procesadas = (estadoBackend.ok ?? 0) + (estadoBackend.err ?? 0);
        return Math.round((procesadas / estadoBackend.total) * 100);
    };

    // ------------------------------------------
    // UI
    // ------------------------------------------
    return (
        <Box sx={{ maxWidth: 800, mx: "auto", mt: 4 }}>
            <Typography variant="h5" sx={{ mb: 3 }}>
                Importación de Remesas
            </Typography>

            <Stepper activeStep={activeStep} alternativeLabel>
                {steps.map(label => (
                    <Step key={label}>
                        <StepLabel>{label}</StepLabel>
                    </Step>
                ))}
            </Stepper>

            <Box sx={{ mt: 4 }}>

                {/* PASO 0 - categoría + plantilla */}
                {activeStep === 0 && (
                    <Box>
                        <Typography sx={{ mb: 2 }}>Seleccioná categoría:</Typography>
                        <Select
                            fullWidth
                            value={categoria}
                            onChange={(e) => setCategoria(e.target.value)}
                        >
                            <MenuItem value="DEUDORES">Deudores</MenuItem>
                            <MenuItem value="FACTURAS">Facturas</MenuItem>
                        </Select>

                        {categoria && (
                            <>
                                <Typography sx={{ mt: 3 }}>Seleccioná plantilla:</Typography>
                                <Select
                                    fullWidth
                                    value={selectedPlantilla ?? ""}
                                    onChange={(e) => setSelectedPlantilla(Number(e.target.value))}
                                >
                                    {plantillas.map((p) => (
                                        <MenuItem key={p.id} value={p.id}>
                                            {p.nombre} (v{p.version})
                                        </MenuItem>
                                    ))}
                                </Select>
                            </>
                        )}

                        <Button
                            variant="contained"
                            sx={{ mt: 3 }}
                            disabled={!categoria || !selectedPlantilla}
                            onClick={() => setActiveStep(1)}
                        >
                            Siguiente
                        </Button>
                    </Box>
                )}

                {/* PASO 1 - archivo */}
                {activeStep === 1 && (
                    <Box>
                        <Typography>Seleccioná archivo:</Typography>
                        <input type="file" onChange={handleFileSelect} />

                        <Button
                            variant="contained"
                            sx={{ mt: 3 }}
                            disabled={!csvFile}
                            onClick={handleCrearRemesa}
                        >
                            Crear Remesa
                        </Button>
                    </Box>
                )}

                {/* PASO 2 - validar */}
                {activeStep === 2 && (
                    <Box>
                        <Typography variant="h6" sx={{ mb: 2 }}>Validar Remesa</Typography>

                        {!validationDone && (
                            <>
                                <Button
                                    variant="contained"
                                    onClick={handleValidar}
                                    disabled={loading}
                                >
                                    {loading ? "Validando..." : "Validar"}
                                </Button>

                                {loading && <LinearProgress sx={{ mt: 2 }} />}
                            </>
                        )}

                        {validationDone && (
                            <Box sx={{ mt: 3 }}>
                                <Typography>Resultado de la validación:</Typography>

                                <Typography sx={{ mt: 2 }}>
                                    Total filas: {estadoBackend.total} <br />
                                    OK: {estadoBackend.ok} <br />
                                    Errores: {estadoBackend.err}
                                </Typography>

                                <Card sx={{ mt: 3 }}>
                                    <CardContent>
                                        <Typography variant="h6">Preview (50 filas)</Typography>
                                        <pre style={{ fontSize: 12, maxHeight: 300, overflowY: "auto" }}>
                                            {JSON.stringify(estadoBackend.preview, null, 2)}
                                        </pre>
                                    </CardContent>
                                </Card>

                                <Button
                                    variant="contained"
                                    color="primary"
                                    sx={{ mt: 3 }}
                                    onClick={handleEjecutar}
                                >
                                    Confirmar e Importar
                                </Button>
                            </Box>
                        )}
                    </Box>
                )}

                {/* PASO 3 - ejecutando */}
                {activeStep === 3 && (
                    <Box>
                        <Typography variant="h6">Ejecutando importación...</Typography>
                        <Typography sx={{ mt: 1 }}>Progreso: {getProgress()}%</Typography>
                        <LinearProgress variant="determinate" value={getProgress()} sx={{ mt: 1 }} />
                    </Box>
                )}

                {/* PASO 4 - finalizado */}
                {activeStep === 4 && (
                    <Box>
                        <Typography variant="h6">¡Importación finalizada!</Typography>

                        <Typography sx={{ mt: 2 }}>
                            Total: {estadoBackend.total} <br />
                            OK: {estadoBackend.ok} <br />
                            Errores: {estadoBackend.err}
                        </Typography>

                        <Button
                            variant="contained"
                            sx={{ mt: 3 }}
                            onClick={() => window.location.href = "/remesas"}
                        >
                            Ver Remesas
                        </Button>
                    </Box>
                )}
            </Box>

            {loading && activeStep < 2 && <LinearProgress sx={{ mt: 3 }} />}
        </Box>
    );
}