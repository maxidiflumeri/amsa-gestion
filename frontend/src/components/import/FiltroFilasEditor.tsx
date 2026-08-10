import React from 'react'
import {
    Alert, Box, Button, FormControl, IconButton, InputLabel, MenuItem, Paper, Select, Stack,
    TextField, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'

/**
 * Editor del filtro de filas de una plantilla: qué subconjunto del archivo se importa.
 *
 * Nace del archivo de novedades de AYSA, que mezcla en un mismo TXT los cobros con los cambios de
 * situación que no mueven plata: de 4.552 filas, solo 1.997 traen importe cobrado. Sin filtrar, el
 * import genera 2.555 pagos de $0.
 *
 * Las filas descartadas **no son errores**: no aparecen en el detalle del import ni cuentan como
 * fila fallida. El preview del wizard informa cuántas se descartaron, que es lo que le permite al
 * operador confirmar el criterio antes de ejecutar.
 */

export type OperadorFiltro =
    | 'IGUAL' | 'DISTINTO' | 'CONTIENE'
    | 'MAYOR' | 'MENOR'
    | 'VACIO' | 'NO_VACIO'

export interface FiltroFila {
    fromIndex: number
    operador: OperadorFiltro
    valor?: string
}

const OPERADORES: Array<{ v: OperadorFiltro; label: string; sinValor?: boolean }> = [
    { v: 'MAYOR', label: 'es mayor que' },
    { v: 'MENOR', label: 'es menor que' },
    { v: 'IGUAL', label: 'es igual a' },
    { v: 'DISTINTO', label: 'es distinto de' },
    { v: 'CONTIENE', label: 'contiene' },
    { v: 'NO_VACIO', label: 'no está vacía', sinValor: true },
    { v: 'VACIO', label: 'está vacía', sinValor: true },
]

const sinValor = (op: OperadorFiltro) => OPERADORES.find((o) => o.v === op)?.sinValor === true

interface Props {
    value: FiltroFila[]
    onChange: (v: FiltroFila[]) => void
    /** Nombres de las columnas, si la plantilla los conoce (ancho fijo). Solo para el combo. */
    columnas?: string[]
}

export default function FiltroFilasEditor({ value, onChange, columnas }: Props) {
    const set = (i: number, patch: Partial<FiltroFila>) =>
        onChange(value.map((f, j) => (j === i ? { ...f, ...patch } : f)))

    const quitar = (i: number) => onChange(value.filter((_, j) => j !== i))

    const agregar = () => onChange([...value, { fromIndex: 0, operador: 'NO_VACIO' }])

    return (
        <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                Filtro de filas (opcional)
            </Typography>

            <Alert severity="info" sx={{ mb: 2 }}>
                Sin condiciones se importan <strong>todas</strong> las filas del archivo. Si el cedente
                manda un archivo que mezcla cosas —por ejemplo novedades donde solo algunas traen un
                cobro— agregá acá las condiciones que tiene que cumplir una fila para importarse. Las
                que no las cumplen <strong>se descartan sin contar como error</strong>.
            </Alert>

            <Stack spacing={1.5}>
                {value.map((f, i) => (
                    <Paper key={i} variant="outlined" sx={{ p: 1.5 }}>
                        <Stack direction="row" spacing={1.5} alignItems="flex-start" flexWrap="wrap" useFlexGap>
                            {i > 0 && (
                                <Typography variant="body2" sx={{ pt: 2, color: 'text.secondary', minWidth: 20 }}>
                                    y
                                </Typography>
                            )}

                            {columnas?.length ? (
                                <FormControl size="small" sx={{ flex: '1 1 220px' }}>
                                    <InputLabel>Columna</InputLabel>
                                    <Select
                                        value={f.fromIndex}
                                        label="Columna"
                                        onChange={(e) => set(i, { fromIndex: Number(e.target.value) })}
                                    >
                                        {columnas.map((c, idx) => (
                                            <MenuItem key={`${c}-${idx}`} value={idx}>
                                                {idx} — {c}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                            ) : (
                                <TextField
                                    size="small"
                                    label="Columna (índice, 0-based)"
                                    type="number"
                                    value={f.fromIndex}
                                    onChange={(e) => set(i, { fromIndex: parseInt(e.target.value, 10) || 0 })}
                                    sx={{ flex: '1 1 200px' }}
                                />
                            )}

                            <FormControl size="small" sx={{ flex: '1 1 180px' }}>
                                <InputLabel>Condición</InputLabel>
                                <Select
                                    value={f.operador}
                                    label="Condición"
                                    onChange={(e) => {
                                        const operador = e.target.value as OperadorFiltro
                                        set(i, { operador, valor: sinValor(operador) ? undefined : (f.valor ?? '') })
                                    }}
                                >
                                    {OPERADORES.map((o) => (
                                        <MenuItem key={o.v} value={o.v}>
                                            {o.label}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>

                            {!sinValor(f.operador) && (
                                <TextField
                                    size="small"
                                    label="Valor"
                                    value={f.valor ?? ''}
                                    onChange={(e) => set(i, { valor: e.target.value })}
                                    sx={{ flex: '1 1 160px' }}
                                    helperText={
                                        f.operador === 'MAYOR' || f.operador === 'MENOR'
                                            ? 'Se compara como número'
                                            : 'No distingue mayúsculas'
                                    }
                                />
                            )}

                            <IconButton
                                size="small"
                                aria-label="Quitar condición"
                                onClick={() => quitar(i)}
                                sx={{ mt: 0.5 }}
                            >
                                <DeleteOutlineIcon fontSize="small" />
                            </IconButton>
                        </Stack>
                    </Paper>
                ))}
            </Stack>

            <Button size="small" startIcon={<AddIcon />} onClick={agregar} sx={{ mt: 1 }}>
                Agregar condición
            </Button>
        </Box>
    )
}
