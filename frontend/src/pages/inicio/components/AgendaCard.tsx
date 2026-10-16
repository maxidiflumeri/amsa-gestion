import React from 'react';
import { Box, Chip, Stack, Tab, Tabs, Typography } from '@mui/material';
import type { AgendaItemDto, MiDiaDto } from '../../../api/inicio';
import { SectionCard } from '../../../components/ui';
import { fmtMoney } from '../../dashboards/utils';
import { diaConNombre } from '../formato';
import BloqueEstado from './BloqueEstado';
import FilaCaso from './FilaCaso';

export type PestanaAgenda = 'hoy' | 'proximos' | 'sinCumplir';

interface Props {
    datos: MiDiaDto | null;
    cargando: boolean;
    onReintentar: () => void;
    pestana: PestanaAgenda;
    onPestana: (p: PestanaAgenda) => void;
}

const VACIOS: Record<PestanaAgenda, string> = {
    hoy: 'No tenés promesas ni cuotas que venzan hoy',
    proximos: 'Nada en los próximos 7 días',
    sinCumplir: 'Nada sin cumplir en la última semana',
};

type Tono = 'warning' | 'success' | 'error' | 'default';

/** El chip de estado de una fila (docs/inicio-spec.md §6.2). Una promesa cerrada por un pago dice "Cumplida" (D3). */
function chipDe(item: AgendaItemDto, hoy: string): { etiqueta: string; tono: Tono } {
    switch (item.estado) {
        case 'CUMPLIDA':
            return { etiqueta: 'Cumplida', tono: 'success' };
        case 'PAGADA':
            return { etiqueta: 'Pagada', tono: 'success' };
        case 'INCUMPLIDA':
            return { etiqueta: 'Incumplida', tono: 'error' };
        case 'VENCIDA':
            return { etiqueta: 'Vencida', tono: 'error' };
        case 'VIGENTE':
        case 'PENDIENTE':
            if (item.dia === hoy) return { etiqueta: 'Vence hoy', tono: 'warning' };
            if (item.dia > hoy) return { etiqueta: diaConNombre(item.dia), tono: 'default' };
            return { etiqueta: 'Sin cerrar', tono: 'error' };
        default:
            return { etiqueta: item.estado, tono: 'default' };
    }
}

const metaDe = (i: AgendaItemDto) =>
    i.tipo === 'CUOTA'
        ? `${i.documento} · Cuota ${i.nroCuota ?? '?'} de ${i.cantCuotas ?? '?'} del convenio`
        : `${i.documento} · Promesa${i.observacion ? ` · ${i.observacion}` : ''}`;

/** B7. Promesas que tomaste y cuotas de convenios que armaste. */
const AgendaCard: React.FC<Props> = ({ datos, cargando, onReintentar, pestana, onPestana }) => {
    const agenda = datos?.agenda ?? null;
    const sinDatos = !datos || datos.errores.includes('agenda') || !agenda;
    const etiqueta = (base: string, n: number | undefined) => (agenda && n !== undefined ? `${base} · ${n}` : base);

    let cuerpo: React.ReactNode;
    if (cargando && !datos) cuerpo = <BloqueEstado estado="cargando" />;
    else if (sinDatos || !agenda) cuerpo = <BloqueEstado estado="error" onReintentar={onReintentar} />;
    else {
        const lista = agenda[pestana];
        const total = agenda.totales[pestana];
        cuerpo = (
            <>
                {lista.length === 0 ? (
                    <BloqueEstado estado="vacio" vacio={VACIOS[pestana]} />
                ) : (
                    <Stack component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
                        {lista.map((i) => {
                            const chip = chipDe(i, datos!.hoy);
                            return (
                                <li key={`${i.tipo}-${i.id}`}>
                                    <FilaCaso
                                        deudorId={i.deudorId}
                                        nombre={i.nombre}
                                        empresa={i.empresa}
                                        meta={metaDe(i)}
                                        derecha={
                                            <>
                                                <Typography variant="body2" fontWeight={600} noWrap sx={{ fontVariantNumeric: 'tabular-nums' }}>
                                                    {i.monto === null ? 'Sin monto' : fmtMoney(i.monto)}
                                                </Typography>
                                                <Chip label={chip.etiqueta} size="small" color={chip.tono} variant={chip.tono === 'default' ? 'outlined' : 'filled'} sx={{ height: 22 }} />
                                            </>
                                        }
                                    />
                                </li>
                            );
                        })}
                    </Stack>
                )}
                {total > lista.length && (
                    <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1, px: 1 }}>
                        Se muestran {lista.length} de {total}
                    </Typography>
                )}
                {(!agenda.incluye.promesas || !agenda.incluye.cuotas) && (
                    <Typography variant="caption" color="text.disabled" component="p" sx={{ mt: 0.5, px: 1 }}>
                        {agenda.incluye.promesas ? 'Solo promesas: no tenés permiso para ver convenios.' : 'Solo cuotas de convenios: no tenés permiso para ver promesas.'}
                    </Typography>
                )}
            </>
        );
    }

    return (
        <SectionCard title="Tu agenda">
            <Box sx={{ mt: -1, mb: 1 }}>
                <Tabs
                    value={pestana}
                    onChange={(_, v: PestanaAgenda) => onPestana(v)}
                    variant="scrollable"
                    scrollButtons="auto"
                    allowScrollButtonsMobile
                    aria-label="Período de la agenda"
                >
                    <Tab value="hoy" id="agenda-tab-hoy" aria-controls="agenda-panel" label={etiqueta('Hoy', agenda?.totales.hoy)} />
                    <Tab value="proximos" id="agenda-tab-proximos" aria-controls="agenda-panel" label={etiqueta('Próximos 7 días', agenda?.totales.proximos)} />
                    <Tab value="sinCumplir" id="agenda-tab-sinCumplir" aria-controls="agenda-panel" label={etiqueta('Sin cumplir', agenda?.totales.sinCumplir)} />
                </Tabs>
            </Box>
            <Box id="agenda-panel" role="tabpanel" aria-labelledby={`agenda-tab-${pestana}`}>
                {cuerpo}
            </Box>
        </SectionCard>
    );
};

export default AgendaCard;
