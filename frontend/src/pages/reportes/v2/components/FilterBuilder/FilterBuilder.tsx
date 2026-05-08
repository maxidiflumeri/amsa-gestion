import { useState } from 'react'
import { Box, Button, Typography, Paper, useTheme, Alert, Collapse, Link } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import { DndContext, closestCenter, DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { FiltroV2, NodoCatalogo } from '../../../../../types/reportes-v2'
import FilterChip from './FilterChip'
import FilterEditor from './FilterEditor'

type FilterBuilderProps = {
  filtros: FiltroV2[]
  catalogo: NodoCatalogo[]
  empresaId?: number | null
  onChange: (filtros: FiltroV2[]) => void
}

const FilterBuilder = ({ filtros, catalogo, empresaId, onChange }: FilterBuilderProps) => {
  const theme = useTheme()
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingFiltro, setEditingFiltro] = useState<FiltroV2 | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)

  const handleAddClick = () => {
    setEditingFiltro(null)
    setEditorOpen(true)
  }

  const handleChipClick = (filtro: FiltroV2) => {
    setEditingFiltro(filtro)
    setEditorOpen(true)
  }

  const handleSave = (filtro: FiltroV2) => {
    if (editingFiltro) {
      onChange(filtros.map(f => (f.id === filtro.id ? filtro : f)))
    } else {
      onChange([...filtros, filtro])
    }
  }

  const handleDelete = () => {
    if (editingFiltro) {
      onChange(filtros.filter(f => f.id !== editingFiltro.id))
      setEditorOpen(false)
    }
  }

  const handleRemove = (id: string) => {
    onChange(filtros.filter(f => f.id !== id))
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = filtros.findIndex(f => f.id === active.id)
    const newIndex = filtros.findIndex(f => f.id === over.id)

    onChange(arrayMove(filtros, oldIndex, newIndex))
  }

  return (
    <Paper sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">Filtros</Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={handleAddClick}
          size="small"
        >
          Agregar filtro
        </Button>
      </Box>

      <Alert severity="info" sx={{ mb: 2 }}>
        <Typography variant="body2">
          Los filtros restringen qué datos aparecen en el reporte (ej: solo deudores activos, vencimientos entre dos fechas).{' '}
          <Link component="button" type="button" onClick={() => setHelpOpen(o => !o)} sx={{ verticalAlign: 'baseline' }}>
            {helpOpen ? 'Ocultar ejemplos' : 'Ver ejemplos'}
          </Link>
        </Typography>
        <Collapse in={helpOpen}>
          <Box sx={{ mt: 1.5, fontSize: 13, lineHeight: 1.6 }}>
            <Box><b>Fijo vs Variable:</b></Box>
            <Box>• <b>Fijo</b>: el valor se guarda en la plantilla. Útil cuando el filtro siempre vale lo mismo (ej: empresa = ACME).</Box>
            <Box>• <b>Variable</b>: el usuario completa el valor al ejecutar. Útil para reportes parametrizables (ej: "fecha desde / hasta").</Box>
            <Box sx={{ mt: 1 }}><b>Ejemplos:</b></Box>
            <Box>• Estado situación = "Activo" — sólo deudores activos.</Box>
            <Box>• Monto Total ≥ 100.000 — sólo deudas grandes.</Box>
            <Box>• Fecha vencimiento entre [variable] y [variable] — el usuario elige el rango al ejecutar.</Box>
            <Box sx={{ mt: 1 }}>Si definís varios filtros, se aplican <b>todos juntos</b> (AND). Para combinaciones OR, usá el operador <code>in</code>.</Box>
          </Box>
        </Collapse>
      </Alert>

      {filtros.length === 0 ? (
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: 2,
            color: theme.palette.text.secondary,
          }}
        >
          <Typography variant="body2">No hay filtros definidos</Typography>
          <Typography variant="caption">
            Los filtros permiten restringir los datos del reporte
          </Typography>
        </Box>
      ) : (
        <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={filtros.map(f => f.id)} strategy={verticalListSortingStrategy}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {filtros.map(filtro => (
                <FilterChip
                  key={filtro.id}
                  filtro={filtro}
                  onClick={() => handleChipClick(filtro)}
                  onDelete={() => handleRemove(filtro.id)}
                />
              ))}
            </Box>
          </SortableContext>
        </DndContext>
      )}

      <FilterEditor
        open={editorOpen}
        filtro={editingFiltro}
        catalogo={catalogo}
        empresaId={empresaId}
        onSave={handleSave}
        onDelete={editingFiltro ? handleDelete : undefined}
        onClose={() => setEditorOpen(false)}
      />
    </Paper>
  )
}

export default FilterBuilder
