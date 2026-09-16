import React from 'react';
import { Alert, AlertTitle, Box, Chip, Paper, Stack, Typography } from '@mui/material';
import type { MulticlavePagosPreview } from '../../api/multiclaves';

/**
 * Bloque adicional de la vista previa de una carga de PAGOS cuando la plantilla mapea
 * `nroConvenio` (multiclaves, fase 4a — docs/multiclaves-spec.md §10.9). No reemplaza la tabla de
 * muestra de siempre (`PreviewTable`): se muestra ARRIBA, y solo cuando la plantilla tiene el
 * campo mapeado. Mismo patrón que `MulticlavesResumen.tsx`.
 */

interface Props {
    resumen: MulticlavePagosPreview;
}

const nf = (n: number) => n.toLocaleString('es-AR');
const fmtMonto = (v: string) => Number(v).toLocaleString('es-AR', { minimumFractionDigits: 2 });

export default function PagosConClaveResumen({ resumen }: Props) {
    const {
        filas, conClave, ilegibles, claveCargada, claveOtraEmpresa, claveNoCargada,
        quita, total, sinCaso, tramitesEnVariosCasos, importeConClave,
    } = resumen;

    if (conClave === 0 && ilegibles === 0) return null;

    return (
        <Stack spacing={2} sx={{ mb: 2 }}>
            <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1.5 }}>
                    {nf(conClave)} de {nf(filas)} fila(s) traen número de convenio de una clave de pago
                    {conClave > 0 && ` — $ ${fmtMonto(importeConClave)} en total`}
                </Typography>
                <Box display="flex" flexWrap="wrap" gap={1}>
                    <Chip label={`${nf(claveCargada)} claves cargadas`} color="success" size="small" variant="outlined" />
                    {quita > 0 && <Chip label={`${nf(quita)} de quita`} color="info" size="small" variant="outlined" />}
                    {total > 0 && <Chip label={`${nf(total)} de saldo total`} size="small" variant="outlined" />}
                    {claveNoCargada > 0 && (
                        <Chip
                            label={`${nf(claveNoCargada)} claves no cargadas`}
                            color="warning"
                            size="small"
                            variant="outlined"
                        />
                    )}
                    {claveOtraEmpresa > 0 && (
                        <Chip label={`${nf(claveOtraEmpresa)} de otra empresa`} size="small" variant="outlined" />
                    )}
                    {sinCaso > 0 && <Chip label={`${nf(sinCaso)} sin caso`} size="small" variant="outlined" />}
                    {tramitesEnVariosCasos > 0 && (
                        <Chip label={`${nf(tramitesEnVariosCasos)} en varios casos`} size="small" variant="outlined" />
                    )}
                    {ilegibles > 0 && (
                        <Chip label={`${nf(ilegibles)} ilegibles`} color="error" size="small" variant="outlined" />
                    )}
                </Box>
            </Paper>

            {claveNoCargada > 0 && (
                <Alert severity="warning">
                    <AlertTitle>{nf(claveNoCargada)} pago(s) con clave que todavía no está cargada</AlertTitle>
                    Esos casos NO se van a cancelar con quita hasta que se carguen las claves de esas nóminas
                    (categoría "Claves de pago") y se vuelva a consolidar. El pago igual se guarda con la
                    referencia: apenas la clave exista, la consolidación siguiente los cancela solos.
                </Alert>
            )}
        </Stack>
    );
}
