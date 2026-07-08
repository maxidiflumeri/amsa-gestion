import React, { useCallback, useState } from "react";
import {
    Box,
    Button,
    Chip,
    CircularProgress,
    Divider,
    FormControl,
    FormControlLabel,
    IconButton,
    InputLabel,
    MenuItem,
    Select,
    Stack,
    Switch,
    TextField,
    Typography,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import { SectionCard } from "../ui";
import api from "../../api/axios";
import { useNotify } from "../../hooks/useNotify";

// ─── Tipos (espejan backend mapping-types.ts → AccionesConfig) ────────────────
export type OrigenValor = "ESTATICO" | "COLUMNA";
export type CampoPrincipal = "nombre" | "apellido" | "montoTotal" | "fechaVencimiento" | "nroCliente";
export type TipoContactoAccion = "telefono" | "email" | "cualquiera";

export type AccionOperacion =
    | { tipo: "SET_SITUACION" | "SET_GESTION" | "SET_MOTIVO"; modo: OrigenValor; parametroId?: number; fromIndex?: number }
    | { tipo: "SET_CAMPO"; campo: CampoPrincipal; modo: OrigenValor; valor?: string; fromIndex?: number }
    | { tipo: "SET_ADICIONALES"; columnas: Array<{ nombre: string; fromIndex: number }> }
    | { tipo: "ADD_COMENTARIO"; modo: "ESTATICO" | "COLUMNA" | "PLANTILLA"; texto?: string; fromIndex?: number; plantilla?: string }
    | { tipo: "DELETE_CONTACTO"; contactoTipo: TipoContactoAccion; modo: OrigenValor; valor?: string; fromIndex?: number };

export interface AccionesConfig {
    matchMode: "DEUDOR" | "CONTACTO";
    matchColumn?: { field: "nro_cliente" | "documento" | "id"; fromIndex: number };
    contactoValor?: { tipo: "telefono" | "email"; fromIndex: number };
    saltearCanceladas?: boolean;
    operaciones: AccionOperacion[];
}

interface Parametro {
    id: number;
    clave: string;
    descripcion: string;
}

interface Props {
    value: AccionesConfig;
    onChange: (cfg: AccionesConfig) => void;
    paramsSituacion: Parametro[];
    paramsGestion: Parametro[];
    paramsMotivo: Parametro[];
    separador: string;
    tieneHeader: boolean;
}

const TIPOS_OP: { value: AccionOperacion["tipo"]; label: string }[] = [
    { value: "SET_SITUACION", label: "Marcar situación" },
    { value: "SET_GESTION", label: "Marcar gestión" },
    { value: "SET_MOTIVO", label: "Marcar motivo de no pago" },
    { value: "SET_CAMPO", label: "Pisar un campo principal" },
    { value: "SET_ADICIONALES", label: "Agregar datos adicionales" },
    { value: "ADD_COMENTARIO", label: "Agregar comentario" },
    { value: "DELETE_CONTACTO", label: "Eliminar contacto" },
];

const CAMPOS: { value: CampoPrincipal; label: string }[] = [
    { value: "nombre", label: "Nombre" },
    { value: "apellido", label: "Apellido" },
    { value: "montoTotal", label: "Monto total" },
    { value: "fechaVencimiento", label: "Fecha vencimiento" },
    { value: "nroCliente", label: "Nº Cliente" },
];

export default function AccionesEditor({
    value, onChange, paramsSituacion, paramsGestion, paramsMotivo, separador, tieneHeader,
}: Props) {
    const notify = useNotify();
    const cfg = value;
    const set = (patch: Partial<AccionesConfig>) => onChange({ ...cfg, ...patch });

    // Archivo de muestra → columnas detectadas
    const [previewRows, setPreviewRows] = useState<string[][]>([]);
    const [totalColumns, setTotalColumns] = useState(0);
    const [previewFile, setPreviewFile] = useState<File | null>(null);
    const [loading, setLoading] = useState(false);

    const handleFileUpload = useCallback(async (file: File) => {
        setPreviewFile(file);
        setLoading(true);
        try {
            const fd = new FormData();
            fd.append("file", file);
            fd.append("separador", separador);
            fd.append("tieneHeader", String(tieneHeader));
            const res = await api.post("/import/plantillas/preview", fd, { headers: { "Content-Type": "multipart/form-data" } });
            setPreviewRows(res.data.rows ?? []);
            setTotalColumns(res.data.totalColumns ?? 0);
        } catch (e) {
            notify.error(e as Error);
        }
        setLoading(false);
    }, [separador, tieneHeader, notify]);

    // Selector de columna: dropdown con muestra del valor
    const ColumnaSelect = ({ label, value: v, onChange: oc }: { label: string; value?: number; onChange: (n: number) => void }) => (
        <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel>{label}</InputLabel>
            <Select label={label} value={v ?? ""} onChange={(e) => oc(Number(e.target.value))}>
                {Array.from({ length: Math.max(totalColumns, 20) }).map((_, i) => (
                    <MenuItem key={i} value={i}>
                        Col {i}
                        {previewRows[0]?.[i] ? ` — "${String(previewRows[0][i]).substring(0, 20)}"` : ""}
                    </MenuItem>
                ))}
            </Select>
        </FormControl>
    );

    const setOp = (i: number, op: AccionOperacion) => {
        const operaciones = [...cfg.operaciones];
        operaciones[i] = op;
        set({ operaciones });
    };
    const removeOp = (i: number) => set({ operaciones: cfg.operaciones.filter((_, j) => j !== i) });
    const addOp = () => set({ operaciones: [...cfg.operaciones, { tipo: "SET_SITUACION", modo: "ESTATICO" } as AccionOperacion] });

    // Plantilla de comentario: refs a los textarea para insertar {{colN}} en la posición del cursor.
    const comentarioRefs = React.useRef<Record<number, HTMLTextAreaElement | null>>({});
    const insertarVariable = (i: number, op: any, placeholder: string) => {
        const el = comentarioRefs.current[i];
        const actual: string = op.plantilla ?? "";
        if (!el) { setOp(i, { ...op, plantilla: actual + placeholder }); return; }
        const start = el.selectionStart ?? actual.length;
        const end = el.selectionEnd ?? actual.length;
        const nuevo = actual.slice(0, start) + placeholder + actual.slice(end);
        setOp(i, { ...op, plantilla: nuevo });
        const pos = start + placeholder.length;
        requestAnimationFrame(() => { el.focus(); el.setSelectionRange(pos, pos); });
    };
    // Preview en vivo: reemplaza {{colN}} por el valor de la 1ª fila de muestra.
    const previewPlantilla = (tpl: string): string =>
        tpl.replace(/\{\{\s*col\s*(\d+)\s*\}\}/gi, (_m, x) => String(previewRows[0]?.[Number(x)] ?? ""));

    const paramsFor = (tipo: string): Parametro[] =>
        tipo === "SET_SITUACION" ? paramsSituacion : tipo === "SET_GESTION" ? paramsGestion : paramsMotivo;

    return (
        <Box>
            {/* Archivo de muestra */}
            <Box
                onClick={() => document.getElementById("acciones-preview-file")?.click()}
                sx={{
                    p: 2, mb: 2, border: "2px dashed", borderColor: previewFile ? "success.main" : "divider",
                    borderRadius: 2, textAlign: "center", cursor: "pointer",
                }}
            >
                <input
                    id="acciones-preview-file" type="file" hidden accept=".csv,.txt,.xls,.xlsx"
                    onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
                />
                {loading ? <CircularProgress size={24} /> : <CloudUploadIcon sx={{ fontSize: 32, color: "text.secondary", mb: 0.5 }} />}
                <Typography variant="body2" color="text.secondary">
                    {previewFile ? `${previewFile.name} (${totalColumns} columnas detectadas)` : "Subí un archivo de muestra para ver y elegir las columnas"}
                </Typography>
            </Box>

            {/* Tipo de acción */}
            <FormControl size="small" sx={{ minWidth: 340, mb: 2 }}>
                <InputLabel>Tipo de acción</InputLabel>
                <Select label="Tipo de acción" value={cfg.matchMode} onChange={(e) => set({ matchMode: e.target.value as any })}>
                    <MenuItem value="DEUDOR">Modificar deudores de un listado</MenuItem>
                    <MenuItem value="CONTACTO">Eliminar un teléfono/email de toda la base</MenuItem>
                </Select>
            </FormControl>

            {cfg.matchMode === "CONTACTO" && (
                <SectionCard title="Contactos a eliminar">
                    <Stack direction="row" spacing={2} flexWrap="wrap" alignItems="center" useFlexGap>
                        <FormControl size="small" sx={{ minWidth: 160 }}>
                            <InputLabel>Tipo</InputLabel>
                            <Select
                                label="Tipo"
                                value={cfg.contactoValor?.tipo ?? "telefono"}
                                onChange={(e) => set({ contactoValor: { tipo: e.target.value as any, fromIndex: cfg.contactoValor?.fromIndex ?? 0 } })}
                            >
                                <MenuItem value="telefono">Teléfono</MenuItem>
                                <MenuItem value="email">Email</MenuItem>
                            </Select>
                        </FormControl>
                        <ColumnaSelect
                            label="Columna del valor"
                            value={cfg.contactoValor?.fromIndex}
                            onChange={(n) => set({ contactoValor: { tipo: cfg.contactoValor?.tipo ?? "telefono", fromIndex: n } })}
                        />
                    </Stack>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                        Se elimina de TODA la base de la empresa cada contacto cuyo valor esté en esa columna. Se puede deshacer después.
                    </Typography>
                </SectionCard>
            )}

            {cfg.matchMode === "DEUDOR" && (<>
            {/* Matcheo */}
            <SectionCard title="A qué deudores">
                <Stack direction="row" spacing={2} flexWrap="wrap" alignItems="center" useFlexGap>
                    <FormControl size="small" sx={{ minWidth: 180 }}>
                        <InputLabel>Matchear por</InputLabel>
                        <Select
                            label="Matchear por"
                            value={cfg.matchColumn?.field ?? "nro_cliente"}
                            onChange={(e) => set({ matchColumn: { field: e.target.value as any, fromIndex: cfg.matchColumn?.fromIndex ?? 0 } })}
                        >
                            <MenuItem value="nro_cliente">Nº Cliente</MenuItem>
                            <MenuItem value="documento">Documento</MenuItem>
                            <MenuItem value="id">ID Deudor</MenuItem>
                        </Select>
                    </FormControl>
                    <ColumnaSelect
                        label="Columna del match"
                        value={cfg.matchColumn?.fromIndex}
                        onChange={(n) => set({ matchColumn: { field: cfg.matchColumn?.field ?? "nro_cliente", fromIndex: n } })}
                    />
                    <FormControlLabel
                        control={<Switch checked={!!cfg.saltearCanceladas} onChange={(e) => set({ saltearCanceladas: e.target.checked })} />}
                        label="No tocar cuentas canceladas (SIT-050)"
                    />
                </Stack>
            </SectionCard>

            {/* Operaciones */}
            <SectionCard title="Qué hacer con esos deudores" sx={{ mt: 2 }}>
                <Stack spacing={2}>
                    {cfg.operaciones.length === 0 && (
                        <Typography variant="body2" color="text.secondary">
                            Todavía no agregaste operaciones. Se aplican en orden a cada deudor matcheado.
                        </Typography>
                    )}

                    {cfg.operaciones.map((op, i) => (
                        <Box key={i} sx={{ p: 2, border: "1px solid", borderColor: "divider", borderRadius: 2 }}>
                            <Stack direction="row" spacing={2} flexWrap="wrap" alignItems="center" useFlexGap>
                                <FormControl size="small" sx={{ minWidth: 220 }}>
                                    <InputLabel>Operación</InputLabel>
                                    <Select
                                        label="Operación"
                                        value={op.tipo}
                                        onChange={(e) => {
                                            const tipo = e.target.value as AccionOperacion["tipo"];
                                            const base: any =
                                                tipo === "SET_ADICIONALES" ? { tipo, columnas: [{ nombre: "", fromIndex: 0 }] }
                                                    : tipo === "SET_CAMPO" ? { tipo, campo: "nombre", modo: "ESTATICO" }
                                                        : tipo === "DELETE_CONTACTO" ? { tipo, contactoTipo: "telefono", modo: "ESTATICO" }
                                                            : { tipo, modo: "ESTATICO" };
                                            setOp(i, base);
                                        }}
                                    >
                                        {TIPOS_OP.map((t) => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
                                    </Select>
                                </FormControl>

                                {(op.tipo === "SET_SITUACION" || op.tipo === "SET_GESTION" || op.tipo === "SET_MOTIVO") && (
                                    <>
                                        <FormControl size="small" sx={{ minWidth: 170 }}>
                                            <InputLabel>Origen</InputLabel>
                                            <Select label="Origen" value={op.modo} onChange={(e) => setOp(i, { ...op, modo: e.target.value as OrigenValor })}>
                                                <MenuItem value="ESTATICO">Un código fijo</MenuItem>
                                                <MenuItem value="COLUMNA">Desde una columna (clave)</MenuItem>
                                            </Select>
                                        </FormControl>
                                        {op.modo === "ESTATICO" ? (
                                            <FormControl size="small" sx={{ minWidth: 260 }}>
                                                <InputLabel>Código</InputLabel>
                                                <Select label="Código" value={op.parametroId ?? ""} onChange={(e) => setOp(i, { ...op, parametroId: Number(e.target.value) })}>
                                                    {paramsFor(op.tipo).map((p) => <MenuItem key={p.id} value={p.id}>{p.clave} — {p.descripcion}</MenuItem>)}
                                                </Select>
                                            </FormControl>
                                        ) : (
                                            <ColumnaSelect label="Columna (clave)" value={op.fromIndex} onChange={(n) => setOp(i, { ...op, fromIndex: n })} />
                                        )}
                                    </>
                                )}

                                {op.tipo === "SET_CAMPO" && (
                                    <>
                                        <FormControl size="small" sx={{ minWidth: 180 }}>
                                            <InputLabel>Campo</InputLabel>
                                            <Select label="Campo" value={op.campo} onChange={(e) => setOp(i, { ...op, campo: e.target.value as CampoPrincipal })}>
                                                {CAMPOS.map((c) => <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>)}
                                            </Select>
                                        </FormControl>
                                        <FormControl size="small" sx={{ minWidth: 150 }}>
                                            <InputLabel>Origen</InputLabel>
                                            <Select label="Origen" value={op.modo} onChange={(e) => setOp(i, { ...op, modo: e.target.value as OrigenValor })}>
                                                <MenuItem value="ESTATICO">Un valor fijo</MenuItem>
                                                <MenuItem value="COLUMNA">Desde una columna</MenuItem>
                                            </Select>
                                        </FormControl>
                                        {op.modo === "ESTATICO" ? (
                                            <TextField size="small" label="Valor" value={op.valor ?? ""} onChange={(e) => setOp(i, { ...op, valor: e.target.value })} />
                                        ) : (
                                            <ColumnaSelect label="Columna" value={op.fromIndex} onChange={(n) => setOp(i, { ...op, fromIndex: n })} />
                                        )}
                                    </>
                                )}

                                {op.tipo === "ADD_COMENTARIO" && (
                                    <>
                                        <FormControl size="small" sx={{ minWidth: 190 }}>
                                            <InputLabel>Origen</InputLabel>
                                            <Select label="Origen" value={op.modo} onChange={(e) => setOp(i, { ...op, modo: e.target.value as "ESTATICO" | "COLUMNA" | "PLANTILLA" })}>
                                                <MenuItem value="ESTATICO">Texto fijo</MenuItem>
                                                <MenuItem value="COLUMNA">Desde una columna</MenuItem>
                                                <MenuItem value="PLANTILLA">Plantilla con variables</MenuItem>
                                            </Select>
                                        </FormControl>
                                        {op.modo === "ESTATICO" && (
                                            <TextField size="small" fullWidth label="Comentario" value={op.texto ?? ""} onChange={(e) => setOp(i, { ...op, texto: e.target.value })} sx={{ flex: 1, minWidth: 240 }} />
                                        )}
                                        {op.modo === "COLUMNA" && (
                                            <ColumnaSelect label="Columna" value={op.fromIndex} onChange={(n) => setOp(i, { ...op, fromIndex: n })} />
                                        )}
                                    </>
                                )}

                                {op.tipo === "DELETE_CONTACTO" && (
                                    <>
                                        <FormControl size="small" sx={{ minWidth: 150 }}>
                                            <InputLabel>Tipo</InputLabel>
                                            <Select label="Tipo" value={op.contactoTipo} onChange={(e) => setOp(i, { ...op, contactoTipo: e.target.value as any })}>
                                                <MenuItem value="telefono">Teléfono</MenuItem>
                                                <MenuItem value="email">Email</MenuItem>
                                                <MenuItem value="cualquiera">Cualquiera</MenuItem>
                                            </Select>
                                        </FormControl>
                                        <FormControl size="small" sx={{ minWidth: 150 }}>
                                            <InputLabel>Origen</InputLabel>
                                            <Select label="Origen" value={op.modo} onChange={(e) => setOp(i, { ...op, modo: e.target.value as OrigenValor })}>
                                                <MenuItem value="ESTATICO">Un valor fijo</MenuItem>
                                                <MenuItem value="COLUMNA">Desde una columna</MenuItem>
                                            </Select>
                                        </FormControl>
                                        {op.modo === "ESTATICO" ? (
                                            <TextField size="small" label="Valor a eliminar" value={op.valor ?? ""} onChange={(e) => setOp(i, { ...op, valor: e.target.value })} />
                                        ) : (
                                            <ColumnaSelect label="Columna" value={op.fromIndex} onChange={(n) => setOp(i, { ...op, fromIndex: n })} />
                                        )}
                                    </>
                                )}

                                <Box sx={{ flex: 1 }} />
                                <IconButton color="error" onClick={() => removeOp(i)} aria-label="Quitar operación">
                                    <DeleteIcon />
                                </IconButton>
                            </Stack>

                            {op.tipo === "SET_ADICIONALES" && (
                                <Box sx={{ mt: 2, pl: 1 }}>
                                    <Typography variant="caption" color="text.secondary">
                                        Datos adicionales a cargar (nombre del campo + columna). Si la clave ya existe, se reemplaza.
                                    </Typography>
                                    <Stack spacing={1} sx={{ mt: 1 }}>
                                        {op.columnas.map((c, ci) => (
                                            <Stack key={ci} direction="row" spacing={1} alignItems="center">
                                                <TextField size="small" label="Nombre del campo" value={c.nombre}
                                                    onChange={(e) => { const columnas = [...op.columnas]; columnas[ci] = { ...c, nombre: e.target.value }; setOp(i, { ...op, columnas }); }} />
                                                <ColumnaSelect label="Columna" value={c.fromIndex}
                                                    onChange={(n) => { const columnas = [...op.columnas]; columnas[ci] = { ...c, fromIndex: n }; setOp(i, { ...op, columnas }); }} />
                                                <IconButton size="small" color="error" onClick={() => setOp(i, { ...op, columnas: op.columnas.filter((_, k) => k !== ci) })}>
                                                    <DeleteIcon fontSize="small" />
                                                </IconButton>
                                            </Stack>
                                        ))}
                                        <Button size="small" startIcon={<AddIcon />} onClick={() => setOp(i, { ...op, columnas: [...op.columnas, { nombre: "", fromIndex: 0 }] })}>
                                            Agregar campo
                                        </Button>
                                    </Stack>
                                </Box>
                            )}

                            {op.tipo === "ADD_COMENTARIO" && op.modo === "PLANTILLA" && (
                                <Box sx={{ mt: 2, pl: 1 }}>
                                    <Typography variant="caption" color="text.secondary">
                                        Escribí el comentario como quieras e insertá variables de columna.
                                        Cada {"{{colN}}"} se reemplaza por el valor de esa columna en cada fila.
                                    </Typography>
                                    <TextField
                                        fullWidth multiline minRows={2} sx={{ mt: 1 }}
                                        label="Plantilla del comentario"
                                        placeholder="ej: tarjeta {{col1}} - motivo {{col2}} - por {{col3}}"
                                        value={op.plantilla ?? ""}
                                        onChange={(e) => setOp(i, { ...op, plantilla: e.target.value })}
                                        inputRef={(el) => { comentarioRefs.current[i] = (el as HTMLTextAreaElement) ?? null; }}
                                    />
                                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap alignItems="center" sx={{ mt: 1 }}>
                                        <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
                                            Insertar columna:
                                        </Typography>
                                        {Array.from({ length: totalColumns > 0 ? totalColumns : 12 }).map((_, ci) => (
                                            <Chip
                                                key={ci}
                                                size="small"
                                                variant="outlined"
                                                label={`{{col${ci}}}${previewRows[0]?.[ci] ? ` · ${String(previewRows[0][ci]).substring(0, 12)}` : ""}`}
                                                onMouseDown={(e) => { e.preventDefault(); insertarVariable(i, op, `{{col${ci}}}`); }}
                                            />
                                        ))}
                                    </Stack>
                                    {!!op.plantilla && previewRows[0] && (
                                        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1, fontStyle: "italic" }}>
                                            Vista previa (1ª fila): {previewPlantilla(op.plantilla) || "—"}
                                        </Typography>
                                    )}
                                </Box>
                            )}
                        </Box>
                    ))}

                    <Divider />
                    <Button startIcon={<AddIcon />} onClick={addOp} variant="outlined" sx={{ alignSelf: "flex-start" }}>
                        Agregar operación
                    </Button>
                </Stack>
            </SectionCard>
            </>)}
        </Box>
    );
}
