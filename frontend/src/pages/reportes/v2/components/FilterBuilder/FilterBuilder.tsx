import { useState } from 'react'
import { Box, Button, Typography, Paper, useTheme } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import { DndContext, closestCenter, DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { FiltroV2, NodoCatalogo } from '../../../../../types/reportes-v2'
import FilterChip from './FilterChip'
import FilterEditor from './FilterEditor'

type FilterBuilderProps = {
  filtros: FiltroV2[]
  catalogo: NodoCatalogo[]
  onChange: (filtros: FiltroV2[]) => void
}

const FilterBuilder = ({ filtros, catalogo, onChange }: FilterBuilderProps) => {
  const theme = useTheme()
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingFiltro, setEditingFiltro] = useState<FiltroV2 | null>(null)

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
        onSave={handleSave}
        onDelete={editingFiltro ? handleDelete : undefined}
        onClose={() => setEditorOpen(false)}
      />
    </Paper>
  )
}

export default FilterBuilder
