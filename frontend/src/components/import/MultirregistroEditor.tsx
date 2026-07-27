import React, { useMemo } from 'react'
import { Alert, Box, Button, Chip, Stack, TextField, Typography } from '@mui/material'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'

/**
 * Editor de la config de una plantilla MULTIRREGISTRO.
 *
 * A diferencia del resto de las categorías, acá no se mapea "columna → campo": la estructura del
 * archivo (qué tipo de línea es el cliente, cuál el aviso, cómo se vinculan) la resuelve el backend,
 * porque es específica del formato de cada cedente. Lo que se configura acá es el **layout**: qué
 * índice de columna ocupa cada dato, que es lo que el cedente puede mover sin aviso.
 *
 * Se edita como JSON a propósito: es config técnica que se toca una vez al dar de alta la cartera,
 * no algo que el operador ajuste a diario. El botón de preset deja el layout de Toyota 87 listo.
 */

/** Layout del archivo diario de Toyota cuenta 87. Índices 1-based sobre la línea separada por `;`. */
export const PRESET_TOYOTA_87 = {
    discriminadorIndex: 0,
    encoding: 'latin1',
    cli: {
        codigo: 'CLI',
        nroCliente: 2,
        nombre: 3,
        domicilio: [4, 5, 6, 7],
        email: 13,
        codArea: 14,
        telefonos: [15, 16],
        adicionales: { cp: 8, localidad: 9, provincia: 11, tipo_persona: 12 },
    },
    ges: { codigo: 'GES', nroCliente: 3, contrato: 4, aviso: 6 },
    det: {
        codigo: 'DET',
        aviso: 2,
        concepto: 3,
        importe: 4,
        dias: 6,
        conceptoDiasMora: 'Días de Mora',
        conceptosIgnorados: ['Cargo por Pago Fuera de Termino'],
    },
    baj: { codigo: 'BAJ', aviso: 2, fecha: 3, motivo: 4 },
}

interface Props {
    value: string
    onChange: (v: string) => void
}

export default function MultirregistroEditor({ value, onChange }: Props) {
    const { error, resumen } = useMemo(() => {
        if (!value.trim()) return { error: 'Falta la configuración del layout.', resumen: null }
        try {
            const cfg = JSON.parse(value)
            const faltan: string[] = []
            if (!cfg.cli?.codigo || !cfg.cli?.nroCliente) faltan.push('cli (código y nroCliente)')
            if (!cfg.ges?.codigo || !cfg.ges?.nroCliente || !cfg.ges?.aviso) faltan.push('ges (código, nroCliente y aviso)')
            if (!cfg.det?.codigo || !cfg.det?.aviso || !cfg.det?.importe) faltan.push('det (código, aviso e importe)')
            if (!cfg.baj?.codigo || !cfg.baj?.aviso) faltan.push('baj (código y aviso)')
            if (faltan.length) return { error: `Falta configurar: ${faltan.join(', ')}`, resumen: null }
            return {
                error: null,
                resumen: {
                    codigos: [cfg.cli.codigo, cfg.ges.codigo, cfg.det.codigo, cfg.baj.codigo],
                    encoding: cfg.encoding ?? 'latin1',
                },
            }
        } catch (e: any) {
            return { error: `JSON inválido: ${e.message}`, resumen: null }
        }
    }, [value])

    return (
        <Box>
            <Alert severity="info" sx={{ mb: 2 }}>
                Esta categoría es para archivos donde <strong>cada línea tiene un código de tipo</strong> y hay
                que agrupar varias líneas para armar un caso. El backend ya sabe cómo se relacionan entre sí;
                acá solo se indica <strong>en qué columna está cada dato</strong>, para poder corregirlo si el
                cedente mueve algo sin avisar.
            </Alert>

            <Stack direction="row" spacing={1} sx={{ mb: 2 }} alignItems="center" flexWrap="wrap" useFlexGap>
                <Button
                    size="small"
                    variant="outlined"
                    startIcon={<AutoFixHighIcon />}
                    onClick={() => onChange(JSON.stringify(PRESET_TOYOTA_87, null, 2))}
                >
                    Cargar layout de Toyota 87
                </Button>
                {resumen && (
                    <>
                        <Typography variant="caption" color="text.secondary">Tipos de línea:</Typography>
                        {resumen.codigos.map((c: string) => (
                            <Chip key={c} label={c} size="small" variant="outlined" />
                        ))}
                        <Chip label={resumen.encoding} size="small" color="default" />
                    </>
                )}
            </Stack>

            <TextField
                label="Layout del archivo (JSON)"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                multiline
                minRows={16}
                fullWidth
                error={!!error}
                helperText={
                    error ??
                    'Los índices son 1-based sobre la línea separada por “;” (la columna 1 es el código de tipo).'
                }
                InputProps={{ sx: { fontFamily: 'monospace', fontSize: 13 } }}
            />

            <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1.5 }}>
                <strong>cli</strong>: la ficha del cliente → se convierte en el caso (deudor + contactos). ·{' '}
                <strong>ges</strong>: un aviso → se convierte en una factura, con su contrato. ·{' '}
                <strong>det</strong>: los conceptos que componen el importe del aviso → se suman para el total
                (respetando los negativos) y se guardan como desglose de la factura. ·{' '}
                <strong>baj</strong>: bajas → dan de baja el caso.
            </Typography>
        </Box>
    )
}
