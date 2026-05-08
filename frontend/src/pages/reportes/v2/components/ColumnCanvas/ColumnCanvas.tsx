import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Box, Paper, Typography } from '@mui/material'
import { ColumnaV2 } from '../../../../../types/reportes-v2'
import ColumnChip from './ColumnChip'
import EmptyCanvas from './EmptyCanvas'

type ColumnCanvasProps = {
  columnas: ColumnaV2[]
  selectedId: string | null
  isDragActive: boolean
  onSelect: (id: string) => void
  onRemove: (id: string) => void
}

const ColumnCanvas = ({ columnas, selectedId, isDragActive, onSelect, onRemove }: ColumnCanvasProps) => {
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
      <Typography variant="h6" gutterBottom>
        Columnas del reporte ({columnas.length})
      </Typography>

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
