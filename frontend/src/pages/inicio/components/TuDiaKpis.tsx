import React from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import type { MiDiaDto } from '../../../api/inicio';
import { fmtMoney, fmtNumber } from '../../dashboards/utils';
import { variacion } from '../formato';
import { conIndicadoresDePromesas, type Tiene } from '../reglasBloques';
import KpiTile from './KpiTile';

interface Props {
    datos: MiDiaDto | null;
    cargando: boolean;
    tiene: Tiene;
    onReintentar: () => void;
    onVerVencenHoy: () => void;
}

type Estado = 'ok' | 'cargando' | 'error';

/** Estado de un bloque de `mi-dia`: cargando la primera vez; error si el pedido falló, si el backend lo marcó o si vino vacío sin motivo. */
function estadoDe<T>(datos: MiDiaDto | null, cargando: boolean, valor: T | null | undefined, campo: MiDiaDto['errores'][number]): Estado {
    if (cargando && !datos) return 'cargando';
    if (!datos || datos.errores.includes(campo) || valor == null) return 'error';
    return 'ok';
}

/** B4. Los dos primeros indicadores son siempre los mismos; los dos últimos dependen de `promesas.ver`. */
const TuDiaKpis: React.FC<Props> = ({ datos, cargando, tiene, onReintentar, onVerVencenHoy }) => {
    const g = datos?.gestiones ?? null;
    const p = datos?.promesas ?? null;
    const eg = estadoDe(datos, cargando, g, 'gestiones');
    const ep = estadoDe(datos, cargando, p, 'promesas');
    const mas = g?.truncado ? '+' : '';
    const num = (n: number) => `${fmtNumber(n)}${mas}`;

    let comparacion = '';
    if (g) {
        if (g.promedioALaMismaHora === null) comparacion = 'Sin días anteriores para comparar';
        else if (g.promedioALaMismaHora <= 0) comparacion = 'Tu promedio a esta hora es 0';
        else comparacion = 'contra tu promedio a esta hora';
    }
    const ceroHoy = g && g.hoy === 0;

    return (
        <Box>
            <Stack direction="row" spacing={1.25} alignItems="baseline" sx={{ mb: 1 }}>
                <Typography variant="overline" fontWeight={600} color="text.secondary" component="h2" sx={{ lineHeight: 1.6 }}>
                    Tu día
                </Typography>
                <Typography variant="caption" color="text.disabled">
                    lo que hiciste hoy
                </Typography>
            </Stack>
            <Box
                sx={{
                    display: 'grid',
                    gap: { xs: 1.5, sm: 2 },
                    gridTemplateColumns: { xs: 'repeat(auto-fit, minmax(150px, 1fr))', sm: 'repeat(auto-fit, minmax(200px, 1fr))' },
                }}
            >
                <KpiTile
                    titulo="Gestiones hoy"
                    estado={eg}
                    onReintentar={onReintentar}
                    valor={g ? num(g.hoy) : undefined}
                    delta={g ? variacion(g.hoy, g.promedioALaMismaHora) : undefined}
                    leyenda={ceroHoy ? 'Todavía no registraste gestiones hoy' : comparacion}
                    serie={g ? g.serie.slice(-7).map((d) => d.gestiones) : undefined}
                />
                <KpiTile
                    titulo="Casos trabajados hoy"
                    estado={eg}
                    onReintentar={onReintentar}
                    valor={g ? num(g.casosHoy) : undefined}
                    leyenda={g ? `Ayer a esta hora: ${fmtNumber(g.ayerALaMismaHora.casos)}` : undefined}
                />
                {conIndicadoresDePromesas(tiene) ? (
                    <>
                        <KpiTile
                            titulo="Promesas tomadas"
                            estado={ep}
                            onReintentar={onReintentar}
                            valor={p ? fmtNumber(p.tomadas7d) : undefined}
                            unidad="en 7 días"
                            leyenda={
                                p
                                    ? p.vencidas30d.total === 0
                                        ? 'Todavía no venció ninguna'
                                        : `${Math.round((p.vencidas30d.cumplidas / p.vencidas30d.total) * 100)} % cumplidas · ${fmtNumber(p.vencidas30d.cumplidas)} de ${fmtNumber(p.vencidas30d.total)} que vencieron en 30 días`
                                    : undefined
                            }
                        />
                        <KpiTile
                            titulo="Vencen hoy"
                            estado={ep}
                            onReintentar={onReintentar}
                            valor={p ? fmtNumber(p.vencenHoy.cantidad) : undefined}
                            unidad={p ? (p.vencenHoy.cantidad === 1 ? 'promesa' : 'promesas') : undefined}
                            pie={p && p.vencenHoy.cantidad > 0 ? fmtMoney(p.vencenHoy.monto) : undefined}
                            accion={
                                p && p.vencenHoy.cantidad > 0 && tiene('promesas.ver') ? (
                                    <Button size="small" onClick={onVerVencenHoy} sx={{ minWidth: 0, py: 0 }}>
                                        Ver
                                    </Button>
                                ) : undefined
                            }
                            leyenda={p ? (p.vencenHoy.cantidad === 0 ? 'Ninguna promesa tuya vence hoy' : 'Si no entra el pago, mañana pasan a incumplidas') : undefined}
                        />
                    </>
                ) : (
                    <>
                        <KpiTile
                            titulo="Gestiones de la semana"
                            estado={eg}
                            onReintentar={onReintentar}
                            valor={g ? num(g.semana.gestiones) : undefined}
                            leyenda={g ? `desde el lunes · ${plural(g.semana.diasConGestion)}` : undefined}
                        />
                        <KpiTile
                            titulo="Casos de la semana"
                            estado={eg}
                            onReintentar={onReintentar}
                            valor={g ? num(g.semana.casos) : undefined}
                            leyenda="casos distintos desde el lunes"
                        />
                    </>
                )}
            </Box>
        </Box>
    );
};

const plural = (n: number) => `${n} ${n === 1 ? 'día con gestión' : 'días con gestión'}`;

export default TuDiaKpis;
