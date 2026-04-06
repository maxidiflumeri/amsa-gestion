---
name: react-component
description: >
  Crear o modificar componentes React en AMSA Sender (React + Vite + MUI).
  Usar este skill siempre que se pida crear una pantalla, página, componente,
  tabla, formulario, modal, diálogo, sidebar, card, tab, o cualquier elemento
  de UI. También aplicar cuando se refactorice el frontend, se agregue dark/light
  mode a un componente, o se integre un componente con sockets o con la API.
---

# Skill: Componente React — AMSA Sender

## Stack UI

- **React + Vite + TypeScript**
- **MUI v5** para componentes
- **MUI `useTheme` / `sx` prop** para dark/light mode
- **Axios** para llamadas HTTP
- **socket.io-client** para realtime

## Estructura de archivos

```
src/
├── pages/
│   └── NombrePagina/
│       ├── index.tsx              # Página principal
│       └── components/
│           ├── TablaItems.tsx
│           └── ModalCrear.tsx
├── components/                    # Componentes reutilizables globales
│   └── StatusChip.tsx
└── hooks/
    └── useNombreHook.ts
```

## Plantilla base de componente

```tsx
import { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  useTheme,
  CircularProgress,
  Alert,
} from '@mui/material';

interface Props {
  campanaId: number;
  onSuccess?: () => void;
}

const MiComponente = ({ campanaId, onSuccess }: Props) => {
  const theme = useTheme();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Box
      sx={{
        p: 3,
        borderRadius: 2,
        bgcolor: theme.palette.background.paper,
        border: `1px solid ${theme.palette.divider}`,
      }}
    >
      <Typography variant="h6" sx={{ mb: 2, color: theme.palette.text.primary }}>
        Título del componente
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Button
        variant="contained"
        disabled={loading}
        startIcon={loading ? <CircularProgress size={16} /> : null}
        onClick={handleAccion}
      >
        {loading ? 'Procesando...' : 'Ejecutar'}
      </Button>
    </Box>
  );
};

export default MiComponente;
```

## Dark/Light mode — reglas

**SIEMPRE** usar valores del tema, nunca colores hardcodeados:

```tsx
// ✅ Correcto
bgcolor: theme.palette.background.paper
color: theme.palette.text.secondary
borderColor: theme.palette.divider

// ❌ Incorrecto
bgcolor: '#ffffff'
color: '#333333'
```

Para colores de estado usar `alpha` de MUI:

```tsx
import { alpha } from '@mui/material';

bgcolor: alpha(theme.palette.success.main, 0.1)
```

## Tablas con DataGrid o Table MUI

```tsx
import {
  Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Paper,
} from '@mui/material';

<TableContainer component={Paper} elevation={0} sx={{ border: `1px solid ${theme.palette.divider}` }}>
  <Table>
    <TableHead>
      <TableRow sx={{ bgcolor: theme.palette.action.hover }}>
        <TableCell sx={{ fontWeight: 700 }}>Nombre</TableCell>
        <TableCell sx={{ fontWeight: 700 }}>Estado</TableCell>
      </TableRow>
    </TableHead>
    <TableBody>
      {rows.map((row) => (
        <TableRow key={row.id} hover>
          <TableCell>{row.nombre}</TableCell>
          <TableCell><StatusChip estado={row.estado} /></TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
</TableContainer>
```

## Formularios

```tsx
import { TextField, MenuItem } from '@mui/material';

<TextField
  label="Nombre de campaña"
  fullWidth
  required
  value={form.nombre}
  onChange={(e) => setForm({ ...form, nombre: e.target.value })}
  error={!!errors.nombre}
  helperText={errors.nombre}
  sx={{ mb: 2 }}
/>
```

## Integración con socket.io para progreso en tiempo real

```tsx
import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import LinearProgress from '@mui/material/LinearProgress';

const ProgresoCampana = ({ campanaId }: { campanaId: number }) => {
  const [progreso, setProgreso] = useState(0);

  useEffect(() => {
    const socket: Socket = io(import.meta.env.VITE_API_URL);

    socket.on(`campana:${campanaId}:progreso`, (data) => {
      setProgreso(data.progreso);
    });

    return () => { socket.disconnect(); };
  }, [campanaId]);

  return (
    <Box sx={{ width: '100%', mt: 1 }}>
      <LinearProgress variant="determinate" value={progreso} />
      <Typography variant="caption">{progreso}%</Typography>
    </Box>
  );
};
```

## StatusChip reutilizable

```tsx
const colorMap: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
  COMPLETADA: 'success',
  EN_PROGRESO: 'warning',
  PAUSADA: 'default',
  FALLIDA: 'error',
};

const StatusChip = ({ estado }: { estado: string }) => (
  <Chip
    label={estado}
    color={colorMap[estado] ?? 'default'}
    size="small"
    variant="outlined"
  />
);
```

## Checklist antes de entregar

- [ ] ¿Todos los colores vienen de `theme.palette`?
- [ ] ¿Se probó visualmente en dark y light mode?
- [ ] ¿Los estados de loading y error están manejados?
- [ ] ¿Los formularios tienen validación antes de enviar?
- [ ] ¿Los sockets se desconectan en el cleanup del `useEffect`?
- [ ] ¿El componente tiene tipado TypeScript completo (sin `any`)?
