import React from 'react'
import { Container, Tabs, Tab, Box, Typography } from '@mui/material'

function App() {
  const [selectedTab, setSelectedTab] = React.useState(0)

  return (
    <Container maxWidth="xl" sx={{ mt: 4 }}>
      <Typography variant="h4" gutterBottom>
        Gestión de Cobranzas
      </Typography>
      <Tabs value={selectedTab} onChange={(_, v) => setSelectedTab(v)} sx={{ mb: 2 }}>
        <Tab label="👤 Datos del deudor" />
        <Tab label="📋 Lista de deudores" />
      </Tabs>

      <Box hidden={selectedTab !== 0}>
        <Typography variant="h6">Ficha del deudor seleccionado</Typography>
      </Box>

      <Box hidden={selectedTab !== 1}>
        <Typography variant="h6">Tabla de deudores</Typography>
      </Box>
    </Container>
  )
}

export default App
