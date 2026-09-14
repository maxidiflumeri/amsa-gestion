import React, { useMemo } from 'react'
import {
    Alert,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TextField,
    Typography,
} from '@mui/material'

/**
 * Panel de solo lectura del layout de MULTICLAVES + el único campo editable (`codigosGestor`).
 *
 * A diferencia de Multirregistro/Multiarchivo, el layout de esta categoría NO se edita: las 9
 * columnas del archivo, sus posiciones y el formato de la clave/código de barras son estructurales
 * (dígitos verificadores incluidos) y viven en el backend
 * (`imports/plantillas/telecom-multiclaves.ts`). Un cambio de formato de Telecom requiere código
 * de todos modos. Ver `docs/multiclaves-spec.md` §5.1.
 */

const COLUMNAS = [
    { nro: 1, nombre: 'NRO_TRAMITE', descripcion: 'Identidad del trámite. Cruza con el Nº de cliente del caso.' },
    { nro: 2, nombre: 'NRO_CONVENIO', descripcion: 'Identidad de la clave. Único en toda la base.' },
    { nro: 3, nombre: 'SALDO_TRAMITE', descripcion: 'Saldo informado por Telecom para el trámite.' },
    { nro: 4, nombre: 'IMPORTE_TOTAL_CLAVE', descripcion: 'Importe de la clave (saldo total o quita del 50%).' },
    { nro: 5, nombre: 'CLAVE_PAGO', descripcion: '22 dígitos. Se va a mostrar en la ficha cuando se habilite el cupón.' },
    { nro: 6, nombre: 'FECHA_VENCIMIENTO', descripcion: 'Vencimiento de la clave (AAAAMMDD).' },
    { nro: 7, nombre: 'SEC_COD_BARRA', descripcion: '50 dígitos. Se imprime en el cupón, tal cual viene.' },
    { nro: 8, nombre: 'CODIGO_GESTOR', descripcion: 'Valida que la clave sea de esta empresa (ver "Códigos de gestor" abajo).' },
    { nro: 9, nombre: 'APELLIDO_NOMBRE_RAZON_SOCIAL', descripcion: 'No es el cliente — se ignora.' },
    { nro: 10, nombre: '(sin nombre)', descripcion: 'Marca del archivo. Se guarda tal cual llega.' },
]

interface Props {
    /** JSON de `mappingJson.multiclaves`, como texto (mismo patrón que Multi{registro,archivo}Editor). */
    value: string
    onChange: (value: string) => void
}

export default function MulticlavesLayoutInfo({ value, onChange }: Props) {
    const codigosGestor = useMemo<string[]>(() => {
        try {
            const parsed = JSON.parse(value)
            return Array.isArray(parsed?.codigosGestor) ? parsed.codigosGestor : []
        } catch {
            return []
        }
    }, [value])

    const [texto, setTexto] = React.useState(codigosGestor.join(', '))
    React.useEffect(() => setTexto(codigosGestor.join(', ')), [value]) // eslint-disable-line react-hooks/exhaustive-deps

    const aplicar = (nuevoTexto: string) => {
        setTexto(nuevoTexto)
        const lista = nuevoTexto
            .split(',')
            .map((c) => c.trim())
            .filter(Boolean)
        onChange(JSON.stringify({ codigosGestor: lista }))
    }

    return (
        <>
            <Alert severity="info" sx={{ mb: 2 }}>
                El layout de este archivo es fijo (Telecom/Personal): las posiciones de las columnas y
                los dígitos verificadores de la clave y el código de barras se validan en el sistema, no
                acá. Lo único que se configura es qué código de gestor se acepta.
            </Alert>

            <TextField
                label="Códigos de gestor aceptados"
                value={texto}
                onChange={(e) => aplicar(e.target.value)}
                fullWidth
                helperText='Separados por coma. Una fila con otro código en CODIGO_GESTOR se rechaza como "GESTOR_AJENO". Ana Maya recibe todo con "1008".'
                sx={{ mb: 3 }}
            />

            <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                Columnas del archivo (fijas)
            </Typography>
            <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell width={40}>#</TableCell>
                            <TableCell>Columna</TableCell>
                            <TableCell>Uso</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {COLUMNAS.map((c) => (
                            <TableRow key={c.nro} hover>
                                <TableCell>{c.nro}</TableCell>
                                <TableCell sx={{ fontFamily: 'monospace' }}>{c.nombre}</TableCell>
                                <TableCell>
                                    <Typography variant="body2" color="text.secondary">
                                        {c.descripcion}
                                    </Typography>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
        </>
    )
}
