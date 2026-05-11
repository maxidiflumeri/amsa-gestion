import React, { useEffect, useState } from 'react';
import { Box, Card, CardContent, CircularProgress, Grid, Stack, Typography } from '@mui/material';
import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Legend,
    Line,
    LineChart,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip as RTooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { auditoriaApi } from '../../api/auditoria';
import type { AuditoriaStats } from '../../types/auditoria';

const COLORS = ['#1976d2', '#388e3c', '#f57c00', '#7b1fa2', '#c2185b', '#0288d1', '#5d4037'];

const Kpi: React.FC<{ label: string; value: number | string; emphasis?: 'error' | 'warning' | 'default' }> = ({ label, value, emphasis = 'default' }) => (
    <Card>
        <CardContent>
            <Typography variant="overline" color="text.secondary">{label}</Typography>
            <Typography variant="h4" sx={{ color: emphasis === 'error' ? 'error.main' : emphasis === 'warning' ? 'warning.main' : 'text.primary' }}>
                {value}
            </Typography>
        </CardContent>
    </Card>
);

const AuditoriaDashboard: React.FC = () => {
    const [data, setData] = useState<AuditoriaStats | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let alive = true;
        auditoriaApi.stats().then((d) => { if (alive) { setData(d); setLoading(false); } }).catch(() => alive && setLoading(false));
        const id = setInterval(() => auditoriaApi.stats().then((d) => alive && setData(d)).catch(() => null), 60_000);
        return () => { alive = false; clearInterval(id); };
    }, []);

    if (loading) return <Box display="flex" justifyContent="center" p={4}><CircularProgress /></Box>;
    if (!data) return <Typography color="text.secondary">Sin datos.</Typography>;

    return (
        <Stack spacing={3}>
            <Grid container spacing={2}>
                <Grid item xs={12} sm={6} md={3}><Kpi label="Hoy" value={data.totales.hoy.toLocaleString()} /></Grid>
                <Grid item xs={12} sm={6} md={3}><Kpi label="Últimos 7 días" value={data.totales.semana.toLocaleString()} /></Grid>
                <Grid item xs={12} sm={6} md={3}><Kpi label="Últimos 30 días" value={data.totales.mes.toLocaleString()} /></Grid>
                <Grid item xs={12} sm={6} md={3}><Kpi label="Fallidos 24h" value={data.fallidos.ultimas24h.toLocaleString()} emphasis={data.fallidos.ultimas24h > 0 ? 'error' : 'default'} /></Grid>
            </Grid>

            <Grid container spacing={2}>
                <Grid item xs={12} md={8}>
                    <Card>
                        <CardContent>
                            <Typography variant="subtitle1" gutterBottom>Actividad — últimos 30 días</Typography>
                            <Box height={260}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={data.seriePorDia.map((s) => ({ ...s, fecha: new Date(s.fecha).toLocaleDateString() }))}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="fecha" />
                                        <YAxis />
                                        <RTooltip />
                                        <Line type="monotone" dataKey="count" stroke="#1976d2" dot={false} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid item xs={12} md={4}>
                    <Card>
                        <CardContent>
                            <Typography variant="subtitle1" gutterBottom>Por módulo</Typography>
                            <Box height={260}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie data={data.porModulo} dataKey="count" nameKey="modulo" outerRadius={90} label>
                                            {data.porModulo.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                                        </Pie>
                                        <Legend />
                                        <RTooltip />
                                    </PieChart>
                                </ResponsiveContainer>
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid item xs={12} md={6}>
                    <Card>
                        <CardContent>
                            <Typography variant="subtitle1" gutterBottom>Top tipos de acción</Typography>
                            <Box height={300}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={data.porTipo} layout="vertical">
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis type="number" />
                                        <YAxis type="category" dataKey="tipo" width={140} />
                                        <RTooltip />
                                        <Bar dataKey="count" fill="#388e3c" />
                                    </BarChart>
                                </ResponsiveContainer>
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid item xs={12} md={6}>
                    <Card>
                        <CardContent>
                            <Typography variant="subtitle1" gutterBottom>Top usuarios</Typography>
                            <Box height={300}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={data.porUsuario.map((u) => ({ nombre: u.nombre ?? 'Sistema', count: u.count }))} layout="vertical">
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis type="number" />
                                        <YAxis type="category" dataKey="nombre" width={140} />
                                        <RTooltip />
                                        <Bar dataKey="count" fill="#7b1fa2" />
                                    </BarChart>
                                </ResponsiveContainer>
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>
        </Stack>
    );
};

export default AuditoriaDashboard;
