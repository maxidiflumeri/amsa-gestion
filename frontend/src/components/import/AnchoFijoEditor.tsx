import React, { useMemo, useRef, useState } from 'react'
import {
    Alert, Box, Button, Chip, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow,
    TextField, Tooltip, Typography, FormControl, InputLabel, Select, MenuItem, CircularProgress,
} from '@mui/material'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import api from '../../api/axios'
import { useNotify } from '../../hooks/useNotify'

/**
 * Editor del layout de un archivo de **ancho fijo**: cada campo ocupa siempre las mismas posiciones
 * de la línea y no hay separador. Es el formato en el que exporta SAP (caso AYSA).
 *
 * Mismo criterio que los editores de multirregistro y multiarchivo: es config técnica que se toca
 * una vez al dar de alta la cartera, así que se edita como texto —una columna por línea— en vez de
 * con un constructor visual. Lo que hace usable eso es el **preview**: la tabla de abajo muestra
 * cómo queda cortada de verdad la primera fila del archivo, así el operador ve el error enseguida.
 *
 * "Inferir del archivo" propone un layout mirando dónde hay espacio en el encabezado y en todas las
 * filas. No acierta al 100% —los campos que vienen pegados en ambos lados quedan fusionados— pero
 * deja poco para corregir a mano.
 */

export interface ColumnaAnchoFijo {
    nombre: string
    inicio: number
    largo: number
}

interface Props {
    /** Layout en formato texto: `nombre;inicio;largo` por línea. */
    value: string
    onChange: (v: string) => void
    encoding: 'latin1' | 'utf8'
    onEncodingChange: (v: 'latin1' | 'utf8') => void
    tieneHeader: boolean
}

/** Convierte el texto del editor a columnas, reportando el error con el número de línea. */
export function parsearLayout(texto: string): { columnas: ColumnaAnchoFijo[]; error: string | null } {
    const columnas: ColumnaAnchoFijo[] = []
    const lineas = texto.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))

    for (const [i, l] of lineas.entries()) {
        const partes = l.split(';').map((p) => p.trim())
        if (partes.length < 3) {
            return { columnas: [], error: `Línea ${i + 1}: se esperaba "nombre;inicio;largo".` }
        }
        // El nombre puede tener punto y coma: se toman los dos últimos campos como los números.
        const largo = Number(partes[partes.length - 1])
        const inicio = Number(partes[partes.length - 2])
        const nombre = partes.slice(0, partes.length - 2).join(';').trim()

        if (!nombre) return { columnas: [], error: `Línea ${i + 1}: falta el nombre de la columna.` }
        if (!Number.isInteger(inicio) || inicio < 0) {
            return { columnas: [], error: `Línea ${i + 1} ("${nombre}"): el inicio tiene que ser un entero ≥ 0.` }
        }
        if (!Number.isInteger(largo) || largo < 1) {
            return { columnas: [], error: `Línea ${i + 1} ("${nombre}"): el largo tiene que ser un entero ≥ 1.` }
        }
        columnas.push({ nombre, inicio, largo })
    }

    if (columnas.length === 0) return { columnas: [], error: 'El layout no declara ninguna columna.' }
    return { columnas, error: null }
}

/** Convierte columnas a la forma texto del editor. */
export function layoutATexto(columnas: ColumnaAnchoFijo[]): string {
    return columnas.map((c) => `${c.nombre};${c.inicio};${c.largo}`).join('\n')
}

const cortar = (linea: string, c: ColumnaAnchoFijo) => linea.slice(c.inicio, c.inicio + c.largo).trim()

export default function AnchoFijoEditor({
    value, onChange, encoding, onEncodingChange, tieneHeader,
}: Props) {
    const notify = useNotify()
    const inputRef = useRef<HTMLInputElement>(null)
    const [inferiendo, setInferiendo] = useState(false)
    /** Primeras líneas del archivo que subió el operador, para el preview. */
    const [lineas, setLineas] = useState<string[]>([])

    const { columnas, error } = useMemo(() => parsearLayout(value), [value])

    const ancho = columnas.reduce((max, c) => Math.max(max, c.inicio + c.largo), 0)

    /** Tramos del layout que no cubre ninguna columna: casi siempre es un corte mal puesto. */
    const huecos = useMemo(() => {
        const orden = [...columnas].sort((a, b) => a.inicio - b.inicio)
        const res: string[] = []
        let prev = 0
        for (const c of orden) {
            if (c.inicio > prev) res.push(`${prev}-${c.inicio - 1}`)
            prev = Math.max(prev, c.inicio + c.largo)
        }
        return res
    }, [columnas])

    /** Filas de datos del archivo subido (sin el encabezado si la plantilla lo declara). */
    const filas = tieneHeader ? lineas.slice(1) : lineas
    const header = tieneHeader ? lineas[0] : undefined

    const inferir = async (file: File) => {
        setInferiendo(true)
        try {
            const fd = new FormData()
            fd.append('file', file)
            fd.append('tieneHeader', String(tieneHeader))
            fd.append('encoding', encoding)
            const res = await api.post('/import/plantillas/inferir-ancho-fijo', fd, {
                headers: { 'Content-Type': 'multipart/form-data' },
            })
            onChange(layoutATexto(res.data.columnas ?? []))
            setLineas(res.data.lineas ?? [])
            notify.success(
                `Se propusieron ${res.data.columnas?.length ?? 0} columnas (ancho ${res.data.ancho}). ` +
                'Revisá el corte de abajo y separá a mano las que hayan quedado juntas.',
            )
        } catch (err) {
            notify.error(err as Error)
        } finally {
            setInferiendo(false)
        }
    }

    return (
        <Box>
            <Alert severity="info" sx={{ mb: 2 }}>
                En un archivo de <strong>ancho fijo</strong> los campos no están separados por ningún
                carácter: cada uno ocupa siempre las mismas posiciones de la línea. Declaralos abajo, uno
                por línea, como <code>nombre;inicio;largo</code> — el <strong>inicio arranca en 0</strong> y
                el largo incluye el relleno de espacios. El orden de las líneas es el número de columna que
                después se usa en el mapeo.
            </Alert>

            <Stack direction="row" spacing={1} sx={{ mb: 2 }} alignItems="center" flexWrap="wrap" useFlexGap>
                <input
                    ref={inputRef}
                    type="file"
                    accept=".txt,.csv,.dat"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) inferir(f)
                        e.target.value = ''
                    }}
                />
                <Tooltip title="Sube un archivo de ejemplo y propone el layout mirando dónde hay espacio en todas las filas">
                    <span>
                        <Button
                            variant="outlined"
                            size="small"
                            startIcon={inferiendo ? <CircularProgress size={16} /> : <AutoFixHighIcon />}
                            disabled={inferiendo}
                            onClick={() => inputRef.current?.click()}
                        >
                            Inferir del archivo
                        </Button>
                    </span>
                </Tooltip>

                <Tooltip title="Vuelve a leer un archivo para actualizar el preview, sin tocar el layout">
                    <span>
                        <Button
                            variant="text"
                            size="small"
                            startIcon={<UploadFileIcon />}
                            disabled={inferiendo}
                            onClick={() => {
                                const el = document.createElement('input')
                                el.type = 'file'
                                el.accept = '.txt,.csv,.dat'
                                el.onchange = async () => {
                                    const f = el.files?.[0]
                                    if (!f) return
                                    const buf = await f.arrayBuffer()
                                    const texto = new TextDecoder(
                                        encoding === 'utf8' ? 'utf-8' : 'windows-1252',
                                    ).decode(buf.slice(0, 256 * 1024))
                                    setLineas(texto.split(/\r?\n/).filter((l) => l.trim()).slice(0, 6))
                                }
                                el.click()
                            }}
                        >
                            Solo previsualizar
                        </Button>
                    </span>
                </Tooltip>

                <FormControl size="small" sx={{ minWidth: 200 }}>
                    <InputLabel>Codificación</InputLabel>
                    <Select
                        value={encoding}
                        label="Codificación"
                        onChange={(e) => onEncodingChange(e.target.value as 'latin1' | 'utf8')}
                    >
                        <MenuItem value="latin1">Latin-1 / ANSI (lo normal en SAP)</MenuItem>
                        <MenuItem value="utf8">UTF-8</MenuItem>
                    </Select>
                </FormControl>

                {!error && <Chip size="small" label={`${columnas.length} columnas · ancho ${ancho}`} />}
            </Stack>

            <TextField
                label="Layout de columnas"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                multiline
                minRows={12}
                maxRows={24}
                fullWidth
                error={!!error}
                helperText={
                    error ??
                    'Una columna por línea: nombre;inicio;largo. Las líneas que empiezan con # se ignoran.'
                }
                InputProps={{ sx: { fontFamily: 'monospace', fontSize: 13 } }}
            />

            {!error && huecos.length > 0 && (
                <Alert severity="warning" sx={{ mt: 2 }}>
                    El layout deja sin declarar {huecos.length === 1 ? 'el tramo' : 'los tramos'}{' '}
                    <strong>{huecos.join(', ')}</strong> de la línea. Puede ser a propósito, pero lo
                    habitual es que sea un inicio o un largo mal puesto.
                </Alert>
            )}

            {!error && header && ancho !== header.length && (
                <Alert severity="warning" sx={{ mt: 2 }}>
                    El layout cubre <strong>{ancho}</strong> caracteres pero el encabezado del archivo
                    tiene <strong>{header.length}</strong>. Si el cedente manda el ancho completo, los dos
                    números tienen que coincidir.
                </Alert>
            )}

            {!error && filas.length > 0 && (
                <Box sx={{ mt: 2 }}>
                    <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                        Cómo queda cortada la primera fila
                    </Typography>
                    <Paper variant="outlined" sx={{ overflow: 'auto', maxHeight: 360 }}>
                        <Table size="small" stickyHeader>
                            <TableHead>
                                <TableRow>
                                    <TableCell sx={{ width: 48 }}>#</TableCell>
                                    <TableCell>Columna</TableCell>
                                    <TableCell sx={{ width: 110 }}>Posición</TableCell>
                                    <TableCell>Valor</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {columnas.map((c, i) => {
                                    const valor = cortar(filas[0], c)
                                    // El rótulo que cae en esa misma posición del encabezado: si no
                                    // coincide con el nombre declarado, el corte está movido.
                                    const enHeader = header ? cortar(header, c) : undefined
                                    return (
                                        <TableRow key={`${c.nombre}-${i}`} hover>
                                            <TableCell sx={{ color: 'text.secondary' }}>{i}</TableCell>
                                            <TableCell>
                                                <Typography variant="body2">{c.nombre}</Typography>
                                                {enHeader !== undefined && enHeader !== c.nombre && (
                                                    <Typography variant="caption" color="warning.main">
                                                        en el archivo dice “{enHeader || '(vacío)'}”
                                                    </Typography>
                                                )}
                                            </TableCell>
                                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 12, color: 'text.secondary' }}>
                                                {c.inicio}+{c.largo}
                                            </TableCell>
                                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                                                {valor || <span style={{ opacity: 0.4 }}>(vacío)</span>}
                                            </TableCell>
                                        </TableRow>
                                    )
                                })}
                            </TableBody>
                        </Table>
                    </Paper>
                </Box>
            )}

            {!error && filas.length === 0 && (
                <Alert severity="info" sx={{ mt: 2 }}>
                    Subí un archivo de ejemplo con “Inferir del archivo” o “Solo previsualizar” para ver
                    cómo queda cortado cada campo. Sin eso, el layout se guarda igual pero a ciegas.
                </Alert>
            )}
        </Box>
    )
}
