import React from 'react'
import {
    Alert, Box, Button, IconButton, Paper, Stack, TextField, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'

/**
 * Editor de la división de una carga en varias remesas.
 *
 * Para los archivos que traen varias asignaciones juntas porque el cedente exporta filtrando solo
 * por día: el CA y el MA de Telecom/Personal llegan con todas las nóminas del día adentro, y en
 * gestión cada una tiene que ser su propia remesa.
 *
 * Las columnas tienen dos roles, que es lo que define el número de remesa:
 *
 *  - **Corte** (la nómina, y lo que haga falta): cada combinación distinta recibe **su propio
 *    número base**.
 *  - **Prefijo** (la gestión): NO avanza el número, le antepone su primer dígito al base de su
 *    corte. Una nómina con tres gestiones da 10100, 20100 y 30100.
 */

export interface ColumnaDivision {
    fromIndex: number
    etiqueta: string
}

export interface DivisionRemesa {
    cortes?: ColumnaDivision[]
    prefijo?: ColumnaDivision
}

interface Props {
    value: DivisionRemesa
    onChange: (v: DivisionRemesa) => void
}

/** Fila de una columna: el índice y cómo se llama en la pantalla de carga. */
function FilaColumna({
    columna,
    onChange,
    onQuitar,
    ayudaEtiqueta,
}: {
    columna: ColumnaDivision
    onChange: (c: ColumnaDivision) => void
    onQuitar?: () => void
    ayudaEtiqueta: string
}) {
    return (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="flex-start">
            <TextField
                label="Columna (índice)"
                type="number"
                size="small"
                sx={{ width: 160 }}
                value={columna.fromIndex}
                onChange={(e) => onChange({ ...columna, fromIndex: parseInt(e.target.value, 10) || 0 })}
            />
            <TextField
                label="Cómo se llama"
                size="small"
                sx={{ flex: 1, minWidth: 200 }}
                value={columna.etiqueta}
                onChange={(e) => onChange({ ...columna, etiqueta: e.target.value })}
                helperText={ayudaEtiqueta}
            />
            {onQuitar && (
                <IconButton onClick={onQuitar} aria-label="Quitar columna" sx={{ mt: 0.5 }}>
                    <DeleteOutlineIcon />
                </IconButton>
            )}
        </Stack>
    )
}

export default function DivisionRemesaEditor({ value, onChange }: Props) {
    const cortes = value.cortes ?? []

    const setCorte = (i: number, c: ColumnaDivision) =>
        onChange({ ...value, cortes: cortes.map((x, j) => (j === i ? c : x)) })

    const quitarCorte = (i: number) =>
        onChange({ ...value, cortes: cortes.filter((_, j) => j !== i) })

    const agregarCorte = () =>
        onChange({ ...value, cortes: [...cortes, { fromIndex: 0, etiqueta: 'Nómina' }] })

    const sinNada = cortes.length === 0 && !value.prefijo

    return (
        <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
                Columnas que cortan
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                Se crea una remesa por cada combinación distinta, y cada una recibe su propio número.
                La nómina va acá. Si el archivo mezcla carteras de empresas distintas (prebaja y
                posbaja), agregá también esa columna: se ve en la tabla de carga y podés tildar solo
                las nóminas de la empresa que estás cargando.
                <br />
                <strong>Si no declarás ninguna</strong>, todas las remesas de la carga comparten el
                número que tipeaste y lo único que las distingue es el dígito de la gestión.
            </Typography>

            <Stack spacing={2} sx={{ mb: 2 }}>
                {cortes.map((c, i) => (
                    <Paper key={i} variant="outlined" sx={{ p: 2 }}>
                        <FilaColumna
                            columna={c}
                            onChange={(x) => setCorte(i, x)}
                            onQuitar={() => quitarCorte(i)}
                            ayudaEtiqueta='Se muestra como título de columna en la tabla de carga (ej: "Nómina").'
                        />
                    </Paper>
                ))}
            </Stack>

            <Button startIcon={<AddIcon />} onClick={agregarCorte} size="small" sx={{ mb: 3 }}>
                Agregar columna de corte
            </Button>

            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
                Columna que prefija el número
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                La gestión. No crea un número nuevo: le antepone su primer dígito al de su corte. Con
                la nómina en la remesa <strong>100</strong>, la gestión <strong>1GH</strong> es la{' '}
                <strong>10100</strong>, la <strong>2GH</strong> la <strong>20100</strong> y la{' '}
                <strong>3GH</strong> la <strong>30100</strong>.
                <br />
                Lo que agrupa es el <strong>dígito</strong>: <strong>3G</strong> y{' '}
                <strong>3GH</strong> son la misma gestión, así que sus filas van a la misma remesa y
                en la tabla de carga se ven juntas (<code>3GH / 3G</code>).
            </Typography>

            {value.prefijo ? (
                <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                    <FilaColumna
                        columna={value.prefijo}
                        onChange={(x) => onChange({ ...value, prefijo: x })}
                        onQuitar={() => onChange({ ...value, prefijo: undefined })}
                        ayudaEtiqueta='Se muestra como título de columna en la tabla de carga (ej: "Gestión").'
                    />
                </Paper>
            ) : (
                <Button
                    startIcon={<AddIcon />}
                    size="small"
                    sx={{ mb: 2 }}
                    onClick={() => onChange({ ...value, prefijo: { fromIndex: 0, etiqueta: 'Gestión' } })}
                >
                    Agregar columna de prefijo
                </Button>
            )}

            {sinNada ? (
                <Alert severity="info">
                    Sin columnas declaradas la carga se comporta como siempre: un archivo, una remesa.
                </Alert>
            ) : (
                <Alert severity="info">
                    Al cargar vas a ver la tabla de cortes con la cantidad de casos de cada uno y el
                    número que le toca, antes de que se cree nada. Las remesas comparten el archivo:
                    no se sube ni se guarda varias veces.
                </Alert>
            )}
        </Box>
    )
}
