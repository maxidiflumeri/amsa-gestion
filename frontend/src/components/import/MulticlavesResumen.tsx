import React from 'react'
import {
    Alert,
    AlertTitle,
    Box,
    Chip,
    Paper,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Typography,
} from '@mui/material'
import { fechaDelCedente } from '../../utils/fechas'
import type { MulticlavesPreview } from '../../api/multiclaves'

/**
 * Resumen de la vista previa de una carga MULTICLAVES (spec §5.6). Reemplaza la tabla de muestra
 * de filas de las demás categorías: acá "una fila" es un trámite, y lo que importa es el cruce
 * contra la cartera (con caso / sin caso / en otra empresa), no ver 50 filas del CSV.
 */

interface Props {
    resumen: MulticlavesPreview
}

const nf = (n: number) => n.toLocaleString('es-AR')

export default function MulticlavesResumen({ resumen }: Props) {
    const {
        lineas, claves, clavesRechazadas, tramites, validos, rechazados, soloTotal, porMotivo,
        conCaso, sinCaso, enOtraEmpresa, yaCargadas, reemisiones, tandasAnteriores, conflictos,
        vencimientos, avisos,
    } = resumen

    // El aviso "ningún trámite tiene caso" ya lo muestra el bloque de advertencias genérico del
    // wizard (viene del mismo `advertencias[]` que arma imports.service.ts): no se repite acá.

    return (
        <Stack spacing={2}>

            <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1.5 }}>
                    {nf(lineas)} líneas → {nf(tramites)} trámites ({nf(claves)} claves a cargar
                    {clavesRechazadas > 0 ? `, ${nf(clavesRechazadas)} de trámites rechazados` : ''})
                </Typography>
                <Box display="flex" flexWrap="wrap" gap={1}>
                    <Chip label={`${nf(validos)} válidos`} color="success" size="small" variant="outlined" />
                    <Chip
                        label={`${nf(rechazados)} rechazados`}
                        color={rechazados > 0 ? 'error' : 'default'}
                        size="small"
                        variant="outlined"
                    />
                    <Chip label={`${nf(conCaso)} con caso`} color="info" size="small" variant="outlined" />
                    <Chip label={`${nf(sinCaso)} sin caso`} size="small" variant="outlined" />
                    {soloTotal > 0 && (
                        <Chip
                            label={`${nf(soloTotal)} solo TOTAL`}
                            size="small"
                            variant="outlined"
                            title="Trajeron una única clave, sin la de quita: se cargan igual, clasificada TOTAL"
                        />
                    )}
                    {yaCargadas > 0 && <Chip label={`${nf(yaCargadas)} ya cargadas`} size="small" variant="outlined" />}
                    {reemisiones > 0 && (
                        <Chip label={`${nf(reemisiones)} reemisiones`} color="warning" size="small" variant="outlined" />
                    )}
                    {tandasAnteriores > 0 && (
                        <Chip
                            label={`${nf(tandasAnteriores)} tandas anteriores`}
                            size="small"
                            variant="outlined"
                            title="Vencimiento anterior al vigente: se cargan igual, pero no quedan vigentes"
                        />
                    )}
                    {conflictos > 0 && (
                        <Chip label={`${nf(conflictos)} conflictos`} color="error" size="small" variant="outlined" />
                    )}
                </Box>
            </Paper>

            {rechazados > 0 && (
                <Alert severity="warning">
                    <AlertTitle>{nf(rechazados)} trámite(s) se van a rechazar</AlertTitle>
                    {Object.entries(porMotivo).map(([m, c]) => `${nf(c)} por ${m}`).join(', ')}. Sus claves no se
                    cargan; el detalle queda en el historial de la importación.
                </Alert>
            )}

            {enOtraEmpresa.length > 0 && conCaso > 0 && (
                <Alert severity="info">
                    {enOtraEmpresa.map((e) => `${nf(e.tramites)} trámite(s) están en ${e.empresa}`).join(', ')}.
                </Alert>
            )}

            {avisos.length > 0 && (
                <Alert severity="info">
                    <AlertTitle>Avisos del archivo</AlertTitle>
                    <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                        {avisos.map((a) => (
                            <li key={a.codigo}>
                                <Typography variant="body2">
                                    <strong>{a.codigo}</strong>: {nf(a.cantidad)} caso(s)
                                    {a.ejemplos.length > 0 && ` (ej: ${a.ejemplos.slice(0, 5).join(', ')})`}
                                </Typography>
                            </li>
                        ))}
                    </Box>
                </Alert>
            )}

            {vencimientos.length > 0 && (
                <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Vencimiento</TableCell>
                                <TableCell align="right">Claves</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {vencimientos.map((v) => (
                                <TableRow key={v.fecha} hover>
                                    <TableCell>{fechaDelCedente(v.fecha)}</TableCell>
                                    <TableCell align="right">{nf(v.claves)}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}
        </Stack>
    )
}
