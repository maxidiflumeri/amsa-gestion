import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Box, Button, Paper, Stack, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import { Columna } from '../../../../types/reportes'
import ColumnChip from './ColumnChip'
import EmptyCanvas from './EmptyCanvas'

type ColumnCanvasProps = {
  columnas: Columna[]
  selectedId: string | null
  isDragActive: boolean
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  onAddFixed?: () => void
}

const ColumnCanvas = ({ columnas, selectedId, isDragActive, onSelect, onRemove, onAddFixed }: ColumnCanvasProps) => {
  const { setNodeRef, isOver } = useDroppable({
    id: 'column-canvas',
  })

  return (
    <Paper
      ref={setNodeRef}
      sx={{
        p: 2,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        border: isDragActive || isOver ? 2 : 1,
        borderColor: isDragActive || isOver ? 'primary.main' : 'divider',
        borderStyle: isDragActive || isOver ? 'dashed' : 'solid',
        transition: 'all 0.2s',
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="h6">
          Columnas del reporte ({columnas.length})
        </Typography>
        {onAddFixed && (
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={onAddFixed}
            /* Para respetar la estructura de columnas que espera el sistema destino cuando no hay
               dato para todas: se agrega la columna y se la deja vacía. */
            title="Columna que no sale de los datos: vacía, o con un texto fijo en todas las filas"
          >
            Columna fija
          </Button>
        )}
      </Stack>

      <Box sx={{ flexGrow: 1, overflow: 'auto' }}>
        {columnas.length === 0 ? (
          <EmptyCanvas />
        ) : (
          <SortableContext items={columnas.map(c => c.id)} strategy={verticalListSortingStrategy}>
            {columnas.map(columna => (
              <ColumnChip
                key={columna.id}
                columna={columna}
                isSelected={columna.id === selectedId}
                onSelect={() => onSelect(columna.id)}
                onRemove={() => onRemove(columna.id)}
              />
            ))}
          </SortableContext>
        )}
      </Box>
    </Paper>
  )
}

export default ColumnCanvas
