import React from 'react';
import { Box, Chip, Link, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import type { ImportacionTerminadaDto } from '../../../api/inicio';
import TarjetaProgreso from '../../../components/import/progreso/TarjetaProgreso';
import { SectionCard } from '../../../components/ui';
import { useSocket } from '../../../context/SocketContext';
import type { EstadoCargaDto } from '../../../types/importProgreso';
import { horaCorta } from '../formato';

interface Props {
    /** Las cargas en curso que son del usuario (el filtro lo hace Inicio). */
    enCurso: EstadoCargaDto[];
    terminadas: ImportacionTerminadaDto[];
}

type Tono = 'success' | 'warning' | 'error' | 'default';
const RESULTADOS: Record<string, { etiqueta: string; tono: Tono }> = {
    OK: { etiqueta: 'Finalizada', tono: 'success' },
    CON_ERRORES: { etiqueta: 'Con errores', tono: 'warning' },
    CON_ADVERTENCIAS: { etiqueta: 'Con advertencias', tono: 'warning' },
    SIN_FILAS: { etiqueta: 'Sin filas', tono: 'default' },
    FALLIDA: { etiqueta: 'Fallida', tono: 'error' },
    CANCELADA: { etiqueta: 'Cancelada', tono: 'default' },
};

/** B8. Tus importaciones en curso (por socket) y las que terminaron hoy. Inicio no lo dibuja si no hay ninguna. */
const ImportacionesCard: React.FC<Props> = ({ enCurso, terminadas }) => {
    const { conectado } = useSocket();
    return (
        <SectionCard
            title="Importaciones"
            action={
                <Link component={RouterLink} to="/historial-importaciones" variant="body2" underline="hover" sx={{ pr: 1, pt: 0.5, display: 'inline-block' }}>
                    Historial
                </Link>
            }
        >
            <Stack spacing={1.5}>
                {enCurso.map((c) => (
                    <Box key={c.remesaId} sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 1.5 }}>
                        <TarjetaProgreso
                            variante="compacta"
                            carga={c}
                            conectado={conectado}
                            acciones={
                                <Typography
                                    component={RouterLink}
                                    to={`/historial-importaciones/${c.remesaId}`}
                                    variant="caption"
                                    color="primary.main"
                                    sx={{ textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
                                >
                                    Ver detalle
                                </Typography>
                            }
                        />
                    </Box>
                ))}
                {terminadas.map((t) => {
                    const r = (t.resultado && RESULTADOS[t.resultado]) || { etiqueta: t.resultado ?? 'Terminada', tono: 'default' as Tono };
                    return (
                        <Stack key={t.remesaId} direction="row" spacing={1} alignItems="center" justifyContent="space-between" useFlexGap flexWrap="wrap">
                            <Box sx={{ minWidth: 0 }}>
                                <Link component={RouterLink} to={`/historial-importaciones/${t.remesaId}`} underline="hover" variant="body2" fontWeight={600} color="text.primary" sx={{ display: 'block' }} noWrap>
                                    {t.empresa} · {t.nombre}
                                </Link>
                                <Typography variant="caption" color="text.secondary">
                                    {horaCorta(t.terminadaEn)}
                                </Typography>
                            </Box>
                            <Chip label={r.etiqueta} size="small" color={r.tono} variant={r.tono === 'default' ? 'outlined' : 'filled'} sx={{ height: 22 }} />
                        </Stack>
                    );
                })}
            </Stack>
        </SectionCard>
    );
};

export default ImportacionesCard;
