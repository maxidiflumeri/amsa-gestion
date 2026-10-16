import React from 'react';
import { Chip, Link, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import type { MiDiaDto } from '../../../api/inicio';
import { SectionCard } from '../../../components/ui';
import { haceCuanto, plural } from '../formato';
import BloqueEstado from './BloqueEstado';
import FilaCaso from './FilaCaso';

interface Props {
    datos: MiDiaDto | null;
    cargando: boolean;
    onReintentar: () => void;
    onBuscar: () => void;
    puedeBuscar: boolean;
}

/** B6. Los últimos casos con una gestión manual tuya en los últimos 30 días. */
const RetomarCard: React.FC<Props> = ({ datos, cargando, onReintentar, onBuscar, puedeBuscar }) => {
    const lista = datos?.retomar ?? null;
    let cuerpo: React.ReactNode;
    if (cargando && !datos) cuerpo = <BloqueEstado estado="cargando" filas={5} />;
    else if (!datos || datos.errores.includes('retomar') || !lista) cuerpo = <BloqueEstado estado="error" onReintentar={onReintentar} />;
    else if (lista.length === 0) {
        cuerpo = (
            <BloqueEstado
                estado="vacio"
                vacio="Cuando registres gestiones, tus últimos casos van a aparecer acá"
                accionVacio={puedeBuscar ? { etiqueta: 'Buscar un caso', onClick: onBuscar } : undefined}
            />
        );
    } else {
        cuerpo = (
            <Stack component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
                {lista.map((c) => {
                    const estado = c.estadoGestion ?? c.estadoSituacion;
                    return (
                        <li key={c.deudorId}>
                            <FilaCaso
                                deudorId={c.deudorId}
                                nombre={c.nombre}
                                empresa={c.empresa}
                                meta={`${c.documento} · ${plural(c.gestionesMias30d, 'gestión tuya', 'gestiones tuyas')} en 30 días`}
                                detalle={c.ultimoTexto}
                                derecha={
                                    <>
                                        {estado && <Chip label={estado} size="small" color="primary" variant="outlined" sx={{ maxWidth: 180 }} />}
                                        <Typography variant="caption" color="text.secondary" noWrap>
                                            {haceCuanto(c.ultimaGestion)}
                                        </Typography>
                                    </>
                                }
                            />
                        </li>
                    );
                })}
            </Stack>
        );
    }

    return (
        <SectionCard
            title="Retomá donde quedaste"
            action={
                <Link component={RouterLink} to="/gestion" variant="body2" underline="hover" sx={{ pr: 1, pt: 0.5, display: 'inline-block' }}>
                    Ver gestión
                </Link>
            }
        >
            {cuerpo}
        </SectionCard>
    );
};

export default RetomarCard;
