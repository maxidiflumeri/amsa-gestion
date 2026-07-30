import React, { useCallback, useMemo, useState } from "react";
import { Alert, Box, Chip, IconButton, Paper, Stack, Tooltip, Typography } from "@mui/material";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";

/**
 * Zona de subida del paquete de archivos de una categoría MULTIARCHIVO.
 *
 * A diferencia del drop zone de siempre, acá se suben **varios archivos juntos** y el orden en que
 * el operador los elige no importa: el rol de cada uno sale de su nombre.
 *
 * La detección de roles se hace también acá, del lado del cliente, **solo para dar feedback**: decirle
 * "te falta DetalleDeuda" antes de subir es mucho mejor que un error después de esperar la carga. La
 * validación que vale es la del backend (`utils/roles-multiarchivo.ts`), que vuelve a resolver los
 * roles y rechaza el alta si algo no cierra.
 */

/** Rol de cada archivo del paquete, con su etiqueta y si es obligatorio. */
const ROLES: Array<{ key: string; label: string; requerido: boolean }> = [
    { key: "deudores", label: "Deudores", requerido: true },
    { key: "detalle", label: "Detalle de deuda", requerido: true },
    { key: "bajas", label: "Bajas", requerido: false },
    { key: "codeudores", label: "Codeudores", requerido: false },
];

export interface ArchivoConRol {
    file: File;
    /** Rol detectado, o null si el nombre no matchea ningún patrón. */
    rol: string | null;
    /** Roles que matchearon, cuando fue más de uno (patrones mal escritos en la plantilla). */
    ambiguo?: string[];
}

interface Props {
    archivos: File[];
    onChange: (archivos: File[]) => void;
    /** Patrones de nombre por rol, de `mappingJson.multiarchivo.archivos` de la plantilla. */
    patrones?: Record<string, string>;
    accept?: string;
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const etiqueta = (rol: string) => ROLES.find((r) => r.key === rol)?.label ?? rol;

/** Clasifica cada archivo según los patrones de la plantilla. Espejo de `resolverRolesArchivos`. */
export function detectarRoles(archivos: File[], patrones?: Record<string, string>): ArchivoConRol[] {
    const compilados = Object.entries(patrones ?? {})
        .filter(([, p]) => !!p)
        .map(([rol, p]) => {
            try {
                return { rol, regex: new RegExp(p, "i") };
            } catch {
                return null; // patrón inválido: lo reporta el backend con un mensaje mejor
            }
        })
        .filter(Boolean) as Array<{ rol: string; regex: RegExp }>;

    return archivos.map((file) => {
        const nombre = file.name.split(/[\\/]/).pop() ?? file.name;
        const matchean = compilados.filter((c) => c.regex.test(nombre)).map((c) => c.rol);
        if (matchean.length === 1) return { file, rol: matchean[0] };
        if (matchean.length > 1) return { file, rol: null, ambiguo: matchean };
        return { file, rol: null };
    });
}

export default function MultiarchivoDropZone({
    archivos,
    onChange,
    patrones,
    accept = ".csv,.txt",
}: Props) {
    const [isDragOver, setIsDragOver] = useState(false);

    const conRol = useMemo(() => detectarRoles(archivos, patrones), [archivos, patrones]);

    const { faltantes, duplicados, sinReconocer, ambiguos } = useMemo(() => {
        const porRol = new Map<string, number>();
        for (const a of conRol) if (a.rol) porRol.set(a.rol, (porRol.get(a.rol) ?? 0) + 1);
        return {
            faltantes: ROLES.filter((r) => r.requerido && !porRol.has(r.key)).map((r) => r.label),
            duplicados: [...porRol].filter(([, n]) => n > 1).map(([rol]) => etiqueta(rol)),
            sinReconocer: conRol.filter((a) => !a.rol && !a.ambiguo).map((a) => a.file.name),
            ambiguos: conRol.filter((a) => a.ambiguo).map((a) => a.file.name),
        };
    }, [conRol]);

    // Se agregan a los ya elegidos en vez de reemplazarlos: el operador puede arrastrarlos de a uno
    // o desde carpetas distintas. Se descartan los repetidos por nombre.
    const agregar = useCallback(
        (nuevos: FileList | null) => {
            if (!nuevos?.length) return;
            const yaEstan = new Set(archivos.map((f) => f.name));
            const suma = Array.from(nuevos).filter((f) => !yaEstan.has(f.name));
            if (suma.length > 0) onChange([...archivos, ...suma]);
        },
        [archivos, onChange],
    );

    const quitar = (nombre: string) => onChange(archivos.filter((f) => f.name !== nombre));

    const completo = archivos.length > 0 && faltantes.length === 0 && sinReconocer.length === 0
        && duplicados.length === 0 && ambiguos.length === 0;

    return (
        <Box>
            <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
                Subir el paquete de archivos
            </Typography>

            <Paper
                variant="outlined"
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); }}
                onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); }}
                onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDragOver(false);
                    agregar(e.dataTransfer.files);
                }}
                onClick={() => document.getElementById("import-files-input")?.click()}
                sx={{
                    p: 3,
                    textAlign: "center",
                    cursor: "pointer",
                    borderStyle: "dashed",
                    borderWidth: 2,
                    borderColor: isDragOver ? "primary.main" : completo ? "success.main" : "divider",
                    bgcolor: isDragOver ? "action.hover" : "background.default",
                    transition: "all 0.2s ease",
                    "&:hover": { borderColor: "primary.main", bgcolor: "action.hover" },
                }}
            >
                <input
                    id="import-files-input"
                    type="file"
                    multiple
                    accept={accept}
                    onChange={(e) => { agregar(e.target.files); e.target.value = ""; }}
                    style={{ display: "none" }}
                />
                <Stack alignItems="center" gap={1}>
                    {completo ? (
                        <CheckCircleIcon sx={{ fontSize: 44, color: "success.main" }} />
                    ) : (
                        <CloudUploadIcon
                            sx={{ fontSize: 44, color: isDragOver ? "primary.main" : "text.secondary" }}
                        />
                    )}
                    <Typography variant="subtitle1" color="text.secondary">
                        Arrastrá los archivos acá o hacé clic para seleccionarlos
                    </Typography>
                    <Typography variant="caption" color="text.disabled">
                        Podés elegirlos todos juntos; el orden no importa
                    </Typography>
                </Stack>
            </Paper>

            {/* Qué se reconoció de lo que ya se subió */}
            {archivos.length > 0 && (
                <Stack spacing={1} sx={{ mt: 2 }}>
                    {conRol.map(({ file, rol, ambiguo }) => (
                        <Paper
                            key={file.name}
                            variant="outlined"
                            sx={{
                                px: 1.5, py: 1, display: "flex", alignItems: "center", gap: 1.5,
                                borderColor: rol ? "divider" : "warning.main",
                            }}
                        >
                            <InsertDriveFileIcon color={rol ? "action" : "warning"} fontSize="small" />
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography variant="body2" noWrap title={file.name}>{file.name}</Typography>
                                <Typography variant="caption" color="text.secondary">
                                    {formatSize(file.size)}
                                </Typography>
                            </Box>
                            {rol ? (
                                <Chip label={etiqueta(rol)} size="small" color="primary" variant="outlined" />
                            ) : ambiguo ? (
                                <Tooltip title={`Matchea ${ambiguo.map(etiqueta).join(" y ")}: corregí los patrones en la plantilla`}>
                                    <Chip label="ambiguo" size="small" color="error" />
                                </Tooltip>
                            ) : (
                                <Chip label="sin reconocer" size="small" color="warning" />
                            )}
                            <IconButton size="small" onClick={() => quitar(file.name)} aria-label={`Quitar ${file.name}`}>
                                <DeleteOutlineIcon fontSize="small" />
                            </IconButton>
                        </Paper>
                    ))}
                </Stack>
            )}

            {/* Diagnóstico: exactamente lo mismo que va a chequear el backend */}
            {archivos.length > 0 && (
                <Box sx={{ mt: 2 }}>
                    {faltantes.length > 0 && (
                        <Alert severity="warning" sx={{ mb: 1 }}>
                            Falta{faltantes.length > 1 ? "n" : ""} el archivo de{" "}
                            <strong>{faltantes.join(" y de ")}</strong>. Sin eso no se puede armar la cartera.
                        </Alert>
                    )}
                    {sinReconocer.length > 0 && (
                        <Alert severity="warning" sx={{ mb: 1 }}>
                            No se reconoce el tipo de <strong>{sinReconocer.join(", ")}</strong>. Revisá que el
                            nombre coincida con lo que declara la plantilla, o quitalo del paquete.
                        </Alert>
                    )}
                    {ambiguos.length > 0 && (
                        <Alert severity="error" sx={{ mb: 1 }}>
                            <strong>{ambiguos.join(", ")}</strong> matchea más de un tipo de archivo. Hay que
                            corregir los patrones de nombre en la plantilla para que sean excluyentes.
                        </Alert>
                    )}
                    {duplicados.length > 0 && (
                        <Alert severity="error" sx={{ mb: 1 }}>
                            Hay más de un archivo para <strong>{duplicados.join(", ")}</strong>. Dejá uno solo de
                            cada tipo.
                        </Alert>
                    )}
                    {completo && (
                        <Alert severity="success">
                            Paquete completo: {conRol.map((a) => etiqueta(a.rol!)).join(" · ")}.
                        </Alert>
                    )}
                </Box>
            )}

            {!patrones && (
                <Alert severity="info" sx={{ mt: 2 }}>
                    Elegí primero la plantilla: los tipos de archivo se reconocen con los patrones de nombre que
                    tiene configurados.
                </Alert>
            )}
        </Box>
    );
}

/** True si el paquete está listo para subir (lo usa el wizard para habilitar el botón). */
export function paqueteCompleto(archivos: File[], patrones?: Record<string, string>): boolean {
    if (archivos.length === 0) return false;
    const conRol = detectarRoles(archivos, patrones);
    if (conRol.some((a) => !a.rol)) return false;
    const porRol = new Map<string, number>();
    for (const a of conRol) porRol.set(a.rol!, (porRol.get(a.rol!) ?? 0) + 1);
    if ([...porRol.values()].some((n) => n > 1)) return false;
    return ROLES.filter((r) => r.requerido).every((r) => porRol.has(r.key));
}
