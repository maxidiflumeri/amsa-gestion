import React, { useState } from 'react'
import {
  Box, Typography, Divider, Paper, Button, TextField, Autocomplete,
  Grid, Card, CardContent, CircularProgress
} from '@mui/material'
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer
} from 'recharts'
import { useTheme } from '@mui/material/styles'
import api from '../../api/axios'

interface Empresa {
  id: number
  nombre: string
}

interface Stats {
  totalDeudores: number
  montoTotal: number
  porSituacion: Array<{
    clave: string
    descripcion: string
    cantidad: number
    monto: number
  }>
  porGestion: Array<{
    clave: string
    descripcion: string
    cantidad: number
  }>
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#ff7c7c']

const ReportesEstadisticas: React.FC = () => {
  const theme = useTheme()
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [empresaId, setEmpresaId] = useState<number | null>(null)
  const [periodoDesde, setPeriodoDesde] = useState('')
  const [periodoHasta, setPeriodoHasta] = useState('')
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadedEmpresas, setLoadedEmpresas] = useState(false)

  React.useEffect(() => {
    if (!loadedEmpresas) {
      fetchEmpresas()
      setLoadedEmpresas(true)
    }
  }, [loadedEmpresas])

  const fetchEmpresas = async () => {
    try {
      const res = await api.get('/empresas')
      setEmpresas(res.data)
    } catch (error) {
      console.error('Error fetching empresas:', error)
    }
  }

  const handleGenerar = async () => {
    if (!empresaId) {
      alert('Por favor seleccione una empresa')
      return
    }

    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.append('empresaId', empresaId.toString())
      if (periodoDesde) params.append('periodoDesde', periodoDesde)
      if (periodoHasta) params.append('periodoHasta', periodoHasta)

      const res = await api.get(`/reportes/estadisticas/remesas?${params.toString()}`)
      setStats(res.data)
    } catch (error) {
      console.error('Error fetching stats:', error)
      alert('Error al generar las estadísticas')
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS'
    }).format(value)
  }

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" gutterBottom sx={{ fontWeight: 'bold' }}>
          Estadísticas de Remesas
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Visualice estadísticas y métricas de sus carteras.
        </Typography>
        <Divider sx={{ mt: 2 }} />
      </Box>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>Filtros</Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <Autocomplete
              options={empresas}
              getOptionLabel={(e) => e.nombre}
              value={empresas.find(e => e.id === empresaId) || null}
              onChange={(_, val) => setEmpresaId(val?.id || null)}
              renderInput={(params) => <TextField {...params} label="Empresa *" />}
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              label="Período Desde"
              type="month"
              fullWidth
              value={periodoDesde}
              onChange={(e) => setPeriodoDesde(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              label="Período Hasta"
              type="month"
              fullWidth
              value={periodoHasta}
              onChange={(e) => setPeriodoHasta(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} md={2}>
            <Button
              variant="contained"
              fullWidth
              onClick={handleGenerar}
              disabled={loading}
              sx={{ height: '56px' }}
            >
              {loading ? <CircularProgress size={24} /> : 'Generar'}
            </Button>
          </Grid>
        </Grid>
      </Paper>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      )}

      {!loading && stats && (
        <>
          <Grid container spacing={3} sx={{ mb: 3 }}>
            <Grid item xs={12} md={6}>
              <Card sx={{ bgcolor: theme.palette.primary.main, color: 'white' }}>
                <CardContent>
                  <Typography variant="h6" gutterBottom>Total Deudores</Typography>
                  <Typography variant="h3" sx={{ fontWeight: 'bold' }}>
                    {stats.totalDeudores.toLocaleString('es-AR')}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} md={6}>
              <Card sx={{ bgcolor: theme.palette.success.main, color: 'white' }}>
                <CardContent>
                  <Typography variant="h6" gutterBottom>Monto Total</Typography>
                  <Typography variant="h3" sx={{ fontWeight: 'bold' }}>
                    {formatCurrency(stats.montoTotal)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <Paper sx={{ p: 3 }}>
                <Typography variant="h6" gutterBottom>Distribución por Situación</Typography>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={stats.porSituacion}
                      dataKey="cantidad"
                      nameKey="descripcion"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      label={({ name, value }) => `${name} (${value})`}
                    >
                      {stats.porSituacion.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value, name, props) => [
                        `${value} deudores - ${formatCurrency((props.payload as { monto: number }).monto)}`,
                        name
                      ]}
                      contentStyle={{
                        backgroundColor: theme.palette.background.paper,
                        border: `1px solid ${theme.palette.divider}`
                      }}
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </Paper>
            </Grid>

            <Grid item xs={12} md={6}>
              <Paper sx={{ p: 3 }}>
                <Typography variant="h6" gutterBottom>Distribución por Última Gestión</Typography>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={stats.porGestion}>
                    <XAxis
                      dataKey="descripcion"
                      angle={-45}
                      textAnchor="end"
                      height={100}
                      tick={{ fill: theme.palette.text.primary }}
                    />
                    <YAxis tick={{ fill: theme.palette.text.primary }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: theme.palette.background.paper,
                        border: `1px solid ${theme.palette.divider}`
                      }}
                    />
                    <Legend />
                    <Bar dataKey="cantidad" fill={theme.palette.primary.main} name="Cantidad" />
                  </BarChart>
                </ResponsiveContainer>
              </Paper>
            </Grid>
          </Grid>
        </>
      )}

      {!loading && !stats && (
        <Box sx={{ textAlign: 'center', py: 8, color: 'text.disabled' }}>
          <Typography variant="h6">Seleccione los filtros y haga clic en Generar</Typography>
        </Box>
      )}
    </Box>
  )
}

export default ReportesEstadisticas
